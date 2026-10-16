import {readTileflowVegetation3D} from './trees-3d';
import {
  createTileflowTrees3D,
  type TileflowTrees3D,
  type TileflowTrees3DOptions,
} from './trees-3d-browser';
import {
  readTileflowVegetationDisplay,
  resolveTileflowVegetationRepresentation,
  type TileflowVegetationDisplay,
  type TileflowVegetationRepresentation,
  type TileflowViewMode,
} from './vegetation-display';

export type TileflowVegetationOptions = Omit<TileflowTrees3DOptions, 'manageFlatLayers' | 'map'> & {
  map: TileflowTrees3DOptions['map'] & {getCanvas?(): HTMLCanvasElement};
  /** Overrides the map's visibility. Undefined restores the authored default. */
  visible?: boolean | undefined;
  /** Explicit application view mode, independent of pitch and building visibility. Defaults to 2d. */
  viewMode?: TileflowViewMode;
};

export type TileflowVegetationController = {
  inspectModels: TileflowTrees3D['inspectModels'];
  setVisible(visible: boolean | undefined): void;
  setViewMode(mode: TileflowViewMode): void;
  /** Reapplies the policy after application layer controls change. */
  refresh(): void;
  readonly representation: TileflowVegetationRepresentation;
  readonly stats: TileflowTrees3D['stats'] | undefined;
  dispose(): void;
};

/** Mount once per map. OFF hides every representation; mode selects how enabled trees are drawn. */
export function createTileflowVegetation(
  options: TileflowVegetationOptions,
): TileflowVegetationController {
  const {map} = options;
  let visible = options.visible;
  let viewMode = options.viewMode ?? '2d';
  let trees: TileflowTrees3D | undefined;
  let representation: TileflowVegetationRepresentation = 'none';
  let disposed = false;
  let refreshing = false;
  const instant = {transition: {duration: 0}};

  function flatVisibility(policy: TileflowVegetationDisplay | undefined, shown: boolean): void {
    if (!map.setLayoutProperty || !map.getLayoutProperty || !policy) return;
    const authored = new Map(policy.flatLayers.map((layer) => [layer.id, layer.visible]));
    const layers = (map.getStyle() as {layers?: {id: string}[]} | undefined)?.layers ?? [];
    for (const {id} of layers) {
      const layerVisible = authored.get(id.split('::')[0]!);
      if (layerVisible === undefined) continue;
      const value = shown && layerVisible ? 'visible' : 'none';
      if (map.getLayoutProperty(id, 'visibility') !== value)
        map.setLayoutProperty(id, 'visibility', value);
    }
  }

  function refresh(): void {
    if (disposed || refreshing || !map.isStyleLoaded()) return;
    refreshing = true;
    try {
      const metadata = (map.getStyle() as {metadata?: unknown} | undefined)?.metadata;
      const policy = readTileflowVegetationDisplay(metadata);
      // Use the existing MapLibre context; never allocate another canvas or renderer.
      const supports3D = Boolean(
        readTileflowVegetation3D(metadata) && map.getCanvas?.().getContext('webgl2'),
      );
      const next = resolveTileflowVegetationRepresentation(policy, {visible, viewMode, supports3D});
      flatVisibility(policy, next === 'flat');
      if (next === '3d') {
        trees ??= createTileflowTrees3D({...options, manageFlatLayers: false});
        if (representation !== '3d') void trees.show(instant);
      } else if (trees) {
        // Release readers, listeners and GPU resources while off/flat.
        trees.dispose();
        trees = undefined;
      }
      representation = next;
    } finally {
      refreshing = false;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    map.off('styledata', refresh);
    map.off('idle', refresh);
    map.off('remove', dispose);
    trees?.dispose();
    trees = undefined;
    representation = 'none';
    const policy = readTileflowVegetationDisplay(
      (map.getStyle() as {metadata?: unknown} | undefined)?.metadata,
    );
    flatVisibility(
      policy,
      resolveTileflowVegetationRepresentation(policy, {supports3D: false}) === 'flat',
    );
  }

  map.on('styledata', refresh);
  map.on('idle', refresh);
  map.on('remove', dispose);
  refresh();
  return {
    inspectModels: () => trees?.inspectModels() ?? [],
    setVisible(value) {
      if (visible !== value) {
        visible = value;
        refresh();
      }
    },
    setViewMode(value) {
      if (viewMode !== value) {
        viewMode = value;
        refresh();
      }
    },
    refresh,
    get representation() {
      return representation;
    },
    get stats() {
      return trees?.stats;
    },
    dispose,
  };
}
