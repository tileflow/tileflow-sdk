import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  defineRootMap,
  expression,
  labels,
  land,
  landforms,
  poi,
  roads,
  transit,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  vegetation,
  water,
  zoom,
} from '@tileflow/core';
import {
  addModuleLayer,
  defineModuleEffects,
  semanticField,
  semanticLayer,
} from '@tileflow/core/recipe';
import {ferrarisIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * An original printed-atlas palette: warm paper, iron-gall ink, restrained
 * vegetation, oxidised red buildings, and grey-green water.
 */
const ferrarisPalette = {
  aeroway: '#A79B84',
  boundary: '#8B4D45',
  boundaryMuted: '#9A806B',
  building: '#B85E55',
  buildingActive: '#A94D45',
  buildingOutline: '#743D38',
  farmland: '#C9C49B',
  grass: '#AFB28B',
  halo: '#DDD4BE',
  heath: '#A6A77D',
  ice: '#D6D6C8',
  ink: '#3E352B',
  inkMuted: '#6D604F',
  land: '#D8CFB8',
  meadow: '#B9B893',
  military: '#C4A29A',
  paperBright: '#E4DCC8',
  parking: '#CEC5B1',
  rail: '#55493C',
  recreation: '#ADB184',
  road: '#DCD3BC',
  roadCasing: '#71614F',
  roadMajor: '#CDA66F',
  roadSecondary: '#D4BE96',
  sand: '#D2C292',
  water: '#A4B1A3',
  waterInk: '#536C68',
  wetland: '#A7B29B',
  wood: '#929A70',
} as const;

function ferrarisRoadStyle(
  fillColor: string,
  casingColor: string,
  minZoom: number,
  options: {
    casingOpacity?: number;
    dash?: readonly number[];
    fillOpacity?: number;
    tunnelOpacity?: number;
  } = {},
): TileflowRoadClassStyle {
  const casing = {
    color: casingColor,
    minZoom,
    opacity: options.casingOpacity ?? 0.72,
  };
  const fill = {
    color: fillColor,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.fillOpacity ?? 0.94,
  };

  return {
    bridge: {
      casing: {...casing, opacity: Math.min(1, (options.casingOpacity ?? 0.72) + 0.1)},
      fill,
    },
    surface: {casing, fill},
    tunnel: {
      casing: {...casing, dash: [2, 1.5], opacity: options.tunnelOpacity ?? 0.35},
      fill: {
        ...fill,
        color: ferrarisPalette.paperBright,
        dash: [2, 1.5],
        opacity: options.tunnelOpacity ?? 0.48,
      },
    },
  };
}

function ferrarisPathStyle(
  color: string,
  minZoom: number,
  dash: readonly number[] = [2, 1.5],
): TileflowRoadClassStyle {
  return ferrarisRoadStyle(color, ferrarisPalette.roadCasing, minZoom, {
    casingOpacity: 0.18,
    dash,
    fillOpacity: 0.72,
    tunnelOpacity: 0.28,
  });
}

const ferrarisRoadLabel = {
  placement: 'line',
  priority: 68,
  spacing: 280,
  text: {
    color: ferrarisPalette.ink,
    font: 'Noto Sans Regular',
    haloBlur: 0.35,
    haloColor: ferrarisPalette.halo,
    haloWidth: 1.25,
    letterSpacing: 0.08,
    maxAngle: 28,
    padding: 2,
    size: zoom.linear([
      [11, 9],
      [17, 13],
    ]),
    transform: 'uppercase',
  },
} satisfies TileflowSymbolStyle;

const ferrarisPathLabel = {
  ...ferrarisRoadLabel,
  minZoom: 15,
  priority: 38,
  text: {
    ...ferrarisRoadLabel.text,
    color: ferrarisPalette.inkMuted,
    letterSpacing: 0.04,
    size: zoom.linear([
      [15, 8],
      [18, 11],
    ]),
  },
} satisfies TileflowSymbolStyle;

const landcoverClass = ['get', semanticField('class')];
const landcoverSubclass = ['get', semanticField('subclass')];

function landcoverPattern(
  id: string,
  target: string,
  pattern: string,
  classes: readonly string[],
  options: {
    minZoom?: number;
    opacity?: number;
    subclasses?: readonly string[];
  } = {},
) {
  const classFilter = ['match', landcoverClass, classes, true, false];
  const filter = options.subclasses
    ? ['all', classFilter, ['match', landcoverSubclass, options.subclasses, true, false]]
    : classFilter;

  return addModuleLayer(
    'land',
    `land.effects.pattern.${id}`,
    {
      id: `ferraris-landcover-${id}-pattern`,
      type: 'fill',
      source: 'tileflow',
      'source-layer': semanticLayer('landcover'),
      minzoom: options.minZoom ?? 9,
      filter,
      paint: {
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          options.minZoom ?? 9,
          0,
          (options.minZoom ?? 9) + 1,
          options.opacity ?? 0.72,
        ],
        'fill-pattern': pattern,
      },
    },
    {after: target},
  );
}

function landusePattern(
  id: string,
  target: string,
  pattern: string,
  classes: readonly string[],
  minZoom: number,
  opacity: number,
) {
  return addModuleLayer(
    'land',
    `land.effects.pattern.${id}`,
    {
      id: `ferraris-landuse-${id}-pattern`,
      type: 'fill',
      source: 'tileflow',
      'source-layer': semanticLayer('landuse'),
      minzoom: minZoom,
      filter: ['match', ['get', semanticField('class')], classes, true, false],
      paint: {
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], minZoom, 0, minZoom + 1, opacity],
        'fill-pattern': pattern,
      },
    },
    {after: target},
  );
}

export const ferrarisTheme = defineOfficialTheme({
  id: 'ferraris-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: ferrarisPalette.land,
    boundary: ferrarisPalette.boundary,
    building: ferrarisPalette.building,
    land: ferrarisPalette.land,
    park: ferrarisPalette.wood,
    road: ferrarisPalette.road,
    roadCasing: ferrarisPalette.roadCasing,
    roadMajor: ferrarisPalette.roadMajor,
    text: ferrarisPalette.ink,
    textHalo: ferrarisPalette.halo,
    textMuted: ferrarisPalette.inkMuted,
    water: ferrarisPalette.water,
  },
  modules: {
    boundaries: {
      admin: ferrarisPalette.boundary,
      disputed: '#A84E46',
      major: ferrarisPalette.boundary,
      maritime: ferrarisPalette.waterInk,
    },
    buildings: {
      active: ferrarisPalette.buildingActive,
      businessCorridor: ferrarisPalette.building,
      businessCorridorOutline: ferrarisPalette.buildingOutline,
      civic: '#A84F48',
      commercial: '#B7554E',
      destination: ferrarisPalette.buildingActive,
      extrusion: ferrarisPalette.building,
      fill: ferrarisPalette.building,
      generic: ferrarisPalette.building,
      highRise: '#AC514A',
      highRiseOutline: ferrarisPalette.buildingOutline,
      industrial: '#9D625B',
      lowRise: '#C26A60',
      lowRiseOutline: ferrarisPalette.buildingOutline,
      outline: ferrarisPalette.buildingOutline,
      residential: ferrarisPalette.building,
    },
    hydro: {
      ferry: ferrarisPalette.waterInk,
      label: ferrarisPalette.waterInk,
      water: ferrarisPalette.water,
      waterway: ferrarisPalette.waterInk,
    },
    labels: {
      country: ferrarisPalette.ink,
      halo: ferrarisPalette.halo,
      muted: ferrarisPalette.inkMuted,
      neighborhood: ferrarisPalette.inkMuted,
      poi: ferrarisPalette.ink,
      primary: ferrarisPalette.ink,
      road: ferrarisPalette.ink,
      settlement: ferrarisPalette.ink,
      water: ferrarisPalette.waterInk,
    },
    landcover: {
      farmland: ferrarisPalette.farmland,
      flowerbed: '#B8A87C',
      grass: ferrarisPalette.grass,
      ice: ferrarisPalette.ice,
      meadow: ferrarisPalette.meadow,
      protected: '#A3AA7D',
      recreationGround: ferrarisPalette.recreation,
      rock: '#B9AD97',
      sand: ferrarisPalette.sand,
      scrub: ferrarisPalette.heath,
      urbanPark: '#A2A97A',
      villageGreen: '#A9AE80',
      wetland: ferrarisPalette.wetland,
      wood: ferrarisPalette.wood,
    },
    landuse: {
      cemetery: '#A3AA7C',
      civic: '#D0BBA8',
      commercial: '#CDAE9D',
      education: '#C6BA98',
      government: '#CFB8A7',
      industrial: '#BCA99A',
      medical: '#CEB5A8',
      military: ferrarisPalette.military,
      parking: ferrarisPalette.parking,
      recreation: ferrarisPalette.recreation,
      residential: '#D2C5AE',
    },
    poi: {
      'arts-entertainment': ferrarisPalette.boundary,
      education: ferrarisPalette.inkMuted,
      'food-drink': ferrarisPalette.boundary,
      halo: ferrarisPalette.halo,
      icon: ferrarisPalette.ink,
      label: ferrarisPalette.ink,
      landmark: ferrarisPalette.boundary,
      lodging: ferrarisPalette.boundaryMuted,
      medical: ferrarisPalette.boundary,
      'park-nature': ferrarisPalette.inkMuted,
      'public-services': ferrarisPalette.inkMuted,
      religion: ferrarisPalette.boundary,
      retail: ferrarisPalette.inkMuted,
      'sport-leisure': ferrarisPalette.inkMuted,
      transport: ferrarisPalette.rail,
      'visitor-amenity': ferrarisPalette.inkMuted,
    },
    roads: {
      bridge: ferrarisPalette.roadMajor,
      casing: ferrarisPalette.roadCasing,
      ferry: ferrarisPalette.waterInk,
      minor: ferrarisPalette.road,
      motorway: ferrarisPalette.roadMajor,
      path: ferrarisPalette.inkMuted,
      primary: ferrarisPalette.roadMajor,
      rail: ferrarisPalette.rail,
      secondary: ferrarisPalette.roadSecondary,
      trunk: '#C5A579',
      tunnel: ferrarisPalette.paperBright,
    },
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.035,
    transform: 'uppercase',
    places: {font: 'Noto Sans Bold', letterSpacing: 0.08, transform: 'uppercase'},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.04, transform: 'uppercase'},
    roads: {font: 'Noto Sans Regular', letterSpacing: 0.07, transform: 'uppercase'},
    water: {font: 'Noto Sans Regular', letterSpacing: 0.12, transform: 'uppercase'},
  },
  lighting: {
    anchor: 'viewport',
    color: '#F4E7C8',
    intensity: 0.12,
    position: [1.15, 215, 32],
  },
});

/**
 * A self-contained historical-atlas map. It shares only Tileflow's public
 * Streets compiler contract; it neither imports nor extends the Streets map.
 */
export const ferraris = bindOfficialMapTheme(
  defineRootMap({
    id: 'ferraris',
    version: 1,
    name: 'Ferraris',
    root: {compiler: 'streets', compilerVersion: 1},
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    glyphs: {
      kind: 'url',
      url: 'https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    },
    icons: [ferrarisIcons],
    themes: {light: ferrarisTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: 'none',
    modules: {
      addresses: addresses({
        labels: {
          minZoom: 19,
          text: {
            color: ferrarisPalette.inkMuted,
            font: 'Noto Sans Regular',
            haloColor: ferrarisPalette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
      }),
      aeroways: aeroways({
        area: {
          fill: {color: '#C9BEA8', minZoom: 10, opacity: 0.52},
          outline: {color: ferrarisPalette.aeroway, minZoom: 10, opacity: 0.55, width: 0.7},
        },
        runway: {
          casing: {color: ferrarisPalette.aeroway, minZoom: 10, opacity: 0.55},
          fill: {color: ferrarisPalette.paperBright, minZoom: 10, opacity: 0.72},
        },
        runwayRef: {visible: false},
        taxiway: {
          casing: {color: ferrarisPalette.aeroway, minZoom: 13, opacity: 0.4},
          fill: {color: ferrarisPalette.paperBright, minZoom: 13, opacity: 0.62},
        },
      }),
      boundaries: boundaries({
        admin2: {
          color: ferrarisPalette.boundary,
          dash: [5, 2, 1, 2],
          minZoom: 2,
          opacity: 0.82,
          width: zoom.linear([
            [2, 0.7],
            [10, 1.5],
          ]),
        },
        admin4: {
          color: ferrarisPalette.boundaryMuted,
          dash: [3, 2],
          minZoom: 5,
          opacity: 0.65,
          width: zoom.linear([
            [5, 0.45],
            [12, 1],
          ]),
        },
        disputed: {
          color: '#A84E46',
          dash: [2, 1],
          minZoom: 3,
          opacity: 0.78,
          width: 1.2,
        },
        maritime: {
          color: ferrarisPalette.waterInk,
          dash: [4, 3],
          minZoom: 3,
          opacity: 0.5,
          width: 0.8,
        },
      }),
      buildings: buildings({
        businessCorridor: {
          fill: {visible: false},
          outline: {visible: false},
        },
        flat: {
          fill: {
            color: ferrarisPalette.building,
            minZoom: 13,
            opacity: zoom.linear([
              [13, 0],
              [14, 0.72],
              [16, 0.9],
            ]),
          },
          outline: {
            color: ferrarisPalette.buildingOutline,
            minZoom: 14,
            opacity: 0.82,
            width: zoom.linear([
              [14, 0.35],
              [18, 0.8],
            ]),
          },
        },
        mode: 'flat',
      }),
      labels: labels({
        aerodromeCodes: 'none',
        junctions: false,
        language: 'local',
        places: 'all',
        roads: 'all',
        shields: 'none',
        styles: {
          places: {
            continent: {
              maxZoom: 3.5,
              minZoom: 0,
              text: {
                color: ferrarisPalette.inkMuted,
                font: 'Noto Sans Bold',
                haloColor: ferrarisPalette.halo,
                haloWidth: 1.2,
                letterSpacing: 0.18,
                size: zoom.linear([
                  [0, 10],
                  [3, 15],
                ]),
                transform: 'uppercase',
              },
            },
            country: {
              minZoom: 1,
              text: {
                color: ferrarisPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: ferrarisPalette.halo,
                haloWidth: 1.4,
                letterSpacing: 0.13,
                size: zoom.linear([
                  [1, 10],
                  [7, 18],
                ]),
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 4,
              text: {
                color: ferrarisPalette.ink,
                font: 'Noto Sans Bold',
                haloBlur: 0.4,
                haloColor: ferrarisPalette.halo,
                haloWidth: 1.5,
                letterSpacing: 0.1,
                size: zoom.linear([
                  [4, 12],
                  [13, 20],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 7,
              text: {
                color: ferrarisPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: ferrarisPalette.halo,
                haloWidth: 1.3,
                letterSpacing: 0.07,
                size: zoom.linear([
                  [7, 10],
                  [14, 16],
                ]),
                transform: 'uppercase',
              },
            },
            village: {
              minZoom: 9,
              text: {
                color: ferrarisPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: ferrarisPalette.halo,
                haloWidth: 1.2,
                letterSpacing: 0.06,
                size: zoom.linear([
                  [9, 9],
                  [15, 13],
                ]),
                transform: 'uppercase',
              },
            },
            neighborhood: {
              minZoom: 12,
              text: {
                color: ferrarisPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: ferrarisPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.1,
                size: zoom.linear([
                  [12, 9],
                  [16, 12],
                ]),
                transform: 'uppercase',
              },
            },
          },
          roads: {
            cycleway: ferrarisPathLabel,
            footway: ferrarisPathLabel,
            minor: {...ferrarisRoadLabel, minZoom: 14},
            motorway: {...ferrarisRoadLabel, minZoom: 8},
            pathway: ferrarisPathLabel,
            pedestrian: ferrarisPathLabel,
            primary: {...ferrarisRoadLabel, minZoom: 10},
            secondary: {...ferrarisRoadLabel, minZoom: 11},
            service: {...ferrarisRoadLabel, minZoom: 16},
            steps: ferrarisPathLabel,
            tertiary: {...ferrarisRoadLabel, minZoom: 12},
            track: ferrarisPathLabel,
            trunk: {...ferrarisRoadLabel, minZoom: 9},
          },
          water: {
            ocean: {
              text: {
                color: ferrarisPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: ferrarisPalette.halo,
                haloWidth: 0.8,
                letterSpacing: 0.2,
                size: zoom.linear([
                  [1, 11],
                  [8, 17],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              text: {
                color: ferrarisPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: ferrarisPalette.halo,
                haloWidth: 0.8,
                letterSpacing: 0.12,
                transform: 'uppercase',
              },
            },
            waterway: {
              minZoom: 12,
              text: {
                color: ferrarisPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: ferrarisPalette.halo,
                haloWidth: 0.8,
                letterSpacing: 0.1,
                transform: 'uppercase',
              },
            },
          },
        },
        water: 'all',
      }),
      land: land({
        background: {opacity: 1, pattern: 'ferraris-paper-grain'},
        globalLandcover: {
          color: expression<string>([
            'match',
            ['get', semanticField('class')],
            'barren',
            '#B9AD97',
            'crop',
            ferrarisPalette.farmland,
            'grass',
            ferrarisPalette.grass,
            'shrub',
            ferrarisPalette.heath,
            'snow',
            ferrarisPalette.ice,
            'trees',
            ferrarisPalette.wood,
            'urban',
            '#D2C5AE',
            'rgba(0, 0, 0, 0)',
          ]),
          maxZoom: 10,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.88],
            [7, 0.78],
            [9, 0.3],
            [10, 0],
          ]),
        },
        landcover: {
          farmland: {
            fill: {color: ferrarisPalette.farmland, minZoom: 7, opacity: 0.74},
          },
          flowerbed: {
            fill: {color: '#B8A87C', minZoom: 12, opacity: 0.72},
          },
          grass: {fill: {color: ferrarisPalette.grass, minZoom: 7, opacity: 0.68}},
          ice: {fill: {color: ferrarisPalette.ice, minZoom: 7, opacity: 0.72}},
          meadow: {fill: {color: ferrarisPalette.meadow, minZoom: 7, opacity: 0.68}},
          protected: {fill: {color: '#A3AA7D', minZoom: 7, opacity: 0.42}},
          recreationGround: {
            fill: {color: ferrarisPalette.recreation, minZoom: 9, opacity: 0.62},
          },
          rock: {fill: {color: '#B9AD97', minZoom: 7, opacity: 0.58}},
          sand: {fill: {color: ferrarisPalette.sand, minZoom: 7, opacity: 0.72}},
          scrub: {fill: {color: ferrarisPalette.heath, minZoom: 7, opacity: 0.7}},
          urbanPark: {fill: {color: '#A2A97A', minZoom: 9, opacity: 0.7}},
          villageGreen: {fill: {color: '#A9AE80', minZoom: 10, opacity: 0.68}},
          wetland: {fill: {color: ferrarisPalette.wetland, minZoom: 7, opacity: 0.72}},
          wood: {fill: {color: ferrarisPalette.wood, minZoom: 7, opacity: 0.76}},
        },
        landuse: {
          cemetery: {
            fill: {color: '#A3AA7C', minZoom: 10, opacity: 0.7},
            outline: {color: '#737A58', minZoom: 12, opacity: 0.55, width: 0.6},
          },
          civic: {fill: {color: '#D0BBA8', minZoom: 10, opacity: 0.48}},
          commercial: {fill: {color: '#CDAE9D', minZoom: 10, opacity: 0.42}},
          education: {fill: {color: '#C6BA98', minZoom: 10, opacity: 0.52}},
          government: {fill: {color: '#CFB8A7', minZoom: 10, opacity: 0.48}},
          industrial: {fill: {color: '#BCA99A', minZoom: 10, opacity: 0.5}},
          medical: {fill: {color: '#CEB5A8', minZoom: 11, opacity: 0.48}},
          military: {fill: {color: ferrarisPalette.military, minZoom: 8, opacity: 0.42}},
          parking: {
            fill: {color: ferrarisPalette.parking, minZoom: 15, opacity: 0.55},
            outline: {color: '#9A8D79', minZoom: 16, opacity: 0.5, width: 0.5},
          },
          railway: {fill: {color: '#B8AD9C', minZoom: 11, opacity: 0.42}},
          recreation: {
            fill: {color: ferrarisPalette.recreation, minZoom: 9, opacity: 0.58},
            outline: {color: '#737A58', minZoom: 13, opacity: 0.45, width: 0.6},
          },
          residential: {fill: {color: '#D2C5AE', minZoom: 9, opacity: 0.62}},
        },
      }),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 13,
            text: {
              color: ferrarisPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: ferrarisPalette.halo,
              haloWidth: 1,
              size: 9,
            },
          },
          peak: {
            minZoom: 9,
            text: {
              color: ferrarisPalette.ink,
              font: 'Noto Sans Regular',
              haloColor: ferrarisPalette.halo,
              haloWidth: 1,
              size: zoom.linear([
                [9, 9],
                [15, 12],
              ]),
            },
          },
          volcano: {
            minZoom: 8,
            text: {
              color: ferrarisPalette.boundary,
              font: 'Noto Sans Regular',
              haloColor: ferrarisPalette.halo,
              haloWidth: 1,
              size: 10,
            },
          },
        },
      }),
      poi: poi({enabled: false}),
      roads: roads({
        areas: {
          pedestrian: {
            fill: {color: '#CFBE9E', minZoom: 13, opacity: 0.56},
            outline: {color: ferrarisPalette.roadCasing, minZoom: 14, opacity: 0.42, width: 0.6},
          },
          pier: {
            fill: {color: ferrarisPalette.land, minZoom: 12, opacity: 0.9},
            outline: {color: ferrarisPalette.roadCasing, minZoom: 12, opacity: 0.6, width: 0.7},
          },
          road: {fill: {color: ferrarisPalette.road, minZoom: 13, opacity: 0.72}},
        },
        classes: {
          cycleway: ferrarisPathStyle('#697858', 13, [3, 2]),
          footway: ferrarisPathStyle(ferrarisPalette.inkMuted, 14, [1.5, 1.5]),
          minor: ferrarisRoadStyle(ferrarisPalette.road, ferrarisPalette.roadCasing, 12, {
            casingOpacity: 0.52,
            fillOpacity: 0.9,
          }),
          motorway: ferrarisRoadStyle(ferrarisPalette.roadMajor, '#72513A', 5, {
            casingOpacity: 0.78,
          }),
          pathway: ferrarisPathStyle(ferrarisPalette.inkMuted, 14),
          pedestrian: ferrarisPathStyle('#6F7452', 13, [1, 1.5]),
          primary: ferrarisRoadStyle(ferrarisPalette.roadMajor, '#72513A', 7, {
            casingOpacity: 0.76,
          }),
          secondary: ferrarisRoadStyle(ferrarisPalette.roadSecondary, '#80664B', 9, {
            casingOpacity: 0.68,
          }),
          service: ferrarisRoadStyle(ferrarisPalette.road, ferrarisPalette.roadCasing, 14, {
            casingOpacity: 0.4,
            fillOpacity: 0.82,
          }),
          steps: ferrarisPathStyle(ferrarisPalette.boundaryMuted, 15, [0.25, 0.2]),
          tertiary: ferrarisRoadStyle('#D7C9AB', '#88745D', 10, {
            casingOpacity: 0.6,
            fillOpacity: 0.88,
          }),
          track: ferrarisPathStyle('#8A785E', 13, [3, 2]),
          trunk: ferrarisRoadStyle('#C5A579', '#72513A', 6, {
            casingOpacity: 0.78,
          }),
        },
        detail: 'all',
        extras: {paths: true},
        hierarchy: 'clear',
        modifiers: {
          construction: {
            surface: {
              casing: {dash: [2, 1], opacity: 0.4},
              fill: {dash: [2, 1], opacity: 0.55},
            },
          },
          indoor: {
            surface: {
              casing: {opacity: 0.2},
              fill: {dash: [1, 1], opacity: 0.3},
            },
          },
          unpaved: {
            surface: {
              casing: {dash: [3, 1], opacity: 0.42},
              fill: {dash: [3, 1], opacity: 0.62},
            },
          },
        },
        oneWayMarkers: false,
        outline: 'strong',
        restrictions: {
          access: {
            surface: {
              casing: {dash: [1, 1], opacity: 0.35},
              fill: {dash: [1, 1], opacity: 0.44},
            },
          },
        },
        sidewalks: {
          outline: {color: '#8E7A61', minZoom: 17, opacity: 0.32, width: 0.5},
          surface: {color: '#D1C2A6', minZoom: 17, opacity: 0.58},
        },
        weight: 'thin',
        widthScale: {
          cycleway: 0.72,
          footway: 0.64,
          minor: 0.82,
          motorway: 0.88,
          pathway: 0.62,
          pedestrian: 0.7,
          primary: 0.9,
          secondary: 0.86,
          service: 0.72,
          steps: 0.58,
          tertiary: 0.82,
          track: 0.66,
          trunk: 0.88,
        },
      }),
      transit: transit({
        cableway: {
          color: ferrarisPalette.inkMuted,
          dash: [2, 2],
          minZoom: 10,
          opacity: 0.5,
          width: 0.8,
        },
        ferry: {
          color: ferrarisPalette.waterInk,
          dash: [4, 2],
          minZoom: 5,
          opacity: 0.72,
          width: zoom.linear([
            [5, 0.5],
            [16, 1.8],
          ]),
        },
        rail: {
          bridge: {color: ferrarisPalette.rail, minZoom: 7, opacity: 0.88, width: 1.4},
          surface: {color: ferrarisPalette.rail, minZoom: 7, opacity: 0.82, width: 1.2},
          tunnel: {
            color: ferrarisPalette.rail,
            dash: [2, 1.5],
            minZoom: 9,
            opacity: 0.42,
            width: 1,
          },
        },
        railHatching: {
          bridge: {color: ferrarisPalette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.7},
          surface: {color: ferrarisPalette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.65},
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {color: ferrarisPalette.rail, minZoom: 12, opacity: 0.55, width: 0.8},
          surface: {color: ferrarisPalette.rail, minZoom: 12, opacity: 0.5, width: 0.75},
          tunnel: {
            color: ferrarisPalette.rail,
            dash: [2, 1.5],
            minZoom: 12,
            opacity: 0.3,
            width: 0.7,
          },
        },
      }),
      vegetation: vegetation({
        flat: {
          color: expression<string>([
            'match',
            ['coalesce', ['get', semanticField('leafType')], ''],
            ['needleleaved', 'needleleaf'],
            '#737B55',
            ['broadleaved', 'broadleaf'],
            '#879064',
            ferrarisPalette.wood,
          ]),
          minZoom: 15,
          opacity: 0.76,
          radius: zoom.linear([
            [15, 1.6],
            [19, 4.2],
          ]),
          strokeColor: ferrarisPalette.paperBright,
          strokeOpacity: 0.62,
          strokeWidth: 0.7,
        },
        minZoom: 15,
        mode: 'flat',
      }),
      water: water({
        bathymetry: {
          color: expression<string>([
            'match',
            ['to-number', ['get', semanticField('bathymetryMinDepth')], 0],
            0,
            ferrarisPalette.water,
            -200,
            '#99AAA0',
            -1000,
            '#8E9F97',
            -2000,
            '#83938D',
            -4000,
            '#778782',
            -6000,
            '#6E7D79',
            ferrarisPalette.water,
          ]),
          maxZoom: 9,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.72],
            [7, 0.55],
            [9, 0],
          ]),
        },
        bodies: {
          fill: {color: ferrarisPalette.water, opacity: 0.94},
          outline: {
            color: ferrarisPalette.waterInk,
            minZoom: 5,
            opacity: 0.68,
            width: zoom.linear([
              [5, 0.35],
              [14, 0.8],
              [18, 1.2],
            ]),
          },
        },
        intermittent: {
          bodies: {fill: {color: ferrarisPalette.water, opacity: 0.52}},
          waterways: {
            color: ferrarisPalette.waterInk,
            dash: [3, 2],
            opacity: 0.48,
          },
        },
        waterways: {
          canal: {
            color: ferrarisPalette.waterInk,
            minZoom: 8,
            opacity: 0.9,
            width: zoom.linear([
              [8, 0.35],
              [16, 1.8],
            ]),
          },
          other: {
            color: ferrarisPalette.waterInk,
            minZoom: 12,
            opacity: 0.7,
            width: zoom.linear([
              [12, 0.25],
              [17, 1],
            ]),
          },
          river: {
            color: ferrarisPalette.waterInk,
            minZoom: 6,
            opacity: 0.94,
            width: zoom.linear([
              [6, 0.4],
              [16, 2.2],
            ]),
          },
          stream: {
            color: ferrarisPalette.waterInk,
            minZoom: 10,
            opacity: 0.82,
            width: zoom.linear([
              [10, 0.28],
              [16, 1.2],
            ]),
          },
        },
      }),
    },
    ...defineModuleEffects([
      landcoverPattern(
        'farmland',
        'land.landcover.farmland.fill',
        'ferraris-crop-hatch',
        ['farmland'],
        {minZoom: 8, opacity: 0.82},
      ),
      landcoverPattern('heath', 'land.landcover.scrub.fill', 'ferraris-heath', ['grass'], {
        minZoom: 9,
        opacity: 0.72,
        subclasses: ['scrub'],
      }),
      landcoverPattern('orchard', 'land.landcover.urbanPark.fill', 'ferraris-orchard', ['grass'], {
        minZoom: 11,
        opacity: 0.64,
        subclasses: ['park', 'garden'],
      }),
      landcoverPattern('sand', 'land.landcover.sand.fill', 'ferraris-sand', ['sand', 'beach'], {
        minZoom: 9,
        opacity: 0.72,
      }),
      landcoverPattern('wetland', 'land.landcover.wetland.fill', 'ferraris-wetland', ['wetland'], {
        minZoom: 9,
        opacity: 0.78,
      }),
      landcoverPattern(
        'wood',
        'land.landcover.wood.fill',
        'ferraris-woodland',
        ['wood', 'forest'],
        {
          minZoom: 8,
          opacity: 0.82,
        },
      ),
      landusePattern(
        'residential',
        'land.landuse.residential.fill',
        'ferraris-residential',
        ['residential'],
        11,
        0.5,
      ),
      addModuleLayer(
        'water',
        'water.effects.ripples',
        {
          id: 'ferraris-water-ripples-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 7,
          filter: ['!=', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 0.44, 16, 0.3],
            'fill-pattern': 'ferraris-water-ripples',
          },
        },
        {after: 'water.bodies.fill'},
      ),
      addModuleLayer(
        'water',
        'water.effects.intermittentRipples',
        {
          id: 'ferraris-water-intermittent-ripples-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 9,
          filter: ['==', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {
            'fill-opacity': 0.2,
            'fill-pattern': 'ferraris-water-ripples',
          },
        },
        {after: 'water.intermittent.bodies.fill'},
      ),
      addModuleLayer(
        'buildings',
        'buildings.effects.printShadow',
        {
          id: 'ferraris-building-print-shadow',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('building'),
          minzoom: 14,
          paint: {
            'fill-color': ferrarisPalette.ink,
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.16, 19, 0.22],
            'fill-translate': [1.25, 1.5],
            'fill-translate-anchor': 'viewport',
          },
        },
        {before: 'buildings.flat.fill'},
      ),
    ]),
    view: {
      center: [4.3517, 50.8503],
      pitch: 0,
      bearing: 0,
      zoom: 13.5,
    },
  }),
);
