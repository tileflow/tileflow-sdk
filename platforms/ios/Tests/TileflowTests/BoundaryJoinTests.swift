import Foundation
import XCTest

@testable import Tileflow

final class BoundaryJoinTests: XCTestCase {
  func testSharedCoreJoinVectors() throws {
    let fixture = try JSONDecoder().decode(JSONValue.self, from: fixtureData())
    let vectors = try XCTUnwrap(fixture["cases"]?.array)
    XCTAssertFalse(vectors.isEmpty)

    for vector in vectors {
      let name = vector["name"]?.string ?? "unnamed"
      do {
        let lookupRows: [TileflowBoundaryLookupRow]?
        if let csv = vector["csv"]?.string {
          let parsed = try parseBoundaryLookupCsv(csv)
          if let expected = vector["parsed"] {
            XCTAssertEqual(try .encoded(parsed), expected, name)
          }
          lookupRows = parsed
        } else if let lookup = vector["lookup"] {
          let raw = lookup.string.flatMap { fixture["lookups"]?[$0] } ?? lookup
          lookupRows = try JSONDecoder().decode(
            [TileflowBoundaryLookupRow].self, from: JSONEncoder().encode(raw))
        } else {
          lookupRows = nil
        }

        let options = try XCTUnwrap(vector["options"], name)
        let code = try XCTUnwrap(options["joinBy"]?.string.flatMap(TileflowBoundaryCode.init), name)
        let target = try XCTUnwrap(
          TileflowBoundaryTarget(rawValue: options["to"]?.string ?? "id"), name)
        let classes = try options["classes"]?.array.map { values in
          try values.map { value in
            try XCTUnwrap(value.string.flatMap(TileflowBoundaryClass.init), name)
          }
        }
        let lookup = try lookupRows.map { try TileflowBoundaryLookup(rows: $0) }
        let result = try joinBoundaryRows(
          try rows(vector["rows"]),
          options: .init(joinBy: code, to: target, classes: classes, lookup: lookup))
        XCTAssertNil(vector["error"], "\(name): expected rejection")
        let expected = try XCTUnwrap(vector["expected"], name)
        XCTAssertEqual(result.joinBy.rawValue, expected["joinBy"]?.string, name)
        XCTAssertEqual(result.rows, try rows(expected["rows"]), name)
        XCTAssertEqual(result.duplicates, try keys(expected["duplicates"]), name)
        XCTAssertEqual(result.ambiguous, try keys(expected["ambiguous"]), name)
        XCTAssertEqual(result.unmatched, try keys(expected["unmatched"]), name)
      } catch {
        if vector["error"] == nil { XCTFail("\(name): \(error)") }
      }
    }
  }

  func testNullValueClearsPreviousValuesThroughReplacement() throws {
    let result = try joinBoundaryRows(
      [.init(key: 1, value: 4), .init(key: 1, value: nil), .init(key: 2, value: "high")],
      options: .init(joinBy: .id))
    XCTAssertEqual(result.rows, [.init(key: 1, value: nil), .init(key: 2, value: "high")])
    XCTAssertEqual(
      result.values(labels: true, state: "share"),
      TileflowBoundaryValues(ids: [2: "high"], labels: true, state: "share"))
  }

  func testCSVQuotingCRLFAndNumericContracts() throws {
    let csv =
      "id,class,class_tier,admin_level,name,ignored\r\n"
      + "0x65,municipality,primary,8,\"Móstoles, \"\"Madrid\"\"\r\ncentro\",unused\r\n"
    let parsed = try parseBoundaryLookupCsv(csv)
    XCTAssertEqual(parsed.count, 1)
    XCTAssertEqual(parsed[0].id, 101)
    XCTAssertEqual(parsed[0].name, "Móstoles, \"Madrid\"\r\ncentro")
    XCTAssertEqual(parsed[0].adminLevel, 8)
    XCTAssertThrowsError(try parseBoundaryLookupCsv("id,class\n1,\"region"))
    XCTAssertThrowsError(try parseBoundaryLookupCsv("id,class\n1"))
    XCTAssertThrowsError(try parseBoundaryLookupCsv("id,class\n1.5,region"))
    XCTAssertThrowsError(try parseBoundaryLookupCsv("id,class,class_tier\n1,region,other"))
  }

  private func fixtureData() throws -> Data {
    #if SWIFT_PACKAGE
      let bundle = Bundle.module
    #else
      let bundle = Bundle(for: BoundaryJoinTests.self)
    #endif
    let url = try XCTUnwrap(
      bundle.url(forResource: "boundary-joins", withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
  }

  private func rows(_ value: JSONValue?) throws -> [TileflowBoundaryRow] {
    try XCTUnwrap(value?.array).map { row in
      let key = try decodeKey(XCTUnwrap(row["key"]))
      let value: TileflowBoundaryValue?
      switch row["value"] {
      case .number(let number): value = .number(number)
      case .string(let string): value = .category(string)
      case .null: value = nil
      default: throw TileflowBoundaryJoinError.invalidCSV
      }
      return .init(key: key, value: value)
    }
  }

  private func keys(_ value: JSONValue?) throws -> [TileflowBoundaryKey] {
    try XCTUnwrap(value?.array).map(decodeKey)
  }

  private func decodeKey(_ value: JSONValue) throws -> TileflowBoundaryKey {
    try JSONDecoder().decode(TileflowBoundaryKey.self, from: JSONEncoder().encode(value))
  }
}
