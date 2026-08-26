import type {TileflowLayerContribution} from '../cartography/contributions';
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

/** Terrain owns its renderer layer; the Streets orchestrator only composes the contribution. */
export function compileTerrainContribution(terrain: ResolvedTerrain): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer: {
      id: 'streets-terrain-hillshade',
      type: 'hillshade',
      source: terrain.sourceId,
      paint: {
        'hillshade-accent-color': 'rgba(255, 255, 255, 0.18)',
        'hillshade-exaggeration': terrain.mode === '3d' ? 0.24 : 0.42,
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
        'hillshade-shadow-color': 'rgba(38, 44, 50, 0.34)',
      },
    },
    localOrder: 0,
    owner: 'terrain',
    slot: 'terrain',
    target: 'terrain.hillshade',
  };
}
