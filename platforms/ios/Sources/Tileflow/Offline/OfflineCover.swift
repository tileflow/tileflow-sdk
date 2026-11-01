import Foundation

/// A Hosted download's cover: the tile packs it needs, computed on the device from its region, as
/// Mapbox computes tile regions. The service never sees the region; it plans, assembles and bills
/// the download from the cover and signs its digest.
///
/// Each entry is one anchor tile of a zoom band, with a bit mask of the tiles it covers at its mask
/// zoom, the band's deepest zoom within the download's zooms; the tiles at shallower zooms of the
/// band are their ancestors. Without a mask the whole anchor is covered. For every band the
/// download's zooms reach, the cover lists each anchor the region covers at the anchor zoom, so the
/// tiles of each zoom are exactly the region's.
struct OfflineCover: Hashable, Sendable {
  struct Entry: Hashable, Sendable {
    let anchor: OfflineTileID
    /// The covered tiles at the mask zoom, row-major from the anchor's first, least significant
    /// bit first in each byte; nil when every tile is covered.
    let mask: [UInt8]?
  }

  let minZoom: Int
  let maxZoom: Int
  /// In canonical order: anchor zoom, then row, then column.
  let entries: [Entry]

  /// The most entries the service accepts.
  static let maximumEntries = 16_384

  /// The zoom an anchor's mask describes: its band's deepest zoom within the download's.
  static func maskZoom(anchor: Int, maxZoom: Int) -> Int {
    min(OfflinePackBand.zooms(anchor: anchor)?.upperBound ?? anchor, maxZoom)
  }

  /// The cover of `regions` together at `minZoom...maxZoom`: their union, each tile once.
  ///
  /// - Throws: `regionTooComplex` when it would list more than ``maximumEntries`` packs.
  static func of(_ regions: [OfflinePackRegion], minZoom: Int, maxZoom: Int) throws
    -> OfflineCover
  {
    var entries: [Entry] = []
    for anchorZoom in OfflinePackBand.anchors {
      guard let band = OfflinePackBand.zooms(anchor: anchorZoom),
        band.upperBound >= minZoom, band.lowerBound <= maxZoom
      else { continue }
      let maskZoom = Self.maskZoom(anchor: anchorZoom, maxZoom: maxZoom)
      let shift = maskZoom - anchorZoom
      let side = 1 << shift
      // The anchors the region covers at the anchor zoom, in row order.
      let anchors = OfflineCoverRows(regions, zoom: anchorZoom)
      let count = anchors.count
      guard entries.count + count <= maximumEntries else {
        throw TileflowOfflineError(
          .regionTooComplex,
          context: .init(reason: "tooManyPacks", limit: maximumEntries, count: entries.count + count))
      }
      // The tiles it covers at the mask zoom, by anchor.
      var masks: [OfflineTileID: [UInt8]] = [:]
      let fine = OfflineCoverRows(regions, zoom: maskZoom)
      for (y, ranges) in fine.rows {
        let anchorY = y >> shift
        let dy = y - (anchorY << shift)
        for range in ranges {
          for anchorX in (range.lowerBound >> shift)...(range.upperBound >> shift) {
            let anchor = OfflineTileID(z: anchorZoom, x: anchorX, y: anchorY)
            guard anchors.contains(x: anchorX, y: anchorY) else { continue }
            var mask = masks[anchor] ?? [UInt8](repeating: 0, count: (side * side + 7) / 8)
            let first = max(range.lowerBound, anchorX << shift)
            let last = min(range.upperBound, (anchorX << shift) + side - 1)
            for x in first...last {
              let index = dy * side + (x - (anchorX << shift))
              mask[index >> 3] |= UInt8(1 << (index & 7))
            }
            masks[anchor] = mask
          }
        }
      }
      for (y, ranges) in anchors.rows {
        for range in ranges {
          for x in range {
            let anchor = OfflineTileID(z: anchorZoom, x: x, y: y)
            guard let mask = masks[anchor] else { continue }
            let full = mask.indices.allSatisfy { mask[$0] == Self.fullByte(side: side, index: $0) }
            entries.append(Entry(anchor: anchor, mask: full ? nil : mask))
          }
        }
      }
    }
    return OfflineCover(minZoom: minZoom, maxZoom: maxZoom, entries: entries)
  }

  /// A cover as the service reads one, in canonical form: entries sorted and a full mask dropped.
  /// Nil when the service would refuse it.
  init?(json value: JSONValue?, minZoom: Int, maxZoom: Int) {
    guard case .array(let items) = value, !items.isEmpty, items.count <= Self.maximumEntries
    else { return nil }
    var seen = Set<OfflineTileID>()
    var entries: [Entry] = []
    for item in items {
      guard case .array(let parts) = item, parts.count == 3 || parts.count == 4,
        let z = Self.integer(parts[0]), let band = OfflinePackBand.zooms(anchor: z),
        band.upperBound >= minZoom, band.lowerBound <= maxZoom,
        let x = Self.integer(parts[1]), let y = Self.integer(parts[2]),
        (0..<(1 << z)).contains(x), (0..<(1 << z)).contains(y)
      else { return nil }
      let anchor = OfflineTileID(z: z, x: x, y: y)
      guard seen.insert(anchor).inserted else { return nil }
      var mask: [UInt8]?
      if parts.count == 4 {
        let side = 1 << (Self.maskZoom(anchor: z, maxZoom: maxZoom) - z)
        guard let text = parts[3].string, let decoded = Self.decode(text, side: side) else {
          return nil
        }
        let full = decoded.indices.allSatisfy {
          decoded[$0] == Self.fullByte(side: side, index: $0)
        }
        mask = full ? nil : decoded
      }
      entries.append(Entry(anchor: anchor, mask: mask))
    }
    entries.sort { ($0.anchor.z, $0.anchor.y, $0.anchor.x) < ($1.anchor.z, $1.anchor.y, $1.anchor.x) }
    self.init(minZoom: minZoom, maxZoom: maxZoom, entries: entries)
  }

  init(minZoom: Int, maxZoom: Int, entries: [Entry]) {
    self.minZoom = minZoom
    self.maxZoom = maxZoom
    self.entries = entries
  }

  var json: JSONValue {
    .array(
      entries.map { entry in
        var parts: [JSONValue] = [entry.anchor.z, entry.anchor.x, entry.anchor.y].map {
          .number(Double($0))
        }
        if let mask = entry.mask { parts.append(.string(Self.encode(mask))) }
        return .array(parts)
      })
  }

  /// The canonical JSON the service stores and digests, as `JSON.stringify` writes it.
  var text: String {
    "["
      + entries.map { entry in
        let anchor = "\(entry.anchor.z),\(entry.anchor.x),\(entry.anchor.y)"
        return entry.mask.map { "[\(anchor),\"\(Self.encode($0))\"]" } ?? "[\(anchor)]"
      }.joined(separator: ",") + "]"
  }

  /// The SHA-256 of ``text`` in lowercase hexadecimal, as the manifest and grant carry it.
  var sha256: String { DataChannel.digest(Data(text.utf8)) }

  /// The entry for `anchor`, if the cover lists one.
  func entry(_ anchor: OfflineTileID) -> Entry? {
    var low = 0
    var high = entries.count
    let key = (anchor.z, anchor.y, anchor.x)
    while low < high {
      let middle = (low + high) / 2
      let other = entries[middle].anchor
      if (other.z, other.y, other.x) < key { low = middle + 1 } else { high = middle }
    }
    return low < entries.count && entries[low].anchor == anchor ? entries[low] : nil
  }

  /// Whether the download holds `tile`: a covered tile at its mask zoom, or an ancestor of one
  /// within its band.
  func contains(_ tile: OfflineTileID) -> Bool {
    guard (minZoom...maxZoom).contains(tile.z) else { return false }
    let anchorZoom = OfflinePackBand.anchor(of: tile.z)
    let maskZoom = Self.maskZoom(anchor: anchorZoom, maxZoom: maxZoom)
    guard tile.z <= maskZoom, let entry = entry(tile.ancestor(at: anchorZoom)) else {
      return false
    }
    guard let mask = entry.mask else { return true }
    let side = 1 << (maskZoom - anchorZoom)
    let span = 1 << (maskZoom - tile.z)
    let left = tile.x * span - entry.anchor.x * side
    let top = tile.y * span - entry.anchor.y * side
    for dy in top..<(top + span) {
      for dx in left..<(left + span) {
        let index = dy * side + dx
        if mask[index >> 3] & UInt8(1 << (index & 7)) != 0 { return true }
      }
    }
    return false
  }

  /// The tiles an entry holds within `zooms`: its covered tiles at the mask zoom and their
  /// ancestors, by zoom.
  func tiles(_ entry: Entry, zooms: ClosedRange<Int>) -> [Int: [OfflineTileID]] {
    let anchorZoom = entry.anchor.z
    let maskZoom = Self.maskZoom(anchor: anchorZoom, maxZoom: maxZoom)
    let low = max(zooms.lowerBound, anchorZoom)
    let high = min(zooms.upperBound, maskZoom)
    guard low <= high else { return [:] }
    let side = 1 << (maskZoom - anchorZoom)
    var tiles: [Int: Set<OfflineTileID>] = [:]
    for index in 0..<(side * side) {
      guard entry.mask.map({ $0[index >> 3] & UInt8(1 << (index & 7)) != 0 }) ?? true else {
        continue
      }
      let leaf = OfflineTileID(
        z: maskZoom, x: entry.anchor.x * side + index % side, y: entry.anchor.y * side + index / side)
      for z in low...high { tiles[z, default: []].insert(leaf.ancestor(at: z)) }
    }
    return tiles.mapValues { $0.sorted { ($0.y, $0.x) < ($1.y, $1.x) } }
  }

  /// The byte a fully covered mask holds at `index`: every bit, except the padding of the last.
  private static func fullByte(side: Int, index: Int) -> UInt8 {
    let remaining = side * side - index * 8
    return remaining >= 8 ? 0xFF : UInt8((1 << remaining) - 1)
  }

  /// Unpadded base64url.
  static func encode(_ mask: [UInt8]) -> String {
    Data(mask).base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  /// A mask for `side × side` tiles in its one valid spelling: the right length, no padding bits
  /// set and some tile set.
  private static func decode(_ text: String, side: Int) -> [UInt8]? {
    let length = (side * side + 7) / 8
    guard text.utf8.count == (length * 4 + 2) / 3,
      text.utf8.allSatisfy({ $0.isASCIIAlphanumeric || $0 == UInt8(ascii: "-") || $0 == 0x5F })
    else { return nil }
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let data = Data(base64Encoded: base64), data.count == length else { return nil }
    let mask = [UInt8](data)
    guard mask[length - 1] & ~fullByte(side: side, index: length - 1) == 0,
      mask.contains(where: { $0 != 0 }), encode(mask) == text
    else { return nil }
    return mask
  }

  private static func integer(_ value: JSONValue) -> Int? {
    guard let number = value.number, number.rounded() == number, abs(number) < 1e9 else {
      return nil
    }
    return Int(number)
  }
}

/// The covered tiles of several regions at one zoom, row by row: their union.
struct OfflineCoverRows {
  let rows: [(y: Int, ranges: [ClosedRange<Int>])]
  private let byRow: [Int: [ClosedRange<Int>]]

  init(_ regions: [OfflinePackRegion], zoom: Int) {
    let covers = regions.map { OfflineTileCover($0, zoom: zoom) }
    let spans = covers.compactMap(\.rows)
    var rows: [(y: Int, ranges: [ClosedRange<Int>])] = []
    if let first = spans.map(\.lowerBound).min(), let last = spans.map(\.upperBound).max() {
      for y in first...last {
        let ranges = OfflineTileCover.merged(covers.flatMap { $0.row(y) })
        if !ranges.isEmpty { rows.append((y, ranges)) }
      }
    }
    self.rows = rows
    byRow = Dictionary(uniqueKeysWithValues: rows.map { ($0.y, $0.ranges) })
  }

  var count: Int { rows.reduce(0) { $0 + $1.ranges.reduce(0) { $0 + $1.count } } }

  func contains(x: Int, y: Int) -> Bool { byRow[y]?.contains { $0.contains(x) } ?? false }
}

extension UInt8 {
  fileprivate var isASCIIAlphanumeric: Bool {
    (0x30...0x39).contains(self) || (0x41...0x5A).contains(self) || (0x61...0x7A).contains(self)
  }
}
