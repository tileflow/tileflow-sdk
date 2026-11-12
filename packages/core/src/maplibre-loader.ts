export type TileflowMapLibre = typeof import('maplibre-gl');
export type TileflowMapLibreConfiguration = Readonly<{workerUrl: string}>;

let mapLibrePromise: Promise<TileflowMapLibre> | undefined;
let mapLibre: TileflowMapLibre | undefined;
let workerUrl: string | undefined;

/** Configure the matching MapLibre worker once, before creating a browser map. */
export function configureTileflowMapLibre(configuration: TileflowMapLibreConfiguration): void {
  const nextWorkerUrl = configuration.workerUrl;
  if (typeof nextWorkerUrl !== 'string' || nextWorkerUrl.trim().length === 0) {
    throw new TypeError('Tileflow MapLibre workerUrl must be a non-empty string.');
  }
  if (workerUrl !== undefined && workerUrl !== nextWorkerUrl) {
    throw new Error('Tileflow MapLibre workerUrl is already configured.');
  }
  workerUrl = nextWorkerUrl;
  mapLibre?.setWorkerUrl(nextWorkerUrl);
}

/** Shares the renderer and worker configuration across all browser adapters. Imports are SSR-safe. */
export function loadTileflowMapLibre(): Promise<TileflowMapLibre> {
  mapLibrePromise ??= import('maplibre-gl')
    .then((module) => {
      const renderer =
        (module as TileflowMapLibre & {default?: TileflowMapLibre}).default ?? module;
      if (workerUrl !== undefined) renderer.setWorkerUrl(workerUrl);
      mapLibre = renderer;
      return renderer;
    })
    .catch((error: unknown) => {
      mapLibrePromise = undefined;
      throw error;
    });
  return mapLibrePromise;
}
