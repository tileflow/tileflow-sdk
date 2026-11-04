import Foundation
import XCTest

@testable import Tileflow

/// The native evaluators reproduce Core's golden fixtures: numbers within 1e-9, strings exactly.
final class NativeEvaluatorTests: XCTestCase {
  private static let fixture: JSONValue = {
    let url = Bundle.module.url(
      forResource: "native-evaluators", withExtension: "json", subdirectory: "Fixtures/Native")!
    return try! JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
  }()

  private var fixture: JSONValue { Self.fixture }

  func testColoursMixInOKLab() throws {
    let cases = try XCTUnwrap(fixture["colours"]?.array)
    XCTAssertEqual(cases.count, 12)
    for item in cases {
      let mixed = NativeEvaluators.mixColours(
        try XCTUnwrap(item["from"]?.string), try XCTUnwrap(item["to"]?.string),
        try XCTUnwrap(item["t"]?.number))
      XCTAssertEqual(mixed.map(JSONValue.string) ?? .null, item["mixed"], "\(item)")
    }
  }

  func testLeavesFillAtPositionsAndSelections() throws {
    let cases = try XCTUnwrap(fixture["leaves"]?.array)
    XCTAssertEqual(cases.count, 11)
    for item in cases {
      let template = JSONValue.object([NativeEvaluators.leafKey: try XCTUnwrap(item["values"])])
      let select = item["select"]?.array?.compactMap { $0.number.map { Int($0) } }
      let filled = try NativeEvaluators.fill(
        template, position: try XCTUnwrap(item["position"]?.number), select: select)
      assertMatches(filled, try XCTUnwrap(item["filled"]), "\(item)")
    }
  }

  func testBlendLayersFillTheGroupAtASelectionAndPosition() throws {
    let groups = try XCTUnwrap(fixture["family"]?["blend"]?["groups"]?.array)
    let cases = try XCTUnwrap(fixture["blends"]?.array)
    XCTAssertEqual(cases.count, 4)
    for item in cases {
      let group = groups[Int(try XCTUnwrap(item["group"]?.number))]
      let selection = try XCTUnwrap(item["selection"]?.array).compactMap { $0.number.map { Int($0) } }
      let position = try XCTUnwrap(item["position"]?.number)
      let layers = try NativeEvaluators.blendLayers(
        group: group, selection: selection, position: position)
      assertMatches(.array(layers), try XCTUnwrap(item["layers"]), "blend \(selection) at \(position)")
      if let light = item["light"] {
        let filled = try NativeEvaluators.fill(
          try XCTUnwrap(group["light"]), position: position, select: selection)
        assertMatches(filled, light, "light \(selection) at \(position)")
      }
    }
  }

  func testEmphasisFillsEachTargetByStrengthAndKeepsAnArea() throws {
    let themes = try XCTUnwrap(fixture["family"]?["themes"]?.array)
    let cases = try XCTUnwrap(fixture["emphasis"]?.array)
    XCTAssertEqual(cases.count, 40)
    for item in cases {
      let theme = themes[Int(try XCTUnwrap(item["theme"]?.number))]
      let targets = try XCTUnwrap(theme["emphasis"]?["targets"]?.array)
      let target = targets[Int(try XCTUnwrap(item["target"]?.number))]
      let value = try NativeEvaluators.emphasize(
        target, t: try XCTUnwrap(item["t"]?.number), keep: item["keep"])
      assertMatches(value, try XCTUnwrap(item["value"]), "\(item)")
    }
  }

  func testThemeSelectionFollowsDefaultSystemAndTimeOfDay() throws {
    let catalog = try XCTUnwrap(fixture["catalog"])
    let themes = Set(try XCTUnwrap(catalog["themes"]?.array).compactMap(\.string))
    let evaluator = NativeEvaluators.ThemeCatalog(
      defaultTheme: try XCTUnwrap(catalog["defaultTheme"]?.string),
      systemThemes: catalog["systemThemes"].flatMap(Self.strings),
      timeOfDay: catalog["timeOfDay"].flatMap { value -> [String: [String: String]]? in
        guard case .object(let families) = value else { return nil }
        return families.compactMapValues(Self.strings)
      }, themes: themes)
    let cases = try XCTUnwrap(fixture["themeSelections"]?.array)
    XCTAssertEqual(cases.count, 11)
    for item in cases {
      let theme = try? NativeEvaluators.theme(
        evaluator, selection: item["selection"]?.string, colorScheme: item["colorScheme"]?.string,
        timeOfDay: item["timeOfDay"]?.string)
      XCTAssertEqual(theme.map(JSONValue.string) ?? .null, item["theme"], "\(item)")
    }
  }

  func testSunsAndRouteInksMixBetweenThemes() throws {
    let suns = try XCTUnwrap(fixture["suns"]?.array)
    XCTAssertEqual(suns.count, 3)
    for item in suns {
      let mixed = NativeEvaluators.mixSuns(
        try XCTUnwrap(item["from"]), try XCTUnwrap(item["to"]), try XCTUnwrap(item["t"]?.number))
      assertMatches(mixed, try XCTUnwrap(item["mixed"]), "\(item)")
    }
    let inks = try XCTUnwrap(fixture["routeInks"]?.array)
    XCTAssertEqual(inks.count, 2)
    for item in inks {
      let mixed = NativeEvaluators.mixRouteInks(
        try XCTUnwrap(item["from"]), try XCTUnwrap(item["to"]), try XCTUnwrap(item["t"]?.number))
      assertMatches(mixed, try XCTUnwrap(item["mixed"]), "\(item)")
    }
  }

  func testThreeDecimalsRoundAsTheWebDoes() {
    XCTAssertEqual(NativeEvaluators.threeDecimals(1), "1")
    XCTAssertEqual(NativeEvaluators.threeDecimals(0.5), "0.5")
    XCTAssertEqual(NativeEvaluators.threeDecimals(0.0625), "0.063")
    XCTAssertEqual(NativeEvaluators.threeDecimals(0.1875), "0.188")
    XCTAssertEqual(NativeEvaluators.threeDecimals(0.0004), "0")
    XCTAssertEqual(NativeEvaluators.threeDecimals(0.50749999), "0.507")
  }

  private static func strings(_ value: JSONValue) -> [String: String]? {
    guard case .object(let object) = value else { return nil }
    return object.compactMapValues(\.string)
  }

  /// Numbers within 1e-9; everything else exactly.
  private func assertMatches(
    _ actual: JSONValue, _ expected: JSONValue, _ message: String, path: String = "$",
    file: StaticString = #filePath, line: UInt = #line
  ) {
    switch (actual, expected) {
    case (.number(let a), .number(let b)):
      XCTAssertEqual(a, b, accuracy: 1e-9, "\(message) at \(path)", file: file, line: line)
    case (.array(let a), .array(let b)):
      guard a.count == b.count else {
        return XCTFail("\(message) at \(path): \(a.count) items, expected \(b.count)", file: file, line: line)
      }
      for (index, (item, other)) in zip(a, b).enumerated() {
        assertMatches(item, other, message, path: "\(path)[\(index)]", file: file, line: line)
      }
    case (.object(let a), .object(let b)):
      guard Set(a.keys) == Set(b.keys) else {
        return XCTFail(
          "\(message) at \(path): keys \(a.keys.sorted()), expected \(b.keys.sorted())", file: file,
          line: line)
      }
      for (key, value) in b {
        assertMatches(a[key]!, value, message, path: "\(path).\(key)", file: file, line: line)
      }
    default:
      XCTAssertEqual(actual, expected, "\(message) at \(path)", file: file, line: line)
    }
  }
}
