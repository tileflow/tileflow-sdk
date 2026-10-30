import Compression
import CryptoKit
import Foundation

/// What a Hosted pack holds: a source's tiles under one anchor tile, or documents.
enum OfflinePackKind: UInt8, Sendable, Hashable {
  case tiles = 1
  case documents = 2

  /// The manifest's name for the kind.
  init?(manifest value: String?) {
    switch value {
    case "tiles": self = .tiles
    case "documents": self = .documents
    default: return nil
    }
  }
}

/// One entry of a pack: where its body lies in the pack file and how its route serves it.
struct OfflinePackEntry: Sendable, Hashable {
  let name: String
  let contentType: String
  /// `gzip`, or nil for a body served as it is.
  let contentEncoding: String?
  /// The body's offset from the start of the file.
  let offset: UInt64
  let length: Int
}

/// A pack's entries by name, read from its header and index.
struct OfflinePackIndex: Sendable {
  let kind: OfflinePackKind
  let entries: [String: OfflinePackEntry]
}

/// The pack format (`application/vnd.tileflow.pack`), little-endian:
///
///     header   "TFPK", version u16 = 1, kind u8, reserved u8 = 0, entry count u32,
///              index length u32, data length u64, reserved u64 = 0
///     index    per entry: name length u16 + UTF-8 name, content type length u8 + ASCII,
///              content encoding length u8 + ASCII (empty for none), data offset u64,
///              data length u32
///     data     the bodies in index order, each its own range
///     trailer  SHA-256 of every preceding byte
///
/// The trailer is the pack's digest and its `ETag`. A pack is verified once, when it arrives, and
/// stored under its digest; serving reads only its header, its index and the one body asked for.
enum OfflinePackFormat {
  static let headerLength = 32
  static let trailerLength = 32
  static let version: UInt16 = 1
  /// No pack the service delivers is larger.
  static let maximumBytes = 32 * 1024 * 1024
  static let mediaType = "application/vnd.tileflow.pack"
  static let maximumEntries = 65_536
  static let maximumNameBytes = 4096

  static let invalid = TileflowOfflineError(
    .invalidResponse, context: .init(reason: "verificationFailed"))

  /// Verifies a received pack: exactly `bytes` long, its trailer the SHA-256 of what precedes it,
  /// and a well-formed header and index of `kind` whose bodies fill the data section in order.
  /// Returns its digest, in lowercase hexadecimal, and its index.
  static func verify(_ file: URL, bytes: Int, kind: OfflinePackKind) throws -> (
    digest: String, index: OfflinePackIndex
  ) {
    guard let handle = try? FileHandle(forReadingFrom: file) else { throw invalid }
    defer { try? handle.close() }
    guard let size = try? handle.seekToEnd(), size == UInt64(bytes),
      size >= UInt64(headerLength + trailerLength), size <= UInt64(maximumBytes)
    else { throw invalid }
    try? handle.seek(toOffset: 0)
    var hasher = SHA256()
    var remaining = Int(size) - trailerLength
    while remaining > 0 {
      guard let chunk = try? handle.read(upToCount: min(remaining, 1 << 20)), !chunk.isEmpty
      else { throw invalid }
      hasher.update(data: chunk)
      remaining -= chunk.count
    }
    guard let trailer = try? handle.read(upToCount: trailerLength), trailer.count == trailerLength,
      Data(hasher.finalize()) == trailer
    else { throw invalid }
    let index = try read(handle, size: size)
    guard index.kind == kind else { throw invalid }
    return (trailer.map { String(format: "%02x", $0) }.joined(), index)
  }

  /// The index of a stored pack, which was verified when it arrived.
  static func index(_ file: URL) throws -> OfflinePackIndex {
    guard let handle = try? FileHandle(forReadingFrom: file) else { throw invalid }
    defer { try? handle.close() }
    guard let size = try? handle.seekToEnd() else { throw invalid }
    return try read(handle, size: size)
  }

  /// An entry's body, exactly as its route serves it.
  static func body(_ entry: OfflinePackEntry, in file: URL) throws -> Data {
    guard let handle = try? FileHandle(forReadingFrom: file) else { throw invalid }
    defer { try? handle.close() }
    try handle.seek(toOffset: entry.offset)
    guard let data = try handle.read(upToCount: entry.length), data.count == entry.length else {
      throw invalid
    }
    return data
  }

  private static func read(_ handle: FileHandle, size: UInt64) throws -> OfflinePackIndex {
    try? handle.seek(toOffset: 0)
    guard let header = try? handle.read(upToCount: headerLength), header.count == headerLength,
      header.prefix(4) == Data("TFPK".utf8)
    else { throw invalid }
    var reader = LittleEndianReader(header, at: 4)
    guard reader.u16() == version, let kind = reader.u8().flatMap(OfflinePackKind.init(rawValue:)),
      reader.u8() == 0, let count = reader.u32(), let indexLength = reader.u32(),
      let dataLength = reader.u64(), reader.u64() == 0, count <= maximumEntries,
      UInt64(headerLength) + UInt64(indexLength) + dataLength + UInt64(trailerLength) == size
    else { throw invalid }
    guard let index = try? handle.read(upToCount: Int(indexLength)),
      index.count == Int(indexLength)
    else { throw invalid }
    let dataStart = UInt64(headerLength) + UInt64(indexLength)
    var records = LittleEndianReader(index, at: 0)
    var entries: [String: OfflinePackEntry] = [:]
    entries.reserveCapacity(Int(count))
    var next: UInt64 = 0
    for _ in 0..<count {
      guard let nameLength = records.u16(), (1...maximumNameBytes).contains(Int(nameLength)),
        let name = records.bytes(Int(nameLength)).flatMap({ String(data: $0, encoding: .utf8) }),
        let typeLength = records.u8(), typeLength > 0,
        let type = records.bytes(Int(typeLength)).flatMap(ascii),
        let encodingLength = records.u8(),
        let encoding = records.bytes(Int(encodingLength)).flatMap(ascii),
        let offset = records.u64(), let length = records.u32(), offset == next,
        entries[name] == nil
      else { throw invalid }
      next += UInt64(length)
      guard next <= dataLength else { throw invalid }
      entries[name] = OfflinePackEntry(
        name: name, contentType: type, contentEncoding: encoding.isEmpty ? nil : encoding,
        offset: dataStart + offset, length: Int(length))
    }
    guard records.isAtEnd, next == dataLength else { throw invalid }
    return OfflinePackIndex(kind: kind, entries: entries)
  }

  /// Printable ASCII, as content types and encodings are.
  private static func ascii(_ data: Data) -> String? {
    guard data.allSatisfy({ (0x20...0x7e).contains($0) }) else { return nil }
    return String(data: data, encoding: .ascii)
  }

  /// The body a gzip member holds. Pack entries keep their stored compression, while the renderer
  /// receives bodies as the platform's HTTP stack delivers them, decoded.
  static func gunzip(_ data: Data) throws -> Data {
    let bytes = [UInt8](data)
    guard bytes.count >= 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else {
      throw invalid
    }
    let flags = bytes[3]
    var start = 10
    if flags & 0x04 != 0 {
      guard start + 2 <= bytes.count else { throw invalid }
      start += 2 + Int(bytes[start]) + Int(bytes[start + 1]) << 8
    }
    for flag: UInt8 in [0x08, 0x10] where flags & flag != 0 {
      while start < bytes.count, bytes[start] != 0 { start += 1 }
      start += 1
    }
    if flags & 0x02 != 0 { start += 2 }
    let end = bytes.count - 8
    guard start <= end else { throw invalid }
    let size =
      Int(bytes[end + 4]) | Int(bytes[end + 5]) << 8 | Int(bytes[end + 6]) << 16
      | Int(bytes[end + 7]) << 24
    guard size <= maximumBytes else { throw invalid }
    var output = Data(count: max(size, 1))
    let written = output.withUnsafeMutableBytes { target in
      bytes.withUnsafeBufferPointer { source in
        compression_decode_buffer(
          target.bindMemory(to: UInt8.self).baseAddress!, size,
          source.baseAddress! + start, end - start, nil, COMPRESSION_ZLIB)
      }
    }
    guard written == size else { throw invalid }
    return output.prefix(size)
  }
}

/// Reads little-endian integers and byte runs, answering nil past the end.
private struct LittleEndianReader {
  private let data: Data
  private var position: Int

  init(_ data: Data, at position: Int) {
    self.data = data
    self.position = data.startIndex + position
  }

  var isAtEnd: Bool { position == data.endIndex }

  mutating func bytes(_ count: Int) -> Data? {
    guard count >= 0, position + count <= data.endIndex else { return nil }
    defer { position += count }
    return data[position..<position + count]
  }

  private mutating func integer(_ width: Int) -> UInt64? {
    guard let run = bytes(width) else { return nil }
    return run.reversed().reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
  }

  mutating func u8() -> UInt8? { integer(1).map { UInt8($0) } }
  mutating func u16() -> UInt16? { integer(2).map { UInt16($0) } }
  mutating func u32() -> UInt32? { integer(4).map { UInt32($0) } }
  mutating func u64() -> UInt64? { integer(8) }
}

/// A tile's address.
struct OfflineTileID: Sendable, Hashable {
  let z: Int
  let x: Int
  let y: Int

  /// A pack entry's name, `z/x/y` in decimal without leading zeros.
  init?(name: String) {
    let parts = name.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 3, let z = Self.number(parts[0]), z <= OfflineZooms.maximum,
      let x = Self.number(parts[1]), let y = Self.number(parts[2]), x < 1 << z, y < 1 << z
    else { return nil }
    self.init(z: z, x: x, y: y)
  }

  init(z: Int, x: Int, y: Int) {
    self.z = z
    self.x = x
    self.y = y
  }

  var name: String { "\(z)/\(x)/\(y)" }

  /// The tile's ancestor at `zoom`, which is at most its own zoom.
  func ancestor(at zoom: Int) -> OfflineTileID {
    OfflineTileID(z: zoom, x: x >> (z - zoom), y: y >> (z - zoom))
  }

  static func number(_ text: Substring) -> Int? {
    guard !text.isEmpty, text.count <= 7, text.allSatisfy(\.isDecimalDigitASCII),
      text == "0" || text.first != "0"
    else { return nil }
    return Int(text)
  }
}

/// The service's fixed zoom bands: a tile pack holds one anchor's covered tiles within its band.
enum OfflinePackBand {
  static let anchors = [0, 7, 11, 16, 21]

  /// The anchor zoom of the band holding `zoom`.
  static func anchor(of zoom: Int) -> Int { anchors.last { $0 <= zoom } ?? 0 }

  /// The zooms of the band anchored at `anchor`, or nil when no band is.
  static func zooms(anchor: Int) -> ClosedRange<Int>? {
    guard let index = anchors.firstIndex(of: anchor) else { return nil }
    let end = index + 1 < anchors.count ? anchors[index + 1] - 1 : OfflineZooms.maximum
    return anchor...end
  }
}

/// A source's tile URL template with `{z}`, `{x}` and `{y}`, read in both directions.
struct OfflineTileTemplate: Sendable, Hashable {
  let text: String
  /// The literal runs around the placeholders, and the placeholders in order.
  private let literals: [String]
  private let order: [Character]

  init?(_ text: String) {
    var literals: [String] = []
    var order: [Character] = []
    var rest = Substring(text)
    while let open = rest.firstIndex(of: "{") {
      let close = rest.index(open, offsetBy: 3, limitedBy: rest.endIndex)
      guard let close, rest[rest.index(before: close)] == "}",
        let name = rest[rest.index(after: open)...].first, "zxy".contains(name),
        !order.contains(name)
      else { return nil }
      literals.append(String(rest[..<open]))
      order.append(name)
      rest = rest[close...]
    }
    literals.append(String(rest))
    // Adjacent placeholders cannot be told apart in a URL.
    guard order.count == 3, literals.dropFirst().dropLast().allSatisfy({ !$0.isEmpty }),
      literals.dropFirst().allSatisfy({ $0.first?.isDecimalDigitASCII != true })
    else { return nil }
    self.text = text
    self.literals = literals
    self.order = order
  }

  func url(_ tile: OfflineTileID) -> URL? {
    URL(
      string: text.replacingOccurrences(of: "{z}", with: String(tile.z))
        .replacingOccurrences(of: "{x}", with: String(tile.x))
        .replacingOccurrences(of: "{y}", with: String(tile.y)))
  }

  /// The tile a URL this template produced addresses.
  func tile(_ url: String) -> OfflineTileID? {
    guard url.hasPrefix(literals[0]) else { return nil }
    var rest = Substring(url).dropFirst(literals[0].count)
    var values: [Character: Int] = [:]
    for (index, name) in order.enumerated() {
      let digits = rest.prefix { $0.isDecimalDigitASCII }
      guard let value = OfflineTileID.number(digits) else { return nil }
      values[name] = value
      rest = rest.dropFirst(digits.count)
      let literal = literals[index + 1]
      guard rest.hasPrefix(literal) else { return nil }
      rest = rest.dropFirst(literal.count)
    }
    guard rest.isEmpty, let z = values["z"], let x = values["x"], let y = values["y"],
      z <= OfflineZooms.maximum, x < 1 << z, y < 1 << z
    else { return nil }
    return OfflineTileID(z: z, x: x, y: y)
  }
}

extension Character {
  fileprivate var isDecimalDigitASCII: Bool { ("0"..."9").contains(self) }
}
