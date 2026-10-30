import {tileflowTeamModelUrl} from '@tileflow/core';
import type {
  TileflowBuildCatalog,
  TileflowEffectiveModelSourceIdentity,
  TileflowPreparedMapAssets,
} from '@tileflow/core/build';
import {
  type PreparedTileflowBuildingModel,
  prepareTileflowMapTreeModels,
} from '@tileflow/dev/icons';

/** A project's models, prepared as build and preview prepare them. */
export type PreparedModelAssets = {
  /** Each map's tree models, which the compiler carries in its styles. */
  assets: Record<string, TileflowPreparedMapAssets>;
  /** Each map's building models by id: files a local build writes, Team 3D models when hosted. */
  buildings: Record<string, Record<string, PreparedTileflowBuildingModel>>;
  /** Each map's model source identities, for its build manifest. */
  identities: Record<string, TileflowEffectiveModelSourceIdentity[]>;
};

/** The same model preparation as build/preview, before validation or any hosted writes. */
export async function prepareModelAssets(
  project: TileflowBuildCatalog,
  options: {baseDirectory: string; target: 'hosted' | 'local'},
): Promise<PreparedModelAssets> {
  const prepared: PreparedModelAssets = {assets: {}, buildings: {}, identities: {}};
  for (const [name, map] of Object.entries(project.maps)) {
    if (!map.models?.length) continue;
    const models = await prepareTileflowMapTreeModels(map.models, {
      ...options,
      cwd: process.cwd(),
      configPath: `maps.${name}.models`,
    });
    prepared.assets[name] = {models: models.models};
    if (Object.keys(models.buildings).length > 0) prepared.buildings[name] = models.buildings;
    if (models.identities.length > 0) prepared.identities[name] = models.identities;
  }
  return prepared;
}

/**
 * Each map's prepared assets with its building models named at the address the compiler writes in
 * its styles: a local build's file under `localBase`, or, when hosted, the placeholder of the Team
 * 3D model of the same name that the deploy binds.
 */
export function mapAssetsWithBuildingModels(
  prepared: PreparedModelAssets,
  target:
    Readonly<{hosted: true}> | Readonly<{hosted?: false; localBase: (mapName: string) => string}>,
): Record<string, TileflowPreparedMapAssets> {
  const assets: Record<string, TileflowPreparedMapAssets> = {...prepared.assets};
  for (const [mapName, buildings] of Object.entries(prepared.buildings)) {
    const base = target.hosted ? '' : target.localBase(mapName).replace(/\/+$/u, '');
    assets[mapName] = {
      ...assets[mapName],
      buildingModels: Object.fromEntries(
        Object.entries(buildings).map(([id, model]) => [
          id,
          target.hosted ? tileflowTeamModelUrl(id) : `${base}/${model.fileName}`,
        ]),
      ),
    };
  }
  return assets;
}

/**
 * A hosted map's model source identities: its tree models only. Its building models are Team 3D
 * models, which the map follows by name, so their local bytes do not bind its revision.
 */
export function hostedModelSourceIdentities(
  prepared: PreparedModelAssets,
  mapName: string,
): TileflowEffectiveModelSourceIdentity[] | undefined {
  const buildings = prepared.buildings[mapName] ?? {};
  const identities = (prepared.identities[mapName] ?? []).filter(({id}) => !(id in buildings));
  return identities.length > 0 ? identities : undefined;
}

/** The glTF binaries each of a map's building models was prepared from, for the deploy to compare. */
export function teamModelSources(
  prepared: PreparedModelAssets,
  mapName: string,
): Record<string, PreparedTileflowBuildingModel['sources']> | undefined {
  const buildings = Object.entries(prepared.buildings[mapName] ?? {});
  return buildings.length > 0
    ? Object.fromEntries(buildings.map(([id, model]) => [id, model.sources]))
    : undefined;
}
