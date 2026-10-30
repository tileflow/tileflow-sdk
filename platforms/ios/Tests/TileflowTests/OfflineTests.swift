import Foundation
import XCTest

@testable import Tileflow

/// The fixture is produced by the service's own planner, cover and routes; the corridor fixture
/// pins the SDK's corridor rings so both platforms plan the same packs.
final class OfflineTests: XCTestCase {
  func testTileCoverMatchesTheService() throws {
    for item in try contract()["coverage"] as! [[String: Any]] {
      let name = item["name"] as! String
      let region = try XCTUnwrap(OfflinePackRegion(json: json(item["region"]!)), name)
      let minZoom = item["minZoom"] as! Int
      let counts = item["counts"] as! [Int]
      let rows = item["rows"] as! [[Int]]
      for (offset, count) in counts.enumerated() {
        let cover = OfflineTileCover(region, zoom: minZoom + offset)
        XCTAssertEqual(cover.count, count, "\(name) z\(minZoom + offset)")
        XCTAssertEqual(cover.rows.map { [$0.lowerBound, $0.upperBound] }, rows[offset], name)
      }
      for detail in item["detail"] as! [[String: Any]] {
        let cover = OfflineTileCover(region, zoom: detail["zoom"] as! Int)
        for row in detail["rows"] as! [[Any]] {
          let y = row[0] as! Int
          let expected = (row[1] as! [[Int]]).map { $0[0]...$0[1] }
          XCTAssertEqual(cover.row(y), expected, "\(name) row \(y)")
        }
      }
    }
  }

  func testRegionsAreCanonicalLikeTheService() throws {
    for item in try contract()["canonical"] as! [[String: Any]] {
      let name = item["name"] as! String
      let input = item["region"] as! [String: Any]
      let region: OfflinePackRegion?
      if input["type"] as! String == "bbox" {
        let box = input["bbox"] as! [Double]
        region = OfflinePackRegion.canonical(box[0], box[1], box[2], box[3])
      } else {
        region = OfflinePackRegion.canonical(
          (input["coordinates"] as! [[Double]]).map {
            TileflowPosition(longitude: $0[0], latitude: $0[1])
          })
      }
      if let canonical = item["canonical"] {
        XCTAssertEqual(region, OfflinePackRegion(json: try json(canonical)), name)
        XCTAssertEqual(try object(region!.json), canonical as! NSDictionary, name)
      } else {
        XCTAssertNil(region, name)
      }
    }
  }

  func testRequestsMatchTheServiceCanonicalBody() throws {
    let requests = try contract()["requests"] as! [[String: Any]]
    for item in requests {
      let name = item["name"] as! String
      let body = item["body"] as! [String: Any]
      let box = (body["region"] as! [String: Any])["bbox"] as! [Double]
      let zooms = try OfflineZooms(
        range: (body["minZoom"] as! Int)...max(body["minZoom"] as! Int, body["maxZoom"] as! Int),
        terrainMaximum: body["terrainMaxZoom"] as? Int ?? OfflineZooms.defaultTerrainMaximum)
      let built = Result {
        try OfflinePackRequest.requests(
          mapID: body["mapId"] as! String, themes: body["themes"] as! [String],
          geometry: .boundingBox(
            TileflowBoundingBox(west: box[0], south: box[1], east: box[2], north: box[3])),
          zooms: zooms)
      }
      switch (item["canonical"], name) {
      case (let canonical?, _):
        let request = try XCTUnwrap(try built.get().first, name)
        XCTAssertEqual(try object(request.body), canonical as! NSDictionary, name)
      case (nil, "inverted-zooms"):
        // A Swift range cannot be inverted; the zooms above are the nearest valid ones.
        continue
      default:
        XCTAssertThrowsError(try built.get(), name) {
          XCTAssertEqual(($0 as? TileflowOfflineError)?.code, .invalidOptions, name)
        }
      }
    }
  }

  func testCreatedDownloadIsPlannedExactly() throws {
    let download = try createdDownload()
    let manifest = download.manifest
    XCTAssertEqual(manifest.themes, ["default"])
    XCTAssertEqual(manifest.maximumPackResources, 10_000)
    XCTAssertEqual(manifest.excluded.map(\.source), ["nautical"])
    XCTAssertEqual(manifest.sources.map(\.source), ["terrain", "world"])
    XCTAssertEqual(manifest.sources.map(\.zooms), [10...12, 10...14])
    XCTAssertEqual(manifest.sources.map(\.absentStatus), [404, 404])
    XCTAssertEqual(manifest.sources.map(\.contentEncoding), [nil, "gzip"])
    XCTAssertEqual(manifest.origins, ["https://api.tileflow.test"])
    // The zoom policy plans the same source zooms the service did.
    let zooms = try OfflineZooms(range: 10...14)
    XCTAssertEqual(zooms.zooms(sourceMinimum: 0, sourceMaximum: 15), 10...14)
    XCTAssertEqual(
      zooms.zooms(sourceMinimum: 0, sourceMaximum: min(14, zooms.terrainMaximum)), 10...12)

    let plan = OfflineVersionPlan.hosted(downloads: [download], requests: [try createdRequest()])
    XCTAssertEqual(plan.packs.map(\.pack.id), [
      "style", "assets", "glyphs/Noto Sans Regular/0", "tiles/terrain/7/62/48",
      "tiles/terrain/11/1002/772", "tiles/terrain/11/1003/772", "tiles/world/7/62/48",
      "tiles/world/11/1002/772", "tiles/world/11/1003/772",
    ])
    XCTAssertEqual(plan.resourceCount, 25)
    XCTAssertEqual(plan.billable, 23)
    XCTAssertEqual(plan.bytes, 4_149)
    XCTAssertEqual(plan.resources.count, 1, "Discovery")
    XCTAssertEqual(plan.tileCounts, ["terrain": 5, "world": 11])
    // Every tile pack's anchor starts its band; tiles the archive does not store are left out.
    var cover = 0
    for zoom in 10...14 { cover += OfflineTileCover(manifest.region, zoom: zoom).count }
    XCTAssertLessThan(plan.tileCounts["world"]!, cover)
    for planned in plan.packs where planned.pack.kind == .tiles {
      let anchor = try XCTUnwrap(planned.pack.anchor)
      XCTAssertTrue(OfflinePackBand.anchors.contains(anchor.z))
      XCTAssertEqual(planned.release, planned.pack.source == "world" ? "2026-10-01" : "2026-10")
    }
  }

  func testManifestInvariantsAreChecked() throws {
    func pack(_ manifest: inout [String: Any], _ change: (inout [String: Any]) -> Void) {
      var packs = manifest["packs"] as! [[String: Any]]
      let index = packs.firstIndex { $0["kind"] as? String == "tiles" }!
      change(&packs[index])
      manifest["packs"] = packs
    }
    let mutations: [(String, (inout [String: Any]) -> Void)] = [
      (
        "totals",
        { manifest in
          var totals = manifest["totals"] as! [String: Any]
          totals["billableResources"] = (totals["billableResources"] as! Int) - 1
          manifest["totals"] = totals
        }
      ),
      ("an anchor outside the cover", { pack(&$0) { $0["anchor"] = [11, 0, 0]; $0["id"] = "tiles/world/11/0/0" } }),
      ("an anchor no band starts at", { manifest in pack(&manifest) { item in
        let anchor = item["anchor"] as! [Int]
        item["anchor"] = [12, anchor[1] * 2, anchor[2] * 2]
        item["id"] = "tiles/world/12/\(anchor[1] * 2)/\(anchor[2] * 2)"
      } }),
      ("zooms outside the band", { pack(&$0) { $0["zooms"] = [12, 16] } }),
      ("an id that is not its anchor", { pack(&$0) { $0["id"] = "tiles/world/11/1/1" } }),
      ("an unknown source", { pack(&$0) { $0["source"] = "bathymetry" } }),
      ("another origin", { pack(&$0) { $0["url"] = "https://elsewhere.test/v1/offline/p.tfpack" } }),
      ("plain HTTP", { pack(&$0) { $0["url"] = "http://api.tileflow.test/v1/offline/p.tfpack" } }),
      ("larger than a pack can be", { pack(&$0) { $0["bytes"] = 33 * 1024 * 1024 } }),
      ("more billable than resources", { pack(&$0) { $0["billableResources"] = 1_000_000 } }),
      ("an unknown kind", { pack(&$0) { $0["kind"] = "models" } }),
      ("format 1", { $0["version"] = 1 }),
      (
        "another region",
        { $0["region"] = ["type": "bbox", "bbox": [-3.71, 40.41, -3.69, 40.43]] }
      ),
      (
        "over the plan",
        { manifest in
          let billable = (manifest["totals"] as! [String: Any])["billableResources"] as! Int
          manifest["limits"] = ["maxPackResources": billable - 1, "dailyDownloads": 20_000]
        }
      ),
      (
        "a template on another origin",
        { manifest in
          var sources = manifest["sources"] as! [[String: Any]]
          sources[0]["template"] = "https://elsewhere.test/{z}/{x}/{y}.pbf"
          manifest["sources"] = sources
        }
      ),
    ]
    for (name, mutate) in mutations {
      var response = try createdResponse()
      var manifest = response["manifest"] as! [String: Any]
      mutate(&manifest)
      response["manifest"] = manifest
      XCTAssertThrowsError(
        try OfflinePackContract.download(
          JSONSerialization.data(withJSONObject: response), request: createdRequest(),
          allowsLoopbackHTTP: false), name
      ) { XCTAssertEqual(($0 as? TileflowOfflineError)?.code, .invalidResponse, name) }
    }
    var response = try createdResponse()
    response["grant"] = "tf_offline_v1.a.b"
    XCTAssertThrowsError(
      try OfflinePackContract.download(
        JSONSerialization.data(withJSONObject: response), request: createdRequest(),
        allowsLoopbackHTTP: false), "A format 1 grant")
  }

  func testRevalidationStates() throws {
    let checkedAt = Date(timeIntervalSince1970: 1_793_188_800)
    let expected: [String: OfflinePackRevalidation] = [
      "current": .current(checkedAt: checkedAt, interval: 86_400),
      "update-available": .updateAvailable(checkedAt: checkedAt, interval: 86_400),
      "credential-revoked": .notUpdatable(reason: .credentialRevoked, checkedAt: checkedAt),
      "plan-unavailable": .notUpdatable(reason: .planUnavailable, checkedAt: checkedAt),
    ]
    for item in try contract()["revalidations"] as! [[String: Any]] {
      let name = item["name"] as! String
      let body = try JSONSerialization.data(withJSONObject: item["body"]!)
      XCTAssertEqual(try OfflinePackContract.revalidation(body), expected[name], name)
    }
    XCTAssertThrowsError(
      try OfflinePackContract.revalidation(Data(#"{"state":"current","checkedAt":"x"}"#.utf8)))
  }

  func testFailuresMapToTypedErrors() throws {
    let now = Date(timeIntervalSince1970: 1_793_188_800)
    for item in try contract()["failures"] as! [[String: Any]] {
      let body = Data((item["body"] as! String).utf8)
      let status = item["status"] as! Int
      let headers = item["headers"] as! [String: String]
      let serverCode = HostedContract.errorCode(body)!
      let operation: OfflinePackContract.Operation =
        switch item["operation"] as! String {
        case "create": .create
        case "revalidate": .revalidate
        default: .download
        }
      let error = OfflinePackContract.failure(
        status: status, body: body, retryAfter: headers["retry-after"], operation: operation,
        now: now)
      XCTAssertEqual(error.code, offlineErrorCodes[serverCode], serverCode)
      XCTAssertEqual(error.context.reason, serverCode)
      XCTAssertEqual(error.context.status, status)
      XCTAssertEqual(error.context.limit, serverCode == "OFFLINE_PACK_TOO_LARGE" ? 10_000 : nil)
      XCTAssertEqual(
        error.retryAfter, headers["retry-after"].flatMap(TimeInterval.init), serverCode)
    }
    // A code is trusted only with its own status; otherwise the status and operation decide.
    let forged = Data(#"{"code":"OFFLINE_PACK_TOO_LARGE","error":"x","limit":5}"#.utf8)
    let unknown = OfflinePackContract.failure(
      status: 401, body: forged, retryAfter: nil, operation: .create, now: now)
    XCTAssertEqual(unknown.code, .credentialRejected)
    XCTAssertNil(unknown.context.limit)
    XCTAssertEqual(
      OfflinePackContract.failure(
        status: 401, body: Data(), retryAfter: nil, operation: .download, now: now
      ).code, .grantRejected)
    XCTAssertEqual(
      OfflinePackContract.failure(
        status: 429, body: Data(), retryAfter: "Thu, 29 Oct 2026 00:00:00 GMT",
        operation: .download,
        now: now
      ).retryAfter, 43_200)
  }

  func testClientSendsTheContractRequests() async throws {
    let transport = OfflineTestTransport { request in
      if request.url!.path.hasSuffix("/revalidate") {
        return ResourcePayload(
          bytes: Data(
            #"{"state":"current","checkedAt":"2026-10-28T12:00:00.000Z","intervalSeconds":86400}"#
              .utf8), status: 200, headers: [:])
      }
      return ResourcePayload(
        bytes: try JSONSerialization.data(withJSONObject: createdResponse()), status: 201,
        headers: [:])
    }
    let credential = "tf_public_" + String(repeating: "a", count: 48)
    let client = try OfflinePackClient(
      configuration: TileflowConfiguration(
        apiOrigin: URL(string: "https://api.tileflow.test")!,
        servicesCredential: TileflowCredential("tf_public_" + String(repeating: "b", count: 48)),
        mapCredential: TileflowCredential(credential)),
      transport: transport)
    let download = try await client.create(try createdRequest())
    _ = try await client.revalidate(download.grant)

    let (create, revalidate) = (transport.requests[0], transport.requests[1])
    XCTAssertEqual(create.httpMethod, "POST")
    XCTAssertEqual(create.url?.absoluteString, "https://api.tileflow.test/v1/offline/packs")
    XCTAssertEqual(
      create.allHTTPHeaderFields,
      ["Content-Type": "application/json", "X-Tileflow-Mobile-Client": credential])
    XCTAssertEqual(try object(create.httpBody!), try object(createdRequest().body))
    XCTAssertEqual(
      revalidate.url?.absoluteString, "https://api.tileflow.test/v1/offline/packs/revalidate")
    XCTAssertEqual(revalidate.allHTTPHeaderFields, ["Content-Type": "application/json"])
    XCTAssertEqual(
      try object(revalidate.httpBody!), ["grant": download.grant.value] as NSDictionary)
    XCTAssertFalse(String(describing: download.grant).contains(download.grant.value))

    let anonymous = try OfflinePackClient(
      configuration: TileflowConfiguration(apiOrigin: URL(string: "https://api.tileflow.test")!),
      transport: transport)
    do {
      _ = try await anonymous.create(try createdRequest())
      XCTFail("A download needs the map credential")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .missingCredential)
    }
    XCTAssertEqual(transport.requests.count, 2)
  }

  func testGeometryBecomesServicePacks() throws {
    let crossing = TileflowOfflineGeometry.boundingBox(
      TileflowBoundingBox(west: 179.5, south: -17, east: -179.5, north: -16.5))
    XCTAssertEqual(
      try crossing.packRegions(),
      [
        .bbox(west: 179.5, south: -17, east: 180, north: -16.5),
        .bbox(west: -180, south: -17, east: -179.5, north: -16.5),
      ])
    let world = TileflowOfflineGeometry.boundingBox(
      TileflowBoundingBox(west: -180, south: -90, east: 180, north: 90))
    XCTAssertEqual(try world.tileCount(zoom: 3), 64)
    let open = TileflowOfflineGeometry.polygon([
      .init(longitude: -3.75, latitude: 40.38), .init(longitude: -3.62, latitude: 40.36),
      .init(longitude: -3.6, latitude: 40.47), .init(longitude: -3.72, latitude: 40.5),
    ])
    let polygon = try contract()["coverage"] as! [[String: Any]]
    XCTAssertEqual(try open.tileCount(zoom: 16), (polygon[0]["counts"] as! [Int])[16])
    XCTAssertEqual(try open.tileCount(zoomRange: 15...16), 196 + 715)

    let invalid: [(TileflowOfflineGeometry, String)] = [
      (
        .polygon([.init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 1)]),
        "tooFewPositions"
      ),
      (
        .polygon([
          .init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 1),
          .init(longitude: 2, latitude: 2),
        ]), "emptyArea"
      ),
      (
        .polygon((0..<256).map { .init(longitude: Double($0) / 1000, latitude: sin(Double($0))) }),
        "tooManyPositions"
      ),
      (
        .corridor(
          line: [.init(longitude: 179, latitude: 0), .init(longitude: -179, latitude: 0)],
          width: 100), "crossesAntimeridian"
      ),
      (
        .corridor(
          line: [.init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 0)], width: 0.5),
        "invalidWidth"
      ),
      (
        .corridor(
          line: [.init(longitude: 0, latitude: 0), .init(longitude: 0, latitude: 0)], width: 10),
        "tooFewPositions"
      ),
      (
        .boundingBox(TileflowBoundingBox(west: 0, south: 0, east: .nan, north: 1)),
        "invalidPosition"
      ),
      (.boundingBox(TileflowBoundingBox(west: 1, south: 0, east: 1, north: 1)), "emptyArea"),
    ]
    for (geometry, reason) in invalid {
      XCTAssertThrowsError(try geometry.validate(), reason) {
        XCTAssertEqual(($0 as? TileflowOfflineError)?.code, .invalidRegion)
        XCTAssertEqual(($0 as? TileflowOfflineError)?.context.reason, reason)
      }
    }
  }

  func testCorridorsCoverTheirWidth() throws {
    for item in try corridors() {
      let name = item["name"] as! String
      let line = (item["line"] as! [[Double]]).map {
        TileflowPosition(longitude: $0[0], latitude: $0[1])
      }
      let width = item["width"] as! Double
      let regions = try TileflowOfflineGeometry.corridor(line: line, width: width).packRegions()
      XCTAssertEqual(regions.count, item["packs"] as! Int, name)
      for region in regions {
        guard case .polygon(let ring) = region else { return XCTFail(name) }
        XCTAssertLessThanOrEqual(ring.count, 256, name)
      }
      for (zoom, count) in item["counts"] as! [String: Int] {
        XCTAssertEqual(OfflineTileCover.count(regions, zoom: Int(zoom)!), count, "\(name) z\(zoom)")
      }
      // Every point 0.95 half widths beside the line lies in a covered tile.
      let zoom = 15
      let covers = regions.map { OfflineTileCover($0, zoom: zoom) }
      for index in line.indices.dropFirst() {
        let (a, b) = (line[index - 1], line[index])
        for step in 0...10 {
          let t = Double(step) / 10
          let point = TileflowPosition(
            longitude: a.longitude + t * (b.longitude - a.longitude),
            latitude: a.latitude + t * (b.latitude - a.latitude))
          for side in [-1.0, 1.0] {
            let offset = beside(point, heading: (a, b), metres: side * 0.95 * width / 2)
            let tile = OfflineTileCover.mercator(offset, scale: Double(1 << zoom))
            let (x, y) = (Int(tile.x.rounded(.down)), Int(tile.y.rounded(.down)))
            XCTAssertTrue(covers.contains { $0.contains(x: x, y: y) }, "\(name) \(index) \(t)")
          }
        }
      }
    }
  }

  func testSelfHostedEstimateCountsTheCover() throws {
    let geometry = TileflowOfflineGeometry.boundingBox(
      TileflowBoundingBox(west: -3.72, south: 40.4, east: -3.68, north: 40.43))
    let counts = (try contract()["coverage"] as! [[String: Any]])[1]["counts"] as! [Int]
    let estimate = try OfflinePlanner.estimate(
      geometry: geometry, zooms: OfflineZooms(range: 0...16),
      sources: [
        .init(id: "streets", minZoom: 0, maxZoom: 14),
        .init(id: "relief", minZoom: 2, maxZoom: 14, maximumDownloadZoom: 12),
        .init(id: "detail", minZoom: 17, maxZoom: 20),
      ])
    // Zooms deeper than a source's maximum overzoom its deepest tiles; none are downloaded.
    XCTAssertEqual(estimate.tileCounts["streets"], counts[0...14].reduce(0, +))
    XCTAssertEqual(estimate.tileCounts["relief"], counts[2...12].reduce(0, +))
    XCTAssertEqual(estimate.tileCounts["detail"], 0)
    XCTAssertEqual(
      estimate.resourceCount, counts[0...14].reduce(0, +) + counts[2...12].reduce(0, +))
    XCTAssertNil(estimate.bytes)
    XCTAssertEqual(estimate.mapViews, 0)
  }

  func testDeviceLimit() throws {
    let accepted: [(Int, Int, Int, Int)] = [
      (0, 10_000, 0, 10_000), (9_000, 1_000, 0, 10_000), (9_500, 1_000, 600, 10_000),
      // A lower limit never stops an update that does not grow the device's total.
      (30_000, 500, 500, 10_000), (30_000, 0, 0, 10_000),
    ]
    for (total, adding, releasing, limit) in accepted {
      XCTAssertNoThrow(
        try OfflineDeviceLimit.check(
          deviceTotal: total, adding: adding, releasing: releasing, limit: limit))
    }
    let refused: [(Int, Int, Int, Int)] = [
      (9_000, 1_001, 0, 10_000), (0, 50_001, 0, 50_000), (30_000, 501, 500, 10_000),
    ]
    for (total, adding, releasing, limit) in refused {
      XCTAssertThrowsError(
        try OfflineDeviceLimit.check(
          deviceTotal: total, adding: adding, releasing: releasing, limit: limit)
      ) {
        XCTAssertEqual(($0 as? TileflowOfflineError)?.code, .deviceLimitExceeded)
        XCTAssertEqual(($0 as? TileflowOfflineError)?.context.limit, limit)
      }
    }
    XCTAssertThrowsError(
      try OfflineDeviceLimit.check(deviceTotal: 5, adding: 1, releasing: 6, limit: 10))
  }
}

/// The SDK error for each service code.
let offlineErrorCodes: [String: TileflowOfflineError.Code] = [
  "OFFLINE_PACKS_DISABLED": .unavailable, "OFFLINE_PACKS_UNAVAILABLE": .unavailable,
  "OFFLINE_PACK_GRANT_UNAVAILABLE": .unavailable, "OFFLINE_PACK_INVALID_INPUT": .rejected,
  "OFFLINE_PACK_AUTHORITY_CONFLICT": .rejected, "OFFLINE_PACK_BODY_TOO_LARGE": .rejected,
  "MOBILE_CREDENTIAL_INVALID": .credentialRejected, "MOBILE_MAP_MISMATCH": .accessDenied,
  "OFFLINE_PACK_MAP_NOT_FOUND": .notFound, "OFFLINE_PACK_THEME_NOT_FOUND": .notFound,
  "OFFLINE_PACKS_NOT_INCLUDED": .notIncluded, "OFFLINE_DOWNLOADS_DISABLED": .downloadsDisabled,
  "OFFLINE_PACK_TOO_LARGE": .packTooLarge, "OFFLINE_PACK_NOT_DOWNLOADABLE": .notDownloadable,
  "OFFLINE_PACK_GRANT_INVALID": .grantRejected, "OFFLINE_PACK_GRANT_EXPIRED": .grantRejected,
  "OFFLINE_PACK_GRANT_STALE": .grantRejected, "OFFLINE_PACK_RESOURCE_DENIED": .accessDenied,
  "OFFLINE_PACK_SUPERSEDED": .superseded, "OFFLINE_DAILY_LIMIT_REACHED": .dailyLimitReached,
  "OFFLINE_TEAM_DAILY_LIMIT_REACHED": .dailyLimitReached,
  "OFFLINE_PACK_REPEAT_LIMIT_REACHED": .rateLimited,
  "COMMERCIAL_MAP_LIMIT_REACHED": .quotaExceeded,
  "COMMERCIAL_SPENDING_LIMIT_REACHED": .quotaExceeded, "RATE_LIMITED": .rateLimited,
]

private func fixture(_ name: String) throws -> Any {
  let url = Bundle.module.url(
    forResource: name, withExtension: "json", subdirectory: "Fixtures/Offline")!
  return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
}

private func contract() throws -> [String: Any] {
  try fixture("offline-pack-contract") as! [String: Any]
}

private func corridors() throws -> [[String: Any]] {
  try fixture("offline-corridors") as! [[String: Any]]
}

private func json(_ value: Any) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: value))
}

private func object(_ value: JSONValue) throws -> NSDictionary {
  try object(JSONEncoder().encode(value))
}

private func object(_ data: Data) throws -> NSDictionary {
  try JSONSerialization.jsonObject(with: data) as! NSDictionary
}

/// The service's creation answer, generated by its own code (`packs-v2/release-1`).
private func createdResponse() throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: Data(contentsOf: packFixture("release-1/create-response.json")))
    as! [String: Any]
}

private func createdRequest() throws -> OfflinePackRequest {
  try OfflinePackRequest.requests(
    mapID: "map_offlinefixture00", themes: ["default"],
    geometry: .boundingBox(
      TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
    zooms: OfflineZooms(range: 10...14))[0]
}

private func createdDownload() throws -> OfflineDownload {
  try OfflinePackContract.download(
    JSONSerialization.data(withJSONObject: createdResponse()), request: createdRequest(),
    allowsLoopbackHTTP: false)
}

/// A file of the service's pack fixture, generated by its own code.
func packFixture(_ path: String) -> URL {
  Bundle.module.url(forResource: "packs-v2", withExtension: nil, subdirectory: "Fixtures/Offline")!
    .appendingPathComponent(path)
}

/// The position `metres` to the left of the segment's heading, on a sphere.
private func beside(
  _ point: TileflowPosition, heading: (TileflowPosition, TileflowPosition), metres: Double
) -> TileflowPosition {
  let radians = Double.pi / 180
  let (a, b) = heading
  let dx = (b.longitude - a.longitude) * cos(point.latitude * radians)
  let dy = b.latitude - a.latitude
  let length = (dx * dx + dy * dy).squareRoot()
  let degrees = metres / 6_371_008.8 / radians
  return TileflowPosition(
    longitude: point.longitude - dy / length * degrees / cos(point.latitude * radians),
    latitude: point.latitude + dx / length * degrees)
}

private final class OfflineTestTransport: NativeHTTPTransporting, @unchecked Sendable {
  private let lock = NSLock()
  private var captured: [URLRequest] = []
  private let response: @Sendable (URLRequest) throws -> ResourcePayload
  init(_ response: @escaping @Sendable (URLRequest) throws -> ResourcePayload) {
    self.response = response
  }
  var requests: [URLRequest] { lock.withLock { captured } }
  func send(_ request: URLRequest) async throws -> ResourcePayload {
    lock.withLock { captured.append(request) }
    return try response(request)
  }
  func close() {}
}
