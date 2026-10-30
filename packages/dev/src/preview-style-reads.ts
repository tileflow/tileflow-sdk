type PreviewStyleLayer = {
  id: string;
  type: string;
  metadata?: unknown;
  sourceLayer?: string;
  minzoom?: number;
  maxzoom?: number;
};

/** Serialized into the preview page; keep dependencies in the arguments. */
export function createPreviewStyleReads(map: {
  style?: unknown;
  getStyle(): {metadata?: Record<string, unknown>} | undefined;
  getLayersOrder(): string[];
  getLayer(id: string): PreviewStyleLayer | undefined;
  on(event: 'style.load', listener: () => void): unknown;
}) {
  // getStyle serializes every layer. A style's metadata changes only when a style loads: a new
  // style object, or a diff applied to the current one, which fires 'style.load'.
  let snapshot: {style: unknown; metadata: Record<string, unknown> | undefined} | undefined;
  map.on('style.load', () => {
    snapshot = undefined;
  });
  return {
    metadata() {
      if (!snapshot || snapshot.style !== map.style) {
        const style = map.getStyle();
        // A style that has not loaded yet has nothing to keep.
        if (!style) return undefined;
        snapshot = {style: map.style, metadata: style.metadata};
      }
      return snapshot.metadata;
    },
    // Layers change between style loads, so they are read live, in the shape of the style's own
    // layers. Custom layers have no style definition; getStyle leaves them out too.
    layers() {
      const layers = [];
      for (const id of map.getLayersOrder()) {
        const layer = map.getLayer(id);
        if (!layer || layer.type === 'custom') continue;
        layers.push({
          id: layer.id,
          type: layer.type,
          metadata: layer.metadata,
          'source-layer': layer.sourceLayer,
          minzoom: layer.minzoom,
          maxzoom: layer.maxzoom,
        });
      }
      return layers;
    },
  };
}
