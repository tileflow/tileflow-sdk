import type {
  ResolvedTileflowTypography,
  TileflowBuildings,
  TileflowBuildingStyleConfig,
  TileflowDensity,
  TileflowSourceLayers,
} from '../../compiler';
import {labelLayers, type ResolvedLabelsModuleOptions} from '../../modules/labels';
import {poiLayers, type ResolvedPoiModuleOptions} from '../../modules/poi';
import {type ResolvedRoadsModuleOptions, roadLayers} from '../../modules/roads';
import type {TileflowResolvedColors} from '../../themes';

export function openMapTilesLayers(
  source: string,
  sourceLayers: Required<TileflowSourceLayers>,
  colors: TileflowResolvedColors,
  options: {
    buildings: TileflowBuildings;
    buildingStyle?: TileflowBuildingStyleConfig;
    customIconMapping?: Record<string, string>;
    customIconSpriteId?: string;
    density: TileflowDensity;
    labels: ResolvedLabelsModuleOptions;
    poi: ResolvedPoiModuleOptions;
    roads: ResolvedRoadsModuleOptions;
    typography: ResolvedTileflowTypography;
  },
): Array<Record<string, unknown>> {
  return [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': colors.background,
      },
    },
    semanticLanduseLayer(source, sourceLayers.landuse, colors),
    semanticLandcoverLayer(source, sourceLayers.landcover, colors),
    fillLayer(
      'parks',
      source,
      sourceLayers.park,
      colors.landcover.park,
      parkOpacity(options.density),
    ),
    fillLayer('water', source, sourceLayers.water, colors.hydro.water, 1),
    ...buildingLayers(
      source,
      sourceLayers.building,
      colors,
      options.density,
      options.buildings,
      options.buildingStyle,
    ),
    ...roadLayers(source, sourceLayers.road, colors, options.roads, options.typography),
    ...boundaryLayers(source, sourceLayers.boundary, colors),
    ...labelLayers(source, sourceLayers, colors, options.labels, options.roads, options.typography),
    ...poiLayers(
      source,
      sourceLayers.poi,
      colors,
      options.poi,
      options.typography,
      options.customIconSpriteId,
      options.customIconMapping,
    ),
  ];
}

function semanticLanduseLayer(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
): Record<string, unknown> {
  return {
    id: 'landuse',
    type: 'fill',
    source,
    'source-layer': sourceLayer,
    paint: {
      'fill-color': [
        'match',
        ['get', 'class'],
        ['commercial', 'retail'],
        colors.landuse.commercial,
        ['industrial', 'railway'],
        colors.landuse.industrial,
        ['school', 'university', 'hospital', 'civic'],
        colors.landuse.civic,
        'cemetery',
        colors.landuse.cemetery,
        colors.landuse.residential,
      ],
      'fill-opacity': 0.62,
    },
  };
}

function semanticLandcoverLayer(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
): Record<string, unknown> {
  return {
    id: 'landcover',
    type: 'fill',
    source,
    'source-layer': sourceLayer,
    filter: [
      'match',
      ['get', 'class'],
      ['grass', 'wood', 'forest', 'scrub', 'farmland', 'sand', 'beach', 'ice', 'glacier'],
      true,
      false,
    ],
    paint: {
      'fill-color': [
        'match',
        ['get', 'class'],
        ['wood', 'forest'],
        colors.landcover.wood,
        ['scrub', 'farmland'],
        colors.landcover.protected,
        ['sand', 'beach'],
        colors.landcover.sand,
        ['ice', 'glacier'],
        colors.landcover.ice,
        colors.landcover.grass,
      ],
      'fill-opacity': 0.88,
    },
  };
}

function fillLayer(
  id: string,
  source: string,
  sourceLayer: string,
  color: string,
  opacity: number,
): Record<string, unknown> {
  return {
    id,
    type: 'fill',
    source,
    'source-layer': sourceLayer,
    paint: {
      'fill-color': color,
      'fill-opacity': opacity,
    },
  };
}

function buildingLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  density: TileflowDensity,
  buildings: TileflowBuildings,
  buildingStyle: TileflowBuildingStyleConfig | undefined,
): Array<Record<string, unknown>> {
  if (buildings === 'hidden') {
    return [];
  }

  if (buildings === '3d') {
    return [
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source,
        'source-layer': sourceLayer,
        minzoom: 14,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
          'fill-extrusion-base': [
            'case',
            ['has', 'render_min_height'],
            ['to-number', ['get', 'render_min_height']],
            ['has', 'min_height'],
            ['to-number', ['get', 'min_height']],
            0,
          ],
          'fill-extrusion-color': colors.buildings.extrusion,
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            15,
            [
              'case',
              ['has', 'render_height'],
              ['to-number', ['get', 'render_height']],
              ['has', 'height'],
              ['to-number', ['get', 'height']],
              18,
            ],
          ],
          'fill-extrusion-opacity': 0.72,
        },
      },
    ];
  }

  if (density === 'clean') {
    return [
      {
        id: 'buildings-soft',
        type: 'fill',
        source,
        'source-layer': sourceLayer,
        minzoom: 14,
        paint: {
          'fill-color': colors.buildings.fill,
          'fill-opacity': 0.38,
        },
      },
    ];
  }

  return [
    {
      id: 'buildings',
      type: 'fill',
      source,
      'source-layer': sourceLayer,
      minzoom: 13,
      paint: {
        'fill-color': buildingStyle
          ? buildingHeightColorExpression(
              buildingStyle.heightThreshold ?? 12,
              colors.buildings.lowRise,
              colors.buildings.highRise,
            )
          : colors.buildings.fill,
        'fill-opacity': buildingStyle?.fillOpacity ?? (density === 'dense' ? 0.62 : 0.5),
      },
    },
    {
      id: 'buildings-outline',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 15,
      paint: {
        'line-color': buildingStyle
          ? buildingHeightColorExpression(
              buildingStyle.heightThreshold ?? 12,
              colors.buildings.lowRiseOutline,
              colors.buildings.highRiseOutline,
            )
          : colors.buildings.outline,
        'line-opacity': buildingStyle?.outlineOpacity ?? 0.24,
        'line-width': buildingStyle?.outlineWidth ?? 0.6,
      },
    },
  ];
}

function buildingHeightColorExpression(
  threshold: number,
  lowRise: string,
  highRise: string,
): unknown[] {
  return [
    'case',
    [
      '>=',
      [
        'to-number',
        ['coalesce', ['get', 'render_height'], ['get', 'height'], ['get', 'levels']],
        0,
      ],
      threshold,
    ],
    highRise,
    lowRise,
  ];
}

function boundaryLayers(
  source: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
): Array<Record<string, unknown>> {
  return [
    {
      id: 'boundaries',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 2,
      paint: {
        'line-color': colors.boundaries.admin,
        'line-opacity': 0.35,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 8, 0.8],
      },
    },
  ];
}

function parkOpacity(density: TileflowDensity): number {
  return density === 'clean' ? 0.64 : density === 'balanced' ? 0.78 : 0.9;
}
