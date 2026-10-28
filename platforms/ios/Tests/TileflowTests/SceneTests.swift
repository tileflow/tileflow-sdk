import CoreGraphics
import Foundation
import XCTest

@testable import Tileflow

@MainActor
final class SceneTests: XCTestCase {
  private let geoJSON = Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)

  func testRendererOptionsStayOutOfTheLiveOptionsAndVegetationFollowsTheMap() throws {
    let options = TileflowMapOptions(vegetation: false, antialias: false, validatesStyle: true)
    let wire = try JSONValue.encoded(options)
    XCTAssertEqual(wire["vegetation"]?.bool, false)
    // Antialiasing and validation start a new renderer; they never reach setOptions.
    XCTAssertNil(wire["antialias"])
    XCTAssertNil(wire["validatesStyle"])
    XCTAssertNil(try JSONValue.encoded(TileflowMapOptions())["vegetation"])
    XCTAssertTrue(TileflowMapOptions().antialias)
    XCTAssertFalse(TileflowMapOptions().validatesStyle)
  }

  func testLayersTakeRouteInksPlacementAndProgressOnlyWhereTheyApply() throws {
    let route = try TileflowGeoJSONLayer(
      id: "route-line", geoJSON: geoJSON, kind: .line, ink: .line, placement: .ground,
      occludedOpacity: 0.35, progress: TileflowLineProgress(end: 0.25, highlight: "#ffffff"))
    let value = route.wireValue(
      data: DataChannel.Reference(id: "data", byteLength: 1, sha256: "digest"))
    XCTAssertEqual(value["ink"]?.string, "line")
    XCTAssertEqual(value["placement"]?.string, "ground")
    XCTAssertEqual(value["occludedOpacity"]?.number, 0.35)
    XCTAssertEqual(value["progress"]?["end"]?.number, 0.25)
    XCTAssertEqual(value["progress"]?["highlight"]?.string, "#ffffff")
    if case .null? = value["progress"]?["light"] {} else { XCTFail("No light is sent as null.") }
    for invalid in [
      { try TileflowGeoJSONLayer(id: "a", geoJSON: self.geoJSON, kind: .fill, progress: .init()) },
      // A line above the map is never hidden, so it has nothing to show through.
      { try TileflowGeoJSONLayer(id: "a", geoJSON: self.geoJSON, kind: .line, occludedOpacity: 1) },
      {
        try TileflowGeoJSONLayer(
          id: "a", geoJSON: self.geoJSON, kind: .line, progress: .init(end: 2))
      },
      {
        try TileflowGeoJSONLayer(
          id: "a", geoJSON: self.geoJSON, kind: .line, progress: .init(highlight: "white"))
      },
    ] {
      XCTAssertThrowsError(try invalid())
    }
  }

  func testBoundaryRowsTravelInKeyOrderAndCheckTheirKeys() throws {
    let values = TileflowBoundaryValues(ids: [20: "high", 3: 4.5], labels: true, state: "share")
    let (joinBy, data) = try values.rowsJSON()
    XCTAssertEqual(joinBy, "id")
    XCTAssertEqual(String(decoding: data, as: UTF8.self), #"[[3,4.5],[20,"high"]]"#)
    XCTAssertEqual(try TileflowBoundaryValues(refs: ["ES-MD": 1]).rowsJSON().joinBy, "ref")
    XCTAssertThrowsError(try TileflowBoundaryValues(ids: [-1: 1]).rowsJSON())
    XCTAssertThrowsError(try TileflowBoundaryValues(ids: [1: 1], state: "a state").rowsJSON())
    XCTAssertThrowsError(try TileflowBoundaryValues(ids: [1: .number(.nan)]).rowsJSON())
  }

  func testImagesMarkersAndShotsCheckTheirParameters() throws {
    XCTAssertThrowsError(try TileflowMapImage(name: "../pin", data: Data([1])))
    XCTAssertThrowsError(try TileflowMapImage(name: "pin", data: Data([1]), pixelRatio: 8))
    XCTAssertThrowsError(try TileflowMapImage(name: "pin", data: Data()))
    let marker = TileflowDepthMarker(
      id: "cafe", coordinate: .init(longitude: -3.7, latitude: 40.42), image: "pin",
      size: CGSize(width: 24, height: 32), anchor: .bottom, altitude: 12)
    let wire = try marker.wireValue()
    XCTAssertEqual(wire["anchor"]?.string, "bottom")
    XCTAssertEqual(wire["occlude"]?.bool, true)
    var far = marker
    far.altitude = 20_000
    XCTAssertThrowsError(try far.wireValue())

    let start = TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 13)
    let end = TileflowCamera(longitude: -3.69, latitude: 40.42, zoom: 15, pitch: 60)
    let shot = TileflowShot(
      keyframes: [.init(time: 0, camera: start), .init(time: 2.5, camera: end)],
      cues: [.init(time: 1, id: "title")])
    let value = try shot.wireValue()
    guard case .array(let frames)? = value["keyframes"] else { return XCTFail("No keyframes.") }
    XCTAssertEqual(frames.last?["at"]?.number, 2500)
    XCTAssertEqual(value["cues"].flatMap { if case .array(let cues) = $0 { cues } else { nil } }?
      .first?["at"]?.number, 1000)
    for invalid in [
      TileflowShot(keyframes: [.init(time: 0.5, camera: start), .init(time: 1, camera: end)]),
      TileflowShot(keyframes: [.init(time: 0, camera: start), .init(time: 0, camera: end)]),
      TileflowShot(keyframes: [.init(time: 0, camera: start)]),
      TileflowShot(
        keyframes: [.init(time: 0, camera: start), .init(time: 1, camera: end)],
        cues: [.init(time: 2, id: "late")]),
      // Blend positions need the themes, and themes need a position at every keyframe.
      TileflowShot(
        keyframes: [
          .init(time: 0, camera: start, blendPosition: 0), .init(time: 1, camera: end),
        ]),
      TileflowShot(
        keyframes: [
          .init(time: 0, camera: start, blendPosition: 0), .init(time: 1, camera: end),
        ], themes: ["day", "night"]),
    ] {
      XCTAssertThrowsError(try invalid.wireValue())
    }
  }

  func testThemeTransitionsReportEveryPhaseAndTheSettledInks() throws {
    let ready = TileflowThemeTransition(
      wire: .object([
        "phase": .string("ready"), "currentTheme": .string("dark"),
        "targetTheme": .string("dark"),
        "routeInks": try .encoded(
          [
            "line": "#60a5fa", "casing": "#0b1220", "core": "#eff6ff", "glow": "#60a5fa",
            "alternative": "#64748b",
          ].mapValues(JSONValue.string).merging(
            ["glowOpacity": .number(0.4), "coreOpacity": .number(0.7)], uniquingKeysWith: { a, _ in a })),
      ]))
    XCTAssertEqual(ready?.phase, .ready)
    XCTAssertEqual(ready?.routeInks, .dark)
    XCTAssertEqual(ready?.routeInks?[.glow], "#60a5fa")
    let failed = TileflowThemeTransition(
      wire: .object(["phase": .string("error"), "targetTheme": .string("night")]))
    XCTAssertEqual(failed?.phase, .failed)
    XCTAssertNil(failed?.currentTheme)
    XCTAssertNil(TileflowThemeTransition(wire: .object(["phase": .string("done")])))
  }

  func testEssentialEventsIncludeThemeTransitionsAndAnimationEnds() {
    let events = EventSubscriptions(application: .init(level: .essential)).events
    for event in [ProtocolContract.Event.themeTransition, .animationEnded, .shotCue] {
      XCTAssertEqual(events[event], 0, "\(event)")
    }
  }

  func testANewRendererReceivesTheSceneAtOnceAndInOrder() throws {
    var state = SceneState()
    state.depthMarkers = SceneCommand(.setDepthMarkers, payload: .object(["markers": .array([])]))
    state.images = SceneCommand(.setImages, payload: .object(["images": .array([])]))
    state.sun = SceneCommand(.setSun, payload: .object(["sun": .null, "duration": .number(450)]))
    state.setStyleState(
      "traffic", SceneCommand(.setStyleState, payload: .object(["duration": .number(250)])))
    state.setStyleState(
      "night", SceneCommand(.setStyleState, payload: .object(["duration": .number(0)])))
    state.setStyleState(
      "traffic", SceneCommand(.setStyleState, payload: .object(["duration": .number(100)])))
    XCTAssertEqual(
      state.commands.map(\.method),
      [.setImages, .setDepthMarkers, .setSun, .setStyleState, .setStyleState])
    XCTAssertEqual(state.styleStates.map(\.name), ["night", "traffic"])
    let channel = DataChannel()
    let (replayed, _) = try state.sun!.build(channel, true)
    XCTAssertEqual(replayed["duration"]?.number, 0)
    let (sent, _) = try state.sun!.build(channel, false)
    XCTAssertEqual(sent["duration"]?.number, 450)
  }

  func testAnimationWaitsEndWithTheirRendererAndCallCuesBack() async throws {
    let waiters = AnimationWaiters()
    // An end that arrives first is kept for the call that learns its identifier.
    waiters.receive(
      "animationEnded", .object(["animation": .string("a1"), "finished": .bool(true)]))
    let early = try await waiters.wait(for: "a1", onCue: nil)
    XCTAssertTrue(early)
    final class Cues { var received: [String] = [] }
    let cues = Cues()
    let shot = Task { try await waiters.wait(for: "a2", onCue: { cues.received.append($0) }) }
    await Task.yield()
    waiters.receive("shotCue", .object(["animation": .string("a2"), "cue": .string("title")]))
    waiters.receive(
      "animationEnded", .object(["animation": .string("a2"), "finished": .bool(false)]))
    let finished = try await shot.value
    XCTAssertFalse(finished)
    XCTAssertEqual(cues.received, ["title"])
    let replaced = Task { try await waiters.wait(for: "a3", onCue: nil) }
    await Task.yield()
    waiters.retire(.cancelled)
    do {
      _ = try await replaced.value
      XCTFail("A replaced renderer's animation did not fail.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .cancelled)
    }
  }

  func testSceneCallsCheckTheirParametersBeforeTheRenderer() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example.com/manifest.json")!))
    defer { view.destroy() }
    // Without a renderer, the scene is kept for the next one.
    try await view.setSun(.direction(azimuth: 120, altitude: 30))
    try await view.setStyleState("traffic", to: 0.5)
    try await view.setViewMode(.threeDimensional, duration: 1)
    XCTAssertEqual(view.options.viewMode, .threeDimensional)
    XCTAssertEqual(view.scene.commands.count, 2)
    for invalid in [
      { try await view.setSun(.direction(azimuth: 0, altitude: 91)) },
      { try await view.setSun(nil, duration: 6) },
      { try await view.setStyleState(" padded", to: true) },
      { try await view.setEmphasis(.init(recede: ["Roads": 0.5])) },
      { try await view.setEmphasis(.init(labels: 2)) },
      {
        try await view.setDepthMarkers(
          Array(
            repeating: TileflowDepthMarker(
              id: "same", coordinate: .init(longitude: 0, latitude: 0), image: "pin",
              size: .zero), count: 2))
      },
    ] {
      do {
        try await invalid()
        XCTFail("An invalid scene request was accepted.")
      } catch {
        XCTAssertEqual(error as? TileflowMapError, .invalidRequest)
      }
    }
    do {
      _ = try await view.routeInks()
      XCTFail("Route inks need a renderer.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .notReady)
    }
  }
}
