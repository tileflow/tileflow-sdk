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
    for (key, expected) in [("publicResources", true), ("nonPublicResources", false)] {
      guard case .array(let urls) = fixture[key] else { return XCTFail("Missing public cases") }
      for value in urls {
        let url = try XCTUnwrap(value.string.flatMap(URL.init(string:)))
        XCTAssertEqual(HostedContract.isPublicAPIResource(url), expected, url.absoluteString)
      }
    }
    guard case .array(let redirects) = fixture["redirects"] else {
      return XCTFail("Missing redirect cases")
    }
    for redirect in redirects {
      let from = try XCTUnwrap(redirect["from"]?.string.flatMap(URL.init(string:)))
      XCTAssertEqual(
        HostedContract.redirect(
          from: from, location: redirect["location"]?.string,
          apiOrigin: URL(string: "https://api.tileflow.test")!)?.absoluteString,
        redirect["target"]?.string, redirect["location"]?.string ?? "")
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
    let endpoint = try makeEndpoint()
    for text in [String(reflecting: endpoint), dumped(endpoint)] {
      XCTAssertFalse(text.contains(mapCredential.dropFirst(10)), text)
    }
    let session = HostedSession(
      endpoint: endpoint, mapID: mapID, surfaceID: "mobile-map", transport: transport)
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
    XCTAssertEqual(request.value(forHTTPHeaderField: "X-Tileflow-Mobile-Client"), mapCredential)
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
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map",
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
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map",
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

  func testHiddenSessionHoldsBootstrapsUntilVisibleAndKeepsAValidGrant() async throws {
    let fixture = try sessionFixture()
    let time = SessionTestClock()
    let transport = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let session = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map",
      transport: transport, now: { time.now })
    defer { session.close() }
    // Quick toggles keep the latest visibility.
    session.setBackgrounded(true)
    session.setBackgrounded(false)
    session.setBackgrounded(true)
    let target = style
    let policy = policy
    let pending = Task { try await session.authorize(target, publicPolicy: policy) }
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertEqual(transport.requests.count, 0)
    session.setBackgrounded(false)
    let admission = try await pending.value
    XCTAssertNotNil(admission.grant)
    XCTAssertEqual(transport.requests.count, 1)
    // While hidden, a still-valid grant keeps admitting even inside its renewal margin.
    session.setBackgrounded(true)
    time.advance(880)
    let held = try await session.authorize(style, publicPolicy: policy)
    XCTAssertNotNil(held.grant)
    XCTAssertEqual(transport.requests.count, 1)

    let brief = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map",
      transport: transport, now: { time.now }, waitBudget: .milliseconds(100))
    defer { brief.close() }
    brief.setBackgrounded(true)
    do {
      _ = try await brief.authorize(style, publicPolicy: policy)
      XCTFail("A hidden session bootstrapped")
    } catch { XCTAssertEqual(error as? TileflowMapError, .notReady) }
    XCTAssertEqual(transport.requests.count, 1)
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
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: transport)
    _ = try await session.authorize(style, publicPolicy: policy)
    XCTAssertEqual(transport.requests.count, 2)
    XCTAssertNotEqual(transport.requests[0].httpBody, transport.requests[1].httpBody)
    session.close()

    let rejected = SessionTestTransport { _, _ in
      ResourcePayload(bytes: Data(), status: 401, headers: [:])
    }
    let terminal = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: rejected)
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
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map",
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
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: delayed)
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
        // A `"$request"` session ID stands for the ID of the request the reply answers.
        var body = reply.body
        if case .object(var object) = body, object["sessionId"]?.string == "$request" {
          object["sessionId"] =
            try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)["sessionId"]
          body = .object(object)
        }
        return ResourcePayload(
          bytes: try body.map { try JSONEncoder().encode($0) } ?? Data(),
          status: reply.status, headers: reply.headers ?? [:])
      }
      let session = HostedSession(
        endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: transport,
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
        // Fixture error names are the codes of the shared error taxonomy.
        if let name = step.error { XCTAssertNotNil(TileflowMapError.Code(rawValue: name), name) }
        do {
          let admission = try await session.authorize(style, publicPolicy: policy)
          XCTAssertNil(step.error, scenario.name)
          XCTAssertNotNil(admission.grant)
        } catch {
          let failure = error as? TileflowMapError
          XCTAssertEqual(failure?.code.rawValue, step.error, scenario.name)
          XCTAssertEqual(failure?.context.reason, step.reason, scenario.name)
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

  func testALoopbackHTTPAPIGrantsLoopbackResourcesAndNoOtherAPIDoes() async throws {
    let fixture = try sessionFixture()
    guard case .object(var response) = fixture["response"] else {
      return XCTFail("Missing response")
    }
    response["resourceOrigins"] = .array([.string("http://127.0.0.1:8787")])
    let local = response
    let transport = SessionTestTransport { request, _ in
      var body = local
      body["sessionId"] = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)[
        "sessionId"]
      return ResourcePayload(
        bytes: try JSONEncoder().encode(JSONValue.object(body)), status: 201, headers: [:])
    }
    let endpoint = try HostedEndpoint(
      TileflowConfiguration(
        apiOrigin: URL(string: "http://127.0.0.1:8787")!,
        mapCredential: TileflowCredential(mapCredential)))
    XCTAssertTrue(endpoint.isLoopbackHTTP)
    XCTAssertEqual(
      try endpoint.sessionRequest(mapID: mapID, sessionID: "s", surfaceID: "mobile-map").url?
        .absoluteString, "http://127.0.0.1:8787/v1/sessions/start")
    let session = HostedSession(
      endpoint: endpoint, mapID: mapID, surfaceID: "mobile-map", transport: transport)
    let localStyle = URL(
      string: "http://127.0.0.1:8787/maps/\(mapID)/mobile/webview-v1/v1/day.json")!
    let admission = try await session.authorize(
      localStyle,
      publicPolicy: ResourcePolicy(origins: ["http://127.0.0.1:8787"], allowsLoopbackHTTP: true))
    XCTAssertNotNil(admission.grant)
    session.close()

    // An HTTPS API never grants an HTTP origin.
    let remote = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: transport)
    defer { remote.close() }
    do {
      _ = try await remote.authorize(style, publicPolicy: policy)
      XCTFail("An HTTPS API granted an HTTP resource origin")
    } catch { XCTAssertEqual(error as? TileflowMapError, .invalidSessionResponse) }

    // A local API grants only loopback HTTP origins in the configuration's canonical form.
    response["sessionId"] = .string("fixture-session")
    for origin in [
      "http://localhost:8787", "http://api.example.test", "http://10.0.2.2:8787",
      "http://127.0.0.1:8787/", "http://127.0.0.1:80", "HTTP://127.0.0.1:8787",
    ] {
      response["resourceOrigins"] = .array([.string(origin)])
      let parsed = try? HostedContract.parse(
        JSONEncoder().encode(JSONValue.object(response)), mapID: mapID,
        sessionID: "fixture-session", surfaceID: "mobile-map", allowsLoopbackHTTP: true)
      XCTAssertEqual(parsed != nil, origin == "http://localhost:8787", origin)
    }
  }

  func testResourceRejectionRetiresAnInFlightRefreshBeforeItCanReturnAuthority() async throws {
    for expected in [TileflowMapError.credentialRejected, .accessDenied, .quotaExceeded] {
      let fixture = try sessionFixture()
      let gate = SessionResponseGate()
      let transport = SessionTestTransport { request, _ in
        await gate.enter()
        return try sessionResponse(fixture, request: request)
      }
      let session = HostedSession(
        endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: transport)
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

  func testSharedResourceReactions() throws {
    let tile = URL(string: "https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")!
    for reaction in try sessionSequences().resourceReactions {
      let body = try JSONEncoder().encode(
        JSONValue.object(reaction.code.map { ["code": .string($0)] } ?? [:]))
      XCTAssertEqual(
        HostedContract.reaction(
          status: reaction.status, body: body,
          url: reaction.resource == "style" ? style : tile, refreshed: reaction.refreshed ?? false),
        [
          "none": ResourceReaction.none, "refresh": .refresh, "superseded": .superseded,
          "rateLimited": .rateLimited, "quota": .quota,
        ][reaction.reaction], "\(reaction)")
    }
    let body = try JSONEncoder().encode(
      JSONValue.object(["code": .string("NATIVE_GRANT_STALE"), "error": .string("Stale")]))
    XCTAssertEqual(HostedContract.errorCode(body), "NATIVE_GRANT_STALE")
    XCTAssertNil(HostedContract.errorCode(Data("<html>".utf8)))
  }

  func testResourceRejectionsRenewOnceAndNeverEndTheSession() async throws {
    let fixture = try sessionFixture()
    let sessions = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let tile = URL(string: "https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")!
    let statuses = StatusSequence([401, 200, 403, 200])
    let resources = SessionTestTransport { _, _ in
      ResourcePayload(
        bytes: try JSONEncoder().encode(JSONValue.object(["code": .string("UNSPECIFIED")])),
        status: statuses.next(), headers: [:])
    }
    let session = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: sessions)
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: ["https://api.tileflow.test", "https://tiles.tileflow.test"]),
      hosted: session, transport: resources)
    defer {
      loader.close()
      session.close()
    }
    // A stale grant is renewed once and the request retried with the new grant.
    let renewed = try await loader.load(URLRequest(url: tile)).status
    XCTAssertEqual(renewed, 200)
    XCTAssertEqual(sessions.requests.count, 2)
    // A rejection that renewal cannot repair reaches the renderer; the session continues.
    let unrepaired = try await loader.load(URLRequest(url: tile)).status
    XCTAssertEqual(unrepaired, 403)
    XCTAssertEqual(sessions.requests.count, 2, "Renewal is not repeated within its window")
    let later = try await loader.load(URLRequest(url: tile)).status
    XCTAssertEqual(later, 200)
    XCTAssertEqual(resources.requests.count, 4)
    for request in resources.requests {
      XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Tileflow-Native-Grant"))
    }
  }

  func testRateLimitedResourceWaitsForRetryAfterAndOnlyQuotaStopsTheSession() async throws {
    let fixture = try sessionFixture()
    let time = SessionTestClock()
    let start = time.now
    let sessions = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let statuses = StatusSequence([429, 200])
    let resources = SessionTestTransport { _, _ in
      ResourcePayload(
        bytes: try JSONEncoder().encode(JSONValue.object(["code": .string("RATE_LIMITED")])),
        status: statuses.next(), headers: ["Retry-After": "4"])
    }
    let session = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: sessions)
    let loader = ResourceLoader(
      policy: policy, hosted: session, transport: resources, now: { time.now },
      pause: { time.advance(Double($0.components.seconds)) })
    defer {
      loader.close()
      session.close()
    }
    let retried = try await loader.load(URLRequest(url: style)).status
    XCTAssertEqual(retried, 200)
    XCTAssertEqual(start.duration(to: time.now), .seconds(4))
    XCTAssertEqual(resources.requests.count, 2)

    let quota = SessionTestTransport { _, index in
      index == 0
        ? ResourcePayload(
          bytes: try JSONEncoder().encode(
            JSONValue.object(["code": .string("COMMERCIAL_SPENDING_LIMIT_REACHED")])),
          status: 429, headers: [:])
        : ResourcePayload(bytes: Data([1]), status: 200, headers: [:])
    }
    let exhausted = ResourceLoader(policy: policy, hosted: session, transport: quota)
    defer { exhausted.close() }
    do {
      _ = try await exhausted.load(URLRequest(url: style))
      XCTFail("A quota rejection was retried")
    } catch { XCTAssertEqual(error as? TileflowMapError, .quotaExceeded) }
    do {
      _ = try await exhausted.load(URLRequest(url: style))
      XCTFail("An exhausted session admitted a request")
    } catch { XCTAssertEqual(error as? TileflowMapError, .quotaExceeded) }
    // An explicit retry bootstraps again instead of reusing the refused grant.
    session.retry()
    _ = try await exhausted.load(URLRequest(url: style))
    XCTAssertEqual(sessions.requests.count, 2)
  }

  func testSupersededStyleAsksForOneReloadAndOtherwiseReachesTheRenderer() async throws {
    let fixture = try sessionFixture()
    let sessions = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let resources = SessionTestTransport { _, _ in
      ResourcePayload(
        bytes: try JSONEncoder().encode(
          JSONValue.object(["code": .string("NATIVE_DEPLOYMENT_SUPERSEDED")])),
        status: 409, headers: [:])
    }
    let session = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: sessions)
    let reloads = StatusSequence([])
    let loader = ResourceLoader(
      policy: policy, hosted: session, transport: resources,
      onDeploymentSuperseded: {
        reloads.record()
        return false
      })
    defer {
      loader.close()
      session.close()
    }
    let superseded = try await loader.load(URLRequest(url: style)).status
    XCTAssertEqual(superseded, 409)
    XCTAssertEqual(reloads.count, 1)
    XCTAssertEqual(sessions.requests.count, 1)
  }

  func testTeamModelRedirectIsFollowedOnceWithoutAGrant() async throws {
    let fixture = try sessionFixture()
    let sessions = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let version = "/team-models/tmd_0123456789abcdef/versions/tmv_0123456789abcdef.glb"
    let resources = SessionTestTransport { request, _ in
      request.url?.path == version
        ? ResourcePayload(bytes: Data([1]), status: 200, headers: [:])
        : ResourcePayload(bytes: Data(), status: 302, headers: ["Location": version])
    }
    let session = HostedSession(
      endpoint: try makeEndpoint(), mapID: mapID, surfaceID: "mobile-map", transport: sessions)
    let loader = ResourceLoader(
      policy: policy, hosted: session, apiOrigin: URL(string: "https://api.tileflow.test")!,
      transport: resources)
    defer {
      loader.close()
      session.close()
    }
    let model = URL(
      string: "https://api.tileflow.test/team-models/tmd_0123456789abcdef/current.glb")!
    let modelBytes = try await loader.load(URLRequest(url: model)).bytes
    XCTAssertEqual(modelBytes, Data([1]))
    XCTAssertEqual(resources.requests.map(\.url?.path), [model.path, version])
    for request in resources.requests {
      XCTAssertNil(request.value(forHTTPHeaderField: "X-Tileflow-Native-Grant"))
    }
    XCTAssertEqual(sessions.requests.count, 0, "Public Hosted resources need no session")
    do {
      _ = try await loader.load(
        URLRequest(url: URL(string: "https://api.tileflow.test/landmarks/tiles.json")!))
      XCTFail("A redirect outside a Team model's address was followed")
    } catch { XCTAssertEqual(error as? ResourceError, .invalidResponse) }
  }

  func testFailureClassificationAndRetryAfter() {
    let quota = Data(#"{"code":"COMMERCIAL_MAP_LIMIT_REACHED","error":"Limit reached"}"#.utf8)
    let limiter = Data(#"{"error":"Too many requests","requestId":"req_1"}"#.utf8)
    let mode = Data(#"{"code":"MOBILE_SESSION_MODE_REQUIRED","error":"Session mode"}"#.utf8)
    let large = Data(#"{"code":"MOBILE_SESSION_BODY_TOO_LARGE","error":"Too large"}"#.utf8)
    for (status, body, expected) in [
      (401, Data(), TileflowMapError.credentialRejected), (403, Data(), .accessDenied),
      (404, Data(), .accessDenied), (429, quota, .quotaExceeded), (429, limiter, .rateLimited),
      (429, Data("<html>".utf8), .rateLimited), (408, Data(), .sessionUnavailable),
      (502, Data(), .sessionUnavailable),
      (400, mode, .sessionRejected), (413, large, .sessionRejected),
      (400, Data(), .sessionRejected), (409, Data(), .sessionRejected),
      (451, Data("<html>".utf8), .sessionRejected),
      (302, Data(), .invalidSessionResponse), (200, Data(), .invalidSessionResponse),
    ] {
      let failure = HostedContract.failure(status: status, body: body)
      XCTAssertEqual(failure, expected, "\(status)")
      XCTAssertEqual(
        HostedContract.isTerminal(failure),
        [401, 403, 404, 400, 409, 413, 451].contains(status) || expected == .quotaExceeded,
        "\(status)")
      XCTAssertEqual(HostedContract.isTerminal(failure), !failure.isRecoverable, "\(status)")
    }
    // A refusal carries the service's code, when well formed, and the HTTP status.
    for (status, body, reason) in [
      (400, mode, "MOBILE_SESSION_MODE_REQUIRED"), (413, large, "MOBILE_SESSION_BODY_TOO_LARGE"),
      (400, Data(), nil), (400, Data(#"{"code":"lowercase code"}"#.utf8), nil),
      (451, Data("<html>".utf8), nil),
    ] as [(Int, Data, String?)] {
      let failure = HostedContract.failure(status: status, body: body)
      XCTAssertEqual(failure.context.reason, reason, "\(status)")
      XCTAssertEqual(failure.context.status, status, "\(status)")
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
    let source = try TileflowMapSource.hosted(
      mapID: mapID, publicResourceOrigins: [URL(string: "https://public.example")!],
      configuration: configuration()
    ).loadable { throw TileflowMapError.invalidRequest }
    let endpoint = try XCTUnwrap(source.hosted)
    let sessionTransport = SessionTestTransport { request, _ in
      try sessionResponse(fixture, request: request)
    }
    let resourceTransport = SessionTestTransport { _, _ in
      ResourcePayload(bytes: Data([1, 2]), status: 200, headers: [:])
    }
    let session = HostedSession(
      endpoint: endpoint, mapID: mapID, surfaceID: "mobile-map", transport: sessionTransport)
    let loader = ResourceLoader(
      policy: source.policy, hosted: session, publicMetadataURLs: source.publicMetadataURLs,
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

  private let mapCredential = "tf_public_" + String(repeating: "a", count: 48)

  /// The map credential and a different services credential, which must never reach the map.
  private func configuration() throws -> TileflowConfiguration {
    try TileflowConfiguration(
      apiOrigin: URL(string: "https://api.tileflow.test")!,
      servicesCredential: TileflowCredential("tf_public_" + String(repeating: "b", count: 48)),
      mapCredential: TileflowCredential(mapCredential))
  }

  private func makeEndpoint() throws -> HostedEndpoint {
    try HostedEndpoint(configuration())
  }
}

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
      let reason: String?
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
  struct Reaction: Decodable, Sendable {
    let status: Int
    let code: String?
    let resource: String
    let refreshed: Bool?
    let reaction: String
  }
  let scenarios: [Scenario]
  let resourceReactions: [Reaction]
}

private final class StatusSequence: @unchecked Sendable {
  private let lock = NSLock()
  private var statuses: [Int]
  private var recorded = 0
  init(_ statuses: [Int]) { self.statuses = statuses }
  func next() -> Int { lock.withLock { statuses.isEmpty ? 200 : statuses.removeFirst() } }
  func record() { lock.withLock { recorded += 1 } }
  var count: Int { lock.withLock { recorded } }
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
