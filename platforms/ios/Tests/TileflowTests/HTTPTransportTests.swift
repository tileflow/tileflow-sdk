import Foundation
import XCTest

@testable import Tileflow

final class HTTPTransportTests: XCTestCase {
  override func setUp() { StubProtocol.reset() }

  func testCancellingAStreamedBodyStopsTheDownloadAndFreesItsSlot() async throws {
    let client = TileflowHTTPClient(protocolClasses: [StubProtocol.self])
    let transport = NativeHTTPTransport(maximumBytes: 1 << 20, lane: .resources, client: client)
    let response = try await transport.open(URLRequest(url: URL(string: "https://stub.test/hang")!))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.headers["ETag"], "\"stub\"")
    let reader = Task {
      var iterator = response.body.makeAsyncIterator()
      let first = try await iterator.next()
      XCTAssertEqual(first, Data("first".utf8))
      return try await iterator.next()
    }
    try await waitUntil { StubProtocol.started == 1 }
    try await Task.sleep(for: .milliseconds(50))
    reader.cancel()
    _ = try? await reader.value
    try await waitUntil { StubProtocol.stopped == 1 }
    try await waitUntil {
      client.resourceSlots.availableCount == TileflowHTTPClient.maximumConcurrentResources
    }
  }

  func testClosingATransportCancelsOnlyItsOwnRequests() async throws {
    let client = TileflowHTTPClient(protocolClasses: [StubProtocol.self])
    let closed = NativeHTTPTransport(maximumBytes: 1 << 20, lane: .resources, client: client)
    let open = NativeHTTPTransport(maximumBytes: 1 << 20, lane: .resources, client: client)
    let first = try await closed.open(URLRequest(url: URL(string: "https://stub.test/hang")!))
    let second = try await open.open(URLRequest(url: URL(string: "https://stub.test/hang")!))
    closed.close()
    do {
      for try await _ in first.body {}
      XCTFail("A closed transport kept streaming")
    } catch {}
    try await waitUntil { StubProtocol.stopped == 1 }
    do {
      _ = try await closed.open(URLRequest(url: URL(string: "https://stub.test/hang")!))
      XCTFail("A closed transport accepted a request")
    } catch { XCTAssertEqual(error as? ResourceError, .disposed) }
    XCTAssertEqual(StubProtocol.stopped, 1, "The other owner's request continues")
    second.cancel()
    try await waitUntil { StubProtocol.stopped == 2 }
  }

  func testBodiesBeyondTheLimitFailWhileStreaming() async throws {
    let client = TileflowHTTPClient(protocolClasses: [StubProtocol.self])
    let transport = NativeHTTPTransport(maximumBytes: 8, lane: .resources, client: client)
    let response = try await transport.open(
      URLRequest(url: URL(string: "https://stub.test/chunks")!))
    do {
      _ = try await response.collect()
      XCTFail("An oversized body was accepted")
    } catch { XCTAssertEqual(error as? ResourceError, .responseTooLarge) }
    try await waitUntil {
      client.resourceSlots.availableCount == TileflowHTTPClient.maximumConcurrentResources
    }
  }

  func testDisabledNetworkFailsLikeAnOfflineDevice() async throws {
    let client = TileflowHTTPClient(protocolClasses: [StubProtocol.self])
    client.isNetworkEnabled = false
    let transport = NativeHTTPTransport(maximumBytes: 64, lane: .resources, client: client)
    do {
      _ = try await transport.send(URLRequest(url: URL(string: "https://stub.test/chunks")!))
      XCTFail("A request reached the network")
    } catch { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
    XCTAssertEqual(StubProtocol.started, 0)
  }

  func testConcurrencyIsBoundedAndCancelledWaitersLeaveTheQueue() async throws {
    let semaphore = AsyncSemaphore(2)
    try await semaphore.acquire()
    try await semaphore.acquire()
    let cancelled = Task { try await semaphore.acquire() }
    let waiting = Task { try await semaphore.acquire() }
    try await Task.sleep(for: .milliseconds(50))
    cancelled.cancel()
    do {
      try await cancelled.value
      XCTFail("A cancelled waiter acquired a slot")
    } catch { XCTAssertTrue(error is CancellationError) }
    semaphore.release()
    try await waiting.value
    XCTAssertEqual(semaphore.availableCount, 0)
    semaphore.release()
    semaphore.release()
    XCTAssertEqual(semaphore.availableCount, 2)
  }

  private func waitUntil(_ condition: @Sendable () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
    while !condition() {
      guard ContinuousClock.now < deadline else { return XCTFail("Timed out") }
      try await Task.sleep(for: .milliseconds(10))
    }
  }
}

/// `/hang` sends its head and one chunk, then never finishes. `/chunks` sends two 6-byte chunks
/// without a declared length.
private final class StubProtocol: URLProtocol, @unchecked Sendable {
  private static let counts = LockedValue((started: 0, stopped: 0))
  static var started: Int { counts.withLock { $0.started } }
  static var stopped: Int { counts.withLock { $0.stopped } }
  static func reset() { counts.withLock { $0 = (0, 0) } }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.counts.withLock { $0.started += 1 }
    let url = request.url!
    let response = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["ETag": "\"stub\"", "Content-Type": "application/octet-stream"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    if url.path == "/hang" {
      client?.urlProtocol(self, didLoad: Data("first".utf8))
    } else {
      client?.urlProtocol(self, didLoad: Data("sixsix".utf8))
      client?.urlProtocol(self, didLoad: Data("sixsix".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }

  override func stopLoading() {
    if request.url?.path == "/hang" { Self.counts.withLock { $0.stopped += 1 } }
  }
}
