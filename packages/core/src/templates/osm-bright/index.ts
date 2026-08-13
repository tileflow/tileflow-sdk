import type {
  MapLibreSprite,
  MapLibreStyle,
  ResolvedTileflowTypography,
  TileflowPoi,
} from '../../compiler';
import type {ResolvedLabelsModuleOptions} from '../../modules/labels';
import type {ResolvedPoiModuleOptions} from '../../modules/poi';
import {oneWayMarkerLayer, type ResolvedRoadsModuleOptions} from '../../modules/roads';
import type {ResolvedTerrain} from '../../terrain';
import {withTerrainLayers} from '../../terrain';
import type {ResolvedTileflowTheme, TileflowResolvedColors} from '../../themes';
import {applyOsmBrightControls} from './controls';
import openMapTilesOsmBrightStyle from './style.json';
import {applyOsmBrightTheme} from './theme';

export function createOsmBrightStyle(options: {
  attribution: string;
  colors: TileflowResolvedColors;
  customIconMapping?: Record<string, string>;
  customIconSpriteId?: string;
  glyphs: string;
  labelsModule: ResolvedLabelsModuleOptions;
  metadata: Record<string, unknown>;
  name: string;
  poi: TileflowPoi;
  poiModule: ResolvedPoiModuleOptions;
  roadsModule?: ResolvedRoadsModuleOptions;
  sourceId: string;
  sprite?: MapLibreSprite;
  terrain?: ResolvedTerrain;
  theme: ResolvedTileflowTheme;
  tilesUrl: string;
  typography: ResolvedTileflowTypography;
  typographyOverridden?: boolean;
}): MapLibreStyle {
  const template = cloneJson(openMapTilesOsmBrightStyle) as MapLibreStyle;
  const layers = template.layers.map((layer) => remapOsmBrightSource(layer, options.sourceId));
  const themedLayers = applyOsmBrightTheme(
    layers,
    options.colors,
    options.theme,
    options.typography,
    options.typographyOverridden,
  );
  const controlledLayers = applyOsmBrightControls(themedLayers, {
    colors: options.colors,
    customIconMapping: options.customIconMapping,
    customIconSpriteId: options.customIconSpriteId,
    labels: options.labelsModule,
    poi: options.poiModule,
    roads: options.roadsModule,
  });
  const semanticLayers = options.roadsModule?.oneWayMarkers
    ? insertBeforeRoadLabels(
        controlledLayers,
        oneWayMarkerLayer(options.sourceId, 'transportation', options.colors, options.typography),
      )
    : controlledLayers;
  const resolvedLayers = options.terrain
    ? withTerrainLayers(semanticLayers, options.terrain)
    : semanticLayers;

  return {
    ...template,
    name: options.name,
    glyphs: options.glyphs,
    ...(options.sprite || template.sprite ? {sprite: options.sprite ?? template.sprite} : {}),
    sources: {
      [options.sourceId]: {
        type: 'vector',
        url: options.tilesUrl,
        attribution: options.attribution,
      },
      ...(options.terrain
        ? {
            [options.terrain.sourceId]: options.terrain.source,
          }
        : {}),
    },
    layers: resolvedLayers,
    ...(options.terrain?.mode === '3d'
      ? {
          terrain: {
            exaggeration: options.terrain.exaggeration,
            source: options.terrain.sourceId,
          },
        }
      : {}),
    metadata: {
      ...(template.metadata ?? {}),
      ...options.metadata,
      'tileflow:template': 'openmaptiles-osm-bright',
    },
  };
}

function insertBeforeRoadLabels(
  layers: Array<Record<string, unknown>>,
  layer: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const index = layers.findIndex(
    (candidate) =>
      candidate.type === 'symbol' && candidate['source-layer'] === 'transportation_name',
  );
  if (index < 0) return [...layers, layer];

  return [...layers.slice(0, index), layer, ...layers.slice(index)];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function remapOsmBrightSource(
  layer: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  if (layer.source !== 'openmaptiles') {
    return layer;
  }

  return {
    ...layer,
    source: sourceId,
  };
}
