import SwiftUI
import Tileflow

final class OfflineExampleAppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if !TileflowOfflineStore.handleEventsForBackgroundURLSession(
      identifier: identifier, completionHandler: completionHandler)
    {
      completionHandler()
    }
  }
}

struct OfflineExample: View {
  private static let regionID = "madrid-example"
  private let store = TileflowOfflineStore.shared
  let source: TileflowMapSource
  let theme: String
  let alternateTheme: String?

  @State private var region: TileflowOfflineRegion?
  @State private var networkEnabled = TileflowOfflineSwitch.shared.isNetworkEnabled
  @State private var working = false
  @State private var error: String?

  var body: some View {
    Form {
      Section("Madrid offline") {
        Toggle(
          "SDK networking",
          isOn: Binding(
            get: { networkEnabled },
            set: {
              networkEnabled = $0
              TileflowOfflineSwitch.shared.isNetworkEnabled = $0
            }))
        if let region {
          LabeledContent("Status", value: region.state.rawValue.capitalized)
          LabeledContent(
            "Available offline",
            value: region.isAvailable && region.options.content == content ? "Yes" : "No")
          if region.options.content != content {
            Text("This download belongs to a different map or theme.")
          }
          ProgressView(
            value: Double(region.completedResourceCount),
            total: Double(max(1, region.requiredResourceCount)))
          Text("\(region.completedResourceCount) of \(region.requiredResourceCount) resources")
          LabeledContent(
            "Resource bytes",
            value: ByteCountFormatter.string(
              fromByteCount: region.completedResourceBytes, countStyle: .file))
          if let expiresAt = region.expiresAt {
            LabeledContent(
              "Expires", value: expiresAt.formatted(date: .abbreviated, time: .shortened))
          }
          if case .gracePeriod(let endsAt) = region.expiryState {
            LabeledContent(
              "Grace ends", value: endsAt.formatted(date: .abbreviated, time: .shortened))
          }
          if let failure = region.error { Text(failure.description) }
        }
        if let error { Text(error).foregroundStyle(.red) }
        if content == nil {
          Text("Pass an --offline-tile-source for each tile source in this manifest.")
        }
      }

      Section {
        if let region, region.options.content == content {
          switch region.state {
          case .downloading, .waiting:
            Button("Pause") { run { try await store.pauseRegion(id: Self.regionID) } }
          case .paused, .failed:
            Button("Resume") { run { try await store.resumeRegion(id: Self.regionID) } }
          case .complete:
            EmptyView()
          }
        } else {
          Button("Download Madrid") { run { try await download() } }
            .disabled(content == nil || !networkEnabled)
        }
        if region != nil {
          Button("Delete download", role: .destructive) {
            run { try await store.removeRegion(id: Self.regionID) }
          }
        }
        if working { ProgressView() }
      }
      .disabled(working)
    }
    .task { await observeRegion() }
  }

  private var content: TileflowOfflineContent? {
    if let mapID = source.mapID {
      var themes = [theme]
      if let alternateTheme, alternateTheme != theme { themes.append(alternateTheme) }
      return .hosted(mapID: mapID, themes: themes)
    }
    guard let url = source.manifestURL, let sources = exampleOfflineSources(url, map: source.map)
    else { return nil }
    return .manifest(url: url, map: source.map, sources: sources)
  }

  private func download() async throws {
    guard let content else { return }
    try await store.loadRegion(
      id: Self.regionID,
      options: .init(
        geometry: .boundingBox(.init(west: -3.715, south: 40.41, east: -3.685, north: 40.43)),
        content: content, minZoom: 13, maxZoom: 15, metadata: ["name": "Madrid"]))
  }

  private func observeRegion() async {
    let regionID = Self.regionID
    let events = AsyncStream<TileflowOfflineRegionEvent>(bufferingPolicy: .bufferingNewest(1)) {
      continuation in
      let subscription = store.subscribe { event in
        switch event {
        case .changed(let changed) where changed.id == regionID: continuation.yield(event)
        case .removed(let id) where id == regionID: continuation.yield(event)
        default: break
        }
      }
      continuation.onTermination = { _ in subscription.cancel() }
    }

    region = await store.region(id: Self.regionID)
    for await event in events {
      switch event {
      case .changed(let changed): region = changed
      case .removed: region = nil
      case .warning: break
      }
    }
  }

  private func run(_ action: @escaping @MainActor () async throws -> Void) {
    working = true
    error = nil
    Task {
      defer { working = false }
      do { try await action() } catch { self.error = String(describing: error) }
    }
  }
}

/// A self-hosted region needs the templates it should save. A caller can repeat the flag with
/// the same source IDs and templates as the published style.
private func exampleOfflineSources(_ manifest: URL, map: String) -> [TileflowOfflineTileSource]? {
  let arguments = ProcessInfo.processInfo.arguments
  let flags = arguments.indices.filter { arguments[$0] == "--offline-tile-source" }
  if !flags.isEmpty {
    var sources: [TileflowOfflineTileSource] = []
    for flag in flags {
      guard flag + 1 < arguments.count else { return nil }
      let fields = arguments[flag + 1].split(separator: ",", maxSplits: 3)
      guard fields.count == 4, let min = Int(fields[1]), let max = Int(fields[2]) else {
        return nil
      }
      sources.append(
        .init(
          id: String(fields[0]), template: String(fields[3]), minZoom: min, maxZoom: max))
    }
    return sources
  }

  return manifest.path == "/manifest.json" && map == "fixture" ? [] : nil
}
