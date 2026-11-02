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
        // Everything but the area, which the service now takes as the cover.
        let request = try XCTUnwrap(try built.get().first, name)
        let sent = try object(request.body).mutableCopy() as! NSMutableDictionary
        let expected = (canonical as! NSDictionary).mutableCopy() as! NSMutableDictionary
        XCTAssertNotNil(sent.object(forKey: "cover"), name)
        sent.removeObject(forKey: "cover")
        expected.removeObject(forKey: "region")
        XCTAssertEqual(sent, expected, name)
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
    XCTAssertEqual(manifest.excluded.map(\.source), ["boundaries"])
    XCTAssertEqual(
      manifest.sources.map(\.source), ["bathymetry", "bathymetry-dem", "nautical", "terrain", "world"])
    // The elevation model's base-zoom parents and Bathymetry's deepest zoom lie below the
    // download's first zoom, in bands the cover holds.
    XCTAssertEqual(manifest.sources.map(\.zooms), [9...9, 8...9, 10...14, 10...12, 10...14])
    XCTAssertEqual(manifest.sources.map(\.absentStatus), [204, 204, 204, 404, 404])
    XCTAssertEqual(manifest.sources.map(\.contentEncoding), ["gzip", nil, "gzip", nil, "gzip"])
    XCTAssertEqual(manifest.origins, ["https://api.tileflow.test"])
    // The zoom policy plans the same source zooms the service did.
    let zooms = try OfflineZooms(range: 10...14)
    XCTAssertEqual(zooms.zooms(sourceMinimum: 0, sourceMaximum: 15), 10...14)
    XCTAssertEqual(
      zooms.zooms(sourceMinimum: 0, sourceMaximum: min(14, zooms.terrainMaximum)), 10...12)

    let plan = OfflineVersionPlan.hosted(downloads: [download], requests: [try createdRequest()])
    XCTAssertEqual(plan.packs.map(\.pack.id), [
      "style", "assets", "glyphs/Noto Sans Regular/0", "tiles/bathymetry/7/62/48",
      "tiles/bathymetry-dem/7/62/48", "tiles/nautical/7/62/48", "tiles/nautical/11/1002/772",
      "tiles/nautical/11/1003/772", "tiles/terrain/7/62/48",
      "tiles/terrain/11/1002/772", "tiles/terrain/11/1003/772", "tiles/world/7/62/48",
      "tiles/world/11/1002/772", "tiles/world/11/1003/772",
    ])
    XCTAssertEqual(plan.resourceCount, 44)
    XCTAssertEqual(plan.billable, 32, "Only tiles are billable")
    XCTAssertTrue(plan.packs.filter { $0.pack.kind == .documents }.allSatisfy { $0.pack.billableResources == 0 })
    XCTAssertEqual(plan.bytes, 8_224)
    XCTAssertEqual(plan.resources.count, 1, "Discovery")
    XCTAssertEqual(
      plan.tileCounts,
      ["bathymetry": 1, "bathymetry-dem": 2, "nautical": 13, "terrain": 5, "world": 11])
    // Every tile pack's anchor starts its band; tiles the archive does not store are left out.
    var cover = 0
    for zoom in 10...14 { cover += covered(manifest.cover, zoom: zoom).count }
    XCTAssertLessThan(plan.tileCounts["world"]!, cover)
    for planned in plan.packs where planned.pack.kind == .tiles {
      let anchor = try XCTUnwrap(planned.pack.anchor)
      XCTAssertTrue(OfflinePackBand.anchors.contains(anchor.z))
      XCTAssertEqual(planned.release, manifest.source(planned.pack.source!)?.version)
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
      ("an unknown source", { pack(&$0) { $0["source"] = "boundaries" } }),
      ("another origin", { pack(&$0) { $0["url"] = "https://elsewhere.test/v1/offline/p.tfpack" } }),
      ("plain HTTP", { pack(&$0) { $0["url"] = "http://api.tileflow.test/v1/offline/p.tfpack" } }),
      ("larger than a pack can be", { pack(&$0) { $0["bytes"] = 33 * 1024 * 1024 } }),
      ("more billable than resources", { pack(&$0) { $0["billableResources"] = 1_000_000 } }),
      ("an unknown kind", { pack(&$0) { $0["kind"] = "models" } }),
      ("format 1", { $0["version"] = 1 }),
      ("another cover", { $0["coverSha256"] = String(repeating: "0", count: 64) }),
      ("no cover", { $0["coverSha256"] = nil }),
      (
        "a tile pack the cover does not list",
        { pack(&$0) { $0["anchor"] = [11, 1004, 772]; $0["id"] = "tiles/world/11/1004/772" } }
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
    // Downloads stopped by the service wait and try again; access has not ended.
    let stopped = OfflinePackContract.failure(
      status: 503, body: Data(#"{"code":"OFFLINE_DOWNLOADS_STOPPED","error":"x"}"#.utf8),
      retryAfter: "120", operation: .download, now: now)
    XCTAssertEqual(stopped.code, .unavailable)
    XCTAssertTrue(stopped.isRecoverable)
    XCTAssertEqual(stopped.retryAfter, 120)
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
    // The body the service's own fixture was created from, cover included.
    XCTAssertEqual(
      try object(create.httpBody!),
      try object(Data(contentsOf: packFixture("release-1/create-request.json"))))
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
    let open = TileflowOfflineGeometry.geometry(
      .polygon([[
        .init(longitude: -3.75, latitude: 40.38), .init(longitude: -3.62, latitude: 40.36),
        .init(longitude: -3.6, latitude: 40.47), .init(longitude: -3.72, latitude: 40.5),
      ]]))
    let polygon = try contract()["coverage"] as! [[String: Any]]
    XCTAssertEqual(try open.tileCount(zoom: 16), (polygon[0]["counts"] as! [Int])[16])
    XCTAssertEqual(try open.tileCount(zoomRange: 15...16), 196 + 715)

    // Regions have no limit on their positions, rings or parts.
    let square: [TileflowCoordinate] = [
      .init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 0),
      .init(longitude: 1, latitude: 1), .init(longitude: 0, latitude: 0),
    ]
    XCTAssertNoThrow(try TileflowOfflineGeometry.geometry(.polygon(Array(repeating: square, count: 17))).validate())
    XCTAssertNoThrow(
      try TileflowOfflineGeometry.geometryCollection(
        Array(repeating: .point(.init(longitude: 0, latitude: 0)), count: 65)
      ).validate())
    XCTAssertNoThrow(
      try TileflowOfflineGeometry.geometry(
        .lineString((0..<3_000).map { .init(longitude: Double($0) / 1000, latitude: 0) })
      ).validate())
    let invalid: [(TileflowOfflineGeometry, String)] = [
      (
        .geometry(.polygon([[.init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 1)]])),
        "tooFewPositions"
      ),
      (
        .geometry(
          .polygon([[
            .init(longitude: 0, latitude: 0), .init(longitude: 1, latitude: 1),
            .init(longitude: 2, latitude: 2),
          ]])), "emptyArea"
      ),

      (.geometry(.lineString([.init(longitude: 0, latitude: 0)])), "tooFewPositions"),
      (.geometry(.multiPoint([])), "tooFewPositions"),
      (
        .geometry(
          .lineString([.init(longitude: 179, latitude: 0), .init(longitude: -179, latitude: 0)])),
        "crossesAntimeridian"
      ),
      (.geometryCollection([]), "tooFewPositions"),
      (.geometry(.point(.init(longitude: 181, latitude: 0))), "invalidPosition"),
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

  func testGeoJSONCoverMatchesTheService() throws {
    let fixture = try fixture("geometry-cover") as! [String: Any]
    for item in fixture["covers"] as! [[String: Any]] {
      let name = item["name"] as! String
      let request = item["request"] as! [String: Any]
      let geometry: TileflowOfflineGeometry
      if request["type"] as! String == "bbox" {
        let box = request["bbox"] as! [Double]
        geometry = .boundingBox(
          TileflowBoundingBox(west: box[0], south: box[1], east: box[2], north: box[3]))
      } else {
        let text = String(
          decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
        geometry = try TileflowOfflineGeometry(geoJSON: text)
      }
      let region = try XCTUnwrap(OfflinePackRegion(json: json(item["region"]!)), name)
      XCTAssertEqual(try geometry.packRegions(), [region], name)
      XCTAssertEqual(try object(region.json), item["region"] as! NSDictionary, name)
      for (zoom, expected) in item["cover"] as! [String: [[Int]]] {
        let cover = OfflineTileCover(region, zoom: Int(zoom)!)
        let rows = cover.rows.map { rows in
          rows.flatMap { y in cover.row(y).map { [y, $0.lowerBound, $0.upperBound] } }
        }
        XCTAssertEqual(rows ?? [], expected, "\(name) z\(zoom)")
        XCTAssertEqual(
          try geometry.tileCount(zoom: Int(zoom)!),
          expected.reduce(0) { $0 + $1[2] - $1[1] + 1 }, "\(name) z\(zoom)")
      }
    }
  }

  func testCoversMatchTheService() throws {
    let fixture = try fixture("pack-lists") as! [String: Any]
    XCTAssertEqual(fixture["maxCoverEntries"] as? Int, OfflineCover.maximumEntries)
    XCTAssertEqual(fixture["maxBodyBytes"] as? Int, OfflinePackRequest.maximumBodyBytes)
    for item in fixture["cases"] as! [[String: Any]] {
      let name = item["name"] as! String
      let region = item["region"] as! [String: Any]
      let geometry: TileflowOfflineGeometry
      if region["type"] as! String == "bbox" {
        let box = region["bbox"] as! [Double]
        geometry = .boundingBox(
          TileflowBoundingBox(west: box[0], south: box[1], east: box[2], north: box[3]))
      } else {
        geometry = try TileflowOfflineGeometry(
          geoJSON: String(decoding: try JSONSerialization.data(withJSONObject: region), as: UTF8.self))
      }
      let (minZoom, maxZoom) = (item["minZoom"] as! Int, item["maxZoom"] as! Int)
      let cover = try OfflineCover.of(geometry.packRegions(), minZoom: minZoom, maxZoom: maxZoom)
      XCTAssertEqual(try json(item["cover"]!), cover.json, name)
      XCTAssertEqual(cover.sha256, item["coverSha256"] as? String, name)
      XCTAssertEqual(cover.text.utf8.count, item["coverBytes"] as? Int, name)
      // Read back as the service reads it, the cover is unchanged.
      XCTAssertEqual(OfflineCover(json: cover.json, minZoom: minZoom, maxZoom: maxZoom), cover, name)
      // Packs plan only from the entries whose band reaches the download's zooms.
      let packs = item["packs"] as! [[String: Any]]
      let planned = cover.entries.filter {
        OfflinePackBand.zooms(anchor: $0.anchor.z)!.upperBound >= minZoom
      }
      XCTAssertEqual(packs.count, planned.count, name)
      var total = 0
      for (pack, entry) in zip(packs, planned) {
        let anchor = pack["anchor"] as! [Int]
        XCTAssertEqual([entry.anchor.z, entry.anchor.x, entry.anchor.y], anchor, name)
        XCTAssertEqual(
          OfflineCover.maskZoom(anchor: entry.anchor.z, maxZoom: maxZoom), pack["maskZoom"] as? Int,
          name)
        let zooms = pack["zooms"] as! [Int]
        let tiles = cover.tiles(entry, zooms: zooms[0]...zooms[1])
        let byZoom = pack["tilesByZoom"] as! [String: Int]
        XCTAssertEqual(tiles.mapValues(\.count), Dictionary(uniqueKeysWithValues: byZoom.map { (Int($0)!, $1) }), "\(name) \(anchor)")
        // Every tile of the pack, and nothing beside it, is in the download.
        for (zoom, list) in tiles {
          XCTAssertTrue(list.allSatisfy(cover.contains), "\(name) z\(zoom)")
        }
        total += tiles.values.reduce(0) { $0 + $1.count }
      }
      XCTAssertEqual(total, (item["totals"] as! [String: Int])["tiles"], name)
      // The cover holds exactly the region's tiles at every zoom, also below the first.
      for zoom in 0...maxZoom {
        XCTAssertEqual(covered(cover, zoom: zoom).count, try geometry.tileCount(zoom: zoom), "\(name) z\(zoom)")
      }
    }
    for item in fixture["canonicalized"] as! [[String: Any]] {
      let (minZoom, maxZoom) = (item["minZoom"] as! Int, item["maxZoom"] as! Int)
      let cover = try XCTUnwrap(
        OfflineCover(json: try json(item["cover"]!), minZoom: minZoom, maxZoom: maxZoom))
      XCTAssertEqual(cover.json, try json(item["canonical"]!))
      XCTAssertEqual(cover.sha256, item["coverSha256"] as? String)
    }
    for item in fixture["refused"] as! [[String: Any]] where item["cover"] != nil {
      XCTAssertNil(
        OfflineCover(
          json: try json(item["cover"]!), minZoom: item["minZoom"] as! Int,
          maxZoom: item["maxZoom"] as! Int), item["reason"] as! String)
    }
  }

  func testRegionsTooComplexAreRefusedBeforeAnyRequest() throws {
    func refusal(_ geometry: TileflowOfflineGeometry, maxZoom: Int) throws -> TileflowOfflineError {
      do {
        _ = try OfflinePackRequest.requests(
          mapID: "map_offlinefixture00", themes: ["default"], geometry: geometry,
          zooms: OfflineZooms(range: 0...maxZoom))
      } catch let error as TileflowOfflineError {
        return error
      }
      XCTFail("Not refused")
      throw CancellationError()
    }
    // Greater London to z16 lists one pack per z16 tile: more than a download may.
    let london = TileflowOfflineGeometry.boundingBox(
      TileflowBoundingBox(west: -0.51, south: 51.29, east: 0.33, north: 51.69))
    XCTAssertEqual(try OfflinePackRequest.requests(
      mapID: "map_offlinefixture00", themes: ["default"], geometry: london,
      zooms: OfflineZooms(range: 0...15))[0].cover.entries.count, 23)
    let packs = try refusal(london, maxZoom: 16)
    XCTAssertEqual(packs.code, .regionTooComplex)
    XCTAssertEqual(packs.context.reason, "tooManyPacks")
    XCTAssertEqual(packs.context.limit, 16_384)
    XCTAssertEqual(packs.context.count, 18_195)
    // Thousands of scattered points each need a pack with a mask: a body larger than allowed.
    let points = (0..<4_900).map {
      TileflowCoordinate(longitude: Double($0 % 70) * 0.2, latitude: 40 + Double($0 / 70) * 0.15)
    }
    let bytes = try refusal(.geometry(.multiPoint(points)), maxZoom: 15)
    XCTAssertEqual(bytes.code, .regionTooComplex)
    XCTAssertEqual(bytes.context.reason, "bodyTooLarge")
    XCTAssertEqual(bytes.context.limit, 262_144)
    XCTAssertGreaterThan(bytes.context.count ?? 0, 262_144)
    // The service's own refusals of size read the same way.
    let tooMany = OfflinePackContract.failure(
      status: 422, body: Data(#"{"code":"OFFLINE_PACK_TOO_LARGE","maxCoverEntries":16384}"#.utf8),
      retryAfter: nil, operation: .create, now: Date())
    XCTAssertEqual(tooMany.code, .regionTooComplex)
    XCTAssertEqual(tooMany.context.limit, 16_384)
    let tooLarge = OfflinePackContract.failure(
      status: 413, body: Data(#"{"code":"OFFLINE_PACK_BODY_TOO_LARGE","maxBodyBytes":262144}"#.utf8),
      retryAfter: nil, operation: .create, now: Date())
    XCTAssertEqual(tooLarge.code, .regionTooComplex)
    XCTAssertEqual(tooLarge.context.limit, 262_144)
  }

  func testGeoJSONGeometriesAreReadAndKeptMapboxStyle() throws {
    let text = """
      {"type": "GeometryCollection", "geometries": [
        {"type": "Polygon", "coordinates": [[[-3.72, 40.4], [-3.68, 40.4], [-3.68, 40.43],
          [-3.72, 40.43]]]},
        {"type": "LineString", "coordinates": [[-3.75, 40.38, 650], [-3.6, 40.5]]},
        {"type": "Point", "coordinates": [-3.7, 89]}
      ]}
      """
    let geometry = try TileflowOfflineGeometry(geoJSON: text)
    guard case .geometryCollection(let parts) = geometry else { return XCTFail("\(geometry)") }
    XCTAssertEqual(parts.count, 3)
    // The open ring is closed, the altitude dropped and the latitude clamped to the map's.
    let regions = try geometry.packRegions()
    let expected = try json([
      "type": "GeometryCollection",
      "geometries": [
        [
          "type": "Polygon",
          "coordinates": [[[-3.72, 40.4], [-3.68, 40.4], [-3.68, 40.43], [-3.72, 40.43], [-3.72, 40.4]]],
        ],
        ["type": "LineString", "coordinates": [[-3.75, 40.38], [-3.6, 40.5]]],
        ["type": "Point", "coordinates": [-3.7, 85.051129]],
      ],
    ])
    XCTAssertEqual(regions.map(\.json), [expected])
    XCTAssertEqual(OfflinePackRegion(json: expected), regions.first)
    // Kept with the region exactly as given.
    let options = TileflowOfflineRegionLoadOptions(
      geometry: geometry, content: .hosted(mapID: "map_offlineofflineof", themes: ["light"]))
    XCTAssertEqual(TileflowOfflineRegionLoadOptions(json: options.json), options)
    let nested = #"{"type": "GeometryCollection", "geometries": [{"type": "GeometryCollection", "geometries": []}]}"#
    for invalid in ["", "{}", #"{"type": "Feature", "geometry": null}"#, "[1, 2]", nested] {
      XCTAssertThrowsError(try TileflowOfflineGeometry(geoJSON: invalid), invalid) {
        XCTAssertEqual(($0 as? TileflowOfflineError)?.context.reason, "invalidGeoJSON")
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

/// The tiles a cover holds at `zoom`.
func covered(_ cover: OfflineCover, zoom: Int) -> [OfflineTileID] {
  cover.entries.flatMap { cover.tiles($0, zooms: zoom...zoom)[zoom] ?? [] }
    .sorted { ($0.y, $0.x) < ($1.y, $1.x) }
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
