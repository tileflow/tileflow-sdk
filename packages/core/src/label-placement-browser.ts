import {isGroundRoadLabel} from './cartography/label-placement';

type Layer = {id: string; type?: string; renderingMode?: string; metadata?: unknown};

/** Public renderer capabilities needed to place ground road names around the 3D scene. */
export type TileflowLabelPlacementMap = {
  getLayer(id: string): unknown;
  getLayersOrder?(): string[];
  getPitch(): number;
  getStyle(): {layers: Layer[]; metadata?: unknown} | undefined;
  moveLayer?(id: string, beforeId?: string): unknown;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};

/**
 * Keep ground road names readable around solid buildings and vegetation. MapLibre owns
 * distance selection, collisions and fading; this controller never changes feature filters.
 * Explicit render-stack placement opts a road out of this automatic scene ordering.
 */
export function attachTileflowLabelPlacement(map: TileflowLabelPlacementMap): () => void {
  let disposed = false;
  let targets: string[] = [];
  let ordering = false;
  let flatOrder = map.getPitch() < 30;

  function orderRoads(restore = false) {
    if (ordering || !map.moveLayer || !targets.length) return;
    const style = map.getStyle();
    // getStyle omits custom layers. Use the renderer's public order so buildings and
    // trees mounted at runtime participate, including their implementation wrapper.
    const layers = (map.getLayersOrder?.() ?? style?.layers?.map((layer) => layer.id) ?? []).map(
      (id) => {
        const layer = map.getLayer(id) as (Layer & {implementation?: Layer}) | undefined;
        return {
          id,
          type: layer?.type,
          renderingMode: layer?.implementation?.renderingMode ?? layer?.renderingMode,
          vegetation:
            (
              (layer?.implementation?.metadata ?? layer?.metadata) as
                Record<string, unknown> | undefined
            )?.['tileflow:scene-kind'] === 'vegetation',
        };
      },
    );
    const roads = new Set(targets);
    const anchors = (style?.metadata as Record<string, unknown> | undefined)?.[
      'tileflow:overlay-placement-manifest'
    ] as {anchors?: Record<string, unknown>} | undefined;
    const ceiling = layers.findIndex((layer) => layer.id === anchors?.anchors?.['above-buildings']);
    // Limit the scene to the buildings/vegetation boundary. Application 3D overlays above
    // foreground labels must not pull road names above POIs or navigation shields.
    const scene = layers.filter(
      (layer, index) =>
        (ceiling < 0 || index < ceiling) &&
        (layer.type === 'fill-extrusion' ||
          (layer.type === 'custom' && layer.renderingMode === '3d')),
    );
    if (!scene.length) return;
    const solidScene = scene.filter((layer) => !layer.vegetation);
    const flat = !restore && map.getPitch() < 30;
    // Foliage must not slice individual glyphs. Solid geometry still occludes ground
    // labels in perspective; the tree renderer mounts before that boundary.
    const boundary =
      flat || (!restore && !solidScene.length)
        ? layers.slice(layers.indexOf(scene.at(-1)!) + 1).find((layer) => !roads.has(layer.id))?.id
        : (restore ? scene[0]! : solidScene[0]!).id;
    const order = layers.map((layer) => layer.id);
    const names = order.filter((id) => roads.has(id));
    // Own only the relative order against geometry, not adjacency to the boundary.
    // Other controllers may insert effects such as haze between names and buildings.
    const above =
      flat || (!restore && !solidScene.length)
        ? scene.at(-1)
        : !restore
          ? scene
              .filter(
                (layer) =>
                  layer.vegetation && layers.indexOf(layer) < layers.indexOf(solidScene[0]!),
              )
              .at(-1)
          : undefined;
    const below = flat || (!restore && !solidScene.length) ? undefined : boundary;
    if (
      names.every(
        (id) =>
          (!above || order.indexOf(id) > order.indexOf(above.id)) &&
          (!below || order.indexOf(id) < order.indexOf(below)),
      )
    )
      return;
    ordering = true;
    try {
      for (const id of names) map.moveLayer(id, boundary);
    } finally {
      ordering = false;
    }
  }
  function syncStyle() {
    if (disposed || ordering) return;
    targets = (map.getStyle()?.layers ?? []).filter(isGroundRoadLabel).map(({id}) => id);
    flatOrder = map.getPitch() < 30;
    orderRoads();
  }

  function pitch() {
    if (disposed) return;
    const flat = map.getPitch() < 30;
    if (flat === flatOrder) return;
    flatOrder = flat;
    orderRoads();
  }

  function release(restore: boolean) {
    if (disposed) return;
    disposed = true;
    map.off('pitch', pitch);
    map.off('moveend', pitch);
    map.off('style.load', syncStyle);
    map.off('styledata', syncStyle);
    map.off('remove', removed);
    if (restore) orderRoads(true);
    targets = [];
  }
  const removed = () => release(false);
  map.on('pitch', pitch);
  map.on('moveend', pitch);
  map.on('style.load', syncStyle);
  map.on('styledata', syncStyle);
  map.on('remove', removed);
  syncStyle();
  return () => release(true);
}
