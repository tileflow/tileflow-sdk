import type {TileflowBuildCatalog, TileflowPreparedMapAssets} from '@tileflow/core/build';
import {prepareTileflowMapTreeModels} from '@tileflow/dev/icons';

/** The same model preparation as build/preview, before validation or any hosted writes. */
export async function prepareModelAssets(
  project: TileflowBuildCatalog,
  options: {baseDirectory: string; target: 'hosted' | 'local'},
): Promise<Record<string, TileflowPreparedMapAssets>> {
  const assets: Record<string, TileflowPreparedMapAssets> = {};
  for (const [name, map] of Object.entries(project.maps)) {
    if (!map.models?.length) continue;
    const prepared = await prepareTileflowMapTreeModels(map.models, {
      ...options,
      cwd: process.cwd(),
      configPath: `maps.${name}.models`,
    });
    assets[name] = {models: prepared.models};
  }
  return assets;
}
