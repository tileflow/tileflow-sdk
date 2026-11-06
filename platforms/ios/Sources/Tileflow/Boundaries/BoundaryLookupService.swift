import Foundation

/// Captured from the exact source document projected for this style generation.
struct BoundaryLookupDescriptor: Equatable, Sendable {
  let sourceURL: URL
  let releaseID: String
  let manifestSHA256: String?
  let manifestURL: URL?
  let classes: [TileflowBoundaryClass: URL]

  init?(tileJSON: [String: Any], sourceURL: URL) {
    guard let tileflow = tileJSON["tileflow"] as? [String: Any],
      let boundaries = tileflow["boundaries"] as? [String: Any],
      let releaseID = boundaries["releaseId"] as? String, !releaseID.isEmpty,
      let lookup = boundaries["lookup"] as? [String: Any],
      let classes = lookup["classes"] as? [String: String]
    else { return nil }
    let manifestSHA256 = boundaries["manifestSha256"] as? String
    if boundaries["manifestSha256"] != nil,
      manifestSHA256?.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
    {
      return nil
    }
    var urls: [TileflowBoundaryClass: URL] = [:]
    for boundaryClass in TileflowBoundaryClass.allCases {
      guard let address = classes[boundaryClass.rawValue] else { continue }
      guard !address.isEmpty,
        let url = URL(
          string: MapResourceAddress.resolve(address, against: sourceURL.absoluteString))
      else { return nil }
      urls[boundaryClass] = url
    }
    guard !urls.isEmpty else { return nil }
    if lookup["manifest"] != nil {
      guard let raw = lookup["manifest"] as? String, !raw.isEmpty,
        let url = URL(string: MapResourceAddress.resolve(raw, against: sourceURL.absoluteString))
      else { return nil }
      self.manifestURL = url
    } else {
      self.manifestURL = nil
    }
    self.manifestSHA256 = manifestSHA256
    self.sourceURL = sourceURL
    self.releaseID = releaseID
    self.classes = urls
  }
}

struct BoundaryLookupService: Sendable {
  let loader: any ResourceLoading
  var store: BoundaryLookupStore = .shared
  let identity: BoundaryLookupIdentity
  var online: @Sendable () -> Bool = {
    TileflowHTTPClient.shared.isNetworkEnabled && OfflineReachability.shared.isReachable
  }

  static let maximumCompressedBytes = BoundaryLookupStore.maximumBodyBytes
  static let maximumDecodedBytes = 64 * 1024 * 1024

  func lookup(
    _ descriptor: BoundaryLookupDescriptor, classes: [TileflowBoundaryClass]?,
    matching code: TileflowBoundaryCode? = nil, keys: [TileflowBoundaryKey] = []
  ) async throws -> TileflowBoundaryLookup {
    for boundaryClass in classes ?? [] where descriptor.classes[boundaryClass] == nil {
      throw TileflowBoundaryJoinError.lookupUnavailable
    }
    let requested = classes.map(Set.init)
    let selected = TileflowBoundaryClass.allCases.filter {
      descriptor.classes[$0] != nil && (requested?.contains($0) ?? true)
    }
    if selected.isEmpty { return try TileflowBoundaryLookup(rows: []) }
    let normalized = Set(
      keys.compactMap { key in
        code.flatMap { BoundaryCodeNormalization.key(key, code: $0) }
      })
    if code != nil, normalized.isEmpty { return try TileflowBoundaryLookup(rows: []) }
    var manifest: BoundaryLookupManifest?
    var manifestLoaded = false
    var rows: [TileflowBoundaryLookupRow] = []

    for boundaryClass in selected {
      try Task.checkCancellation()
      let key = BoundaryLookupStore.Key(
        identity: identity, descriptor: descriptor,
        boundaryClass: boundaryClass)
      if let archive = store.read(key),
        let parsed = try? parse(
          archive.body, boundaryClass: boundaryClass, expectedRows: archive.rows,
          code: code, normalized: normalized)
      {
        rows += parsed.rows
        continue
      }
      try Task.checkCancellation()
      guard online() else { throw TileflowBoundaryJoinError.offline }
      if !manifestLoaded {
        if let url = descriptor.manifestURL {
          let body = try await read(url)
          guard let value = try? JSONDecoder().decode(BoundaryLookupManifest.self, from: body),
            value.schemaVersion == 2, value.build == descriptor.releaseID,
            value.family == "boundaries"
          else { throw TileflowBoundaryJoinError.invalidCSV }
          manifest = value
        }
        manifestLoaded = true
      }
      let url = descriptor.classes[boundaryClass]!
      let file: BoundaryLookupManifest.File?
      if let manifest {
        guard let entry = manifest.files[boundaryClass.rawValue],
          entry.file == url.lastPathComponent,
          entry.rows >= 0, entry.bytes > 0,
          entry.sha256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
        else { throw TileflowBoundaryJoinError.invalidCSV }
        guard entry.bytes <= Self.maximumCompressedBytes else {
          throw TileflowBoundaryJoinError.dataTooLarge(limit: Self.maximumCompressedBytes)
        }
        file = entry
      } else {
        file = nil
      }
      let body = try await read(url)
      if let file, body.count != file.bytes || ResourceDigest.sha256(body) != file.sha256 {
        throw TileflowBoundaryJoinError.invalidCSV
      }
      let parsed = try parse(
        body, boundaryClass: boundaryClass, expectedRows: file?.rows,
        code: code, normalized: normalized)
      try Task.checkCancellation()
      try store.write(.init(body: body, rows: parsed.count), key: key)
      rows += parsed.rows
    }
    try Task.checkCancellation()
    return try TileflowBoundaryLookup(rows: rows)
  }

  private func parse(
    _ body: Data, boundaryClass: TileflowBoundaryClass, expectedRows: Int?,
    code: TileflowBoundaryCode?, normalized: Set<TileflowBoundaryKey>
  ) throws -> (rows: [TileflowBoundaryLookupRow], count: Int) {
    let bytes: Data
    if body.starts(with: [0x1f, 0x8b]) {
      do {
        bytes = try ResourceCompression.gunzip(body, maximumBytes: Self.maximumDecodedBytes)
      } catch ResourceError.responseTooLarge {
        throw TileflowBoundaryJoinError.dataTooLarge(limit: Self.maximumDecodedBytes)
      }
    } else {
      bytes = body
    }
    guard bytes.count <= Self.maximumDecodedBytes else {
      throw TileflowBoundaryJoinError.dataTooLarge(limit: Self.maximumDecodedBytes)
    }
    guard let text = String(data: bytes, encoding: .utf8) else {
      throw TileflowBoundaryJoinError.invalidCSV
    }
    var count = 0
    let rows = try parseBoundaryLookupCsv(text) { row in
      count += 1
      if count.isMultiple(of: 1024) { try Task.checkCancellation() }
      guard row.class == boundaryClass, BoundaryCodeNormalization.safeID(row.id) else {
        throw TileflowBoundaryJoinError.invalidCSV
      }
      guard let code else { return true }
      guard let raw = row.key(code), let key = BoundaryCodeNormalization.key(raw, code: code)
      else { return false }
      return normalized.contains(key)
    }
    if let expectedRows, count != expectedRows { throw TileflowBoundaryJoinError.invalidCSV }
    return (rows, count)
  }

  private func read(_ url: URL) async throws -> Data {
    try Task.checkCancellation()
    guard online() else { throw TileflowBoundaryJoinError.offline }
    let payload: ResourcePayload
    do { payload = try await loader.loadOnline(URLRequest(url: url)) } catch let error as URLError
      where [
        .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
        .dnsLookupFailed,
      ].contains(error.code)
    { throw TileflowBoundaryJoinError.offline } catch ResourceError.forbiddenOrigin {
      throw TileflowBoundaryJoinError.accessDenied
    } catch ResourceError.responseTooLarge {
      throw TileflowBoundaryJoinError.dataTooLarge(limit: Self.maximumCompressedBytes)
    } catch let error as TileflowMapError where error == .accessDenied {
      throw TileflowBoundaryJoinError.accessDenied
    } catch let error as TileflowMapError where error == .sessionUnavailable {
      throw TileflowBoundaryJoinError.offline
    }
    guard online() else { throw TileflowBoundaryJoinError.offline }
    guard payload.status == 200 else {
      if [401, 403].contains(payload.status) { throw TileflowBoundaryJoinError.accessDenied }
      throw TileflowBoundaryJoinError.requestFailed(status: payload.status)
    }
    guard payload.bytes.count <= Self.maximumCompressedBytes else {
      throw TileflowBoundaryJoinError.dataTooLarge(limit: Self.maximumCompressedBytes)
    }
    return payload.bytes
  }
}

private struct BoundaryLookupManifest: Decodable {
  let schemaVersion: Int
  let build: String
  let family: String
  let files: [String: File]

  struct File: Decodable {
    let file: String
    let rows: Int
    let bytes: Int
    let sha256: String
  }
}
