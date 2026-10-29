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
    /// A result larger than a control message, read in this many parts.
    var chunks: Int?
    var error: JSONValue?
  }
  /// A request's answer: its result, or the number of parts to read it in.
  private enum Reply {
    case value(JSONValue)
    case chunks(Int)
  }
  private struct Pending {
    let continuation: CheckedContinuation<Reply, any Error>
    let timeout: Task<Void, Never>
  }

  /// The protocol versions this host speaks, offered to the renderer before its first script.
  static let supportedVersions: JSONValue = .object([
    "minimum": .number(Double(ProtocolContract.minimumVersion)),
    "maximum": .number(Double(ProtocolContract.version)),
  ])

  let instanceID: String
  let generation: Int
  let runtimeHash: String
  /// Payloads this generation's requests carry; the transport serves them to the renderer.
  let data: DataChannel
  weak var webView: WKWebView?
  var onHello: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  /// The handshake failed: the renderer is not usable in this generation.
  var onFailure: ((TileflowMapError) -> Void)?
  private var pending: [String: Pending] = [:]
  private var sequence = 0
  private var version: Int?
  private var retired = false
  private var handshakeTimeout: Task<Void, Never>?

  private var ready: Bool { version != nil }

  init(instanceID: String, generation: Int, runtimeHash: String, data: DataChannel = .init()) {
    self.instanceID = instanceID
    self.generation = generation
    self.runtimeHash = runtimeHash
    self.data = data
  }

  func start() {
    guard !ready, !retired, handshakeTimeout == nil else { return }
    handshakeTimeout = Task { [weak self] in
      do {
        try await Task.sleep(for: .milliseconds(ProtocolContract.requestTimeoutMilliseconds))
      } catch { return }
      guard let self, !self.ready, !self.retired else { return }
      self.fail(TileflowMapError(.timeout, reason: .handshake))
    }
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, message.frameInfo.request.url == ResourceURL.runtimeURL,
      let text = message.body as? String
    else { return }
    receive(text)
  }

  /// One message from the renderer's main frame.
  func receive(_ text: String) {
    guard !retired, text.utf8.count <= ProtocolContract.maximumMessageBytes,
      let value = try? JSONDecoder().decode(Envelope.self, from: Data(text.utf8)),
      value.instanceId == instanceID, value.generation == generation
    else { return }
    guard let version else {
      if value.requestId == nil, value.event == "hello" { hello(value) }
      return
    }
    guard value.protocolVersion == version else { return }
    if let requestID = value.requestId, let request = pending.removeValue(forKey: requestID) {
      request.timeout.cancel()
      if let error = value.error {
        request.continuation.resume(throwing: TileflowMapError(wire: error))
      } else if let chunks = value.chunks, value.result == nil, chunks > 0 {
        request.continuation.resume(returning: .chunks(chunks))
      } else {
        request.continuation.resume(returning: .value(value.result ?? .null))
      }
    } else if value.requestId == nil, let event = value.event, event != "hello" {
      onEvent?(event, value.result ?? .null)
    }
  }

  /// Accepts the renderer only when it is the embedded one and both sides chose one version. A
  /// mismatch is reported as a typed error rather than left to time out.
  private func hello(_ value: Envelope) {
    let offered = value.result?["protocol"]
    let selected = offered?["selected"]?.number.flatMap { Int(exactly: $0) }
    guard let selected, selected == value.protocolVersion,
      (ProtocolContract.minimumVersion...ProtocolContract.version).contains(selected)
    else {
      fail(TileflowMapError(.incompatibleRuntime, reason: .protocolVersion))
      return
    }
    guard value.result?["runtimeHash"]?.string == runtimeHash else {
      fail(TileflowMapError(.incompatibleRuntime, reason: .runtimeHash))
      return
    }
    version = selected
    handshakeTimeout?.cancel()
    handshakeTimeout = nil
    onHello?()
  }

  private func fail(_ error: TileflowMapError) {
    let report = onFailure
    retire(.cancelled)
    report?(error)
  }

  /// Sends a command. `data` are references this request carries; they are released however the
  /// request ends. Cancelling the calling task cancels the command in the renderer as well.
  ///
  /// A payload larger than a control message travels on the data channel, and a result larger
  /// than one is read in parts, up to the data channel's limit.
  func call(
    _ method: ProtocolContract.Method, payload: JSONValue = .null,
    data references: [DataChannel.Reference] = []
  ) async throws -> JSONValue {
    defer { data.release(references) }
    let (id, reply) = try await send(method, payload: payload)
    switch reply {
    case .value(let value): return value
    case .chunks(let count):
      var text = ""
      for index in 0..<count {
        let (_, part) = try await send(
          .readResult,
          payload: .object(["requestId": .string(id), "index": .number(Double(index))]))
        guard case .value(.string(let chunk)) = part else { throw TileflowMapError.rendererFailed }
        text += chunk
      }
      guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) else {
        throw TileflowMapError.rendererFailed
      }
      return value
    }
  }

  /// Sends one request and answers its identifier with its reply.
  private func send(_ method: ProtocolContract.Method, payload: JSONValue) async throws
    -> (String, Reply)
  {
    guard !retired else { throw TileflowMapError.disposed }
    guard let version, let webView else { throw TileflowMapError.notReady }
    guard pending.count < ProtocolContract.maximumPendingRequests else {
      throw TileflowMapError.invalidRequest
    }
    sequence += 1
    let id = String(sequence)
    var carried: [DataChannel.Reference] = []
    defer { data.release(carried) }
    let text: String
    if let small = try Self.message(
      version: version, instanceID: instanceID, generation: generation, requestID: id,
      command: .object(["method": .string(method.rawValue), "payload": payload]))
    {
      text = small
    } else {
      // The payload's JSON goes on the data channel; the renderer reads it before the command.
      let bytes = try JSONEncoder().encode(payload)
      let reference = try data.register(
        bytes, digest: DataChannel.digest(bytes), contentType: "application/json")
      carried = [reference]
      guard
        let deferred = try Self.message(
          version: version, instanceID: instanceID, generation: generation, requestID: id,
          command: .object([
            "method": .string(method.rawValue), "payloadData": reference.wireValue,
          ]))
      else { throw TileflowMapError.invalidRequest }
      text = deferred
    }
    let reply: Reply = try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let timeout = Task { [weak self] in
          do {
            try await Task.sleep(for: .milliseconds(ProtocolContract.requestTimeoutMilliseconds))
          } catch { return }
          self?.abandon(id, with: TileflowMapError.timeout)
        }
        pending[id] = Pending(continuation: continuation, timeout: timeout)
        send(text, to: webView) { [weak self] in self?.finish(id, error: .rendererFailed) }
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.abandon(id, with: CancellationError()) }
    }
    return (id, reply)
  }

  func retire(_ error: TileflowMapError = .disposed) {
    guard !retired else { return }
    retired = true
    version = nil
    handshakeTimeout?.cancel()
    handshakeTimeout = nil
    let requests = pending.values
    pending.removeAll()
    for request in requests {
      request.timeout.cancel()
      request.continuation.resume(throwing: error)
    }
    data.retire()
    onHello = nil
    onEvent = nil
    onFailure = nil
    webView = nil
  }

  /// Fails a request here and stops its work in the renderer.
  private func abandon(_ id: String, with error: any Error) {
    guard let request = pending.removeValue(forKey: id) else { return }
    request.timeout.cancel()
    request.continuation.resume(throwing: error)
    guard let version, let webView, !retired else { return }
    sequence += 1
    guard
      let text = try? Self.message(
        version: version, instanceID: instanceID, generation: generation,
        requestID: String(sequence), method: .cancel,
        payload: .object(["requestId": .string(id)]))
    else { return }
    // The renderer answers the cancellation and the cancelled request; nobody waits for either.
    send(text, to: webView) {}
  }

  private func finish(_ id: String, error: TileflowMapError) {
    guard let request = pending.removeValue(forKey: id) else { return }
    request.timeout.cancel()
    request.continuation.resume(throwing: error)
  }

  private func send(_ text: String, to webView: WKWebView, failed: @escaping () -> Void) {
    // Use WebKit's Objective-C entry point so the package also runs on iOS 16–18
    // when compiled with a toolchain whose Swift WebKit overlay ships in newer OSes.
    webView.__callAsyncJavaScript(
      "window.tileflow.receive(message);", arguments: ["message": text],
      inFrame: nil, in: .page,
      completionHandler: { _, error in
        if error != nil { failed() }
      }
    )
  }

  static func message(
    version: Int, instanceID: String, generation: Int, requestID: String,
    method: ProtocolContract.Method, payload: JSONValue
  ) throws -> String {
    guard
      let text = try message(
        version: version, instanceID: instanceID, generation: generation, requestID: requestID,
        command: .object(["method": .string(method.rawValue), "payload": payload]))
    else {
      throw TileflowMapError(
        .invalidRequest, context: .init(limit: ProtocolContract.maximumMessageBytes))
    }
    return text
  }

  /// A request's text, or nil when it exceeds a control message.
  static func message(
    version: Int, instanceID: String, generation: Int, requestID: String, command: JSONValue
  ) throws -> String? {
    let envelope = Envelope(
      protocolVersion: version, instanceId: instanceID, generation: generation,
      requestId: requestID, command: command
    )
    let bytes = try JSONEncoder().encode(envelope)
    guard bytes.count <= ProtocolContract.maximumMessageBytes else { return nil }
    return String(data: bytes, encoding: .utf8)
  }
}
