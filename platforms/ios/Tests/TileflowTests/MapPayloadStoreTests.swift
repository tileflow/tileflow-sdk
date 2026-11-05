import Foundation
import XCTest

@testable import Tileflow

@MainActor
final class MapPayloadStoreTests: XCTestCase {
  func testPayloadsShareStorageUntilTheirLastReferenceIsReleased() throws {
    let channel = MapPayloadStore()
    let bytes = Data("{\"type\":\"FeatureCollection\",\"features\":[]}".utf8)
    let digest = ResourceDigest.sha256(bytes)
    XCTAssertEqual(digest.count, 64)
    let first = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    let second = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    // Equal payloads in flight share one entry and stay until every request releases them.
    XCTAssertEqual(first, second)
    XCTAssertGreaterThanOrEqual(first.id.count, 22)
    XCTAssertEqual(channel.payload(first.id)?.bytes, bytes)
    channel.release([first])
    XCTAssertNotNil(channel.payload(first.id))
    channel.release([second])
    XCTAssertNil(channel.payload(first.id))
    XCTAssertTrue(channel.isEmpty)
    // Identifiers are not reused.
    let third = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    XCTAssertNotEqual(third.id, first.id)
    channel.release([third, third])
    XCTAssertTrue(channel.isEmpty)

    let large = Data(count: ProtocolContract.maximumDataBytes)
    let held = try channel.register(large, digest: "a", contentType: "application/octet-stream")
    _ = try channel.register(large, digest: "b", contentType: "application/octet-stream")
    XCTAssertThrowsError(
      try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    ) { error in
      XCTAssertEqual(error as? TileflowMapError, .invalidRequest)
      XCTAssertEqual((error as? TileflowMapError)?.context.reason, "dataTooLarge")
      XCTAssertEqual(
        (error as? TileflowMapError)?.context.limit, ProtocolContract.maximumDataTotalBytes)
    }
    channel.release([held])
    XCTAssertThrowsError(
      try channel.register(
        Data(count: ProtocolContract.maximumDataBytes + 1), digest: "c", contentType: "x"))
    channel.retire()
    XCTAssertTrue(channel.isEmpty)
    XCTAssertThrowsError(try channel.register(bytes, digest: digest, contentType: "x")) {
      XCTAssertEqual($0 as? TileflowMapError, .cancelled)
    }
  }

  func testReferencesAreLimitedAndBelongToOneRenderer() throws {
    let store = MapPayloadStore()
    var refs: [MapPayloadStore.Reference] = []
    for i in 0..<ProtocolContract.maximumDataReferences {
      let bytes = Data("point \(i)".utf8)
      refs.append(
        try store.register(
          bytes, digest: ResourceDigest.sha256(bytes), contentType: "application/json"))
    }
    let extra = Data("extra".utf8)
    let digest = ResourceDigest.sha256(extra)
    XCTAssertThrowsError(try store.register(extra, digest: digest, contentType: "application/json"))
    {
      XCTAssertEqual(
        ($0 as? TileflowMapError)?.context.limit, ProtocolContract.maximumDataReferences)
    }
    store.release([refs[0]])
    let held = try store.register(extra, digest: digest, contentType: "application/json")
    let other = MapPayloadStore()
    let independent = try other.register(extra, digest: digest, contentType: "application/json")
    XCTAssertNotEqual(held.id, independent.id)
    XCTAssertNil(other.payload(held.id))
    store.retire()
    XCTAssertNil(store.reference(held.id))
    XCTAssertEqual(other.payload(independent.id)?.bytes, extra)
  }

  func testPersistedDigestsUseTheSameLowercaseSHA256() {
    XCTAssertEqual(
      ResourceDigest.sha256(Data("abc".utf8)),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  }
}
