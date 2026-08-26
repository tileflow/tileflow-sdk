import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {
  applyBackgroundStyle,
  applyFillStyle,
  createAreaLayers,
} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression, zoom} from '../../cartography/values';
import type {TileflowLandcoverClass, TileflowLandModuleConfig, TileflowLanduseClass} from './index';

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

// This order is cartographic: physical cover first, then the protected-area
// tint, then authored urban green classes. Do not derive it from config key
// order because it determines which overlapping surface remains visible.
const landcoverClasses = [
  ['farmland', {class: ['farmland']}],
  ['grass', {class: ['grass'], excludeSubclass: typedGrassSubclasses}],
  ['ice', {class: ['ice', 'glacier']}],
  ['meadow', {class: ['grass'], subclass: ['meadow']}],
  ['rock', {class: ['rock']}],
  ['sand', {class: ['sand', 'beach']}],
  ['scrub', {class: ['grass'], subclass: ['scrub']}],
  ['wetland', {class: ['wetland']}],
  ['wood', {class: ['wood', 'forest']}],
  ['protected', protectedLandcoverMatch],
  ['urbanPark', {class: ['grass'], subclass: ['park', 'garden']}],
  ['recreationGround', {class: ['grass'], subclass: ['recreation_ground']}],
  ['villageGreen', {class: ['grass'], subclass: ['village_green']}],
  ['flowerbed', {class: ['grass'], subclass: ['flowerbed']}],
] as const satisfies readonly (readonly [TileflowLandcoverClass, TileflowLandcoverClassMatch])[];

export function compileLand(
  request: TileflowLandModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const colors = context.colors;
  const schema = context.data.schema;
  const config = mergeTileflowDesign<TileflowLandModuleConfig>(
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
        railway: {fill: {color: colors.landuse.industrial, minZoom: 8, opacity: 0.62}},
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
          id: 'streets-background',
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

  if (schema.layers.globalLandcover && config.globalLandcover?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-global-landcover',
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
        id: `streets-landuse-${name}`,
        type: 'fill',
        source,
        'source-layer': schema.layers.landuse,
        filter: classFilter(classField, classes),
      },
      style,
    )) {
      contributions.push({
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
    if (name === 'recreation') continue;
    appendLanduse(name, classes);
  }

  for (const [name, match] of landcoverClasses) {
    const style = config.landcover?.[name];
    if (!style) continue;
    const protectedSource = name === 'protected';
    const sourceLayer = protectedSource ? schema.layers.park : schema.layers.landcover;
    const filter =
      protectedSource && schema.semantics.parkLayer === 'protected-only'
        ? undefined
        : landcoverFilter(classField, subclassField, match);
    for (const area of createAreaLayers(
      {
        id: `streets-landcover-${name}`,
        type: 'fill',
        source,
        'source-layer': sourceLayer,
        ...(filter ? {filter} : {}),
      },
      style,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.landcover.${name}.${area.phase}`,
      });
    }
  }

  // Canonical OpenMapTiles historically mixes ordinary parks and protected
  // areas in one layer. Preserve that compatibility branch without exposing
  // the ambiguous legacy class in the public landcover taxonomy.
  if (schema.semantics.parkLayer === 'mixed' && config.landcover?.urbanPark) {
    for (const area of createAreaLayers(
      {
        id: 'streets-landcover-legacy-park',
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

  // Recreation sits above natural and protected landcover so pitches and
  // playgrounds stay legible when their polygons overlap a park or meadow.
  appendLanduse('recreation', landuseClasses.recreation);

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
