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
import {superTileWorldFonts, superTileWorldIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

// A little cartridge world built from geographic semantics. The deliberately
// limited palette unifies the terrain tiles, level routes, and original sprites.
const c = {
  ink: '#29334F',
  earth: '#875339',
  cliff: '#C2844C',
  grass: '#A8DC73',
  park: '#72C85B',
  forest: '#43A968',
  mint: '#CEE7A1',
  field: '#D6DF86',
  town: '#E9E3AB',
  cream: '#FFF4CC',
  snow: '#E6F8F5',
  water: '#58BCE0',
  deepWater: '#337DAE',
  foam: '#C3F1F4',
  sand: '#F6D77A',
  gold: '#FFD452',
  route: '#FFF0A0',
  orange: '#DDA150',
  roof: '#E9B67A',
  red: '#EA6954',
  blue: '#719FCC',
  purple: '#A48DC6',
  quiet: '#5B6553',
} as const;
const pixel = 'Pixelify Sans Regular';
const bold = 'Pixelify Sans SemiBold';
const title = 'Tile World Arcade Regular';
const fallback = token.font('fallback');

const polygon: TileflowRenderSelector = {kind: 'geometry', geometry: 'polygon'};
const parkSelector: TileflowRenderSelector = {
  kind: 'all',
  selectors: [
    polygon,
    {kind: 'in', field: 'class', values: ['grass']},
    {kind: 'in', field: 'subclass', values: ['park', 'garden']},
  ],
};
const woodSelector: TileflowRenderSelector = {
  kind: 'in',
  field: 'class',
  values: ['wood', 'forest'],
};

function area(color: string, minZoom: number, border = false): TileflowAreaStyle {
  return {
    fill: {color, minZoom},
    outline: border
      ? {
          color: c.earth,
          minZoom,
          width: zoom.linear([
            [minZoom, 0.8],
            [17, 1.8],
            [22, 2.5],
          ]),
          join: 'round',
        }
      : {visible: false},
  };
}

function route(minZoom: number, width: number, major = false): TileflowRoadClassStyle {
  const widths = [
    [minZoom, major ? 1.6 : 0.7],
    [14, width],
    [17, width * 2],
    [22, width * 4],
  ] as const;
  const fill = {
    color: major ? c.gold : c.route,
    minZoom,
    width: zoom.linear(widths),
    cap: 'round' as const,
    join: 'round' as const,
  };
  const casing = {
    color: major ? c.earth : c.orange,
    minZoom,
    width: zoom.linear(widths.map(([z, w]) => [z, w + (major ? 2.4 : 1.4)] as const)),
    cap: 'round' as const,
    join: 'round' as const,
  };
  return {
    surface: {casing, fill},
    bridge: {casing: {...casing, color: c.ink}, fill},
    tunnel: {casing: {...casing, opacity: 0.3}, fill: {...fill, opacity: 0.5, dash: [2, 2]}},
  };
}

function trail(minZoom: number): TileflowRoadClassStyle {
  const fill = {
    color: c.cream,
    minZoom,
    width: zoom.linear([
      [minZoom, 1.4],
      [19, 3],
      [22, 5],
    ]),
    dash: [1, 1.4],
    cap: 'round' as const,
  };
  return {
    surface: {casing: {visible: false}, fill},
    bridge: {casing: {color: c.earth, minZoom, width: 3.5}, fill},
    tunnel: {casing: {visible: false}, fill: {...fill, opacity: 0.4}},
  };
}

function place(
  minZoom: number,
  maxZoom: number,
  size: number,
  headline = false,
  icon?: string,
): TileflowSymbolStyle {
  return {
    minZoom,
    maxZoom,
    ...(icon ? {icon: {image: icon, size: 1.45, anchor: 'bottom' as const, padding: 8}} : {}),
    text: {
      font: headline ? title : bold,
      fallbacks: [fallback],
      color: c.ink,
      haloColor: c.cream,
      haloWidth: headline ? 2 : 1.5,
      haloBlur: 0,
      size: zoom.linear([
        [minZoom, size],
        [maxZoom, size + 3],
      ]),
      transform: 'uppercase',
      maxWidth: 11,
      lineHeight: 1.3,
      letterSpacing: headline ? 0.025 : 0.09,
      padding: headline ? 10 : 6,
      ...(icon ? {anchor: 'top' as const, offset: [0, 0.45] as const} : {}),
    },
  };
}

function roadLabel(minZoom: number, major = false): TileflowSymbolStyle {
  return {
    minZoom,
    placement: 'line',
    spacing: major ? 460 : 360,
    text: {
      font: pixel,
      fallbacks: [fallback],
      color: c.earth,
      haloColor: c.cream,
      haloWidth: 1.2,
      haloBlur: 0,
      size: zoom.linear([
        [minZoom, major ? 13 : 12],
        [22, 17],
      ]),
      letterSpacing: 0.015,
      maxAngle: 25,
      padding: 5,
    },
  };
}

function stop(image: string, minZoom: number, featured = false): TileflowPoiCategoryStyle {
  const park = image === 'stw-hill';
  const principalPark = expr.lte(expr.toNumber(expr.get(field('poiSizeRank')), 16), 2);
  return {
    minZoom,
    density: featured ? 2 : 1,
    icon: {
      image,
      size: park
        ? expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [minZoom, expr.case([{when: principalPark, value: 2.2}], 1.4)],
            [18, expr.case([{when: principalPark, value: 2.8}], 1.8)],
            [22, 3],
          ])
        : zoom.linear([
            [minZoom, featured ? 1.6 : 1.05],
            [Math.max(18, minZoom + 1), featured ? 1.9 : 1.35],
            [22, 2.1],
          ]),
      anchor: 'bottom',
      allowOverlap: false,
      ignorePlacement: false,
      optional: false,
      padding: featured ? 9 : 7,
    },
    text: {
      font: featured ? bold : pixel,
      fallbacks: [fallback],
      color: c.ink,
      haloColor: c.cream,
      haloWidth: 1.25,
      haloBlur: 0,
      size: park
        ? expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [minZoom, expr.case([{when: principalPark, value: 19}], 14)],
            [18, expr.case([{when: principalPark, value: 24}], 17)],
            [22, 25],
          ])
        : zoom.linear([
            [minZoom, featured ? 15 : 13],
            [Math.max(18, minZoom + 1), featured ? 18 : 15],
            [22, 19],
          ]),
      anchor: 'top',
      offset: [0, 0.45],
      maxWidth: park ? 11 : featured ? 10 : 9,
      lineHeight: 1.05,
      letterSpacing: 0.005,
      padding: featured ? 8 : 5,
      optional: false,
    },
  };
}

const categories = [
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
const featuredCategories: readonly string[] = [
  'landmark',
  'arts-entertainment',
  'park-nature',
  'transport',
];

const tone = expr.coalesce(
  expr.get(field('buildingTone')),
  expr.get(field('buildingKind')),
  'generic',
);
const roofColor = expr.match(
  tone,
  [
    {labels: 'civic', value: c.red},
    {
      labels: 'destination',
      value: expr.case(
        [{when: expr.gte(expr.toNumber(expr.get(field('importanceTier')), 0), 2), value: c.purple}],
        c.roof,
      ),
    },
    {labels: ['commercial', 'active'], value: c.orange},
    {labels: 'industrial', value: c.blue},
  ],
  c.roof,
);

const theme = defineOfficialTheme({
  id: 'super-tile-world-day',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: c.grass,
    boundary: c.forest,
    building: c.roof,
    land: c.grass,
    park: c.park,
    road: c.route,
    roadCasing: c.earth,
    roadMajor: c.gold,
    text: c.ink,
    textHalo: c.cream,
    textMuted: c.quiet,
    water: c.water,
  },
  fonts: {fallback: 'Noto Sans Regular'},
  typography: {
    font: pixel,
    places: {font: title},
    roads: {font: pixel},
    poi: {font: bold},
    water: {font: pixel},
  },
  lighting: {anchor: 'viewport', color: c.cream, intensity: 0.1, position: [1, 180, 45]},
});

/** Original fan-inspired cartridge atlas. Every drawing is owned by this root. */
export const superTileWorld = bindOfficialMapTheme(
  defineMap({
    id: 'super-tile-world',
    name: 'Super Tile World',
    version: 1,
    data: {
      type: 'tileflow-world',
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
    },
    icons: [superTileWorldIcons],
    fonts: [superTileWorldFonts],
    themes: {light: theme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: 'none',
    view: {center: [-3.6875, 40.4167], zoom: 14.5, pitch: 0, bearing: 0},
    modules: {
      land: withRenderStack(
        land({
          background: {color: c.grass},
          globalLandcover: {
            minZoom: 0,
            maxZoom: 10,
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'trees', value: c.forest},
                {labels: 'crop', value: c.field},
                {labels: 'snow', value: c.snow},
                {labels: 'urban', value: c.town},
                {labels: 'barren', value: c.sand},
              ],
              c.grass,
            ),
            opacity: zoom.linear([
              [0, 0.9],
              [7, 0.9],
              [10, 0.25],
            ]),
          },
          landcover: {
            wood: area(c.forest, 5),
            grass: area(c.grass, 5),
            meadow: area(c.mint, 7),
            farmland: area(c.field, 6),
            scrub: area(c.mint, 7),
            protected: {fill: {visible: false}, outline: {visible: false}},
            urbanPark: area(c.park, 9, true),
            recreationGround: area(c.park, 11, true),
            villageGreen: area(c.park, 11),
            flowerbed: area(c.red, 17),
            sand: area(c.sand, 6),
            wetland: area('#8DCCA8', 7),
            ice: area(c.snow, 4),
            rock: area(c.purple, 7),
          },
          landuse: {
            residential: area(c.town, 9),
            commercial: area(c.town, 10),
            civic: area(c.town, 10),
            government: area(c.town, 10),
            education: area(c.town, 11),
            medical: area(c.town, 12),
            industrial: area('#C2D4B8', 10),
            military: area(c.town, 10),
            cemetery: area('#A4B5A0', 11),
            parking: area(c.town, 15),
            railway: area(c.town, 12),
            recreation: area(c.park, 11),
          },
        }),
        {
          worldTufts: renderPass({
            attachTo: 'land.background',
            phase: 'overlay',
            renderer: 'background',
            style: {pattern: 'stw-grass', opacity: 0.45},
          }),
          parkCliff: renderPass({
            attachTo: 'land.landcover.urbanPark.fill',
            feature: 'landcover',
            phase: 'underlay',
            renderer: 'fill',
            selector: parkSelector,
            style: {color: c.cliff, minZoom: 11, translate: [0, 5], translateAnchor: 'viewport'},
          }),
          parkCliffEdge: renderPass({
            attachTo: 'land.render.parkCliff',
            feature: 'landcover',
            phase: 'underlay',
            renderer: 'line',
            selector: parkSelector,
            style: {
              color: c.earth,
              minZoom: 11,
              translate: [0, 5],
              translateAnchor: 'viewport',
              width: 2,
              join: 'round',
            },
          }),
          parkGarden: renderPass({
            attachTo: 'land.landcover.urbanPark.fill',
            feature: 'landcover',
            phase: 'overlay',
            renderer: 'fill',
            selector: parkSelector,
            style: {pattern: 'stw-meadow', minZoom: 11, opacity: 0.8},
          }),
          forestCanopy: renderPass({
            attachTo: 'land.landcover.wood.fill',
            feature: 'landcover',
            phase: 'overlay',
            renderer: 'fill',
            selector: woodSelector,
            style: {pattern: 'stw-forest', minZoom: 8, opacity: 0.85},
          }),
          farmTiles: renderPass({
            attachTo: 'land.landcover.farmland.fill',
            feature: 'landcover',
            phase: 'overlay',
            renderer: 'fill',
            selector: {kind: 'in', field: 'class', values: ['farmland']},
            style: {pattern: 'stw-farmland', minZoom: 8, opacity: 0.5},
          }),
          sandPixels: renderPass({
            attachTo: 'land.landcover.sand.fill',
            feature: 'landcover',
            phase: 'overlay',
            renderer: 'fill',
            selector: {kind: 'in', field: 'class', values: ['sand']},
            style: {pattern: 'stw-sand', minZoom: 7, opacity: 0.6},
          }),
        },
      ),
      water: withRenderStack(
        water({
          bodies: {fill: {color: c.water}, outline: {color: c.deepWater, width: 1.5}},
          bathymetry: {visible: false},
          bathymetryContours: {visible: false},
          bathymetryLabels: {visible: false},
          intermittent: {
            bodies: {
              fill: {color: c.water, opacity: 0.65},
              outline: {color: c.deepWater, dash: [2, 2], width: 1},
            },
            waterways: {color: c.water, dash: [2, 2]},
          },
          waterways: {
            river: {
              color: c.water,
              minZoom: 7,
              width: zoom.linear([
                [7, 1.5],
                [14, 5],
                [20, 12],
              ]),
            },
            canal: {
              color: c.water,
              minZoom: 11,
              width: zoom.linear([
                [11, 1.8],
                [18, 5],
                [22, 9],
              ]),
            },
            stream: {
              color: c.water,
              minZoom: 13,
              width: zoom.linear([
                [13, 1],
                [20, 3],
              ]),
            },
            other: {color: c.water, minZoom: 15, width: 1.2},
          },
        }),
        {
          coastInk: renderPass({
            attachTo: 'water.bodies.fill',
            feature: 'water',
            phase: 'underlay',
            renderer: 'line',
            selector: polygon,
            style: {
              color: c.earth,
              width: zoom.linear([
                [0, 2],
                [7, 5],
                [13, 9],
                [20, 12],
              ]),
              join: 'round',
            },
          }),
          coastSand: renderPass({
            attachTo: 'water.render.coastInk',
            feature: 'water',
            phase: 'overlay',
            renderer: 'line',
            selector: polygon,
            style: {
              color: c.sand,
              width: zoom.linear([
                [0, 1],
                [7, 3],
                [13, 6],
                [20, 9],
              ]),
              join: 'round',
            },
          }),
          waves: renderPass({
            attachTo: 'water.bodies.fill',
            feature: 'water',
            phase: 'overlay',
            renderer: 'fill',
            selector: polygon,
            style: {pattern: 'stw-water', opacity: 0.85},
          }),
        },
      ),
      buildings: withRenderStack(
        buildings({
          mode: 'flat',
          businessCorridor: {fill: {visible: false}, outline: {visible: false}},
          flat: {
            fill: {
              color: roofColor,
              minZoom: 15,
              opacity: zoom.linear([
                [15, 0.3],
                [16.5, 1],
              ]),
            },
            outline: {
              color: c.earth,
              minZoom: 16,
              width: zoom.linear([
                [16, 0.8],
                [19, 1.4],
                [22, 2],
              ]),
            },
          },
        }),
        {
          districtBlocks: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'underlay',
            renderer: 'fill',
            selector: polygon,
            style: {
              color: roofColor,
              minZoom: 13.5,
              maxZoom: 15,
              opacity: zoom.linear([
                [13.5, 0],
                [15, 0.3],
              ]),
            },
          }),
          platformSides: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'underlay',
            renderer: 'fill',
            selector: polygon,
            style: {color: c.earth, minZoom: 16, translate: [2, 3], translateAnchor: 'viewport'},
          }),
          brickRoofs: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'overlay',
            renderer: 'fill',
            selector: polygon,
            style: {
              pattern: 'stw-brick',
              minZoom: 17,
              opacity: zoom.linear([
                [17, 0],
                [18, 0.28],
                [22, 0.4],
              ]),
            },
          }),
        },
      ),
      roads: withRenderStack(
        roads({
          detail: 'all',
          extras: {paths: true},
          hierarchy: 'clear',
          weight: 'regular',
          outline: 'subtle',
          oneWayMarkers: false,
          roundabouts: {casing: {visible: false}},
          structures: {tunnel: {hatch: {visible: false}}},
          classes: {
            motorway: route(6, 5, true),
            trunk: route(7, 4.5, true),
            primary: route(9, 3.7, true),
            secondary: route(11, 3),
            tertiary: route(12, 2.3),
            minor: route(13, 1.8),
            service: route(13.9, 1),
            pedestrian: route(13, 2.6),
            footway: trail(17),
            pathway: trail(17.5),
            cycleway: trail(17),
            track: trail(17),
            steps: trail(18),
          },
          areas: {
            pedestrian: area(c.route, 14),
            road: area(c.route, 16),
            pier: area(c.cliff, 12, true),
          },
          sidewalks: {surface: {visible: false}, outline: {visible: false}},
        }),
        {
          levelDots: renderPass({
            attachTo: 'roads.classes.primary.surface.fill',
            feature: 'road',
            phase: 'overlay',
            renderer: 'line',
            selector: {
              kind: 'all',
              selectors: [
                {kind: 'in', field: 'class', values: ['primary', 'trunk', 'motorway']},
                {kind: 'not', selector: {kind: 'in', field: 'brunnel', values: ['tunnel']}},
              ],
            },
            style: {
              color: c.cream,
              width: zoom.linear([
                [8, 2],
                [13, 3.8],
              ]),
              minZoom: 8,
              maxZoom: 14,
              dash: [0.08, 3.5],
              cap: 'round',
            },
          }),
          coinTrail: renderPass({
            attachTo: 'roads.classes.pedestrian.surface.fill',
            feature: 'road',
            phase: 'overlay',
            renderer: 'symbol',
            selector: {
              kind: 'all',
              selectors: [
                {kind: 'in', field: 'class', values: ['path', 'pedestrian']},
                {kind: 'not', selector: {kind: 'in', field: 'subclass', values: ['steps']}},
              ],
            },
            style: {
              minZoom: 16.5,
              maxZoom: 20,
              placement: 'line',
              spacing: 220,
              icon: {
                image: 'stw-coin',
                size: 0.75,
                padding: 10,
                rotationAlignment: 'viewport',
                allowOverlap: false,
                ignorePlacement: false,
              },
            },
          }),
        },
      ),
      transit: transit({
        rail: {
          surface: {
            color: c.earth,
            minZoom: 10,
            width: zoom.linear([
              [10, 2],
              [18, 4],
            ]),
          },
          bridge: {color: c.ink, minZoom: 12, width: 4},
          tunnel: {visible: false},
        },
        railHatching: {
          surface: {color: c.cream, minZoom: 11, width: 1.2, dash: [1, 2]},
          bridge: {color: c.cream, minZoom: 12, width: 1.5, dash: [1, 2]},
          tunnel: {visible: false},
        },
        serviceRail: {
          surface: {visible: false},
          bridge: {visible: false},
          tunnel: {visible: false},
        },
        ferry: {color: c.cream, minZoom: 7, width: 2, dash: [1, 2], cap: 'round'},
        cableway: {color: c.earth, minZoom: 13, width: 1.5, dash: [2, 2]},
      }),
      boundaries: boundaries({
        admin2: {color: c.forest, minZoom: 0, maxZoom: 9, width: 1, dash: [2, 3], opacity: 0.5},
        admin4: {visible: false},
        disputed: {color: c.purple, width: 1, dash: [1, 3], maxZoom: 8},
        maritime: {visible: false},
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
          places: {
            continent: place(0, 3.5, 11, true),
            country: place(2, 7, 11, true),
            state: place(5, 10, 14),
            city: place(5, 13, 12, true, 'stw-castle'),
            town: place(8, 14, 14, false, 'stw-mushroom-house'),
            village: place(10, 15, 13, false, 'stw-level-node'),
            neighborhood: place(12.5, 16, 15),
            other: place(15, 18, 14),
          },
          roads: {
            motorway: roadLabel(12, true),
            trunk: roadLabel(13, true),
            primary: roadLabel(14, true),
            secondary: roadLabel(15, true),
            tertiary: roadLabel(16),
            minor: roadLabel(17),
            service: roadLabel(19),
            pedestrian: roadLabel(16),
            footway: roadLabel(19),
            pathway: roadLabel(20),
            cycleway: roadLabel(19),
            track: roadLabel(18),
            steps: roadLabel(20),
          },
          water: {
            ocean: {
              text: {
                font: title,
                fallbacks: [fallback],
                color: c.cream,
                haloColor: c.deepWater,
                haloWidth: 2,
                size: zoom.linear([
                  [0, 11],
                  [8, 17],
                ]),
                letterSpacing: 0.05,
              },
            },
            line: {
              minZoom: 8,
              text: {
                font: bold,
                fallbacks: [fallback],
                color: c.deepWater,
                haloColor: c.foam,
                haloWidth: 1.5,
                size: 16,
              },
            },
            waterway: {
              minZoom: 13,
              spacing: 450,
              text: {
                font: pixel,
                fallbacks: [fallback],
                color: c.deepWater,
                haloColor: c.foam,
                haloWidth: 1.2,
                size: 15,
              },
            },
            other: {
              minZoom: 16,
              text: {
                font: pixel,
                fallbacks: [fallback],
                color: c.deepWater,
                haloColor: c.foam,
                haloWidth: 1,
                size: 13,
              },
            },
          },
          aerodrome: {
            minZoom: 10,
            icon: {image: 'stw-airship', size: 1, anchor: 'bottom'},
            text: {
              font: bold,
              fallbacks: [fallback],
              color: c.ink,
              haloColor: c.cream,
              haloWidth: 2,
              anchor: 'top',
              offset: [0, 0.5],
              size: 15,
            },
          },
        },
      }),
      poi: withRenderStack(
        poi({
          categories,
          minZoom: 12,
          density: 2,
          icons: true,
          labels: true,
          placement: {coupleIconAndLabel: true, iconPadding: 8, textPadding: 7},
          styles: {
            landmark: stop('stw-castle', 13, true),
            'arts-entertainment': stop('stw-star', 14, true),
            'park-nature': stop('stw-hill', 12.5, true),
            transport: stop('stw-warp-pipe', 14, true),
            religion: stop('stw-ghost-house', 16),
            education: stop('stw-book', 16),
            'public-services': stop('stw-flag', 16),
            medical: stop('stw-heart', 15),
            lodging: stop('stw-mushroom-house', 17),
            'sport-leisure': stop('stw-flower', 16),
            'food-drink': stop('stw-mushroom', 17),
            retail: stop('stw-question-block', 17),
            'visitor-amenity': stop('stw-level-node', 18),
          },
        }),
        Object.fromEntries(
          categories.map((category) => [
            `${category.replaceAll('-', '')}Eligibility`,
            refineRenderTarget({
              target: `poi.${category}`,
              renderer: 'symbol',
              style: {},
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
                    fallback: -1,
                    operator: 'gte',
                    value: 0,
                  },
                  {
                    kind: 'step',
                    fallback: {
                      kind: 'compare',
                      field: 'poiFilterRank',
                      coerce: 'number',
                      fallback: 6,
                      operator: 'lte',
                      value: featuredCategories.includes(category) ? 2 : 1,
                    },
                    stops: [
                      {
                        zoom: 17,
                        selector: {
                          kind: 'compare',
                          field: 'poiFilterRank',
                          coerce: 'number',
                          fallback: 6,
                          operator: 'lte',
                          value: 3,
                        },
                      },
                      {
                        zoom: 18,
                        selector: {
                          kind: 'compare',
                          field: 'poiFilterRank',
                          coerce: 'number',
                          fallback: 6,
                          operator: 'lte',
                          value: 5,
                        },
                      },
                    ],
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
                  {
                    kind: 'step',
                    fallback: {kind: 'literal', value: false},
                    stops: [12, 12.5, 13, 14, 15, 16, 17, 18, 19, 20, 22].map((level) => ({
                      zoom: level,
                      selector: {
                        kind: 'compare',
                        field: 'minZoom',
                        coerce: 'number',
                        fallback: 0,
                        operator: 'lte',
                        value: level,
                      },
                    })),
                  },
                  ...(category === 'transport'
                    ? [
                        {
                          kind: 'not',
                          selector: {kind: 'in', field: 'poiType', values: ['airport']},
                        } as const,
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
                          stops: [{zoom: 18, selector: {kind: 'literal', value: true}}],
                        } as const,
                      ]
                    : []),
                  ...(category === 'arts-entertainment'
                    ? [
                        {
                          kind: 'step',
                          fallback: {
                            kind: 'any',
                            selectors: [
                              {
                                kind: 'compare',
                                field: 'poiFilterRank',
                                coerce: 'number',
                                fallback: 6,
                                operator: 'lte',
                                value: 1,
                              },
                              {
                                kind: 'compare',
                                field: 'poiSizeRank',
                                coerce: 'number',
                                fallback: 17,
                                operator: 'lt',
                                value: 16,
                              },
                            ],
                          },
                          stops: [{zoom: 17, selector: {kind: 'literal', value: true}}],
                        } as const,
                      ]
                    : []),
                ],
              },
            }),
          ]),
        ),
      ),
      vegetation: withRenderStack(
        vegetation({mode: 'flat', minZoom: 17, flat: {opacity: 0, strokeOpacity: 0}}),
        {
          pixelTrees: renderPass({
            attachTo: 'vegetation.trees',
            requirements: ['vegetation'],
            phase: 'overlay',
            renderer: 'symbol',
            style: {
              minZoom: 17,
              zOrder: 'viewport-y',
              icon: {
                image: 'stw-tree',
                size: zoom.linear([
                  [17, 0.85],
                  [20, 1.5],
                  [22, 1.9],
                ]),
                anchor: 'bottom',
                padding: 3,
                allowOverlap: false,
                ignorePlacement: false,
              },
            },
          }),
        },
      ),
      aeroways: aeroways({
        area: area(c.mint, 9),
        runway: {fill: {color: c.cream, minZoom: 11}, casing: {color: c.earth, minZoom: 11}},
        taxiway: {fill: {color: c.gold, minZoom: 14}, casing: {color: c.earth, minZoom: 14}},
        runwayRef: {
          minZoom: 15,
          text: {font: pixel, color: c.ink, haloColor: c.cream, haloWidth: 1, size: 13},
        },
      }),
      landforms: landforms({
        elevation: false,
        classes: {
          peak: {
            minZoom: 14,
            icon: {image: 'stw-hill', size: 0.95, anchor: 'bottom'},
            text: {
              font: bold,
              fallbacks: [fallback],
              color: c.ink,
              haloColor: c.cream,
              haloWidth: 1.5,
              size: 15,
              anchor: 'top',
              offset: [0, 0.4],
            },
          },
          volcano: {
            minZoom: 8,
            icon: {image: 'stw-castle', size: 1.1, anchor: 'bottom'},
            text: {
              font: bold,
              fallbacks: [fallback],
              color: c.ink,
              haloColor: c.cream,
              haloWidth: 1.5,
              size: 16,
              anchor: 'top',
            },
          },
          cliff: {
            minZoom: 17,
            text: {font: pixel, color: c.earth, haloColor: c.cream, haloWidth: 1, size: 13},
          },
        },
      }),
      addresses: addresses({
        labels: {
          minZoom: 20,
          text: {font: pixel, color: c.earth, haloColor: c.cream, haloWidth: 1, size: 12},
        },
      }),
    },
  }),
);
