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

  func testCreatedPackIsPlannedExactly() throws {
    let pack = try createdPack()
    let manifest = pack.manifest
    XCTAssertEqual(manifest.themes, ["dark", "light"])
    XCTAssertEqual(manifest.maximumPackResources, 10_000)
    XCTAssertEqual(manifest.excluded.map(\.source), ["boundaries"])
    XCTAssertEqual(manifest.tiles.map(\.source), ["terrain", "world"])
    XCTAssertEqual(manifest.tiles.map(\.zooms), [12...12, 12...15])
    // The zoom policy plans the same source zooms the service did.
    let zooms = try OfflineZooms(range: 12...15)
    XCTAssertEqual(zooms.zooms(sourceMinimum: 0, sourceMaximum: 15), 12...15)
    XCTAssertEqual(
      zooms.zooms(sourceMinimum: 0, sourceMaximum: min(14, zooms.terrainMaximum)), 12...12)

    let estimate = OfflinePlanner.estimate(manifest)
    XCTAssertEqual(estimate.resourceCount, 38)
    XCTAssertEqual(estimate.billableResourceCount, 30)
    XCTAssertEqual(estimate.publicResourceCount, 7)
    XCTAssertEqual(estimate.bytes, 1_974_920)
    XCTAssertEqual(estimate.tileCounts, ["terrain": 2, "world": 17])
    XCTAssertEqual(estimate.mapViews, 1)
    XCTAssertEqual(OfflinePlanner.estimate(manifest, isStored: { _ in true }).mapViews, 0)

    let resources = Array(OfflinePlanner.resources(manifest))
    XCTAssertEqual(resources.count, 38)
    XCTAssertEqual(resources.filter(\.billable).count, 30)
    XCTAssertEqual(resources.reduce(0) { $0 + ($1.bytes ?? 0) }, 1_974_920)
    XCTAssertTrue(
      resources.filter(\.isPublic).allSatisfy { !$0.billable && $0.sha256 != nil })
    let world = manifest.tiles[1]
    XCTAssertEqual(
      world.url(world.entries[0])?.absoluteString,
      "https://api.tileflow.test/tiles/world/2026-10-01/12/2005/1544.pbf?worldDescriptorSha256="
        + String(repeating: "b", count: 64) + "&map=map_offlineofflineof")
    // Every listed tile is in the region's cover, and the cover bounds the service's counts.
    for set in manifest.tiles {
      for zoom in set.zooms! {
        XCTAssertLessThanOrEqual(
          set.entries.filter { $0.z == zoom }.count,
          OfflineTileCover(manifest.region, zoom: zoom).count)
      }
    }
  }

  func testManifestInvariantsAreChecked() throws {
    let mutations: [(String, (inout [String: Any]) -> Void)] = [
      (
        "totals", { $0["totals"] = ["resources": 38, "billableResources": 29, "bytes": 1_974_920] }
      ),
      (
        "public billable",
        { manifest in
          var documents = manifest["documents"] as! [[String: Any]]
          documents[0]["billable"] = true
          manifest["documents"] = documents
        }
      ),
      (
        "outside the cover",
        { manifest in
          var tiles = manifest["tiles"] as! [[String: Any]]
          var entries = tiles[1]["entries"] as! [[Int]]
          entries[0] = [12, 0, 0, entries[0][3]]
          tiles[1]["entries"] = entries
          manifest["tiles"] = tiles
        }
      ),
      (
        "plain HTTP",
        { manifest in
          var documents = manifest["documents"] as! [[String: Any]]
          documents[2]["url"] = "http://api.tileflow.test/style.json"
          manifest["documents"] = documents
        }
      ),
      (
        "another region",
        { $0["region"] = ["type": "bbox", "bbox": [-3.71, 40.41, -3.69, 40.43]] }
      ),
      ("over the plan", { $0["limits"] = ["maxPackResources": 29, "dailyDownloads": 20_000] }),
    ]
    for (name, mutate) in mutations {
      var response = try createdResponse()
      var manifest = response["manifest"] as! [String: Any]
      mutate(&manifest)
      response["manifest"] = manifest
      XCTAssertThrowsError(
        try OfflinePackContract.pack(
          JSONSerialization.data(withJSONObject: response), request: createdRequest(),
          allowsLoopbackHTTP: false), name
      ) { XCTAssertEqual(($0 as? TileflowOfflineError)?.code, .invalidResponse, name) }
    }
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
      let created = try contract()["created"] as! [String: Any]
      return ResourcePayload(
        bytes: Data((created["body"] as! String).utf8), status: 201, headers: [:])
    }
    let credential = "tf_public_" + String(repeating: "a", count: 48)
    let client = try OfflinePackClient(
      configuration: TileflowConfiguration(
        apiOrigin: URL(string: "https://api.tileflow.test")!,
        servicesCredential: TileflowCredential("tf_public_" + String(repeating: "b", count: 48)),
        mapCredential: TileflowCredential(credential)),
      transport: transport)
    let pack = try await client.create(try createdRequest())
    _ = try await client.revalidate(pack.grant)

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
    XCTAssertEqual(try object(revalidate.httpBody!), ["grant": pack.grant.value] as NSDictionary)
    XCTAssertFalse(String(describing: pack.grant).contains(pack.grant.value))

    let anonymous = try OfflinePackClient(
      configuration: TileflowConfiguration(apiOrigin: URL(string: "https://api.tileflow.test")!),
      transport: transport)
    do {
      _ = try await anonymous.create(try createdRequest())
      XCTFail("A pack needs the map credential")
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

private func createdResponse() throws -> [String: Any] {
  let created = try contract()["created"] as! [String: Any]
  return try JSONSerialization.jsonObject(with: Data((created["body"] as! String).utf8))
    as! [String: Any]
}

private func createdRequest() throws -> OfflinePackRequest {
  try OfflinePackRequest.requests(
    mapID: "map_offlineofflineof", themes: ["light", "dark"],
    geometry: .boundingBox(
      TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
    zooms: OfflineZooms(range: 12...15))[0]
}

private func createdPack() throws -> OfflinePack {
  let created = try contract()["created"] as! [String: Any]
  return try OfflinePackContract.pack(
    Data((created["body"] as! String).utf8), request: createdRequest(), allowsLoopbackHTTP: false)
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
