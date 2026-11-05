import Foundation
import zlib

enum ResourceCompression {
  static func gunzip(_ data: Data, maximumBytes: Int) throws -> Data {
    var stream = z_stream()
    guard inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK
    else {
      throw ResourceError.invalidResponse
    }
    defer { inflateEnd(&stream) }

    return try data.withUnsafeBytes { input in
      stream.next_in = UnsafeMutablePointer(mutating: input.bindMemory(to: UInt8.self).baseAddress)
      stream.avail_in = uInt(input.count)
      var output = Data()
      var chunk = [UInt8](repeating: 0, count: 65_536)

      while true {
        let status = chunk.withUnsafeMutableBufferPointer { buffer in
          stream.next_out = buffer.baseAddress
          stream.avail_out = uInt(buffer.count)
          return inflate(&stream, Z_NO_FLUSH)
        }
        let count = chunk.count - Int(stream.avail_out)
        guard count <= maximumBytes - output.count else { throw ResourceError.responseTooLarge }
        output.append(contentsOf: chunk.prefix(count))
        if status == Z_STREAM_END {
          if stream.avail_in == 0 { return output }
          guard inflateReset2(&stream, 31) == Z_OK else { throw ResourceError.invalidResponse }
        } else if status != Z_OK || count == 0 && stream.avail_in == 0 {
          throw ResourceError.invalidResponse
        }
      }
    }
  }
}
