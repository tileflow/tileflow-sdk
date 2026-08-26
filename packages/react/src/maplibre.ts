export type TileflowMapLibre = typeof import('maplibre-gl');

let mapLibrePromise: Promise<TileflowMapLibre> | undefined;

/** Load the interactive renderer only after a browser map requests it. */
export function loadTileflowMapLibre(): Promise<TileflowMapLibre> {
  mapLibrePromise ??= import('maplibre-gl').then(resolveMapLibreModule).catch((error: unknown) => {
    mapLibrePromise = undefined;
    throw error;
  });
  return mapLibrePromise;
}

function resolveMapLibreModule(module: TileflowMapLibre): TileflowMapLibre {
  const defaultExport = (module as TileflowMapLibre & {default?: TileflowMapLibre}).default;
  return defaultExport ?? module;
}
