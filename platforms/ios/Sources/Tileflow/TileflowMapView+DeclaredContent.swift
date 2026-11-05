import Foundation

extension TileflowMapView {
  /// Holds the same editing turn as the imperative style API and renderer replay. Inverses undo
  /// only successful edits; a rejected update cannot take an unrelated controller edit with it.
  func applyDeclaredContent(
    _ next: DeclaredMapContent, replacing prior: DeclaredMapContent,
    options: TileflowMapOptions?
  ) async throws {
    guard
      !next.sourceOrder.isEmpty || !prior.sourceOrder.isEmpty || !next.layerOrder.isEmpty
        || !prior.layerOrder.isEmpty || next.annotations != prior.annotations || options != nil
    else { return }
    try await styleEdits.acquire()
    defer { styleEdits.release() }
    guard !isDestroyed else { throw TileflowMapError.disposed }
    let needsRenderer = !next.isEmpty || !prior.isEmpty
    guard !needsRenderer || styleEngine != nil else { throw TileflowMapError.cancelled }
    try options?.validate()
    let before = runtimeStyle
    let beforeMarkers = content.annotations
    let originalOptions = self.options
    let originalEngine = engine
    let dropped = Set(
      prior.sourceOrder.filter { next.sources[$0]?.spec != prior.sources[$0]?.spec })

    try validateContentOwnership(next, prior: prior, dropping: dropped, in: before)
    var undo: [UndoContentEdit] = []

    do {
      try await removeRetiredContent(
        next, prior: prior, dropping: dropped, from: before, undo: &undo)
      try await reconcileContentSources(next, prior: prior, before: before, undo: &undo)
      try await reconcileContentLayers(next, prior: prior, undo: &undo)
      try await reconcileContentOrder(next, undo: &undo)

      if next.annotations != prior.annotations {
        let previousIDs = Set(prior.annotations.map(\.id))
        let markers = content.annotations.filter { !previousIDs.contains($0.id) } + next.annotations
        try await replaceDeclaredAnnotations(markers)
        undo.append { try await self.replaceDeclaredAnnotations(beforeMarkers) }
      }
      guard !needsRenderer || originalEngine === styleEngine else {
        throw TileflowMapError.cancelled
      }
      if let options {
        // setOptions records its value before contacting the renderer.
        undo.append { try await self.setOptions(originalOptions) }
        try await setOptions(options)
      }
    } catch {
      var recovered = true
      if originalEngine === engine {
        // Recovery must finish even when the task carrying the failed edit was cancelled.
        let inverses = undo
        recovered = await Task { @MainActor in
          do {
            for inverse in inverses.reversed() { try await inverse() }
            return true
          } catch { return false }
        }.value
      }
      runtimeStyle = before
      content.annotations = beforeMarkers
      if !recovered, !isDestroyed, originalEngine === engine { try? reload() }
      throw error
    }
  }

  private func replaceDeclaredAnnotations(_ markers: [TileflowAnnotation]) async throws {
    let previous = content.annotations
    try MapContent(annotations: markers, overlays: content.overlays).validate()
    content.annotations = markers
    do {
      if let engine = styleEngine { try await engine.setAnnotations(markers) }
    } catch {
      content.annotations = previous
      throw error
    }
  }

  private typealias UndoContentEdit = @MainActor () async throws -> Void

  private func validateContentOwnership(
    _ next: DeclaredMapContent, prior: DeclaredMapContent, dropping dropped: Set<String>,
    in before: RuntimeStyle
  ) throws {
    let currentSources = Set(before.sources.map(\.id))
    let currentLayers = Set(before.layers.map(\.id))
    let availableSources = currentSources.subtracting(dropped).union(next.sourceOrder)
    let externalMarkers = Set(content.annotations.map(\.id)).subtracting(
      prior.annotations.map(\.id))
    guard Set(next.sourceOrder).subtracting(prior.sourceOrder).isDisjoint(with: currentSources),
      Set(next.layerOrder).subtracting(prior.layerOrder).isDisjoint(with: currentLayers),
      externalMarkers.isDisjoint(with: next.annotations.map(\.id)),
      !before.layers.contains(where: { layer in
        prior.layers[layer.id] == nil && layer.json["source"]?.string.map(dropped.contains) == true
      })
    else { throw TileflowMapError.invalidRequest }
    for layer in next.layers.values {
      if let source = layer.json["source"]?.string, !availableSources.contains(source) {
        throw TileflowMapError(.invalidRequest, reason: .unknownSource)
      }
    }
  }

  private func restorePosition(of id: String, in layers: [RuntimeStyle.Layer])
    -> TileflowLayerPosition
  {
    guard let i = layers.firstIndex(where: { $0.id == id }) else { return .default }
    let slot = layers[i].slot
    if let anchor = layers.dropFirst(i + 1).first(where: {
      $0.slot == slot && self.layerExists($0.id)
    }) {
      return .below(anchor.id)
    }
    return .default
  }

  private func removeRetiredContent(
    _ next: DeclaredMapContent, prior: DeclaredMapContent, dropping dropped: Set<String>,
    from before: RuntimeStyle, undo: inout [UndoContentEdit]
  ) async throws {
    // Take dependants out before replacing a source. Controller-owned dependants were checked above.
    for layer in before.layers.reversed()
    where prior.layers[layer.id] != nil
      && (next.layers[layer.id] == nil
        || layer.json["source"]?.string.map(dropped.contains) == true)
    {
      try await deleteStyleLayer(layer.id)
      undo.append {
        try await self.insertStyleLayer(
          layer, position: self.restorePosition(of: layer.id, in: before.layers))
      }
    }
    for source in before.sources where dropped.contains(source.id) {
      try await deleteStyleSource(source.id)
      undo.append { try await self.restoreDeclaredSource(source, states: before.states) }
    }
  }

  private func reconcileContentSources(
    _ next: DeclaredMapContent, prior: DeclaredMapContent, before: RuntimeStyle,
    undo: inout [UndoContentEdit]
  ) async throws {
    for id in next.sourceOrder {
      guard let source = next.sources[id] else { continue }
      if !sourceExists(id) {
        try await insertStyleSource(source)
        undo.append { try await self.deleteStyleSource(id) }
      } else if let base = source.geoJSON?.base, base != prior.sources[id]?.geoJSON?.base,
        let original = before.sources.first(where: { $0.id == id })?.geoJSON
      {
        try await replaceStyleData(id, base: base)
        undo.append {
          try await self.replaceStyleData(id, base: original.base)
          if let engine = self.styleEngine {
            for update in original.updates {
              try await self.sendUpdate(update, source: id, through: engine)
            }
          }
        }
      }
    }
  }

  private func reconcileContentLayers(
    _ next: DeclaredMapContent, prior: DeclaredMapContent, undo: inout [UndoContentEdit]
  ) async throws {
    for (i, id) in next.layerOrder.enumerated() {
      guard let layer = next.layers[id] else { continue }
      if !layerExists(id) {
        let anchor = next.layerOrder.dropFirst(i + 1).first {
          next.layers[$0]?.slot == layer.slot && self.layerExists($0)
        }
        try await insertStyleLayer(
          layer, position: anchor.map(TileflowLayerPosition.below) ?? .default)
        undo.append { try await self.deleteStyleLayer(id) }
      } else if let old = prior.layers[id], layer.json != old.json || layer.slot != old.slot {
        try await replaceStyleLayer(layer)
        undo.append { try await self.replaceStyleLayer(old) }
      }
    }
  }

  private func reconcileContentOrder(_ next: DeclaredMapContent, undo: inout [UndoContentEdit])
    async throws
  {
    // Slots determine placement among the basemap's layers. Within each one, move only the
    // ids outside the longest common subsequence. Interleaved imperative layers stay in place.
    for slot in Set(next.layers.values.map(\.slot)) {
      let wanted = next.layerOrder.filter { next.layers[$0]?.slot == slot }
      let current = runtimeStyle.layers.filter { next.layers[$0.id] != nil && $0.slot == slot }
        .map(\.id)
      guard current != wanted else { continue }
      let moved = Set(
        wanted.difference(from: current).insertions.map { change -> String in
          switch change {
          case .insert(_, let id, _), .remove(_, let id, _): return id
          }
        })
      for i in wanted.indices.reversed() where moved.contains(wanted[i]) {
        let id = wanted[i]
        let previousOrder = runtimeStyle.layers
        let position: TileflowLayerPosition =
          i + 1 < wanted.count ? .below(wanted[i + 1]) : .default
        try await positionStyleLayer(id, position: position)
        undo.append {
          try await self.positionStyleLayer(
            id, position: self.restorePosition(of: id, in: previousOrder))
        }
      }
    }
  }

  private func restoreDeclaredSource(
    _ source: RuntimeStyle.Source, states: [String: [String: [String: TileflowStyleValue]]]
  ) async throws {
    try await insertStyleSource(source)
    guard let engine = styleEngine else { return }
    for update in source.geoJSON?.updates ?? [] {
      try await sendUpdate(update, source: source.id, through: engine)
    }
    for (key, features) in states where key.hasPrefix(source.id + "\n") {
      let suffix = String(key.dropFirst(source.id.count + 1))
      for (feature, state) in features where !state.isEmpty {
        var payload = Self.featureTarget(source.id, suffix.isEmpty ? nil : suffix, feature)
        payload["state"] = .object(state.mapValues(\.wireValue))
        _ = try await engine.call(.setFeatureState, payload: .object(payload))
      }
    }
  }
}
