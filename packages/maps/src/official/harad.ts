import {
  boundaries,
  buildings,
  defineMap,
  disable,
  expr,
  field,
  labels,
  land,
  landforms,
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
import {haradIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * An original palette derived from the visual grammar of Lantmäteriet's
 * nineteenth-century Häradsekonomiska kartan: warm paper, ochre cultivation,
 * blue-green water, green vegetation marks, vermilion boundaries, and black ink.
 */
const haradPalette = {
  boundary: '#A63E31',
  boundaryGreen: '#477356',
  boundaryMuted: '#BD6A52',
  building: '#B64B35',
  buildingActive: '#983428',
  buildingOutline: '#81382D',
  cadastral: '#B86D48',
  field: '#E1B23B',
  fieldLight: '#E9C968',
  grass: '#D6D7A8',
  halo: '#EEE3C8',
  ice: '#E5E8DA',
  ink: '#34362F',
  inkMuted: '#646452',
  meadow: '#D9D6A9',
  paper: '#EEE3C8',
  paperBright: '#F7EED9',
  rail: '#3D3D34',
  road: '#F0E4C5',
  roadCasing: '#98752D',
  roadMajor: '#D99F24',
  roadSecondary: '#E2B94D',
  sand: '#E4D0A0',
  scrub: '#D6D1A9',
  settlement: '#DCAD37',
  water: '#C4DED5',
  waterInk: '#477A71',
  wetland: '#E1C8A5',
  wood: '#C9D3AF',
  woodDark: '#4E7657',
} as const;

function haradRoadStyle(
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
    opacity: options.casingOpacity ?? 0.78,
  };
  const fill = {
    color: fillColor,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.fillOpacity ?? 0.96,
  };

  return {
    bridge: {
      casing: {...casing, opacity: Math.min(1, (options.casingOpacity ?? 0.78) + 0.08)},
      fill,
    },
    surface: {casing, fill},
    tunnel: {
      casing: {...casing, dash: [2, 1.5], opacity: options.tunnelOpacity ?? 0.34},
      fill: {
        ...fill,
        color: haradPalette.paperBright,
        dash: [2, 1.5],
        opacity: options.tunnelOpacity ?? 0.46,
      },
    },
  };
}

function haradPathStyle(
  color: string,
  minZoom: number,
  dash: readonly number[] = [2, 1.6],
): TileflowRoadClassStyle {
  return haradRoadStyle(color, haradPalette.inkMuted, minZoom, {
    casingOpacity: 0.12,
    dash,
    fillOpacity: 0.76,
    tunnelOpacity: 0.24,
  });
}

const haradRoadLabel = {
  placement: 'line',
  priority: 62,
  spacing: 320,
  text: {
    color: haradPalette.ink,
    font: 'Noto Sans Regular',
    haloBlur: 0.3,
    haloColor: haradPalette.halo,
    haloWidth: 1.15,
    letterSpacing: 0.06,
    maxAngle: 24,
    padding: 3,
    size: zoom.linear([
      [11, 8.5],
      [17, 12.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

const haradPathLabel = {
  ...haradRoadLabel,
  minZoom: 16,
  priority: 30,
  text: {
    ...haradRoadLabel.text,
    color: haradPalette.inkMuted,
    letterSpacing: 0.035,
    size: zoom.linear([
      [16, 8],
      [19, 10.5],
    ]),
  },
} satisfies TileflowSymbolStyle;

function landcoverPattern(
  target: string,
  pattern: string,
  classes: readonly string[],
  options: {
    highZoom?: number;
    highZoomOpacity?: number;
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
  const minZoom = options.minZoom ?? 8;
  const opacity = options.opacity ?? 0.78;
  const opacityStops: Array<readonly [number, number]> = [
    [minZoom, 0],
    [minZoom + 1, opacity],
  ];
  if (options.highZoom !== undefined && options.highZoomOpacity !== undefined) {
    opacityStops.push([options.highZoom, options.highZoomOpacity]);
  }

  return renderPass({
    attachTo: target,
    feature: 'landcover',
    phase: 'overlay',
    renderer: 'fill',
    selector,
    style: {
      minZoom,
      opacity: zoom.linear(opacityStops),
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
  maxZoom?: number,
) {
  const opacityStops: Array<readonly [number, number]> = [
    [minZoom, 0],
    [minZoom + 1, opacity],
  ];
  if (maxZoom !== undefined) {
    opacityStops.push([maxZoom - 2, opacity * 0.5], [maxZoom, 0]);
  }

  return renderPass({
    attachTo: target,
    feature: 'landuse',
    phase: 'overlay',
    renderer: 'fill',
    selector: {field: 'class', kind: 'in', values: classes},
    style: {
      ...(maxZoom === undefined ? {} : {maxZoom}),
      minZoom,
      opacity: zoom.linear(opacityStops),
      pattern,
    },
  });
}

export const haradTheme = defineOfficialTheme({
  id: 'harad-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: haradPalette.paper,
    boundary: haradPalette.boundary,
    building: haradPalette.building,
    land: haradPalette.paper,
    park: haradPalette.wood,
    road: haradPalette.road,
    roadCasing: haradPalette.roadCasing,
    roadMajor: haradPalette.roadMajor,
    text: haradPalette.ink,
    textHalo: haradPalette.halo,
    textMuted: haradPalette.inkMuted,
    water: haradPalette.water,
  },
  modules: {
    boundaries: {
      admin: haradPalette.boundary,
      disputed: '#B84436',
      major: haradPalette.boundary,
      maritime: haradPalette.waterInk,
    },
    buildings: {
      active: haradPalette.buildingActive,
      businessCorridor: haradPalette.settlement,
      businessCorridorOutline: haradPalette.buildingOutline,
      civic: '#96362D',
      commercial: haradPalette.building,
      destination: haradPalette.buildingActive,
      extrusion: haradPalette.building,
      fill: haradPalette.building,
      generic: haradPalette.building,
      highRise: '#91352C',
      highRiseOutline: haradPalette.buildingOutline,
      industrial: '#8D5748',
      lowRise: '#B65340',
      lowRiseOutline: haradPalette.buildingOutline,
      outline: haradPalette.buildingOutline,
      residential: haradPalette.building,
    },
    hydro: {
      ferry: haradPalette.waterInk,
      label: haradPalette.waterInk,
      water: haradPalette.water,
      waterway: haradPalette.waterInk,
    },
    labels: {
      country: haradPalette.ink,
      halo: haradPalette.halo,
      muted: haradPalette.inkMuted,
      neighborhood: haradPalette.inkMuted,
      poi: haradPalette.ink,
      primary: haradPalette.ink,
      road: haradPalette.ink,
      settlement: haradPalette.ink,
      water: haradPalette.waterInk,
    },
    landcover: {
      farmland: haradPalette.field,
      flowerbed: haradPalette.fieldLight,
      grass: haradPalette.grass,
      ice: haradPalette.ice,
      meadow: haradPalette.meadow,
      protected: '#C6CE9D',
      recreationGround: '#CED09D',
      rock: '#D9CCB2',
      sand: haradPalette.sand,
      scrub: haradPalette.scrub,
      urbanPark: '#C9D09F',
      villageGreen: '#CCD2A2',
      wetland: haradPalette.wetland,
      wood: haradPalette.wood,
    },
    landuse: {
      cemetery: '#C5C999',
      civic: '#E3C985',
      commercial: '#DCBC73',
      education: '#D8C68D',
      government: '#DDC07B',
      industrial: '#CCB68A',
      medical: '#D9B78A',
      military: '#D2AE8D',
      parking: '#DED2B5',
      recreation: '#CCD09E',
      residential: '#DFC472',
    },
    poi: {
      'arts-entertainment': haradPalette.boundary,
      education: haradPalette.inkMuted,
      'food-drink': haradPalette.boundary,
      halo: haradPalette.halo,
      icon: haradPalette.ink,
      label: haradPalette.ink,
      landmark: haradPalette.boundary,
      lodging: haradPalette.boundaryMuted,
      medical: haradPalette.boundary,
      'park-nature': haradPalette.inkMuted,
      'public-services': haradPalette.inkMuted,
      religion: haradPalette.boundary,
      retail: haradPalette.inkMuted,
      'sport-leisure': haradPalette.inkMuted,
      transport: haradPalette.rail,
      'visitor-amenity': haradPalette.inkMuted,
    },
    roads: {
      bridge: haradPalette.roadMajor,
      casing: haradPalette.roadCasing,
      ferry: haradPalette.waterInk,
      minor: haradPalette.road,
      motorway: haradPalette.roadMajor,
      path: haradPalette.inkMuted,
      primary: haradPalette.roadMajor,
      rail: haradPalette.rail,
      secondary: haradPalette.roadSecondary,
      trunk: '#D5A033',
      tunnel: haradPalette.paperBright,
    },
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.025,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.055},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.03},
    roads: {font: 'Noto Sans Regular', letterSpacing: 0.055},
    water: {font: 'Noto Sans Regular', letterSpacing: 0.09},
  },
  lighting: {
    anchor: 'viewport',
    color: '#F4E3B9',
    intensity: 0.08,
    position: [1.15, 215, 32],
  },
});

/**
 * A self-contained map inspired by Häradsekonomiska kartan (1859–1934).
 * It uses only Tileflow's semantic compiler contract: it neither imports nor
 * extends the Streets map and owns its complete visual design and asset set.
 */
export const harad = bindOfficialMapTheme(
  defineMap({
    id: 'harad',
    version: 1,
    name: 'Härad',
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
    icons: [haradIcons],
    themes: {light: haradTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: 'none',
    modules: {
      addresses: disable(),
      aeroways: disable(),
      boundaries: boundaries({
        admin2: {
          color: haradPalette.boundary,
          dash: [7, 1.5],
          minZoom: 2,
          opacity: 0.9,
          width: zoom.linear([
            [2, 0.8],
            [10, 1.9],
          ]),
        },
        admin4: {
          color: haradPalette.boundaryGreen,
          dash: [4, 1.5, 1, 1.5],
          minZoom: 5,
          opacity: 0.78,
          width: zoom.linear([
            [5, 0.55],
            [12, 1.15],
          ]),
        },
        disputed: {
          color: '#B84436',
          dash: [2, 1],
          minZoom: 3,
          opacity: 0.8,
          width: 1.2,
        },
        maritime: {
          color: haradPalette.waterInk,
          dash: [5, 3],
          minZoom: 3,
          opacity: 0.46,
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
            color: haradPalette.building,
            minZoom: 15,
            opacity: zoom.linear([
              [15, 0],
              [16, 0.84],
              [19, 0.9],
            ]),
          },
          outline: {
            color: haradPalette.buildingOutline,
            minZoom: 15,
            opacity: zoom.linear([
              [15, 0],
              [16, 0.66],
              [19, 0.72],
            ]),
            width: zoom.linear([
              [15, 0.28],
              [18, 0.58],
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
        roads: 'none',
        shields: 'none',
        styles: {
          places: {
            continent: {
              maxZoom: 3.5,
              minZoom: 0,
              text: {
                color: haradPalette.inkMuted,
                font: 'Noto Sans Bold',
                haloColor: haradPalette.halo,
                haloWidth: 1.1,
                letterSpacing: 0.14,
                size: zoom.linear([
                  [0, 10],
                  [3, 14],
                ]),
                transform: 'uppercase',
              },
            },
            country: {
              minZoom: 1,
              text: {
                color: haradPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: haradPalette.halo,
                haloWidth: 1.35,
                letterSpacing: 0.1,
                size: zoom.linear([
                  [1, 10],
                  [7, 17],
                ]),
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 4,
              text: {
                color: haradPalette.ink,
                font: 'Noto Sans Bold',
                haloBlur: 0.35,
                haloColor: haradPalette.halo,
                haloWidth: 1.4,
                letterSpacing: 0.06,
                size: zoom.linear([
                  [4, 12],
                  [13, 21],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 7,
              text: {
                color: haradPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: haradPalette.halo,
                haloWidth: 1.25,
                letterSpacing: 0.04,
                size: zoom.linear([
                  [7, 10],
                  [14, 16],
                ]),
              },
            },
            village: {
              minZoom: 9,
              text: {
                color: haradPalette.ink,
                font: 'Noto Sans Regular',
                haloColor: haradPalette.halo,
                haloWidth: 1.15,
                letterSpacing: 0.025,
                size: zoom.linear([
                  [9, 9],
                  [15, 13],
                ]),
              },
            },
            neighborhood: {
              minZoom: 12,
              text: {
                color: haradPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: haradPalette.halo,
                haloWidth: 0.9,
                letterSpacing: 0.06,
                size: zoom.linear([
                  [12, 8.5],
                  [16, 11.5],
                ]),
              },
            },
          },
          roads: {
            cycleway: haradPathLabel,
            footway: haradPathLabel,
            minor: {...haradRoadLabel, minZoom: 15},
            motorway: {...haradRoadLabel, minZoom: 9},
            pathway: haradPathLabel,
            pedestrian: haradPathLabel,
            primary: {...haradRoadLabel, minZoom: 11},
            secondary: {...haradRoadLabel, minZoom: 12},
            service: {...haradRoadLabel, minZoom: 17},
            steps: haradPathLabel,
            tertiary: {...haradRoadLabel, minZoom: 13},
            track: haradPathLabel,
            trunk: {...haradRoadLabel, minZoom: 10},
          },
          water: {
            ocean: {
              text: {
                color: haradPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: haradPalette.halo,
                haloWidth: 0.75,
                letterSpacing: 0.18,
                size: zoom.linear([
                  [1, 11],
                  [8, 17],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              text: {
                color: haradPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: haradPalette.halo,
                haloWidth: 0.75,
                letterSpacing: 0.08,
              },
            },
            waterway: {
              minZoom: 12,
              text: {
                color: haradPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: haradPalette.halo,
                haloWidth: 0.7,
                letterSpacing: 0.07,
              },
            },
          },
        },
        water: 'all',
      }),
      land: withRenderStack(
        land({
          background: {opacity: 1, pattern: 'harad-paper-grain'},
          globalLandcover: {
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'barren', value: '#D9CCB2'},
                {labels: 'crop', value: haradPalette.field},
                {labels: 'grass', value: haradPalette.grass},
                {labels: 'shrub', value: haradPalette.scrub},
                {labels: 'snow', value: haradPalette.ice},
                {labels: 'trees', value: haradPalette.wood},
                {labels: 'urban', value: '#DDC67E'},
              ],
              'rgba(0, 0, 0, 0)',
            ),
            maxZoom: 10,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.9],
              [7, 0.82],
              [9, 0.35],
              [10, 0],
            ]),
          },
          landcover: {
            farmland: {fill: {color: haradPalette.field, minZoom: 7, opacity: 0.84}},
            flowerbed: {fill: {color: haradPalette.fieldLight, minZoom: 12, opacity: 0.76}},
            grass: {fill: {color: haradPalette.grass, minZoom: 7, opacity: 0.72}},
            ice: {fill: {color: haradPalette.ice, minZoom: 7, opacity: 0.72}},
            meadow: {fill: {color: haradPalette.meadow, minZoom: 7, opacity: 0.74}},
            protected: {fill: {color: '#C6CE9D', minZoom: 7, opacity: 0.48}},
            recreationGround: {fill: {color: '#CED09D', minZoom: 9, opacity: 0.66}},
            rock: {fill: {color: '#D9CCB2', minZoom: 7, opacity: 0.62}},
            sand: {fill: {color: haradPalette.sand, minZoom: 7, opacity: 0.78}},
            scrub: {fill: {color: haradPalette.scrub, minZoom: 7, opacity: 0.72}},
            urbanPark: {fill: {color: '#C9D09F', minZoom: 9, opacity: 0.72}},
            villageGreen: {fill: {color: '#CCD2A2', minZoom: 10, opacity: 0.7}},
            wetland: {fill: {color: haradPalette.wetland, minZoom: 7, opacity: 0.78}},
            wood: {fill: {color: haradPalette.wood, minZoom: 7, opacity: 0.74}},
          },
          landuse: {
            cemetery: {
              fill: {color: '#C5C999', minZoom: 10, opacity: 0.7},
              outline: {color: haradPalette.woodDark, minZoom: 12, opacity: 0.56, width: 0.6},
            },
            civic: {fill: {color: '#E3C985', minZoom: 10, opacity: 0.46}},
            commercial: {fill: {color: '#DCBC73', minZoom: 10, opacity: 0.42}},
            education: {fill: {color: '#D8C68D', minZoom: 10, opacity: 0.48}},
            government: {fill: {color: '#DDC07B', minZoom: 10, opacity: 0.46}},
            industrial: {fill: {color: '#CCB68A', minZoom: 10, opacity: 0.48}},
            medical: {fill: {color: '#D9B78A', minZoom: 11, opacity: 0.44}},
            military: {fill: {color: '#D2AE8D', minZoom: 8, opacity: 0.4}},
            parking: {
              fill: {visible: false},
              outline: {visible: false},
            },
            railway: {fill: {color: '#C6B99A', minZoom: 11, opacity: 0.4}},
            recreation: {
              fill: {color: '#CCD09E', minZoom: 9, opacity: 0.6},
              outline: {color: haradPalette.woodDark, minZoom: 13, opacity: 0.42, width: 0.55},
            },
            residential: {fill: {color: '#DFC472', minZoom: 9, opacity: 0.62}},
          },
        }),
        {
          fieldBoundaries: renderPass({
            attachTo: 'land.landcover.farmland.fill',
            feature: 'landcover',
            phase: 'overlay',
            renderer: 'line',
            selector: {field: 'class', kind: 'in', values: ['farmland']},
            style: {
              color: haradPalette.cadastral,
              minZoom: 10,
              opacity: zoom.linear([
                [10, 0],
                [12, 0.38],
                [16, 0.56],
              ]),
              width: zoom.linear([
                [10, 0.2],
                [16, 0.65],
              ]),
            },
          }),
          arableTexture: landcoverPattern(
            'land.landcover.farmland.fill',
            'harad-arable',
            ['farmland'],
            {
              highZoom: 16,
              highZoomOpacity: 0.44,
              minZoom: 8,
              opacity: 0.8,
            },
          ),
          coniferTexture: landcoverPattern(
            'land.landcover.wood.fill',
            'harad-conifer',
            ['wood', 'forest'],
            {minZoom: 8, opacity: 0.84},
          ),
          orchardTexture: landcoverPattern(
            'land.landcover.urbanPark.fill',
            'harad-orchard',
            ['grass'],
            {minZoom: 11, opacity: 0.52, subclasses: ['garden']},
          ),
          deciduousTexture: landcoverPattern(
            'land.landcover.urbanPark.fill',
            'harad-deciduous',
            ['grass'],
            {minZoom: 10, opacity: 0.7, subclasses: ['park']},
          ),
          sandTexture: landcoverPattern(
            'land.landcover.sand.fill',
            'harad-sand',
            ['sand', 'beach'],
            {minZoom: 9, opacity: 0.72},
          ),
          wetlandTexture: landcoverPattern(
            'land.landcover.wetland.fill',
            'harad-wetland',
            ['wetland'],
            {minZoom: 9, opacity: 0.82},
          ),
          settlementTexture: landusePattern(
            'land.landuse.residential.fill',
            'harad-settlement',
            ['residential'],
            11,
            0.56,
            16,
          ),
        },
      ),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 13,
            text: {
              color: haradPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: haradPalette.halo,
              haloWidth: 0.9,
              size: 9,
            },
          },
          peak: {
            minZoom: 9,
            text: {
              color: haradPalette.ink,
              font: 'Noto Sans Regular',
              haloColor: haradPalette.halo,
              haloWidth: 0.9,
              size: zoom.linear([
                [9, 9],
                [15, 12],
              ]),
            },
          },
          volcano: {
            minZoom: 8,
            text: {
              color: haradPalette.boundary,
              font: 'Noto Sans Regular',
              haloColor: haradPalette.halo,
              haloWidth: 0.9,
              size: 10,
            },
          },
        },
      }),
      poi: disable(),
      roads: roads({
        areas: {
          pedestrian: {
            fill: {color: '#DDC57D', minZoom: 13, opacity: 0.5},
            outline: {color: haradPalette.roadCasing, minZoom: 14, opacity: 0.42, width: 0.55},
          },
          pier: {
            fill: {color: haradPalette.paper, minZoom: 12, opacity: 0.92},
            outline: {color: haradPalette.inkMuted, minZoom: 12, opacity: 0.58, width: 0.65},
          },
          road: {fill: {color: haradPalette.road, minZoom: 13, opacity: 0.74}},
        },
        classes: {
          cycleway: {enabled: false},
          footway: haradPathStyle(haradPalette.inkMuted, 15, [1.3, 1.5]),
          minor: haradRoadStyle(haradPalette.road, haradPalette.roadCasing, 12, {
            casingOpacity: 0.58,
            fillOpacity: 0.9,
          }),
          motorway: haradRoadStyle(haradPalette.paperBright, haradPalette.roadMajor, 5, {
            casingOpacity: 0.78,
          }),
          pathway: haradPathStyle(haradPalette.inkMuted, 15),
          pedestrian: haradPathStyle(haradPalette.boundaryGreen, 14, [1, 1.5]),
          primary: haradRoadStyle(haradPalette.paperBright, haradPalette.roadMajor, 7, {
            casingOpacity: 0.8,
          }),
          secondary: haradRoadStyle(haradPalette.paper, '#B48222', 9, {
            casingOpacity: 0.74,
          }),
          service: haradRoadStyle(haradPalette.road, haradPalette.roadCasing, 14, {
            casingOpacity: 0.38,
            fillOpacity: 0.82,
          }),
          steps: {enabled: false},
          tertiary: haradRoadStyle(haradPalette.paper, '#A97B25', 10, {
            casingOpacity: 0.7,
            fillOpacity: 0.9,
          }),
          track: haradPathStyle(haradPalette.roadCasing, 13, [3.5, 2]),
          trunk: haradRoadStyle(haradPalette.paperBright, '#C58E1C', 6, {
            casingOpacity: 0.78,
          }),
        },
        detail: 'streets',
        extras: {paths: true},
        hierarchy: 'clear',
        modifiers: {
          unpaved: {
            surface: {
              casing: {dash: [3, 1], opacity: 0.46},
              fill: {dash: [3, 1], opacity: 0.66},
            },
          },
        },
        oneWayMarkers: false,
        outline: 'subtle',
        sidewalks: {
          outline: {visible: false},
          surface: {visible: false},
        },
        weight: 'thin',
        widthScale: {
          cycleway: 0.62,
          footway: 0.56,
          minor: 0.62,
          motorway: 0.54,
          pathway: 0.54,
          pedestrian: 0.6,
          primary: 0.62,
          secondary: 0.66,
          service: 0.66,
          steps: 0.5,
          tertiary: 0.64,
          track: 0.58,
          trunk: 0.56,
        },
      }),
      transit: transit({
        cableway: {
          color: haradPalette.inkMuted,
          dash: [2, 2],
          minZoom: 11,
          opacity: 0.42,
          width: 0.75,
        },
        ferry: {
          color: haradPalette.waterInk,
          dash: [4, 2],
          minZoom: 5,
          opacity: 0.7,
          width: zoom.linear([
            [5, 0.5],
            [16, 1.8],
          ]),
        },
        rail: {
          bridge: {color: haradPalette.rail, minZoom: 7, opacity: 0.92, width: 1.45},
          surface: {color: haradPalette.rail, minZoom: 7, opacity: 0.88, width: 1.3},
          tunnel: {
            color: haradPalette.rail,
            dash: [2, 1.5],
            minZoom: 9,
            opacity: 0.42,
            width: 1,
          },
        },
        railHatching: {
          bridge: {color: haradPalette.paperBright, dash: [1, 1.25], minZoom: 9, width: 0.75},
          surface: {color: haradPalette.paperBright, dash: [1, 1.25], minZoom: 9, width: 0.7},
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {color: haradPalette.rail, minZoom: 12, opacity: 0.58, width: 0.85},
          surface: {color: haradPalette.rail, minZoom: 12, opacity: 0.54, width: 0.78},
          tunnel: {
            color: haradPalette.rail,
            dash: [2, 1.5],
            minZoom: 12,
            opacity: 0.28,
            width: 0.7,
          },
        },
      }),
      vegetation: vegetation({
        flat: {
          color: expr.match(
            expr.coalesce(expr.get(field('leafType')), ''),
            [
              {labels: ['needleleaved', 'needleleaf'], value: '#416A4C'},
              {labels: ['broadleaved', 'broadleaf'], value: '#5F805A'},
            ],
            haradPalette.woodDark,
          ),
          minZoom: 15,
          opacity: 0.8,
          radius: zoom.linear([
            [15, 1.45],
            [19, 3.8],
          ]),
          strokeColor: haradPalette.paperBright,
          strokeOpacity: 0.5,
          strokeWidth: 0.55,
        },
        minZoom: 15,
        mode: 'flat',
      }),
      water: withRenderStack(
        water({
          bathymetry: {
            color: expr.match(
              expr.toNumber(expr.get(field('bathymetryMinDepth')), 0),
              [
                {labels: 0, value: haradPalette.water},
                {labels: -200, value: '#B7D4CB'},
                {labels: -1000, value: '#A9C9C0'},
                {labels: -2000, value: '#9EBDB6'},
                {labels: -4000, value: '#8FAFA8'},
                {labels: -6000, value: '#84A29D'},
              ],
              haradPalette.water,
            ),
            maxZoom: 9,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.68],
              [7, 0.52],
              [9, 0],
            ]),
          },
          bodies: {
            fill: {color: haradPalette.water, opacity: 0.96},
            outline: {
              color: haradPalette.waterInk,
              minZoom: 5,
              opacity: 0.76,
              width: zoom.linear([
                [5, 0.4],
                [14, 0.9],
                [18, 1.25],
              ]),
            },
          },
          intermittent: {
            bodies: {fill: {color: haradPalette.water, opacity: 0.5}},
            waterways: {color: haradPalette.waterInk, dash: [3, 2], opacity: 0.46},
          },
          waterways: {
            canal: {
              color: haradPalette.waterInk,
              minZoom: 8,
              opacity: 0.92,
              width: zoom.linear([
                [8, 0.35],
                [16, 1.8],
              ]),
            },
            other: {
              color: haradPalette.waterInk,
              minZoom: 12,
              opacity: 0.72,
              width: zoom.linear([
                [12, 0.25],
                [17, 1],
              ]),
            },
            river: {
              color: haradPalette.waterInk,
              minZoom: 6,
              opacity: 0.96,
              width: zoom.linear([
                [6, 0.4],
                [16, 2.2],
              ]),
            },
            stream: {
              color: haradPalette.waterInk,
              minZoom: 10,
              opacity: 0.86,
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
                [7, 0],
                [9, 0.4],
                [16, 0.28],
              ]),
              pattern: 'harad-water-lines',
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
            style: {minZoom: 9, opacity: 0.18, pattern: 'harad-water-lines'},
          }),
        },
      ),
    },
    view: {
      center: [15.2134, 59.2741],
      pitch: 0,
      bearing: 0,
      zoom: 13,
    },
  }),
);
