import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {
  applyBackgroundStyle,
  applyFillStyle,
  applyLineStyle,
  createAreaLayers,
} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression, toMapLibreStyleValue, zoom} from '../../cartography/values';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {
  TileflowBarrierClass,
  TileflowLandcoverClass,
  TileflowLandModuleConfig,
  TileflowLanduseClass,
} from './index';
import {tileflowLandcoverUnderlaySourceId} from './underlay';

// Hedges last, so a hedge along a wall or fence stays on top.
const barrierClasses = [
  'fence',
  'wall',
  'hedge',
] as const satisfies readonly TileflowBarrierClass[];

/** World ground areas drawn as one Tileflow land class: by `class`, optionally narrowed by `type`. */
type TileflowGroundMatch = {
  class: readonly string[];
  excludeType?: readonly string[];
  layer?: 'landuse' | 'landuseOverlay';
  type?: readonly string[];
};

// World's ground classes drawn as each Tileflow land use. World has no civic or government
// ground class, so those land uses draw nothing.
const landuseClasses: Record<TileflowLanduseClass, readonly TileflowGroundMatch[]> = {
  cemetery: [{class: ['cemetery']}],
  civic: [],
  commercial: [{class: ['commercial', 'retail']}],
  education: [{class: ['education']}],
  government: [],
  industrial: [{class: ['industrial']}],
  medical: [{class: ['hospital']}],
  military: [{class: ['military']}],
  parking: [{class: ['parking']}],
  railway: [{class: ['railway']}],
  recreation: [{class: ['pitch', 'playground']}, {class: ['park'], type: ['zoo']}],
  residential: [{class: ['residential']}],
};

const parkDetails = ['recreation_ground', 'village_green', 'zoo'];

// Broad physical cover is followed by protection/park surfaces, then explicitly mapped
// ground details. Keep the latter above park fills without covering pitches/playgrounds.
// This order is independent of config key order and remains replaceable by render targets.
const landcoverClasses = [
  ['farmland', [{class: ['farmland', 'orchard', 'vineyard']}]],
  ['ice', [{class: ['ice']}]],
  ['rock', [{class: ['rock']}]],
  ['sand', [{class: ['sand']}]],
  ['wetland', [{class: ['wetland'], layer: 'landuseOverlay'}]],
  ['wood', [{class: ['wood']}]],
  ['protected', [{class: ['protected_area'], layer: 'landuseOverlay'}]],
  [
    'urbanPark',
    [
      {class: ['park'], excludeType: parkDetails},
      {class: ['garden'], excludeType: ['flowerbed']},
    ],
  ],
  ['recreationGround', [{class: ['park'], type: ['recreation_ground']}]],
  ['villageGreen', [{class: ['park'], type: ['village_green']}]],
  ['grass', [{class: ['grass'], excludeType: ['meadow']}, {class: ['golf']}]],
  ['meadow', [{class: ['grass'], type: ['meadow']}]],
  ['scrub', [{class: ['scrub']}]],
  ['flowerbed', [{class: ['garden'], type: ['flowerbed']}]],
] as const satisfies readonly (readonly [TileflowLandcoverClass, readonly TileflowGroundMatch[]])[];

const detailedLandcover = new Set<TileflowLandcoverClass>([
  'grass',
  'meadow',
  'scrub',
  'flowerbed',
]);

export function compileLand(
  request: TileflowResolvedModuleConfig<TileflowLandModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const colors = context.colors;
  const schema = context.data.schema;
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowLandModuleConfig>>(
    {
      type: 'land',
      enabled: true,
      ...(schema.fields.activity
        ? {
            activityAreas: {
              fill: {
                color: colors.landuse.activity,
                minZoom: 11,
                opacity: expression<number>([
                  'interpolate',
                  ['linear'],
                  ['to-number', ['coalesce', ['get', schema.fields.activity], 1], 1],
                  1,
                  0.08,
                  5,
                  0.24,
                ]),
              },
              outline: {
                color: colors.landuse.activityOutline,
                minZoom: 14,
                opacity: 0.16,
                width: 0.5,
              },
            },
          }
        : {}),
      background: {color: colors.background},
      globalLandcover: {
        color: expression([
          'match',
          ['get', schema.fields.class],
          'barren',
          colors.landcover.rock,
          'crop',
          colors.landcover.farmland,
          'grass',
          colors.landcover.grass,
          'shrub',
          colors.landcover.protected,
          'snow',
          colors.landcover.ice,
          'trees',
          colors.landcover.wood,
          'urban',
          colors.buildings.active,
          'rgba(0, 0, 0, 0)',
        ]),
        maxZoom: 8,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.88],
          [6, 0.82],
          [7, 0.68],
          [8, 0],
        ]),
      },
      landuse: {
        cemetery: {fill: {color: colors.landuse.cemetery, minZoom: 8, opacity: 0.62}},
        civic: {fill: {color: colors.landuse.civic, minZoom: 8, opacity: 0.62}},
        commercial: {fill: {color: colors.landuse.commercial, minZoom: 8, opacity: 0.62}},
        education: {fill: {color: colors.landuse.education, minZoom: 8, opacity: 0.62}},
        government: {fill: {color: colors.landuse.government, minZoom: 8, opacity: 0.62}},
        industrial: {fill: {color: colors.landuse.industrial, minZoom: 8, opacity: 0.62}},
        medical: {fill: {color: colors.landuse.medical, minZoom: 8, opacity: 0.62}},
        military: {fill: {color: colors.landuse.military, minZoom: 8, opacity: 0.5}},
        parking: {fill: {color: colors.landuse.parking, minZoom: 8, opacity: 0.62}},
        railway: {fill: {color: colors.landuse.railway, minZoom: 8, opacity: 0.62}},
        recreation: {fill: {color: colors.landuse.recreation, minZoom: 8, opacity: 0.62}},
        residential: {fill: {color: colors.landuse.residential, minZoom: 8, opacity: 0.62}},
      },
      landcover: {
        farmland: {fill: {color: colors.landcover.farmland, minZoom: 8, opacity: 0.88}},
        flowerbed: {fill: {color: colors.landcover.flowerbed, minZoom: 12, opacity: 0.82}},
        grass: {fill: {color: colors.landcover.grass, minZoom: 8, opacity: 0.88}},
        ice: {fill: {color: colors.landcover.ice, minZoom: 8, opacity: 0.88}},
        meadow: {fill: {color: colors.landcover.meadow, minZoom: 8, opacity: 0.86}},
        protected: {fill: {color: colors.landcover.protected, minZoom: 8, opacity: 0.88}},
        recreationGround: {
          fill: {color: colors.landcover.recreationGround, minZoom: 8, opacity: 0.82},
        },
        rock: {fill: {color: colors.landcover.rock, minZoom: 8, opacity: 0.85}},
        sand: {fill: {color: colors.landcover.sand, minZoom: 8, opacity: 0.88}},
        scrub: {fill: {color: colors.landcover.scrub, minZoom: 8, opacity: 0.88}},
        urbanPark: {fill: {color: colors.landcover.urbanPark, minZoom: 8, opacity: 0.78}},
        villageGreen: {
          fill: {color: colors.landcover.villageGreen, minZoom: 10, opacity: 0.82},
        },
        wetland: {fill: {color: colors.landcover.wetland, minZoom: 8, opacity: 0.82}},
        wood: {fill: {color: colors.landcover.wood, minZoom: 8, opacity: 0.88}},
      },
    },
    request,
  );

  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const classField = schema.fields.class;
  const typeField = schema.fields.type;
  const contributions: TileflowLayerContribution[] = [];

  if (config.background?.visible !== false) {
    const background = config.background ?? {};
    contributions.push({
      kind: 'layer',
      layer: applyBackgroundStyle(
        {
          id: 'tileflow-background',
          type: 'background',
        },
        background,
      ),
      localOrder: 0,
      owner: 'land',
      slot: 'background',
      target: 'land.background',
    });
  }

  if (
    config.globalLandcoverUnderlay &&
    schema.layers.landcover &&
    config.globalLandcover?.visible !== false
  ) {
    const underlay = config.globalLandcoverUnderlay;
    contributions.push({
      kind: 'layer',
      owner: 'land',
      slot: 'land',
      localOrder: 9,
      target: 'land.globalLandcoverUnderlay',
      layer: {
        id: 'tileflow-global-landcover-underlay',
        type: 'raster',
        source: tileflowLandcoverUnderlaySourceId,
        minzoom: underlay.minZoom ?? 0,
        maxzoom: underlay.maxZoom ?? 11,
        paint: {
          'raster-opacity': toMapLibreStyleValue(underlay.opacity ?? 1),
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
    });
  }

  if (schema.layers.landcover && config.globalLandcover?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'tileflow-global-landcover',
          type: 'fill',
          source,
          'source-layer': schema.layers.landcover,
        },
        config.globalLandcover ?? {},
      ),
      localOrder: 10,
      owner: 'land',
      slot: 'land',
      target: 'land.globalLandcover',
    });
  }

  let localOrder = 100;
  const appendLanduse = (name: TileflowLanduseClass, matches: readonly TileflowGroundMatch[]) => {
    const style = config.landuse?.[name];
    if (!style || matches.length === 0) return;
    for (const area of createAreaLayers(
      {
        id: `tileflow-landuse-${name}`,
        type: 'fill',
        source,
        'source-layer': schema.layers.landuse,
        filter: groundFilter(classField, typeField, matches),
      },
      style,
    )) {
      contributions.push({
        ...(area.phase === 'fill'
          ? {
              family: {
                group: 'land.landuse',
                kind: 'fill' as const,
                member: name,
                outputKey: 'land.cohorts.landuse',
              },
            }
          : {}),
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.landuse.${name}.${area.phase}`,
      });
    }
  };

  for (const [name, matches] of Object.entries(landuseClasses) as Array<
    [TileflowLanduseClass, readonly TileflowGroundMatch[]]
  >) {
    if (name === 'recreation' || name === 'parking') continue;
    appendLanduse(name, matches);
  }

  const appendLandcover = (
    name: TileflowLandcoverClass,
    matches: readonly TileflowGroundMatch[],
  ) => {
    const style = config.landcover?.[name];
    if (!style) return;
    for (const area of createAreaLayers(
      {
        id: `tileflow-landcover-${name}`,
        type: 'fill',
        source,
        'source-layer': schema.layers[matches[0]!.layer ?? 'landuse'],
        filter: groundFilter(classField, typeField, matches),
      },
      style,
    )) {
      contributions.push({
        ...(area.phase === 'fill'
          ? {
              family: {
                group: 'land.landcover',
                kind: 'fill' as const,
                member: name,
                outputKey: 'land.cohorts.landcover',
              },
            }
          : {}),
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.landcover.${name}.${area.phase}`,
      });
    }
  };

  for (const [name, matches] of landcoverClasses) {
    if (!detailedLandcover.has(name)) appendLandcover(name, matches);
  }

  for (const [name, matches] of landcoverClasses) {
    if (detailedLandcover.has(name)) appendLandcover(name, matches);
  }

  // Mapped paved surfaces remain legible inside broad park/forest polygons. Recreation
  // means pitches, tracks, playgrounds and zoos, not the enclosing park itself.
  appendLanduse('parking', landuseClasses.parking);
  appendLanduse('recreation', landuseClasses.recreation);

  // Activity areas: where shops, food, services and offices concentrate, by level 1 to 5.
  if (config.activityAreas) {
    for (const area of createAreaLayers(
      {
        id: 'tileflow-activity-areas',
        type: 'fill',
        source,
        'source-layer': schema.layers.landuseOverlay,
        filter: ['==', ['get', classField], 'activity_area'],
      },
      config.activityAreas,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.activityAreas.${area.phase}`,
      });
    }
  }

  // Barriers are lines; World also publishes the hedges OSM maps as areas, which `area` fills.
  // A barrier's fill, shadow and line draw in that order.
  const barrierLayer = schema.layers.trafficControl;
  for (const name of barrierLayer ? barrierClasses : []) {
    const style = config.barriers?.[name];
    const kind = ['==', ['get', typeField], name];
    if (style?.area) {
      contributions.push({
        kind: 'layer',
        layer: applyFillStyle(
          {
            id: `tileflow-barrier-${name}-area`,
            type: 'fill',
            source,
            'source-layer': barrierLayer,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], kind],
          },
          style.area,
        ),
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.barriers.${name}.area`,
      });
    }
    for (const phase of ['shadow', 'line'] as const) {
      const line = style?.[phase];
      if (!line) continue;
      contributions.push({
        kind: 'layer',
        layer: applyLineStyle(
          {
            id: `tileflow-barrier-${name}${phase === 'shadow' ? '-shadow' : ''}`,
            type: 'line',
            source,
            'source-layer': barrierLayer,
            filter: kind,
          },
          line,
        ),
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.barriers.${name}.${phase}`,
      });
    }
  }

  return contributions;
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}

function groundFilter(
  classField: string,
  typeField: string,
  matches: readonly TileflowGroundMatch[],
): unknown[] {
  const filters = matches.map((match) => {
    const classes = classFilter(classField, match.class);
    if (match.type) return ['all', classes, classFilter(typeField, match.type)];
    if (match.excludeType)
      return ['all', classes, ['!', classFilter(typeField, match.excludeType)]];
    return classes;
  });
  return filters.length === 1 ? filters[0]! : ['any', ...filters];
}
