import Foundation

/// A GPX point: its position and, when the document records one, its height in metres.
public struct TileflowGPXPoint: Sendable, Hashable {
  public var position: TileflowPosition
  public var elevation: Double?
}

/// The tracks and routes of a GPX 1.0 or 1.1 document.
public struct TileflowGPXTrack: Sendable, Hashable {
  /// The first track or route name, when the document has one.
  public var name: String?
  /// One line per track segment and per route, in document order, each of two or more points.
  public var lines: [[TileflowGPXPoint]]
}

public enum TileflowGPXError: Error, Sendable, Equatable {
  /// The data is not a GPX document.
  case notGPX
  /// A point has a missing or out-of-range latitude or longitude.
  case invalidPoint
  /// The document has more than a million points.
  case tooManyPoints
  /// The document has no track segment or route of at least two points.
  case noTrack
}

public enum TileflowGPX {
  /// Points kept from one document: about ten days of one-second samples.
  public static let maximumPoints = 1_000_000

  /// Reads the tracks and routes of a GPX document. Waypoints are not lines and are left out.
  /// External entities are never loaded.
  public static func read(_ data: Data) throws -> TileflowGPXTrack {
    let reader = GPXReader()
    let parser = XMLParser(data: data)
    parser.shouldResolveExternalEntities = false
    parser.shouldProcessNamespaces = true
    parser.delegate = reader
    let parsed = parser.parse()
    if let error = reader.failure { throw error }
    guard parsed, reader.isGPX else { throw TileflowGPXError.notGPX }
    guard !reader.lines.isEmpty else { throw TileflowGPXError.noTrack }
    let name = reader.name?.trimmingCharacters(in: .whitespacesAndNewlines)
    return TileflowGPXTrack(name: name?.isEmpty == false ? name : nil, lines: reader.lines)
  }
}

private final class GPXReader: NSObject, XMLParserDelegate {
  var isGPX = false
  var lines: [[TileflowGPXPoint]] = []
  var name: String?
  var failure: TileflowGPXError?
  private var line: [TileflowGPXPoint]?
  private var point: TileflowGPXPoint?
  private var points = 0
  private var depth = 0
  private var nameOwnerDepth: Int?
  private var text: String?

  func parser(
    _ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
    qualifiedName: String?, attributes: [String: String] = [:]
  ) {
    depth += 1
    let element = Self.localName(elementName)
    if depth == 1 {
      guard element == "gpx" else { return fail(parser, .notGPX) }
      isGPX = true
      return
    }
    switch element {
    case "trkseg", "rte":
      line = []
      if element == "rte", name == nil { nameOwnerDepth = depth }
    case "trk":
      if name == nil { nameOwnerDepth = depth }
    case "trkpt", "rtept":
      guard line != nil else { return }
      points += 1
      guard points <= TileflowGPX.maximumPoints else { return fail(parser, .tooManyPoints) }
      guard let lat = Self.coordinate(attributes, "lat"),
        let lon = Self.coordinate(attributes, "lon"),
        abs(lat) <= 90, abs(lon) <= 180
      else { return fail(parser, .invalidPoint) }
      point = TileflowGPXPoint(position: TileflowPosition(longitude: lon, latitude: lat))
    case "ele" where point != nil:
      text = ""
    case "name" where nameOwnerDepth == depth - 1:
      text = ""
    default: break
    }
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    text?.append(string)
  }

  func parser(_ parser: XMLParser, foundCDATA block: Data) {
    text?.append(String(decoding: block, as: UTF8.self))
  }

  func parser(
    _ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?,
    qualifiedName: String?
  ) {
    defer { depth -= 1 }
    switch Self.localName(elementName) {
    case "ele" where point != nil && text != nil:
      if let height = Double(text!.trimmingCharacters(in: .whitespacesAndNewlines)),
        height.isFinite
      {
        point?.elevation = height
      }
      text = nil
    case "name" where text != nil:
      if name == nil { name = text }
      nameOwnerDepth = nil
      text = nil
    case "trkpt", "rtept":
      if let point { line?.append(point) }
      point = nil
    case "trkseg", "rte":
      if let line, line.count >= 2 { lines.append(line) }
      line = nil
      if nameOwnerDepth == depth { nameOwnerDepth = nil }
    case "trk":
      if nameOwnerDepth == depth { nameOwnerDepth = nil }
    default: break
    }
  }

  private func fail(_ parser: XMLParser, _ error: TileflowGPXError) {
    if failure == nil { failure = error }
    parser.abortParsing()
  }

  private static func localName(_ name: String) -> String {
    name.split(separator: ":").last.map(String.init) ?? name
  }

  private static func coordinate(_ attributes: [String: String], _ key: String) -> Double? {
    guard let text = attributes[key]?.trimmingCharacters(in: .whitespaces), !text.isEmpty,
      let value = Double(text), value.isFinite
    else { return nil }
    return value
  }
}
