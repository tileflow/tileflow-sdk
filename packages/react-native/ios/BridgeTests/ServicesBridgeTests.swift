import Foundation
import TileflowConfiguration
import TileflowElevation
import TileflowGeoIP
import TileflowRouting
import TileflowSearch
import XCTest

@testable import TileflowReactNativeBridge

/// Serves the service contract's answers and records request bodies, without the network.
final class ContractStub: URLProtocol, @unchecked Sendable {
  struct Answer {
    var status = 200
    var body = Data()
  }

  nonisolated(unsafe) static var answer = Answer()
  nonisolated(unsafe) static var bodies: [Data?] = []

  static func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ContractStub.self]
    return URLSession(configuration: configuration)
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    var body = request.httpBody
    if body == nil, let stream = request.httpBodyStream {
      stream.open()
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count <= 0 { break }
        data.append(buffer, count: count)
      }
      stream.close()
      body = data
    }
    Self.bodies.append(body)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: Self.answer.status, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.answer.body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

enum Fixtures {
  static let repository = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().appendingPathComponent("../../../..").standardizedFileURL

  static func json(_ path: String) throws -> [String: Any] {
    let data = try Data(contentsOf: repository.appendingPathComponent(path))
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
  }

  static let contractPath =
    "platforms/ios/Tests/TileflowServiceTests/Fixtures/service-contract.json"
  static let bridgePath = "packages/react-native/test/native/bridge-contract.json"

  /// Canonical JSON text, so that objects compare whatever their key order and number types.
  static func canonical(_ value: Any) -> String {
    let data = try! JSONSerialization.data(
      withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed])
    let reparsed = try! JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
    return String(
      data: try! JSONSerialization.data(
        withJSONObject: reparsed, options: [.sortedKeys, .fragmentsAllowed]), encoding: .utf8)!
  }
}

final class ServicesBridgeTests: XCTestCase {
  private var contract: [String: Any] = [:]
  private var clients: ServiceClients!

  override func setUpWithError() throws {
    contract = try Fixtures.json(Fixtures.contractPath)
    let apps = contract["apps"] as! [String: [String: Any]]
    let configuration = try TileflowConfiguration(
      apiOrigin: URL(string: "https://api.example.test")!,
      servicesCredential: TileflowCredential(contract["credential"] as! String),
      app: TileflowAppIdentity(id: apps["ios"]!["id"] as! String))
    let session = ContractStub.session()
    clients = ServiceClients(
      search: TileflowSearch(configuration: configuration, session: session),
      routing: TileflowRouting(configuration: configuration, session: session),
      elevation: TileflowElevation(configuration: configuration, session: session),
      geoIP: TileflowGeoIP(configuration: configuration, session: session))
  }

  private func serve(_ operation: [String: Any]) throws {
    ContractStub.bodies = []
    ContractStub.answer = .init(
      status: operation["status"] as? Int ?? 200,
      body: try JSONSerialization.data(withJSONObject: operation["response"]!))
  }

  /// Each bridge request sends the contract's request body, and its answer reaches JavaScript as
  /// the shared fixture records it. The Kotlin bridge test checks the same fixture.
  func testEveryOperationMatchesTheSharedFixture() async throws {
    let bridge = try Fixtures.json(Fixtures.bridgePath)
    let operations = contract["operations"] as! [String: [String: Any]]
    var recorded = bridge
    var entries = bridge["operations"] as! [String: [String: Any]]
    var missing = false
    for name in entries.keys.sorted() {
      var entry = entries[name]!
      let operation = operations[name]!
      try serve(operation)
      let result: Any
      do {
        result = try await ServicesBridge.call(
          service: entry["service"] as! String, operation: entry["operation"] as! String,
          request: entry["request"], clients: clients)
      } catch {
        result = ["rejected": ["code": error.code, "message": error.message, "info": error.info]]
      }
      let sent = ContractStub.bodies.first ?? nil
      let expectedBody = operation["request"].flatMap { $0 is NSNull ? nil : $0 }
      if let expectedBody {
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(sent, name))
        XCTAssertEqual(Fixtures.canonical(body), Fixtures.canonical(expectedBody), name)
      }
      if let expected = entry["answer"] {
        XCTAssertEqual(Fixtures.canonical(result), Fixtures.canonical(expected), name)
      } else {
        missing = true
        entry["answer"] = result
        entries[name] = entry
      }
    }
    if missing {
      recorded["operations"] = entries
      let output = Fixtures.repository.appendingPathComponent(
        Fixtures.bridgePath.replacingOccurrences(of: ".json", with: ".recorded.json"))
      try JSONSerialization.data(withJSONObject: recorded, options: [.prettyPrinted, .sortedKeys])
        .write(to: output)
      XCTFail("Recorded missing answers to \(output.path); review them and copy the file.")
    }
  }

  func testServiceErrorsReachJavaScriptWithTheirFields() async throws {
    let errors = contract["errors"] as! [[String: Any]]
    let route = try XCTUnwrap(errors.first { $0["operation"] as? String == "routing.route" })
    ContractStub.answer = .init(
      status: route["status"] as! Int, body: try JSONSerialization.data(withJSONObject: route["body"]!))
    do {
      _ = try await ServicesBridge.call(
        service: "routing", operation: "route",
        request: ["locations": [[-80.2, 25.7], [-80.1, 25.8]], "mode": "driving"],
        clients: clients)
      XCTFail("The route was refused.")
    } catch {
      XCTAssertEqual(error.code, "ROUTING_NO_ROUTE")
      XCTAssertEqual(error.message, "No route connects these locations.")
      XCTAssertEqual(
        Fixtures.canonical(error.info),
        Fixtures.canonical([
          "kind": "rejected", "code": "ROUTING_NO_ROUTE", "status": 422, "requestId": "req_01J9",
        ]))
    }
  }

  func testMalformedArgumentsNameTheFieldAndSendNothing() async {
    ContractStub.bodies = []
    do {
      _ = try await ServicesBridge.call(
        service: "search", operation: "geocode", request: ["query": "Sol", "proximity": [1]],
        clients: clients)
      XCTFail("The request was malformed.")
    } catch {
      XCTAssertEqual(error.code, "invalidRequest")
      XCTAssertEqual(error.message, "request.proximity must be [longitude, latitude]")
      XCTAssertEqual(error.info["kind"] as? String, "invalidRequest")
    }
    do {
      _ = try await ServicesBridge.call(
        service: "routing", operation: "teleport", request: [:], clients: clients)
      XCTFail("The operation does not exist.")
    } catch {
      XCTAssertEqual(error.code, "invalidRequest")
    }
    XCTAssertTrue(ContractStub.bodies.isEmpty)
  }

  func testConfiguredServicesReportPresenceOnly() throws {
    let configuration = try TileflowConfiguration(
      apiOrigin: URL(string: "https://api.example.test")!,
      searchCredential: TileflowCredential(contract["credential"] as! String))
    let configured = ServicesBridge.configuredServices { configuration }
    XCTAssertEqual(
      configured,
      ["map": false, "search": true, "routing": false, "elevation": false, "geoip": false])
    XCTAssertEqual(
      ServicesBridge.configuredServices { throw TileflowConfigurationError.invalidAPIOrigin },
      ["map": false, "search": false, "routing": false, "elevation": false, "geoip": false])
  }

  func testPropertyNamesBecomeJavaScriptKeys() {
    XCTAssertEqual(BridgeJSON.key("queryID"), "queryId")
    XCTAssertEqual(BridgeJSON.key("isEUCountry"), "isEuCountry")
    XCTAssertEqual(BridgeJSON.key("wayID"), "wayId")
    XCTAssertEqual(BridgeJSON.key("url"), "url")
    XCTAssertEqual(BridgeJSON.key("houseNumber"), "houseNumber")
  }
}
