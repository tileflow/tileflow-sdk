import Foundation

/// Payloads held for one renderer generation. Requests share bytes by digest and release their
/// references when they finish. Retiring the renderer discards all of its outstanding payloads.
@MainActor
final class MapPayloadStore {
  struct Reference: Hashable, Sendable {
    let id: String
    let byteLength: Int
    let sha256: String

    var wireValue: JSONValue {
      .object([
        "id": .string(id), "byteLength": .number(Double(byteLength)), "sha256": .string(sha256),
      ])
    }
  }

  private struct Entry {
    let reference: Reference
    let bytes: Data
    let contentType: String
    var holds: Int
  }

  private var entries: [String: Entry] = [:]
  private var identifiers: [String: String] = [:]
  private var totalBytes = 0
  private var retired = false

  /// Registers a payload for one request. Release the reference when the request settles.
  func register(_ bytes: Data, digest: String, contentType: String) throws -> Reference {
    guard !retired else { throw TileflowMapError.cancelled }
    guard !bytes.isEmpty, bytes.count <= MapContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: MapContract.maximumDataBytes)
    }
    if let id = identifiers[digest], var entry = entries[id] {
      entry.holds += 1
      entries[id] = entry
      return entry.reference
    }
    guard totalBytes + bytes.count <= MapContract.maximumDataTotalBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: MapContract.maximumDataTotalBytes)
    }
    guard entries.count < MapContract.maximumDataReferences else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: MapContract.maximumDataReferences)
    }
    var random = SystemRandomNumberGenerator()
    let id = Data((0..<16).map { _ in UInt8.random(in: 0...255, using: &random) })
      .base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    let reference = Reference(id: id, byteLength: bytes.count, sha256: digest)
    entries[id] = Entry(reference: reference, bytes: bytes, contentType: contentType, holds: 1)
    identifiers[digest] = id
    totalBytes += bytes.count
    return reference
  }

  func release(_ references: some Sequence<Reference>) {
    for reference in references {
      guard var entry = entries[reference.id] else { continue }
      entry.holds -= 1
      if entry.holds > 0 {
        entries[reference.id] = entry
      } else {
        entries.removeValue(forKey: reference.id)
        identifiers.removeValue(forKey: reference.sha256)
        totalBytes -= entry.bytes.count
      }
    }
  }

  func reference(_ id: String) -> Reference? { entries[id]?.reference }

  /// Bytes and media type while a request still holds the payload.
  func payload(_ id: String) -> (bytes: Data, contentType: String)? {
    guard !retired, let entry = entries[id] else { return nil }
    return (entry.bytes, entry.contentType)
  }

  var isEmpty: Bool { entries.isEmpty }

  func retire() {
    retired = true
    entries.removeAll()
    identifiers.removeAll()
    totalBytes = 0
  }
}
