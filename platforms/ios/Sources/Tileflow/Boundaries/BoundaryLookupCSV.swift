import Foundation

/// Parses a decompressed release lookup. Unknown columns and empty cells are omitted.
public func parseBoundaryLookupCsv(_ text: String) throws -> [TileflowBoundaryLookupRow] {
  try parseBoundaryLookupCsv(text, retaining: { _ in true })
}

func parseBoundaryLookupCsv(
  _ text: String, retaining: (TileflowBoundaryLookupRow) throws -> Bool
) throws -> [TileflowBoundaryLookupRow] {
  var header: [String]?
  var rows: [TileflowBoundaryLookupRow] = []
  try BoundaryCSV.records(text) { record in
    guard let columns = header else {
      guard record.contains("id"), record.contains("class") else {
        throw TileflowBoundaryJoinError.invalidCSV
      }
      header = record
      return
    }
    let header = columns
    if record == [""] { return }
    guard record.count == header.count else { throw TileflowBoundaryJoinError.invalidCSV }
    var fields: [String: String] = [:]
    for (column, cell) in zip(header, record) where !cell.isEmpty { fields[column] = cell }

    guard let rawID = fields["id"], let id = BoundaryCodeNormalization.numeric(rawID),
      id.isFinite, abs(id) <= 9_007_199_254_740_991, id.rounded() == id,
      let rawClass = fields["class"], let boundaryClass = TileflowBoundaryClass(rawValue: rawClass)
    else { throw TileflowBoundaryJoinError.invalidCSV }

    var adminLevel: Int?
    if let raw = fields["admin_level"] {
      guard let number = BoundaryCodeNormalization.numeric(raw), number.isFinite,
        abs(number) <= 9_007_199_254_740_991, number.rounded() == number
      else { throw TileflowBoundaryJoinError.invalidCSV }
      adminLevel = Int(number)
    }
    if let tier = fields["class_tier"], !["primary", "secondary"].contains(tier) {
      throw TileflowBoundaryJoinError.invalidCSV
    }

    let row = TileflowBoundaryLookupRow(
      id: id, class: boundaryClass, adminLevel: adminLevel, classTier: fields["class_tier"],
      iso31661: fields["iso_3166_1"], iso31662: fields["iso_3166_2"], name: fields["name"],
      nameEn: fields["name_en"], nuts: fields["nuts"], ref: fields["ref"],
      wikidata: fields["wikidata"])
    if try retaining(row) { rows.append(row) }
  }
  guard header != nil else { throw TileflowBoundaryJoinError.invalidCSV }
  return rows
}

private enum BoundaryCSV {
  static func records(_ text: String, consume: ([String]) throws -> Void) throws {
    var iterator = text.unicodeScalars.makeIterator()
    var pending: Unicode.Scalar?
    var record: [String] = []
    var field = ""
    var quoted = false

    while let character = pending ?? iterator.next() {
      pending = nil
      if quoted {
        if character == "\"" {
          let next = iterator.next()
          if next == "\"" {
            field.append("\"")
          } else {
            quoted = false
            pending = next
          }
        } else {
          field.unicodeScalars.append(character)
        }
      } else if character == "\"", field.isEmpty {
        quoted = true
      } else if character == "," {
        record.append(field)
        field = ""
      } else if character == "\n" || character == "\r" {
        if character == "\r" {
          let next = iterator.next()
          if next != "\n" { pending = next }
        }
        record.append(field)
        try consume(record)
        record = []
        field = ""
      } else {
        field.unicodeScalars.append(character)
      }
    }
    guard !quoted else { throw TileflowBoundaryJoinError.invalidCSV }
    if !field.isEmpty || !record.isEmpty {
      record.append(field)
      try consume(record)
    }
  }
}
