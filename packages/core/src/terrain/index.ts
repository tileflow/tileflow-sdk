import type {TileflowTerrain, TileflowTerrainConfig, TileflowTerrainEncoding} from '../types';

export type ResolvedTerrain = {
  exaggeration: number;
  mode: 'hillshade' | '3d';
  source: Record<string, unknown> & {encoding: TileflowTerrainEncoding};
  sourceId: string;
};

export function resolveTerrain(
  terrain: TileflowTerrain | undefined,
  apiBaseUrl: string,
): ResolvedTerrain | undefined {
  if (!terrain || terrain === 'none') {
    return undefined;
  }

  const terrainConfig =
    typeof terrain === 'string' ? ({mode: terrain} satisfies TileflowTerrainConfig) : terrain;
  const mode = terrainConfig.mode ?? 'hillshade';

  if (mode === 'none') {
    return undefined;
  }

  const sourceId = terrainConfig.sourceId ?? 'tileflow-terrain';
  const url = terrainConfig.url ?? `${apiBaseUrl}/tiles/terrain/tiles.json`;
  const encoding = terrainConfig.encoding ?? 'terrarium';

  return {
    exaggeration: terrainConfig.exaggeration ?? 1.2,
    mode,
    sourceId,
    source: {
      ...(terrainConfig.attribution ? {attribution: terrainConfig.attribution} : {}),
      encoding,
      type: 'raster-dem',
      url,
    },
  };
}
