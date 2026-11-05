import XCTest

@testable import Tileflow

extension OfflineStoreTests {
  private var updateConditions: OfflineUpdateConditions {
    .init(isUnmetered: true, isLowPower: false)
  }

  private func persistedProfile(_ id: String, version: Int) throws -> String {
    let request = try XCTUnwrap(
      OfflinePackRequest(json: Data(contentsOf: layout.request(id, version, pack: 0))))
    return request.profile
  }

  private func record(_ id: String) throws -> OfflineRegionRecord {
    try XCTUnwrap(OfflineRegionRecord.read(layout.record(id)))
  }

  func testAStoredWebRegionOffersASeparatelyVerifiedNativeUpgrade() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    _ = try await web.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(web, "area") { $0.state == .complete }
    service.clock.withLock { $0 += 86_401 }
    _ = try await web.loadRegion(id: "shared", options: madrid())
    _ = try await waitFor(web, "shared") { $0.state == .complete }
    let index = OfflineServingIndex()
    let native = makeStore(service, index: index, profile: .native)
    let old = try XCTUnwrap(try record("area").active)
    let packs = Set(
      try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))

    await native.core.checkForUpdates()
    let offered = await native.region(id: "area")
    XCTAssertEqual(offered?.updateState, .updateAvailable)
    XCTAssertTrue(offered?.isAvailable == true)
    XCTAssertEqual(try persistedProfile("area", version: old.number), "webview-v1")
    let oldStyle = await index.resource(service.key(service.styleURL), cache: cache)
    XCTAssertNotNil(oldStyle)
    let noOptIn = await native.core.updateAutomatically(updateConditions)
    XCTAssertTrue(noOptIn.isEmpty)
    try await native.setAutomaticUpdates(true)
    let metered = await native.core.updateAutomatically(OfflineUpdateConditions.unavailable)
    XCTAssertTrue(metered.isEmpty)
    XCTAssertEqual(service.profiles, ["webview-v1", "webview-v1"])

    // Keep the second web region as a consumer of the shared content.
    service.freezeAfter = service.downloads.count
    service.refusesCreation.withLock { $0 = true }
    let refused = await native.core.updateAutomatically(updateConditions)
    XCTAssertTrue(refused.isEmpty)
    XCTAssertNil(try record("area").pending)
    XCTAssertEqual(try record("area").active?.number, old.number)
    service.refusesCreation.withLock { $0 = false }
    let started = await native.core.updateAutomatically(updateConditions)
    XCTAssertEqual(started, ["area"])
    guard started == ["area"] else { return }
    try await native.pauseRegion(id: "area")
    let pending = try XCTUnwrap(try record("area").pending)
    XCTAssertEqual(try persistedProfile("area", version: pending.number), "native-v1")
    XCTAssertEqual(try record("area").active?.number, old.number)
    let pausedStore = makeStore(service, index: .init(), profile: .native)
    let reopened = await pausedStore.region(id: "area")
    XCTAssertEqual(reopened?.state, .paused)
    XCTAssertTrue(reopened?.isAvailable == true)
    service.freezeAfter = nil
    try await pausedStore.resumeRegion(id: "area")
    _ = try await waitFor(pausedStore, "area") { $0.state == .complete }
    XCTAssertEqual(try record("area").active?.number, pending.number)
    XCTAssertTrue(
      packs.isSubset(
        of: Set(try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))))
    try await pausedStore.removeRegion(id: "area")
    XCTAssertTrue(
      packs.isSubset(
        of: Set(try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))))
    XCTAssertEqual(try record("shared").active?.number, old.number)
  }

  func testAPausedWebGrantRenewsWithItsOriginalProfileInANativeStore() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    service.freezeAfter = 0
    _ = try await web.loadRegion(id: "paused", options: madrid())
    try await web.pauseRegion(id: "paused")
    let old = try XCTUnwrap(try record("paused").pending)
    let native = makeStore(service, profile: .native)
    service.clock.withLock { $0 += 86_401 }
    service.freezeAfter = nil
    try await native.resumeRegion(id: "paused")
    _ = try await waitFor(native, "paused") { $0.state == .complete }
    XCTAssertEqual(service.profiles, ["webview-v1", "webview-v1"])
    XCTAssertEqual(try record("paused").active?.number, old.number)
    XCTAssertEqual(try persistedProfile("paused", version: old.number), "webview-v1")
  }

  func testExpiredAuthorizationCannotStartANativeUpgradeAfterAFailedCheck() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    _ = try await web.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(web, "area") { $0.state == .complete }
    let native = makeStore(service, profile: .native)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    await native.core.checkForUpdates()
    try await native.setAutomaticUpdates(true)
    service.refusesRevalidation.withLock { $0 = true }
    let stages: [(TimeInterval, TileflowOfflineRegion.ExpiryState)] = [
      (86_401, .valid), (37 * 86_400, .expired),
    ]
    for (advance, expiry) in stages {
      service.clock.withLock { $0 += advance }
      let started = await native.core.updateAutomatically(updateConditions)
      XCTAssertTrue(started.isEmpty)
      let region = await native.region(id: "area")
      XCTAssertEqual(region?.expiryState, expiry)
    }
    XCTAssertEqual(service.creationAttempts.withLock { $0 }, ["webview-v1"])
    XCTAssertNil(try record("area").pending)
    XCTAssertEqual(try record("area").active?.number, 1)
  }

  func testDelayedRevalidationCannotRevokeARecreatedRegionWithTheSameVersionNumber() async throws {
    let service = OfflineServiceStub()
    let native = makeStore(service, profile: .native)
    _ = try await native.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(native, "area") { $0.state == .complete }
    let original = try XCTUnwrap(try record("area").active)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "not_updatable"
    let gate = RevalidationGate()
    service.beforeRevalidationReply.withLock { $0 = { await gate.hold() } }
    let checking = Task { await native.core.checkForUpdates() }
    await gate.waitForRequest()
    try await native.removeRegion(id: "area")
    // Reuse both the application id and v1, with a fresh service grant.
    service.clock.withLock { $0 -= 86_401 }
    _ = try await native.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(native, "area") { $0.state == .complete }
    XCTAssertEqual(try record("area").active?.number, original.number)
    await gate.release()
    await checking.value
    let fresh = await native.region(id: "area")
    XCTAssertEqual(fresh?.updateState, .current)
  }

  func testDeniedAccessRetainsTheWebRegionAndStopsItsAutomaticNativeUpgrade() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    _ = try await web.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(web, "area") { $0.state == .complete }
    let native = makeStore(service, profile: .native)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    service.freezeAfter = service.downloads.count
    try await native.setAutomaticUpdates(true)
    let started = await native.core.updateAutomatically(updateConditions)
    XCTAssertEqual(started, ["area"])
    let old = try XCTUnwrap(try record("area").active)
    try await native.pauseRegion(id: "area")
    service.clock.withLock { $0 += 86_401 }
    // Even an unexpired estimate predating revocation cannot authorize the next manual plan.
    _ = try await native.estimateRegion(madrid())
    service.revalidationState = "not_updatable"
    await native.core.checkForUpdates()
    let denied = await native.region(id: "area")
    XCTAssertEqual(denied?.updateState, .notUpdatable(reason: "credential_revoked"))
    service.freezeAfter = nil
    try? await native.resumeRegion(id: "area")
    let stopped = try await waitFor(native, "area") {
      [.paused, .failed, .complete].contains($0.state)
    }
    XCTAssertEqual(stopped.updateState, .notUpdatable(reason: "credential_revoked"))
    XCTAssertEqual(try record("area").active?.number, old.number)
    XCTAssertNil(try record("area").pending)
    XCTAssertEqual(service.profiles, ["webview-v1", "native-v1", "native-v1"])
    service.refusesCreation.withLock { $0 = true }
    do {
      _ = try await native.loadRegion(id: "area", options: madrid())
      XCTFail("A revoked automatic grant or estimate was reused")
    } catch { XCTAssertEqual((error as? TileflowOfflineError)?.code, .accessDenied) }
    XCTAssertEqual(try record("area").active?.number, old.number)
    XCTAssertNil(try record("area").pending)
    service.refusesCreation.withLock { $0 = false }
    _ = try await native.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(native, "area") { $0.state == .complete }
    XCTAssertEqual(service.profiles.last, "native-v1")
    XCTAssertNotEqual(try record("area").active?.number, old.number)
  }

  func testMultipartRevalidationNeedsAllGrantsForAnOfferAndOnlyOneForDenial() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    // Combine two verified downloads in the format written by clients that split the region.
    var record: OfflineRegionRecord?
    var requests: [OfflinePackRequest] = []
    var downloads: [OfflineDownload] = []
    var activity = Data()
    for (i, theme) in ["light", "dark"].enumerated() {
      let id = i == 0 ? "area" : "other"
      var options = madrid()
      options.content = .hosted(mapID: OfflineServiceStub.mapID, themes: [theme])
      _ = try await web.loadRegion(id: id, options: options)
      _ = try await waitFor(web, id) { $0.state == .complete }
      if i == 0 { record = try self.record(id) }
      let requestBody = try Data(contentsOf: layout.request(id, 1, pack: 0))
      let response = try Data(contentsOf: layout.download(id, 1, download: 0))
      let request = try XCTUnwrap(OfflinePackRequest(json: requestBody))
      requests.append(request)
      downloads.append(
        try OfflinePackContract.download(response, request: request, allowsLoopbackHTTP: false))
      activity.append(try Data(contentsOf: layout.progress(id, 1)))
      if i > 0 {
        try OfflineLayout.write(requestBody, to: layout.request("area", 1, pack: i))
        try OfflineLayout.write(response, to: layout.download("area", 1, download: i))
      }
    }
    var original = try XCTUnwrap(record)
    let combined = OfflineVersionPlan.hosted(downloads: downloads, requests: requests)
    original.active?.options = madrid().json
    original.active?.downloads = 2
    original.active?.packs = combined.packs.count
    original.active?.resources = combined.resourceCount
    original.active?.billable = combined.billable
    original.active?.bytes = combined.bytes
    try OfflineLayout.write(activity, to: layout.progress("area", 1))
    try original.write(layout.record("area"))
    let shared = makeStore(service, profile: .native)
    try await shared.removeRegion(id: "other")
    service.clock.withLock { $0 += 86_401 }

    typealias Reply = OfflineServiceStub.RevalidationReply
    let scenarios: [([Reply], String)] = [
      ([.unavailable, .state("current")], "current"),
      ([.state("update_available"), .unavailable], "current"),
      ([.state("current"), .state("current")], "update_available"),
      ([.state("not_updatable"), .unavailable], "not_updatable"),
      ([.unavailable, .state("not_updatable")], "not_updatable"),
    ]
    for (replies, expected) in scenarios {
      try original.write(layout.record("area"))
      service.revalidationReplies.withLock { $0 = replies }
      let reopened = makeStore(service, profile: .native)
      await reopened.core.checkForUpdates()
      let check = try XCTUnwrap(try self.record("area").check)
      XCTAssertEqual(check.state, expected)
      if expected != "update_available" {
        XCTAssertEqual(check.validatedAt, original.check?.validatedAt)
      }
    }
  }

  func testReopeningFinishesOnlyTheRevokedAutomaticStagingVersion() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    _ = try await web.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(web, "area") { $0.state == .complete }
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    service.freezeAfter = service.downloads.count
    let native = makeStore(service, profile: .native)
    try await native.setAutomaticUpdates(true)
    let started = await native.core.updateAutomatically(updateConditions)
    XCTAssertEqual(started, ["area"])
    try await native.pauseRegion(id: "area")
    var interrupted = try record("area")
    interrupted.check?.state = "not_updatable"
    interrupted.check?.reason = "credential_revoked"
    interrupted.pending?.state = .paused
    // A paused, manually owned candidate is independent of an automatic upgrade.
    interrupted.pending?.automatic = false
    try interrupted.write(layout.record("area"))
    let manual = makeStore(service, profile: .native)
    _ = await manual.region(id: "area")
    XCTAssertNotNil(try record("area").pending)
    interrupted.pending?.automatic = true
    try interrupted.write(layout.record("area"))
    let reopened = makeStore(service, profile: .native)
    let stored = await reopened.region(id: "area")
    XCTAssertTrue(stored?.isAvailable == true)
    XCTAssertEqual(stored?.updateState, .notUpdatable(reason: "credential_revoked"))
    XCTAssertNil(try record("area").pending)
    XCTAssertEqual(try record("area").active?.number, interrupted.active?.number)
  }

  func testRejectedPacksOrFullDiskKeepTheActiveWebVersionAfterRestart() async throws {
    let service = OfflineServiceStub()
    let web = makeStore(service, profile: .webView)
    _ = try await web.loadRegion(id: "area", options: madrid())
    _ = try await waitFor(web, "area") { $0.state == .complete }
    let old = try XCTUnwrap(try record("area").active)
    let space = LockedValue<Int64?>(0)
    let native = makeStore(service, space: space, profile: .native)
    _ = try await native.loadRegion(id: "area", options: madrid())
    let full = try await waitFor(native, "area") { $0.state == .failed }
    XCTAssertEqual(full.error?.code, .insufficientStorage)
    XCTAssertTrue(full.isAvailable)
    service.corruptPacks = 1_000
    space.withLock { $0 = nil }
    try await native.resumeRegion(id: "area")
    let bad = try await waitFor(native, "area") { $0.state == .failed }
    XCTAssertEqual(bad.error?.context.reason, "verificationFailed")
    let recovered = makeStore(service, profile: .native)
    let region = await recovered.region(id: "area")
    XCTAssertTrue(region?.isAvailable == true)
    XCTAssertEqual(try record("area").active?.number, old.number)
    XCTAssertEqual(try persistedProfile("area", version: old.number), "webview-v1")
  }
}

private actor RevalidationGate {
  private var arrived = false
  private var releaseCall: CheckedContinuation<Void, Never>?
  private var requestCall: CheckedContinuation<Void, Never>?

  func hold() async {
    arrived = true
    requestCall?.resume()
    await withCheckedContinuation { releaseCall = $0 }
  }
  func waitForRequest() async {
    if !arrived { await withCheckedContinuation { requestCall = $0 } }
  }
  func release() { releaseCall?.resume() }
}
