import Foundation
import XCTest

@testable import Tileflow

@MainActor
final class HostedSessionTests: XCTestCase {
  private let mapID = "map_0123456789abcdef"
  private let style = URL(
    string: "https://api.tileflow.test/maps/map_0123456789abcdef/mobile/webview-v1/v1/day.json")!
  private let policy = ResourcePolicy(origins: [
    "https://api.tileflow.test", "https://public.example",
  ])

  func testSharedAuthorityAndResourceCases() throws {
    let fixture = try sessionFixture()
    let bytes = try JSONEncoder().encode(fixture["response"])
    let authority = try HostedContract.parse(
      bytes, mapID: mapID, sessionID: "fixture-session", surfaceID: "mobile-map")
    for (key, expected) in [("allowedResources", true), ("deniedResources", false)] {
      guard case .array(let urls) = fixture[key] else { return XCTFail("Missing resource cases") }
      for value in urls {
        let url = try XCTUnwrap(value.string.flatMap(URL.init(string:)))
        XCTAssertEqual(
          HostedContract.permits(url, mapID: mapID, authority: authority), expected,
          url.absoluteString)
      }
    }
    guard case .object(let response) = fixture["response"] else {
      return XCTFail("Missing response")
    }
    for (key, invalid) in [
      ("extra", JSONValue.bool(true)), ("ok", .number(1)), ("version", .bool(true)),
      ("credentialRevision", .number(0)), ("deliveryPolicyRevision", .number(1.5)),
      ("mapId", .string("map_1111111111111111")), ("sessionId", .string("foreign")),
      ("surfaceId", .string("foreign")), ("issuedAt", .string("2026-10-20T13:00:00.000Z")),
      ("expiresAt", .string("2026-10-20T12:15:01.000Z")),
      ("resourceOrigins", .array([.string("https://api.tileflow.test/")])),
      ("resourceScopes", .array([.string("style"), .string("style")])),
      ("grant", .string("bad")),
    ] {
      var mutated = response
      mutated[key] = invalid
      XCTAssertThrowsError(
        try HostedContract.parse(
          JSONEncoder().encode(JSONValue.object(mutated)),
          mapID: mapID, sessionID: "fixture-session", surfaceID: "mobile-map"), key)
    }
    XCTAssertThrowsError(
      try HostedContract.parse(
        Data([0xff]), mapID: mapID, sessionID: "fixture-session", surfaceID: "mobile-map"))
  }

  func testConcurrentAdmissionsUseOneNativeSessionAndNoAuthorityOnPublicResources() async throws {
    let fixture = try sessionFixture()
    let transport = SessionTestTransport { request, _ in
      try await Task.sleep(for: .milliseconds(25))
      return try sessionResponse(fixture, request: request)
    }
    let client = try makeClient()
    XCTAssertFalse(client.description.contains("tf_public_"))
    let session = HostedSession(
      client: client, mapID: mapID, surfaceID: "mobile-map", transport: transport)
    let target = style
    let policy = policy
    try await withThrowingTaskGroup(of: String?.self) { group in
      for _ in 0..<24 {
        group.addTask { try await session.authorize(target, publicPolicy: policy).grant }
      }
      for try await grant in group { XCTAssertNotNil(grant) }
    }
    XCTAssertEqual(transport.requests.count, 1)
    let request = try XCTUnwrap(transport.requests.first)
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.url?.path, "/v1/sessions/start")
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Tileflow-Mobile-Client"))
    for header in ["Origin", "Referer", "Cookie", "Authorization", "X-Tileflow-Native-Grant"] {
      XCTAssertNil(request.value(forHTTPHeaderField: header))
    }
    let publicAdmission = try await session.authorize(
      URL(string: "https://public.example/model.glb")!, publicPolicy: policy)
    XCTAssertNil(publicAdmission.grant)
    session.close()
    do {
      _ = try await session.authorize(target, publicPolicy: policy)
      XCTFail("Retired session admitted a request")
    } catch { XCTAssertEqual(error as? TileflowMapError, .disposed) }
  }

  func testRefreshRetainsIdentityAndAgeRotatesIt() async throws {
    let fixture = try sessionFixture()
    let time = SessionTestClock()
    let transport = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let session = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map",
      transport: transport, now: { time.now })
    defer { session.close() }
    _ = try await session.authorize(style, publicPolicy: policy)
    time.advance(880)
    _ = try await session.authorize(style, publicPolicy: policy)
    time.advance(21_600)
    _ = try await session.authorize(style, publicPolicy: policy)
    let ids = try transport.requests.map {
      try JSONDecoder().decode(JSONValue.self, from: $0.httpBody!)["sessionId"]?.string
    }
    XCTAssertEqual(ids.count, 3)
    XCTAssertEqual(ids[0], ids[1])
    XCTAssertNotEqual(ids[1], ids[2])
  }

  func testInvalidatedGrantRenewsOnceWithinThirtySeconds() async throws {
    let fixture = try sessionFixture()
    let time = SessionTestClock()
    let transport = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let session = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map",
      transport: transport, now: { time.now })
    defer { session.close() }
    let first = try await session.authorize(style, publicPolicy: policy)
    let grant = try XCTUnwrap(first.grant)
    let replaced = await session.invalidate(grant: "tf_native_v1.b3RoZXI.Z3JhbnQ")
    XCTAssertTrue(replaced)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 1)
    let renewed = await session.invalidate(grant: grant)
    XCTAssertTrue(renewed)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 2)
    // The renewed grant is refused again within 30 s: keep it instead of looping bootstrap.
    let looping = await session.invalidate(grant: grant)
    XCTAssertFalse(looping)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 2)
    time.advance(30)
    let later = await session.invalidate(grant: grant)
    XCTAssertTrue(later)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 3)
  }

  func testOnlyExactRestartRotatesOnceAndTerminalFailureDoesNotRetry() async throws {
    let fixture = try sessionFixture()
    let transport = SessionTestTransport { request, index in
      if index == 0 {
        let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
        return ResourcePayload(
          bytes: try JSONEncoder().encode(
            JSONValue.object([
              "code": .string("COMMERCIAL_SESSION_RESTART_REQUIRED"),
              "error": .string("Restart required."),
              "retryWithNewSession": .bool(true), "sessionId": body["sessionId"]!,
            ])), status: 409, headers: [:])
      }
      return try sessionResponse(fixture, request: request)
    }
    let session = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map", transport: transport)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 2)
    XCTAssertNotEqual(transport.requests[0].httpBody, transport.requests[1].httpBody)
    session.close()

    let rejected = SessionTestTransport { _, _ in
      ResourcePayload(bytes: Data(), status: 401, headers: [:])
    }
    let terminal = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map", transport: rejected)
    defer { terminal.close() }
    for _ in 0..<2 {
      do {
        _ = try await terminal.authorize(style, publicPolicy: policy)
        XCTFail("Credential rejection was ignored")
      } catch { XCTAssertEqual(error as? TileflowMapError, .credentialRejected) }
    }
    XCTAssertEqual(rejected.requests.count, 1)
  }

  func testNetworkTimeConsumesGrantLifetimeAndLateResponseCannotReviveClosedSession() async throws {
    let fixture = try sessionFixture()
    let time = SessionTestClock()
    let slow = SessionTestTransport { request, _ in
      time.advance(880)
      return try sessionResponse(fixture, request: request)
    }
    let session = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map",
      transport: slow, now: { time.now })
    do {
      _ = try await session.authorize(style, publicPolicy: policy)
      XCTFail("Expired transport budget was admitted")
    } catch { XCTAssertEqual(error as? TileflowMapError, .sessionUnavailable) }
    session.close()

    let delayed = SessionTestTransport { request, _ in
      try? await Task.sleep(for: .milliseconds(100))
      return try sessionResponse(fixture, request: request)
    }
    let late = HostedSession(
      client: try makeClient(), mapID: mapID, surfaceID: "mobile-map", transport: delayed)
    let pending = Task { try await late.authorize(style, publicPolicy: policy) }
    try await Task.sleep(for: .milliseconds(20))
    late.close()
    do {
      _ = try await pending.value
      XCTFail("Late response revived the session")
    } catch { XCTAssertTrue(error is CancellationError || error as? TileflowMapError == .disposed) }
  }

  func testSharedSessionSequences() async throws {
    for scenario in try sessionSequences().scenarios {
      let fixture = try sessionFixture()
      let time = SessionTestClock()
      let transport = SessionTestTransport { request, index in
        // Each bootstrap takes the next reply; the last one repeats.
        let reply = scenario.responses[min(index, scenario.responses.count - 1)]
        if reply.status == 201, reply.body == nil {
          return try sessionResponse(fixture, request: request)
        }
        return ResourcePayload(
          bytes: try reply.body.map { try JSONEncoder().encode($0) } ?? Data(),
          status: reply.status, headers: reply.headers ?? [:])
      }
      let session = HostedSession(
        client: try makeClient(), mapID: mapID, surfaceID: "mobile-map", transport: transport,
        now: { time.now })
      var identities: [String: String] = [:]
      for step in scenario.steps {
        if step.op == "advance" {
          time.advance(milliseconds: step.milliseconds!)
          continue
        }
        if step.op == "retry" {
          session.retry()
          continue
        }
        if let name = step.error { XCTAssertNotNil(fixtureErrors[name], name) }
        do {
          let admission = try await session.authorize(style, publicPolicy: policy)
          XCTAssertNil(step.error, scenario.name)
          XCTAssertNotNil(admission.grant)
        } catch {
          XCTAssertEqual(
            error as? TileflowMapError, step.error.flatMap { fixtureErrors[$0] }, scenario.name)
        }
        XCTAssertEqual(transport.requests.count, step.requests, scenario.name)
        if let identity = step.identity {
          let body = try JSONDecoder().decode(
            JSONValue.self, from: transport.requests.last!.httpBody!)
          let id = try XCTUnwrap(body["sessionId"]?.string)
          if let expected = identities[identity] {
            XCTAssertEqual(id, expected, scenario.name)
          } else {
            XCTAssertFalse(identities.values.contains(id), scenario.name)
            identities[identity] = id
          }
        }
      }
      session.close()
    }
  }

  func testResourceRejectionRetiresAnInFlightRefreshBeforeItCanReturnAuthority() async throws {
    for rejection in try sessionSequences().resourceRejections {
      let expected = try XCTUnwrap(fixtureErrors[rejection.error])
      guard HostedContract.isTerminal(expected) else { continue }
      let fixture = try sessionFixture()
      let gate = SessionResponseGate()
      let transport = SessionTestTransport { request, _ in
        await gate.enter()
        return try sessionResponse(fixture, request: request)
      }
      let session = HostedSession(
        client: try makeClient(), mapID: mapID, surfaceID: "mobile-map", transport: transport)
      let pending = Task { try await session.authorize(style, publicPolicy: policy) }
      await gate.waitUntilEntered()
      await session.reject(expected)
      await gate.release()
      do {
        _ = try await pending.value
        XCTFail("A late refresh revived a rejected session")
      } catch { XCTAssertEqual(error as? TileflowMapError, expected) }
      do {
        _ = try await session.authorize(style, publicPolicy: policy)
        XCTFail("A rejected session retried")
      } catch { XCTAssertEqual(error as? TileflowMapError, expected) }
      XCTAssertEqual(transport.requests.count, 1)
      session.close()
    }
  }

  func testGrantedResourceFailuresStopTheSessionOnlyWhenTerminal() async throws {
    for rejection in try sessionSequences().resourceRejections {
      let expected = try XCTUnwrap(fixtureErrors[rejection.error])
      let terminal = HostedContract.isTerminal(expected)
      let fixture = try sessionFixture()
      let sessionTransport = SessionTestTransport { request, _ in
        try sessionResponse(fixture, request: request)
      }
      let body = try rejection.body.map { try JSONEncoder().encode($0) } ?? Data()
      let resourceTransport = SessionTestTransport { _, index in
        index == 0
          ? ResourcePayload(bytes: body, status: rejection.status, headers: [:])
          : ResourcePayload(bytes: Data([1]), status: 200, headers: [:])
      }
      let session = HostedSession(
        client: try makeClient(), mapID: mapID, surfaceID: "mobile-map",
        transport: sessionTransport)
      let loader = ResourceLoader(policy: policy, hosted: session, transport: resourceTransport)
      do {
        _ = try await loader.load(URLRequest(url: style))
        XCTFail("A refused resource was returned")
      } catch { XCTAssertEqual(error as? TileflowMapError, expected, rejection.error) }
      do {
        _ = try await loader.load(URLRequest(url: style))
        XCTAssertFalse(terminal, rejection.error)
      } catch {
        XCTAssertTrue(terminal, rejection.error)
        XCTAssertEqual(error as? TileflowMapError, expected, rejection.error)
      }
      XCTAssertEqual(sessionTransport.requests.count, 1, rejection.error)
      if terminal {
        // An explicit retry bootstraps again instead of reusing the refused grant.
        session.retry()
        _ = try await loader.load(URLRequest(url: style))
        XCTAssertEqual(sessionTransport.requests.count, 2, rejection.error)
      }
      XCTAssertEqual(resourceTransport.requests.count, 2, rejection.error)
      loader.close()
      session.close()
    }
  }

  func testFailureClassificationAndRetryAfter() {
    let quota = Data(#"{"code":"COMMERCIAL_MAP_LIMIT_REACHED","error":"Limit reached"}"#.utf8)
    let limiter = Data(#"{"error":"Too many requests","requestId":"req_1"}"#.utf8)
    for (status, body, expected) in [
      (401, Data(), TileflowMapError.credentialRejected), (403, Data(), .accessDenied),
      (404, Data(), .accessDenied), (429, quota, .quotaExceeded), (429, limiter, .rateLimited),
      (429, Data("<html>".utf8), .rateLimited), (408, Data(), .sessionUnavailable),
      (502, Data(), .sessionUnavailable), (400, Data(), .invalidSessionResponse),
      (409, Data(), .invalidSessionResponse),
    ] {
      XCTAssertEqual(HostedContract.failure(status: status, body: body), expected, "\(status)")
    }
    // Wed, 21 Oct 2015 07:28:00 GMT
    let now = Date(timeIntervalSince1970: 1_445_412_480)
    XCTAssertEqual(HostedContract.retryAfter("60", now: now), 60)
    XCTAssertEqual(HostedContract.retryAfter(" 5 ", now: now), 5)
    XCTAssertEqual(HostedContract.retryAfter("Wed, 21 Oct 2015 07:30:00 GMT", now: now), 120)
    XCTAssertEqual(HostedContract.retryAfter("Wed, 21 Oct 2015 07:00:00 GMT", now: now), 0)
    XCTAssertEqual(HostedContract.retryAfter("86400", now: now), 900)
    for invalid in [nil, "", "-1", "1.5", "soon", String(repeating: "1", count: 65)] {
      XCTAssertNil(HostedContract.retryAfter(invalid, now: now), invalid ?? "nil")
    }
  }

  func testPublicMetadataAndThirdPartyBytesUseTheProviderWithoutGrantLeakage() async throws {
    let fixture = try sessionFixture()
    let client = try makeClient()
    let source = try client.map(
      mapID, surfaceID: "mobile-map",
      publicResourceOrigins: [URL(string: "https://public.example")!])
    let sessionTransport = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let resourceTransport = SessionTestTransport { _, _ in
      ResourcePayload(bytes: Data([1, 2]), status: 200, headers: [:])
    }
    let session = HostedSession(
      client: client, mapID: mapID, surfaceID: "mobile-map", transport: sessionTransport)
    let loader = ResourceLoader(
      policy: try source.policy(), hosted: session, publicMetadataURLs: source.publicMetadataURLs,
      transport: resourceTransport)
    defer {
      loader.close()
      session.close()
    }
    for url in source.publicMetadataURLs { _ = try await loader.load(URLRequest(url: url)) }
    XCTAssertEqual(sessionTransport.requests.count, 0)
    _ = try await loader.load(URLRequest(url: style))
    let publicURL = URL(string: "https://public.example/tile.pbf")!
    var request = URLRequest(url: publicURL)
    request.setValue("untrusted", forHTTPHeaderField: "Authorization")
    request.setValue("untrusted", forHTTPHeaderField: "X-Tileflow-Native-Grant")
    _ = try await loader.load(request)
    XCTAssertEqual(sessionTransport.requests.count, 1)
    XCTAssertEqual(resourceTransport.requests.count, 4)
    for request in resourceTransport.requests {
      XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
      XCTAssertNil(request.value(forHTTPHeaderField: "X-Tileflow-Mobile-Client"))
      XCTAssertEqual(
        request.value(forHTTPHeaderField: "X-Tileflow-Native-Grant") != nil, request.url == style)
    }
    for url in [
      source.manifestURL.appending(queryItems: [URLQueryItem(name: "key", value: "x")]),
      URL(string: "https://foreign.example/tile.pbf")!,
    ] {
      do {
        _ = try await loader.load(URLRequest(url: url))
        XCTFail("Invalid authority reached transport")
      } catch {}
    }
    XCTAssertEqual(resourceTransport.requests.count, 4)
  }

  private func makeClient() throws -> TileflowClient {
    try TileflowClient(
      apiOrigin: URL(string: "https://api.tileflow.test")!,
      mobileCredential: "tf_public_" + String(repeating: "a", count: 48))
  }
}

private let fixtureErrors: [String: TileflowMapError] = [
  "credentialRejected": .credentialRejected, "accessDenied": .accessDenied,
  "quotaExceeded": .quotaExceeded, "rateLimited": .rateLimited,
  "sessionUnavailable": .sessionUnavailable, "invalidSessionResponse": .invalidSessionResponse,
]

private func sessionSequences() throws -> SessionSequences {
  let url = Bundle.module.url(
    forResource: "session-sequences", withExtension: "json", subdirectory: "Fixtures")!
  return try JSONDecoder().decode(SessionSequences.self, from: Data(contentsOf: url))
}

private func sessionFixture() throws -> JSONValue {
  let url = Bundle.module.url(
    forResource: "native-session", withExtension: "json", subdirectory: "Fixtures")!
  return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
}

private func sessionResponse(_ fixture: JSONValue, request: URLRequest) throws -> ResourcePayload {
  guard case .object(var response) = fixture["response"] else {
    throw TileflowMapError.invalidSessionResponse
  }
  let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
  response["sessionId"] = body["sessionId"]
  return ResourcePayload(
    bytes: try JSONEncoder().encode(JSONValue.object(response)), status: 201, headers: [:])
}

private final class SessionTestTransport: NativeHTTPTransporting, @unchecked Sendable {
  private let lock = NSLock()
  private var captured: [URLRequest] = []
  private let response: @Sendable (URLRequest, Int) async throws -> ResourcePayload
  init(_ response: @escaping @Sendable (URLRequest, Int) async throws -> ResourcePayload) {
    self.response = response
  }
  var requests: [URLRequest] { lock.withLock { captured } }
  func send(_ request: URLRequest) async throws -> ResourcePayload {
    let index = lock.withLock {
      let index = captured.count
      captured.append(request)
      return index
    }
    return try await response(request, index)
  }
  func close() {}
}

private final class SessionTestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var value = ContinuousClock.now
  var now: ContinuousClock.Instant { lock.withLock { value } }
  func advance(_ seconds: Double) {
    lock.withLock { value = value.advanced(by: .seconds(seconds)) }
  }
  func advance(milliseconds: Int) {
    lock.withLock { value = value.advanced(by: .milliseconds(milliseconds)) }
  }
}

private struct SessionSequences: Decodable {
  struct Scenario: Decodable, Sendable {
    struct Step: Decodable, Sendable {
      let op: String
      let milliseconds: Int?
      let requests: Int?
      let identity: String?
      let error: String?
    }
    struct Reply: Decodable, Sendable {
      let status: Int
      let body: JSONValue?
      let headers: [String: String]?
    }
    let name: String
    let responses: [Reply]
    let steps: [Step]
  }
  struct Rejection: Decodable, Sendable {
    let status: Int
    let body: JSONValue?
    let error: String
  }
  let scenarios: [Scenario]
  let resourceRejections: [Rejection]
}

private actor SessionResponseGate {
  private var entered = false
  private var started: CheckedContinuation<Void, Never>?
  private var waiting: CheckedContinuation<Void, Never>?
  func enter() async {
    entered = true
    started?.resume()
    started = nil
    await withCheckedContinuation { waiting = $0 }
  }
  func waitUntilEntered() async {
    if !entered { await withCheckedContinuation { started = $0 } }
  }
  func release() {
    waiting?.resume()
    waiting = nil
  }
}
