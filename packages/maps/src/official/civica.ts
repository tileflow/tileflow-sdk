import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  defineMap,
  expr,
  field,
  labels,
  land,
  landforms,
  poi,
  refineRenderTarget,
  renderPass,
  roads,
  type TileflowAreaStyle,
  type TileflowPoiCategoryStyle,
  type TileflowRenderSelector,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  token,
  transit,
  vegetation,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {civicaFonts, civicaIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/** Luminous paper, warm stone, slate landmarks, olive gardens, and vermilion accents. */
const ink = {
  paper: '#F7F3E8',
  street: '#FFFDF5',
  type: '#304348',
  quiet: '#506064',
  block: '#E8E0CE',
  building: '#CBCABD',
  edge: '#788887',
  red: '#CF5541',
  redDark: '#9E493C',
  rose: '#E6BBA3',
  olive: '#A8B965',
  grove: '#8FA768',
  greenInk: '#506743',
  meadow: '#B7C985',
  water: '#B4C8D9',
  blue: '#547B94',
  sand: '#E4D3A7',
} as const;
const serif = 'DM Serif Text Regular';
const italic = 'DM Serif Text Italic';
const sans = 'Barlow Semi Condensed Regular';
const bold = 'Barlow Semi Condensed SemiBold';

// These are scale-specific drawings, not one stroke enlarged indefinitely.
function avenue(
  minZoom: number,
  widths: readonly (readonly [number, number])[],
  major = false,
): TileflowRoadClassStyle {
  const fill = {color: ink.street, minZoom, opacity: 1, width: zoom.linear(widths)};
  const casing = {
    visible: major,
    color: major ? ink.redDark : ink.edge,
    minZoom,
    opacity: major ? 0.64 : 0.4,
    width: zoom.linear(widths.map(([z, width]) => [z, width + (major ? 1.1 : 0.55)] as const)),
  };
  return {
    surface: {casing, fill},
    bridge: {casing: {...casing, visible: true, color: ink.type, opacity: 0.5}, fill},
    tunnel: {
      casing: {...casing, dash: [3, 2], opacity: 0.32},
      fill: {...fill, color: ink.paper, opacity: 0.75},
    },
  };
}

function footpath(minZoom: number): TileflowRoadClassStyle {
  const fill = {
    color: ink.street,
    minZoom,
    opacity: 0.85,
    width: zoom.linear([
      [minZoom, 0.65],
      [20, 1.8],
      [22, 3],
    ]),
  };
  return {
    surface: {casing: {visible: false}, fill},
    bridge: {casing: {color: ink.street, width: 2.5, opacity: 0.8}, fill},
    tunnel: {casing: {visible: false}, fill: {...fill, opacity: 0.35}},
  };
}

function wash(color: string, minZoom: number, opacity = 1): TileflowAreaStyle {
  return {fill: {color, minZoom, opacity}, outline: {visible: false}};
}

function place(
  minZoom: number,
  maxZoom: number,
  size: number,
  options: {font?: string; color?: string; tracking?: number} = {},
): TileflowSymbolStyle {
  return {
    minZoom,
    maxZoom,
    text: {
      color: options.color ?? ink.type,
      font: options.font ?? serif,
      fallbacks: [token.font('fallback')],
      haloColor: ink.paper,
      haloWidth: 0.65,
      haloBlur: 0,
      letterSpacing: options.tracking ?? 0.08,
      maxWidth: 10,
      padding: 5,
      size: zoom.linear([
        [minZoom, size],
        [Math.min(maxZoom, minZoom + 6), size + 5],
      ]),
      transform: 'uppercase',
    },
  };
}

function streetName(minZoom: number, major = false): TileflowSymbolStyle {
  return {
    minZoom,
    placement: 'line',
    spacing: major ? 400 : 360,
    text: {
      color: major ? ink.type : ink.quiet,
      font: major ? bold : sans,
      fallbacks: [token.font('fallback')],
      haloColor: ink.street,
      haloWidth: 0.55,
      letterSpacing: major ? 0.12 : 0.045,
      maxAngle: 28,
      padding: 3,
      size: zoom.linear([
        [minZoom, major ? 10.5 : 9.5],
        [Math.max(19, minZoom + 1), major ? 13 : 12],
        [22, 14],
      ]),
      transform: major ? 'uppercase' : 'none',
    },
  };
}

function destination(
  image: string,
  minZoom: number,
  color: string,
  featured = false,
  role: 'caption' | 'park' | 'station' = 'caption',
): TileflowPoiCategoryStyle {
  const park = role === 'park';
  const station = role === 'station';
  const principalPark = expr.lte(expr.toNumber(expr.get(field('poiSizeRank')), 16), 4);
  return {
    minZoom,
    density: featured ? 3 : 2,
    icon: {
      image,
      allowOverlap: false,
      ignorePlacement: false,
      optional: false,
      padding: featured ? 4 : 3,
      size: zoom.linear([
        [minZoom, featured ? 0.8 : 0.66],
        [18, featured ? 0.98 : 0.8],
        [22, 1.05],
      ]),
    },
    text: {
      color,
      font: park ? italic : station ? bold : sans,
      fallbacks: [token.font('fallback')],
      haloColor: ink.paper,
      haloWidth: park ? 0.65 : 0.9,
      letterSpacing: park ? 0.015 : station ? 0.07 : 0.015,
      maxWidth: park ? 9 : featured ? 12 : 10,
      anchor: 'top',
      offset: [0, 1.2],
      optional: false,
      padding: park ? 8 : featured ? 6 : 3,
      size: park
        ? expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [minZoom, expr.case([{when: principalPark, value: 13.5}], 11.5)],
            [18, expr.case([{when: principalPark, value: 18}], 13.5)],
            [22, expr.case([{when: principalPark, value: 20}], 15)],
          ])
        : zoom.linear([
            [minZoom, featured ? 12.5 : 11],
            [18, featured ? 14 : 12],
            [22, 15],
          ]),
      transform: station ? 'uppercase' : 'none',
    },
  };
}

function texture(
  attachTo: string,
  feature: 'landcover' | 'landuse',
  selector: TileflowRenderSelector,
  pattern: string,
  minZoom: number,
  opacity: number,
) {
  return renderPass({
    attachTo,
    feature,
    phase: 'overlay',
    renderer: 'fill',
    selector,
    style: {
      minZoom,
      pattern,
      opacity: zoom.linear([
        [minZoom, 0],
        [minZoom + 1, opacity],
      ]),
    },
  });
}

const buildingTone = expr.coalesce(
  expr.get(field('buildingTone')),
  expr.get(field('buildingKind')),
  'generic',
);
// Semantic destination/civic classification supplies the red plate. Height alone
// never turns an ordinary office tower into a landmark.
const buildingColor = expr.match(
  buildingTone,
  [
    {labels: 'civic', value: ink.red},
    {
      labels: 'destination',
      value: expr.case(
        [
          {
            when: expr.gte(expr.toNumber(expr.get(field('importanceTier')), 0), 3),
            value: ink.red,
          },
          {
            when: expr.gte(expr.toNumber(expr.get(field('importanceTier')), 0), 2),
            value: ink.edge,
          },
        ],
        ink.building,
      ),
    },
    {labels: 'industrial', value: ink.building},
    {labels: ['active', 'commercial'], value: ink.building},
  ],
  ink.building,
);

const destinationCategories = [
  'landmark',
  'arts-entertainment',
  'park-nature',
  'transport',
  'religion',
  'education',
  'public-services',
  'medical',
  'lodging',
  'sport-leisure',
  'food-drink',
  'retail',
  'visitor-amenity',
] as const;

// Narrow the semantic POI deck with real zoom filters so hidden symbols do not
// reserve collision space. Smaller destinations join the atlas as it unfolds.
const destinationSchedule: TileflowRenderSelector = {
  kind: 'step',
  fallback: {kind: 'literal', value: false},
  stops: [12, 13, 14, 15, 16, 17, 18, 20].map((level) => ({
    zoom: level,
    selector: {
      kind: 'all',
      selectors: [
        {
          kind: 'compare',
          field: 'minZoom',
          coerce: 'number',
          fallback: 0,
          operator: 'lte',
          value: level,
        },
        {
          kind: 'compare',
          field: 'poiFilterRank',
          coerce: 'number',
          fallback: 6,
          operator: 'lte',
          value: level < 15 ? 1 : level < 17 ? 2 : 3,
        },
      ],
    },
  })),
};

const civicaTheme = defineOfficialTheme({
  id: 'civica-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: ink.paper,
    boundary: ink.redDark,
    building: ink.building,
    land: ink.paper,
    park: ink.olive,
    road: ink.street,
    roadCasing: ink.edge,
    roadMajor: ink.street,
    text: ink.type,
    textHalo: ink.paper,
    textMuted: ink.quiet,
    water: ink.water,
  },
  modules: {
    buildings: {
      fill: ink.building,
      outline: ink.edge,
      extrusion: ink.building,
      civic: ink.red,
      destination: ink.red,
      active: ink.building,
      commercial: ink.building,
      residential: ink.building,
      generic: ink.building,
      industrial: ink.building,
    },
    hydro: {water: ink.water, waterway: ink.blue, ferry: ink.blue, label: ink.blue},
    labels: {
      primary: ink.type,
      settlement: ink.type,
      country: ink.type,
      muted: ink.quiet,
      neighborhood: ink.quiet,
      road: ink.type,
      water: ink.blue,
      poi: ink.type,
      halo: ink.paper,
    },
    landcover: {
      wood: ink.grove,
      grass: ink.meadow,
      urbanPark: ink.olive,
      farmland: '#DEDBB5',
      meadow: ink.meadow,
      scrub: ink.meadow,
      wetland: ink.meadow,
      ice: '#E3E9DF',
      rock: '#D8D3C3',
      sand: ink.sand,
      protected: ink.meadow,
      recreationGround: ink.olive,
      villageGreen: ink.olive,
      flowerbed: ink.olive,
    },
    landuse: {
      residential: ink.block,
      commercial: ink.block,
      civic: ink.block,
      government: ink.block,
      education: ink.block,
      medical: ink.block,
      industrial: ink.block,
      military: ink.block,
      cemetery: ink.olive,
      parking: ink.block,
      recreation: ink.olive,
    },
    roads: {
      motorway: ink.street,
      trunk: ink.street,
      primary: ink.street,
      secondary: ink.street,
      minor: ink.street,
      casing: ink.edge,
      path: ink.quiet,
      bridge: ink.street,
      tunnel: ink.paper,
      rail: ink.type,
      ferry: ink.blue,
    },
    poi: {
      label: ink.type,
      icon: ink.red,
      halo: ink.paper,
      landmark: ink.redDark,
      'arts-entertainment': ink.redDark,
      'park-nature': ink.greenInk,
      transport: ink.blue,
      'food-drink': ink.quiet,
      retail: ink.quiet,
      lodging: ink.redDark,
      medical: ink.redDark,
      'public-services': ink.type,
      education: ink.type,
      religion: ink.redDark,
      'sport-leisure': ink.greenInk,
      'visitor-amenity': ink.quiet,
    },
  },
  fonts: {fallback: 'Noto Sans Regular'},
  typography: {
    font: sans,
    places: {font: serif, letterSpacing: 0.08, transform: 'uppercase'},
    roads: {font: sans, letterSpacing: 0.025},
    poi: {font: sans, letterSpacing: 0.01},
    water: {font: italic, letterSpacing: 0.12},
  },
  lighting: {anchor: 'viewport', color: ink.paper, intensity: 0.1, position: [1, 180, 45]},
});

/** A complete original root; no existing map definition or artwork is inherited. */
export const civica = bindOfficialMapTheme(
  defineMap({
    id: 'civica',
    name: 'Cívica',
    version: 1,
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [civicaFonts],
    icons: [civicaIcons],
    themes: {light: civicaTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: 'none',
    view: {center: [-77.0365, 38.89], zoom: 13.4, bearing: 0, pitch: 0},
    modules: {
      land: withRenderStack(
        land({
          background: {color: ink.paper},
          globalLandcover: {
            minZoom: 0,
            maxZoom: 10,
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'trees', value: ink.grove},
                {labels: ['grass', 'shrub'], value: ink.meadow},
                {labels: 'crop', value: '#DEDBB5'},
                {labels: 'snow', value: '#E3E9DF'},
                {labels: 'urban', value: ink.block},
                {labels: 'barren', value: ink.sand},
              ],
              ink.paper,
            ),
            opacity: zoom.linear([
              [0, 0.6],
              [6, 0.55],
              [8, 0.35],
              [10, 0],
            ]),
          },
          landcover: {
            wood: wash(ink.grove, 6),
            grass: wash(ink.meadow, 6),
            meadow: wash(ink.meadow, 7),
            farmland: wash('#DEDBB5', 6, 0.72),
            scrub: wash(ink.meadow, 7),
            protected: wash(ink.meadow, 6, 0.2),
            urbanPark: wash(ink.olive, 8),
            recreationGround: wash(ink.olive, 10),
            villageGreen: wash(ink.olive, 10),
            flowerbed: wash(ink.olive, 14),
            sand: wash(ink.sand, 7),
            wetland: wash(ink.meadow, 7, 0.8),
            ice: wash('#E3E9DF', 5),
            rock: wash('#D8D3C3', 7, 0.7),
          },
          landuse: {
            residential: {
              fill: {
                color: ink.block,
                minZoom: 8,
                opacity: zoom.linear([
                  [8, 0.4],
                  [11, 1],
                  [15, 0.95],
                  [18, 0.8],
                ]),
              },
            },
            commercial: wash(ink.block, 10, 0.8),
            civic: wash(ink.block, 10, 0.75),
            government: wash(ink.block, 10, 0.75),
            education: wash(ink.block, 11, 0.85),
            medical: wash(ink.block, 12, 0.8),
            industrial: wash(ink.block, 9, 0.8),
            military: wash(ink.block, 8, 0.75),
            cemetery: wash(ink.olive, 10, 0.9),
            parking: wash(ink.block, 14, 0.75),
            railway: wash(ink.block, 11, 0.8),
            recreation: wash(ink.olive, 10),
          },
        }),
        {
          parkGroves: texture(
            'land.landcover.urbanPark.fill',
            'landcover',
            {
              kind: 'all',
              selectors: [
                {kind: 'in', field: 'class', values: ['grass']},
                {kind: 'in', field: 'subclass', values: ['park', 'garden', 'orchard']},
              ],
            },
            'civica-park-groves',
            19,
            0.18,
          ),
          woodlandGroves: texture(
            'land.landcover.wood.fill',
            'landcover',
            {kind: 'in', field: 'class', values: ['wood', 'forest']},
            'civica-park-groves',
            19,
            0.18,
          ),
          orchardRows: texture(
            'land.landcover.grass.fill',
            'landcover',
            {kind: 'in', field: 'subclass', values: ['orchard', 'vineyard']},
            'civica-orchard',
            19,
            0.2,
          ),
          industrialHatch: texture(
            'land.landuse.industrial.fill',
            'landuse',
            {kind: 'in', field: 'class', values: ['industrial']},
            'civica-industrial-hatch',
            20,
            0.15,
          ),
          paperGrain: renderPass({
            attachTo: 'land.background',
            phase: 'overlay',
            renderer: 'background',
            style: {pattern: 'civica-paper-grain', opacity: 0.12},
          }),
        },
      ),
      water: withRenderStack(
        water({
          bodies: {
            fill: {color: ink.water, opacity: 1},
            outline: {visible: false},
          },
          bathymetry: {visible: false},
          bathymetryContours: {visible: false},
          bathymetryLabels: {visible: false},
          intermittent: {
            bodies: {
              fill: {color: ink.water, opacity: 0.7},
              outline: {visible: false},
            },
            waterways: {color: ink.blue, dash: [3, 2], opacity: 0.55},
          },
          waterways: {
            river: {
              color: ink.blue,
              minZoom: 7,
              width: zoom.linear([
                [7, 0.5],
                [13, 1.4],
                [18, 4],
              ]),
            },
            canal: {
              color: ink.blue,
              minZoom: 10,
              width: zoom.linear([
                [10, 0.6],
                [16, 1.8],
                [20, 4],
              ]),
            },
            stream: {
              color: ink.blue,
              minZoom: 12,
              opacity: 0.75,
              width: zoom.linear([
                [12, 0.5],
                [18, 1.4],
              ]),
            },
            other: {color: ink.blue, minZoom: 13, opacity: 0.65, width: 0.7},
          },
        }),
        {
          waterLines: renderPass({
            attachTo: 'water.bodies.fill',
            feature: 'water',
            phase: 'overlay',
            renderer: 'fill',
            style: {
              pattern: 'civica-water-lines',
              visible: false,
            },
          }),
        },
      ),
      buildings: withRenderStack(
        buildings({
          mode: 'flat',
          businessCorridor: {fill: {visible: false}, outline: {visible: false}},
          flat: {
            fill: {
              color: buildingColor,
              minZoom: 15,
              opacity: zoom.linear([
                [15, 0.85],
                [15.5, 1],
              ]),
            },
            outline: {visible: false},
          },
        }),
        {
          // Core's ordinary building deck begins at z15. This separate plate lets
          // available generalized footprints describe the city at district scales.
          districtFootprints: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'underlay',
            renderer: 'fill',
            selector: {kind: 'geometry', geometry: 'polygon'},
            style: {
              color: buildingColor,
              minZoom: 13,
              maxZoom: 15,
              opacity: zoom.linear([
                [13, 0],
                [14, 0.65],
                [15, 0.85],
              ]),
            },
          }),
        },
      ),
      roads: roads({
        detail: 'all',
        extras: {paths: true},
        hierarchy: 'clear',
        weight: 'regular',
        outline: 'subtle',
        oneWayMarkers: false,
        roundabouts: {casing: {visible: false}},
        structures: {tunnel: {hatch: {visible: false}}},
        classes: {
          motorway: avenue(
            5,
            [
              [5, 0.55],
              [9, 1.8],
              [12, 4.5],
              [15, 8.5],
              [18, 16.5],
              [22, 26],
            ],
            true,
          ),
          trunk: avenue(
            6,
            [
              [6, 0.5],
              [10, 1.8],
              [13, 4.7],
              [16, 9],
              [19, 18],
              [22, 26],
            ],
            true,
          ),
          primary: avenue(7, [
            [7, 0.45],
            [11, 1.8],
            [14, 5.1],
            [17, 10],
            [20, 18],
            [22, 24],
          ]),
          secondary: avenue(9, [
            [9, 0.5],
            [12, 1.7],
            [15, 5.2],
            [18, 10.5],
            [22, 20],
          ]),
          tertiary: avenue(10, [
            [10, 0.4],
            [13, 1.5],
            [16, 4.9],
            [19, 10],
            [22, 17],
          ]),
          minor: avenue(12, [
            [12, 0.7],
            [14, 1.8],
            [16, 4.5],
            [19, 9.5],
            [22, 16],
          ]),
          service: avenue(14, [
            [14, 0.6],
            [17, 2.3],
            [20, 5],
            [22, 8],
          ]),
          pedestrian: avenue(13, [
            [13, 1.1],
            [16, 3.5],
            [19, 7],
            [22, 12],
          ]),
          footway: footpath(17.5),
          pathway: footpath(18),
          cycleway: footpath(17),
          track: footpath(17.5),
          steps: footpath(19),
        },
        areas: {
          pedestrian: wash(ink.street, 13, 0.95),
          road: wash(ink.street, 14, 0.95),
          pier: {
            fill: {color: ink.paper, minZoom: 12},
            outline: {color: ink.blue, minZoom: 12, width: 0.8},
          },
        },
        modifiers: {
          construction: {
            surface: {fill: {color: ink.rose, dash: [3, 2], opacity: 0.8}, casing: {dash: [3, 2]}},
          },
          unpaved: {surface: {fill: {color: ink.paper, dash: [4, 1]}, casing: {opacity: 0.4}}},
          indoor: {surface: {fill: {opacity: 0.5, dash: [2, 1]}, casing: {opacity: 0.2}}},
        },
        restrictions: {access: {surface: {casing: {dash: [1, 2], opacity: 0.5}}}},
        sidewalks: {
          surface: {color: ink.street, minZoom: 20, opacity: 0.7},
          outline: {visible: false},
        },
      }),
      transit: transit({
        rail: {
          surface: {
            color: ink.type,
            minZoom: 7,
            opacity: 0.7,
            width: zoom.linear([
              [7, 0.5],
              [13, 1.1],
              [18, 2.2],
            ]),
          },
          bridge: {
            color: ink.type,
            minZoom: 9,
            width: zoom.linear([
              [9, 0.8],
              [18, 2.5],
            ]),
          },
          tunnel: {color: ink.quiet, minZoom: 18.5, dash: [3, 2], opacity: 0.25, width: 0.8},
        },
        railHatching: {
          surface: {color: ink.paper, minZoom: 11, dash: [1, 3], width: 0.8},
          bridge: {color: ink.paper, minZoom: 11, dash: [1, 3], width: 1},
          tunnel: {visible: false},
        },
        serviceRail: {
          surface: {color: ink.quiet, minZoom: 20, width: 0.65},
          bridge: {color: ink.quiet, minZoom: 20, width: 0.8},
          tunnel: {visible: false},
        },
        ferry: {
          color: ink.blue,
          minZoom: 7,
          dash: [5, 2, 1, 2],
          width: zoom.linear([
            [7, 0.6],
            [16, 1.5],
          ]),
          opacity: 0.8,
        },
        cableway: {color: ink.quiet, minZoom: 12, width: 0.8, dash: [2, 2]},
      }),
      boundaries: boundaries({
        admin2: {
          color: ink.redDark,
          minZoom: 0,
          dash: [6, 2, 1, 2],
          opacity: zoom.linear([
            [0, 0.85],
            [8, 0.65],
            [14, 0.3],
          ]),
          width: zoom.linear([
            [0, 0.6],
            [8, 1.4],
            [16, 1.8],
          ]),
        },
        admin4: {color: ink.quiet, minZoom: 4, dash: [4, 2], opacity: 0.5, width: 0.8},
        disputed: {color: ink.red, minZoom: 2, dash: [2, 2], opacity: 0.7, width: 1},
        maritime: {color: ink.blue, minZoom: 3, dash: [4, 3], opacity: 0.5, width: 0.7},
      }),
      labels: labels({
        language: 'local',
        places: 'all',
        roads: 'all',
        water: 'all',
        shields: 'none',
        junctions: false,
        aerodromeCodes: 'iata',
        collisionPriority: 'balanced',
        styles: {
          aerodrome: {
            minZoom: 9,
            icon: {image: 'civica-poi-airport', size: 0.7, padding: 4},
            text: {
              font: bold,
              color: ink.blue,
              haloColor: ink.paper,
              haloWidth: 1.2,
              size: 10,
              anchor: 'top',
              offset: [0, 1.2],
              letterSpacing: 0.1,
            },
          },
          places: {
            continent: place(0, 4, 13, {tracking: 0.24, color: ink.quiet}),
            country: place(1, 9, 12, {tracking: 0.16}),
            state: place(4, 10, 11, {font: sans, color: ink.quiet, tracking: 0.16}),
            city: place(4, 14, 13),
            town: place(7, 15, 11),
            village: place(9, 16, 10, {tracking: 0.04}),
            neighborhood: place(12, 17, 11, {font: bold, color: ink.quiet, tracking: 0.16}),
            other: place(12, 18, 10, {font: sans, color: ink.quiet, tracking: 0.06}),
          },
          roads: {
            motorway: streetName(9, true),
            trunk: streetName(10, true),
            primary: streetName(11, true),
            secondary: streetName(12, true),
            tertiary: streetName(13),
            minor: streetName(15),
            service: streetName(17),
            pedestrian: streetName(14),
            cycleway: streetName(18),
            footway: streetName(18),
            pathway: streetName(19),
            track: streetName(18),
            steps: streetName(20),
          },
          water: {
            ocean: {
              text: {
                color: ink.blue,
                font: italic,
                fallbacks: [token.font('fallback')],
                haloColor: ink.water,
                haloWidth: 0.7,
                letterSpacing: 0.2,
                size: zoom.linear([
                  [0, 13],
                  [8, 22],
                ]),
              },
            },
            line: {
              minZoom: 6,
              text: {
                color: ink.blue,
                font: italic,
                fallbacks: [token.font('fallback')],
                haloColor: ink.water,
                haloWidth: 0.7,
                letterSpacing: 0.1,
                size: zoom.linear([
                  [6, 11],
                  [16, 18],
                ]),
              },
            },
            waterway: {
              minZoom: 10,
              spacing: 420,
              text: {
                color: ink.blue,
                font: italic,
                fallbacks: [token.font('fallback')],
                haloColor: ink.water,
                haloWidth: 0.7,
                letterSpacing: 0.12,
                maxAngle: 30,
                size: zoom.linear([
                  [10, 11],
                  [16, 15],
                ]),
              },
            },
            other: {
              minZoom: 16,
              text: {
                color: ink.blue,
                font: italic,
                fallbacks: [token.font('fallback')],
                haloColor: ink.water,
                haloWidth: 0.7,
                letterSpacing: 0.07,
                size: 11,
              },
            },
          },
        },
      }),
      poi: withRenderStack(
        poi({
          categories: destinationCategories,
          density: 3,
          minZoom: 12,
          icons: true,
          labels: true,
          placement: {coupleIconAndLabel: true, iconPadding: 3, textPadding: 4},
          styles: {
            landmark: destination('civica-poi-monument', 13, ink.type, true),
            'arts-entertainment': destination('civica-poi-museum', 13.5, ink.type, true),
            'park-nature': destination('civica-poi-garden', 12.5, ink.greenInk, true, 'park'),
            transport: destination('civica-poi-transit', 13.5, ink.blue, true, 'station'),
            religion: destination('civica-poi-civic-star', 15, ink.quiet),
            education: destination('civica-poi-museum', 15, ink.quiet),
            'public-services': destination('civica-poi-civic-star', 15, ink.quiet),
            medical: destination('civica-poi-hospital', 14.5, ink.type, true),
            lodging: destination('civica-poi-lodging', 17.5, ink.quiet),
            'sport-leisure': destination('civica-poi-garden', 16, ink.greenInk),
            'food-drink': destination('civica-poi-food', 17.5, ink.quiet),
            retail: destination('civica-poi-shopping', 17.5, ink.quiet),
            'visitor-amenity': destination('civica-poi-dot', 17.5, ink.quiet),
          },
        }),
        Object.fromEntries(
          destinationCategories.map((category) => [
            `${category.replaceAll('-', '')}Schedule`,
            refineRenderTarget({
              target: `poi.${category}`,
              renderer: 'symbol',
              // Refinements replace the target filter; retain the complete
              // category and valid-rank contract alongside the zoom schedule.
              selector: {
                kind: 'all',
                selectors: [
                  {kind: 'in', field: 'poiCategory', values: [category]},
                  {kind: 'has', field: 'poiFilterRank'},
                  {kind: 'has', field: 'poiSizeRank'},
                  {
                    kind: 'compare',
                    field: 'poiFilterRank',
                    coerce: 'number',
                    fallback: 6,
                    operator: 'lte',
                    value: [
                      'landmark',
                      'arts-entertainment',
                      'park-nature',
                      'transport',
                      'medical',
                    ].includes(category)
                      ? 3
                      : 2,
                  },
                  {
                    kind: 'compare',
                    field: 'poiFilterRank',
                    coerce: 'number',
                    fallback: -1,
                    operator: 'gte',
                    value: 0,
                  },
                  {
                    kind: 'compare',
                    field: 'poiSizeRank',
                    coerce: 'number',
                    fallback: -1,
                    operator: 'gte',
                    value: 0,
                  },
                  {
                    kind: 'compare',
                    field: 'poiSizeRank',
                    coerce: 'number',
                    fallback: 17,
                    operator: 'lte',
                    value: 16,
                  },
                  destinationSchedule,
                  ...(['arts-entertainment', 'education', 'public-services', 'medical'].includes(
                    category,
                  )
                    ? ([
                        {
                          kind: 'step',
                          fallback: {
                            kind: 'any',
                            selectors: [
                              {
                                kind: 'compare',
                                field: 'poiFilterRank',
                                coerce: 'number',
                                operator: 'lte',
                                value: 1,
                              },
                              {
                                kind: 'compare',
                                field: 'poiSizeRank',
                                coerce: 'number',
                                operator: 'lt',
                                value: 16,
                              },
                            ],
                          },
                          stops: [{zoom: 17.5, selector: {kind: 'literal', value: true}}],
                        },
                      ] as const)
                    : []),
                  ...(category === 'transport'
                    ? ([
                        {
                          kind: 'not',
                          selector: {kind: 'in', field: 'poiType', values: ['airport']},
                        },
                        {
                          kind: 'step',
                          fallback: {
                            kind: 'not',
                            selector: {
                              kind: 'in',
                              field: 'poiType',
                              values: ['public_transit_facility'],
                            },
                          },
                          stops: [{zoom: 17.5, selector: {kind: 'literal', value: true}}],
                        },
                      ] as const)
                    : []),
                ],
              },
              style: {},
            }),
          ]),
        ),
      ),
      vegetation: vegetation({
        mode: 'flat',
        minZoom: 19,
        flat: {
          color: ink.greenInk,
          opacity: 0.5,
          radius: zoom.linear([
            [19, 1.2],
            [22, 3],
          ]),
          strokeWidth: 0,
        },
      }),
      aeroways: aeroways({
        area: wash('#CFD2C6', 9, 0.7),
        runway: {
          fill: {color: ink.street, minZoom: 10},
          casing: {color: ink.edge, minZoom: 10, opacity: 0.65},
        },
        taxiway: {
          fill: {color: ink.street, minZoom: 13},
          casing: {color: ink.edge, minZoom: 13, opacity: 0.5},
        },
        runwayRef: {
          minZoom: 14,
          text: {font: bold, color: ink.quiet, size: 9, haloColor: ink.paper, haloWidth: 0.8},
        },
      }),
      landforms: landforms({
        elevation: true,
        classes: {
          peak: {
            minZoom: 14,
            text: {
              font: italic,
              fallbacks: [token.font('fallback')],
              color: ink.quiet,
              haloColor: ink.paper,
              haloWidth: 1,
              size: 12,
            },
          },
          volcano: {
            minZoom: 9,
            text: {
              font: italic,
              fallbacks: [token.font('fallback')],
              color: ink.redDark,
              haloColor: ink.paper,
              haloWidth: 1,
              size: 12,
            },
          },
          cliff: {
            minZoom: 14,
            text: {font: sans, color: ink.quiet, haloColor: ink.paper, haloWidth: 1, size: 10},
          },
        },
      }),
      addresses: addresses({
        labels: {
          minZoom: 20,
          text: {
            color: ink.quiet,
            font: sans,
            haloColor: ink.paper,
            haloWidth: 0.75,
            padding: 2,
            size: zoom.linear([
              [20, 9],
              [22, 11],
            ]),
          },
        },
      }),
    },
  }),
);
