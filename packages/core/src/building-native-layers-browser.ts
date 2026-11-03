import {tileflowNativeBuildingsLayerId} from './building-layer-ids';

type NativeLayerMap = {
  getLayer(id: string): unknown;
  getLayoutProperty?(id: string, property: string): unknown;
  setLayoutProperty?(id: string, property: string, value: unknown): unknown;
};

/** Show the compiled extrusion until the custom scene can draw, then restore its authored state. */
export function createBuildingNativeLayers(map: NativeLayerMap) {
  let saved: {layer: unknown; visibility: unknown} | undefined;
  let updating = false;

  function restore(): void {
    if (updating || !saved || !map.getLayoutProperty || !map.setLayoutProperty) return;
    updating = true;
    try {
      if (
        map.getLayer(tileflowNativeBuildingsLayerId) === saved.layer &&
        map.getLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility') !== saved.visibility
      )
        map.setLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility', saved.visibility);
      saved = undefined;
    } finally {
      updating = false;
    }
  }

  return {
    /** Undefined gives control back to the compiled style. */
    setVisible(visible: boolean | undefined): void {
      if (visible === undefined) return restore();
      if (updating || !map.getLayoutProperty || !map.setLayoutProperty) return;
      const layer = map.getLayer(tileflowNativeBuildingsLayerId);
      if (!layer) {
        saved = undefined;
        return;
      }
      updating = true;
      try {
        if (!saved || saved.layer !== layer)
          saved = {
            layer,
            visibility:
              map.getLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility') ?? 'visible',
          };
        const next = visible ? 'visible' : 'none';
        if (map.getLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility') !== next)
          map.setLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility', next);
      } finally {
        updating = false;
      }
    },
    restore,
    /** Removing a map must not write to its destroyed style. */
    forget() {
      saved = undefined;
    },
  };
}
