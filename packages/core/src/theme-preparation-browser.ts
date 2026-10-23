import {type TileflowThemeMotionMap, tileflowThemeMotionView} from './theme-motion-browser';
import type {MapLibreStyle} from './types';

const opacities: Readonly<Record<string, readonly string[]>> = {
  background: ['background-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  fill: ['fill-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
  heatmap: ['heatmap-opacity'],
  line: ['line-opacity'],
  raster: ['raster-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
};

/** Load new blend buckets while the previous geometry still draws with the live camera. */
export function prepareTileflowThemeGeometry(from: MapLibreStyle, to: MapLibreStyle) {
  const existing = new Set(from.layers.map((layer) => layer.id));
  const added = to.layers.filter((layer) => !existing.has(layer.id));
  if (!added.length || added.some((layer) => !opacities[String(layer.type)])) return undefined;
  const style: MapLibreStyle = {
    ...from,
    layers: [
      ...from.layers,
      ...added.map((layer) => ({
        ...layer,
        paint: {
          ...(layer.paint as Record<string, unknown> | undefined),
          ...Object.fromEntries(
            opacities[String(layer.type)]!.flatMap((property) => [
              [property, 0],
              [`${property}-transition`, {duration: 0, delay: 0}],
            ]),
          ),
        },
      })),
    ],
  };
  return {
    style,
    reveal(map: TileflowThemeMotionMap) {
      const set = map.setPaintProperty as (id: string, property: string, value: unknown) => void;
      // Reveal before applying the destination diff, while these properties still have zero
      // native transition duration. No frame can see both sets of geometry at once.
      for (const layer of added)
        for (const property of opacities[String(layer.type)]!)
          set.call(
            map,
            String(layer.id),
            property,
            (layer.paint as Record<string, unknown> | undefined)?.[property] ?? 1,
          );
    },
  };
}

/** `style.load` precedes worker layout; wait for ready frames without waiting for camera idle. */
export function waitForTileflowThemeGeometry(
  map: TileflowThemeMotionMap,
  timeoutMs: number,
  stop: () => boolean,
): Promise<boolean> {
  const view = tileflowThemeMotionView(map);
  if (!view || typeof map.isStyleLoaded !== 'function' || typeof map.areTilesLoaded !== 'function')
    return Promise.resolve(!stop());
  const loaded = map.isStyleLoaded as () => boolean;
  const tiles = map.areTilesLoaded as () => boolean;
  return new Promise((resolve, reject) => {
    const now = () => view.performance?.now?.() ?? Date.now();
    const started = now();
    let readyFrames = 0;
    const step = () => {
      if (stop()) return resolve(false);
      readyFrames = loaded.call(map) && tiles.call(map) ? readyFrames + 1 : 0;
      if (readyFrames >= 2) return resolve(true);
      if (now() - started >= timeoutMs)
        return reject(new Error('Tileflow theme geometry did not finish loading.'));
      if (view.requestAnimationFrame) view.requestAnimationFrame(step);
      else view.setTimeout(step, 16);
    };
    if (view.requestAnimationFrame) view.requestAnimationFrame(step);
    else view.setTimeout(step, 16);
  });
}
