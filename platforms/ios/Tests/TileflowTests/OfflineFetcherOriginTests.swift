import Foundation
import XCTest
@testable import Tileflow

final class OfflineFetcherOriginTests: XCTestCase {
  func testCompletedResponsesKeepTheirAuthorizedOriginBeforeDelivery() async throws {
    for (url, status, allowed) in [
      ("https://API.TILEFLOW.TEST:443/result", 200, true),
      ("https://other.test/result", 200, false),
      ("https://other.test/result", 304, false),
      ("http://api.tileflow.test/result", 200, false),
      ("https://api.tileflow.test:444/result", 200, false),
    ] {
      let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: root) }
      let fetcher = OfflineURLSessionFetcher(configuration: .ephemeral, directory: root)
      let original = URL(string: "https://api.tileflow.test/pack")!
      let request = OfflineFetchRequest(id: "saved/1/pack", url: original, headers: [:],
        allowsExpensiveNetworkAccess: true, destination: root.appendingPathComponent("accepted"))
      let task = CompletedDownloadTask(original: original, final: URL(string: url)!, status: status)
      task.taskDescription = request.id
      let body = root.appendingPathComponent("incoming")
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      try Data("pack".utf8).write(to: body)
      let session = URLSession(configuration: .ephemeral)
      defer { session.invalidateAndCancel() }
      fetcher.urlSession(session, downloadTask: task, didFinishDownloadingTo: body)
      fetcher.urlSession(session, task: task, didCompleteWithError: nil)
      do {
        _ = try await fetcher.fetch(request)
        XCTAssertTrue(allowed, "Cross-origin completion was delivered: \(url)")
      } catch let error as TileflowOfflineError {
        XCTAssertFalse(allowed)
        XCTAssertEqual(error.context.reason, "responseOriginChanged")
      }
      if !allowed {
        XCTAssertFalse(FileManager.default.fileExists(atPath: request.destination!.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("saved-1-pack.body").path))
      }
    }
  }
}

private final class CompletedDownloadTask: URLSessionDownloadTask, @unchecked Sendable {
  let original: URL
  let final: URL
  let status: Int
  init(original: URL, final: URL, status: Int) {
    self.original = original
    self.final = final
    self.status = status
    super.init()
  }
  override var originalRequest: URLRequest? { URLRequest(url: original) }
  override var response: URLResponse? {
    HTTPURLResponse(url: final, statusCode: status, httpVersion: nil, headerFields: [:])
  }
}
