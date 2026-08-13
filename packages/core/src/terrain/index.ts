import type {TileflowTerrain, TileflowTerrainConfig, TileflowTerrainEncoding} from '../compiler';

export type ResolvedTerrain = {
  exaggeration: number;
  mode: 'hillshade' | '3d';
  source: Record<string, unknown> & {encoding: TileflowTerrainEncoding};
  sourceId: string;
};

export function resolveTerrain(
  terrain: TileflowTerrain | undefined,
  tileBaseUrl: string,
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
  const tileset = terrainConfig.tileset ?? 'terrain';
  const url = terrainConfig.url ?? `${tileBaseUrl}/tiles/${tileset}/tiles.json`;
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

export function withTerrainLayers(
  layers: Array<Record<string, unknown>>,
  terrain: ResolvedTerrain,
): Array<Record<string, unknown>> {
  const hillshadeLayer = {
    id: 'terrain-hillshade',
    type: 'hillshade',
    source: terrain.sourceId,
    maxzoom: 15,
    paint: {
      'hillshade-accent-color': 'rgba(255, 255, 255, 0.18)',
      'hillshade-exaggeration': terrain.mode === '3d' ? 0.24 : 0.42,
      'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
      'hillshade-shadow-color': 'rgba(38, 44, 50, 0.34)',
    },
  };
  const insertionIndex = layers.findIndex((layer) => layer.id === 'water');

  if (insertionIndex === -1) {
    return [hillshadeLayer, ...layers];
  }

  return [
    ...layers.slice(0, insertionIndex + 1),
    hillshadeLayer,
    ...layers.slice(insertionIndex + 1),
  ];
}
