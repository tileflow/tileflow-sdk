import {
  aeroways,
  boundaries,
  buildings,
  defineMap,
  disable,
  expr,
  field,
  labels,
  land,
  landforms,
  poi,
  renderPass,
  roads,
  type TileflowRenderSelector,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  transit,
  vegetation,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {baedekerFonts, baedekerIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * An original travel-atlas palette informed by Wagner & Debes town plans:
 * warm paper left visibly open, black key ink, fine coral linework, restrained
 * garden stippling, and small accents of engraved cyan water.
 */
const baedekerPalette = {
  aeroway: '#9D735F',
  boundary: '#A95842',
  boundaryMuted: '#BE7A5F',
  building: '#D89270',
  buildingActive: '#B75640',
  buildingOutline: '#B9654A',
  farmland: '#DED0B4',
  grass: '#D5D2B9',
  halo: '#E8DABD',
  hachure: '#5C554A',
  heath: '#D2CEB5',
  ice: '#E7E1D2',
  ink: '#302A27',
  inkMuted: '#665A50',
  land: '#E8DABD',
  meadow: '#D9D3B8',
  military: '#DFC2AD',
  paperBright: '#F2E6CD',
  parking: '#E2D5BE',
  rail: '#211E1D',
  recreation: '#D1D0B6',
  road: '#EEE0C5',
  roadCasing: '#B56D53',
  roadMajor: '#F1E4CA',
  roadSecondary: '#EADDC2',
  sand: '#DFD0AE',
  water: '#9DC8CC',
  waterInk: '#548A95',
  wetland: '#CFD5C3',
  wood: '#CFCEB4',
} as const;

const baedekerRegular = 'Cormorant Garamond Regular';
const baedekerSemibold = 'Cormorant Garamond SemiBold';
const baedekerItalic = 'Cormorant Garamond Italic';

function baedekerRoadStyle(
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
    opacity: options.casingOpacity ?? 0.58,
  };
  const fill = {
    color: fillColor,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.fillOpacity ?? 0.88,
  };

  return {
    bridge: {
      casing: {...casing, opacity: Math.min(1, (options.casingOpacity ?? 0.58) + 0.12)},
      fill,
    },
    surface: {casing, fill},
    tunnel: {
      casing: {...casing, dash: [2, 1.5], opacity: options.tunnelOpacity ?? 0.35},
      fill: {
        ...fill,
        color: baedekerPalette.paperBright,
        dash: [2, 1.5],
        opacity: options.tunnelOpacity ?? 0.32,
      },
    },
  };
}

function baedekerPathStyle(
  color: string,
  minZoom: number,
  dash: readonly number[] = [2, 1.5],
): TileflowRoadClassStyle {
  return baedekerRoadStyle(color, baedekerPalette.roadCasing, minZoom, {
    casingOpacity: 0.16,
    dash,
    fillOpacity: 0.56,
    tunnelOpacity: 0.22,
  });
}

const baedekerRoadLabel = {
  placement: 'line',
  priority: 70,
  spacing: 260,
  text: {
    color: baedekerPalette.ink,
    font: baedekerItalic,
    haloBlur: 0,
    haloColor: baedekerPalette.halo,
    haloWidth: 0.35,
    letterSpacing: 0.015,
    maxAngle: 38,
    padding: 1.5,
    size: zoom.linear([
      [11, 9.5],
      [17, 13.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

const baedekerPathLabel = {
  ...baedekerRoadLabel,
  minZoom: 15,
  priority: 34,
  text: {
    ...baedekerRoadLabel.text,
    color: baedekerPalette.inkMuted,
    letterSpacing: 0.01,
    size: zoom.linear([
      [15, 8],
      [18, 11],
    ]),
  },
} satisfies TileflowSymbolStyle;

function landcoverPattern(
  target: string,
  pattern: string,
  classes: readonly string[],
  options: {
    minZoom?: number;
    opacity?: number;
    subclasses?: readonly string[];
  } = {},
) {
  const classSelector = {
    field: 'class',
    kind: 'in',
    values: classes,
  } as const satisfies TileflowRenderSelector;
  const selector: TileflowRenderSelector = options.subclasses
    ? {
        kind: 'all',
        selectors: [classSelector, {field: 'subclass', kind: 'in', values: options.subclasses}],
      }
    : classSelector;
  const minZoom = options.minZoom ?? 9;

  return renderPass({
    attachTo: target,
    feature: 'landcover',
    phase: 'overlay',
    renderer: 'fill',
    selector,
    style: {
      minZoom,
      opacity: zoom.linear([
        [minZoom, 0],
        [minZoom + 1, options.opacity ?? 0.72],
      ]),
      pattern,
    },
  });
}

function landusePattern(
  target: string,
  pattern: string,
  classes: readonly string[],
  minZoom: number,
  opacity: number,
) {
  return renderPass({
    attachTo: target,
    feature: 'landuse',
    phase: 'overlay',
    renderer: 'fill',
    selector: {field: 'class', kind: 'in', values: classes},
    style: {
      minZoom,
      opacity: zoom.linear([
        [minZoom, 0],
        [minZoom + 1, opacity],
      ]),
      pattern,
    },
  });
}

export const baedekerTheme = defineOfficialTheme({
  id: 'baedeker-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: baedekerPalette.land,
    boundary: baedekerPalette.boundary,
    building: baedekerPalette.building,
    land: baedekerPalette.land,
    park: baedekerPalette.wood,
    road: baedekerPalette.road,
    roadCasing: baedekerPalette.roadCasing,
    roadMajor: baedekerPalette.roadMajor,
    text: baedekerPalette.ink,
    textHalo: baedekerPalette.halo,
    textMuted: baedekerPalette.inkMuted,
    water: baedekerPalette.water,
  },
  modules: {
    boundaries: {
      admin: baedekerPalette.boundary,
      disputed: '#B0543D',
      major: baedekerPalette.boundary,
      maritime: baedekerPalette.waterInk,
    },
    buildings: {
      active: baedekerPalette.buildingActive,
      businessCorridor: baedekerPalette.building,
      businessCorridorOutline: baedekerPalette.buildingOutline,
      civic: '#C77659',
      commercial: '#C97E60',
      destination: baedekerPalette.buildingActive,
      extrusion: baedekerPalette.building,
      fill: baedekerPalette.building,
      generic: baedekerPalette.building,
      highRise: '#C16C50',
      highRiseOutline: baedekerPalette.buildingOutline,
      industrial: '#C48269',
      lowRise: '#D18B69',
      lowRiseOutline: baedekerPalette.buildingOutline,
      outline: baedekerPalette.buildingOutline,
      residential: baedekerPalette.building,
    },
    hydro: {
      ferry: baedekerPalette.waterInk,
      label: baedekerPalette.waterInk,
      water: baedekerPalette.water,
      waterway: baedekerPalette.waterInk,
    },
    labels: {
      country: baedekerPalette.ink,
      halo: baedekerPalette.halo,
      muted: baedekerPalette.inkMuted,
      neighborhood: baedekerPalette.inkMuted,
      poi: baedekerPalette.ink,
      primary: baedekerPalette.ink,
      road: baedekerPalette.ink,
      settlement: baedekerPalette.ink,
      water: baedekerPalette.waterInk,
    },
    landcover: {
      farmland: baedekerPalette.farmland,
      flowerbed: '#D8CCAC',
      grass: baedekerPalette.grass,
      ice: baedekerPalette.ice,
      meadow: baedekerPalette.meadow,
      protected: '#D2D1B7',
      recreationGround: baedekerPalette.recreation,
      rock: '#D8CEB8',
      sand: baedekerPalette.sand,
      scrub: baedekerPalette.heath,
      urbanPark: '#D1D1B8',
      villageGreen: '#D5D4BB',
      wetland: baedekerPalette.wetland,
      wood: baedekerPalette.wood,
    },
    landuse: {
      cemetery: '#D0D0B5',
      civic: '#E2D2BB',
      commercial: '#E3D0BB',
      education: '#DDD2B8',
      government: '#E2CFB9',
      industrial: '#DDD0BE',
      medical: '#E3D0BB',
      military: baedekerPalette.military,
      parking: baedekerPalette.parking,
      recreation: baedekerPalette.recreation,
      residential: '#E4D5BE',
    },
    poi: {
      'arts-entertainment': baedekerPalette.boundary,
      education: baedekerPalette.inkMuted,
      'food-drink': baedekerPalette.boundary,
      halo: baedekerPalette.halo,
      icon: baedekerPalette.ink,
      label: baedekerPalette.ink,
      landmark: baedekerPalette.boundary,
      lodging: baedekerPalette.boundaryMuted,
      medical: baedekerPalette.boundary,
      'park-nature': baedekerPalette.inkMuted,
      'public-services': baedekerPalette.inkMuted,
      religion: baedekerPalette.boundary,
      retail: baedekerPalette.inkMuted,
      'sport-leisure': baedekerPalette.inkMuted,
      transport: baedekerPalette.rail,
      'visitor-amenity': baedekerPalette.inkMuted,
    },
    roads: {
      bridge: baedekerPalette.roadMajor,
      casing: baedekerPalette.roadCasing,
      ferry: baedekerPalette.waterInk,
      minor: baedekerPalette.road,
      motorway: baedekerPalette.roadMajor,
      path: baedekerPalette.inkMuted,
      primary: baedekerPalette.roadMajor,
      rail: baedekerPalette.rail,
      secondary: baedekerPalette.roadSecondary,
      trunk: '#E2C29A',
      tunnel: baedekerPalette.paperBright,
    },
  },
  typography: {
    font: baedekerRegular,
    letterSpacing: 0.018,
    places: {font: baedekerSemibold, letterSpacing: 0.17, transform: 'uppercase'},
    poi: {font: baedekerRegular, letterSpacing: 0.015},
    roads: {font: baedekerItalic, letterSpacing: 0.015},
    water: {font: baedekerItalic, letterSpacing: 0.12, transform: 'none'},
  },
  lighting: {
    anchor: 'viewport',
    color: '#F7E9C9',
    intensity: 0.08,
    position: [1.15, 210, 34],
  },
});

/**
 * A self-contained travel-atlas map inspired by Baedeker town plans. It shares
 * only Tileflow's public semantic compiler contract; it neither imports nor
 * extends another official map and redistributes no historical source image.
 */
export const baedeker = bindOfficialMapTheme(
  defineMap({
    id: 'baedeker',
    version: 1,
    name: 'Baedeker',
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [baedekerFonts],
    icons: [baedekerIcons],
    themes: {light: baedekerTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: {
      attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
      contours: {
        demMaxZoom: 12,
        demUrl: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
        index: {
          color: baedekerPalette.hachure,
          opacity: 0.5,
          width: 0.7,
        },
        labels: {
          color: baedekerPalette.inkMuted,
          font: baedekerRegular,
          haloColor: baedekerPalette.halo,
          haloWidth: 0.55,
          minZoom: 13,
          opacity: 0.58,
          size: 9,
          spacing: 460,
        },
        maxZoom: 14,
        minZoom: 8,
        minor: {
          color: baedekerPalette.hachure,
          opacity: 0.26,
          width: 0.38,
        },
        overzoom: 2,
        sourceId: 'baedeker-contours',
        thresholds: {
          8: [200, 1_000],
          10: [100, 500],
          12: [50, 250],
          14: [25, 100],
        },
      },
      encoding: 'terrarium',
      mode: 'none',
    },
    modules: {
      addresses: disable(),
      aeroways: aeroways({
        area: {
          fill: {color: '#D6CAB2', minZoom: 10, opacity: 0.48},
          outline: {color: baedekerPalette.aeroway, minZoom: 10, opacity: 0.55, width: 0.7},
        },
        runway: {
          casing: {color: baedekerPalette.aeroway, minZoom: 10, opacity: 0.55},
          fill: {color: baedekerPalette.paperBright, minZoom: 10, opacity: 0.72},
        },
        runwayRef: {visible: false},
        taxiway: {
          casing: {color: baedekerPalette.aeroway, minZoom: 13, opacity: 0.4},
          fill: {color: baedekerPalette.paperBright, minZoom: 13, opacity: 0.62},
        },
      }),
      boundaries: boundaries({
        admin2: {
          color: baedekerPalette.boundary,
          dash: [5, 2, 1, 2],
          minZoom: 2,
          opacity: 0.82,
          width: zoom.linear([
            [2, 0.7],
            [10, 1.5],
          ]),
        },
        admin4: {
          color: baedekerPalette.boundaryMuted,
          dash: [3, 2],
          minZoom: 5,
          opacity: 0.65,
          width: zoom.linear([
            [5, 0.45],
            [12, 1],
          ]),
        },
        disputed: {
          color: '#B0543D',
          dash: [2, 1],
          minZoom: 3,
          opacity: 0.78,
          width: 1.2,
        },
        maritime: {
          color: baedekerPalette.waterInk,
          dash: [4, 3],
          minZoom: 3,
          opacity: 0.5,
          width: 0.8,
        },
      }),
      buildings: withRenderStack(
        buildings({
          businessCorridor: {
            fill: {visible: false},
            outline: {visible: false},
          },
          flat: {
            fill: {
              color: baedekerPalette.building,
              minZoom: 13,
              opacity: zoom.linear([
                [13, 0],
                [14, 0.08],
                [16, 0.18],
                [19, 0.24],
              ]),
            },
            outline: {
              color: baedekerPalette.buildingOutline,
              minZoom: 13,
              opacity: zoom.linear([
                [13, 0.42],
                [15, 0.72],
                [18, 0.88],
              ]),
              width: zoom.linear([
                [13, 0.28],
                [16, 0.55],
                [19, 0.78],
              ]),
            },
          },
          mode: 'flat',
        }),
        {
          engravedBlocks: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'overlay',
            renderer: 'fill',
            style: {
              minZoom: 14,
              opacity: zoom.linear([
                [14, 0],
                [15, 0.28],
                [17, 0.48],
                [19, 0.6],
              ]),
              pattern: 'baedeker-residential',
            },
          }),
        },
      ),
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
                color: baedekerPalette.inkMuted,
                font: baedekerSemibold,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.4,
                letterSpacing: 0.28,
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
                color: baedekerPalette.ink,
                font: baedekerSemibold,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.45,
                letterSpacing: 0.24,
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
                color: baedekerPalette.ink,
                font: baedekerSemibold,
                haloBlur: 0,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.42,
                letterSpacing: 0.22,
                size: zoom.linear([
                  [4, 13],
                  [13, 22],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 7,
              text: {
                color: baedekerPalette.ink,
                font: baedekerSemibold,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.4,
                letterSpacing: 0.2,
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
                color: baedekerPalette.inkMuted,
                font: baedekerRegular,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.35,
                letterSpacing: 0.13,
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
                color: baedekerPalette.inkMuted,
                font: baedekerSemibold,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.32,
                letterSpacing: 0.28,
                size: zoom.linear([
                  [12, 10],
                  [16, 14],
                ]),
                transform: 'uppercase',
              },
            },
          },
          roads: {
            cycleway: baedekerPathLabel,
            footway: baedekerPathLabel,
            minor: {...baedekerRoadLabel, minZoom: 14},
            motorway: {...baedekerRoadLabel, minZoom: 8},
            pathway: baedekerPathLabel,
            pedestrian: baedekerPathLabel,
            primary: {...baedekerRoadLabel, minZoom: 10},
            secondary: {...baedekerRoadLabel, minZoom: 11},
            service: {...baedekerRoadLabel, minZoom: 16},
            steps: baedekerPathLabel,
            tertiary: {...baedekerRoadLabel, minZoom: 12},
            track: baedekerPathLabel,
            trunk: {...baedekerRoadLabel, minZoom: 9},
          },
          water: {
            ocean: {
              text: {
                color: baedekerPalette.waterInk,
                font: baedekerItalic,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.3,
                letterSpacing: 0.14,
                size: zoom.linear([
                  [1, 11],
                  [8, 17],
                ]),
                transform: 'none',
              },
            },
            other: {
              minZoom: 14,
              text: {
                color: baedekerPalette.waterInk,
                font: baedekerItalic,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.28,
                letterSpacing: 0.06,
                size: zoom.linear([
                  [14, 8],
                  [18, 11],
                ]),
                transform: 'none',
              },
            },
            waterway: {
              minZoom: 12,
              text: {
                color: baedekerPalette.waterInk,
                font: baedekerItalic,
                haloColor: baedekerPalette.halo,
                haloWidth: 0.28,
                letterSpacing: 0.05,
                size: zoom.linear([
                  [12, 8],
                  [18, 10.5],
                ]),
                transform: 'none',
              },
            },
          },
        },
        water: 'all',
      }),
      land: withRenderStack(
        land({
          background: {opacity: 1, pattern: 'baedeker-paper-grain'},
          globalLandcover: {
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'barren', value: '#D8CEB8'},
                {labels: 'crop', value: baedekerPalette.farmland},
                {labels: 'grass', value: baedekerPalette.grass},
                {labels: 'shrub', value: baedekerPalette.heath},
                {labels: 'snow', value: baedekerPalette.ice},
                {labels: 'trees', value: baedekerPalette.wood},
                {labels: 'urban', value: baedekerPalette.land},
              ],
              'rgba(0, 0, 0, 0)',
            ),
            maxZoom: 10,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.28],
              [6, 0.2],
              [8, 0.08],
              [9, 0],
            ]),
          },
          landcover: {
            farmland: {
              fill: {color: baedekerPalette.farmland, minZoom: 7, opacity: 0.18},
            },
            flowerbed: {
              fill: {color: '#D8CCAC', minZoom: 12, opacity: 0.16},
            },
            grass: {fill: {color: baedekerPalette.grass, minZoom: 7, opacity: 0.12}},
            ice: {fill: {color: baedekerPalette.ice, minZoom: 7, opacity: 0.26}},
            meadow: {fill: {color: baedekerPalette.meadow, minZoom: 7, opacity: 0.12}},
            protected: {fill: {color: '#D2D1B7', minZoom: 7, opacity: 0.08}},
            recreationGround: {
              fill: {color: baedekerPalette.recreation, minZoom: 9, opacity: 0.12},
            },
            rock: {fill: {color: '#D8CEB8', minZoom: 7, opacity: 0.12}},
            sand: {fill: {color: baedekerPalette.sand, minZoom: 7, opacity: 0.18}},
            scrub: {fill: {color: baedekerPalette.heath, minZoom: 7, opacity: 0.1}},
            urbanPark: {
              fill: {color: '#D1D1B8', minZoom: 9, opacity: 0.1},
              outline: {color: '#7F806E', minZoom: 12, opacity: 0.34, width: 0.42},
            },
            villageGreen: {fill: {color: '#D5D4BB', minZoom: 10, opacity: 0.1}},
            wetland: {fill: {color: baedekerPalette.wetland, minZoom: 7, opacity: 0.14}},
            wood: {
              fill: {color: baedekerPalette.wood, minZoom: 7, opacity: 0.12},
              outline: {color: '#777968', minZoom: 11, opacity: 0.28, width: 0.38},
            },
          },
          landuse: {
            cemetery: {
              fill: {color: '#D0D0B5', minZoom: 10, opacity: 0.12},
              outline: {color: '#747867', minZoom: 12, opacity: 0.32, width: 0.45},
            },
            civic: {fill: {color: '#E2D2BB', minZoom: 10, opacity: 0.12}},
            commercial: {fill: {color: '#E3D0BB', minZoom: 10, opacity: 0.12}},
            education: {fill: {color: '#DDD2B8', minZoom: 10, opacity: 0.12}},
            government: {fill: {color: '#E2CFB9', minZoom: 10, opacity: 0.12}},
            industrial: {
              fill: {color: '#DDD0BE', minZoom: 10, opacity: 0.14},
              outline: {
                color: baedekerPalette.boundaryMuted,
                minZoom: 14,
                opacity: 0.24,
                width: 0.36,
              },
            },
            medical: {fill: {color: '#E3D0BB', minZoom: 11, opacity: 0.12}},
            military: {fill: {color: baedekerPalette.military, minZoom: 8, opacity: 0.16}},
            parking: {
              fill: {color: baedekerPalette.parking, minZoom: 15, opacity: 0.08},
              outline: {color: '#9B816F', minZoom: 16, opacity: 0.2, width: 0.35},
            },
            railway: {fill: {color: baedekerPalette.land, minZoom: 11, opacity: 0.08}},
            recreation: {
              fill: {color: baedekerPalette.recreation, minZoom: 9, opacity: 0.1},
              outline: {color: '#747867', minZoom: 13, opacity: 0.3, width: 0.42},
            },
            residential: {fill: {color: '#E4D5BE', minZoom: 9, opacity: 0.08}},
          },
        }),
        {
          rockHachures: landcoverPattern(
            'land.landcover.rock.fill',
            'baedeker-hachures',
            ['rock'],
            {minZoom: 8, opacity: 0.44},
          ),
          scrubHachures: landcoverPattern(
            'land.landcover.scrub.fill',
            'baedeker-hachures',
            ['grass'],
            {minZoom: 9, opacity: 0.34, subclasses: ['scrub']},
          ),
          orchardTexture: landcoverPattern(
            'land.landcover.urbanPark.fill',
            'baedeker-orchard',
            ['grass'],
            {minZoom: 11, opacity: 0.58, subclasses: ['garden', 'orchard']},
          ),
          sandTexture: landcoverPattern(
            'land.landcover.sand.fill',
            'baedeker-sand',
            ['sand', 'beach'],
            {minZoom: 9, opacity: 0.48},
          ),
          wetlandTexture: landcoverPattern(
            'land.landcover.wetland.fill',
            'baedeker-wetland',
            ['wetland'],
            {minZoom: 9, opacity: 0.56},
          ),
          parkStipple: landcoverPattern(
            'land.landcover.urbanPark.fill',
            'baedeker-park-stipple',
            ['grass'],
            {minZoom: 10, opacity: 0.74, subclasses: ['park', 'garden']},
          ),
          woodStipple: landcoverPattern(
            'land.landcover.wood.fill',
            'baedeker-park-stipple',
            ['wood', 'forest'],
            {minZoom: 9, opacity: 0.5},
          ),
          residentialTexture: landusePattern(
            'land.landuse.residential.fill',
            'baedeker-residential',
            ['residential'],
            11,
            0.58,
          ),
        },
      ),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 13,
            text: {
              color: baedekerPalette.inkMuted,
              font: baedekerItalic,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.35,
              size: 9,
            },
          },
          peak: {
            minZoom: 9,
            text: {
              color: baedekerPalette.ink,
              font: baedekerSemibold,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.4,
              size: zoom.linear([
                [9, 9],
                [15, 12],
              ]),
            },
          },
          volcano: {
            minZoom: 8,
            text: {
              color: baedekerPalette.boundary,
              font: baedekerSemibold,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.4,
              size: 10,
            },
          },
        },
      }),
      poi: poi({
        categories: [
          'transport',
          'landmark',
          'lodging',
          'religion',
          'arts-entertainment',
          'public-services',
        ],
        color: 'uniform',
        density: 2,
        icons: false,
        labels: true,
        minZoom: 13,
        placement: {coupleIconAndLabel: false, textPadding: 1},
        styles: {
          transport: {
            text: {
              color: baedekerPalette.ink,
              font: baedekerSemibold,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.3,
              letterSpacing: 0.025,
              maxWidth: 8,
              size: zoom.linear([
                [13, 10],
                [17, 13.5],
              ]),
            },
          },
          landmark: {
            text: {
              color: baedekerPalette.ink,
              font: baedekerSemibold,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.3,
              letterSpacing: 0.02,
              maxWidth: 9,
              size: zoom.linear([
                [13, 9.5],
                [17, 13],
              ]),
            },
          },
          lodging: {
            text: {
              color: baedekerPalette.inkMuted,
              font: baedekerRegular,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.28,
              maxWidth: 8,
            },
          },
          religion: {
            text: {
              color: baedekerPalette.ink,
              font: baedekerRegular,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.28,
              maxWidth: 8,
            },
          },
          'arts-entertainment': {
            text: {
              color: baedekerPalette.ink,
              font: baedekerRegular,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.28,
              maxWidth: 8,
            },
          },
          'public-services': {
            text: {
              color: baedekerPalette.inkMuted,
              font: baedekerRegular,
              haloColor: baedekerPalette.halo,
              haloWidth: 0.28,
              maxWidth: 8,
            },
          },
        },
      }),
      roads: roads({
        areas: {
          pedestrian: {
            fill: {color: baedekerPalette.land, minZoom: 13, opacity: 0.2},
            outline: {color: baedekerPalette.roadCasing, minZoom: 14, opacity: 0.34, width: 0.42},
          },
          pier: {
            fill: {color: baedekerPalette.land, minZoom: 12, opacity: 0.94},
            outline: {color: baedekerPalette.waterInk, minZoom: 12, opacity: 0.62, width: 0.72},
          },
          road: {fill: {color: baedekerPalette.land, minZoom: 13, opacity: 0.24}},
        },
        classes: {
          cycleway: baedekerPathStyle(baedekerPalette.boundaryMuted, 13, [3, 2]),
          footway: baedekerPathStyle(baedekerPalette.boundaryMuted, 14, [1.5, 1.5]),
          minor: baedekerRoadStyle(baedekerPalette.road, baedekerPalette.roadCasing, 12, {
            casingOpacity: 0.5,
            fillOpacity: 0.78,
          }),
          motorway: baedekerRoadStyle(baedekerPalette.roadMajor, baedekerPalette.boundary, 5, {
            casingOpacity: 0.7,
            fillOpacity: 0.84,
          }),
          pathway: baedekerPathStyle(baedekerPalette.boundaryMuted, 14),
          pedestrian: baedekerPathStyle(baedekerPalette.boundaryMuted, 13, [1, 1.5]),
          primary: baedekerRoadStyle(baedekerPalette.roadMajor, baedekerPalette.boundary, 7, {
            casingOpacity: 0.68,
            fillOpacity: 0.84,
          }),
          secondary: baedekerRoadStyle(
            baedekerPalette.roadSecondary,
            baedekerPalette.roadCasing,
            9,
            {
              casingOpacity: 0.6,
              fillOpacity: 0.82,
            },
          ),
          service: baedekerRoadStyle(baedekerPalette.land, baedekerPalette.roadCasing, 14, {
            casingOpacity: 0.32,
            fillOpacity: 0.58,
          }),
          steps: baedekerPathStyle(baedekerPalette.boundaryMuted, 15, [0.25, 0.2]),
          tertiary: baedekerRoadStyle(baedekerPalette.land, baedekerPalette.roadCasing, 10, {
            casingOpacity: 0.54,
            fillOpacity: 0.74,
          }),
          track: baedekerPathStyle(baedekerPalette.boundaryMuted, 13, [3, 2]),
          trunk: baedekerRoadStyle(baedekerPalette.roadMajor, baedekerPalette.boundary, 6, {
            casingOpacity: 0.7,
            fillOpacity: 0.84,
          }),
        },
        detail: 'all',
        extras: {paths: true},
        hierarchy: 'subtle',
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
        outline: 'subtle',
        restrictions: {
          access: {
            surface: {
              casing: {dash: [1, 1], opacity: 0.35},
              fill: {dash: [1, 1], opacity: 0.44},
            },
          },
        },
        sidewalks: {
          outline: {color: baedekerPalette.boundaryMuted, minZoom: 17, opacity: 0.22, width: 0.36},
          surface: {color: baedekerPalette.land, minZoom: 17, opacity: 0.3},
        },
        weight: 'thin',
        widthScale: {
          cycleway: 0.6,
          footway: 0.54,
          minor: 0.68,
          motorway: 0.78,
          pathway: 0.52,
          pedestrian: 0.6,
          primary: 0.76,
          secondary: 0.72,
          service: 0.58,
          steps: 0.48,
          tertiary: 0.68,
          track: 0.56,
          trunk: 0.78,
        },
      }),
      transit: transit({
        cableway: {
          color: baedekerPalette.inkMuted,
          dash: [2, 2],
          minZoom: 10,
          opacity: 0.44,
          width: 0.72,
        },
        ferry: {
          color: baedekerPalette.waterInk,
          dash: [4, 2],
          minZoom: 5,
          opacity: 0.72,
          width: zoom.linear([
            [5, 0.5],
            [16, 1.8],
          ]),
        },
        rail: {
          bridge: {
            color: baedekerPalette.rail,
            minZoom: 6,
            opacity: 1,
            width: zoom.linear([
              [6, 1.7],
              [11, 2.8],
              [15, 4.8],
              [18, 5.8],
            ]),
          },
          surface: {
            color: baedekerPalette.rail,
            minZoom: 6,
            opacity: 0.98,
            width: zoom.linear([
              [6, 1.4],
              [11, 2.4],
              [15, 4.2],
              [18, 5.2],
            ]),
          },
          tunnel: {
            color: baedekerPalette.rail,
            dash: [2, 1.5],
            minZoom: 9,
            opacity: 0.62,
            width: zoom.linear([
              [9, 1.5],
              [15, 3.5],
              [18, 4.5],
            ]),
          },
        },
        railHatching: {
          bridge: {color: baedekerPalette.paperBright, dash: [1, 1.15], minZoom: 10, width: 1.15},
          surface: {color: baedekerPalette.paperBright, dash: [1, 1.15], minZoom: 10, width: 1},
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {color: baedekerPalette.rail, minZoom: 12, opacity: 0.76, width: 1.15},
          surface: {color: baedekerPalette.rail, minZoom: 12, opacity: 0.7, width: 1},
          tunnel: {
            color: baedekerPalette.rail,
            dash: [2, 1.5],
            minZoom: 12,
            opacity: 0.42,
            width: 0.9,
          },
        },
      }),
      vegetation: vegetation({
        flat: {
          color: baedekerPalette.land,
          minZoom: 15,
          opacity: 0.84,
          radius: zoom.linear([
            [15, 1.15],
            [19, 2.35],
          ]),
          strokeColor: '#615F50',
          strokeOpacity: 0.78,
          strokeWidth: 0.8,
        },
        minZoom: 15,
        mode: 'flat',
      }),
      water: withRenderStack(
        water({
          bathymetry: {visible: false},
          bathymetryContours: {visible: false},
          bathymetryLabels: {visible: false},
          bodies: {
            fill: {color: baedekerPalette.water, opacity: 0.82},
            outline: {
              color: baedekerPalette.ink,
              minZoom: 5,
              opacity: 0.72,
              width: zoom.linear([
                [5, 0.4],
                [14, 0.9],
                [18, 1.25],
              ]),
            },
          },
          intermittent: {
            bodies: {fill: {color: baedekerPalette.water, opacity: 0.46}},
            waterways: {
              color: baedekerPalette.waterInk,
              dash: [3, 2],
              opacity: 0.48,
            },
          },
          waterways: {
            canal: {
              color: baedekerPalette.waterInk,
              minZoom: 8,
              opacity: 0.9,
              width: zoom.linear([
                [8, 0.35],
                [16, 1.8],
              ]),
            },
            other: {
              color: baedekerPalette.waterInk,
              minZoom: 12,
              opacity: 0.7,
              width: zoom.linear([
                [12, 0.25],
                [17, 1],
              ]),
            },
            river: {
              color: baedekerPalette.waterInk,
              minZoom: 6,
              opacity: 0.94,
              width: zoom.linear([
                [6, 0.4],
                [16, 2.2],
              ]),
            },
            stream: {
              color: baedekerPalette.waterInk,
              minZoom: 10,
              opacity: 0.82,
              width: zoom.linear([
                [10, 0.28],
                [16, 1.2],
              ]),
            },
          },
        }),
        {
          printLines: renderPass({
            attachTo: 'water.bodies.fill',
            feature: 'water',
            phase: 'overlay',
            renderer: 'fill',
            selector: {
              coerce: 'number',
              fallback: 0,
              field: 'intermittent',
              kind: 'compare',
              operator: 'ne',
              value: 1,
            },
            style: {
              minZoom: 7,
              opacity: zoom.linear([
                [7, 0.42],
                [9, 0.7],
                [16, 0.82],
              ]),
              pattern: 'baedeker-water-lines',
            },
          }),
          intermittentPrintLines: renderPass({
            attachTo: 'water.intermittent.bodies.fill',
            feature: 'water',
            phase: 'overlay',
            renderer: 'fill',
            selector: {
              coerce: 'number',
              fallback: 0,
              field: 'intermittent',
              kind: 'compare',
              operator: 'eq',
              value: 1,
            },
            style: {
              minZoom: 9,
              opacity: 0.36,
              pattern: 'baedeker-water-lines',
            },
          }),
        },
      ),
    },
    view: {
      center: [12.4964, 41.9028],
      pitch: 0,
      bearing: 0,
      zoom: 15.25,
    },
  }),
);
