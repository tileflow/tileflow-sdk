import {
  addresses,
  buildings,
  defineMap,
  expression,
  labels,
  land,
  poi,
  roads,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  type TileflowThemeConfig,
  transit,
  vegetation,
  water,
  zoom,
} from '@tileflow/core';
import {
  addModuleLayer,
  defineModuleEffects,
  removeModuleLayer,
  semanticField,
  semanticLayer,
} from '@tileflow/core/recipe';
import {verdantIcons} from '../assets';
import {streets} from './streets';

const verdantPalette = {
  background: '#F8F1E4',
  boundary: '#AEB8AC',
  building: '#E7D9CB',
  buildingActive: '#E3D5C7',
  buildingOutline: '#D5C7B9',
  coral: '#E9AD94',
  cycleway: '#5B9B90',
  earth: '#B7B5A7',
  earthDark: '#929D92',
  farmland: '#F0E2B6',
  footway: '#83A77D',
  grass: '#D8EDC1',
  halo: '#F8F1E4',
  ice: '#F0F4EF',
  ink: '#4F7966',
  inkMuted: '#718F80',
  ivory: '#F4EBDD',
  ivoryBright: '#FCF6EB',
  park: '#C4E8B2',
  protected: '#B6DFAF',
  roadCasing: '#D4C5B7',
  roadMinor: '#F5EBDE',
  roadMotorway: '#E8B9A3',
  roadPrimary: '#EBD0B6',
  roadSecondary: '#EEDAC2',
  roadService: '#F8F0E7',
  roadTertiary: '#F2E3D3',
  roadTrunk: '#E8C6AA',
  sand: '#EFDDAF',
  scrub: '#CDE4B5',
  transit: '#E9AD94',
  water: '#B2E1DC',
  waterArtificial: '#C3EAE2',
  waterDeep: '#6DB2AB',
  waterLabel: '#599A94',
  wetland: '#B4E0D2',
  wood: '#ACD3A5',
} as const;

const verdantFeatureClass = ['coalesce', ['get', semanticField('class')], ''];
const verdantFeatureSubclass = ['coalesce', ['get', semanticField('subclass')], ''];
const verdantGreenSpaceSubclasses = [
  'park',
  'garden',
  'meadow',
  'recreation_ground',
  'village_green',
  'flowerbed',
];
const verdantGreenSpaceFilter = [
  'all',
  ['==', ['geometry-type'], 'Polygon'],
  ['==', ['get', semanticField('class')], 'grass'],
  ['match', ['get', semanticField('subclass')], verdantGreenSpaceSubclasses, true, false],
];
const verdantActiveUseValues = ['yes', 'designated', 'official', 'permissive'];
const verdantSurfacePathLayerIds = [
  'cycleway',
  'footway',
  'pathway',
  'pedestrian',
  'track',
].flatMap((roadClass) => [
  `roads.classes.${roadClass}.surface.casing`,
  `roads.classes.${roadClass}.surface.fill`,
]);
const verdantActiveNetworkFilter = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  [
    'any',
    [
      'all',
      ['==', ['get', semanticField('class')], 'path'],
      [
        'match',
        ['get', semanticField('subclass')],
        ['path', 'bridleway', 'footway', 'cycleway', 'pedestrian'],
        true,
        false,
      ],
    ],
    [
      'all',
      ['==', ['get', semanticField('class')], 'track'],
      [
        'any',
        ['match', ['get', semanticField('foot')], verdantActiveUseValues, true, false],
        ['match', ['get', semanticField('bicycle')], verdantActiveUseValues, true, false],
        ['has', semanticField('mtbScale')],
      ],
    ],
  ],
  ['!=', ['to-number', ['get', semanticField('indoor')], 0], 1],
  ['match', ['get', semanticField('brunnel')], ['tunnel', 'bridge'], false, true],
  [
    'match',
    ['coalesce', ['get', semanticField('access')], 'unknown'],
    ['no', 'private'],
    false,
    true,
  ],
];
const verdantOrdinaryTrackFilter = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['==', ['get', semanticField('class')], 'track'],
  ['match', ['get', semanticField('brunnel')], ['tunnel', 'bridge'], false, true],
  ['!', verdantActiveNetworkFilter],
];
const verdantActiveNetworkColor = [
  'match',
  verdantFeatureSubclass,
  'cycleway',
  verdantPalette.cycleway,
  'pedestrian',
  '#6B9370',
  'footway',
  verdantPalette.footway,
  'bridleway',
  '#AD8767',
  '#8D9F78',
];
const verdantActiveNetworkStrokeWidth = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0,
  13,
  ['match', verdantFeatureSubclass, 'cycleway', 1, 'pedestrian', 0.95, 'bridleway', 0.9, 0.8],
  15,
  ['match', verdantFeatureSubclass, 'cycleway', 3.1, 'pedestrian', 2.9, 'bridleway', 2.7, 2.4],
  18,
  ['match', verdantFeatureSubclass, 'cycleway', 4.9, 'pedestrian', 4.5, 'bridleway', 4.2, 3.8],
  20,
  ['match', verdantFeatureSubclass, 'cycleway', 6, 'pedestrian', 5.5, 'bridleway', 5.1, 4.8],
];
const verdantWaterBodyColor = [
  'match',
  verdantFeatureClass,
  ['swimming_pool', 'basin'],
  verdantPalette.waterArtificial,
  verdantPalette.water,
];

const verdantPathOpacity = zoom.linear([
  [11, 0],
  [12, 0.35],
  [14, 0.78],
  [18, 0.86],
]);

function verdantPathStyle(
  color: string,
  minZoom: number,
  options: {
    casingColor?: string;
    dash?: readonly number[];
    surfaceVisible?: boolean;
    tunnelColor?: string;
  } = {},
): TileflowRoadClassStyle {
  const surface = {
    casing: {
      color: options.casingColor ?? color,
      minZoom,
      opacity: 0,
    },
    fill: {
      color,
      ...(options.dash ? {dash: options.dash} : {}),
      minZoom,
      opacity: options.surfaceVisible ? verdantPathOpacity : 0,
    },
  };
  return {
    surface,
    bridge: {
      casing: surface.casing,
      fill: {...surface.fill, color, opacity: verdantPathOpacity},
    },
    tunnel: {
      casing: {...surface.casing, color: verdantPalette.roadCasing},
      fill: {
        ...surface.fill,
        color: options.tunnelColor ?? verdantPalette.inkMuted,
        opacity: verdantPathOpacity,
      },
    },
  };
}

function verdantRoadRangeStyle(
  minZoom: number,
  colors: {casing: string; fill: string},
  options: {
    casingOpacity?: number;
    fillOpacity?: number;
    revealProgressively?: boolean;
  } = {},
): TileflowRoadClassStyle {
  const fillOpacity = options.fillOpacity ?? 0.68;
  const casingOpacity = options.casingOpacity ?? 0.28;
  const fill = {
    color: colors.fill,
    minZoom,
    opacity: options.revealProgressively
      ? zoom.linear([
          [minZoom, 0.03],
          [minZoom + 1, fillOpacity * 0.25],
          [minZoom + 3, fillOpacity * 0.68],
          [minZoom + 5, fillOpacity],
        ])
      : fillOpacity,
  };
  const casing = {
    color: colors.casing,
    minZoom,
    opacity: options.revealProgressively
      ? zoom.linear([
          [minZoom, 0],
          [minZoom + 1, 0.06],
          [minZoom + 3, casingOpacity * 0.5],
          [minZoom + 5, casingOpacity],
        ])
      : casingOpacity,
  };
  return {
    bridge: {
      casing: {...casing, color: colors.casing},
      fill: {...fill, color: colors.fill},
    },
    surface: {casing, fill},
    tunnel: {
      casing: {...casing, color: '#C9C3BA'},
      fill: {...fill, color: '#DDD8D0'},
    },
  };
}

const verdantTransitWidth = zoom.linear([
  [7, 0.55],
  [12, 1.15],
  [16, 2.8],
  [22, 5.4],
]);
const verdantTransitStyle = {
  color: verdantPalette.transit,
  minZoom: 7,
  opacity: 0.54,
  width: verdantTransitWidth,
};

const verdantGhostRoadLabel = {
  text: {
    color: verdantPalette.inkMuted,
    haloColor: verdantPalette.halo,
    haloWidth: 1.6,
    opacity: 0.52,
  },
} satisfies TileflowSymbolStyle;

const verdantActivePathLabel = {
  minZoom: 13,
  text: {
    color: verdantPalette.ink,
    haloColor: '#C9E1C0',
    haloWidth: 0.8,
    opacity: 0.86,
    size: zoom.linear([
      [13, 10],
      [17, 13],
    ]),
    font: 'Noto Sans Bold',
  },
} satisfies TileflowSymbolStyle;

export const verdantTheme = {
  mode: 'light',
  colors: {
    background: verdantPalette.background,
    boundary: verdantPalette.boundary,
    building: verdantPalette.building,
    land: verdantPalette.ivory,
    park: verdantPalette.park,
    road: verdantPalette.ivoryBright,
    roadCasing: verdantPalette.roadCasing,
    roadMajor: verdantPalette.ivoryBright,
    text: verdantPalette.ink,
    textHalo: verdantPalette.halo,
    textMuted: verdantPalette.inkMuted,
    water: verdantPalette.water,
  },
  modules: {
    boundaries: {
      admin: verdantPalette.inkMuted,
      disputed: verdantPalette.coral,
      major: verdantPalette.boundary,
      maritime: verdantPalette.waterLabel,
    },
    buildings: {
      active: verdantPalette.buildingActive,
      businessCorridor: verdantPalette.building,
      businessCorridorOutline: verdantPalette.buildingOutline,
      civic: verdantPalette.building,
      commercial: verdantPalette.buildingActive,
      destination: verdantPalette.building,
      extrusion: verdantPalette.building,
      fill: verdantPalette.building,
      generic: verdantPalette.building,
      highRise: verdantPalette.building,
      highRiseOutline: verdantPalette.buildingOutline,
      industrial: '#D6D8D2',
      lowRise: verdantPalette.building,
      lowRiseOutline: verdantPalette.buildingOutline,
      outline: verdantPalette.buildingOutline,
      residential: verdantPalette.building,
    },
    hydro: {
      ferry: verdantPalette.waterLabel,
      label: verdantPalette.waterLabel,
      water: verdantPalette.water,
      waterway: verdantPalette.waterDeep,
    },
    labels: {
      country: verdantPalette.ink,
      halo: verdantPalette.halo,
      muted: verdantPalette.inkMuted,
      neighborhood: verdantPalette.inkMuted,
      poi: verdantPalette.ink,
      primary: verdantPalette.ink,
      road: verdantPalette.inkMuted,
      settlement: verdantPalette.ink,
      water: verdantPalette.waterLabel,
    },
    landcover: {
      farmland: verdantPalette.farmland,
      flowerbed: '#E6E0B5',
      grass: verdantPalette.grass,
      ice: verdantPalette.ice,
      meadow: '#E9F0C0',
      protected: verdantPalette.protected,
      recreationGround: '#D2ECC0',
      rock: '#C8C1AE',
      sand: verdantPalette.sand,
      scrub: verdantPalette.scrub,
      urbanPark: verdantPalette.park,
      villageGreen: '#CAEBB7',
      wetland: verdantPalette.wetland,
      wood: verdantPalette.wood,
    },
    landuse: {
      cemetery: '#C7E5B1',
      civic: '#E8E9E2',
      commercial: '#E9E9E3',
      education: '#E5EDDC',
      government: '#E8E9E2',
      industrial: '#E2E3DE',
      medical: '#E9E7E2',
      military: '#DEDFD9',
      parking: '#E7E7E1',
      recreation: '#C2E8AD',
      residential: '#ECECE6',
    },
    poi: {
      coffee: verdantPalette.inkMuted,
      culture: verdantPalette.coral,
      education: verdantPalette.park,
      food: verdantPalette.coral,
      halo: verdantPalette.halo,
      health: verdantPalette.coral,
      icon: verdantPalette.ink,
      label: verdantPalette.ink,
      lodging: '#9A6A7B',
      services: verdantPalette.inkMuted,
      shopping: verdantPalette.cycleway,
      transit: verdantPalette.transit,
    },
    roads: {
      bridge: verdantPalette.roadPrimary,
      casing: verdantPalette.roadCasing,
      ferry: verdantPalette.waterLabel,
      minor: verdantPalette.roadMinor,
      motorway: verdantPalette.roadMotorway,
      path: verdantPalette.footway,
      primary: verdantPalette.roadPrimary,
      rail: verdantPalette.transit,
      secondary: verdantPalette.roadSecondary,
      trunk: verdantPalette.roadTrunk,
      tunnel: '#DDD8D0',
    },
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.012,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.028},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.018},
    roads: {font: 'Noto Sans Regular', letterSpacing: 0.014},
    water: {font: 'Noto Sans Regular', letterSpacing: 0.045},
  },
} satisfies TileflowThemeConfig;

export const verdant = defineMap({
  id: 'verdant',
  version: 1,
  name: 'Verdant',
  extends: streets,
  icons: [...streets.icons, verdantIcons],
  light: {
    anchor: 'viewport',
    color: '#FFF0B8',
    intensity: 0.2,
    position: [1.15, 205, 38],
  },
  modules: {
    addresses: addresses({labels: {minZoom: 19}}),
    buildings: buildings({
      businessCorridor: {
        fill: {visible: false},
        outline: {visible: false},
      },
      flat: {
        fill: {
          color: verdantPalette.building,
          minZoom: 15,
          opacity: zoom.linear([
            [15, 0],
            [16, 0.38],
            [18, 0.47],
            [22, 0.51],
          ]),
        },
        outline: {visible: false},
      },
      mode: 'flat',
    }),
    labels: labels({
      aerodromeCodes: 'none',
      junctions: false,
      language: 'local',
      places: 'major',
      roadClasses: [
        'motorway',
        'trunk',
        'primary',
        'cycleway',
        'footway',
        'pathway',
        'pedestrian',
        'steps',
      ],
      roads: 'all',
      shields: 'none',
      styles: {
        aerodrome: {visible: false},
        roads: {
          cycleway: verdantActivePathLabel,
          footway: verdantActivePathLabel,
          motorway: verdantGhostRoadLabel,
          pathway: verdantActivePathLabel,
          pedestrian: verdantActivePathLabel,
          primary: verdantGhostRoadLabel,
          steps: {
            ...verdantActivePathLabel,
            text: {...verdantActivePathLabel.text, color: verdantPalette.coral},
          },
          trunk: verdantGhostRoadLabel,
        },
      },
      water: 'major',
    }),
    land: land({
      background: {color: verdantPalette.background},
      globalLandcover: {
        color: expression<string>([
          'match',
          ['get', semanticField('class')],
          'barren',
          '#C8C1AE',
          'crop',
          verdantPalette.farmland,
          'grass',
          verdantPalette.grass,
          'shrub',
          verdantPalette.scrub,
          'snow',
          verdantPalette.ice,
          'trees',
          verdantPalette.wood,
          'urban',
          '#E5E2DA',
          'rgba(0, 0, 0, 0)',
        ]),
        maxZoom: 9,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.92],
          [6, 0.88],
          [8, 0.46],
          [9, 0],
        ]),
      },
      landcover: {
        farmland: {fill: {color: verdantPalette.farmland, minZoom: 8, opacity: 0.82}},
        flowerbed: {fill: {visible: false}},
        grass: {fill: {color: verdantPalette.grass, minZoom: 8, opacity: 0.82}},
        meadow: {fill: {visible: false}},
        protected: {
          fill: {color: verdantPalette.protected, minZoom: 8, opacity: 0.42},
        },
        recreationGround: {fill: {visible: false}},
        scrub: {fill: {color: verdantPalette.scrub, minZoom: 8, opacity: 0.84}},
        urbanPark: {fill: {visible: false}},
        villageGreen: {fill: {visible: false}},
        wetland: {fill: {color: verdantPalette.wetland, minZoom: 8, opacity: 0.88}},
        wood: {fill: {color: verdantPalette.wood, minZoom: 8, opacity: 0.88}},
      },
      landuse: {
        recreation: {fill: {color: '#C2E8AD', minZoom: 8, opacity: 0.56}},
      },
    }),
    poi: poi({
      preset: 'none',
    }),
    roads: roads({
      areas: {
        pedestrian: {
          fill: {color: '#E6D0B3', minZoom: 13, opacity: 0.66},
          outline: {color: '#BC9B7E', minZoom: 13, opacity: 0.3, width: 0.7},
        },
        pier: {
          fill: {color: verdantPalette.ivory, minZoom: 12, opacity: 0.7},
          outline: {color: verdantPalette.roadCasing, minZoom: 12, opacity: 0.4, width: 0.7},
        },
        road: {fill: {color: '#EAD7C5', minZoom: 13, opacity: 0.46}},
      },
      classes: {
        cycleway: verdantPathStyle(verdantPalette.cycleway, 11),
        footway: verdantPathStyle(verdantPalette.footway, 12),
        minor: verdantRoadRangeStyle(
          12,
          {
            casing: '#DDD2C6',
            fill: verdantPalette.roadMinor,
          },
          {casingOpacity: 0.23, fillOpacity: 0.7},
        ),
        motorway: verdantRoadRangeStyle(
          5,
          {casing: '#B89C8A', fill: verdantPalette.roadMotorway},
          {casingOpacity: 0.38, fillOpacity: 0.88, revealProgressively: true},
        ),
        pathway: verdantPathStyle(verdantPalette.footway, 12),
        pedestrian: verdantPathStyle('#6B9370', 12),
        primary: verdantRoadRangeStyle(
          6,
          {
            casing: '#CBB29A',
            fill: verdantPalette.roadPrimary,
          },
          {casingOpacity: 0.34, fillOpacity: 0.84},
        ),
        secondary: verdantRoadRangeStyle(
          8,
          {
            casing: '#D0BFAE',
            fill: verdantPalette.roadSecondary,
          },
          {casingOpacity: 0.3, fillOpacity: 0.8},
        ),
        service: verdantRoadRangeStyle(
          14,
          {
            casing: '#E2D9D1',
            fill: verdantPalette.roadService,
          },
          {casingOpacity: 0.18, fillOpacity: 0.62},
        ),
        steps: verdantPathStyle('#AD8767', 14, {
          dash: [0.18, 0.15],
          surfaceVisible: true,
        }),
        tertiary: verdantRoadRangeStyle(
          10,
          {
            casing: '#D6CABC',
            fill: verdantPalette.roadTertiary,
          },
          {casingOpacity: 0.27, fillOpacity: 0.76},
        ),
        track: verdantRoadRangeStyle(
          13,
          {casing: '#C9C7AF', fill: '#E6E8D7'},
          {casingOpacity: 0.18, fillOpacity: 0.56},
        ),
        trunk: verdantRoadRangeStyle(
          6,
          {casing: '#C1A78F', fill: verdantPalette.roadTrunk},
          {casingOpacity: 0.36, fillOpacity: 0.86, revealProgressively: true},
        ),
      },
      crossings: {
        image: 'crosswalk',
        minZoom: 18,
        opacity: zoom.linear([
          [18, 0],
          [18.5, 0.58],
          [20, 0.72],
        ]),
      },
      detail: 'all',
      extras: {paths: true},
      hierarchy: 'subtle',
      oneWayMarkers: false,
      outline: 'subtle',
      sidewalks: {
        outline: {color: '#B99F82', minZoom: 17, opacity: 0.24, width: 0.6},
        pattern: {minZoom: 17, opacity: 0.22, pattern: 'verdant-sidewalk'},
        surface: {color: '#E8D7BC', minZoom: 17, opacity: 0.62},
      },
      weight: 'regular',
      widthScale: {
        cycleway: 1.65,
        footway: 1.45,
        minor: 0.76,
        motorway: 0.94,
        pathway: 1.5,
        pedestrian: 1.35,
        primary: 0.9,
        secondary: 0.86,
        service: 0.7,
        steps: 1.2,
        tertiary: 0.82,
        track: 0.72,
        trunk: 0.92,
      },
    }),
    transit: transit({
      cableway: {
        color: verdantPalette.coral,
        dash: [2, 2],
        minZoom: 10,
        opacity: 0.5,
        width: zoom.linear([
          [10, 0.5],
          [16, 1.5],
        ]),
      },
      ferry: {
        color: verdantPalette.waterLabel,
        dash: [2, 1.5],
        minZoom: 5,
        opacity: 0.78,
        width: zoom.linear([
          [5, 0.4],
          [16, 2.4],
        ]),
      },
      rail: {
        bridge: {...verdantTransitStyle, opacity: 0.62},
        surface: verdantTransitStyle,
        tunnel: {...verdantTransitStyle, dash: [2, 1.5], opacity: 0.3},
      },
      railHatching: {
        bridge: {
          color: verdantPalette.ivoryBright,
          dash: [1, 2],
          minZoom: 11,
          opacity: 0.55,
          width: 0.8,
        },
        surface: {
          color: verdantPalette.ivoryBright,
          dash: [1, 2],
          minZoom: 11,
          opacity: 0.5,
          width: 0.8,
        },
        tunnel: {visible: false},
      },
      serviceRail: {
        bridge: {...verdantTransitStyle, minZoom: 12, opacity: 0.38},
        surface: {...verdantTransitStyle, minZoom: 12, opacity: 0.34},
        tunnel: {...verdantTransitStyle, minZoom: 12, opacity: 0.2},
      },
    }),
    vegetation: vegetation({
      flat: {
        color: expression<string>([
          'match',
          ['coalesce', ['get', semanticField('leafType')], ''],
          ['needleleaved', 'needleleaf'],
          '#86B88D',
          ['broadleaved', 'broadleaf'],
          '#98C49A',
          verdantPalette.wood,
        ]),
        minZoom: 15,
        opacity: 0.84,
        strokeColor: '#E9E8C4',
        strokeOpacity: 0.62,
        strokeWidth: 0.9,
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
          verdantPalette.water,
          -200,
          '#A6DDD7',
          -1000,
          '#99D3CF',
          -2000,
          '#8BC6C3',
          -4000,
          '#7DB9B8',
          -6000,
          '#70AEAE',
          verdantPalette.water,
        ]),
        maxZoom: 10,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.8],
          [7, 0.7],
          [9, 0.44],
          [10, 0],
        ]),
      },
      bodies: {
        fill: {color: expression<string>(verdantWaterBodyColor), opacity: 1},
        outline: {
          color: verdantPalette.waterDeep,
          minZoom: 6,
          opacity: 0.42,
          width: zoom.linear([
            [6, 0.25],
            [13, 0.65],
            [18, 1.1],
          ]),
        },
      },
      intermittent: {
        bodies: {fill: {color: verdantPalette.water, opacity: 0.58}},
        waterways: {
          color: verdantPalette.waterDeep,
          dash: [2, 1],
          gapWidth: 0,
          opacity: 0.58,
        },
      },
      waterways: {
        canal: {
          color: verdantPalette.waterDeep,
          gapWidth: zoom.linear([
            [8, 0],
            [13, 0.45],
            [16, 1.5],
            [22, 4],
          ]),
          minZoom: 8,
          opacity: 0.9,
          width: zoom.linear([
            [8, 0.24],
            [16, 0.72],
            [22, 1.25],
          ]),
        },
        other: {
          color: verdantPalette.waterDeep,
          minZoom: 12,
          opacity: 0.78,
          width: zoom.linear([
            [12, 0.25],
            [16, 1.2],
          ]),
        },
        river: {
          color: verdantPalette.waterDeep,
          gapWidth: zoom.linear([
            [6, 0],
            [12, 0.4],
            [16, 2.2],
            [22, 6.5],
          ]),
          minZoom: 6,
          opacity: 0.94,
          width: zoom.linear([
            [6, 0.28],
            [16, 0.9],
            [22, 1.6],
          ]),
        },
        stream: {
          color: verdantPalette.waterDeep,
          gapWidth: zoom.linear([
            [10, 0],
            [16, 0.5],
            [22, 2.2],
          ]),
          minZoom: 10,
          opacity: 0.86,
          width: zoom.linear([
            [10, 0.22],
            [16, 0.58],
            [22, 1],
          ]),
        },
      },
    }),
  },
  ...defineModuleEffects([
    ...verdantSurfacePathLayerIds.map((target) => removeModuleLayer('roads', target)),
    addModuleLayer(
      'land',
      'land.effects.greenSpace.fill',
      {
        id: 'verdant-green-space-fill',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 8,
        filter: verdantGreenSpaceFilter,
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-color': [
            'match',
            verdantFeatureSubclass,
            'garden',
            '#D0EDBB',
            'meadow',
            '#E9F0C0',
            'recreation_ground',
            '#D2ECC0',
            'village_green',
            '#CAEBB7',
            'flowerbed',
            '#E6E0B5',
            verdantPalette.park,
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.86, 15, 0.94],
        },
      },
      {after: 'land.landcover.wood.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.greenSpace.xylem',
      {
        id: 'verdant-green-space-xylem',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 13.5,
        maxzoom: 18,
        filter: verdantGreenSpaceFilter,
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            0,
            12,
            0.13,
            15,
            0.24,
            17,
            0.12,
            18,
            0,
          ],
          'fill-pattern': 'verdant-xylem',
        },
      },
      {after: 'land.effects.greenSpace.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.greenSpace.seedEdge',
      {
        id: 'verdant-green-space-seed-edge',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 14,
        maxzoom: 20,
        filter: verdantGreenSpaceFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'land'},
        paint: {
          'line-color': [
            'match',
            verdantFeatureSubclass,
            ['garden', 'flowerbed'],
            '#86A888',
            'meadow',
            '#9CAE87',
            '#8FAC86',
          ],
          'line-dasharray': [0.32, 1.42],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            0,
            13,
            0.28,
            17,
            0.42,
            20,
            0.24,
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 0.8, 19, 1.25],
        },
      },
      {after: 'land.effects.greenSpace.xylem'},
    ),
    addModuleLayer(
      'roads',
      'roads.effects.ordinaryTrack',
      {
        id: 'verdant-ordinary-track-stroke',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 13,
        filter: verdantOrdinaryTrackFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'roads'},
        paint: {
          'line-color': '#96A27B',
          'line-dasharray': [3, 2],
          'line-opacity': 0.5,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.35, 15, 0.62, 18, 1],
        },
      },
      {before: 'roads.classes.motorway.surface.fill'},
    ),
    addModuleLayer(
      'roads',
      'roads.effects.activeNetwork',
      {
        id: 'verdant-active-network-stroke',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 11,
        filter: verdantActiveNetworkFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'roads'},
        paint: {
          'line-color': verdantActiveNetworkColor,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 0.55, 13, 0.9, 14, 1],
          'line-width': verdantActiveNetworkStrokeWidth,
        },
      },
      {after: 'roads.classes.motorway.surface.fill'},
    ),
    addModuleLayer(
      'labels',
      'labels.landscape',
      {
        id: 'verdant-landscape-label',
        type: 'symbol',
        source: 'tileflow',
        'source-layer': semanticLayer('park'),
        minzoom: 14,
        maxzoom: 18,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['has', semanticField('name')],
          ['<=', ['to-number', ['get', semanticField('rank')], 999], 3],
        ],
        layout: {
          'symbol-sort-key': ['to-number', ['get', semanticField('rank')], 999],
          'text-field': ['get', semanticField('name')],
          'text-font': ['Noto Sans Regular'],
          'text-letter-spacing': 0.08,
          'text-max-width': 9,
          'text-optional': true,
          'text-padding': 7,
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13, 17, 16],
          'text-transform': 'uppercase',
        },
        metadata: {'tileflow:module': 'labels'},
        paint: {
          'text-color': verdantPalette.ink,
          'text-halo-color': verdantPalette.halo,
          'text-halo-width': 1.6,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.66, 14, 0.82],
        },
      },
      {before: 'labels.places.town'},
    ),
    addModuleLayer(
      'land',
      'land.effects.farmlandPattern',
      {
        id: 'verdant-landcover-farmland-pattern',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 9,
        maxzoom: 17,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Polygon'],
          ['match', verdantFeatureClass, ['farmland'], true, false],
        ],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9,
            0,
            11,
            0.24,
            14,
            0.34,
            16,
            0.14,
            17,
            0,
          ],
          'fill-pattern': 'verdant-crop-rows',
        },
      },
      {after: 'land.landcover.farmland.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.wetlandPattern',
      {
        id: 'verdant-landcover-wetland-pattern',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 10,
        maxzoom: 17,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Polygon'],
          ['match', verdantFeatureClass, ['wetland'], true, false],
        ],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            0,
            12,
            0.28,
            14,
            0.38,
            16,
            0.16,
            17,
            0,
          ],
          'fill-pattern': 'verdant-wetland-ripples',
        },
      },
      {after: 'land.landcover.wetland.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.woodPattern',
      {
        id: 'verdant-landcover-wood-pattern',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 9,
        maxzoom: 17,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Polygon'],
          ['match', verdantFeatureClass, ['wood', 'forest'], true, false],
        ],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9,
            0,
            11,
            0.22,
            14,
            0.32,
            16,
            0.14,
            17,
            0,
          ],
          'fill-pattern': 'verdant-wood-stipple',
        },
      },
      {after: 'land.landcover.wood.fill'},
    ),
  ]),
  projection: 'globe',
  terrain: 'none',
  theme: verdantTheme,
  view: {
    bearing: 0,
    center: [-3.69275, 40.40866],
    pitch: 0,
    zoom: 14,
  },
});
