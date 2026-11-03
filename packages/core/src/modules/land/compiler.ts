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

// Hedges last, so a hedge along a wall or fence stays on top.
const barrierClasses = [
  'fence',
  'wall',
  'hedge',
] as const satisfies readonly TileflowBarrierClass[];

const landuseClasses: Record<TileflowLanduseClass, readonly string[]> = {
  cemetery: ['cemetery'],
  civic: ['community_centre', 'place_of_worship', 'social_facility'],
  commercial: ['commercial', 'retail', 'business_area'],
  education: ['school', 'university', 'college', 'kindergarten', 'education', 'library'],
  government: ['civic', 'government', 'public', 'townhall'],
  industrial: ['industrial'],
  medical: ['hospital', 'clinic', 'doctors', 'medical'],
  military: ['military'],
  parking: ['parking'],
  railway: ['railway'],
  recreation: ['pitch', 'track', 'playground', 'zoo'],
  residential: ['residential'],
};

type TileflowLandcoverClassMatch = {
  class: readonly string[];
  excludeSubclass?: readonly string[];
  subclass?: readonly string[];
};

const typedGrassSubclasses = [
  'flowerbed',
  'garden',
  'meadow',
  'park',
  'recreation_ground',
  'scrub',
  'village_green',
] as const;

// Tileflow World retains fine OSM semantics in `subclass` while normalizing
// these polygons under `class: grass`. Keep every typed branch disjoint from
// the plain-grass fallback so no feature receives two green fills.
const protectedLandcoverMatch = {class: ['protected_area']} as const;

// Broad physical cover is followed by protection/park surfaces, then explicitly mapped
// ground details. Keep the latter above park fills without covering pitches/playgrounds.
// This order is independent of config key order and remains replaceable by render targets.
const landcoverClasses = [
  ['farmland', {class: ['farmland']}],
  ['ice', {class: ['ice', 'glacier']}],
  ['rock', {class: ['rock']}],
  ['sand', {class: ['sand', 'beach']}],
  ['wetland', {class: ['wetland']}],
  ['wood', {class: ['wood', 'forest']}],
  ['protected', protectedLandcoverMatch],
  ['urbanPark', {class: ['grass'], subclass: ['park', 'garden']}],
  ['recreationGround', {class: ['grass'], subclass: ['recreation_ground']}],
  ['villageGreen', {class: ['grass'], subclass: ['village_green']}],
  ['grass', {class: ['grass'], excludeSubclass: typedGrassSubclasses}],
  ['meadow', {class: ['grass'], subclass: ['meadow']}],
  ['scrub', {class: ['grass'], subclass: ['scrub']}],
  ['flowerbed', {class: ['grass'], subclass: ['flowerbed']}],
] as const satisfies readonly (readonly [TileflowLandcoverClass, TileflowLandcoverClassMatch])[];

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
  const subclassField = schema.fields.subclass;
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
    schema.layers.globalLandcover &&
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
        source: 'tileflow-landcover-underlay',
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

  if (schema.layers.globalLandcover && config.globalLandcover?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'tileflow-global-landcover',
          type: 'fill',
          source,
          'source-layer': schema.layers.globalLandcover,
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
  const appendLanduse = (name: TileflowLanduseClass, classes: readonly string[]) => {
    const style = config.landuse?.[name];
    if (!style) return;
    for (const area of createAreaLayers(
      {
        id: `tileflow-landuse-${name}`,
        type: 'fill',
        source,
        'source-layer': schema.layers.landuse,
        filter: classFilter(classField, classes),
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

  for (const [name, classes] of Object.entries(landuseClasses) as Array<
    [TileflowLanduseClass, readonly string[]]
  >) {
    if (name === 'recreation' || name === 'parking') continue;
    appendLanduse(name, classes);
  }

  const appendLandcover = (name: TileflowLandcoverClass, match: TileflowLandcoverClassMatch) => {
    const style = config.landcover?.[name];
    if (!style) return;
    const protectedSource = name === 'protected';
    const sourceLayer = protectedSource ? schema.layers.park : schema.layers.landcover;
    const filter =
      protectedSource && schema.semantics.parkLayer === 'protected-only'
        ? undefined
        : landcoverFilter(classField, subclassField, match);
    for (const area of createAreaLayers(
      {
        id: `tileflow-landcover-${name}`,
        type: 'fill',
        source,
        'source-layer': sourceLayer,
        ...(filter ? {filter} : {}),
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

  for (const [name, match] of landcoverClasses) {
    if (!detailedLandcover.has(name)) appendLandcover(name, match);
  }

  // Canonical OpenMapTiles historically mixes ordinary parks and protected
  // areas in one layer. Preserve that compatibility branch without exposing
  // the ambiguous legacy class in the public landcover taxonomy.
  if (schema.semantics.parkLayer === 'mixed' && config.landcover?.urbanPark) {
    for (const area of createAreaLayers(
      {
        id: 'tileflow-landcover-legacy-park',
        type: 'fill',
        source,
        'source-layer': schema.layers.park,
        filter: ['!', classFilter(classField, protectedLandcoverMatch.class)],
      },
      config.landcover.urbanPark,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.compatibility.legacyPark.${area.phase}`,
      });
    }
  }

  for (const [name, match] of landcoverClasses) {
    if (detailedLandcover.has(name)) appendLandcover(name, match);
  }

  // Mapped paved surfaces remain legible inside broad park/forest polygons. Recreation
  // means pitches, tracks, playgrounds and zoos, not the enclosing park itself.
  appendLanduse('parking', landuseClasses.parking);
  appendLanduse('recreation', landuseClasses.recreation);

  // Barriers are lines; World also publishes the hedges OSM maps as areas, which `area` fills.
  // A barrier's fill, shadow and line draw in that order.
  const barrierLayer = schema.layers.trafficControl;
  for (const name of barrierLayer ? barrierClasses : []) {
    const style = config.barriers?.[name];
    const kind = ['==', ['get', subclassField], name];
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

function landcoverFilter(
  classField: string,
  subclassField: string,
  match: TileflowLandcoverClassMatch,
): unknown[] {
  const filter = classFilter(classField, match.class);
  if (match.subclass) return ['all', filter, classFilter(subclassField, match.subclass)];
  if (match.excludeSubclass) {
    return ['all', filter, ['!', classFilter(subclassField, match.excludeSubclass)]];
  }
  return filter;
}
