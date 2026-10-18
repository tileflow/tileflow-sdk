import type {
  TileflowBuildCatalog,
  TileflowEffectiveModelSourceIdentity,
  TileflowPreparedMapAssets,
} from '@tileflow/core/build';
import {
  createTileflowModelBundle,
  prepareTileflowMapTreeModels,
  type TileflowModelBundle,
} from '@tileflow/dev/icons';

/** A project's models, prepared as build and preview prepare them. */
export type PreparedModelAssets = {
  /** Each map's tree models, which the compiler carries in its styles. */
  assets: Record<string, TileflowPreparedMapAssets>;
  /** Each map's building models as the bundle a hosted deploy uploads. */
  bundles: Record<string, TileflowModelBundle>;
  /** Each map's model source identities, for its build manifest. */
  identities: Record<string, TileflowEffectiveModelSourceIdentity[]>;
};

/** The same model preparation as build/preview, before validation or any hosted writes. */
export async function prepareModelAssets(
  project: TileflowBuildCatalog,
  options: {baseDirectory: string; target: 'hosted' | 'local'},
): Promise<PreparedModelAssets> {
  const prepared: PreparedModelAssets = {assets: {}, bundles: {}, identities: {}};
  for (const [name, map] of Object.entries(project.maps)) {
    if (!map.models?.length) continue;
    const models = await prepareTileflowMapTreeModels(map.models, {
      ...options,
      cwd: process.cwd(),
      configPath: `maps.${name}.models`,
    });
    prepared.assets[name] = {models: models.models};
    const bundle = await createTileflowModelBundle(models.buildings);
    if (bundle) prepared.bundles[name] = bundle;
    if (models.identities.length > 0) prepared.identities[name] = models.identities;
  }
  return prepared;
}

/**
 * Each map's prepared assets with its building models named at the address the compiler writes in
 * its styles: `<base>/<file>`, where `baseOf` gives the base of the map's bundle.
 */
export function mapAssetsWithBuildingModels(
  prepared: PreparedModelAssets,
  baseOf: (mapName: string, bundle: TileflowModelBundle) => string,
): Record<string, TileflowPreparedMapAssets> {
  const assets: Record<string, TileflowPreparedMapAssets> = {...prepared.assets};
  for (const [mapName, bundle] of Object.entries(prepared.bundles)) {
    const base = baseOf(mapName, bundle).replace(/\/+$/u, '');
    assets[mapName] = {
      ...assets[mapName],
      buildingModels: Object.fromEntries(
        bundle.manifest.models.map((model) => [model.id, `${base}/${model.file}`]),
      ),
    };
  }
  return assets;
}
