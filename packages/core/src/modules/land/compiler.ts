import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyBackgroundStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowLandcoverClass, TileflowLandModuleConfig, TileflowLanduseClass} from './index';

const landuseClasses: Record<TileflowLanduseClass, readonly string[]> = {
  cemetery: ['cemetery'],
  civic: ['community_centre', 'place_of_worship', 'social_facility'],
  commercial: ['commercial', 'retail'],
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

// `scrub` has no dedicated top-level `class` value in the source data — it
// only ever appears as `class: 'grass', subclass: 'scrub'` — so it needs a
// subclass filter on top of the class filter to separate it from plain grass.
const landcoverClasses: Record<TileflowLandcoverClass, TileflowLandcoverClassMatch> = {
  farmland: {class: ['farmland']},
  grass: {class: ['grass'], excludeSubclass: ['scrub']},
  ice: {class: ['ice', 'glacier']},
  park: {class: ['park']},
  protected: {class: ['protected_area']},
  rock: {class: ['rock']},
  sand: {class: ['sand', 'beach']},
  scrub: {class: ['grass'], subclass: ['scrub']},
  wetland: {class: ['wetland']},
  wood: {class: ['wood', 'forest']},
};

export function compileLand(
  request: TileflowLandModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const colors = context.colors;
  const config = mergeTileflowDesign<TileflowLandModuleConfig>(
    {
      type: 'land',
      enabled: true,
      background: {color: colors.background},
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
        grass: {fill: {color: colors.landcover.grass, minZoom: 8, opacity: 0.88}},
        ice: {fill: {color: colors.landcover.ice, minZoom: 8, opacity: 0.88}},
        park: {fill: {color: colors.landcover.park, minZoom: 8, opacity: 0.78}},
        protected: {fill: {color: colors.landcover.protected, minZoom: 8, opacity: 0.88}},
        rock: {fill: {color: colors.landcover.rock, minZoom: 8, opacity: 0.85}},
        sand: {fill: {color: colors.landcover.sand, minZoom: 8, opacity: 0.88}},
        scrub: {fill: {color: colors.landcover.protected, minZoom: 8, opacity: 0.88}},
        wetland: {fill: {color: colors.landcover.wetland, minZoom: 8, opacity: 0.82}},
        wood: {fill: {color: colors.landcover.wood, minZoom: 8, opacity: 0.88}},
      },
    },
    request,
  );

  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const schema = context.data.schema;
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

  if (schema.layers.globalLandcover) {
    contributions.push({
      kind: 'layer',
      layer: {
        id: 'streets-global-landcover',
        type: 'fill',
        source,
        'source-layer': schema.layers.globalLandcover,
        minzoom: 0,
        maxzoom: 8,
        paint: {
          'fill-color': [
            'match',
            ['get', classField],
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
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.88, 6, 0.82, 7, 0.68, 8, 0],
        },
      },
      localOrder: 10,
      owner: 'land',
      slot: 'land',
      target: 'land.globalLandcover',
    });
  }

  let localOrder = 100;
  for (const [name, classes] of Object.entries(landuseClasses) as Array<
    [TileflowLanduseClass, readonly string[]]
  >) {
    const style = config.landuse?.[name];
    if (!style) continue;
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
  }

  for (const [name, match] of Object.entries(landcoverClasses) as Array<
    [TileflowLandcoverClass, TileflowLandcoverClassMatch]
  >) {
    const style = config.landcover?.[name];
    if (!style) continue;
    // OpenMapTiles keeps both ordinary parks and protected areas in the `park`
    // source layer.  Most other land-cover classes live in `landcover`.
    const parkSource = name === 'park' || name === 'protected';
    const sourceLayer = parkSource ? schema.layers.park : schema.layers.landcover;
    const filter =
      name === 'park'
        ? ['!', classFilter(classField, landcoverClasses.protected.class)]
        : landcoverFilter(classField, subclassField, match);
    for (const area of createAreaLayers(
      {
        id: `streets-landcover-${name}`,
        type: 'fill',
        source,
        'source-layer': sourceLayer,
        filter,
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
