import Foundation
import Tileflow

// Objective-C entry points of the TurboModules. The Objective-C++ modules forward each call here
// with the codegen arguments; the work and the conversions stay in Swift.

public typealias TFBridgeResolve = (Any?) -> Void
public typealias TFBridgeReject = (String, String, [String: Any]) -> Void

@objc(TFServicesModuleImpl)
public final class ServicesModuleImpl: NSObject {
  @objc public func configuredServices() -> [String: Bool] {
    ServicesBridge.configuredServices()
  }

  @objc public func call(
    _ service: String, operation: String, request: [String: Any],
    resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    nonisolated(unsafe) let request = request
    Task {
      do {
        resolve(try await ServicesBridge.call(service: service, operation: operation, request: request))
      } catch let error as BridgeFailure {
        reject(error.code, error.message, error.info)
      }
    }
  }
}

@objc(TFOfflineModuleImpl)
public final class OfflineModuleImpl: NSObject {
  private var subscription: TileflowOfflineSubscription?
  /// Receives region events while JavaScript observes them.
  @objc public var onEvent: (([String: Any]) -> Void)?

  private var store: TileflowOfflineStore { .shared }

  private func run(
    _ resolve: @escaping TFBridgeResolve, _ reject: @escaping TFBridgeReject,
    _ work: @escaping @Sendable () async throws -> Any?
  ) {
    Task {
      do {
        resolve(try await work())
      } catch {
        let failure = OfflineBridge.failure(error)
        reject(failure.code, failure.message, failure.info)
      }
    }
  }

  @objc public func estimateRegion(
    _ options: [String: Any], resolve: @escaping TFBridgeResolve,
    reject: @escaping TFBridgeReject
  ) {
    nonisolated(unsafe) let options = options
    run(resolve, reject) { [store] in
      OfflineBridge.encode(try await store.estimateRegion(OfflineBridge.options(options)))
    }
  }

  @objc public func loadRegion(
    _ id: String, options: [String: Any], resolve: @escaping TFBridgeResolve,
    reject: @escaping TFBridgeReject
  ) {
    nonisolated(unsafe) let options = options
    run(resolve, reject) { [store] in
      OfflineBridge.encode(try await store.loadRegion(id: id, options: OfflineBridge.options(options)))
    }
  }

  @objc public func updateRegionMetadata(
    _ id: String, metadata: [String: Any], resolve: @escaping TFBridgeResolve,
    reject: @escaping TFBridgeReject
  ) {
    nonisolated(unsafe) let metadata = metadata
    run(resolve, reject) { [store] in
      let values = try BridgeObject(["metadata": metadata], path: "arguments")
        .optionalStringMap("metadata") ?? [:]
      try await store.updateRegionMetadata(id: id, metadata: values)
      return nil
    }
  }

  @objc public func allRegions(
    _ resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in await store.allRegions().map(OfflineBridge.encode) }
  }

  @objc public func region(
    _ id: String, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in
      guard let region = await store.region(id: id) else { return [String: Any]() }
      return ["region": OfflineBridge.encode(region)]
    }
  }

  @objc public func pauseRegion(
    _ id: String, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in try await store.pauseRegion(id: id) }
  }

  @objc public func resumeRegion(
    _ id: String, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in try await store.resumeRegion(id: id) }
  }

  @objc public func cancelRegion(
    _ id: String, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in try await store.cancelRegion(id: id) }
  }

  @objc public func removeRegion(
    _ id: String, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in try await store.removeRegion(id: id) }
  }

  @objc public func automaticUpdatesEnabled(
    _ resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in await store.automaticUpdatesEnabled }
  }

  @objc public func setAutomaticUpdates(
    _ enabled: Bool, resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject
  ) {
    run(resolve, reject) { [store] in try await store.setAutomaticUpdates(enabled) }
  }

  @objc public func isNetworkEnabled() -> Bool { TileflowOfflineSwitch.shared.isNetworkEnabled }

  @objc public func setNetworkEnabled(_ enabled: Bool) {
    TileflowOfflineSwitch.shared.isNetworkEnabled = enabled
  }

  @objc public func startObserving() {
    guard subscription == nil else { return }
    subscription = store.subscribe { [weak self] event in
      let encoded = OfflineBridge.encode(event)
      DispatchQueue.main.async { self?.onEvent?(encoded) }
    }
  }

  @objc public func stopObserving() {
    subscription?.cancel()
    subscription = nil
  }

  deinit { subscription?.cancel() }
}

/// Application delegate hooks for offline downloads in the background. The Expo plugin adds the
/// calls; other apps call them from their `AppDelegate`.
@objc(TileflowReactNativeApp)
public final class TileflowReactNativeApp: NSObject {
  /// Registers the automatic update task. Call before the app finishes launching.
  @objc public static func registerBackgroundTasks() {
    TileflowOfflineStore.registerBackgroundTasks()
  }

  /// Forwards the events of Tileflow's background download session. Returns false, without
  /// calling the handler, for other sessions.
  @objc public static func handleEventsForBackgroundURLSession(
    _ identifier: String, completionHandler: @escaping () -> Void
  ) -> Bool {
    TileflowOfflineStore.handleEventsForBackgroundURLSession(
      identifier: identifier, completionHandler: completionHandler)
  }
}
