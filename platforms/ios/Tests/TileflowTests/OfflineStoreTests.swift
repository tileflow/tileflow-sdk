import CryptoKit
import XCTest

@testable import Tileflow
@testable import TileflowConfiguration

/// End-to-end store tests against an in-process Hosted service: downloads are created, their packs
/// downloaded, verified, stored, served in place, updated and removed.
final class OfflineStoreTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-store-\(UUID().uuidString)", isDirectory: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  func testHostedRegionDownloadsVerifiedPacksAndWorksOffline() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let region = try await store.loadRegion(id: "madrid", options: madrid())
    XCTAssertFalse(region.isAvailable)
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertTrue(done.isAvailable)
    XCTAssertGreaterThan(done.requiredPackCount, 2)
    XCTAssertEqual(done.completedPackCount, done.requiredPackCount)
    XCTAssertEqual(done.completedResourceCount, done.requiredResourceCount)
    XCTAssertEqual(done.completedResourceBytes, done.requiredResourceBytes)
    XCTAssertEqual(done.billableResourceCount, service.billableCount)
    XCTAssertEqual(done.updateState, .current)
    XCTAssertEqual(done.loadedResourceCount, done.requiredResourceCount)
    XCTAssertEqual(done.loadedResourceBytes, done.requiredResourceBytes)

    // Each pack and public file was downloaded once, with the grant only on packs.
    XCTAssertEqual(service.creations, 1)
    for entry in service.downloads {
      let isPack = entry.url.hasSuffix(".tfpack")
      XCTAssertEqual(entry.headers["X-Tileflow-Offline-Grant"] != nil, isPack, entry.url)
      XCTAssertEqual(Set(entry.headers.keys).subtracting(["X-Tileflow-Offline-Grant"]), [])
    }
    let packs = service.downloads.filter { $0.url.hasSuffix(".tfpack") }
    XCTAssertEqual(packs.count, done.requiredPackCount)
    XCTAssertEqual(service.downloads.count - packs.count, 3, "Discovery, profile and a landmark")
    XCTAssertEqual(
      Set(try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))
        .subtracting(["incoming"]).count, done.requiredPackCount)

    // Without a network, a new store over the same files has the region and every body.
    service.isOnline = false
    let index = OfflineServingIndex()
    let offline = makeStore(service, index: index)
    let reopened = try await XCTUnwrapAsync(await offline.region(id: "madrid"))
    XCTAssertTrue(reopened.isAvailable)
    XCTAssertEqual(reopened.state, .complete)
    await offline.core.networkDidConnect()
    XCTAssertEqual(service.downloads.count, packs.count + 3)
    XCTAssertGreaterThan(service.served.count, done.requiredPackCount)
    for (url, body) in service.served {
      let resource = await index.resource(service.key(url), cache: cache)
      XCTAssertEqual(resource?.metadata.status, 200, url)
      XCTAssertEqual(resource?.body, body, url)
    }
  }

  func testKilledDownloadResumesWithoutDownloadingAgain() async throws {
    let service = OfflineServiceStub()
    let first = makeStore(service, fetcher: OfflineFreezingFetcher(service, after: 8))
    try await first.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 8 }
    // The process ends: nothing more is written, a line of the progress log is cut short and a
    // partial pack is left behind.
    let version = try XCTUnwrap(
      FileManager.default.enumerator(atPath: layout.regions.path)?.compactMap { $0 as? String }
        .first { $0.hasSuffix("/v1") })
    let log = layout.regions.appendingPathComponent(version).appendingPathComponent("progress")
    if !FileManager.default.fileExists(atPath: log.path) {
      FileManager.default.createFile(atPath: log.path, contents: nil)
    }
    let handle = try FileHandle(forWritingTo: log)
    try handle.seekToEnd()
    try handle.write(contentsOf: Data("0123abc".utf8))
    try handle.close()
    try FileManager.default.createDirectory(
      at: layout.packs.incoming, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: layout.packs.incoming.appendingPathComponent("x.tfpack"))

    let second = makeStore(service)
    let done = try await waitFor(second, "madrid") { $0.state == .complete }
    XCTAssertEqual(done.completedPackCount, done.requiredPackCount)
    var bodies: [String: Int] = [:]
    for entry in service.downloads where entry.status == 200 { bodies[entry.url, default: 0] += 1 }
    XCTAssertEqual(bodies.count, done.requiredPackCount + 3)
    XCTAssertEqual(bodies.values.max(), 1, "Nothing is downloaded twice")
    XCTAssertEqual(service.creations, 1)
  }

  func testCorruptedPacksAreDownloadedAgainAndNeverStored() async throws {
    let service = OfflineServiceStub()
    service.corruptPacks = 1
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    let packs = service.downloads.filter { $0.url.hasSuffix(".tfpack") }
    XCTAssertEqual(packs.count, done.requiredPackCount + 1, "One pack came twice")

    // A pack that never verifies stops the download; nothing damaged is kept.
    let damaged = OfflineServiceStub()
    damaged.corruptPacks = 1_000
    let other = makeStore(damaged, root: "damaged")
    try await other.loadRegion(id: "madrid", options: madrid())
    let failed = try await waitFor(other, "madrid") { $0.state == .failed }
    XCTAssertEqual(failed.error?.code, .invalidResponse)
    XCTAssertEqual(failed.error?.context.reason, "verificationFailed")
    XCTAssertFalse(failed.isAvailable)
    let stored = try FileManager.default.contentsOfDirectory(
      atPath: directory.appendingPathComponent("damaged/packs").path)
    XCTAssertTrue(stored.allSatisfy { $0 == "incoming" }, "\(stored)")
  }

  func testFullDiskStopsTheDownloadUntilResumed() async throws {
    let service = OfflineServiceStub()
    let space = LockedValue<Int64?>(1024)
    let store = makeStore(service, space: space)
    try await store.loadRegion(id: "madrid", options: madrid())
    let full = try await waitFor(store, "madrid") { $0.state == .failed }
    XCTAssertEqual(full.error?.code, .insufficientStorage)
    XCTAssertTrue(service.downloads.isEmpty)

    // The disk fills during the download.
    space.withLock { $0 = nil }
    service.onDownload = { count in if count == 8 { space.withLock { $0 = 512 } } }
    try await store.resumeRegion(id: "madrid")
    let again = try await waitFor(store, "madrid") { $0.state == .failed }
    XCTAssertEqual(again.error?.code, .insufficientStorage)
    XCTAssertFalse(again.isAvailable)
    XCTAssertGreaterThanOrEqual(again.completedPackCount, 1)
    XCTAssertLessThan(again.completedPackCount, again.requiredPackCount)

    space.withLock { $0 = nil }
    service.onDownload = nil
    try await store.resumeRegion(id: "madrid")
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertEqual(done.completedPackCount, done.requiredPackCount)
    let bodies = service.downloads.filter { $0.status == 200 }.map(\.url)
    XCTAssertEqual(Set(bodies).count, bodies.count)
  }

  func testAFullDiskFirstMakesRoomFromTheMapCache() async throws {
    let service = OfflineServiceStub()
    let cache = self.cache
    let url = URL(string: "https://maps.example.com/style.json")!
    let body = Data("cached".utf8)
    XCTAssertTrue(
      cache.write(
        ResourceCacheKey(url: url, scope: .shared), retention: .ambient,
        metadata: ResourceCacheMetadata(
          url: url, status: 200, headers: ["Cache-Control": "max-age=60"], responseTime: Date(),
          protected: false, body: (body.count, DataChannel.digest(body))), body: body))
    // The disk is full until the map cache is cleared.
    let store = makeStore(service, available: { cache.usage().bytes > 0 ? 1024 : nil })
    try await store.loadRegion(id: "madrid", options: madrid())
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertTrue(done.isAvailable)
    XCTAssertEqual(cache.usage().entries, 0)
  }

  func testFiftyThousandResourceDownload() async throws {
    let service = OfflineServiceStub()
    service.tileLimit = 49_998
    service.documentsPublicOnly = true
    service.maximumPackResources = 50_000
    let store = makeStore(service, concurrency: 64)
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(TileflowBoundingBox(west: 10, south: 10, east: 12.5, north: 12.5)),
      content: .hosted(mapID: OfflineServiceStub.mapID, themes: ["default"]), minZoom: 11,
      maxZoom: 15)
    let estimate = try await store.estimateRegion(options)
    XCTAssertEqual(estimate.resourceCount, 50_000)
    XCTAssertEqual(estimate.billableResourceCount, 49_998)
    XCTAssertEqual(estimate.mapViews, 50)
    XCTAssertEqual(estimate.tileCounts, ["world": 49_998])
    XCTAssertLessThan(estimate.packCount, 400)
    let started = Date()
    try await store.loadRegion(id: "large", options: options)
    let done = try await waitFor(store, "large", timeout: 600) { $0.state == .complete }
    XCTAssertEqual(done.completedResourceCount, 50_000)
    XCTAssertEqual(done.completedPackCount, estimate.packCount)
    XCTAssertEqual(service.creations, 1, "The estimate's download is reused")
    print(
      "50,000 resources in \(estimate.packCount) packs stored in \(Int(Date().timeIntervalSince(started))) s"
    )

    // The device holds 49,998 billable resources of 50,000: a further region does not fit.
    do {
      try await store.loadRegion(id: "madrid", options: madrid())
      XCTFail("The device limit is enforced")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .deviceLimitExceeded)
      XCTAssertEqual(error.context.limit, 50_000)
    }
  }

  func testUpdatesDownloadOnlyChangedPacksAndKeepTheStoredVersionUntilComplete() async throws {
    let service = OfflineServiceStub()
    let index = OfflineServingIndex()
    let store = makeStore(service, index: index)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let first = service.downloads.count
    let oldTile = service.tileURL(service.changedTile)

    // Due only after the service's interval.
    await store.core.checkForUpdates()
    XCTAssertEqual(service.revalidations, 0)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    await store.core.networkDidConnect()
    let notified = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(notified.updateState, .updateAvailable)

    // A deployment changes the styles and a World release one tile; every other pack answers 304.
    service.publish()
    service.freezeAfter = first + 4
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= first + 4 }
    let updating = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertTrue(updating.isAvailable, "The stored version stays while the update downloads")
    let stale = await index.resource(service.key(oldTile), cache: cache)
    XCTAssertEqual(stale?.body, Data("tile \(service.changedTile.name)#1".utf8))

    service.freezeAfter = nil
    try await store.pauseRegion(id: "madrid")
    try await store.resumeRegion(id: "madrid")
    let done = try await waitFor(store, "madrid") { $0.state == .complete && $0.completedAt != nil }
    let update = service.downloads.dropFirst(first)
    let changed = Set(update.filter { $0.status == 200 }.map(\.url))
    XCTAssertEqual(
      changed,
      [
        "\(OfflineServiceStub.origin)/v1/offline/documents/style.tfpack", service.changedPackURL,
        "\(OfflineServiceStub.origin)/maps/\(OfflineServiceStub.mapID)/mobile/webview-v1/manifest.json",
      ])
    XCTAssertTrue(
      update.filter { $0.status == 304 }.allSatisfy { $0.headers["If-None-Match"] != nil })
    XCTAssertEqual(
      update.filter { $0.url.hasSuffix(".tfpack") }.count, done.requiredPackCount,
      "Every pack of the changed release was asked for")
    XCTAssertEqual(done.updateState, .current)
    XCTAssertEqual(done.completedPackCount, done.requiredPackCount)
    XCTAssertLessThan(done.loadedResourceCount, done.requiredResourceCount)
    // The new release serves the changed tile; the previous version's packs are released.
    let fresh = await index.resource(service.key(service.tileURL(service.changedTile)), cache: cache)
    XCTAssertEqual(fresh?.body, Data("tile \(service.changedTile.name)#2".utf8))
    let gone = await index.resource(service.key(oldTile), cache: cache)
    XCTAssertNil(gone)
    let files = Set(try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))
    XCTAssertEqual(files.subtracting(["incoming"]).count, done.requiredPackCount)

    // A deployment alone keeps every tile pack without asking.
    let before = service.downloads.count
    service.deploy()
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let asked = service.downloads.dropFirst(before).filter { $0.url.hasSuffix(".tfpack") }
    XCTAssertEqual(
      Set(asked.map(\.url)),
      [
        "\(OfflineServiceStub.origin)/v1/offline/documents/style.tfpack",
        "\(OfflineServiceStub.origin)/v1/offline/documents/glyphs/Noto%20Sans%20Regular/0.tfpack",
      ])
  }

  func testMetadataChangesInPlaceWithoutDownloadingAgain() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service, fetcher: OfflineFreezingFetcher(service, after: 5))
    var options = madrid()
    options.metadata = ["name": "Madrid"]
    try await store.loadRegion(id: "madrid", options: options)
    try await waitUntil { service.downloads.count >= 5 }
    // Loading with new metadata keeps the download in progress.
    options.metadata = ["name": "Centro"]
    try await store.loadRegion(id: "madrid", options: options)
    let renamed = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(renamed.options.metadata, ["name": "Centro"])
    XCTAssertEqual(service.creations, 1, "No new download")

    let other = makeStore(service, root: "other")
    try await other.loadRegion(id: "madrid", options: options)
    _ = try await waitFor(other, "madrid") { $0.state == .complete }
    let downloads = service.downloads.count
    try await other.updateRegionMetadata(id: "madrid", metadata: ["name": "Sol"])
    let updated = try await XCTUnwrapAsync(await other.region(id: "madrid"))
    XCTAssertEqual(updated.options.metadata, ["name": "Sol"])
    XCTAssertEqual(updated.state, .complete)
    XCTAssertEqual(service.downloads.count, downloads, "Nothing downloads")
    // The change survives a new store over the same files.
    let reopened = try await XCTUnwrapAsync(
      await makeStore(service, root: "other").region(id: "madrid"))
    XCTAssertEqual(reopened.options.metadata, ["name": "Sol"])
    do {
      try await other.updateRegionMetadata(id: "missing", metadata: [:])
      XCTFail("The region does not exist")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .regionNotFound)
    }
  }

  func testAccessEndingStopsRevalidationAndTheRegionLapsesAfterItsGracePeriod() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    let validated = service.now
    XCTAssertEqual(done.expiresAt, validated.addingTimeInterval(30 * 86_400))
    XCTAssertEqual(done.expiryState, .valid)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "not_updatable"
    await store.core.checkForUpdates()
    var region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(region.updateState, .notUpdatable(reason: "credential_revoked"))
    XCTAssertTrue(region.isAvailable, "Maps keep using it until it expires")
    XCTAssertEqual(region.state, .complete)
    XCTAssertEqual(
      region.expiresAt, validated.addingTimeInterval(30 * 86_400), "Counted from the last success")

    // Never revalidated again, it lapses 30 days after its last success and 7 of grace.
    service.clock.withLock { $0 = validated.timeIntervalSince1970 + 30 * 86_400 }
    await store.core.checkForUpdates()
    region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(
      region.expiryState, .gracePeriod(endsAt: validated.addingTimeInterval(37 * 86_400)))
    XCTAssertTrue(region.isAvailable)
    service.clock.withLock { $0 = validated.timeIntervalSince1970 + 37 * 86_400 }
    await store.core.checkForUpdates()
    region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(region.expiryState, .expired)
    XCTAssertFalse(region.isAvailable)
    XCTAssertEqual(service.revalidations, 1)
    let files = try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path)
    XCTAssertEqual(
      Set(files).subtracting(["incoming"]).count, done.requiredPackCount, "Its files stay")
  }

  func testRegionsExpireWithoutRevalidationAndARevalidationRestoresThem() async throws {
    let service = OfflineServiceStub()
    let index = OfflineServingIndex()
    let store = makeStore(service, index: index)
    let expiries = LockedValue<[TileflowOfflineRegion.ExpiryState?]>([])
    let subscription = store.subscribe { event in
      guard case .changed(let region) = event, region.state == .complete else { return }
      expiries.withLock { $0.append(region.expiryState) }
    }
    defer { subscription.cancel() }
    let style = service.key(service.styleURL)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let validated = service.now
    let downloads = service.downloads.count
    let automatic = await store.automaticUpdatesEnabled
    XCTAssertFalse(automatic)

    // Without a network for 30 days, the region enters its grace period and maps keep using it.
    service.isOnline = false
    service.clock.withLock { $0 = validated.timeIntervalSince1970 + 30 * 86_400 }
    await store.core.checkForUpdates()
    var region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    let graceEnd = validated.addingTimeInterval(37 * 86_400)
    XCTAssertEqual(region.expiryState, .gracePeriod(endsAt: graceEnd))
    XCTAssertTrue(region.isAvailable)
    let inGrace = await index.resource(style, cache: cache)
    XCTAssertEqual(inGrace?.metadata.status, 200)

    // The grace period ends: maps stop using the region, and its files stay.
    service.clock.withLock { $0 += 7 * 86_400 }
    region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(region.expiryState, .expired)
    XCTAssertFalse(region.isAvailable)
    let expired = await index.resource(style, cache: cache)
    XCTAssertNil(expired)
    let files = try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path)
    XCTAssertFalse(Set(files).subtracting(["incoming"]).isEmpty)

    // With the network back, a free revalidation restores it without downloading anything, with
    // automatic updates off.
    service.isOnline = true
    await store.core.networkDidConnect()
    region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(region.expiryState, .valid)
    XCTAssertEqual(region.expiresAt, service.now.addingTimeInterval(30 * 86_400))
    XCTAssertTrue(region.isAvailable)
    let restored = await index.resource(style, cache: cache)
    XCTAssertEqual(restored?.metadata.status, 200)
    XCTAssertEqual(service.revalidations, 1)
    XCTAssertEqual(service.downloads.count, downloads)
    // Each change is reported once, so an application can prompt its users.
    let reported: [TileflowOfflineRegion.ExpiryState?] = [
      .valid, .gracePeriod(endsAt: graceEnd), .expired, .valid,
    ]
    try? await waitUntil(timeout: 5) { expiries.withLock { Array($0.suffix(4)) } == reported }
    XCTAssertEqual(expiries.withLock { Array($0.suffix(4)) }, reported)
  }

  func testTheStoreWakesWhenARegionIsDueExpiresOrEndsItsGracePeriod() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let validated = service.now.timeIntervalSince1970
    var wake = await store.core.nextWake()
    XCTAssertEqual(wake, OfflineStoreCore.wakeLimit, "At least hourly while the app runs")
    service.clock.withLock { $0 = validated + 86_400 - 60 }
    wake = await store.core.nextWake()
    XCTAssertEqual(wake, 60, accuracy: 0.001, "Due for revalidation")
    service.clock.withLock { $0 = validated + 30 * 86_400 - 30 }
    wake = await store.core.nextWake()
    XCTAssertEqual(wake, 30, accuracy: 0.001, "Expires")
    service.clock.withLock { $0 = validated + 37 * 86_400 - 20 }
    wake = await store.core.nextWake()
    XCTAssertEqual(wake, 20, accuracy: 0.001, "The grace period ends")
    service.clock.withLock { $0 = validated + 40 * 86_400 }
    wake = await store.core.nextWake()
    XCTAssertEqual(wake, OfflineStoreCore.wakeLimit)
  }

  func testExpiredOrOverusedGrantsCreateTheDownloadAgain() async throws {
    let service = OfflineServiceStub()
    service.expireGrantAfter = 6
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertEqual(service.creations, 2)
    XCTAssertEqual(done.completedPackCount, done.requiredPackCount)
    let bodies = service.downloads.filter { $0.status == 200 }.map(\.url)
    XCTAssertEqual(Set(bodies).count, bodies.count, "Stored packs are kept")

    // A pack asked for too often under one grant: the download is created again.
    let repeated = OfflineServiceStub()
    repeated.refuseOnce = (5, 429, "OFFLINE_PACK_REPEAT_LIMIT_REACHED", nil)
    let again = makeStore(repeated, root: "repeated")
    try await again.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(again, "madrid") { $0.state == .complete }
    XCTAssertEqual(repeated.creations, 2)

    // A window that ends before the download continues is renewed before downloading.
    let other = OfflineServiceStub()
    let first = makeStore(other, root: "second", fetcher: OfflineFreezingFetcher(other, after: 5))
    try await first.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { other.downloads.count >= 5 }
    other.clock.withLock { $0 += 86_400 }
    let second = makeStore(other, root: "second")
    _ = try await waitFor(second, "madrid") { $0.state == .complete }
    XCTAssertEqual(other.creations, 2)
  }

  func testRecoverableRefusalsWaitAsAsked() async throws {
    let service = OfflineServiceStub()
    service.refuseOnce = (6, 429, "OFFLINE_TEAM_DAILY_LIMIT_REACHED", "7")
    let sleeps = LockedValue<[TimeInterval]>([])
    let store = makeStore(service, sleeps: sleeps)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertTrue(sleeps.withLock { $0 }.contains(7))

    // A refusal that waiting cannot repair stops the download.
    let refused = OfflineServiceStub()
    refused.refuseOnce = (5, 429, "COMMERCIAL_MAP_LIMIT_REACHED", nil)
    let other = makeStore(refused, root: "refused")
    try await other.loadRegion(id: "madrid", options: madrid())
    let failed = try await waitFor(other, "madrid") { $0.state == .failed }
    XCTAssertEqual(failed.error?.code, .quotaExceeded)
  }

  func testOfflineDownloadWaitsForTheNetwork() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 1 }
    service.isOnline = false
    let waiting = try await waitFor(store, "madrid") { $0.state == .waiting }
    XCTAssertEqual(waiting.error?.code, .network)
    service.isOnline = true
    await store.core.networkDidConnect()
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
  }

  func testRemovingReleasesOnlyPacksNoOtherRegionUses() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let subscriptionEvents = LockedValue<[TileflowOfflineRegionEvent]>([])
    let subscription = store.subscribe { event in subscriptionEvents.withLock { $0.append(event) } }
    func stored() throws -> Set<String> {
      Set(try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path))
        .subtracting(["incoming"])
    }
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let first = try stored()
    try await store.loadRegion(id: "nearby", options: madrid(east: -3.67))
    _ = try await waitFor(store, "nearby") { $0.state == .complete }
    let all = try stored()
    XCTAssertGreaterThan(all.count, first.count)
    let ids = await store.allRegions().map(\.id)
    XCTAssertEqual(ids, ["madrid", "nearby"])

    try await store.removeRegion(id: "nearby")
    XCTAssertEqual(try stored(), first, "Identical packs are shared")
    try await store.removeRegion(id: "madrid")
    XCTAssertEqual(try stored(), [])
    let regions = await store.allRegions()
    XCTAssertTrue(regions.isEmpty)
    try await waitUntil {
      subscriptionEvents.withLock { $0.contains(.removed(id: "madrid")) }
    }
    subscription.cancel()
  }

  func testStoppingWaitsForTheLastPackAndLeavesNoOrphans() async throws {
    for action in ["pause", "cancel", "remove"] {
      let service = OfflineServiceStub()
      let fetcher = OfflineFinishingPackFetcher(service)
      let store = makeStore(service, root: action, fetcher: fetcher)
      try await store.loadRegion(id: "madrid", options: madrid())
      await fetcher.response.waiting()

      let stopping = Task {
        switch action {
        case "pause": try await store.pauseRegion(id: "madrid")
        case "cancel": try await store.cancelRegion(id: "madrid")
        default: try await store.removeRegion(id: "madrid")
        }
        XCTAssertTrue(fetcher.delivered.withLock { $0 }, "\(action) returned before the pack transfer settled")
      }
      try await waitUntil { fetcher.stopped.withLock { $0 } }
      await fetcher.response.pass()
      try await stopping.value

      if action == "pause" {
        let region = await store.region(id: "madrid")
        XCTAssertEqual(region?.state, .paused)
        try await store.cancelRegion(id: "madrid")
      }
      let packs = OfflineLayout(root: directory.appendingPathComponent(action)).packs
      let files = (try? FileManager.default.contentsOfDirectory(atPath: packs.directory.path)) ?? []
      XCTAssertTrue(files.allSatisfy { $0 == "incoming" }, "\(action) left packs: \(files)")
    }
  }

  func testPauseAndCancel() async throws {
    let service = OfflineServiceStub()
    service.freezeAfter = 5
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 5 }
    try await store.pauseRegion(id: "madrid")
    let paused = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(paused.state, .paused)
    service.freezeAfter = nil
    try await Task.sleep(nanoseconds: 50_000_000)
    XCTAssertEqual(service.downloads.count, 5)

    // Cancelling a region that never completed removes it and what it stored.
    try await store.cancelRegion(id: "madrid")
    let regions = await store.allRegions()
    XCTAssertTrue(regions.isEmpty)
    let files = (try? FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path)) ?? []
    XCTAssertTrue(files.allSatisfy { $0 == "incoming" }, "\(files)")
    for url in service.served.keys where service.isPublic(url) {
      XCTAssertNil(cache.read(service.key(url), retention: .pinned))
    }
    do {
      try await store.resumeRegion(id: "madrid")
      XCTFail("The region is gone")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .regionNotFound)
    }
  }

  func testAutomaticUpdatesAreOffByDefaultAndScheduledOnlyWhileOn() async throws {
    let service = OfflineServiceStub()
    let scheduler = OfflineSchedulerStub()
    let conditions = LockedValue(OfflineUpdateConditions(isUnmetered: true, isLowPower: false))
    let store = makeStore(service, scheduler: scheduler, conditions: conditions)
    let initially = await store.automaticUpdatesEnabled
    XCTAssertFalse(initially)
    XCTAssertTrue(scheduler.requests.isEmpty)

    try await store.setAutomaticUpdates(true)
    let enabled = await store.automaticUpdatesEnabled
    XCTAssertTrue(enabled)
    XCTAssertEqual(scheduler.requests, [service.now], "The first run may start at once")
    // The choice is kept across launches.
    let relaunched = await makeStore(service, scheduler: scheduler).automaticUpdatesEnabled
    XCTAssertTrue(relaunched)
    // A run asks for the next one a day later; a run the network or power held back, an hour later.
    await store.core.runScheduledUpdates()
    XCTAssertEqual(scheduler.requests.last, service.now.addingTimeInterval(86_400))
    conditions.withLock { $0.isUnmetered = false }
    service.clock.withLock { $0 += 86_400 }
    await store.core.runScheduledUpdates()
    XCTAssertEqual(scheduler.requests.last, service.now.addingTimeInterval(3_600))

    // Turning them off cancels the scheduled run.
    try await store.setAutomaticUpdates(false)
    let disabled = await store.automaticUpdatesEnabled
    XCTAssertFalse(disabled)
    XCTAssertEqual(scheduler.cancellations, 1)

    // An app that does not permit the background task changes nothing.
    scheduler.refuses = true
    do {
      try await store.setAutomaticUpdates(true)
      XCTFail("The task is not permitted")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .invalidConfiguration)
      XCTAssertEqual(error.context.reason, "backgroundTaskNotPermitted")
    }
    let unchanged = await store.automaticUpdatesEnabled
    XCTAssertFalse(unchanged)
  }

  func testAutomaticUpdatesDownloadOnlyOnUnmeteredNetworksAndSwapAtomically() async throws {
    let service = OfflineServiceStub()
    let conditions = LockedValue(OfflineUpdateConditions(isUnmetered: true, isLowPower: false))
    let index = OfflineServingIndex()
    let store = makeStore(
      service, index: index, scheduler: OfflineSchedulerStub(), conditions: conditions)
    let events = LockedValue<[TileflowOfflineRegionEvent]>([])
    let subscription = store.subscribe { event in events.withLock { $0.append(event) } }
    defer { subscription.cancel() }
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let oldTile = service.tileURL(service.changedTile)
    service.publish()
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"

    // Off by default: the network returning only revalidates.
    await store.core.networkDidConnect()
    let checked = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(checked.updateState, .updateAvailable)
    XCTAssertEqual(service.creations, 1)

    // On, but on cellular or in Low Power Mode, nothing runs.
    try await store.setAutomaticUpdates(true)
    for blocked in [
      OfflineUpdateConditions(isUnmetered: false, isLowPower: false),
      OfflineUpdateConditions(isUnmetered: true, isLowPower: true),
    ] {
      let started = await store.core.updateAutomatically(blocked)
      XCTAssertEqual(started, [])
    }
    XCTAssertEqual(service.creations, 1)

    // On Wi-Fi the region updates by itself, only on unmetered networks, and the stored version
    // serves until the update is complete.
    let before = service.downloads.count
    service.freezeAfter = before + 3
    await store.core.networkDidConnect()
    try await waitUntil { service.downloads.count >= before + 3 }
    XCTAssertEqual(service.creations, 2)
    let updating = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(updating.state, .downloading)
    XCTAssertTrue(updating.isAvailable)
    let stale = await index.resource(service.key(oldTile), cache: cache)
    XCTAssertEqual(stale?.body, Data("tile \(service.changedTile.name)#1".utf8))
    service.freezeAfter = nil
    try await store.pauseRegion(id: "madrid")
    try await store.resumeRegion(id: "madrid")
    let done = try await waitFor(store, "madrid") {
      $0.state == .complete && $0.updateState == .current
    }
    XCTAssertTrue(done.isAvailable)
    let update = service.downloads.dropFirst(before)
    XCTAssertFalse(update.isEmpty)
    XCTAssertTrue(update.allSatisfy(\.unmeteredOnly), "Automatic updates stay off cellular")
    let fresh = await index.resource(
      service.key(service.tileURL(service.changedTile)), cache: cache)
    XCTAssertEqual(fresh?.body, Data("tile \(service.changedTile.name)#2".utf8))
    // Events report the update as for a manual one.
    XCTAssertTrue(
      events.withLock { list in
        list.contains {
          if case .changed(let region) = $0 { region.state == .downloading } else { false }
        }
      })

    // Loading the region while an automatic update downloads makes it the application's.
    service.deploy()
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    let next = service.downloads.count
    service.freezeAfter = next + 1
    await store.core.networkDidConnect()
    try await waitUntil { service.downloads.count >= next + 1 }
    try await store.loadRegion(id: "madrid", options: madrid())
    let takenOver = service.downloads.count
    service.freezeAfter = nil
    try await store.pauseRegion(id: "madrid")
    try await store.resumeRegion(id: "madrid")
    _ = try await waitFor(store, "madrid") { $0.state == .complete && $0.updateState == .current }
    XCTAssertGreaterThan(service.downloads.count, takenOver)
    XCTAssertFalse(
      service.downloads.dropFirst(takenOver).contains(where: \.unmeteredOnly),
      "The application's load uses any allowed network")
  }

  func testSelfHostedRegionDownloadsItsManifestStylesFontsSpritesGlyphsAndTiles() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let source = TileflowOfflineTileSource(
      id: "streets", template: "https://tiles.example.com/streets/{z}/{x}/{y}.pbf", maxZoom: 14)
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
      content: .manifest(
        url: URL(string: "https://tiles.example.com/manifest.json")!, map: "streets",
        sources: [source]),
      minZoom: 12, maxZoom: 15)
    let estimate = try await store.estimateRegion(options)
    XCTAssertNil(estimate.bytes)
    XCTAssertEqual(estimate.billableResourceCount, 0)
    try await store.loadRegion(id: "streets", options: options)
    let done = try await waitFor(store, "streets") { $0.state == .complete }
    // Sizes are known once downloaded.
    XCTAssertEqual(done.requiredResourceBytes, done.completedResourceBytes)
    XCTAssertEqual(done.billableResourceCount, 0)
    let urls = Set(service.downloads.map(\.url))
    // Manifest, font file, style, its data, four sprite files, 256 glyph ranges of one stack
    // and the tiles to zoom 14.
    XCTAssertEqual(done.requiredResourceCount, 1 + 1 + 1 + 1 + 4 + 256 + estimate.resourceCount)
    XCTAssertTrue(urls.contains("https://tiles.example.com/fonts/face.woff2"))
    XCTAssertTrue(urls.contains("https://tiles.example.com/data/places.json"))
    XCTAssertTrue(urls.contains("https://tiles.example.com/sprites/base@2x.png"))
    XCTAssertTrue(
      urls.contains("https://tiles.example.com/fonts/Noto%20Sans%20Regular/0-255.pbf"))
    XCTAssertTrue(service.downloads.allSatisfy { $0.headers.isEmpty })
    XCTAssertTrue(done.completedResourceBytes > 0)
  }

  func testMapsUseAvailableRegionsAlsoAfterAccessEnds() async throws {
    let service = OfflineServiceStub()
    let index = OfflineServingIndex()
    let store = makeStore(service, index: index)
    let style = service.key(service.styleURL)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let served = await index.resource(style, cache: cache)
    XCTAssertEqual(served?.metadata.headers["Content-Type"], "application/json")
    let scope = ResourceCacheScope.grant(
      apiOrigin: URL(string: OfflineServiceStub.origin)!, mapID: OfflineServiceStub.mapID)
    let credits = await index.credits(for: scope)
    XCTAssertEqual(credits.map(\.id), ["es-ign"])
    XCTAssertEqual(credits.first?.regions, [[-9.4, 35.9, 4.4, 43.8]])
    // A tile the region does not cover is not known offline.
    let elsewhere = await index.resource(
      service.key(service.tileURL(OfflineTileID(z: 12, x: 0, y: 0))), cache: cache)
    XCTAssertNil(elsewhere)

    // Stored files are excluded from device backups.
    for root in [cache.durableRoot, layout.root] {
      let values = try root.resourceValues(forKeys: [.isExcludedFromBackupKey])
      XCTAssertEqual(values.isExcludedFromBackup, true, root.path)
    }

    // A region that is still downloading is not used.
    service.publish()
    service.freezeAfter = service.downloads.count + 3
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= service.freezeAfter! }
    let pendingStyle = await index.resource(service.key(service.styleURL), cache: cache)
    XCTAssertNil(pendingStyle)
    try await store.cancelRegion(id: "madrid")
    service.freezeAfter = nil

    // Access ends: the region stops updating, and maps keep using it until it expires.
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "not_updatable"
    await store.core.checkForUpdates()
    let region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertTrue(region.isAvailable)
    XCTAssertEqual(region.updateState, .notUpdatable(reason: "credential_revoked"))
    let kept = await index.resource(style, cache: cache)
    XCTAssertEqual(kept?.metadata.status, 200)
    let keptCredits = await index.credits(for: scope)
    XCTAssertEqual(keptCredits.map(\.id), ["es-ign"])
    XCTAssertFalse(
      try FileManager.default.contentsOfDirectory(atPath: layout.packs.directory.path).isEmpty)
  }

  func testGeoJSONRegionsDownloadAndServeTheTilesTheirPartsTouch() async throws {
    let service = OfflineServiceStub()
    let index = OfflineServingIndex()
    let store = makeStore(service, index: index)
    let geometry = try TileflowOfflineGeometry(
      geoJSON: """
        {"type": "GeometryCollection", "geometries": [
          {"type": "LineString", "coordinates": [[-3.75, 40.38], [-3.6, 40.5]]},
          {"type": "Point", "coordinates": [-3.5, 40.6]}
        ]}
        """)
    let options = TileflowOfflineRegionLoadOptions(
      geometry: geometry, content: .hosted(mapID: OfflineServiceStub.mapID, themes: ["light"]),
      minZoom: 12, maxZoom: 14)
    try await store.loadRegion(id: "route", options: options)
    let done = try await waitFor(store, "route") { $0.state == .complete }
    XCTAssertTrue(done.isAvailable)
    XCTAssertEqual(service.creations, 1, "One download for every part")
    let region = try XCTUnwrap(try geometry.packRegions().first)
    var touched = 0
    for zoom in 12...14 {
      let cover = OfflineTileCover(region, zoom: zoom)
      for y in try XCTUnwrap(cover.rows) {
        for x in cover.row(y).flatMap({ Array($0) }) {
          touched += 1
          let tile = await index.resource(
            service.key(service.tileURL(OfflineTileID(z: zoom, x: x, y: y))), cache: cache)
          XCTAssertEqual(tile?.metadata.status, 200, "\(zoom)/\(x)/\(y)")
        }
      }
    }
    XCTAssertEqual(touched, try geometry.tileCount(zoomRange: 12...14))
    // A tile inside the line's bounds that the line does not pass through is not in the region.
    let cover = OfflineTileCover(region, zoom: 14)
    let top = try XCTUnwrap(cover.rows).lowerBound
    let west = try XCTUnwrap(cover.rows).compactMap { cover.row($0).first?.lowerBound }.min()!
    XCTAssertFalse(cover.contains(x: west, y: top))
    let beside = await index.resource(
      service.key(service.tileURL(OfflineTileID(z: 14, x: west, y: top))), cache: cache)
    XCTAssertNil(beside)
  }

  func testBackgroundFetcherSendsOnlyTheRequestHeadersAndRefusesRedirects() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [OfflineURLProtocolStub.self]
    let fetcher = OfflineURLSessionFetcher(
      configuration: configuration, directory: directory.appendingPathComponent("downloads"))
    let response = try await fetcher.fetch(
      OfflineFetchRequest(
        id: "a/1/x", url: URL(string: "https://api.tileflow.test/style.json")!,
        headers: ["X-Tileflow-Offline-Grant": "tf_offline_v2.a.b", "If-None-Match": "\"x\""],
        allowsExpensiveNetworkAccess: false))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.body, Data("style".utf8))
    XCTAssertEqual(response.wireBytes, 5)
    XCTAssertEqual(response.headers["ETag"], "\"etag\"")
    let sent = try XCTUnwrap(OfflineURLProtocolStub.requests.withLock { $0.last })
    XCTAssertEqual(sent.value(forHTTPHeaderField: "X-Tileflow-Offline-Grant"), "tf_offline_v2.a.b")
    XCTAssertFalse(sent.allowsExpensiveNetworkAccess)

    let redirected = try await fetcher.fetch(
      OfflineFetchRequest(
        id: "a/1/y", url: URL(string: "https://api.tileflow.test/moved")!, headers: [:],
        allowsExpensiveNetworkAccess: true))
    XCTAssertEqual(redirected.status, 302)
    XCTAssertEqual(OfflineURLProtocolStub.requests.withLock { $0.count }, 2)
  }

  func testDownloadsMoveToTheForegroundWhenBackgroundTransfersNeverStart() async throws {
    OfflineURLProtocolStub.requests.withLock { $0 = [] }
    let activity = OfflineActivityStub()
    let clock = OfflineWatchClock()
    let fetcher = watchedFetcher(background: OfflineNeverStartingProtocol.self, activity, clock)
    let warnings = LockedValue<[TileflowOfflineWarning]>([])
    fetcher.onWarning { warning in warnings.withLock { $0.append(warning) } }

    let request = styleRequest("a/1/x")
    async let response = fetcher.fetch(request)
    // The background task never starts and nothing fails: the transfer just waits.
    await clock.waiting()
    XCTAssertTrue(warnings.withLock { $0.isEmpty })
    XCTAssertEqual(OfflineURLProtocolStub.requests.withLock { $0.count }, 0)
    await clock.pass()
    let moved = try await response
    XCTAssertEqual(moved.status, 200)
    XCTAssertEqual(moved.body, Data("style".utf8))
    XCTAssertEqual(warnings.withLock { $0.map(\.code) }, [.backgroundTransferUnavailable])

    // Later transfers run in the foreground at once, and the warning is not repeated.
    let next = try await fetcher.fetch(styleRequest("a/1/y"))
    XCTAssertEqual(next.status, 200)
    XCTAssertEqual(OfflineURLProtocolStub.requests.withLock { $0.count }, 2)
    XCTAssertEqual(warnings.withLock { $0.count }, 1)
  }

  func testTheFallbackWaitsForAWholePeriodInTheForegroundOnANetworkTheTransferMayUse() async throws {
    OfflineURLProtocolStub.requests.withLock { $0 = [] }
    let activity = OfflineActivityStub()
    activity.enterBackground()
    let network = LockedValue((reachable: true, unmetered: false))
    let clock = OfflineWatchClock()
    let fetcher = watchedFetcher(
      background: OfflineNeverStartingProtocol.self, activity, clock,
      network: { network.withLock { $0 } })
    let warnings = LockedValue<[TileflowOfflineWarning]>([])
    fetcher.onWarning { warning in warnings.withLock { $0.append(warning) } }

    // In the background, where the system may defer background transfers, it never decides.
    let request = styleRequest("a/1/x")
    async let response = fetcher.fetch(request)
    await clock.waiting()
    await clock.pass()
    await clock.waiting()
    // A period that began in the background does not count either.
    activity.enterForeground()
    await clock.pass()
    await clock.waiting()
    // An unmetered-only transfer on a metered network waits in any build.
    let unmeteredRequest = styleRequest("a/1/u", unmeteredOnly: true)
    let unmetered = Task { try await fetcher.fetch(unmeteredRequest) }
    network.withLock { $0.reachable = false }
    await clock.pass()
    await clock.waiting()
    // Without a network, background transfers wait for one in any build.
    await clock.pass()
    await clock.waiting()
    XCTAssertTrue(warnings.withLock { $0.isEmpty })
    XCTAssertEqual(OfflineURLProtocolStub.requests.withLock { $0.count }, 0)

    // A whole period in the foreground with a network the first transfer may use decides.
    network.withLock { $0.reachable = true }
    await clock.pass()
    await clock.waiting()
    await clock.pass()
    let moved = try await response
    XCTAssertEqual(moved.status, 200)
    XCTAssertEqual(warnings.withLock { $0.map(\.code) }, [.backgroundTransferUnavailable])
    // The waiting unmetered-only transfer moves too, keeping its restriction.
    _ = try await unmetered.value
    let sent = OfflineURLProtocolStub.requests.withLock { $0 }
    XCTAssertEqual(sent.count, 2)
    XCTAssertEqual(sent.filter { !$0.allowsExpensiveNetworkAccess }.count, 1)
  }

  func testBackgroundTransfersThatStartNeverFallBack() async throws {
    let activity = OfflineActivityStub()
    let clock = OfflineWatchClock()
    let fetcher = watchedFetcher(background: OfflineURLProtocolStub.self, activity, clock)
    let warnings = LockedValue<[TileflowOfflineWarning]>([])
    fetcher.onWarning { warning in warnings.withLock { $0.append(warning) } }
    let response = try await fetcher.fetch(styleRequest("a/1/x"))
    XCTAssertEqual(response.status, 200)
    // The watch sees the background task started and ends without a warning.
    await clock.waiting()
    await clock.pass()
    _ = try await fetcher.fetch(styleRequest("a/1/y"))
    XCTAssertTrue(warnings.withLock { $0.isEmpty })
  }

  func testStoreReportsTransferWarningsAsEvents() async throws {
    let service = OfflineServiceStub()
    let fetcher = OfflineWarningFetcher(service)
    let store = makeStore(service, fetcher: fetcher)
    let events = LockedValue<[TileflowOfflineRegionEvent]>([])
    let subscription = store.subscribe { event in events.withLock { $0.append(event) } }
    defer { subscription.cancel() }
    let warning = TileflowOfflineWarning(.backgroundTransferUnavailable, message: "m")
    fetcher.warn(warning)
    try await waitUntil { events.withLock { $0.contains(.warning(warning)) } }
  }

  func testVerificationAcceptsTheWireOrTheDecodedBody() {
    let body = Data("tile".utf8)
    let digest = DataChannel.digest(body)
    let resource = OfflinePlannedResource(
      key: ResourceCacheKey(url: URL(string: "https://a.test/t/1/2/3.pbf")!, scope: .shared),
      bytes: 4, sha256: nil)
    func response(_ body: Data, etag: String?, encoding: String? = nil, wire: Int?)
      -> OfflineFetchResponse
    {
      var headers: [String: String] = [:]
      headers["ETag"] = etag
      headers["Content-Encoding"] = encoding
      return OfflineFetchResponse(
        status: 200, headers: headers, body: body, wireBytes: wire, wireSHA256: nil)
    }
    XCTAssertTrue(
      OfflineDownloader.verify(response(body, etag: "\"\(digest)\"", wire: 4), resource))
    XCTAssertFalse(
      OfflineDownloader.verify(
        response(body, etag: "\"\(String(repeating: "0", count: 64))\"", wire: 4), resource))
    XCTAssertFalse(
      OfflineDownloader.verify(response(Data("til".utf8), etag: nil, wire: 3), resource))
    // Decoded by the platform: the wire size must match.
    XCTAssertTrue(
      OfflineDownloader.verify(
        response(Data("decoded tile".utf8), etag: "\"\(digest)\"", encoding: "gzip", wire: 4),
        resource))
    XCTAssertFalse(
      OfflineDownloader.verify(
        response(Data("decoded tile".utf8), etag: "\"\(digest)\"", encoding: "gzip", wire: 5),
        resource))
    XCTAssertEqual(OfflineDownloader.etag("W/\"\(digest.uppercased())\""), digest)
    XCTAssertNil(OfflineDownloader.etag("\"short\""))
  }

  // MARK: Helpers

  private var layout: OfflineLayout {
    OfflineLayout(root: directory.appendingPathComponent("offline", isDirectory: true))
  }

  private lazy var cache = ResourceCacheStore(
    ambientRoot: directory.appendingPathComponent("ambient", isDirectory: true),
    durableRoot: directory.appendingPathComponent("durable", isDirectory: true),
    maximumBytes: 64 * 1024 * 1024)

  private func makeStore(
    _ service: OfflineServiceStub, root: String = "offline", space: LockedValue<Int64?>? = nil,
    sleeps: LockedValue<[TimeInterval]>? = nil, concurrency: Int = 8,
    fetcher: (any OfflineResourceFetching)? = nil, index: OfflineServingIndex? = nil,
    available: (@Sendable () -> Int64?)? = nil, scheduler: OfflineSchedulerStub? = nil,
    conditions: LockedValue<OfflineUpdateConditions>? = nil
  ) -> TileflowOfflineStore {
    let cache =
      root == "offline"
      ? self.cache
      : ResourceCacheStore(
        ambientRoot: directory.appendingPathComponent("\(root)-ambient", isDirectory: true),
        durableRoot: directory.appendingPathComponent("\(root)-durable", isDirectory: true),
        maximumBytes: 64 * 1024 * 1024)
    let configuration = try! TileflowConfiguration(
      apiOrigin: URL(string: "https://api.tileflow.test")!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "a", count: 48)))
    let clock = service.clock
    return TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: directory.appendingPathComponent(root, isDirectory: true)),
        cache: cache, fetcher: fetcher ?? service,
        client: {
          try OfflinePackClient(
            configuration: configuration, transport: service,
            now: { Date(timeIntervalSince1970: clock.withLock { $0 }) })
        },
        availableBytes: available ?? { space?.withLock { $0 } ?? nil }, index: index,
        reserveBytes: 4096,
        concurrency: concurrency, now: { Date(timeIntervalSince1970: clock.withLock { $0 }) },
        sleep: { delay in
          sleeps?.withLock { $0.append(delay) }
          try await Task.sleep(nanoseconds: 2_000_000)
        }, scheduler: scheduler,
        conditions: { conditions?.withLock { $0 } ?? .unavailable }))
  }

  private func watchedFetcher(
    background: AnyClass, _ activity: OfflineActivityStub, _ clock: OfflineWatchClock,
    network: @escaping @Sendable () -> (reachable: Bool, unmetered: Bool) = { (true, true) }
  ) -> OfflineURLSessionFetcher {
    let backgroundConfiguration = URLSessionConfiguration.ephemeral
    backgroundConfiguration.protocolClasses = [background]
    let foregroundConfiguration = URLSessionConfiguration.ephemeral
    foregroundConfiguration.protocolClasses = [OfflineURLProtocolStub.self]
    return OfflineURLSessionFetcher(
      configuration: backgroundConfiguration,
      directory: directory.appendingPathComponent("downloads", isDirectory: true),
      fallbackConfiguration: foregroundConfiguration, activity: activity, network: network,
      wait: { _ in await clock.period() })
  }

  private func styleRequest(_ id: String, unmeteredOnly: Bool = false) -> OfflineFetchRequest {
    OfflineFetchRequest(
      id: id, url: URL(string: "https://api.tileflow.test/style.json")!, headers: [:],
      allowsExpensiveNetworkAccess: !unmeteredOnly)
  }

  private func madrid(east: Double = -3.69) -> TileflowOfflineRegionLoadOptions {
    TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: east, north: 40.425)),
      content: .hosted(mapID: OfflineServiceStub.mapID, themes: ["light", "dark"]), minZoom: 12,
      maxZoom: 17)
  }

  private func waitFor(
    _ store: TileflowOfflineStore, _ id: String, timeout: TimeInterval = 30,
    _ predicate: (TileflowOfflineRegion) -> Bool
  ) async throws -> TileflowOfflineRegion {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let region = await store.region(id: id), predicate(region) { return region }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    let region = await store.region(id: id)
    XCTFail("Timed out: \(String(describing: region))")
    throw CancellationError()
  }

  private func waitUntil(timeout: TimeInterval = 30, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
      guard Date() < deadline else { throw CancellationError() }
      try await Task.sleep(nanoseconds: 2_000_000)
    }
  }
}

private func XCTUnwrapAsync<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line)
  async throws -> T
{
  try XCTUnwrap(value, file: file, line: line)
}

/// A Hosted service in process: it creates downloads from the region's cover, assembles their
/// packs, serves them and the public files with the contract's headers and statuses, and records
/// every request.
final class OfflineServiceStub: NativeHTTPTransporting, OfflineResourceFetching, @unchecked Sendable
{
  static let mapID = "map_offlineofflineof"
  static let origin = "https://api.tileflow.test"

  struct Download {
    let url: String
    let headers: [String: String]
    let status: Int
    /// The request stayed off expensive and constrained networks.
    var unmeteredOnly = false
  }

  let clock = LockedValue<TimeInterval>(1_793_188_800)  // 2026-10-28T12:00:00Z
  private let lock = NSLock()
  private var state = State()
  /// The z17 tile a new World release changes.
  let changedTile: OfflineTileID = {
    let cover = OfflineTileCover(
      OfflinePackRegion.canonical(-3.71, 40.41, -3.69, 40.425)!, zoom: 17)
    let y = cover.rows!.lowerBound
    return OfflineTileID(z: 17, x: cover.row(y)[0].lowerBound, y: y)
  }()

  private struct State {
    var deployment = 1
    var release = 1
    var changes: [String: Int] = [:]
    var grants: [String: (expires: TimeInterval, uses: Int)] = [:]
    var packs: [String: [String: Data]] = [:]
    var creations = 0
    var revalidations = 0
    var revalidationState = "current"
    var downloads: [Download] = []
    var served: [String: Data] = [:]
    var publicURLs = Set<String>()
    var billable = 0
    var isOnline = true
    var freezeAfter: Int?
    var expireGrantAfter: Int?
    var refuseOnce: (at: Int, status: Int, code: String, retryAfter: String?)?
    var tileLimit: Int?
    var documentsPublicOnly = false
    var maximumPackResources = 10_000
    var corruptPacks = 0
    var onDownload: (@Sendable (Int) -> Void)?
  }

  private func locked<T>(_ body: (inout State) -> T) -> T { lock.withLock { body(&state) } }

  var creations: Int { locked { $0.creations } }
  var revalidations: Int { locked { $0.revalidations } }
  var downloads: [Download] { locked { $0.downloads } }
  /// What each delivered pack entry and public file holds, decoded, by address.
  var served: [String: Data] { locked { $0.served } }
  var billableCount: Int { locked { $0.billable } }
  var isOnline: Bool {
    get { locked { $0.isOnline } }
    set { locked { $0.isOnline = newValue } }
  }
  var freezeAfter: Int? {
    get { locked { $0.freezeAfter } }
    set { locked { $0.freezeAfter = newValue } }
  }
  var expireGrantAfter: Int? {
    get { locked { $0.expireGrantAfter } }
    set { locked { $0.expireGrantAfter = newValue } }
  }
  var refuseOnce: (Int, Int, String, String?)? {
    get { locked { $0.refuseOnce.map { ($0.at, $0.status, $0.code, $0.retryAfter) } } }
    set { locked { $0.refuseOnce = newValue.map { ($0.0, $0.1, $0.2, $0.3) } } }
  }
  var revalidationState: String {
    get { locked { $0.revalidationState } }
    set { locked { $0.revalidationState = newValue } }
  }
  var tileLimit: Int? {
    get { locked { $0.tileLimit } }
    set { locked { $0.tileLimit = newValue } }
  }
  var documentsPublicOnly: Bool {
    get { locked { $0.documentsPublicOnly } }
    set { locked { $0.documentsPublicOnly = newValue } }
  }
  var maximumPackResources: Int {
    get { locked { $0.maximumPackResources } }
    set { locked { $0.maximumPackResources = newValue } }
  }
  /// The next pack responses with bytes carry a damaged byte.
  var corruptPacks: Int {
    get { locked { $0.corruptPacks } }
    set { locked { $0.corruptPacks = newValue } }
  }
  var onDownload: (@Sendable (Int) -> Void)? {
    get { locked { $0.onDownload } }
    set { locked { $0.onDownload = newValue } }
  }

  private static var mapPath: String { "\(origin)/maps/\(mapID)/mobile" }

  var styleURL: String { "\(Self.mapPath)/webview-v1/v\(locked { $0.deployment })/light.json" }
  var template: String { Self.template(locked { $0.release }) }

  static func template(_ release: Int) -> String {
    "\(origin)/tiles/world/r\(release)/{z}/{x}/{y}.pbf?map=\(mapID)"
  }

  var now: Date { Date(timeIntervalSince1970: clock.withLock { $0 }) }

  func tileURL(_ tile: OfflineTileID) -> String {
    OfflineTileTemplate(template)!.url(tile)!.absoluteString
  }

  func isPublic(_ url: String) -> Bool { locked { $0.publicURLs.contains(url) } }

  func scope(_ url: String) -> ResourceCacheScope {
    isPublic(url) || !url.hasPrefix(Self.origin)
      ? .shared : .grant(apiOrigin: URL(string: Self.origin)!, mapID: Self.mapID)
  }

  func key(_ url: String) -> ResourceCacheKey {
    ResourceCacheKey(url: URL(string: url)!, scope: scope(url))
  }

  /// A new deployment: a new versioned style and a new profile.
  func deploy() {
    locked { state in
      state.deployment += 1
      state.changes["profile"] = state.deployment
    }
  }

  /// A new deployment and a new World release, which changes one tile.
  func publish() {
    deploy()
    locked { state in
      state.release += 1
      state.changes["tile"] = state.release
    }
  }

  /// The pack holding `changedTile`, at the current release.
  var changedPackURL: String {
    let anchor = changedTile.ancestor(at: OfflinePackBand.anchor(of: changedTile.z))
    return
      "\(Self.origin)/v1/offline/tiles/world/r\(locked { $0.release })/\(anchor.z)/\(anchor.x)/\(anchor.y).tfpack"
  }

  // MARK: Bodies

  private func body(_ url: String, state: State) -> Data {
    if url.hasSuffix("/webview-v1/manifest.json") {
      return Data("\(url)#\(state.changes["profile"] ?? 1)".utf8)
    }
    if url == "https://tiles.example.com/manifest.json" {
      return Data(
        #"{"version":1,"maps":{"streets":{"defaultTheme":"day","themes":{"day":{"styleUrl":"./style.json","fontFaces":[{"sources":[{"url":"./fonts/face.woff2"}]}]}}}}}"#
          .utf8)
    }
    if url.hasPrefix("https://tiles.example.com/"), url.hasSuffix("/style.json") {
      return Data(
        #"{"version":8,"sprite":"https://tiles.example.com/sprites/base","glyphs":"https://tiles.example.com/fonts/{fontstack}/{range}.pbf","sources":{"places":{"type":"geojson","data":"./data/places.json"}},"layers":[{"id":"l","type":"symbol","layout":{"text-font":["Noto Sans Regular"],"text-field":"x"}}]}"#
          .utf8)
    }
    return Data("\(url)#1".utf8)
  }

  /// A tile's body: equal in every release unless the release changed it.
  private func tile(_ tile: OfflineTileID, state: State) -> Data {
    let version = tile == changedTile ? state.changes["tile"] ?? 1 : 1
    return Data("tile \(tile.name)#\(version)".utf8)
  }

  // MARK: NativeHTTPTransporting

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    guard isOnline else { throw URLError(.notConnectedToInternet) }
    let path = request.url!.path
    if path.hasSuffix("/revalidate") {
      return locked { state in
        state.revalidations += 1
        let checked = Self.date(clock.withLock { $0 })
        let body =
          state.revalidationState == "not_updatable"
          ? #"{"state":"not_updatable","reason":"credential_revoked","checkedAt":"\#(checked)"}"#
          : #"{"state":"\#(state.revalidationState)","checkedAt":"\#(checked)","intervalSeconds":86400}"#
        return ResourcePayload(bytes: Data(body.utf8), status: 200, headers: [:])
      }
    }
    return ResourcePayload(
      bytes: created(OfflinePackRequest(json: request.httpBody!)!), status: 201, headers: [:])
  }

  func close() {}

  /// Creates a download of `request`, as `POST /v1/offline/packs` answers.
  func created(_ request: OfflinePackRequest) -> Data {
    let now = clock.withLock { $0 }
    return locked { state in
      state.creations += 1
      state.revalidationState = "current"
      return created(request, now: now, state: &state)
    }
  }

  private func created(_ request: OfflinePackRequest, now: TimeInterval, state: inout State) -> Data
  {
    let packOrigin = "\(Self.origin)/v1/offline"
    var publicResources: [[String: Any]] = []
    func file(_ kind: String, _ url: String) {
      let body = self.body(url, state: state)
      state.publicURLs.insert(url)
      publicResources.append([
        "kind": kind, "url": url, "bytes": body.count, "sha256": DataChannel.digest(body),
      ])
    }
    file("discovery", "\(Self.mapPath)/manifest.json")
    file("profile", "\(Self.mapPath)/webview-v1/manifest.json")

    var packs: [[String: Any]] = []
    var bodies: [String: Data] = [:]
    func pack(
      _ id: String, _ kind: OfflinePackKind, _ url: String, _ entries: [OfflinePackBuilder.Entry],
      extra: [String: Any] = [:]
    ) {
      let data = OfflinePackBuilder.build(kind, entries)
      bodies[url] = data
      packs.append(
        [
          "id": id, "kind": kind == .tiles ? "tiles" : "documents", "url": url,
          "bytes": data.count, "resources": entries.count,
          // Only tiles are billable.
          "billableResources": kind == .tiles ? entries.count : 0,
        ].merging(extra) { a, _ in a })
    }
    let template = Self.template(state.release)
    if !state.documentsPublicOnly {
      file("landmark", "\(Self.origin)/landmarks/2026-10/notice.txt")
      var styles: [OfflinePackBuilder.Entry] = request.themes.map { theme in
        let url = "\(Self.mapPath)/webview-v1/v\(state.deployment)/\(theme).json"
        return .init(
          name: url, contentType: "application/json", encoding: nil,
          body: Data(#"{"version":8,"theme":"\#(theme)","deployment":\#(state.deployment)}"#.utf8))
      }
      styles.append(
        .init(
          name: "\(Self.origin)/tiles/world/tiles.json?map=\(Self.mapID)",
          contentType: "application/json", encoding: nil,
          body: Data(#"{"tilejson":"3.0.0","tiles":["\#(template)"]}"#.utf8)))
      pack("style", .documents, "\(packOrigin)/documents/style.tfpack", styles)
      pack(
        "glyphs/Noto Sans Regular/0", .documents,
        "\(packOrigin)/documents/glyphs/Noto%20Sans%20Regular/0.tfpack",
        [
          .init(
            name: "\(Self.origin)/fonts/Noto%20Sans%20Regular/0-255.pbf",
            contentType: "application/x-protobuf", encoding: nil, body: Data("glyphs".utf8))
        ])
    }

    var anchors: [OfflineTileID: [OfflineTileID]] = [:]
    var count = 0
    // The cover's tiles, as the service plans them: each entry's tiles at the download's zooms.
    entries: for entry in request.cover.entries {
      let tiles = request.cover.tiles(entry, zooms: request.minZoom...request.maxZoom)
      for zoom in tiles.keys.sorted() {
        for tile in tiles[zoom]! {
          if let limit = state.tileLimit, count >= limit { break entries }
          anchors[entry.anchor, default: []].append(tile)
          count += 1
        }
      }
    }
    for (anchor, tiles) in anchors.sorted(by: { ($0.key.z, $0.key.y, $0.key.x) < ($1.key.z, $1.key.y, $1.key.x) }) {
      let band = OfflinePackBand.zooms(anchor: anchor.z)!
      let zooms = max(band.lowerBound, request.minZoom)...min(band.upperBound, request.maxZoom)
      pack(
        "tiles/world/\(anchor.z)/\(anchor.x)/\(anchor.y)", .tiles,
        "\(packOrigin)/tiles/world/r\(state.release)/\(anchor.z)/\(anchor.x)/\(anchor.y).tfpack",
        tiles.map {
          .init(
            name: $0.name, contentType: "application/x-protobuf", encoding: "gzip",
            body: OfflinePackBuilder.gzip(self.tile($0, state: state)))
        },
        extra: ["source": "world", "anchor": [anchor.z, anchor.x, anchor.y], "zooms": [zooms.lowerBound, zooms.upperBound]])
    }
    let billable = packs.reduce(0) { $0 + ($1["billableResources"] as! Int) }
    state.billable = billable
    let resources = packs.reduce(0) { $0 + ($1["resources"] as! Int) } + publicResources.count
    let bytes =
      packs.reduce(0) { $0 + ($1["bytes"] as! Int) }
      + publicResources.reduce(0) { $0 + ($1["bytes"] as! Int) }
    state.grants.removeAll()
    let grant = "tf_offline_v2.g\(state.creations).sig"
    state.grants[grant] = (now + 86_400, 0)
    state.packs[grant] = bodies
    let manifest: [String: Any] = [
      "version": 2, "downloadId": "odl_" + String(format: "%022d", state.creations),
      "mapId": request.mapID, "profile": request.profile, "deploymentVersion": state.deployment,
      "themes": request.themes,
      "coverSha256": request.cover.sha256,
      "minZoom": request.minZoom, "maxZoom": request.maxZoom,
      "terrainMaxZoom": request.terrainMaxZoom, "createdAt": Self.date(now),
      "sources": [
        [
          "source": "world", "version": "r\(state.release)", "template": template,
          "zooms": [request.minZoom, request.maxZoom], "contentType": "application/x-protobuf",
          "contentEncoding": "gzip", "absentStatus": 404,
        ]
      ],
      "packs": packs, "publicResources": publicResources, "origins": [Self.origin],
      "excluded": [],
      "totals": [
        "packs": packs.count, "resources": resources, "billableResources": billable,
        "bytes": bytes,
      ],
      "attribution": [
        "sources": [
          [
            "source": "world", "text": "© OpenStreetMap contributors",
            "regionalObligations": [
              [
                "id": "es-ign", "exact": "© IGN España", "href": "https://www.ign.es",
                "regions": [[-9.4, 35.9, 4.4, 43.8]],
              ]
            ],
          ]
        ]
      ],
      "limits": [
        "maxPackResources": state.maximumPackResources, "dailyDownloads": 200_000,
        "teamDailyDownloads": 200_000,
      ],
      "revalidation": [
        "url": "\(Self.origin)/v1/offline/packs/revalidate", "intervalSeconds": 86_400,
      ],
      "download": ["expiresAt": Self.date(now + 86_400)],
    ]
    return try! JSONSerialization.data(withJSONObject: [
      "version": 2, "kind": "offline_download", "grant": grant, "manifest": manifest,
    ])
  }

  // MARK: OfflineResourceFetching

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    try Task.checkCancellation()
    let url = request.url.absoluteString
    enum Action {
      case respond(OfflineFetchResponse)
      case freeze
      case offline
      case cancelled
    }
    let now = clock.withLock { $0 }
    let action: Action = locked { state in
      // Checked under the lock, so a request cancelled before a test changes the stub never
      // reaches it.
      if Task.isCancelled { return .cancelled }
      guard state.isOnline else { return .offline }
      if let freeze = state.freezeAfter, state.downloads.count >= freeze { return .freeze }
      let count = state.downloads.count + 1
      func record(_ response: OfflineFetchResponse) -> Action {
        state.downloads.append(
          Download(
            url: url, headers: request.headers, status: response.status,
            unmeteredOnly: !request.allowsExpensiveNetworkAccess
              && !request.allowsConstrainedNetworkAccess))
        state.onDownload?(count)
        return .respond(response)
      }
      func refusal(_ status: Int, _ code: String) -> OfflineFetchResponse {
        OfflineFetchResponse(
          status: status, headers: ["Cache-Control": "no-store"],
          body: Data(#"{"code":"\#(code)","error":"refused"}"#.utf8), wireBytes: nil,
          wireSHA256: nil)
      }
      if let refuse = state.refuseOnce, refuse.at == count {
        state.refuseOnce = nil
        var headers = ["Cache-Control": "no-store"]
        headers["Retry-After"] = refuse.retryAfter
        return record(
          OfflineFetchResponse(
            status: refuse.status, headers: headers,
            body: Data(#"{"code":"\#(refuse.code)","error":"refused"}"#.utf8), wireBytes: nil,
            wireSHA256: nil))
      }
      if url.hasSuffix(".tfpack") {
        let grant = request.headers["X-Tileflow-Offline-Grant"] ?? ""
        var expired = true
        if let entry = state.grants[grant] {
          expired = now >= entry.expires
          if let limit = state.expireGrantAfter, entry.uses >= limit {
            state.expireGrantAfter = nil
            state.grants.removeValue(forKey: grant)
            expired = true
          }
        }
        if expired { return record(refusal(401, "OFFLINE_PACK_GRANT_EXPIRED")) }
        state.grants[grant]?.uses += 1
        guard var data = state.packs[grant]?[url] else {
          return record(refusal(403, "OFFLINE_PACK_RESOURCE_DENIED"))
        }
        let etag = "\"\(data.suffix(32).map { String(format: "%02x", $0) }.joined())\""
        let headers = [
          "ETag": etag, "Cache-Control": "private, no-cache, no-transform",
          "Content-Type": OfflinePackFormat.mediaType,
        ]
        if request.headers["If-None-Match"] == etag {
          return record(
            OfflineFetchResponse(
              status: 304, headers: headers, body: Data(), wireBytes: 0, wireSHA256: nil))
        }
        let scratch = write(data)
        defer { try? FileManager.default.removeItem(at: scratch) }
        if let index = try? OfflinePackFormat.index(scratch) {
          let kind = index.kind
          for entry in index.entries.values {
            let raw = data.subdata(in: Int(entry.offset)..<Int(entry.offset) + entry.length)
            let address =
              kind == .documents
              ? entry.name
              : url.contains("/r\(state.release)/")
                ? OfflineTileTemplate(Self.template(state.release))!.url(
                  OfflineTileID(name: entry.name)!)!.absoluteString : nil
            if let address {
              state.served[address] =
                entry.contentEncoding == "gzip" ? try! OfflinePackFormat.gunzip(raw) : raw
            }
          }
        }
        if state.corruptPacks > 0 {
          state.corruptPacks -= 1
          data[data.count / 2] ^= 0xff
        }
        try! data.write(to: request.destination!)
        return record(
          OfflineFetchResponse(
            status: 200, headers: headers, body: Data(), wireBytes: data.count, wireSHA256: nil))
      }
      let body = self.body(url, state: state)
      let etag = "\"\(DataChannel.digest(body))\""
      if request.headers["If-None-Match"] == etag {
        return record(
          OfflineFetchResponse(
            status: 304, headers: ["ETag": etag], body: Data(), wireBytes: 0, wireSHA256: nil))
      }
      if url.hasPrefix("https://tiles.example.com/streets/"), url.contains("/14/") {
        return record(
          OfflineFetchResponse(
            status: 404, headers: [:], body: Data(), wireBytes: 0, wireSHA256: nil))
      }
      if state.publicURLs.contains(url) { state.served[url] = body }
      return record(
        OfflineFetchResponse(
          status: 200,
          headers: [
            "ETag": etag, "Cache-Control": "private, no-cache",
            "Content-Type": "application/octet-stream",
          ], body: body, wireBytes: body.count, wireSHA256: nil))
    }
    switch action {
    case .respond(let response): return response
    case .offline: throw URLError(.notConnectedToInternet)
    case .cancelled: throw CancellationError()
    case .freeze:
      try await Task.sleep(nanoseconds: 3_600_000_000_000)
      throw CancellationError()
    }
  }

  func cancel(prefix: String) {}

  private func write(_ data: Data) -> URL {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try! data.write(to: file)
    return file
  }

  static func date(_ seconds: TimeInterval) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date(timeIntervalSince1970: seconds))
  }
}

/// Holds a completed pack just before the transfer hands its file to the downloader.
private final class OfflineFinishingPackFetcher: OfflineResourceFetching, Sendable {
  let response = OfflineWatchClock()
  let stopped = LockedValue(false)
  let delivered = LockedValue(false)
  private let first = LockedValue(true)
  private let base: OfflineServiceStub

  init(_ base: OfflineServiceStub) { self.base = base }

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    let result = try await base.fetch(request)
    guard let destination = request.destination,
      first.withLock({ value in defer { value = false }; return value })
    else { return result }
    let bytes = try Data(contentsOf: destination)
    await response.period()
    try bytes.write(to: destination)
    delivered.withLock { $0 = true }
    return result
  }

  func cancel(prefix: String) { stopped.withLock { $0 = true } }
}

/// A process that ends after `after` requests: later requests never return.
final class OfflineFreezingFetcher: OfflineResourceFetching, @unchecked Sendable {
  private let base: any OfflineResourceFetching
  private let remaining: LockedValue<Int>

  init(_ base: any OfflineResourceFetching, after: Int) {
    self.base = base
    remaining = LockedValue(after)
  }

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    let allowed = remaining.withLock { value in
      defer { value -= 1 }
      return value > 0
    }
    guard allowed else {
      try await Task.sleep(nanoseconds: 3_600_000_000_000)
      throw CancellationError()
    }
    return try await base.fetch(request)
  }

  func cancel(prefix: String) {}
}

/// A transfer service that takes requests and never starts them, as the system's background
/// transfer service behaves for a build it does not accept.
final class OfflineNeverStartingProtocol: URLProtocol {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {}
  override func stopLoading() {}
}

/// The app's activity, as a test sets it.
final class OfflineActivityStub: OfflineAppActivity {
  private let state = LockedValue((foreground: true, entries: 0))
  var isForeground: Bool { state.withLock { $0.foreground } }
  var backgroundEntries: Int { state.withLock { $0.entries } }

  func enterBackground() {
    state.withLock {
      $0.foreground = false
      $0.entries += 1
    }
  }

  func enterForeground() { state.withLock { $0.foreground = true } }
}

/// The fetcher's watch periods, which end only when a test ends them.
actor OfflineWatchClock {
  private var periods: [CheckedContinuation<Void, Never>] = []
  private var listeners: [UUID: CheckedContinuation<Bool, Never>] = [:]

  /// A period: returns when the test ends it.
  func period() async {
    await withCheckedContinuation { continuation in
      periods.append(continuation)
      let listeners = listeners
      self.listeners = [:]
      for listener in listeners.values { listener.resume(returning: true) }
    }
  }

  /// Returns once the watch is in a period. A watch that ended never waits again: after ten
  /// seconds this fails the test instead of hanging it.
  func waiting(file: StaticString = #filePath, line: UInt = #line) async {
    guard periods.isEmpty else { return }
    let id = UUID()
    let waiting = await withTaskGroup(of: Bool.self) { group in
      group.addTask { await self.listen(id) }
      group.addTask {
        try? await Task.sleep(nanoseconds: 10_000_000_000)
        await self.stopListening(id)
        return false
      }
      let first = await group.next() ?? false
      group.cancelAll()
      return first
    }
    if !waiting { XCTFail("The watch is not waiting", file: file, line: line) }
  }

  private func listen(_ id: UUID) async -> Bool {
    // The watch may have entered a period since `waiting()` looked.
    guard periods.isEmpty else { return true }
    return await withCheckedContinuation { listeners[id] = $0 }
  }

  private func stopListening(_ id: UUID) {
    listeners.removeValue(forKey: id)?.resume(returning: false)
  }

  /// Ends the current period.
  func pass() {
    let periods = periods
    self.periods = []
    for period in periods { period.resume() }
  }
}

/// Fetches from the service and passes on the warnings a test gives it.
final class OfflineWarningFetcher: OfflineResourceFetching, @unchecked Sendable {
  private let base: OfflineServiceStub
  private let handler = LockedValue<(@Sendable (TileflowOfflineWarning) -> Void)?>(nil)

  init(_ base: OfflineServiceStub) { self.base = base }

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    try await base.fetch(request)
  }

  func cancel(prefix: String) { base.cancel(prefix: prefix) }

  func onWarning(_ handler: @escaping @Sendable (TileflowOfflineWarning) -> Void) {
    self.handler.withLock { $0 = handler }
  }

  func warn(_ warning: TileflowOfflineWarning) { handler.withLock { $0 }?(warning) }
}

final class OfflineURLProtocolStub: URLProtocol {
  static let requests = LockedValue<[URLRequest]>([])

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.withLock { $0.append(request) }
    let url = request.url!
    if url.path == "/moved" {
      let response = HTTPURLResponse(
        url: url, statusCode: 302, httpVersion: "HTTP/1.1",
        headerFields: ["Location": "https://elsewhere.test/"])!
      client?.urlProtocol(
        self, wasRedirectedTo: URLRequest(url: URL(string: "https://elsewhere.test/")!),
        redirectResponse: response)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    let response = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["ETag": "\"etag\"", "Content-Length": "5", "Set-Cookie": "a=b"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data("style".utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

/// Records what the store asks the system to schedule.
final class OfflineSchedulerStub: OfflineUpdateScheduling, @unchecked Sendable {
  private let state = LockedValue((requests: [Date](), cancellations: 0, refuses: false))

  var requests: [Date] { state.withLock { $0.requests } }
  var cancellations: Int { state.withLock { $0.cancellations } }
  var refuses: Bool {
    get { state.withLock { $0.refuses } }
    set { state.withLock { $0.refuses = newValue } }
  }

  func schedule(earliest: Date) throws {
    try state.withLock { state in
      guard !state.refuses else {
        throw TileflowOfflineError(
          .invalidConfiguration, context: .init(reason: "backgroundTaskNotPermitted"))
      }
      state.requests.append(earliest)
    }
  }

  func cancel() { state.withLock { $0.cancellations += 1 } }
}
