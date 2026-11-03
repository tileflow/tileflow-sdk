import Foundation

/// Reads a source's attribution, which a style declares as plain text or as HTML with links, into
/// the items a map shows.
///
/// The text is what a browser shows for the HTML: tags are left out, character references are
/// decoded and runs of white space become one space. Nothing else changes. An attribution that is
/// a list of links separated only by white space, as Tileflow's sources write theirs, gives one
/// item per link, so a credit two sources share appears once; any other attribution is one item,
/// so text around a link stays with it. Only `https` addresses become links.
enum MapAttributionText {
  struct Item: Equatable, Sendable {
    let text: String
    let links: [MapAttributionEntry.Link]
  }

  /// A run of text inside one link, or outside any.
  private struct Run {
    var text: String
    var href: String?
  }

  static func items(_ attribution: String) -> [Item] {
    let runs = self.runs(attribution)
    var groups: [[Run]] = [[]]
    for (index, run) in runs.enumerated() {
      let separator =
        run.href == nil && run.text.allSatisfy(\.isCollapsibleSpace)
        && runs[..<index].last(where: { !$0.text.isEmpty })?.href != nil
        && runs[(index + 1)...].first(where: { !$0.text.isEmpty })?.href != nil
      if separator {
        groups.append([])
      } else {
        groups[groups.count - 1].append(run)
      }
    }
    return groups.compactMap(item)
  }

  /// `links` with every `https` address written in `text` opening itself; where a link covers
  /// the address, the address takes that part. Trailing punctuation is not part of an address.
  static func linkingAddresses(
    in text: String, around links: [MapAttributionEntry.Link]
  ) -> [MapAttributionEntry.Link] {
    var found: [MapAttributionEntry.Link] = []
    for match in text.matches(of: #/https://[^\s()<>"']+/#) {
      var address = String(text[match.range])
      while let last = address.last, ".,;:!?".contains(last) { address.removeLast() }
      guard let url = page(address) else { continue }
      let start = text.utf16.distance(from: text.utf16.startIndex, to: match.range.lowerBound)
      found.append(.init(range: start..<(start + address.utf16.count), url: url))
    }
    guard !found.isEmpty else { return links }
    var result: [MapAttributionEntry.Link] = []
    for link in links {
      var pieces = [link.range]
      for address in found {
        pieces = pieces.flatMap { piece -> [Range<Int>] in
          guard piece.overlaps(address.range) else { return [piece] }
          return [
            piece.lowerBound..<max(piece.lowerBound, address.range.lowerBound),
            min(piece.upperBound, address.range.upperBound)..<piece.upperBound,
          ].filter { !$0.isEmpty }
        }
      }
      result += pieces.map { .init(range: $0, url: link.url) }
    }
    return (result + found).sorted { $0.range.lowerBound < $1.range.lowerBound }
  }

  /// An `https` page address, or nil.
  static func page(_ address: String) -> URL? {
    guard let url = URL(string: address), url.scheme?.lowercased() == "https",
      let host = url.host, !host.isEmpty
    else { return nil }
    return url
  }

  /// The runs' text with white space collapsed and trimmed, and the links among it.
  private static func item(_ runs: [Run]) -> Item? {
    var text = ""
    var length = 0
    var links: [MapAttributionEntry.Link] = []
    var pendingSpace = false
    for run in runs {
      let page = run.href.flatMap(Self.page)
      var start: Int?
      for character in run.text {
        if character.isCollapsibleSpace {
          pendingSpace = !text.isEmpty
          continue
        }
        if pendingSpace {
          text.append(" ")
          length += 1
          pendingSpace = false
        }
        if start == nil { start = length }
        text.append(character)
        length += String(character).utf16.count
      }
      if let page, let start, start < length {
        links.append(.init(range: start..<length, url: page))
      }
    }
    return text.isEmpty ? nil : Item(text: text, links: links)
  }

  /// Splits HTML into text runs, each inside one link or outside any. Unknown tags are left out;
  /// a `<` that opens no tag is text.
  private static func runs(_ html: String) -> [Run] {
    var runs: [Run] = []
    var href: String?
    var pending = ""
    func flush() {
      if !pending.isEmpty { runs.append(Run(text: decode(pending), href: href)) }
      pending = ""
    }
    var rest = html[...]
    while let open = rest.firstIndex(of: "<") {
      pending += rest[..<open]
      guard let close = rest[open...].firstIndex(of: ">") else {
        pending += rest[open...]
        rest = rest[rest.endIndex...]
        break
      }
      let tag = rest[rest.index(after: open)..<close]
      rest = rest[rest.index(after: close)...]
      let closing = tag.first == "/"
      let name = tag.dropFirst(closing ? 1 : 0).prefix { $0.isLetter || $0.isNumber }.lowercased()
      switch (closing, name) {
      case (false, "a"):
        flush()
        href = attribute("href", in: tag).map(decode)
      case (true, "a"):
        flush()
        href = nil
      case (_, "br"):
        pending += " "
      default:
        break
      }
    }
    pending += rest
    flush()
    return runs
  }

  /// The value of an attribute of a start tag, quoted or not.
  private static func attribute(_ name: String, in tag: Substring) -> String? {
    var rest = tag.drop { !$0.isWhitespace }
    while !rest.isEmpty {
      rest = rest.drop { $0.isWhitespace || $0 == "/" }
      let key = rest.prefix { !$0.isWhitespace && $0 != "=" && $0 != "/" }
      rest = rest.dropFirst(key.count).drop(while: \.isWhitespace)
      var value: Substring?
      if rest.first == "=" {
        rest = rest.dropFirst().drop(while: \.isWhitespace)
        if let quote = rest.first, quote == "\"" || quote == "'" {
          let body = rest.dropFirst()
          let end = body.firstIndex(of: quote) ?? body.endIndex
          value = body[..<end]
          rest = end < body.endIndex ? body[body.index(after: end)...] : body[body.endIndex...]
        } else {
          let end = rest.firstIndex(where: \.isWhitespace) ?? rest.endIndex
          value = rest[..<end]
          rest = rest[end...]
        }
      }
      if key.lowercased() == name { return value.map(String.init) ?? "" }
      if key.isEmpty, value == nil { rest = rest.dropFirst() }
    }
    return nil
  }

  private static let named: [String: String] = [
    "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}",
    "copy": "©", "reg": "®", "trade": "™", "mdash": "—", "ndash": "–", "hellip": "…",
    "middot": "·", "bull": "•", "laquo": "«", "raquo": "»",
  ]

  /// Decodes character references: the common named ones and every numeric one.
  static func decode(_ text: String) -> String {
    guard text.contains("&") else { return text }
    var result = ""
    var rest = text[...]
    while let amp = rest.firstIndex(of: "&") {
      result += rest[..<amp]
      let after = rest[rest.index(after: amp)...]
      if let semicolon = after.prefix(12).firstIndex(of: ";") {
        let name = after[..<semicolon]
        var decoded: String?
        if name.hasPrefix("#x") || name.hasPrefix("#X") {
          decoded = UInt32(name.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map {
            String(Character($0))
          }
        } else if name.hasPrefix("#") {
          decoded = UInt32(name.dropFirst()).flatMap(Unicode.Scalar.init).map {
            String(Character($0))
          }
        } else {
          decoded = named[String(name)]
        }
        if let decoded {
          result += decoded
          rest = after[after.index(after: semicolon)...]
          continue
        }
      }
      result.append("&")
      rest = after
    }
    return result + rest
  }
}

extension Character {
  /// White space HTML collapses; a no-break space is kept.
  fileprivate var isCollapsibleSpace: Bool { isWhitespace && self != "\u{00A0}" }
}
