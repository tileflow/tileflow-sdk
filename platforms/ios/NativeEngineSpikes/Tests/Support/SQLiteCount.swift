import Foundation
import SQLite3

enum SQLiteCount {
  /// The number of rows of `table`, or -1 when the database or table cannot be read.
  static func rows(path: String, table: String) -> Int {
    var database: OpaquePointer?
    guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      sqlite3_close(database)
      return -1
    }
    defer { sqlite3_close(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, "SELECT COUNT(*) FROM \(table)", -1, &statement, nil) == SQLITE_OK
    else { return -1 }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { return -1 }
    return Int(sqlite3_column_int64(statement, 0))
  }
}
