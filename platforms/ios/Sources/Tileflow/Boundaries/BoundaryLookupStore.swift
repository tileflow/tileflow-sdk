import Foundation

/// Identity contains only digests; session selectors never change ownership of a lookup.
struct BoundaryLookupIdentity: Sendable, Equatable {
  let digest: String
  let isHosted: Bool

  static func hosted(apiOrigin: URL, mapID: String) -> Self {
    Self(digest: hash(["hosted", ResourcePolicy.origin(apiOrigin), mapID]), isHosted: true)
  }

  static func selfHosted(manifestURL: URL, map: String) -> Self {
    Self(digest: hash(["self-hosted", manifestURL.absoluteString, map]), isHosted: false)
  }

  static func hash(_ parts: [String]) -> String {
    ResourceDigest.sha256(Data(parts.map { "\($0.utf8.count):\($0)" }.joined().utf8))
  }

  func address(_ url: URL) -> String {
    guard isHosted else { return url.absoluteString }
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return url.absoluteString
    }
    let ephemeral: Set<String> = ["session", "sessionId", "surface", "surfaceId", "map", "mapId"]
    if let query = parts.percentEncodedQuery {
      let kept = query.split(separator: "&", omittingEmptySubsequences: false).filter { item in
        let name =
          item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
        return !ephemeral.contains(String(name).removingPercentEncoding ?? String(name))
      }.joined(separator: "&")
      parts.percentEncodedQuery = kept.isEmpty ? nil : kept
    }
    return parts.string ?? url.absoluteString
  }
}

extension LoadableMapSource {
  var boundaryLookupIdentity: BoundaryLookupIdentity {
    if let hosted, let mapID { return .hosted(apiOrigin: hosted.apiOrigin, mapID: mapID) }
    return .selfHosted(manifestURL: manifestURL, map: map)
  }
}

/// SDK-owned derived data, independent of HTTP cache policy and downloaded map packs.
struct BoundaryLookupStore: Sendable {
  let root: URL
  static let maximumBodyBytes = 16 * 1024 * 1024

  static let shared: Self = {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[
      0]
    return Self(root: support.appendingPathComponent("dev.tileflow/boundary-lookups-v1"))
  }()

  struct Key: Sendable {
    let scope: String
    let release: String
    let digest: String

    init(
      identity: BoundaryLookupIdentity, descriptor: BoundaryLookupDescriptor,
      boundaryClass: TileflowBoundaryClass
    ) {
      scope = identity.digest
      release = BoundaryLookupIdentity.hash([descriptor.releaseID, descriptor.manifestSHA256 ?? ""])
      digest = BoundaryLookupIdentity.hash([
        scope, release, boundaryClass.rawValue, identity.address(descriptor.sourceURL),
        descriptor.classes[boundaryClass].map(identity.address) ?? "",
        descriptor.manifestURL.map(identity.address) ?? "",
      ])
    }
  }

  struct Archive: Sendable {
    let body: Data
    let rows: Int
  }

  private struct Metadata: Codable {
    let version: Int
    let key: String
    let bytes: Int
    let rows: Int
    let sha256: String
  }

  private static let magic = Data("TFBL".utf8)
  private static let maximumMetadataBytes = 4096
  private static let trailerBytes = 8

  func file(_ key: Key) -> URL {
    root.appendingPathComponent(key.scope).appendingPathComponent(key.release)
      .appendingPathComponent(key.digest + ".lookup")
  }

  /// An invalid file is a miss. Replacement is atomic, so a concurrent writer remains untouched.
  func read(_ key: Key) -> Archive? {
    let url = file(key)
    let maximum =
      Self.maximumBodyBytes + Self.maximumMetadataBytes
      + Self.trailerBytes
    guard let length = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
      length >= Self.trailerBytes, length <= maximum,
      let data = try? Data(contentsOf: url, options: .mappedIfSafe), data.count == length,
      data.suffix(4) == Self.magic
    else { return nil }
    let metadataBytes = data[(length - 8)..<(length - 4)].reduce(0) { $0 << 8 | Int($1) }
    guard metadataBytes > 0, metadataBytes <= Self.maximumMetadataBytes,
      metadataBytes <= length - Self.trailerBytes
    else { return nil }
    let bodyBytes = length - metadataBytes - Self.trailerBytes
    guard bodyBytes <= Self.maximumBodyBytes,
      let metadata = try? JSONDecoder().decode(
        Metadata.self,
        from: data[bodyBytes..<(length - Self.trailerBytes)]),
      metadata.version == 1, metadata.key == key.digest, metadata.bytes == bodyBytes,
      metadata.rows >= 0
    else { return nil }
    let body = Data(data.prefix(bodyBytes))
    guard ResourceDigest.sha256(body) == metadata.sha256 else { return nil }
    return Archive(body: body, rows: metadata.rows)
  }

  /// Full validated archives survive process restarts and ambient HTTP cache clearing.
  func write(_ archive: Archive, key: Key) throws {
    guard archive.body.count <= Self.maximumBodyBytes, archive.rows >= 0 else {
      throw BoundaryLookupStorageError.unavailable
    }
    let metadata = try JSONEncoder().encode(
      Metadata(
        version: 1, key: key.digest,
        bytes: archive.body.count, rows: archive.rows, sha256: ResourceDigest.sha256(archive.body)))
    guard metadata.count <= Self.maximumMetadataBytes else {
      throw BoundaryLookupStorageError.unavailable
    }
    var data = archive.body
    data.append(metadata)
    let count = UInt32(metadata.count)
    data.append(contentsOf: [
      UInt8(count >> 24 & 255), UInt8(count >> 16 & 255),
      UInt8(count >> 8 & 255), UInt8(count & 255),
    ])
    data.append(Self.magic)

    let url = file(key)
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true)
      var directory = root
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
      try data.write(
        to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      let handle = try FileHandle(forWritingTo: url)
      defer { try? handle.close() }
      try handle.synchronize()
    } catch { throw BoundaryLookupStorageError.unavailable }
  }
}

enum BoundaryLookupStorageError: Error {
  case unavailable
}
