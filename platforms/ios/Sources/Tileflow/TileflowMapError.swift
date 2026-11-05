import Foundation

/// A map failure, warning or rejected call, with a code from the taxonomy the SDK shares with its
/// renderer and diagnostic context.
///
/// Errors compare and hash by ``code`` alone, so `error == .disposed` and `case .disposed:` match
/// whatever context an error carries. Switch over ``code`` to handle every case.
public struct TileflowMapError: Error, Hashable, Sendable, CustomStringConvertible {
  public let code: Code
  public let context: TileflowErrorContext

  public init(_ code: Code, context: TileflowErrorContext = .init()) {
    self.code = code
    self.context = context
  }

  /// Whether the same work can succeed later without the application changing anything.
  public var isRecoverable: Bool { code.isRecoverable }

  public static func == (lhs: Self, rhs: Self) -> Bool { lhs.code == rhs.code }
  public func hash(into hasher: inout Hasher) { hasher.combine(code) }

  public var description: String {
    let detail = context.description
    return detail.isEmpty ? "TileflowMapError.\(code)" : "TileflowMapError.\(code) (\(detail))"
  }
}

/// Diagnostic detail for a ``TileflowMapError``. It never holds a URL path, query or credential;
/// a resource is identified by its kind and origin only.
public struct TileflowErrorContext: Hashable, Sendable, CustomStringConvertible {
  /// A stable identifier for the cause within the code, for example
  /// `dataTooLarge`, `dataIntegrity`, `invalidGeoJSON`, `graphicsContextLost` or
  /// `featureUnavailable`.
  public var reason: String?
  public var resource: TileflowResourceKind?
  /// The scheme, host and port of the resource, for example `https://tiles.example.com`.
  public var origin: String?
  /// The HTTP status of the resource's answer.
  public var status: Int?
  /// The limit that was exceeded, in bytes or items.
  public var limit: Int?
  /// How many bytes or items there were when ``limit`` was exceeded, when known.
  public var count: Int?
  /// A developer-facing explanation in English. Not for display to people using the app.
  public var message: String?
  /// The capability the map holds and this renderer does not draw, with the reason
  /// `featureUnavailable`: for example `scene3d`, `terrain3d` or `pitchAbove60`.
  public var feature: String?
  public var operation: String?
  /// The input field, never a resource URL path.
  public var path: String?
  public var layerId: String?
  public var referenceLayerId: String?
  public var slot: String?
  public var referenceSlot: String?
  public var rule: String?
  public var corrections: [TileflowErrorCorrection]

  public init(
    reason: String? = nil, resource: TileflowResourceKind? = nil, origin: String? = nil,
    status: Int? = nil, limit: Int? = nil, count: Int? = nil, message: String? = nil,
    feature: String? = nil, operation: String? = nil, path: String? = nil,
    layerId: String? = nil, referenceLayerId: String? = nil, slot: String? = nil,
    referenceSlot: String? = nil, rule: String? = nil, corrections: [TileflowErrorCorrection] = []
  ) {
    self.reason = reason
    self.resource = resource
    self.origin = origin
    self.status = status
    self.limit = limit
    self.count = count
    self.message = message
    self.feature = feature
    self.operation = operation
    self.path = path
    self.layerId = layerId
    self.referenceLayerId = referenceLayerId
    self.slot = slot
    self.referenceSlot = referenceSlot
    self.rule = rule
    self.corrections = corrections
  }

  public var description: String {
    var parts: [String] = []
    if let reason { parts.append("reason: \(reason)") }
    if let feature { parts.append("feature: \(feature)") }
    if let operation { parts.append("operation: \(operation)") }
    if let path { parts.append("path: \(path)") }
    if let layerId { parts.append("layer: \(layerId)") }
    if let referenceLayerId { parts.append("reference: \(referenceLayerId)") }
    if let rule { parts.append("rule: \(rule)") }
    if let resource { parts.append("resource: \(resource.rawValue)") }
    if let origin { parts.append("origin: \(origin)") }
    if let status { parts.append("status: \(status)") }
    if let limit { parts.append("limit: \(limit)") }
    if let count { parts.append("count: \(count)") }
    if let message { parts.append(message) }
    return parts.joined(separator: ", ")
  }
}

/// An actionable correction with a stable code and developer-facing explanation.
public struct TileflowErrorCorrection: Hashable, Sendable {
  public let code: String
  public let message: String

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }
}

extension TileflowMapError {
  static func missingLayerReference(
    operation: String, layerId: String, reference: String, slot: TileflowLayerSlot?, above: Bool
  ) -> Self {
    .init(.invalidRequest, context: .init(
      reason: MapContract.ErrorReason.unknownLayer.rawValue,
      operation: operation, path: above ? "position.aboveLayerId" : "position.belowLayerId",
      layerId: layerId, referenceLayerId: reference, slot: slot?.rawValue, rule: "knownReference",
      corrections: [.init(code: "referenceExistingLayer", message: "Reference an existing application layer.")]))
  }

  static func invalidSlotIndex(
    operation: String, layerId: String, slot: TileflowLayerSlot?, index: Int?, count: Int
  ) -> Self {
    .init(.invalidRequest, context: .init(
      reason: MapContract.ErrorReason.invalidLayerPosition.rawValue, limit: count, count: index,
      operation: operation, path: "position.slotIndex", layerId: layerId, slot: slot?.rawValue,
      rule: "indexRange", corrections: [.init(code: "chooseSlotIndex",
        message: "Choose a slotIndex from zero through the destination slot's application layer count, excluding the moved layer.")]))
  }

  static func layerPositionConflict(
    operation: String, layerId: String, referenceLayerId: String,
    slot: TileflowLayerSlot?, referenceSlot: TileflowLayerSlot?, above: Bool
  ) -> Self {
    .init(.invalidRequest, context: .init(
      reason: MapContract.ErrorReason.layerPositionConflict.rawValue, operation: operation,
      path: above ? "position.aboveLayerId" : "position.belowLayerId",
      layerId: layerId, referenceLayerId: referenceLayerId,
      slot: slot?.rawValue, referenceSlot: referenceSlot?.rawValue, rule: "sameSlot",
      corrections: [
        .init(code: "alignSlot", message: "Set the layer slot explicitly to match the referenced layer."),
        .init(code: "referenceSameSlot", message: "Reference a layer in the same slot."),
      ]))
  }

  init(_ code: Code, reason: MapContract.ErrorReason, limit: Int? = nil) {
    self.init(code, context: .init(reason: reason.rawValue, limit: limit))
  }

  /// An error the renderer sent. A code the renderer may not send is itself a renderer fault.
  init(wire value: JSONValue?) {
    guard let raw = value?["code"]?.string, MapContract.rendererErrors.contains(raw),
      let code = Code(rawValue: raw)
    else {
      self.init(.rendererFailed)
      return
    }
    let context = value?["context"]
    let status = context?["status"]?.number.flatMap { Int(exactly: $0) }
    let limit = context?["limit"]?.number.flatMap { Int(exactly: $0) }
    self.init(
      code,
      context: .init(
        reason: context?["reason"]?.string,
        resource: context?["resource"]?.string.flatMap(TileflowResourceKind.init(rawValue:)),
        origin: context?["origin"]?.string, status: status, limit: limit,
        message: value?["message"]?.string.map { String($0.prefix(512)) },
        feature: context?["feature"]?.string.map { String($0.prefix(64)) },
        operation: context?["operation"]?.string, path: context?["path"]?.string,
        layerId: context?["layerId"]?.string, referenceLayerId: context?["referenceLayerId"]?.string,
        slot: context?["slot"]?.string, referenceSlot: context?["referenceSlot"]?.string,
        rule: context?["rule"]?.string, corrections: (context?["corrections"]?.array ?? []).compactMap {
          guard let code = $0["code"]?.string, let message = $0["message"]?.string else { return nil }
          return .init(code: code, message: message)
        }))
  }
}
