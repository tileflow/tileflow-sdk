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
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  type TileflowThemeImageValue,
  transit,
  vegetation,
  water,
  zoom,
} from '@tileflow/core';
import {
  addModuleLayer,
  defineModuleEffects,
  patchModuleLayer,
  semanticField,
  semanticLayer,
} from '@tileflow/core/recipe';
import {siegfriedFonts, siegfriedIcons} from '../assets';
import {siegfriedThemes, siegfriedVisual} from './siegfried-themes';
import {bindOfficialMapTheme} from './theme-helpers';

/**
 * Material references keep the historical three-ink grammar explicit while
 * allowing each theme to choose its own paper stock and engraved artwork.
 */
const siegfriedPalette = {
  blue: siegfriedVisual.color.hydro,
  brown: siegfriedVisual.color.contour,
  ink: siegfriedVisual.color.ink,
  paper: siegfriedVisual.color.paper,
} as const;

const regularFont = siegfriedVisual.font.regular;
const semiboldFont = siegfriedVisual.font.semibold;
const italicFont = siegfriedVisual.font.italic;

function engravedRoad(
  minZoom: number,
  options: {
    casingOpacity?: number;
    fillOpacity?: number;
    tunnelOpacity?: number;
  } = {},
): TileflowRoadClassStyle {
  const casing = {
    color: siegfriedPalette.ink,
    minZoom,
    opacity: options.casingOpacity ?? 0.88,
  };
  const fill = {
    color: siegfriedPalette.paper,
    minZoom,
    opacity: options.fillOpacity ?? 0.98,
  };
  const tunnelOpacity = options.tunnelOpacity ?? 0.46;

  return {
    bridge: {
      casing: {...casing, opacity: 0.96},
      fill,
    },
    surface: {casing, fill},
    tunnel: {
      casing: {...casing, dash: [2, 1.5], opacity: tunnelOpacity},
      fill: {...fill, dash: [2, 1.5], opacity: tunnelOpacity * 0.72},
    },
  };
}

function engravedPath(
  minZoom: number,
  dash: readonly number[],
  opacity = 0.7,
): TileflowRoadClassStyle {
  const line = {
    color: siegfriedPalette.ink,
    dash,
    minZoom,
    opacity,
  };

  return {
    bridge: {casing: {visible: false}, fill: {...line, opacity: Math.min(1, opacity + 0.1)}},
    surface: {casing: {visible: false}, fill: line},
    tunnel: {casing: {visible: false}, fill: {...line, opacity: opacity * 0.46}},
  };
}

const roadLabel = {
  placement: 'line',
  priority: 58,
  spacing: 360,
  text: {
    color: siegfriedPalette.ink,
    font: semiboldFont,
    haloBlur: 0.15,
    haloColor: siegfriedPalette.paper,
    haloWidth: 1,
    letterSpacing: 0.04,
    maxAngle: 24,
    padding: 3,
    size: zoom.linear([
      [10, 9.25],
      [13, 10.25],
      [17, 12.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

const pathLabel = {
  ...roadLabel,
  minZoom: 16,
  priority: 26,
  spacing: 460,
  text: {
    ...roadLabel.text,
    font: italicFont,
    size: zoom.linear([
      [16, 8],
      [19, 10.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

const terrainLabel = {
  minZoom: 10,
  priority: 44,
  text: {
    color: siegfriedPalette.ink,
    font: italicFont,
    haloBlur: 0.15,
    haloColor: siegfriedPalette.paper,
    haloWidth: 0.65,
    letterSpacing: 0.16,
    size: zoom.linear([
      [10, 9],
      [16, 12.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

const landcoverClass = ['get', semanticField('class')];
const landcoverSubclass = ['get', semanticField('subclass')];
const landformName = ['coalesce', ['get', semanticField('name')], ''];
const landformElevation = ['get', semanticField('elevation')];
const landformLabelWithoutUnit = [
  'case',
  ['has', semanticField('elevation')],
  ['concat', landformName, '\n', ['to-string', landformElevation]],
  landformName,
];

function omitLandformElevationUnit(
  landformClass: 'arete' | 'cliff' | 'peak' | 'ridge' | 'saddle' | 'volcano',
) {
  return patchModuleLayer('landforms', `landforms.classes.${landformClass}`, {
    layout: {'text-field': landformLabelWithoutUnit},
  });
}

function landcoverFilter(
  classes: readonly string[],
  options: {
    excludeSubclasses?: readonly string[];
    subclasses?: readonly string[];
  } = {},
) {
  const classFilter = ['match', landcoverClass, classes, true, false];
  const filters: unknown[] = [classFilter];
  if (options.subclasses) {
    filters.push(['match', landcoverSubclass, options.subclasses, true, false]);
  }
  if (options.excludeSubclasses) {
    filters.push(['match', landcoverSubclass, options.excludeSubclasses, false, true]);
  }
  return filters.length === 1 ? classFilter : ['all', ...filters];
}

function landcoverPattern(
  id: string,
  target: string,
  pattern: TileflowThemeImageValue,
  classes: readonly string[],
  options: {
    excludeSubclasses?: readonly string[];
    minZoom?: number;
    opacity?: number;
    subclasses?: readonly string[];
  } = {},
) {
  const filter = landcoverFilter(classes, options);

  return addModuleLayer(
    'land',
    `land.effects.pattern.${id}`,
    {
      id: `siegfried-landcover-${id}-pattern`,
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
          (options.minZoom ?? 9) + 2,
          options.opacity ?? 0.74,
        ],
        'fill-pattern': pattern,
      },
    },
    {after: target},
  );
}

/**
 * Rock and scree are redrawn after contours so brown relief ink does not show
 * through areas that the historical atlas engraved in key black.
 */
function postContourLandcoverPattern(
  id: 'rock' | 'scree',
  target: string,
  pattern: TileflowThemeImageValue,
  classes: readonly string[],
  options: {
    excludeSubclasses?: readonly string[];
    minZoom: number;
    opacity: number;
    subclasses?: readonly string[];
  },
) {
  return addModuleLayer(
    'water',
    `water.effects.${id}Pattern`,
    {
      id: `siegfried-landcover-${id}-pattern`,
      type: 'fill',
      source: 'tileflow',
      'source-layer': semanticLayer('landcover'),
      minzoom: options.minZoom,
      filter: landcoverFilter(classes, options),
      paint: {
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          options.minZoom,
          0,
          options.minZoom + 2,
          options.opacity,
        ],
        'fill-pattern': pattern,
      },
    },
    {after: target},
    {requires: ['land']},
  );
}

/**
 * An independent terrain atlas inspired by the Swiss Siegfried Map. It uses
 * Tileflow's public semantic compiler, but imports neither the Streets map nor
 * any Streets assets. Elevation is expressed by contours rather than hillshade.
 */
export const siegfried = bindOfficialMapTheme(
  defineRootMap({
    id: 'siegfried',
    version: 1,
    name: 'Siegfried',
    root: {compiler: 'streets', compilerVersion: 1},
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [siegfriedFonts],
    icons: [siegfriedIcons],
    themes: siegfriedThemes,
    defaultTheme: 'light',
    systemThemes: {light: 'light', dark: 'dark'},
    projection: 'mercator',
    terrain: {
      attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
      contours: {
        demMaxZoom: 12,
        demUrl: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
        index: {
          color: siegfriedPalette.brown,
          opacity: 0.86,
          width: 0.92,
        },
        labels: {
          color: siegfriedPalette.brown,
          font: italicFont,
          haloColor: siegfriedPalette.paper,
          haloWidth: 0.6,
          minZoom: 13,
          opacity: 0.86,
          size: 10,
          spacing: 380,
        },
        maxZoom: 14,
        minZoom: 8,
        minor: {
          color: siegfriedPalette.brown,
          opacity: 0.56,
          width: 0.44,
        },
        overzoom: 2,
        sourceId: 'siegfried-contours',
        thresholds: {
          8: [200, 1_000],
          10: [100, 500],
          12: [30, 300],
          // Alpine sheets used a 30 m equidistance. Keeping that cadence at
          // large zoom avoids a non-historical threefold density jump.
          14: [30, 300],
        },
      },
      encoding: 'terrarium',
      mode: 'none',
    },
    modules: {
      addresses: addresses({enabled: false}),
      aeroways: aeroways({enabled: false}),
      boundaries: boundaries({
        admin2: {
          color: siegfriedPalette.ink,
          dash: [1, 1.6, 5, 1.6],
          minZoom: 3,
          opacity: 0.72,
          width: zoom.linear([
            [3, 0.55],
            [13, 1.05],
          ]),
        },
        admin4: {
          color: siegfriedPalette.ink,
          dash: [1, 2.2],
          minZoom: 7,
          opacity: 0.58,
          width: zoom.linear([
            [7, 0.4],
            [15, 0.75],
          ]),
        },
        disputed: {
          color: siegfriedPalette.ink,
          dash: [3, 2],
          minZoom: 4,
          opacity: 0.58,
          width: 0.8,
        },
        maritime: {
          color: siegfriedPalette.blue,
          dash: [3, 3],
          minZoom: 4,
          opacity: 0.5,
          width: 0.65,
        },
      }),
      buildings: buildings({
        businessCorridor: {
          fill: {visible: false},
          outline: {visible: false},
        },
        flat: {
          fill: {
            color: siegfriedPalette.ink,
            minZoom: 13,
            opacity: zoom.linear([
              [13, 0],
              [14, 0.9],
              [16, 1],
            ]),
          },
          outline: {
            color: siegfriedPalette.ink,
            minZoom: 14,
            opacity: 0.92,
            width: 0.45,
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
          aerodrome: {
            minZoom: 9,
            text: {
              color: siegfriedPalette.ink,
              font: semiboldFont,
              haloBlur: 0.15,
              haloColor: siegfriedPalette.paper,
              haloWidth: 1.2,
              letterSpacing: 0.055,
              lineHeight: 1.05,
              maxWidth: 11,
              size: zoom.linear([
                [9, 11],
                [16, 14.5],
              ]),
            },
          },
          places: {
            continent: {
              maxZoom: 4,
              minZoom: 0,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1,
                letterSpacing: 0.2,
                size: zoom.linear([
                  [0, 11],
                  [4, 16],
                ]),
                transform: 'uppercase',
              },
            },
            country: {
              minZoom: 1,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1,
                letterSpacing: 0.16,
                size: zoom.linear([
                  [1, 11],
                  [8, 19],
                ]),
                transform: 'uppercase',
              },
            },
            state: {
              minZoom: 5,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1,
                letterSpacing: 0.14,
                size: zoom.linear([
                  [5, 10],
                  [10, 14],
                ]),
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 4,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloBlur: 0.2,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1.1,
                letterSpacing: 0.12,
                size: zoom.linear([
                  [4, 12],
                  [14, 21],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 7,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1.1,
                letterSpacing: 0.08,
                size: zoom.linear([
                  [7, 11],
                  [15, 16.5],
                ]),
                transform: 'uppercase',
              },
            },
            village: {
              minZoom: 9,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 1.05,
                letterSpacing: 0.05,
                size: zoom.linear([
                  [9, 10.75],
                  [16, 14.25],
                ]),
              },
            },
            neighborhood: {
              minZoom: 12,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.95,
                letterSpacing: 0.08,
                size: zoom.linear([
                  [12, 9],
                  [17, 12],
                ]),
              },
            },
            other: {
              minZoom: 11,
              text: {
                color: siegfriedPalette.ink,
                font: semiboldFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.9,
                letterSpacing: 0.04,
                size: zoom.linear([
                  [11, 9],
                  [17, 12],
                ]),
              },
            },
          },
          roads: {
            cycleway: pathLabel,
            footway: pathLabel,
            minor: {...roadLabel, minZoom: 15},
            motorway: {...roadLabel, minZoom: 10},
            pathway: pathLabel,
            pedestrian: pathLabel,
            primary: {...roadLabel, minZoom: 11},
            secondary: {...roadLabel, minZoom: 12},
            service: {...roadLabel, minZoom: 17},
            steps: pathLabel,
            tertiary: {...roadLabel, minZoom: 13},
            track: pathLabel,
            trunk: {...roadLabel, minZoom: 10},
          },
          water: {
            line: {
              minZoom: 9,
              placement: 'line',
              spacing: 380,
              text: {
                color: siegfriedPalette.ink,
                font: italicFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.75,
                letterSpacing: 0.08,
                size: 11,
              },
            },
            ocean: {
              text: {
                color: siegfriedPalette.ink,
                font: italicFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.7,
                letterSpacing: 0.22,
                size: zoom.linear([
                  [1, 12],
                  [8, 18],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              text: {
                color: siegfriedPalette.ink,
                font: italicFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.7,
                letterSpacing: 0.12,
                size: zoom.linear([
                  [7, 10],
                  [15, 14],
                ]),
              },
            },
            waterway: {
              minZoom: 11,
              text: {
                color: siegfriedPalette.ink,
                font: italicFont,
                haloColor: siegfriedPalette.paper,
                haloWidth: 0.7,
                letterSpacing: 0.08,
                size: zoom.linear([
                  [11, 9],
                  [17, 12],
                ]),
              },
            },
          },
        },
        water: 'all',
      }),
      land: land({
        background: {opacity: 1, pattern: siegfriedVisual.pattern['paper-grain']},
        globalLandcover: {visible: false},
        landcover: {
          farmland: {
            fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.12},
            outline: {color: siegfriedPalette.brown, minZoom: 13, opacity: 0.26, width: 0.38},
          },
          flowerbed: {fill: {color: siegfriedPalette.paper, minZoom: 13, opacity: 0.1}},
          grass: {fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.08}},
          ice: {
            fill: {color: siegfriedPalette.paper, minZoom: 7, opacity: 0.98},
            outline: {color: siegfriedPalette.blue, minZoom: 9, opacity: 0.62, width: 0.65},
          },
          meadow: {fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.08}},
          protected: {fill: {visible: false}},
          recreationGround: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.08}},
          rock: {
            fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.96},
            outline: {color: siegfriedPalette.ink, minZoom: 10, opacity: 0.62, width: 0.48},
          },
          sand: {fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.94}},
          scrub: {fill: {color: siegfriedPalette.paper, minZoom: 9, opacity: 0.1}},
          urbanPark: {fill: {color: siegfriedPalette.paper, minZoom: 10, opacity: 0.08}},
          villageGreen: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.08}},
          wetland: {fill: {color: siegfriedPalette.paper, minZoom: 8, opacity: 0.96}},
          wood: {
            fill: {color: siegfriedPalette.paper, minZoom: 7, opacity: 0.98},
            outline: {color: siegfriedPalette.ink, minZoom: 10, opacity: 0.55, width: 0.52},
          },
        },
        landuse: {
          cemetery: {
            fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.12},
            outline: {color: siegfriedPalette.ink, minZoom: 13, opacity: 0.42, width: 0.42},
          },
          civic: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.1}},
          commercial: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.08}},
          education: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.1}},
          government: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.1}},
          industrial: {
            fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.1},
            outline: {color: siegfriedPalette.ink, minZoom: 14, opacity: 0.3, width: 0.38},
          },
          medical: {fill: {color: siegfriedPalette.paper, minZoom: 12, opacity: 0.1}},
          military: {fill: {visible: false}},
          parking: {fill: {visible: false}, outline: {visible: false}},
          railway: {fill: {color: siegfriedPalette.paper, minZoom: 12, opacity: 0.12}},
          recreation: {fill: {color: siegfriedPalette.paper, minZoom: 11, opacity: 0.08}},
          residential: {fill: {color: siegfriedPalette.paper, minZoom: 10, opacity: 0.06}},
        },
      }),
      landforms: landforms({
        classes: {
          arete: terrainLabel,
          cliff: {...terrainLabel, minZoom: 13},
          peak: {
            ...terrainLabel,
            minZoom: 9,
            priority: 64,
            text: {
              ...terrainLabel.text,
              font: semiboldFont,
              haloWidth: 0.6,
              letterSpacing: 0.1,
              size: expression<number>([
                'interpolate',
                ['linear'],
                ['to-number', landformElevation, 0],
                0,
                10,
                2_500,
                11.5,
                4_000,
                15,
                4_500,
                16.5,
              ]),
            },
          },
          ridge: terrainLabel,
          saddle: {...terrainLabel, minZoom: 11},
          volcano: {...terrainLabel, minZoom: 8, priority: 62},
        },
        elevation: true,
      }),
      poi: poi({enabled: false}),
      roads: roads({
        areas: {
          pedestrian: {
            fill: {color: siegfriedPalette.paper, minZoom: 14, opacity: 0.92},
            outline: {color: siegfriedPalette.ink, minZoom: 15, opacity: 0.45, width: 0.42},
          },
          pier: {
            fill: {color: siegfriedPalette.paper, minZoom: 12, opacity: 1},
            outline: {color: siegfriedPalette.ink, minZoom: 12, opacity: 0.72, width: 0.6},
          },
          road: {fill: {color: siegfriedPalette.paper, minZoom: 14, opacity: 0.9}},
        },
        classes: {
          cycleway: engravedPath(15, [3, 2], 0.52),
          footway: engravedPath(15, [0.45, 1.25], 0.68),
          minor: engravedRoad(12, {casingOpacity: 0.72}),
          motorway: engravedRoad(6, {casingOpacity: 0.92}),
          pathway: engravedPath(14, [1.2, 1.5], 0.68),
          pedestrian: engravedPath(15, [0.45, 1.25], 0.58),
          primary: engravedRoad(8, {casingOpacity: 0.9}),
          secondary: engravedRoad(9, {casingOpacity: 0.84}),
          service: engravedRoad(14, {casingOpacity: 0.58, fillOpacity: 0.9}),
          steps: engravedPath(16, [0.25, 0.55], 0.62),
          tertiary: engravedRoad(11, {casingOpacity: 0.78}),
          track: engravedPath(13, [3, 1.6], 0.72),
          trunk: engravedRoad(7, {casingOpacity: 0.92}),
        },
        crossings: {image: siegfriedVisual.pattern['paper-grain'], visible: false},
        detail: 'all',
        extras: {paths: true},
        hierarchy: 'strong',
        modifiers: {
          construction: {
            surface: {
              casing: {dash: [2, 1], opacity: 0.36},
              fill: {dash: [2, 1], opacity: 0.46},
            },
          },
          indoor: {enabled: false},
          unpaved: {
            surface: {
              casing: {dash: [3, 1.5], opacity: 0.52},
              fill: {dash: [3, 1.5], opacity: 0.72},
            },
          },
        },
        oneWayMarkers: false,
        outline: 'strong',
        restrictions: {
          access: {
            surface: {
              casing: {dash: [1, 1], opacity: 0.34},
              fill: {dash: [1, 1], opacity: 0.46},
            },
          },
        },
        roundabouts: {
          casing: {visible: false},
          fill: {visible: false},
        },
        sidewalks: {
          outline: {visible: false},
          pattern: {visible: false},
          surface: {visible: false},
        },
        weight: 'thin',
        widthScale: {
          cycleway: 0.52,
          footway: 0.5,
          minor: 0.76,
          motorway: 0.84,
          pathway: 0.52,
          pedestrian: 0.5,
          primary: 0.86,
          secondary: 0.82,
          service: 0.62,
          steps: 0.46,
          tertiary: 0.78,
          track: 0.58,
          trunk: 0.84,
        },
      }),
      transit: transit({
        cableway: {
          color: siegfriedPalette.ink,
          dash: [1, 2.5],
          minZoom: 11,
          opacity: 0.46,
          width: 0.65,
        },
        ferry: {
          color: siegfriedPalette.blue,
          dash: [4, 3],
          minZoom: 6,
          opacity: 0.62,
          width: 0.7,
        },
        rail: {
          bridge: {color: siegfriedPalette.ink, minZoom: 7, opacity: 0.96, width: 1.35},
          surface: {color: siegfriedPalette.ink, minZoom: 7, opacity: 0.94, width: 1.2},
          tunnel: {
            color: siegfriedPalette.ink,
            dash: [2, 1.5],
            minZoom: 9,
            opacity: 0.46,
            width: 1,
          },
        },
        railHatching: {
          bridge: {color: siegfriedPalette.paper, dash: [1, 1.2], minZoom: 9, width: 0.65},
          surface: {color: siegfriedPalette.paper, dash: [1, 1.2], minZoom: 9, width: 0.6},
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {color: siegfriedPalette.ink, minZoom: 12, opacity: 0.62, width: 0.75},
          surface: {color: siegfriedPalette.ink, minZoom: 12, opacity: 0.58, width: 0.7},
          tunnel: {
            color: siegfriedPalette.ink,
            dash: [2, 1.5],
            minZoom: 12,
            opacity: 0.3,
            width: 0.65,
          },
        },
      }),
      vegetation: vegetation({enabled: false}),
      water: water({
        bathymetry: {visible: false},
        bodies: {
          fill: {color: siegfriedPalette.blue, opacity: 0.19},
          outline: {
            color: siegfriedPalette.blue,
            minZoom: 5,
            opacity: 0.9,
            width: zoom.linear([
              [5, 0.4],
              [14, 0.8],
              [18, 1.15],
            ]),
          },
        },
        intermittent: {
          bodies: {fill: {color: siegfriedPalette.blue, opacity: 0.1}},
          waterways: {
            color: siegfriedPalette.blue,
            dash: [2.5, 2],
            opacity: 0.58,
          },
        },
        waterways: {
          canal: {
            color: siegfriedPalette.blue,
            minZoom: 8,
            opacity: 0.9,
            width: zoom.linear([
              [8, 0.35],
              [16, 1.6],
            ]),
          },
          other: {
            color: siegfriedPalette.blue,
            minZoom: 12,
            opacity: 0.72,
            width: zoom.linear([
              [12, 0.25],
              [17, 0.85],
            ]),
          },
          river: {
            color: siegfriedPalette.blue,
            minZoom: 6,
            opacity: 0.96,
            width: zoom.linear([
              [6, 0.42],
              [16, 2.1],
            ]),
          },
          stream: {
            color: siegfriedPalette.blue,
            minZoom: 10,
            opacity: 0.88,
            width: zoom.linear([
              [10, 0.3],
              [16, 1.15],
            ]),
          },
        },
      }),
    },
    ...defineModuleEffects([
      omitLandformElevationUnit('arete'),
      omitLandformElevationUnit('cliff'),
      omitLandformElevationUnit('peak'),
      omitLandformElevationUnit('ridge'),
      omitLandformElevationUnit('saddle'),
      omitLandformElevationUnit('volcano'),
      landcoverPattern(
        'forest',
        'land.landcover.wood.outline',
        siegfriedVisual.pattern.forest,
        ['wood', 'forest'],
        {minZoom: 8, opacity: 0.84},
      ),
      landcoverPattern(
        'gravel',
        'land.landcover.sand.fill',
        siegfriedVisual.pattern.gravel,
        ['sand', 'beach'],
        {
          minZoom: 10,
          opacity: 0.64,
        },
      ),
      landcoverPattern(
        'orchard',
        'land.landcover.urbanPark.fill',
        siegfriedVisual.pattern.orchard,
        ['grass'],
        {
          minZoom: 12,
          opacity: 0.62,
          subclasses: ['garden', 'orchard'],
        },
      ),
      landcoverPattern(
        'wetland',
        'land.landcover.wetland.fill',
        siegfriedVisual.pattern.wetland,
        ['wetland'],
        {
          minZoom: 9,
          opacity: 0.8,
        },
      ),
      addModuleLayer(
        'water',
        'water.effects.rockMask',
        {
          id: 'siegfried-rock-contour-mask',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('landcover'),
          minzoom: 9,
          filter: ['match', landcoverClass, ['rock'], true, false],
          // Retain a muted trace of quantitative relief while the key-ink
          // hachure takes visual ownership of exposed rock.
          paint: {
            'fill-color': siegfriedPalette.paper,
            'fill-opacity': siegfriedVisual.number.rockMaskOpacity,
          },
        },
        {before: 'water.bodies.fill'},
        {requires: ['land']},
      ),
      postContourLandcoverPattern(
        'rock',
        'water.effects.rockMask',
        siegfriedVisual.pattern.rock,
        ['rock'],
        {
          excludeSubclasses: ['scree', 'talus'],
          minZoom: 9,
          opacity: 0.9,
        },
      ),
      postContourLandcoverPattern(
        'scree',
        'water.effects.rockPattern',
        siegfriedVisual.pattern.scree,
        ['rock'],
        {
          minZoom: 10,
          opacity: 0.82,
          subclasses: ['scree', 'talus'],
        },
      ),
      addModuleLayer(
        'water',
        'water.effects.glacierMask',
        {
          id: 'siegfried-glacier-mask',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('landcover'),
          minzoom: 7,
          filter: ['match', landcoverClass, ['ice', 'glacier'], true, false],
          paint: {'fill-color': siegfriedPalette.paper, 'fill-opacity': 0.98},
        },
        {before: 'water.bodies.fill'},
        {requires: ['land']},
      ),
      addModuleLayer(
        'water',
        'water.effects.glacierPattern',
        {
          id: 'siegfried-landcover-glacier-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('landcover'),
          minzoom: 8,
          filter: ['match', landcoverClass, ['ice', 'glacier'], true, false],
          paint: {
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.74, 15, 0.66],
            'fill-pattern': siegfriedVisual.pattern.glacier,
          },
        },
        {after: 'water.effects.glacierMask'},
        {requires: ['land']},
      ),
      addModuleLayer(
        'water',
        'water.effects.glacierOutline',
        {
          id: 'siegfried-glacier-outline',
          type: 'line',
          source: 'tileflow',
          'source-layer': semanticLayer('landcover'),
          minzoom: 9,
          filter: ['match', landcoverClass, ['ice', 'glacier'], true, false],
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': siegfriedPalette.blue,
            'line-opacity': 0.48,
            'line-width': 0.5,
          },
        },
        {after: 'water.effects.glacierPattern'},
        {requires: ['land']},
      ),
      addModuleLayer(
        'water',
        'water.effects.lines',
        {
          id: 'siegfried-water-lines-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 7,
          filter: ['!=', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 0.48, 16, 0.32],
            'fill-pattern': siegfriedVisual.pattern['water-lines'],
          },
        },
        {after: 'water.bodies.outline'},
      ),
      addModuleLayer(
        'water',
        'water.effects.intermittentLines',
        {
          id: 'siegfried-water-intermittent-lines-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 9,
          filter: ['==', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {
            'fill-opacity': 0.22,
            'fill-pattern': siegfriedVisual.pattern['water-lines'],
          },
        },
        {after: 'water.intermittent.bodies.fill'},
      ),
    ]),
    view: {
      bearing: 0,
      center: [7.6586, 45.9763],
      pitch: 0,
      zoom: 13.25,
    },
  }),
);
