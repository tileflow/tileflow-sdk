import Foundation
import WebKit

@MainActor
final class MapBridge: NSObject, WKScriptMessageHandler {
  struct Envelope: Codable {
    let protocolVersion: Int
    let instanceId: String
    let generation: Int
    var requestId: String?
    var command: JSONValue?
    var event: String?
    var result: JSONValue?
    var error: JSONValue?
  }
  private struct Pending {
    let continuation: CheckedContinuation<JSONValue, any Error>
    let timeout: Task<Void, Never>
  }

  let instanceID: String
  let generation: Int
  let runtimeHash: String
  weak var webView: WKWebView?
  var onHello: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  private var pending: [String: Pending] = [:]
  private var sequence = 0
  private var ready = false
  private var retired = false
  private var handshakeTimeout: Task<Void, Never>?

  init(instanceID: String, generation: Int, runtimeHash: String) {
    self.instanceID = instanceID
    self.generation = generation
    self.runtimeHash = runtimeHash
  }

  func start() {
    guard !ready, !retired, handshakeTimeout == nil else { return }
    handshakeTimeout = Task { [weak self] in
      do {
        try await Task.sleep(for: .milliseconds(ProtocolContract.requestTimeoutMilliseconds))
      } catch { return }
      guard let self, !self.ready, !self.retired else { return }
      self.onEvent?("error", .object(["code": .string("timeout")]))
      self.retire()
    }
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard !retired, message.frameInfo.isMainFrame,
      message.frameInfo.request.url == ResourceURL.runtimeURL,
      let text = message.body as? String,
      text.utf8.count <= ProtocolContract.maximumMessageBytes,
      let value = try? JSONDecoder().decode(Envelope.self, from: Data(text.utf8)),
      value.protocolVersion == ProtocolContract.version,
      value.instanceId == instanceID, value.generation == generation
    else { return }
    if let requestID = value.requestId, let request = pending.removeValue(forKey: requestID) {
      request.timeout.cancel()
      if let error = value.error {
        request.continuation.resume(throwing: Self.error(error["code"]?.string))
      } else {
        request.continuation.resume(returning: value.result ?? .null)
      }
    } else if value.event == "hello" {
      guard !ready else { return }
      guard value.result?["runtimeHash"]?.string == runtimeHash else {
        onEvent?("error", .object(["code": .string("incompatibleRuntime")]))
        retire()
        return
      }
      ready = true
      handshakeTimeout?.cancel()
      handshakeTimeout = nil
      onHello?()
    } else if let event = value.event, ready {
      onEvent?(event, value.result ?? .null)
    }
  }

  func call(_ method: ProtocolContract.Method, payload: JSONValue = .null) async throws -> JSONValue
  {
    guard !retired else { throw TileflowMapError.disposed }
    guard ready, let webView else { throw TileflowMapError.notReady }
    guard pending.count < ProtocolContract.maximumPendingRequests else {
      throw TileflowMapError.invalidRequest
    }
    sequence += 1
    let id = String(sequence)
    let envelope = Envelope(
      protocolVersion: ProtocolContract.version, instanceId: instanceID, generation: generation,
      requestId: id, command: .object(["method": .string(method.rawValue), "payload": payload])
    )
    let bytes = try JSONEncoder().encode(envelope)
    guard bytes.count <= ProtocolContract.maximumMessageBytes,
      let text = String(data: bytes, encoding: .utf8)
    else { throw TileflowMapError.invalidRequest }
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let timeout = Task { [weak self] in
          do {
            try await Task.sleep(for: .milliseconds(ProtocolContract.requestTimeoutMilliseconds))
          } catch { return }
          self?.finish(id, error: .timeout)
        }
        pending[id] = Pending(continuation: continuation, timeout: timeout)
        // Use WebKit's Objective-C entry point so the package also runs on iOS 16–18
        // when compiled with a toolchain whose Swift WebKit overlay ships in newer OSes.
        webView.__callAsyncJavaScript(
          "window.tileflow.receive(message);", arguments: ["message": text],
          inFrame: nil, in: .page,
          completionHandler: { [weak self] _, error in
            if error != nil { self?.finish(id, error: .rendererFailed) }
          }
        )
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.finish(id, error: .disposed) }
    }
  }

  func retire() {
    guard !retired else { return }
    retired = true
    ready = false
    handshakeTimeout?.cancel()
    handshakeTimeout = nil
    let requests = pending.values
    pending.removeAll()
    for request in requests {
      request.timeout.cancel()
      request.continuation.resume(throwing: TileflowMapError.disposed)
    }
    onHello = nil
    onEvent = nil
    webView = nil
  }

  private func finish(_ id: String, error: TileflowMapError) {
    guard let request = pending.removeValue(forKey: id) else { return }
    request.timeout.cancel()
    request.continuation.resume(throwing: error)
  }

  static func error(_ code: String?) -> TileflowMapError {
    switch code {
    case "notReady": .notReady
    case "disposed", "cancelled": .disposed
    case "timeout": .timeout
    case "resourceFailed": .resourceFailed
    case "invalidRequest": .invalidRequest
    case "incompatibleRuntime", "versionMismatch": .incompatibleRuntime
    default: .rendererFailed
    }
  }
}
