export type TileflowMapLibre = typeof import('maplibre-gl');
export type TileflowMapLibreConfiguration = Readonly<{workerUrl: string}>;

let mapLibrePromise: Promise<TileflowMapLibre> | undefined;
let mapLibre: TileflowMapLibre | undefined;
let workerUrl: string | undefined;

/** Configure the application-owned worker before mounting an interactive Tileflow map. */
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

/** Load the interactive renderer only after a browser map requests it. */
export function loadTileflowMapLibre(): Promise<TileflowMapLibre> {
  mapLibrePromise ??= import('maplibre-gl')
    .then(resolveMapLibreModule)
    .then(configureTileflowMapLibreModule)
    .catch((error: unknown) => {
      mapLibrePromise = undefined;
      throw error;
    });

  return mapLibrePromise;
}

function resolveMapLibreModule(module: TileflowMapLibre): TileflowMapLibre {
  const defaultExport = (module as TileflowMapLibre & {default?: TileflowMapLibre}).default;
  return defaultExport ?? module;
}

function configureTileflowMapLibreModule(maplibregl: TileflowMapLibre): TileflowMapLibre {
  if (workerUrl !== undefined) maplibregl.setWorkerUrl(workerUrl);
  mapLibre = maplibregl;
  return maplibregl;
}
