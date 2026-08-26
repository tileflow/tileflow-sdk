/** @typedef {typeof import('maplibre-gl')} TileflowMapLibre */

/** @type {Promise<TileflowMapLibre> | undefined} */
let mapLibrePromise;

/** Load the interactive renderer only after a browser map requests it. */
export function loadTileflowMapLibre() {
  mapLibrePromise ??= import('maplibre-gl').then(resolveMapLibreModule).catch((error) => {
    mapLibrePromise = undefined;
    throw error;
  });
  return mapLibrePromise;
}

/** @param {TileflowMapLibre} module */
function resolveMapLibreModule(module) {
  return /** @type {TileflowMapLibre & {default?: TileflowMapLibre}} */ (module).default ?? module;
}
