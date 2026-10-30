type FlatLayer = Readonly<{id: string; visible: boolean}>;
type FlatLayerMap = {
  getLayer(id: string): unknown;
  getLayoutProperty?(id: string, property: string): unknown;
  setLayoutProperty?(id: string, property: string, value: unknown): unknown;
  getLayersOrder?(): string[];
  getStyle(): unknown;
};

/** Suspend duplicate flat fills in 3D, preserving each layer's authored 2D visibility. */
export function createBuildingFlatLayers(map: FlatLayerMap) {
  const saved = new Map<string, {visibility: unknown; layer: unknown}>();
  let updating = false;
  function restore() {
    if (!map.setLayoutProperty || !map.getLayoutProperty || updating) return;
    updating = true;
    try {
      for (const [id, {visibility, layer}] of saved)
        if (map.getLayer(id) === layer && map.getLayoutProperty(id, 'visibility') !== visibility)
          map.setLayoutProperty(id, 'visibility', visibility);
      saved.clear();
    } finally {
      updating = false;
    }
  }
  return {
    update(layers: readonly FlatLayer[], hidden: boolean) {
      if (updating || !map.setLayoutProperty || !map.getLayoutProperty) return;
      if (!hidden || layers.length === 0) {
        restore();
        return;
      }
      updating = true;
      try {
        const authored = new Map(layers.map((layer) => [layer.id, layer.visible]));
        const ids =
          map.getLayersOrder?.() ??
          ((map.getStyle() as {layers?: {id: string}[]})?.layers ?? []).map(({id}) => id);
        for (const id of ids) {
          const visible = authored.get(id.split('::')[0]!);
          if (visible === undefined || !map.getLayer(id)) continue;
          const current = map.getLayoutProperty(id, 'visibility') ?? 'visible';
          if (!saved.has(id) || saved.get(id)!.layer !== map.getLayer(id))
            saved.set(id, {visibility: visible ? current : 'none', layer: map.getLayer(id)});
          if (current !== 'none') map.setLayoutProperty(id, 'visibility', 'none');
        }
      } finally {
        updating = false;
      }
    },
    restore,
    /** Removing a map must not write to its destroyed style. */
    forget() {
      saved.clear();
    },
  };
}
