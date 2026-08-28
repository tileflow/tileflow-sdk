import {
  addresses,
  aeroways,
  bathymetry,
  boundaries,
  buildings,
  defineRootMap,
  expression,
  fixed,
  labels,
  land,
  landforms,
  poi,
  roads,
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
import {soundingsIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * A restrained paper-chart palette informed by NOAA paper charts and IHO S-4.
 * Magenta is reserved for operational overlays; it is never decorative.
 */
const soundingsPalette = {
  ink: '#263D3F',
  inkMuted: '#647777',
  land: '#EADDB9',
  landDetail: '#DFD2AF',
  landMuted: '#D6C9A8',
  magenta: '#B12A73',
  sand: '#E8D7A8',
  water: '#F7FBF8',
  waterDeep: '#F8FAF5',
  waterInk: '#466F73',
  waterMid: '#D5E8E6',
  waterShallow: '#BBDDDC',
  wetland: '#D5DDBB',
} as const;

const hiddenTransitRail = {
  bridge: {visible: false},
  surface: {visible: false},
  tunnel: {visible: false},
} as const;

export const soundingsTheme = defineOfficialTheme({
  id: 'soundings-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: soundingsPalette.land,
    boundary: soundingsPalette.inkMuted,
    building: soundingsPalette.landDetail,
    land: soundingsPalette.land,
    park: soundingsPalette.landMuted,
    road: soundingsPalette.land,
    roadCasing: soundingsPalette.land,
    roadMajor: soundingsPalette.land,
    text: soundingsPalette.ink,
    textHalo: soundingsPalette.land,
    textMuted: soundingsPalette.inkMuted,
    water: soundingsPalette.water,
  },
  modules: {
    boundaries: {
      admin: soundingsPalette.inkMuted,
      disputed: soundingsPalette.magenta,
      major: soundingsPalette.inkMuted,
      maritime: soundingsPalette.magenta,
    },
    hydro: {
      ferry: soundingsPalette.waterInk,
      label: soundingsPalette.waterInk,
      water: soundingsPalette.water,
      waterway: soundingsPalette.waterInk,
    },
    labels: {
      country: soundingsPalette.ink,
      halo: soundingsPalette.land,
      muted: soundingsPalette.inkMuted,
      neighborhood: soundingsPalette.inkMuted,
      poi: soundingsPalette.ink,
      primary: soundingsPalette.ink,
      road: soundingsPalette.inkMuted,
      settlement: soundingsPalette.ink,
      water: soundingsPalette.waterInk,
    },
    landcover: {
      farmland: soundingsPalette.landDetail,
      flowerbed: soundingsPalette.landDetail,
      grass: soundingsPalette.landDetail,
      ice: '#F1F2E8',
      meadow: soundingsPalette.landDetail,
      protected: soundingsPalette.landMuted,
      recreationGround: soundingsPalette.landDetail,
      rock: soundingsPalette.landMuted,
      sand: soundingsPalette.sand,
      scrub: soundingsPalette.landMuted,
      urbanPark: soundingsPalette.landDetail,
      villageGreen: soundingsPalette.landDetail,
      wetland: soundingsPalette.wetland,
      wood: soundingsPalette.landMuted,
    },
    landuse: {
      cemetery: soundingsPalette.landDetail,
      civic: soundingsPalette.landDetail,
      commercial: soundingsPalette.landDetail,
      education: soundingsPalette.landDetail,
      government: soundingsPalette.landDetail,
      industrial: soundingsPalette.landMuted,
      medical: soundingsPalette.landDetail,
      military: soundingsPalette.landMuted,
      parking: soundingsPalette.land,
      recreation: soundingsPalette.landDetail,
      residential: soundingsPalette.landDetail,
    },
    poi: {
      halo: soundingsPalette.water,
      icon: soundingsPalette.ink,
      label: soundingsPalette.ink,
      'public-services': soundingsPalette.ink,
      transport: soundingsPalette.magenta,
      'visitor-amenity': soundingsPalette.ink,
    },
    roads: {
      ferry: soundingsPalette.waterInk,
      rail: soundingsPalette.inkMuted,
    },
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.025,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.1, transform: 'uppercase'},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.035},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular', letterSpacing: 0.16, transform: 'uppercase'},
  },
  lighting: {
    anchor: 'viewport',
    color: '#F6EFD8',
    intensity: 0.08,
    position: [1.15, 210, 28],
  },
});

/**
 * A self-contained bathymetric-chart map. It shares only Tileflow's public
 * compiler contract; it neither imports nor extends the Streets map.
 *
 * GEBCO supplies broad bathymetric bands and a continuous seabed model rather
 * than navigation-grade survey soundings. Dashed band edges and depth labels
 * are contextual, and this map must not be used for navigation.
 */
export const soundings = bindOfficialMapTheme(
  defineRootMap({
    id: 'soundings',
    version: 1,
    name: 'Soundings',
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
    icons: [soundingsIcons],
    themes: {light: soundingsTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    marine: {
      bathymetry: bathymetry({
        display: 'hybrid',
        relief: {
          exaggeration: fixed(0.24, {
            reason: 'Soundings gives the continuous seabed enough form to remain legible',
          }),
          multidirectional: true,
          opacity: fixed(0.18, {
            reason: 'Soundings balances continuous relief with vector depth bands and labels',
          }),
        },
      }),
      nautical: false,
    },
    terrain: 'none',
    modules: {
      addresses: addresses({enabled: false}),
      aeroways: aeroways({enabled: false}),
      boundaries: boundaries({
        admin2: {
          color: soundingsPalette.inkMuted,
          dash: [7, 2, 1, 2],
          minZoom: 2,
          opacity: 0.46,
          width: zoom.linear([
            [2, 0.45],
            [10, 0.85],
          ]),
        },
        admin4: {
          color: soundingsPalette.inkMuted,
          dash: [2, 2],
          minZoom: 6,
          opacity: 0.28,
          width: 0.55,
        },
        disputed: {
          color: soundingsPalette.magenta,
          dash: [3, 1.5],
          minZoom: 3,
          opacity: 0.78,
          width: 1,
        },
        maritime: {
          color: soundingsPalette.magenta,
          dash: [7, 3, 1.25, 3],
          minZoom: 3,
          opacity: 0.66,
          width: zoom.linear([
            [3, 0.65],
            [10, 1.15],
          ]),
        },
      }),
      buildings: buildings({enabled: false}),
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
                color: soundingsPalette.inkMuted,
                font: 'Noto Sans Bold',
                haloColor: soundingsPalette.land,
                haloWidth: 1.25,
                letterSpacing: 0.2,
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
                color: soundingsPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: soundingsPalette.land,
                haloWidth: 1.45,
                letterSpacing: 0.14,
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
                color: soundingsPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.land,
                haloWidth: 1.25,
                letterSpacing: 0.11,
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 5,
              text: {
                color: soundingsPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: soundingsPalette.land,
                haloWidth: 1.5,
                letterSpacing: 0.1,
                size: zoom.linear([
                  [5, 11],
                  [13, 18],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 8,
              text: {
                color: soundingsPalette.ink,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.land,
                haloWidth: 1.3,
                letterSpacing: 0.08,
                size: zoom.linear([
                  [8, 9],
                  [14, 14],
                ]),
                transform: 'uppercase',
              },
            },
            village: {
              minZoom: 10,
              text: {
                color: soundingsPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.land,
                haloWidth: 1.1,
                letterSpacing: 0.07,
                size: 10,
                transform: 'uppercase',
              },
            },
            neighborhood: {
              minZoom: 13,
              text: {
                color: soundingsPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.land,
                haloWidth: 1,
                letterSpacing: 0.08,
                size: 9,
                transform: 'uppercase',
              },
            },
          },
          water: {
            ocean: {
              text: {
                color: soundingsPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.water,
                haloWidth: 1,
                letterSpacing: 0.26,
                size: zoom.linear([
                  [1, 11],
                  [8, 17],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              text: {
                color: soundingsPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.water,
                haloWidth: 1,
                letterSpacing: 0.14,
                transform: 'uppercase',
              },
            },
            line: {
              minZoom: 8,
              text: {
                color: soundingsPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.water,
                haloWidth: 1,
                letterSpacing: 0.12,
                transform: 'uppercase',
              },
            },
            waterway: {
              minZoom: 11,
              text: {
                color: soundingsPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: soundingsPalette.water,
                haloWidth: 1,
                letterSpacing: 0.11,
                transform: 'uppercase',
              },
            },
          },
        },
        water: 'all',
      }),
      land: land({
        background: {opacity: 1, pattern: 'soundings-paper-grain'},
        globalLandcover: {
          color: expression<string>([
            'match',
            ['get', semanticField('class')],
            'barren',
            soundingsPalette.landMuted,
            'crop',
            soundingsPalette.landDetail,
            'grass',
            soundingsPalette.landDetail,
            'shrub',
            soundingsPalette.landMuted,
            'snow',
            '#F1F2E8',
            'trees',
            soundingsPalette.landMuted,
            'urban',
            soundingsPalette.landDetail,
            'rgba(0, 0, 0, 0)',
          ]),
          maxZoom: 9,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.42],
            [7, 0.3],
            [9, 0],
          ]),
        },
        landcover: {
          farmland: {fill: {color: soundingsPalette.landDetail, minZoom: 9, opacity: 0.25}},
          grass: {fill: {color: soundingsPalette.landDetail, minZoom: 9, opacity: 0.22}},
          ice: {fill: {color: '#F1F2E8', minZoom: 5, opacity: 0.72}},
          rock: {fill: {color: soundingsPalette.landMuted, minZoom: 8, opacity: 0.35}},
          sand: {fill: {color: soundingsPalette.sand, minZoom: 8, opacity: 0.55}},
          wetland: {fill: {color: soundingsPalette.wetland, minZoom: 9, opacity: 0.44}},
          wood: {fill: {color: soundingsPalette.landMuted, minZoom: 9, opacity: 0.28}},
        },
      }),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 11,
            text: {
              color: soundingsPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: soundingsPalette.land,
              haloWidth: 1,
              size: 9,
            },
          },
          peak: {
            minZoom: 8,
            text: {
              color: soundingsPalette.ink,
              font: 'Noto Sans Regular',
              haloColor: soundingsPalette.land,
              haloWidth: 1,
              size: zoom.linear([
                [8, 9],
                [14, 11],
              ]),
            },
          },
          volcano: {
            minZoom: 7,
            text: {
              color: soundingsPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: soundingsPalette.land,
              haloWidth: 1,
              size: 10,
            },
          },
        },
      }),
      // A broad transport category also contains airports, bus terminals and rail stations.
      // Painting all of them with a harbor glyph would be semantically false; Soundings waits
      // for its dedicated nautical harbor layer instead of reinterpreting the World POI contract.
      poi: poi({enabled: false}),
      roads: roads({enabled: false}),
      transit: transit({
        cableway: {visible: false},
        ferry: {
          color: soundingsPalette.waterInk,
          dash: [7, 2, 1, 2],
          minZoom: 5,
          opacity: 0.62,
          width: zoom.linear([
            [5, 0.45],
            [15, 1.35],
          ]),
        },
        rail: hiddenTransitRail,
        railHatching: hiddenTransitRail,
        serviceRail: hiddenTransitRail,
      }),
      vegetation: vegetation({enabled: false}),
      water: water({
        bathymetry: {
          antialias: true,
          color: expression<string>([
            'interpolate',
            ['linear'],
            ['to-number', ['get', semanticField('bathymetryMinDepth')], 0],
            -11_000,
            soundingsPalette.waterDeep,
            -8_000,
            '#F7F9F4',
            -6_000,
            '#F5F8F3',
            -4_000,
            '#F3F7F2',
            -2_000,
            '#EDF4EF',
            -1_000,
            '#E4EFEB',
            -500,
            '#DBEBE8',
            -200,
            soundingsPalette.waterMid,
            -100,
            '#C9E4E2',
            -50,
            '#C2E1E0',
            -20,
            '#BFDFDE',
            -10,
            '#BDDEDD',
            0,
            soundingsPalette.waterShallow,
          ]),
          maxZoom: 10,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.98],
            [8, 0.92],
            [9, 0.68],
            [10, 0],
          ]),
        },
        // GEBCO polygons are broad bands: the dashed stroke is an approximate
        // band edge, never a vessel-specific safety contour or surveyed isobath.
        bathymetryContours: {
          color: soundingsPalette.waterInk,
          dash: [4, 2],
          join: 'round',
          maxZoom: 9.75,
          minZoom: 3,
          opacity: zoom.linear([
            [3, 0.2],
            [7, 0.46],
            [9.75, 0.72],
          ]),
          width: zoom.linear([
            [3, 0.3],
            [9.75, 0.75],
          ]),
        },
        bathymetryLabels: {
          maxZoom: 9.5,
          minZoom: 4.5,
          placement: 'line',
          spacing: 320,
          text: {
            allowOverlap: false,
            color: soundingsPalette.waterInk,
            // A band minimum is not enough to infer its next boundary across product revisions.
            // Label the actual value so both the six-band canary and thirteen-stop target stay true.
            field: expression<string>([
              'concat',
              [
                'to-string',
                ['abs', ['to-number', ['get', semanticField('bathymetryMinDepth')], 0]],
              ],
              ' m',
            ]),
            font: 'Noto Sans Regular',
            haloColor: soundingsPalette.water,
            haloWidth: 0.75,
            keepUpright: true,
            maxAngle: 20,
            opacity: zoom.linear([
              [4.5, 0.38],
              [7, 0.68],
              [9.5, 0.82],
            ]),
            padding: 18,
            size: zoom.linear([
              [4.5, 8],
              [9.5, 10],
            ]),
          },
        },
        bodies: {
          fill: {color: soundingsPalette.water, opacity: 0.98},
          outline: {
            color: soundingsPalette.ink,
            minZoom: 4,
            opacity: 0.72,
            width: zoom.linear([
              [4, 0.35],
              [12, 0.75],
              [18, 1.1],
            ]),
          },
        },
        intermittent: {
          bodies: {fill: {color: soundingsPalette.waterShallow, opacity: 0.54}},
          waterways: {color: soundingsPalette.waterInk, dash: [3, 2], opacity: 0.48},
        },
        waterways: {
          canal: {
            color: soundingsPalette.waterInk,
            minZoom: 8,
            opacity: 0.78,
            width: zoom.linear([
              [8, 0.35],
              [16, 1.65],
            ]),
          },
          other: {
            color: soundingsPalette.waterInk,
            minZoom: 12,
            opacity: 0.58,
            width: zoom.linear([
              [12, 0.25],
              [17, 0.9],
            ]),
          },
          river: {
            color: soundingsPalette.waterInk,
            minZoom: 6,
            opacity: 0.82,
            width: zoom.linear([
              [6, 0.4],
              [16, 2.1],
            ]),
          },
          stream: {
            color: soundingsPalette.waterInk,
            minZoom: 10,
            opacity: 0.68,
            width: zoom.linear([
              [10, 0.28],
              [16, 1.1],
            ]),
          },
        },
      }),
    },
    ...defineModuleEffects([
      // Piers remain visible even though the terrestrial road family is disabled.
      // A dark outer stroke and ivory deck read as charted shoreline structures.
      addModuleLayer(
        'water',
        'water.effects.pierOutline',
        {
          id: 'soundings-pier-outline',
          type: 'line',
          source: 'tileflow',
          'source-layer': semanticLayer('road'),
          minzoom: 12.5,
          filter: [
            'any',
            ['==', ['get', semanticField('class')], 'pier'],
            ['==', ['get', semanticField('subclass')], 'pier'],
          ],
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': soundingsPalette.ink,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 0.82, 17, 0.96],
            'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 1.2, 15, 2.5, 18, 5.2],
          },
        },
        {after: 'water.bodies.outline'},
      ),
      addModuleLayer(
        'water',
        'water.effects.pierDeck',
        {
          id: 'soundings-pier-deck',
          type: 'line',
          source: 'tileflow',
          'source-layer': semanticLayer('road'),
          minzoom: 12.5,
          filter: [
            'any',
            ['==', ['get', semanticField('class')], 'pier'],
            ['==', ['get', semanticField('subclass')], 'pier'],
          ],
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': soundingsPalette.land,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 1],
            'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0.35, 15, 1.25, 18, 3.4],
          },
        },
        {after: 'water.effects.pierOutline'},
      ),
      addModuleLayer(
        'water',
        'water.effects.chartDots',
        {
          id: 'soundings-water-dots-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 7,
          filter: ['!=', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.08, 13, 0.14, 18, 0.08],
            'fill-pattern': 'soundings-water-dots',
          },
        },
        {after: 'water.bodies.fill'},
      ),
      addModuleLayer(
        'water',
        'water.effects.intermittentChartDots',
        {
          id: 'soundings-water-intermittent-dots-pattern',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('water'),
          minzoom: 9,
          filter: ['==', ['to-number', ['get', semanticField('intermittent')], 0], 1],
          paint: {'fill-opacity': 0.16, 'fill-pattern': 'soundings-water-dots'},
        },
        {after: 'water.intermittent.bodies.fill'},
      ),
      // Ferry names are operational context, not a recommended track.
      addModuleLayer(
        'transit',
        'transit.effects.ferryLabels',
        {
          id: 'soundings-ferry-route-labels',
          type: 'symbol',
          source: 'tileflow',
          'source-layer': semanticLayer('roadName'),
          minzoom: 9.5,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['has', semanticField('name')],
            [
              'any',
              ['==', ['get', semanticField('class')], 'ferry'],
              ['==', ['get', semanticField('subclass')], 'ferry'],
            ],
          ],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 480,
            'text-field': ['get', semanticField('name')],
            'text-font': ['Noto Sans Regular'],
            'text-keep-upright': true,
            'text-letter-spacing': 0.12,
            'text-max-angle': 25,
            'text-optional': true,
            'text-padding': 12,
            'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 8.5, 14, 10.5],
            'text-transform': 'uppercase',
          },
          paint: {
            'text-color': soundingsPalette.waterInk,
            'text-halo-color': soundingsPalette.water,
            'text-halo-width': 1.15,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 10, 0.68, 14, 0.88],
          },
        },
        {after: 'transit.ferry'},
      ),
    ]),
    view: {
      center: [-5.6, 36.05],
      pitch: 0,
      bearing: 0,
      zoom: 6.75,
    },
  }),
);
