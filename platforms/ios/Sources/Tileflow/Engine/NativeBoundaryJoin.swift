import Foundation

struct BoundaryJoinRequest: Codable {
  let rows: [TileflowBoundaryRow]
  let options: JoinBoundaryRowsOptions
}

extension NativeMapEngine {
  func joinBoundaries(_ payload: JSONValue) async throws -> JSONValue {
    let service = BoundaryLookupService(loader: loader)
    guard service.online() else {
      throw TileflowMapError(.resourceFailed, reason: .boundaryLookupOffline)
    }
    let request: BoundaryJoinRequest
    do {
      request = try JSONDecoder().decode(
        BoundaryJoinRequest.self, from: JSONEncoder().encode(payload))
    } catch { throw TileflowMapError.invalidRequest }

    let revision = boundaryLookupRevision
    var options = request.options
    do {
      if options.lookup == nil, options.joinBy.rawValue != options.to.rawValue {
        guard let descriptor = boundaryLookup else {
          throw TileflowBoundaryJoinError.lookupUnavailable
        }
        options.lookup = try await service.lookup(
          descriptor, classes: options.classes,
          matching: options.joinBy, keys: request.rows.map(\.key))
      }
      try Task.checkCancellation()
      guard !retired, revision == boundaryLookupRevision else { throw TileflowMapError.cancelled }
      guard service.online() else { throw TileflowBoundaryJoinError.offline }
      return try .encoded(joinBoundaryRows(request.rows, options: options))
    } catch let error as TileflowBoundaryJoinError {
      guard !retired, revision == boundaryLookupRevision else { throw TileflowMapError.cancelled }
      let reason: MapContract.ErrorReason
      switch error {
      case .offline: reason = .boundaryLookupOffline
      case .lookupRequired, .lookupUnavailable, .accessDenied, .requestFailed:
        reason = .boundaryLookupUnavailable
      case .invalidCSV, .invalidLookupID: reason = .boundaryLookupInvalid
      case .mapChanged: throw TileflowMapError.cancelled
      case .dataTooLarge(let limit):
        throw TileflowMapError(.resourceFailed, reason: .dataTooLarge, limit: limit)
      }
      let status: Int?
      if case .requestFailed(let value) = error {
        status = value
      } else if error == .accessDenied {
        status = 403
      } else {
        status = nil
      }
      throw TileflowMapError(
        .resourceFailed,
        context: .init(
          reason: reason.rawValue, resource: .data, status: status, message: error.errorDescription)
      )
    } catch let error as ResourceError {
      guard !retired, revision == boundaryLookupRevision else { throw TileflowMapError.cancelled }
      if error == .responseTooLarge {
        throw TileflowMapError(.resourceFailed, reason: .dataTooLarge, limit: 16 * 1024 * 1024)
      }
      throw TileflowMapError(
        .resourceFailed,
        reason:
          error == .forbiddenOrigin ? .boundaryLookupUnavailable : .boundaryLookupInvalid)
    }
  }
}
