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
  type TileflowThemeConfig,
  transit,
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
import {verdantIcons} from '../assets';

/**
 * A contemporary field-atlas palette: cool paper, flat blue hydrography,
 * graphite structures, restrained greens, and a coral walking network.
 */
const verdantPalette = {
  aeroway: '#AAB2AD',
  boundary: '#89938E',
  boundaryMuted: '#AEB6B1',

  building: '#737B76',
  buildingActive: '#4F5A54',
  buildingOutline: '#434A46',

  crop: '#EEEBD9',
  grass: '#E5ECD9',
  meadow: '#DCE8D2',
  scrub: '#D8E2D2',
  wood: '#C8DCC4',
  woodDark: '#476653',
  protected: '#D7E6D2',
  protectedOutline: '#55745F',

  rock: '#E1E0DA',
  sand: '#F1E3BF',
  wetland: '#D3E7DC',
  ice: '#EAF3F4',

  paper: '#F4F5F1',
  paperBright: '#FCFCF9',
  halo: '#FAFBF8',

  ink: '#28332F',
  inkMuted: '#69766F',

  water: '#B8DDE7',
  waterInk: '#4D8392',

  road: '#FCFCF9',
  roadCasing: '#8C958F',
  roadMajor: '#E9944B',
  roadPrimary: '#F2C66C',
  roadSecondary: '#F7DDA3',

  trail: '#C55237',
  trailMuted: '#806A57',
  rail: '#3F4C48',
} as const;

function verdantRoadStyle(
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
    opacity: options.casingOpacity ?? 0.68,
  };
  const fill = {
    color: fillColor,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.fillOpacity ?? 0.94,
  };

  return {
    bridge: {
      casing: {...casing, opacity: Math.min(1, (options.casingOpacity ?? 0.68) + 0.12)},
      fill: {...fill, color: fillColor},
    },
    surface: {casing, fill},
    tunnel: {
      casing: {
        ...casing,
        color: verdantPalette.boundaryMuted,
        dash: [2, 1.5],
        opacity: options.tunnelOpacity ?? 0.3,
      },
      fill: {
        ...fill,
        color: verdantPalette.paperBright,
        dash: [2, 1.5],
        opacity: options.tunnelOpacity ?? 0.42,
      },
    },
  };
}

function verdantPathStyle(
  color: string,
  minZoom: number,
  dash: readonly number[] = [2.2, 1.5],
): TileflowRoadClassStyle {
  return verdantRoadStyle(color, verdantPalette.paperBright, minZoom, {
    casingOpacity: 0.24,
    dash,
    fillOpacity: 0.8,
    tunnelOpacity: 0.25,
  });
}

const verdantRoadLabel = {
  placement: 'line',
  priority: 62,
  spacing: 320,
  text: {
    color: verdantPalette.ink,
    font: 'Noto Sans Regular',
    haloBlur: 0.3,
    haloColor: verdantPalette.halo,
    haloWidth: 1.55,
    letterSpacing: 0.018,
    maxAngle: 26,
    padding: 3,
    size: zoom.linear([
      [10, 9],
      [17, 13],
    ]),
  },
} satisfies TileflowSymbolStyle;

const verdantTrailLabel = {
  ...verdantRoadLabel,
  minZoom: 14,
  priority: 72,
  spacing: 260,
  text: {
    ...verdantRoadLabel.text,
    color: verdantPalette.trail,
    font: 'Noto Sans Bold',
    haloWidth: 1.55,
    letterSpacing: 0.015,
    size: zoom.linear([
      [14, 9],
      [18, 12],
    ]),
  },
} satisfies TileflowSymbolStyle;

const verdantFeatureClass = ['coalesce', ['get', semanticField('class')], ''];
const verdantFeatureSubclass = ['coalesce', ['get', semanticField('subclass')], ''];

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
  const minimumZoom = options.minZoom ?? 8;
  const classFilter = ['match', verdantFeatureClass, classes, true, false];
  const filter = options.subclasses
    ? ['all', classFilter, ['match', verdantFeatureSubclass, options.subclasses, true, false]]
    : classFilter;

  return addModuleLayer(
    'land',
    'land.effects.pattern.' + id,
    {
      id: 'verdant-landcover-' + id + '-pattern',
      type: 'fill',
      source: 'tileflow',
      'source-layer': semanticLayer('landcover'),
      minzoom: minimumZoom,
      filter,
      paint: {
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          minimumZoom,
          0,
          minimumZoom + 1,
          options.opacity ?? 0.74,
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
    'land.effects.pattern.' + id,
    {
      id: 'verdant-landuse-' + id + '-pattern',
      type: 'fill',
      source: 'tileflow',
      'source-layer': semanticLayer('landuse'),
      minzoom: minZoom,
      filter: ['match', verdantFeatureClass, classes, true, false],
      paint: {
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], minZoom, 0, minZoom + 1, opacity],
        'fill-pattern': pattern,
      },
    },
    {after: target},
  );
}

export const verdantTheme = {
  mode: 'light',
  colors: {
    background: verdantPalette.paper,
    boundary: verdantPalette.boundary,
    building: verdantPalette.building,
    land: verdantPalette.paper,
    park: verdantPalette.wood,
    road: verdantPalette.road,
    roadCasing: verdantPalette.roadCasing,
    roadMajor: verdantPalette.roadMajor,
    text: verdantPalette.ink,
    textHalo: verdantPalette.halo,
    textMuted: verdantPalette.inkMuted,
    water: verdantPalette.water,
  },
  modules: {
    boundaries: {
      admin: verdantPalette.boundary,
      disputed: verdantPalette.trail,
      major: verdantPalette.boundary,
      maritime: verdantPalette.waterInk,
    },
    buildings: {
      active: verdantPalette.buildingActive,
      businessCorridor: '#E9ECE8',
      businessCorridorOutline: verdantPalette.buildingOutline,
      civic: verdantPalette.buildingActive,
      commercial: verdantPalette.building,
      destination: verdantPalette.buildingActive,
      extrusion: verdantPalette.building,
      fill: verdantPalette.building,
      generic: verdantPalette.building,
      highRise: verdantPalette.buildingActive,
      highRiseOutline: verdantPalette.buildingOutline,
      industrial: '#68716C',
      lowRise: verdantPalette.building,
      lowRiseOutline: verdantPalette.buildingOutline,
      outline: verdantPalette.buildingOutline,
      residential: verdantPalette.building,
    },
    hydro: {
      ferry: verdantPalette.waterInk,
      label: verdantPalette.waterInk,
      water: verdantPalette.water,
      waterway: verdantPalette.waterInk,
    },
    labels: {
      country: verdantPalette.ink,
      halo: verdantPalette.halo,
      muted: verdantPalette.inkMuted,
      neighborhood: verdantPalette.inkMuted,
      poi: verdantPalette.ink,
      primary: verdantPalette.ink,
      road: verdantPalette.ink,
      settlement: verdantPalette.ink,
      water: verdantPalette.waterInk,
    },
    landcover: {
      farmland: verdantPalette.crop,
      flowerbed: '#E1E9D4',
      grass: verdantPalette.grass,
      ice: verdantPalette.ice,
      meadow: verdantPalette.meadow,
      protected: verdantPalette.protected,
      recreationGround: '#DDE9D4',
      rock: verdantPalette.rock,
      sand: verdantPalette.sand,
      scrub: verdantPalette.scrub,
      urbanPark: verdantPalette.protected,
      villageGreen: '#DCE9D4',
      wetland: verdantPalette.wetland,
      wood: verdantPalette.wood,
    },
    landuse: {
      cemetery: '#DCE7D6',
      civic: '#ECEEEA',
      commercial: '#EEEDEA',
      education: '#E8EEE5',
      government: '#ECEEEA',
      industrial: '#E5E7E3',
      medical: '#EEEAE8',
      military: '#E8E4E0',
      parking: '#E8EAE7',
      recreation: '#DCE9D4',
      residential: '#E9ECE8',
    },
    poi: {
      coffee: verdantPalette.trailMuted,
      culture: verdantPalette.trail,
      education: verdantPalette.woodDark,
      food: verdantPalette.trailMuted,
      halo: verdantPalette.halo,
      health: verdantPalette.trail,
      icon: '#385A48',
      label: verdantPalette.ink,
      lodging: verdantPalette.woodDark,
      services: verdantPalette.inkMuted,
      shopping: verdantPalette.woodDark,
      transit: verdantPalette.rail,
    },
    roads: {
      bridge: verdantPalette.roadMajor,
      casing: verdantPalette.roadCasing,
      ferry: verdantPalette.waterInk,
      minor: verdantPalette.road,
      motorway: verdantPalette.roadMajor,
      path: verdantPalette.trail,
      primary: verdantPalette.roadPrimary,
      rail: verdantPalette.rail,
      secondary: verdantPalette.roadSecondary,
      trunk: verdantPalette.roadMajor,
      tunnel: verdantPalette.paperBright,
    },
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.012,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.025},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.015},
    roads: {font: 'Noto Sans Regular', letterSpacing: 0.018},
    water: {font: 'Noto Sans Regular', letterSpacing: 0.035},
  },
} satisfies TileflowThemeConfig;

/**
 * A self-contained natural field map. Verdant uses Tileflow's semantic
 * compiler contract directly and owns its complete design and asset set.
 */
export const verdant = defineRootMap({
  id: 'verdant',
  version: 1,
  name: 'Verdant',
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
  icons: [verdantIcons],
  light: {
    anchor: 'viewport',
    color: '#FFFFFF',
    intensity: 0.03,
    position: [1.15, 210, 34],
  },
  projection: 'mercator',
  terrain: 'none',
  theme: verdantTheme,
  modules: {
    addresses: addresses({
      labels: {
        minZoom: 19,
        text: {
          color: verdantPalette.inkMuted,
          font: 'Noto Sans Regular',
          haloColor: verdantPalette.halo,
          haloWidth: 1,
          size: 9,
        },
      },
    }),
    aeroways: aeroways({
      area: {
        fill: {color: '#E5E8E4', minZoom: 10, opacity: 0.5},
        outline: {color: verdantPalette.aeroway, minZoom: 10, opacity: 0.45, width: 0.65},
      },
      runway: {
        casing: {color: verdantPalette.aeroway, minZoom: 10, opacity: 0.52},
        fill: {color: verdantPalette.paperBright, minZoom: 10, opacity: 0.92},
      },
      runwayRef: {visible: false},
      taxiway: {
        casing: {color: verdantPalette.aeroway, minZoom: 13, opacity: 0.36},
        fill: {color: verdantPalette.paperBright, minZoom: 13, opacity: 0.86},
      },
    }),
    boundaries: boundaries({
      admin2: {
        color: verdantPalette.boundary,
        dash: [5, 3],
        minZoom: 2,
        opacity: 0.48,
        width: zoom.linear([
          [2, 0.55],
          [10, 1.2],
        ]),
      },
      admin4: {
        color: verdantPalette.boundaryMuted,
        dash: [3, 3],
        minZoom: 5,
        opacity: 0.38,
        width: zoom.linear([
          [5, 0.4],
          [12, 0.8],
        ]),
      },
      disputed: {
        color: verdantPalette.trail,
        dash: [2, 1],
        minZoom: 3,
        opacity: 0.68,
        width: 1,
      },
      maritime: {
        color: verdantPalette.waterInk,
        dash: [4, 3],
        minZoom: 3,
        opacity: 0.36,
        width: 0.7,
      },
    }),
    buildings: buildings({
      businessCorridor: {
        fill: {visible: false},
        outline: {visible: false},
      },
      flat: {
        fill: {
          color: verdantPalette.building,
          minZoom: 13.5,
          opacity: zoom.linear([
            [13.5, 0],
            [14.5, 0.72],
            [16, 0.86],
          ]),
        },
        outline: {
          color: verdantPalette.buildingOutline,
          minZoom: 14.5,
          opacity: 0.72,
          width: zoom.linear([
            [14.5, 0.3],
            [18, 0.78],
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
        aerodrome: {
          minZoom: 10,
          text: {
            color: verdantPalette.inkMuted,
            font: 'Noto Sans Regular',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 10,
          },
        },
        places: {
          continent: {
            maxZoom: 3.5,
            minZoom: 0,
            text: {
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Bold',
              haloColor: verdantPalette.halo,
              haloWidth: 1.5,
              letterSpacing: 0.04,
              size: zoom.linear([
                [0, 10],
                [3, 14],
              ]),
            },
          },
          country: {
            minZoom: 1,
            text: {
              color: verdantPalette.ink,
              font: 'Noto Sans Bold',
              haloColor: verdantPalette.halo,
              haloWidth: 1.6,
              letterSpacing: 0.04,
              size: zoom.linear([
                [1, 10],
                [7, 17],
              ]),
              transform: 'uppercase',
            },
          },
          state: {
            minZoom: 4,
            text: {
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.5,
              letterSpacing: 0.025,
              size: zoom.linear([
                [4, 10],
                [9, 14],
              ]),
            },
          },
          city: {
            minZoom: 4,
            text: {
              color: verdantPalette.ink,
              font: 'Noto Sans Bold',
              haloBlur: 0.35,
              haloColor: verdantPalette.halo,
              haloWidth: 1.65,
              letterSpacing: 0.02,
              size: zoom.linear([
                [4, 12],
                [13, 20],
              ]),
            },
          },
          town: {
            minZoom: 7,
            text: {
              color: verdantPalette.ink,
              font: 'Noto Sans Bold',
              haloColor: verdantPalette.halo,
              haloWidth: 1.55,
              letterSpacing: 0.018,
              size: zoom.linear([
                [7, 10],
                [14, 16],
              ]),
            },
          },
          village: {
            minZoom: 9,
            text: {
              color: verdantPalette.ink,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.5,
              letterSpacing: 0.012,
              size: zoom.linear([
                [9, 9],
                [15, 13],
              ]),
            },
          },
          neighborhood: {
            minZoom: 12,
            text: {
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.45,
              letterSpacing: 0.015,
              size: zoom.linear([
                [12, 9],
                [16, 12],
              ]),
            },
          },
          other: {
            minZoom: 12,
            text: {
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.45,
              size: 9,
            },
          },
        },
        roads: {
          cycleway: {
            ...verdantTrailLabel,
            priority: 48,
            text: {
              ...verdantTrailLabel.text,
              color: verdantPalette.woodDark,
              font: 'Noto Sans Regular',
            },
          },
          footway: {
            ...verdantTrailLabel,
            priority: 38,
            text: {
              ...verdantTrailLabel.text,
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
            },
          },
          minor: {...verdantRoadLabel, minZoom: 14},
          motorway: {...verdantRoadLabel, minZoom: 8},
          pathway: verdantTrailLabel,
          pedestrian: {
            ...verdantTrailLabel,
            priority: 36,
            text: {
              ...verdantTrailLabel.text,
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
            },
          },
          primary: {...verdantRoadLabel, minZoom: 10},
          secondary: {...verdantRoadLabel, minZoom: 11},
          service: {...verdantRoadLabel, minZoom: 16},
          steps: {
            ...verdantTrailLabel,
            priority: 34,
            text: {
              ...verdantTrailLabel.text,
              color: verdantPalette.inkMuted,
              font: 'Noto Sans Regular',
            },
          },
          tertiary: {...verdantRoadLabel, minZoom: 12},
          track: {
            ...verdantTrailLabel,
            text: {...verdantTrailLabel.text, color: verdantPalette.trailMuted},
          },
          trunk: {...verdantRoadLabel, minZoom: 9},
        },
        water: {
          line: {
            text: {
              color: verdantPalette.waterInk,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.4,
              letterSpacing: 0.03,
              size: 12,
            },
          },
          ocean: {
            text: {
              color: verdantPalette.waterInk,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.45,
              letterSpacing: 0.04,
              size: zoom.linear([
                [1, 11],
                [8, 17],
              ]),
            },
          },
          other: {
            text: {
              color: verdantPalette.waterInk,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.4,
              letterSpacing: 0.025,
            },
          },
          waterway: {
            minZoom: 12,
            text: {
              color: verdantPalette.waterInk,
              font: 'Noto Sans Regular',
              haloColor: verdantPalette.halo,
              haloWidth: 1.35,
              letterSpacing: 0.02,
            },
          },
        },
      },
      water: 'all',
    }),
    land: land({
      background: {
        color: verdantPalette.paper,
        opacity: 1,
      },
      globalLandcover: {
        color: expression<string>([
          'match',
          ['get', semanticField('class')],
          'barren',
          verdantPalette.rock,
          'crop',
          'rgba(0, 0, 0, 0)',
          'grass',
          'rgba(0, 0, 0, 0)',
          'shrub',
          verdantPalette.scrub,
          'snow',
          verdantPalette.ice,
          'trees',
          verdantPalette.wood,
          'urban',
          'rgba(0, 0, 0, 0)',
          'rgba(0, 0, 0, 0)',
        ]),
        maxZoom: 8,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.18],
          [5, 0.14],
          [8, 0],
        ]),
      },
      landcover: {
        farmland: {fill: {color: verdantPalette.crop, minZoom: 8, opacity: 0.58}},
        flowerbed: {fill: {color: '#E1E9D4', minZoom: 12, opacity: 0.7}},
        grass: {fill: {color: verdantPalette.grass, minZoom: 8, opacity: 0.58}},
        ice: {fill: {color: verdantPalette.ice, minZoom: 7, opacity: 0.82}},
        meadow: {fill: {color: verdantPalette.meadow, minZoom: 8, opacity: 0.68}},
        protected: {
          fill: {color: verdantPalette.protected, minZoom: 7, opacity: 0.82},
          outline: {
            color: verdantPalette.protectedOutline,
            minZoom: 8,
            opacity: 0.58,
            width: 0.75,
          },
        },
        recreationGround: {fill: {color: '#DDE9D4', minZoom: 9, opacity: 0.72}},
        rock: {fill: {color: verdantPalette.rock, minZoom: 8, opacity: 0.72}},
        sand: {fill: {color: verdantPalette.sand, minZoom: 8, opacity: 0.82}},
        scrub: {fill: {color: verdantPalette.scrub, minZoom: 8, opacity: 0.7}},
        urbanPark: {
          fill: {color: verdantPalette.protected, minZoom: 8, opacity: 0.82},
          outline: {
            color: verdantPalette.protectedOutline,
            minZoom: 10,
            opacity: 0.52,
            width: 0.65,
          },
        },
        villageGreen: {fill: {color: '#DCE9D4', minZoom: 10, opacity: 0.76}},
        wetland: {fill: {color: verdantPalette.wetland, minZoom: 8, opacity: 0.78}},
        wood: {
          fill: {color: verdantPalette.wood, minZoom: 8, opacity: 0.76},
          outline: {color: verdantPalette.woodDark, minZoom: 12, opacity: 0.32, width: 0.5},
        },
      },
      landuse: {
        cemetery: {
          fill: {color: '#DCE7D6', minZoom: 10, opacity: 0.68},
          outline: {color: verdantPalette.woodDark, minZoom: 12, opacity: 0.4, width: 0.55},
        },
        civic: {fill: {color: '#ECEEEA', minZoom: 10, opacity: 0.62}},
        commercial: {fill: {color: '#EEEDEA', minZoom: 10, opacity: 0.58}},
        education: {fill: {color: '#E8EEE5', minZoom: 10, opacity: 0.64}},
        government: {fill: {color: '#ECEEEA', minZoom: 10, opacity: 0.6}},
        industrial: {fill: {color: '#E5E7E3', minZoom: 10, opacity: 0.62}},
        medical: {fill: {color: '#EEEAE8', minZoom: 11, opacity: 0.62}},
        military: {fill: {color: '#E8E4E0', minZoom: 9, opacity: 0.54}},
        parking: {
          fill: {color: '#E8EAE7', minZoom: 16, opacity: 0.7},
          outline: {color: verdantPalette.roadCasing, minZoom: 17, opacity: 0.32, width: 0.45},
        },
        railway: {fill: {color: '#E4E7E4', minZoom: 11, opacity: 0.58}},
        recreation: {
          fill: {color: '#DCE9D4', minZoom: 9, opacity: 0.72},
          outline: {
            color: verdantPalette.protectedOutline,
            minZoom: 13,
            opacity: 0.38,
            width: 0.55,
          },
        },
        residential: {fill: {color: '#E9ECE8', minZoom: 9, opacity: 0.66}},
      },
    }),
    landforms: landforms({
      elevation: true,
      classes: {
        arete: {
          minZoom: 14,
          text: {
            color: verdantPalette.inkMuted,
            font: 'Noto Sans Regular',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
        cliff: {
          minZoom: 13,
          text: {
            color: verdantPalette.inkMuted,
            font: 'Noto Sans Regular',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
        peak: {
          minZoom: 9,
          text: {
            color: verdantPalette.ink,
            font: 'Noto Sans Bold',
            haloColor: verdantPalette.halo,
            haloWidth: 1.1,
            size: zoom.linear([
              [9, 9],
              [15, 12],
            ]),
          },
        },
        ridge: {
          minZoom: 14,
          text: {
            color: verdantPalette.inkMuted,
            font: 'Noto Sans Regular',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
        saddle: {
          minZoom: 13,
          text: {
            color: verdantPalette.trailMuted,
            font: 'Noto Sans Regular',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
        volcano: {
          minZoom: 8,
          text: {
            color: verdantPalette.trail,
            font: 'Noto Sans Bold',
            haloColor: verdantPalette.halo,
            haloWidth: 1,
            size: 10,
          },
        },
      },
    }),
    poi: poi({
      categories: [
        'coffee',
        'culture',
        'education',
        'food',
        'health',
        'lodging',
        'major-transit',
        'services',
        'shopping',
      ],
      classMapping: {
        culture: ['art_gallery', 'attraction', 'memorial', 'monument', 'viewpoint'],
        food: ['ice_cream'],
        health: ['emergency_phone', 'first_aid'],
        lodging: ['alpine_hut', 'camp_site', 'caravan_site', 'wilderness_hut'],
        'major-transit': ['railway', 'station', 'subway'],
        services: [
          'drinking_water',
          'information',
          'picnic_site',
          'ranger_station',
          'shelter',
          'toilets',
          'trailhead',
          'town_hall',
        ],
        shopping: ['clothing_store', 'grocery'],
      },
      color: 'category',
      density: 'sparse',
      icons: 'full',
      labels: 'balanced',
      maxRank: zoom.step([
        [14, 6],
        [15, 18],
        [16, 48],
        [18, 140],
        [20, 260],
      ]),
      minZoom: 14,
      placement: {
        coupleIconAndLabel: false,
        iconPadding: 4,
        textPadding: 8,
      },
      preset: 'balanced',
      styles: {
        coffee: {
          minZoom: 17,
          priority: 28,
          icon: {color: '#385A48', size: 0.9},
          text: {
            color: verdantPalette.trailMuted,
            haloColor: verdantPalette.halo,
            haloWidth: 1.4,
          },
        },
        culture: {
          minZoom: 14,
          priority: 96,
          icon: {color: '#385A48', size: 0.95},
          text: {
            color: verdantPalette.woodDark,
            haloColor: verdantPalette.halo,
            haloWidth: 1.55,
          },
        },
        education: {
          minZoom: 16,
          priority: 48,
          icon: {color: '#385A48', size: 0.9},
          text: {
            color: verdantPalette.woodDark,
            haloColor: verdantPalette.halo,
            haloWidth: 1.45,
          },
        },
        food: {
          minZoom: 16.5,
          priority: 34,
          icon: {color: '#385A48', size: 0.9},
          text: {
            color: verdantPalette.trailMuted,
            haloColor: verdantPalette.halo,
            haloWidth: 1.4,
          },
        },
        health: {
          minZoom: 14,
          priority: 98,
          icon: {color: verdantPalette.trail, size: 0.95},
          text: {
            color: verdantPalette.trail,
            haloColor: verdantPalette.halo,
            haloWidth: 1.5,
          },
        },
        lodging: {
          minZoom: 14.5,
          priority: 92,
          icon: {color: '#385A48', size: 0.95},
          text: {
            color: verdantPalette.woodDark,
            haloColor: verdantPalette.halo,
            haloWidth: 1.45,
          },
        },
        'major-transit': {
          maxRank: 60,
          minZoom: 15,
          priority: 70,
          icon: {color: '#385A48', size: 0.92},
          text: {
            color: verdantPalette.rail,
            haloColor: verdantPalette.halo,
            haloWidth: 1.55,
          },
        },
        services: {
          minZoom: 14,
          priority: 100,
          icon: {color: '#385A48', size: 0.95},
          text: {
            color: verdantPalette.woodDark,
            haloColor: verdantPalette.halo,
            haloWidth: 1.4,
          },
        },
        shopping: {
          minZoom: 17,
          priority: 26,
          icon: {color: '#385A48', size: 0.88},
          text: {
            color: verdantPalette.woodDark,
            haloColor: verdantPalette.halo,
            haloWidth: 1.4,
          },
        },
      },
    }),
    roads: roads({
      areas: {
        pedestrian: {
          fill: {color: '#F0F1ED', minZoom: 13, opacity: 0.9},
          outline: {color: verdantPalette.roadCasing, minZoom: 14, opacity: 0.3, width: 0.6},
        },
        pier: {
          fill: {color: verdantPalette.paperBright, minZoom: 12, opacity: 0.96},
          outline: {color: verdantPalette.waterInk, minZoom: 12, opacity: 0.42, width: 0.65},
        },
        road: {fill: {color: verdantPalette.road, minZoom: 13, opacity: 0.94}},
      },
      classes: {
        cycleway: verdantPathStyle(verdantPalette.woodDark, 13, [3, 1.5]),
        footway: verdantPathStyle('#7E8983', 14, [1.4, 1.3]),
        minor: verdantRoadStyle(verdantPalette.road, verdantPalette.roadCasing, 12, {
          casingOpacity: 0.42,
          fillOpacity: 0.98,
        }),
        motorway: verdantRoadStyle(verdantPalette.roadMajor, '#8C5B35', 5, {
          casingOpacity: 0.72,
        }),
        pathway: verdantPathStyle(verdantPalette.trailMuted, 13, [3, 1.5]),
        pedestrian: verdantPathStyle('#7E8983', 13, [1, 1.4]),
        primary: verdantRoadStyle(verdantPalette.roadPrimary, verdantPalette.roadCasing, 7, {
          casingOpacity: 0.62,
        }),
        secondary: verdantRoadStyle(verdantPalette.roadSecondary, verdantPalette.roadCasing, 9, {
          casingOpacity: 0.5,
        }),
        service: verdantRoadStyle(verdantPalette.road, verdantPalette.roadCasing, 14, {
          casingOpacity: 0.28,
          fillOpacity: 0.96,
        }),
        steps: verdantPathStyle('#7E8983', 15, [0.3, 0.25]),
        tertiary: verdantRoadStyle(verdantPalette.road, verdantPalette.roadCasing, 10, {
          casingOpacity: 0.46,
          fillOpacity: 0.98,
        }),
        track: verdantPathStyle(verdantPalette.trailMuted, 13, [4, 2]),
        trunk: verdantRoadStyle('#EDAA57', '#A46A3E', 6, {
          casingOpacity: 0.68,
        }),
      },
      crossings: {
        image: 'crosswalk',
        minZoom: 18,
        opacity: zoom.linear([
          [18, 0],
          [18.5, 0.62],
          [20, 0.78],
        ]),
      },
      detail: 'all',
      extras: {paths: true},
      hierarchy: 'clear',
      modifiers: {
        construction: {
          surface: {
            casing: {dash: [2, 1], opacity: 0.36},
            fill: {dash: [2, 1], opacity: 0.52},
          },
        },
        indoor: {
          surface: {
            casing: {opacity: 0.16},
            fill: {dash: [1, 1], opacity: 0.26},
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
            casing: {dash: [1, 1], opacity: 0.3},
            fill: {dash: [1, 1], opacity: 0.4},
          },
        },
      },
      sidewalks: {
        outline: {color: verdantPalette.roadCasing, minZoom: 17, opacity: 0.22, width: 0.5},
        surface: {color: '#E7EAE6', minZoom: 17, opacity: 0.7},
      },
      weight: 'thin',
      widthScale: {
        cycleway: 0.82,
        footway: 0.74,
        minor: 0.8,
        motorway: 0.9,
        pathway: 0.72,
        pedestrian: 0.76,
        primary: 0.9,
        secondary: 0.86,
        service: 0.7,
        steps: 0.64,
        tertiary: 0.82,
        track: 0.7,
        trunk: 0.9,
      },
    }),
    transit: transit({
      cableway: {
        color: verdantPalette.inkMuted,
        dash: [2, 2],
        minZoom: 10,
        opacity: 0.46,
        width: 0.8,
      },
      ferry: {
        color: verdantPalette.waterInk,
        dash: [4, 2],
        minZoom: 5,
        opacity: 0.7,
        width: zoom.linear([
          [5, 0.5],
          [16, 1.9],
        ]),
      },
      rail: {
        bridge: {color: verdantPalette.rail, minZoom: 7, opacity: 0.86, width: 1.35},
        surface: {color: verdantPalette.rail, minZoom: 7, opacity: 0.8, width: 1.2},
        tunnel: {
          color: verdantPalette.rail,
          dash: [2, 1.5],
          minZoom: 9,
          opacity: 0.38,
          width: 1,
        },
      },
      railHatching: {
        bridge: {color: verdantPalette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.7},
        surface: {color: verdantPalette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.65},
        tunnel: {visible: false},
      },
      serviceRail: {
        bridge: {color: verdantPalette.rail, minZoom: 12, opacity: 0.5, width: 0.8},
        surface: {color: verdantPalette.rail, minZoom: 12, opacity: 0.46, width: 0.74},
        tunnel: {
          color: verdantPalette.rail,
          dash: [2, 1.5],
          minZoom: 12,
          opacity: 0.26,
          width: 0.68,
        },
      },
    }),
    vegetation: vegetation({
      flat: {
        color: expression<string>([
          'match',
          ['coalesce', ['get', semanticField('leafType')], ''],
          ['needleleaved', 'needleleaf'],
          verdantPalette.woodDark,
          ['broadleaved', 'broadleaf'],
          '#607650',
          verdantPalette.wood,
        ]),
        minZoom: 15,
        opacity: 0.82,
        radius: zoom.linear([
          [15, 1.5],
          [19, 4],
        ]),
        strokeColor: verdantPalette.paperBright,
        strokeOpacity: 0.55,
        strokeWidth: 0.65,
      },
      minZoom: 15,
      mode: 'flat',
    }),
    water: water({
      bathymetry: {
        color: verdantPalette.water,
        maxZoom: 9,
        minZoom: 0,
        opacity: 0,
      },
      bodies: {
        fill: {color: verdantPalette.water, opacity: 1},
        outline: {
          color: verdantPalette.waterInk,
          minZoom: 9,
          opacity: 0.45,
          width: zoom.linear([
            [9, 0.3],
            [14, 0.7],
            [18, 1.05],
          ]),
        },
      },
      intermittent: {
        bodies: {fill: {color: verdantPalette.water, opacity: 0.62}},
        waterways: {
          color: verdantPalette.waterInk,
          dash: [3, 2],
          opacity: 0.46,
        },
      },
      waterways: {
        canal: {
          color: verdantPalette.waterInk,
          minZoom: 8,
          opacity: 0.88,
          width: zoom.linear([
            [8, 0.35],
            [16, 1.8],
          ]),
        },
        other: {
          color: verdantPalette.waterInk,
          minZoom: 12,
          opacity: 0.68,
          width: zoom.linear([
            [12, 0.25],
            [17, 1],
          ]),
        },
        river: {
          color: verdantPalette.waterInk,
          minZoom: 6,
          opacity: 0.92,
          width: zoom.linear([
            [6, 0.4],
            [16, 2.2],
          ]),
        },
        stream: {
          color: verdantPalette.waterInk,
          minZoom: 10,
          opacity: 0.8,
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
      'verdant-field-hatch',
      ['farmland'],
      {minZoom: 13, opacity: 0.3},
    ),
    landcoverPattern('scrub', 'land.landcover.scrub.fill', 'verdant-heath-tufts', ['grass'], {
      minZoom: 14,
      opacity: 0.24,
      subclasses: ['scrub'],
    }),
    landcoverPattern('meadow', 'land.landcover.meadow.fill', 'verdant-meadow-tufts', ['grass'], {
      minZoom: 14,
      opacity: 0.22,
      subclasses: ['meadow'],
    }),
    landcoverPattern('orchard', 'land.landcover.urbanPark.fill', 'verdant-orchard', ['grass'], {
      minZoom: 15,
      opacity: 0.28,
      subclasses: ['garden'],
    }),
    landcoverPattern('rock', 'land.landcover.rock.fill', 'verdant-scree', ['rock'], {
      minZoom: 14,
      opacity: 0.24,
    }),
    landcoverPattern(
      'wetland',
      'land.landcover.wetland.fill',
      'verdant-wetland-reeds',
      ['wetland'],
      {minZoom: 13, opacity: 0.32},
    ),
    landcoverPattern(
      'wood',
      'land.landcover.wood.fill',
      'verdant-forest-canopy',
      ['wood', 'forest'],
      {minZoom: 13, opacity: 0.28},
    ),
    landusePattern(
      'residential',
      'land.landuse.residential.fill',
      'verdant-residential-hatch',
      ['residential'],
      14,
      0.18,
    ),
    addModuleLayer(
      'water',
      'water.effects.printLines',
      {
        id: 'verdant-water-lines-pattern',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 15,
        filter: ['!=', ['to-number', ['get', semanticField('intermittent')], 0], 1],
        paint: {
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.12, 19, 0.16],
          'fill-pattern': 'verdant-water-lines',
        },
      },
      {after: 'water.bodies.fill'},
    ),
    addModuleLayer(
      'water',
      'water.effects.intermittentPrintLines',
      {
        id: 'verdant-water-intermittent-lines-pattern',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 15,
        filter: ['==', ['to-number', ['get', semanticField('intermittent')], 0], 1],
        paint: {
          'fill-opacity': 0.12,
          'fill-pattern': 'verdant-water-lines',
        },
      },
      {after: 'water.intermittent.bodies.fill'},
    ),
    addModuleLayer(
      'buildings',
      'buildings.effects.printShadow',
      {
        id: 'verdant-building-print-shadow',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 14,
        paint: {
          'fill-pattern': 'verdant-paper-fiber',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, 0.012, 18, 0.022],
          'fill-translate': [0.45, 0.55],
          'fill-translate-anchor': 'viewport',
        },
      },
      {before: 'buildings.flat.fill'},
    ),
    addModuleLayer(
      'roads',
      'roads.effects.trailEmphasis',
      {
        id: 'verdant-trail-emphasis',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 12.5,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          [
            'any',
            [
              'all',
              ['==', ['get', semanticField('class')], 'path'],
              ['match', ['get', semanticField('subclass')], ['path', 'bridleway'], true, false],
            ],
            [
              'all',
              ['==', ['get', semanticField('class')], 'track'],
              [
                'any',
                [
                  'match',
                  ['get', semanticField('foot')],
                  ['yes', 'designated', 'official'],
                  true,
                  false,
                ],
                [
                  'match',
                  ['get', semanticField('bicycle')],
                  ['yes', 'designated', 'official'],
                  true,
                  false,
                ],
                ['has', semanticField('mtbScale')],
              ],
            ],
          ],
          ['!=', ['to-number', ['get', semanticField('indoor')], 0], 1],
          ['match', ['get', semanticField('brunnel')], ['bridge', 'tunnel'], false, true],
          [
            'match',
            ['coalesce', ['get', semanticField('access')], 'unknown'],
            ['no', 'private'],
            false,
            true,
          ],
        ],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
          'line-color': verdantPalette.trail,
          'line-dasharray': [3, 1.5],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 0.78, 15, 0.96],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0.4, 15, 1.5, 18, 2.9],
        },
      },
      {after: 'roads.classes.pedestrian.surface.fill'},
    ),
    addModuleLayer(
      'labels',
      'labels.landscape',
      {
        id: 'verdant-landscape-label',
        type: 'symbol',
        source: 'tileflow',
        'source-layer': semanticLayer('park'),
        minzoom: 10,
        maxzoom: 18,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['has', semanticField('name')],
          ['<=', ['to-number', ['get', semanticField('rank')], 999], 4],
        ],
        layout: {
          'symbol-sort-key': ['to-number', ['get', semanticField('rank')], 999],
          'text-field': ['get', semanticField('name')],
          'text-font': ['Noto Sans Regular'],
          'text-letter-spacing': 0.04,
          'text-max-width': 10,
          'text-optional': true,
          'text-padding': 7,
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13, 17, 16],
          'text-transform': 'uppercase',
        },
        paint: {
          'text-color': verdantPalette.woodDark,
          'text-halo-color': verdantPalette.halo,
          'text-halo-width': 1.6,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.7, 14, 0.9],
        },
      },
      {before: 'labels.places.town'},
      {requires: ['land']},
    ),
  ]),
  view: {
    center: [-3.69275, 40.40866],
    pitch: 0,
    bearing: 0,
    zoom: 14,
  },
});
