import {type TileflowDomainCompileContext} from '../cartography/context';
import type {TileflowLayerContribution} from '../cartography/contributions';
import type {
  TileflowTerrain,
  TileflowTerrainConfig,
  TileflowTerrainContourLabelStyle,
  TileflowTerrainContourLineStyle,
  TileflowTerrainEncoding,
  TileflowTerrainHillshadeStyle,
  TileflowTerrainLayerRange,
} from '../types';
import {createTileflowContourProtocolUrl, tileflowContourSourceLayer} from './contour-protocol';

export type ResolvedTerrainRaster = {
  hillshade: TileflowTerrainHillshadeStyle;
  source: Record<string, unknown> & {encoding: TileflowTerrainEncoding};
  sourceId: string;
};

export type ResolvedTerrainContours = {
  index: TileflowTerrainContourLineStyle;
  labels: TileflowTerrainContourLabelStyle;
  minor: TileflowTerrainContourLineStyle;
  source: Record<string, unknown> & {type: 'vector'};
  sourceId: string;
};

export type ResolvedTerrain = {
  contours?: ResolvedTerrainContours;
  exaggeration: number;
  mode: 'none' | 'hillshade' | '3d';
  raster?: ResolvedTerrainRaster;
};

export function resolveTerrain(
  terrain: TileflowTerrain | undefined,
  apiBaseUrl: string,
): ResolvedTerrain | undefined {
  if (!terrain || terrain === 'none') return undefined;

  const terrainConfig =
    typeof terrain === 'string' ? ({mode: terrain} satisfies TileflowTerrainConfig) : terrain;
  const mode = terrainConfig.mode ?? 'hillshade';
  const encoding = terrainConfig.encoding ?? 'terrarium';
  const raster = mode === 'none' ? undefined : resolveRaster(terrainConfig, apiBaseUrl, encoding);
  const contours = terrainConfig.contours
    ? resolveContours(terrainConfig.contours, encoding, terrainConfig.attribution)
    : undefined;

  if (!raster && !contours) return undefined;
  return {
    ...(contours ? {contours} : {}),
    exaggeration: terrainConfig.exaggeration ?? 1.2,
    mode,
    ...(raster ? {raster} : {}),
  };
}

/** Terrain owns renderer layers; the Streets orchestrator only composes the contributions. */
export function compileTerrainContributions(
  terrain: ResolvedTerrain,
  context: Pick<TileflowDomainCompileContext, 'typography'>,
): TileflowLayerContribution[] {
  const contributions: TileflowLayerContribution[] = [];
  if (terrain.raster) {
    const {hillshade, sourceId} = terrain.raster;
    contributions.push(
      terrainContribution(
        'terrain.hillshade',
        0,
        applyLayerRange(
          {
            id: 'streets-terrain-hillshade',
            type: 'hillshade',
            source: sourceId,
            paint: {
              'hillshade-accent-color': hillshade.accentColor ?? 'rgba(255, 255, 255, 0.18)',
              'hillshade-exaggeration':
                hillshade.exaggeration ?? (terrain.mode === '3d' ? 0.24 : 0.42),
              'hillshade-highlight-color': hillshade.highlightColor ?? 'rgba(255, 255, 255, 0.28)',
              ...(hillshade.illuminationAnchor
                ? {'hillshade-illumination-anchor': hillshade.illuminationAnchor}
                : {}),
              ...(hillshade.illuminationDirection === undefined
                ? {}
                : {'hillshade-illumination-direction': hillshade.illuminationDirection}),
              'hillshade-shadow-color': hillshade.shadowColor ?? 'rgba(38, 44, 50, 0.34)',
            },
          },
          hillshade,
        ),
      ),
    );
  }

  if (terrain.contours) {
    const {index, labels, minor, sourceId} = terrain.contours;
    contributions.push(
      terrainContribution(
        'terrain.contours.minor',
        10,
        applyLayerRange(
          {
            id: 'streets-terrain-contour-minor',
            type: 'line',
            source: sourceId,
            'source-layer': tileflowContourSourceLayer,
            filter: ['==', ['get', 'level'], 0],
            layout: {'line-cap': 'round', 'line-join': 'round'},
            paint: {
              'line-color': minor.color ?? '#6B6259',
              'line-opacity': minor.opacity ?? 0.5,
              'line-width': minor.width ?? 0.55,
            },
          },
          minor,
        ),
      ),
      terrainContribution(
        'terrain.contours.index',
        20,
        applyLayerRange(
          {
            id: 'streets-terrain-contour-index',
            type: 'line',
            source: sourceId,
            'source-layer': tileflowContourSourceLayer,
            filter: ['>', ['get', 'level'], 0],
            layout: {'line-cap': 'round', 'line-join': 'round'},
            paint: {
              'line-color': index.color ?? '#564C42',
              'line-opacity': index.opacity ?? 0.72,
              'line-width': index.width ?? 1,
            },
          },
          index,
        ),
      ),
      terrainContribution(
        'terrain.contours.labels',
        30,
        applyLayerRange(
          {
            id: 'streets-terrain-contour-labels',
            type: 'symbol',
            source: sourceId,
            'source-layer': tileflowContourSourceLayer,
            filter: ['>', ['get', 'level'], 0],
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': labels.spacing ?? 300,
              'text-field': ['number-format', ['get', 'ele'], {'max-fraction-digits': 0}],
              'text-font': [
                labels.font ?? context.typography.places.font,
                ...(context.typography.places.fallbacks ?? []),
              ],
              'text-keep-upright': true,
              'text-max-angle': 25,
              'text-size': labels.size ?? 10,
            },
            paint: {
              'text-color': labels.color ?? '#564C42',
              'text-halo-color': labels.haloColor ?? '#F6F1E5',
              'text-halo-width': labels.haloWidth ?? 1,
              'text-opacity': labels.opacity ?? 0.82,
            },
          },
          labels,
        ),
      ),
    );
  }

  return contributions;
}

function resolveRaster(
  terrain: TileflowTerrainConfig,
  apiBaseUrl: string,
  encoding: TileflowTerrainEncoding,
): ResolvedTerrainRaster {
  const sourceId = terrain.sourceId ?? 'tileflow-terrain';
  const url = terrain.url ?? `${apiBaseUrl}/tiles/terrain/tiles.json`;
  return {
    hillshade: terrain.hillshade ?? {},
    sourceId,
    source: {
      ...(terrain.attribution ? {attribution: terrain.attribution} : {}),
      encoding,
      type: 'raster-dem',
      url,
    },
  };
}

function resolveContours(
  contours: NonNullable<TileflowTerrainConfig['contours']>,
  encoding: TileflowTerrainEncoding,
  attribution: string | undefined,
): ResolvedTerrainContours {
  const thresholdZooms = Object.keys(contours.thresholds).map(Number);
  const minimumZoom = contours.minZoom ?? Math.min(...thresholdZooms);
  const maximumZoom = contours.maxZoom ?? Math.max(...thresholdZooms);
  const sourceId = contours.sourceId ?? 'tileflow-contours';
  const tiles = [
    createTileflowContourProtocolUrl({
      demMaxzoom: contours.demMaxZoom,
      demUrl: contours.demUrl,
      encoding,
      maxzoom: maximumZoom,
      multiplier: contours.multiplier ?? 1,
      overzoom: contours.overzoom ?? 0,
      thresholds: contours.thresholds,
    }),
  ];
  const range = {minZoom: minimumZoom};
  return {
    index: {...range, ...contours.index},
    labels: {...range, ...contours.labels},
    minor: {...range, ...contours.minor},
    sourceId,
    source: {
      ...(attribution ? {attribution} : {}),
      maxzoom: maximumZoom,
      minzoom: minimumZoom,
      tiles,
      type: 'vector',
    },
  };
}

function terrainContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer,
    localOrder,
    owner: 'terrain',
    slot: 'terrain',
    target,
  };
}

function applyLayerRange<TLayer extends Record<string, unknown> & {id: string; type: string}>(
  layer: TLayer,
  range: TileflowTerrainLayerRange,
): TLayer {
  const layout = {...asRecord(layer.layout)};
  if (range.visible !== undefined) layout.visibility = range.visible ? 'visible' : 'none';
  return {
    ...layer,
    ...(range.minZoom === undefined ? {} : {minzoom: range.minZoom}),
    ...(range.maxZoom === undefined ? {} : {maxzoom: range.maxZoom}),
    ...(Object.keys(layout).length === 0 ? {} : {layout}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
