import CryptoKit
import Foundation

/// Payloads too large for protocol messages, such as GeoJSON, served to one renderer generation
/// through the native transport at `tileflow://data/<id>`.
///
/// A request registers its payloads before it is sent and releases them when it settles, so data
/// lives only while the renderer may read it. Identifiers are random and single-generation; equal
/// payloads in flight share one entry. Retiring the generation releases everything.
@MainActor
final class DataChannel {
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

  /// The SHA-256 digest the renderer verifies, in lowercase hexadecimal.
  nonisolated static func digest(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }

  /// Registers a payload for one request. Release the reference when the request settles.
  func register(_ bytes: Data, digest: String, contentType: String) throws -> Reference {
    guard !retired else { throw TileflowMapError.cancelled }
    guard !bytes.isEmpty, bytes.count <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    if let id = identifiers[digest], var entry = entries[id] {
      entry.holds += 1
      entries[id] = entry
      return entry.reference
    }
    guard totalBytes + bytes.count <= ProtocolContract.maximumDataTotalBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataTotalBytes)
    }
    guard entries.count < ProtocolContract.maximumDataReferences else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataReferences)
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

  /// The payload the transport serves, or nil once released.
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
