import Foundation
import XCTest
@testable import Tileflow

/// Opt-in measurement against a loopback server, using the real background transfer service.
final class OfflineBackgroundRedirectTests: XCTestCase {
  func testBackgroundFetcherRejectsCrossOriginFinalResponse() async throws {
    guard let address = ProcessInfo.processInfo.environment["TILEFLOW_REDIRECT_PROBE_URL"],
      let url = URL(string: address), ["127.0.0.1", "localhost"].contains(url.host ?? "")
    else { throw XCTSkip("Set TILEFLOW_REDIRECT_PROBE_URL to the loopback redirect fixture.") }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let configuration = URLSessionConfiguration.background(
      withIdentifier: "dev.tileflow.tests.final-origin.\(UUID().uuidString)")
    configuration.isDiscretionary = false
    let fetcher = OfflineURLSessionFetcher(configuration: configuration, directory: root,
      startTimeout: 120)
    let destination = root.appendingPathComponent("accepted.tfpack")
    do {
      _ = try await fetcher.fetch(OfflineFetchRequest(id: "probe/1/body", url: url,
        headers: ["X-Tileflow-Offline-Grant": "synthetic-offline-redirect-probe"],
        allowsExpensiveNetworkAccess: true, destination: destination))
      XCTFail("A redirected pack was accepted")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .invalidResponse)
      XCTAssertEqual(error.context.reason, "responseOriginChanged")
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
    XCTAssertTrue(((try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []).isEmpty)
  }

  func testBackgroundSessionRedirectHeaderForwarding() async throws {
    guard let address = ProcessInfo.processInfo.environment["TILEFLOW_REDIRECT_PROBE_URL"],
      let url = URL(string: address), ["127.0.0.1", "localhost"].contains(url.host ?? "")
    else { throw XCTSkip("Set TILEFLOW_REDIRECT_PROBE_URL to the loopback redirect fixture.") }

    let done = expectation(description: "Real background transfer completed")
    let delegate = RedirectProbeDelegate { done.fulfill() }
    let configuration = URLSessionConfiguration.background(
      withIdentifier: "dev.tileflow.tests.redirect.\(UUID().uuidString)")
    configuration.isDiscretionary = false
    configuration.httpCookieStorage = nil
    configuration.urlCredentialStorage = nil
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    var request = URLRequest(url: url)
    request.setValue("synthetic-offline-redirect-probe", forHTTPHeaderField: "X-Tileflow-Offline-Grant")
    session.downloadTask(with: request).resume()
    await fulfillment(of: [done], timeout: 45)
    let outcome = delegate.outcome
    XCTAssertNil(outcome.error)
    let body = try XCTUnwrap(outcome.body)
    let result = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Bool])
    let forwarded = try XCTUnwrap(result["grantForwarded"])
    print("Background redirect probe: grantForwarded=\(forwarded), finalHost=\(outcome.host ?? "none")")
    XCTAssertEqual(outcome.host, "localhost")
  }
}

private final class RedirectProbeDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
  struct Outcome {
    var body: Data?
    var host: String?
    var error: String?
  }
  private let lock = NSLock()
  private var stored = Outcome()
  private let finish: @Sendable () -> Void
  init(finish: @escaping @Sendable () -> Void) { self.finish = finish }
  var outcome: Outcome { lock.withLock { stored } }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL) {
    lock.withLock {
      stored.body = try? Data(contentsOf: location)
      stored.host = downloadTask.response?.url?.host
    }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask,
    didCompleteWithError error: (any Error)?) {
    lock.withLock { stored.error = error.map { String(describing: $0) } }
    finish()
  }
}
