import Foundation
import XCTest

@testable import Tileflow

/// The addresses MapLibre Native requests for a mounted map, and the style document it receives.
final class NativeStyleDocumentTests: XCTestCase {
  private let context = MapResourceAddress.newContext()

  func testHostedManifestSelectsThePublicIdentityAndKeepsItsAuthoredName() async throws {
    let entry: [String: Any] = [
      "mapId": "map_requested", "defaultTheme": "day",
      "systemThemes": ["light": "day", "dark": "night"],
      "themes": ["day": ["styleUrl": "main/day.json"], "night": ["styleUrl": "main/night.json"]],
    ]
    var other = entry
    other["mapId"] = "map_other"
    let manifest = try await hostedManifest(["map": other, "main": entry])

    XCTAssertEqual(manifest.map, "main")
    XCTAssertEqual(manifest.representation, .native)
    XCTAssertEqual(try manifest.resolve("system", colorScheme: "dark").styleURL.absoluteString,
      "https://maps.test/native/main/night.json")
    XCTAssertEqual(manifest.familyURL(styleURL: try manifest.theme("day").styleURL)?.absoluteString,
      "https://maps.test/native/families/main.json")
    XCTAssertEqual(manifest.family?.revision, "revision")
  }

  func testHostedManifestRejectsMissingAndAmbiguousPublicIdentities() async throws {
    let entry: [String: Any] = [
      "defaultTheme": "day", "themes": ["day": ["styleUrl": "day.json"]],
    ]
    var requested = entry
    requested["mapId"] = "map_requested"
    var other = entry
    other["mapId"] = "map_other"

    for maps in [["map": entry], ["map": other], ["map": requested, "main": requested]] {
      do {
        _ = try await hostedManifest(maps)
        XCTFail("A Hosted manifest without exactly one matching public identity opened")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error.code, .resourceFailed)
        XCTAssertEqual(error.context.resource, .manifest)
      }
    }
  }

  func testSelfHostedManifestStillSelectsOnlyTheAuthoredName() async throws {
    let url = URL(string: "https://maps.test/manifest.json")!
    let document: [String: Any] = ["maps": ["main": [
      "mapId": "different", "defaultTheme": "day", "themes": ["day": ["styleUrl": "day.json"]],
    ]]]
    let manifest = try await NativeManifest.load(
      map: "main", manifestURL: url, discoveryMapID: nil, read: { _, _ in document })
    XCTAssertEqual(manifest.map, "main")

    do {
      _ = try await NativeManifest.load(
        map: "different", manifestURL: url, discoveryMapID: nil, read: { _, _ in document })
      XCTFail("A self-hosted source selected a public identity instead of its authored name")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .resourceFailed)
    }
  }

  private func hostedManifest(_ maps: [String: Any]) async throws -> NativeManifest {
    let discovery = URL(string: "https://maps.test/mobile/manifest.json")!
    let profile = URL(string: "https://maps.test/native/manifest.json")!
    return try await NativeManifest.load(
      map: "map", manifestURL: discovery, discoveryMapID: "map_requested"
    ) { url, _ in
      if url == discovery {
        return ["mapId": "map_requested", "representations": ["native-v1": [
          "manifestUrl": profile.absoluteString,
          "family": ["url": "https://maps.test/native/families/main.json", "revision": "revision"],
        ]]]
      }
      XCTAssertEqual(url, profile)
      return ["maps": maps]
    }
  }

  func testHostedWebOnlyDocumentsCanOpenFromAPackButNeverFromTheNetwork() async throws {
    let map = "city"
    let discovery = URL(string: "https://maps.test/maps/city/mobile/manifest.json")!
    let web = discovery.deletingLastPathComponent().appendingPathComponent("webview-v1/manifest.json")
    var requests: [URL] = []

    func read(_ url: URL, _: TileflowResourceKind) async throws -> [String: Any] {
      requests.append(url)
      if url == discovery {
        return ["mapId": map, "representations": ["webview-v1": ["manifestUrl": web.absoluteString]]]
      }
      XCTAssertEqual(url, web)
      return ["maps": ["map": [
        "mapId": map, "defaultTheme": "day", "themes": ["day": ["styleUrl": "day.json"]],
      ]]]
    }

    do {
      _ = try await NativeManifest.load(map: map, manifestURL: discovery, discoveryMapID: map, read: read)
      XCTFail("Online discovery must announce a native profile")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code.rawValue, "nativePublicationRequired")
      XCTAssertTrue(error.description.contains(#"platforms: ["web", "native"]"#))
      XCTAssertEqual(error.context.resource, .manifest)
    }
    XCTAssertEqual(requests, [discovery])

    requests.removeAll()
    let stored = try await NativeManifest.load(
      map: map, manifestURL: discovery, discoveryMapID: map, fromPacks: true, read: read)
    XCTAssertEqual(stored.representation, .webView)
    XCTAssertEqual(stored.map, "map")
    XCTAssertEqual(requests, [discovery, web])
    XCTAssertEqual(try stored.theme("day").styleURL, web.deletingLastPathComponent().appendingPathComponent("day.json"))
  }

  func testAddressesKeepTheEnginesSubstitutionsInThePathBeforeTheQuery() throws {
    XCTAssertEqual(context.count, 22)
    XCTAssertNotEqual(context, MapResourceAddress.newContext())
    let template = "https://tiles.example.com:8443/world/{z}/{x}/{y}.pbf?map=m_1&v=2"
    let projected = try XCTUnwrap(MapResourceAddress.encode(template, context: context))
    XCTAssertTrue(projected.hasPrefix("https://tileflow.invalid/\(context)/"))
    XCTAssertTrue(projected.hasSuffix("/world/{z}/{x}/{y}.pbf?map=m_1&v=2"))
    XCTAssertFalse(projected.contains("tiles.example.com"))

    // What the engine requests once it substituted a tile, a sprite variant and a glyph range.
    for (requested, remote) in [
      (
        projected.replacingOccurrences(of: "{z}/{x}/{y}", with: "14/8013/6200"),
        "https://tiles.example.com:8443/world/14/8013/6200.pbf?map=m_1&v=2"
      ),
      (
        MapResourceAddress.encode("https://a.test/sprites/s/sprite?release=1", context: context)!
          .replacingOccurrences(of: "sprite?", with: "sprite@2x.json?"),
        "https://a.test/sprites/s/sprite@2x.json?release=1"
      ),
      (
        MapResourceAddress.encode("https://a.test/fonts/{fontstack}/{range}.pbf", context: context)!
          .replacingOccurrences(of: "{fontstack}/{range}", with: "Fixture%20Sans%2c%20Bold/0-255"),
        "https://a.test/fonts/Fixture%20Sans%2c%20Bold/0-255.pbf"
      ),
    ] {
      let decoded = try XCTUnwrap(MapResourceAddress.decode(URL(string: requested)!), requested)
      XCTAssertEqual(decoded.context, context)
      XCTAssertEqual(decoded.remote.absoluteString, remote)
    }
  }

  func testOnlyWellFormedAddressesDecode() {
    XCTAssertNil(MapResourceAddress.encode("pmtiles://https://a.test/x.pmtiles", context: context))
    XCTAssertNil(MapResourceAddress.encode("file:///tmp/x", context: context))
    XCTAssertNil(MapResourceAddress.encode("https://user@a.test/x", context: context))
    let origin = Data("https://a.test".utf8).base64EncodedString()
      .replacingOccurrences(of: "=", with: "")
    for text in [
      "https://tileflow.invalid/short/\(origin)/x",
      "https://elsewhere.test/\(context)/\(origin)/x",
      "https://tileflow.invalid/\(context)/!!!/x",
      // An origin that carries a path or credentials is not an origin.
      "https://tileflow.invalid/\(context)/\(Data("https://u@a.test".utf8).base64EncodedString())/x",
      "https://tileflow.invalid/\(context)/\(Data("ftp://a.test".utf8).base64EncodedString())/x",
    ] {
      XCTAssertNil(MapResourceAddress.decode(URL(string: text)!), text)
    }
    XCTAssertEqual(
      MapResourceAddress.resolve(
        "../../tiles/{z}/{x}/{y}.pbf", against: "https://a.test/maps/m/style.json"),
      "https://a.test/tiles/{z}/{x}/{y}.pbf")
  }

  func testTheEngineReceivesTheStyleWithItsTileJSONEmbeddedAndEveryAddressProjected() async throws {
    let styleURL = URL(string: "https://a.test/maps/m/v1/day.json")!
    let style: [String: Any] = [
      "version": 8,
      "sprite": "../../../sprites/streets/sprite",
      "glyphs": "https://a.test/fonts/{fontstack}/{range}.pbf",
      "font-faces": [
        "Noto Sans Regular": "../../../fonts/NotoSans-Regular.ttf",
        "DINish Medium": [
          ["url": "https://b.test/DINish-Medium.ttf", "unicode-range": ["U+0000-024F"]]
        ],
      ],
      "sources": [
        "world": ["type": "vector", "url": "https://a.test/tiles/world/tiles.json?map=m"],
        "relief": [
          "type": "raster-dem", "url": "https://a.test/tiles/dem/tiles.json", "minzoom": 2,
          "encoding": "terrarium",
        ],
        "places": ["type": "geojson", "data": "./places.geojson"],
        "inline": ["type": "geojson", "data": ["type": "FeatureCollection", "features": []]],
        "archive": ["type": "vector", "url": "pmtiles://https://a.test/archive.pmtiles"],
        "photo": [
          "type": "image", "url": "https://a.test/photo.png",
          "coordinates": [[0, 1], [1, 1], [1, 0], [0, 0]],
        ],
      ],
      "layers": [["id": "background", "type": "background"]],
    ]
    let tileJSONs: [String: [String: Any]] = [
      "https://a.test/tiles/world/tiles.json?map=m": [
        "tiles": ["./1/{z}/{x}/{y}.pbf?map=m"], "minzoom": 0, "maxzoom": 14,
        "attribution": "© World", "vector_layers": [["id": "building"]],
      ],
      "https://a.test/tiles/dem/tiles.json": [
        "tiles": ["https://a.test/tiles/dem/1/{z}/{x}/{y}.webp"], "maxzoom": 9,
        "attribution": "© World",
      ],
    ]
    var loaded: [String] = []
    let load: NativeStyleDocument.Load = { url, kind in
      XCTAssertEqual(kind, .source)
      loaded.append(url.absoluteString)
      return try XCTUnwrap(tileJSONs[url.absoluteString])
    }
    let online = try await NativeStyleDocument.project(
      style, styleURL: styleURL, context: context, load: load)
    let document = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(online.json.utf8)) as? [String: Any])
    func remote(_ value: Any?) throws -> String {
      try XCTUnwrap(MapResourceAddress.decode(URL(string: XCTUnwrap(value as? String))!)).remote
        .absoluteString
    }
    let sources = try XCTUnwrap(document["sources"] as? [String: [String: Any]])
    XCTAssertNil(sources["world"]?["url"])
    XCTAssertEqual(sources["world"]?["maxzoom"] as? Int, 14)
    XCTAssertNotNil(sources["world"]?["vector_layers"])
    let worldTiles = try XCTUnwrap(sources["world"]?["tiles"] as? [String])
    // Relative to the TileJSON, placeholders intact.
    XCTAssertTrue(worldTiles[0].contains("/1/{z}/{x}/{y}.pbf?map=m"))
    XCTAssertEqual(
      try remote(worldTiles[0].replacingOccurrences(of: "{z}/{x}/{y}", with: "1/2/3")),
      "https://a.test/tiles/world/1/1/2/3.pbf?map=m")
    XCTAssertEqual(sources["relief"]?["minzoom"] as? Int, 2, "Online, the source keeps its zooms")
    XCTAssertEqual(try remote(sources["places"]?["data"]), "https://a.test/maps/m/v1/places.geojson")
    XCTAssertNotNil(sources["inline"]?["data"] as? [String: Any])
    let archive = try XCTUnwrap(sources["archive"]?["url"] as? String)
    XCTAssertTrue(archive.hasPrefix("pmtiles://https://tileflow.invalid/\(context)/"))
    XCTAssertEqual(try remote(sources["photo"]?["url"]), "https://a.test/photo.png")
    XCTAssertEqual(try remote(document["sprite"]), "https://a.test/sprites/streets/sprite")
    XCTAssertTrue((document["glyphs"] as? String)?.hasSuffix("/fonts/{fontstack}/{range}.pbf") == true)
    let faces = try XCTUnwrap(document["font-faces"] as? [String: Any])
    XCTAssertEqual(try remote(faces["Noto Sans Regular"]), "https://a.test/fonts/NotoSans-Regular.ttf")
    let dinish = try XCTUnwrap((faces["DINish Medium"] as? [[String: Any]])?.first)
    XCTAssertEqual(try remote(dinish["url"]), "https://b.test/DINish-Medium.ttf")
    XCTAssertEqual(dinish["unicode-range"] as? [String], ["U+0000-024F"])
    XCTAssertEqual(Set(loaded), Set(tileJSONs.keys))
    XCTAssertEqual(online.attributions, ["© World"], "Repeated attributions appear once")
    XCTAssertEqual(online.omitted, [])

    XCTAssertEqual(online.kind(of: URL(string: "https://a.test/tiles/world/1/3/4/5.pbf?map=m")!), .tile)
    XCTAssertEqual(online.kind(of: URL(string: "https://a.test/sprites/streets/sprite@2x.png")!), .sprite)
    XCTAssertEqual(online.kind(of: URL(string: "https://a.test/fonts/A%20B/0-255.pbf")!), .glyphs)
    XCTAssertEqual(online.kind(of: URL(string: "https://a.test/fonts/NotoSans-Regular.ttf")!), .font)
    XCTAssertEqual(online.kind(of: URL(string: "https://a.test/maps/m/v1/places.geojson")!), .data)

    // Opened from downloaded regions that store the elevation model from z8: the engine never
    // asks for the ancestors below it.
    let fromPacks = try await NativeStyleDocument.project(
      style, styleURL: styleURL, context: context, load: load,
      storedZooms: { template in
        template == "https://a.test/tiles/dem/1/{z}/{x}/{y}.webp" ? 8...9 : 13...15
      })
    let packed = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(fromPacks.json.utf8)) as? [String: Any])
    let packedSources = try XCTUnwrap(packed["sources"] as? [String: [String: Any]])
    XCTAssertEqual(packedSources["relief"]?["minzoom"] as? Int, 8)
    XCTAssertEqual(
      packedSources["world"]?["minzoom"] as? Int, 0, "Only elevation sources change their zooms")
  }

  /// An image covering the Web Mercator world reaches the engine as a raster source whose one
  /// zoom-0 tile is the image: MapLibre Native counts a raster source no layer needs as loaded, but
  /// an image source only once it has drawn it. Any other image stays an image source.
  func testAWorldImageBecomesTheOneTileOfARasterSource() async throws {
    let latitude = NativeStyleDocument.mercatorLatitude
    let style: [String: Any] = [
      "version": 8,
      "sources": [
        "underlay": [
          "type": "image", "url": "../../images/m/underlay.png", "attribution": "© Climate",
          "coordinates": [[-180, latitude], [180, latitude], [180, -latitude], [-180, -latitude]],
        ],
        "photo": [
          "type": "image", "url": "https://a.test/photo.png",
          "coordinates": [[0, 1], [1, 1], [1, 0], [0, 0]],
        ],
        "mirrored": [
          "type": "image", "url": "https://a.test/mirrored.png",
          "coordinates": [[180, latitude], [-180, latitude], [-180, -latitude], [180, -latitude]],
        ],
      ],
      "layers": [
        ["id": "underlay", "type": "raster", "source": "underlay", "maxzoom": 11],
        ["id": "photo", "type": "raster", "source": "photo"],
      ],
    ]
    let projected = try await NativeStyleDocument.project(
      style, styleURL: URL(string: "https://a.test/maps/m/v1/day.json")!, context: context,
      load: { _, _ in [:] })
    let document = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(projected.json.utf8)) as? [String: Any])
    let sources = try XCTUnwrap(document["sources"] as? [String: [String: Any]])
    let underlay = try XCTUnwrap(sources["underlay"])
    XCTAssertEqual(underlay["type"] as? String, "raster")
    XCTAssertEqual(underlay["minzoom"] as? Int, 0)
    XCTAssertEqual(underlay["maxzoom"] as? Int, 0)
    XCTAssertEqual(underlay["attribution"] as? String, "© Climate")
    XCTAssertNil(underlay["coordinates"])
    let tiles = try XCTUnwrap(underlay["tiles"] as? [String])
    XCTAssertEqual(tiles.count, 1)
    let remote = try XCTUnwrap(MapResourceAddress.decode(XCTUnwrap(URL(string: tiles[0])))).remote
    XCTAssertEqual(remote.absoluteString, "https://a.test/maps/images/m/underlay.png")
    XCTAssertEqual(projected.kind(of: remote), .image, "The transport still reads it as an image")
    XCTAssertEqual(sources["photo"]?["type"] as? String, "image")
    XCTAssertEqual(sources["mirrored"]?["type"] as? String, "image", "Corners keep their order")
    XCTAssertEqual(projected.attributions, ["© Climate"])
  }

  func testRemoteAddressesTheSDKCannotOwnAreRejectedBeforeRendering() async throws {
    let sources = [
      ["type": "geojson", "data": "//app@blocked.test/points.geojson"],
      ["type": "vector", "url": "pmtiles://https://app@blocked.test/tiles.pmtiles"],
    ]
    for source in sources {
      let style: [String: Any] = ["version": 8, "sources": ["bad": source], "layers": []]
      do {
        _ = try await NativeStyleDocument.project(
          style, styleURL: URL(string: "https://a.test/style.json")!, context: context,
          load: { _, _ in XCTFail("Invalid address reached the loader"); return [:] })
        XCTFail("An unowned network address reached the renderer")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error, .resourceFailed)
      }
    }
  }

  func testProviderAliasesCannotEscapeTheMapTransport() async throws {
    let style: [String: Any] = [
      "version": 8, "glyphs": "maplibre://fonts/{fontstack}/{range}.pbf",
      "sources": [:], "layers": [],
    ]
    do {
      _ = try await NativeStyleDocument.project(
        style, styleURL: URL(string: "https://a.test/style.json")!, context: context,
        load: { _, _ in XCTFail("Provider alias reached the loader"); return [:] })
      XCTFail("An unowned provider alias reached the renderer")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .resourceFailed)
    }
  }

  /// A style that draws its labels with web fonts has no glyphs for the engine; its text is left
  /// out so the rest of the map draws.
  func testTextWithoutGlyphsOrFontFacesIsLeftOut() async throws {
    let style: [String: Any] = [
      "version": 8, "sources": [:],
      "layers": [
        [
          "id": "label", "type": "symbol", "source": "places",
          "layout": ["text-field": ["get", "name"], "icon-image": "dot"],
        ]
      ],
    ]
    let projected = try await NativeStyleDocument.project(
      style, styleURL: URL(string: "https://a.test/style.json")!, context: context,
      load: { _, _ in [:] })
    XCTAssertEqual(projected.omitted, ["text"])
    let document = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(projected.json.utf8)) as? [String: Any])
    let layout = (document["layers"] as? [[String: Any]])?.first?["layout"] as? [String: Any]
    XCTAssertNil(layout?["text-field"])
    XCTAssertEqual(layout?["icon-image"] as? String, "dot")
  }
}
