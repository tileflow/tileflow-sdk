/** @typedef {typeof import('maplibre-gl')} TileflowMapLibre */
/** @typedef {{workerUrl: string}} TileflowMapLibreConfiguration */

/** @type {Promise<TileflowMapLibre> | undefined} */
let mapLibrePromise;
/** @type {TileflowMapLibre | undefined} */
let mapLibre;
/** @type {string | undefined} */
let workerUrl;

/** @param {TileflowMapLibreConfiguration} configuration */
export function configureTileflowMapLibre(configuration) {
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
export function loadTileflowMapLibre() {
  mapLibrePromise ??= import('maplibre-gl')
    .then(resolveMapLibreModule)
    .then(configureTileflowMapLibreModule)
    .catch((error) => {
      mapLibrePromise = undefined;
      throw error;
    });

  return mapLibrePromise;
}

/** @param {TileflowMapLibre} module */
function resolveMapLibreModule(module) {
  return /** @type {TileflowMapLibre & {default?: TileflowMapLibre}} */ (module).default ?? module;
}

/** @param {TileflowMapLibre} maplibregl */
function configureTileflowMapLibreModule(maplibregl) {
  if (workerUrl !== undefined) maplibregl.setWorkerUrl(workerUrl);
  mapLibre = maplibregl;
  return maplibregl;
}
