import type {TileflowColorKnob, TileflowColorKnobOperation} from '@tileflow/core';

/** Every token takes the same operation. */
function tokens(
  names: readonly string[],
  operation: TileflowColorKnobOperation,
): Record<string, TileflowColorKnobOperation> {
  return Object.fromEntries(names.map((name) => [name, operation]));
}

/**
 * The colour knobs of Streets. An application sets a handful of colours, such as its water or its
 * text, and the map works out the rest: tokens that sit lighter or darker than a knob's reference
 * token stay lighter or darker by the same amount, so a road network keeps its hierarchy and a park
 * keeps its variants. A knob not set leaves its tokens as the theme designed them.
 */
export const streetsColorKnobs = {
  water: {
    description: 'Oceans, lakes and rivers, their depth bands and the water labels.',
    reference: 'hydro.water',
    tokens: {
      'hydro.water': 'replace',
      ...tokens(
        [
          'surface.water',
          'hydro.ocean',
          'hydro.waterway',
          'hydro.water.overview',
          'hydro.water.regional',
          'hydro.depth.m0',
          'hydro.depth.m200',
          'hydro.depth.m2000',
          'hydro.depth.m7000',
          'buildings.modelWater',
        ],
        'shift',
      ),
      // Water labels keep their weight against the map and take the water's hue.
      ...tokens(['labels.water', 'hydro.label'], 'tint'),
    },
  },
  greenspace: {
    description: 'Parks, grass, woods and other vegetation, flat and in 3D, and their labels.',
    reference: 'landcover.greenspace',
    tokens: {
      'landcover.greenspace': 'replace',
      ...tokens(
        [
          'surface.park',
          'landcover.grass',
          'landcover.greenspaceDark',
          'landcover.flowerbed',
          'landcover.urbanPark',
          'landcover.recreationGround',
          'landcover.villageGreen',
          'landcover.meadow',
          'landcover.scrub',
          'landcover.wood',
          'landcover.wetland',
          'landcover.hedge',
          'landcover.hedgeShade',
          'landcover.global.grass',
          'landcover.global.trees',
          'landcover.global.shrub',
          'landuse.recreation',
          'landuse.recreationOutline',
          'landuse.cemetery',
          'vegetation.tree.broadleaf.a',
          'vegetation.tree.broadleaf.b',
          'vegetation.tree.broadleaf.c',
          'vegetation.tree.broadleaf.d',
          'vegetation.tree.conifer.a',
          'vegetation.tree.conifer.b',
          'vegetation.tree.conifer.c',
          'vegetation.tree.outline',
          'buildings.modelVegetation',
        ],
        'shift',
      ),
      'poi.park-nature': 'tint',
    },
  },
  land: {
    description: 'The ground between everything else: the background and built-up land.',
    reference: 'surface.land',
    tokens: {
      'surface.land': 'replace',
      ...tokens(
        [
          'surface.background',
          'surface.background.overview',
          'surface.background.transition',
          'landuse.residential',
          'landuse.civic',
          'landuse.government',
          'landuse.military',
          'landcover.global.urban',
        ],
        'shift',
      ),
    },
  },
  buildings: {
    description:
      'Building fills and outlines, flat and extruded, and the surfaces of building models.',
    reference: 'buildings.fill',
    tokens: {
      'buildings.fill': 'replace',
      ...tokens(
        [
          'surface.building',
          'buildings.active',
          'buildings.civic',
          'buildings.commercial',
          'buildings.destination',
          'buildings.extrusion',
          'buildings.generic',
          'buildings.industrial',
          'buildings.residential',
          'buildings.flat.active',
          'buildings.flat.neutral',
          'buildings.raised.neutral',
          'buildings.outline',
          'buildings.flat.activeOutline',
          'buildings.flat.neutralOutline',
        ],
        'shift',
      ),
      ...tokens(
        [
          'buildings.modelSurface',
          'buildings.modelSecondary',
          'buildings.modelAccent',
          'buildings.modelRoof',
        ],
        {amount: 0.6, op: 'shift'},
      ),
    },
  },
  roads: {
    description: 'Roads, their casings and tunnels. Major roads stay stronger than minor ones.',
    reference: 'roads.minor',
    tokens: {
      'roads.minor': 'replace',
      ...tokens(
        [
          'roads.tertiary',
          'roads.secondary',
          'roads.primary',
          'roads.trunk',
          'roads.motorway',
          'roads.major',
          'roads.default',
          'roads.bridge',
          'roads.city.minor',
          'roads.city.tertiary',
          'roads.city.secondary',
          'roads.city.primary',
          'roads.overview.major',
          'roads.overview.majorClose',
          'roads.accessOverview',
          'roads.casing',
          'roads.city.casing',
          'roads.default.casing',
          'roads.detail.casing',
          'roads.motorway.casing',
          'roads.trunk.casing',
          'roads.overview.casing',
          'roads.overview.casingClose',
          'roads.city.tunnelCasing',
          'roads.tunnel',
          'roads.default.tunnel',
          'roads.motorway.tunnel',
          'roads.trunk.tunnel',
          'roads.city.tunnel',
        ],
        'shift',
      ),
    },
  },
  labels: {
    description: 'Place, road and neighbourhood label text. Stronger labels stay stronger.',
    reference: 'labels.primary',
    tokens: {
      'labels.primary': 'replace',
      ...tokens(
        [
          'labels.muted',
          'labels.neighborhood',
          'labels.overview',
          'labels.address',
          'labels.settlement',
          'labels.country',
          'labels.strong',
          'labels.road',
        ],
        'shift',
      ),
    },
  },
  labelHalo: {
    description: 'The outline that keeps labels and icons readable over the map.',
    reference: 'labels.halo',
    tokens: {
      'labels.halo': 'replace',
      ...tokens(
        ['labels.placeHalo', 'labels.roadHalo', 'labels.waterHalo', 'poi.halo', 'boundaries.halo'],
        'shift',
      ),
    },
  },
  accent: {
    description: 'What an application adds to the map: the route, its edge and its glow.',
    reference: 'route.line',
    tokens: {
      'route.line': 'replace',
      'route.glow': 'replace',
      // The edge and the core keep how dark and how pale the theme made them.
      'route.casing': {chroma: 0.7, op: 'tint'},
      'route.core': {chroma: 0.25, op: 'tint'},
    },
  },
} as const satisfies Record<string, TileflowColorKnob>;
