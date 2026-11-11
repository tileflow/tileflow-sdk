import {tileflowNativeBuildingsLayerId} from './building-layer-ids';
import {tileflowNativeBuildingsFilter, type TileflowStandInArea} from './building-stand-ins';

type NativeLayerMap = {
  getLayer(id: string): unknown;
  getLayoutProperty?(id: string, property: string): unknown;
  setLayoutProperty?(id: string, property: string, value: unknown): unknown;
  getFilter?(id: string): unknown;
  setFilter?(id: string, filter: unknown): unknown;
  isSourceLoaded?(id: string): boolean;
  on?(event: 'render', listener: () => void): unknown;
  off?(event: 'render', listener: () => void): unknown;
  triggerRepaint?(): unknown;
};

// A layer whose tiles have not been read again with its new filter shows after this long anyway,
// in ms, should its source never report them read.
const reparseWait = 3_000;

/**
 * Show the compiled extrusion until the custom scene can draw, then restore its authored state.
 * While shown it leaves out the buildings that placed models and landmarks stand in for. Tiles the
 * map read before the filter changed still hold those buildings, so after a change the layer stays
 * hidden until its source has read them again.
 */
export function createBuildingNativeLayers(map: NativeLayerMap) {
  let saved: {layer: unknown; visibility: unknown; filter: unknown} | undefined;
  // The stand-in area wanted, and the one the layer's filter leaves out now.
  let area: TileflowStandInArea | undefined;
  let applied: TileflowStandInArea | undefined;
  // Whether the caller wants the layer shown, and the source being read again before it can be.
  let wanted = false;
  let reparse: {source: string; armed: boolean; timer: ReturnType<typeof setTimeout>} | undefined;
  let updating = false;

  function write(visibility: 'visible' | 'none'): void {
    if (map.getLayoutProperty?.(tileflowNativeBuildingsLayerId, 'visibility') !== visibility)
      map.setLayoutProperty?.(tileflowNativeBuildingsLayerId, 'visibility', visibility);
  }

  function stopReparse(): void {
    if (!reparse) return;
    clearTimeout(reparse.timer);
    map.off?.('render', onRender);
    reparse = undefined;
  }

  function finishReparse(): void {
    stopReparse();
    if (
      updating ||
      !saved ||
      !wanted ||
      map.getLayer(tileflowNativeBuildingsLayerId) !== saved.layer
    )
      return;
    updating = true;
    try {
      write('visible');
    } finally {
      updating = false;
    }
  }

  // The source starts reading its tiles again in the frame after the filter changes: the first
  // frame arms the wait, and a later one with every tile read ends it.
  function onRender(): void {
    if (!reparse) return;
    if (!reparse.armed) {
      reparse.armed = true;
      map.triggerRepaint?.();
      return;
    }
    let loaded = true;
    try {
      loaded = map.isSourceLoaded?.(reparse.source) ?? true;
    } catch {
      // A source that is gone has nothing left to read.
    }
    if (loaded) finishReparse();
  }

  /** Waits for the layer's source to read its tiles again; false when the map cannot tell. */
  function startReparse(): boolean {
    const source = (map.getLayer(tileflowNativeBuildingsLayerId) as {source?: unknown} | undefined)
      ?.source;
    if (typeof source !== 'string' || !map.on || !map.off || !map.isSourceLoaded) return false;
    if (reparse) {
      reparse.armed = false;
      return true;
    }
    reparse = {source, armed: false, timer: setTimeout(finishReparse, reparseWait)};
    map.on('render', onRender);
    return true;
  }

  /** Leaves out the wanted area; true when the filter changed. */
  function applyArea(): boolean {
    if (!saved || applied === area || !map.setFilter) return false;
    map.setFilter(
      tileflowNativeBuildingsLayerId,
      tileflowNativeBuildingsFilter(saved.filter, area),
    );
    applied = area;
    return true;
  }

  /**
   * Shows the layer with the wanted area left out. A layer about to show waits for its tiles to be
   * read with a new filter, as tiles read before may hold what it now leaves out; one already
   * drawing keeps its tiles until the map swaps in the ones read again, rather than blinking.
   */
  function show(): void {
    const drawing =
      !reparse &&
      map.getLayoutProperty?.(tileflowNativeBuildingsLayerId, 'visibility') === 'visible';
    if (applyArea() && !drawing && startReparse()) write('none');
    else write(reparse ? 'none' : 'visible');
  }

  function restore(): void {
    if (updating || !saved || !map.getLayoutProperty || !map.setLayoutProperty) return;
    updating = true;
    try {
      stopReparse();
      if (map.getLayer(tileflowNativeBuildingsLayerId) === saved.layer) {
        if (applied && map.setFilter) map.setFilter(tileflowNativeBuildingsLayerId, saved.filter);
        if (
          map.getLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility') !== saved.visibility
        )
          map.setLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility', saved.visibility);
      }
      saved = undefined;
      applied = undefined;
      wanted = false;
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
        stopReparse();
        saved = undefined;
        applied = undefined;
        return;
      }
      updating = true;
      try {
        if (!saved || saved.layer !== layer) {
          stopReparse();
          saved = {
            layer,
            visibility:
              map.getLayoutProperty(tileflowNativeBuildingsLayerId, 'visibility') ?? 'visible',
            filter: map.getFilter?.(tileflowNativeBuildingsLayerId),
          };
          applied = undefined;
        }
        wanted = visible;
        // A hidden layer keeps its filter until it shows again.
        if (visible) show();
        else write('none');
      } finally {
        updating = false;
      }
    },
    /** The ground whose buildings are left to placed models and landmarks, if any. */
    setStandIns(next: TileflowStandInArea | undefined): void {
      area = next;
      if (updating || !saved || !wanted) return;
      if (map.getLayer(tileflowNativeBuildingsLayerId) !== saved.layer) return;
      updating = true;
      try {
        show();
      } finally {
        updating = false;
      }
    },
    restore,
    /** Removing a map must not write to its destroyed style. */
    forget() {
      stopReparse();
      saved = undefined;
      applied = undefined;
      wanted = false;
    },
  };
}
