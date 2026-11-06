import Foundation

struct BoundaryJoinRequest: Codable {
  let rows: [TileflowBoundaryRow]
  let options: JoinBoundaryRowsOptions
}

extension NativeMapEngine {
  func joinBoundaries(_ payload: JSONValue) async throws -> JSONValue {
    let request: BoundaryJoinRequest
    do {
      request = try JSONDecoder().decode(
        BoundaryJoinRequest.self, from: JSONEncoder().encode(payload))
    } catch { throw TileflowMapError.invalidRequest }

    let revision = boundaryLookupRevision
    var options = request.options
    do {
      if options.lookup == nil, options.joinBy.rawValue != options.to.rawValue {
        guard let descriptor = boundaryLookup, let identity = boundaryLookupIdentity else {
          throw TileflowBoundaryJoinError.lookupUnavailable
        }
        let service = BoundaryLookupService(
          loader: loader, store: boundaryLookupStore, identity: identity)
        options.lookup = try await service.lookup(
          descriptor, classes: options.classes,
          matching: options.joinBy, keys: request.rows.map(\.key))
      }
      try Task.checkCancellation()
      guard !retired, revision == boundaryLookupRevision else { throw TileflowMapError.cancelled }
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
    } catch is BoundaryLookupStorageError {
      guard !retired, revision == boundaryLookupRevision else { throw TileflowMapError.cancelled }
      throw TileflowMapError(
        .resourceFailed,
        context: .init(
          reason: MapContract.ErrorReason.boundaryLookupUnavailable.rawValue, resource: .data,
          message: "The Boundaries lookup could not be saved on this device."))
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
