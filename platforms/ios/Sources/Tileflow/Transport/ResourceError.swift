import Foundation

enum ResourceError: Error, Equatable {
  case invalidAddress
  case forbiddenOrigin
  case unsupportedRequest
  case responseTooLarge
  case invalidResponse
  case disposed
}
