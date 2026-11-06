import Darwin
import MapLibre
import Metal
import Tileflow
import UIKit
import os

@MainActor
private final class RenderProbe: NSObject, MLNMapViewDelegate {
  // The renderer and its original delegate are only changed on the main thread.
  nonisolated(unsafe) private weak var original: (any MLNMapViewDelegate)?
  private let featureAttribute: String
  private let signposter = OSSignposter(subsystem: "dev.tileflow.benchmark", category: "Streets")
  private var firstUsefulFrame: TimeInterval?
  private var isMeasuring = false
  private var frameTimes: [TimeInterval] = []

  init(renderer: MLNMapView) {
    original = renderer.delegate
    featureAttribute = launchArgument("--feature-attribute") ?? "render_height"
    super.init()
    frameTimes.reserveCapacity(1024)
    renderer.delegate = self
  }

  nonisolated override func responds(to selector: Selector!) -> Bool {
    super.responds(to: selector) || original?.responds(to: selector) == true
  }

  nonisolated override func forwardingTarget(for selector: Selector!) -> Any? {
    original
  }

  nonisolated func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) {
    MainActor.assumeIsolated {
      let time = CACurrentMediaTime()
      if isMeasuring { frameTimes.append(time) }
      if firstUsefulFrame == nil, fullyRendered,
        mapView.visibleFeatures(in: mapView.bounds).contains(where: {
          $0.attribute(forKey: featureAttribute) != nil
        })
      {
        firstUsefulFrame = time
        signposter.emitEvent("First useful Streets frame")
      }
      original?.mapViewDidFinishRenderingFrame?(mapView, fullyRendered: fullyRendered)
    }
  }

  func waitForUsefulFrame() async throws -> TimeInterval {
    let deadline = CACurrentMediaTime() + 45
    while CACurrentMediaTime() < deadline {
      if let firstUsefulFrame { return firstUsefulFrame }
      try await Task.sleep(for: .milliseconds(8))
    }
    throw BenchmarkFailure.noUsefulFrame
  }

  func start() { isMeasuring = true }

  func finish(on renderer: MLNMapView) -> [TimeInterval] {
    isMeasuring = false
    renderer.delegate = original
    return frameTimes
  }
}

private enum BenchmarkFailure: Error {
  case noRenderer, noUsefulFrame, interrupted, missingFrames
}

@MainActor
private func nativeRenderer(in view: UIView) -> MLNMapView? {
  if let renderer = view as? MLNMapView { return renderer }
  return view.subviews.lazy.compactMap { nativeRenderer(in: $0) }.first
}

private func processStart() -> TimeInterval? {
  var selectors = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
  var info = kinfo_proc()
  var length = MemoryLayout<kinfo_proc>.size
  guard sysctl(&selectors, UInt32(selectors.count), &info, &length, nil, 0) == 0,
    length == MemoryLayout<kinfo_proc>.size
  else { return nil }
  let start = info.kp_proc.p_un.__p_starttime
  guard start.tv_sec > 0 else { return nil }
  return Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
}

@MainActor
func measureStreets(
  _ map: TileflowMapView, started: TimeInterval, startedAt: TimeInterval, beforeMapBytes: UInt64,
  warnings: () -> [String]
) async {
  do {
    var renderer: MLNMapView?
    let deadline = CACurrentMediaTime() + 5
    while renderer == nil, CACurrentMediaTime() < deadline {
      renderer = nativeRenderer(in: map)
      if renderer == nil { try await Task.sleep(for: .milliseconds(2)) }
    }
    guard let renderer else { throw BenchmarkFailure.noRenderer }
    let launchedAt = processStart()
    let thermalStateAtMount = ProcessInfo.processInfo.thermalState.rawValue
    let probe = RenderProbe(renderer: renderer)
    let useful = try await probe.waitForUsefulFrame()
    try await Task.sleep(for: .seconds(2))
    let idleBytes = residentBytes()
    let destinations = [
      TileflowCamera(longitude: -3.6985, latitude: 40.4211, zoom: 16.7),
      TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16),
    ]
    let motionStarted = CACurrentMediaTime()
    probe.start()
    var motionResidentBytes: [UInt64] = []
    let sampler = Task {
      while !Task.isCancelled {
        motionResidentBytes.append(residentBytes())
        try? await Task.sleep(for: .milliseconds(100))
      }
    }
    defer { sampler.cancel() }

    for _ in 0..<4 {
      for camera in destinations {
        guard try await map.ease(to: camera, duration: 1, easing: .linear) == .finished else {
          throw BenchmarkFailure.interrupted
        }
      }
    }
    sampler.cancel()
    let motionFinished = CACurrentMediaTime()
    let frames = probe.finish(on: renderer)
    guard frames.count > 1 else { throw BenchmarkFailure.missingFrames }
    let intervals = zip(frames.dropFirst(), frames).map { ($0 - $1) * 1000 }
    let cache = await TileflowMapCache.usage()
    let screen = map.window?.windowScene?.screen ?? UIScreen.main
    let usefulAt = startedAt + useful - started
    var values: [String: Any] = [
      "firstUsefulFrameMs": (useful - started) * 1000,
      "firstUsefulFrameAt": usefulAt,
      "motionSeconds": motionFinished - motionStarted,
      "frameIntervalsMs": intervals,
      "frames": frames.count,
      "residentBytes": idleBytes,
      "residentBytesBeforeMap": beforeMapBytes,
      "motionResidentBytes": motionResidentBytes,
      "warnings": warnings(),
      "diskCacheEntries": cache.entries,
      "diskCacheBytes": cache.bytes,
      "gpu": MTLCreateSystemDefaultDevice()?.name ?? "Unavailable",
      "systemVersion": UIDevice.current.systemVersion,
      "thermalStateAtMount": thermalStateAtMount,
      "thermalStateAfterMotion": ProcessInfo.processInfo.thermalState.rawValue,
      "screenMaximumFramesPerSecond": screen.maximumFramesPerSecond,
      "screenScale": screen.scale,
      "viewWidthPoints": map.bounds.width,
      "viewHeightPoints": map.bounds.height,
    ]
    if let launchedAt, launchedAt <= startedAt {
      values["firstUsefulFrameFromProcessStartMs"] = (usefulAt - launchedAt) * 1000
    }
    try writeMeasurement(values)
  } catch {
    try? writeMeasurement(["error": String(describing: error), "warnings": warnings()])
  }
}
