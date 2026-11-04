import SwiftUI

/// One declaration in a SwiftUI map's content. Source, layer and annotation ids have separate namespaces.
public enum TileflowMapContentElement {
  case source(any TileflowSource)
  case layer(any TileflowLayer)
  case annotation(TileflowAnnotation)
  case location(TileflowLocationOptions)
}

/// Accepts the SDK's source, layer, annotation and location values, including Swift conditionals and loops.
@resultBuilder
public enum TileflowMapContentBuilder {
  public static func buildExpression(_ source: any TileflowSource) -> [TileflowMapContentElement] {
    [.source(source)]
  }
  public static func buildExpression(_ layer: any TileflowLayer) -> [TileflowMapContentElement] {
    [.layer(layer)]
  }
  public static func buildExpression(_ annotation: TileflowAnnotation)
    -> [TileflowMapContentElement]
  { [.annotation(annotation)] }
  public static func buildExpression(_ location: TileflowLocationOptions)
    -> [TileflowMapContentElement]
  { [.location(location)] }
  public static func buildBlock(_ parts: [TileflowMapContentElement]...)
    -> [TileflowMapContentElement]
  { parts.flatMap { $0 } }
  public static func buildOptional(_ part: [TileflowMapContentElement]?)
    -> [TileflowMapContentElement]
  { part ?? [] }
  public static func buildEither(first part: [TileflowMapContentElement])
    -> [TileflowMapContentElement]
  { part }
  public static func buildEither(second part: [TileflowMapContentElement])
    -> [TileflowMapContentElement]
  { part }
  public static func buildArray(_ parts: [[TileflowMapContentElement]])
    -> [TileflowMapContentElement]
  { parts.flatMap { $0 } }
}

@MainActor
struct DeclaredMapContent {
  var sources: [String: RuntimeStyle.Source] = [:]
  var sourceOrder: [String] = []
  private var geoJSON: [String: TileflowGeoJSONSource] = [:]
  var layers: [String: RuntimeStyle.Layer] = [:]
  var layerOrder: [String] = []
  var annotations: [TileflowAnnotation] = []
  var location: TileflowLocationOptions?

  var isEmpty: Bool { sources.isEmpty && layers.isEmpty && annotations.isEmpty && location == nil }

  func matches(_ other: Self) -> Bool {
    sourceOrder == other.sourceOrder && layerOrder == other.layerOrder
      && annotations == other.annotations
      && location == other.location
      && sourceOrder.allSatisfy { id in
        sources[id]?.spec == other.sources[id]?.spec
          && sources[id]?.geoJSON?.base == other.sources[id]?.geoJSON?.base
      }
      && layerOrder.allSatisfy { id in
        layers[id]?.json == other.layers[id]?.json && layers[id]?.slot == other.layers[id]?.slot
      }
  }

  init() {}

  init(_ elements: [TileflowMapContentElement], previous: Self) throws {
    var annotationIDs = Set<String>()
    for element in elements {
      switch element {
      case .source(let source):
        guard sources[source.id] == nil else { throw TileflowMapError.invalidRequest }
        try TileflowMapView.validateIdentifier(source.id)
        if let data = source as? TileflowGeoJSONSource, data == previous.geoJSON[source.id] {
          sources[source.id] = previous.sources[source.id]
        } else {
          let (spec, log) = try TileflowMapView.sourceWire(source)
          sources[source.id] = .init(id: source.id, spec: spec, geoJSON: log)
        }
        geoJSON[source.id] = source as? TileflowGeoJSONSource
        sourceOrder.append(source.id)
      case .layer(let layer):
        guard layers[layer.id] == nil else { throw TileflowMapError.invalidRequest }
        try TileflowMapView.validateIdentifier(layer.id)
        layers[layer.id] = try .init(id: layer.id, json: .encoded(layer), slot: layer.slot)
        layerOrder.append(layer.id)
      case .annotation(let marker):
        guard annotationIDs.insert(marker.id).inserted else {
          throw TileflowMapError.invalidRequest
        }
        _ = try marker.wireValue()
        annotations.append(marker)
      case .location(let options):
        guard location == nil else { throw TileflowMapError.invalidRequest }
        _ = try options.wireValue()
        location = options
      }
    }
  }
}

/// Coalesces SwiftUI renders while mutations are in flight. Only a confirmed revision becomes the next diff's base.
@MainActor
final class MapContentCoordinator {
  private struct Input {
    let elements: [TileflowMapContentElement]
    let base: TileflowMapOptions
  }

  /// A redraw after an error must not restart the same failed load. A different declaration,
  /// a change of imperative ownership, or a new renderer can retry it.
  @MainActor private struct Rejection {
    var input: Input
    var resolved: DeclaredMapContent?
    var owners: [Set<String>]
    var engine: ObjectIdentifier?

    init(_ input: Input, resolved: DeclaredMapContent?, view: TileflowMapView) {
      self.input = input
      self.resolved = resolved
      owners = [
        Set(view.runtimeStyle.sources.map(\.id)), Set(view.runtimeStyle.layers.map(\.id)),
        Set(view.content.annotations.map(\.id)),
      ]
      engine = view.engine.map(ObjectIdentifier.init)
    }

    func matches(_ other: Self) -> Bool {
      guard owners == other.owners, engine == other.engine, input.base == other.input.base else {
        return false
      }
      if let resolved, let next = other.resolved { return resolved.matches(next) }
      guard resolved == nil, other.resolved == nil else { return false }
      return input.elements.map(Self.key) == other.input.elements.map(Self.key)
    }

    private static func key(_ element: TileflowMapContentElement) -> String {
      switch element {
      case .source(let value): "source/" + value.id
      case .layer(let value): "layer/" + value.id
      case .annotation(let value): "marker/" + value.id
      case .location: "location"
      }
    }
  }

  private var applied = DeclaredMapContent()
  private var priorOptions: TileflowMapOptions?
  private var pending: Input?
  private var rejected: Rejection?
  private var work: Task<Void, Never>?

  func start(with options: TileflowMapOptions) { priorOptions = options }

  func update(
    _ elements: [TileflowMapContentElement], options: TileflowMapOptions, on view: TileflowMapView
  ) {
    pending = Input(elements: elements, base: options)
    drain(on: view)
  }

  func rendererReady(on view: TileflowMapView) async {
    if pending == nil, let rejected, rejected.engine != view.engine.map(ObjectIdentifier.init) {
      pending = rejected.input
    }
    drain(on: view)
    await work?.value
  }

  private func drain(on view: TileflowMapView) {
    guard pending != nil, work == nil else { return }
    work = Task { @MainActor [weak view] in
      defer { self.work = nil }
      while let input = self.pending, let view, !view.isDestroyed, !Task.isCancelled {
        // A resource-backed declaration is confirmed by the renderer that will draw it.
        guard view.styleEngine != nil || (input.elements.isEmpty && self.applied.isEmpty) else {
          return
        }
        self.pending = nil
        let attemptedEngine = view.styleEngine
        var resolved: DeclaredMapContent?
        do {
          let next = try DeclaredMapContent(input.elements, previous: self.applied)
          resolved = next
          if let rejected = self.rejected,
            rejected.matches(.init(input, resolved: next, view: view))
          {
            continue
          }
          var options: TileflowMapOptions?
          if input.base != self.priorOptions {
            var changed = input.base
            changed.location = next.location ?? input.base.location
            options = changed
          } else if next.location != self.applied.location {
            var changed = view.options
            changed.location = next.location ?? input.base.location
            options = changed
          }
          try await view.applyDeclaredContent(next, replacing: self.applied, options: options)
          self.applied = next
          self.priorOptions = input.base
          self.rejected = nil
        } catch {
          guard !Task.isCancelled, !view.isDestroyed else { return }
          if error as? TileflowMapError == .cancelled {
            if self.pending == nil {
              self.pending = input
              if view.styleEngine == nil || view.styleEngine === attemptedEngine { return }
            }
            continue
          }
          let refused = Rejection(input, resolved: resolved, view: view)
          if self.rejected?.matches(refused) != true { view.report(propertyError: error) }
          self.rejected = refused
        }
      }
    }
  }

  func stop() {
    pending = nil
    work?.cancel()
  }
}
