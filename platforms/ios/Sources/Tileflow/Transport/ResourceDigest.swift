import CryptoKit
import Foundation

enum ResourceDigest {
  /// Byte identity for stored files, cache keys and shared map payloads.
  static func sha256(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
}
