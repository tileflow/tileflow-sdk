import {
  bathymetry,
  boundaries,
  defineMap,
  disable,
  expr,
  field,
  fixed,
  labels,
  land,
  landforms,
  nautical as nauticalMarks,
  renderPass,
  transit,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {officialGlyphsUrl, soundingsIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * A restrained paper-chart palette informed by NOAA paper charts and IHO S-4.
 * Magenta is reserved for operational overlays; it is never decorative.
 */
const nauticalPalette = {
  ink: '#263D3F',
  inkMuted: '#647777',
  land: '#EADDB9',
  landDetail: '#DFD2AF',
  landMuted: '#D6C9A8',
  magenta: '#B12A73',
  sand: '#E8D7A8',
  water: '#F2F8FB',
  waterDeep: '#F7FAFC',
  waterInk: '#466B7A',
  waterLabel: '#2E5365',
  waterMid: '#D5E7F1',
  waterShallow: '#B9DCEB',
  wetland: '#D5DDBB',
} as const;

const hiddenTransitRail = {
  bridge: {visible: false},
  surface: {visible: false},
  tunnel: {visible: false},
} as const;

export const nauticalTheme = defineOfficialTheme({
  id: 'nautical-light',
  version: 1,
  colorScheme: 'light',
  colors: {
    background: nauticalPalette.land,
    boundary: nauticalPalette.inkMuted,
    building: nauticalPalette.landDetail,
    land: nauticalPalette.land,
    park: nauticalPalette.landMuted,
    road: nauticalPalette.land,
    roadCasing: nauticalPalette.land,
    roadMajor: nauticalPalette.land,
    text: nauticalPalette.ink,
    textHalo: nauticalPalette.land,
    textMuted: nauticalPalette.inkMuted,
    water: nauticalPalette.water,
  },
  modules: {
    boundaries: {
      admin: nauticalPalette.inkMuted,
      disputed: nauticalPalette.magenta,
      major: nauticalPalette.inkMuted,
      maritime: nauticalPalette.magenta,
    },
    hydro: {
      'depth.m0': nauticalPalette.waterShallow,
      'depth.m200': nauticalPalette.waterMid,
      'depth.m2000': '#EDF4F8',
      'depth.m7000': nauticalPalette.waterDeep,
      ferry: nauticalPalette.waterInk,
      label: nauticalPalette.waterLabel,
      water: nauticalPalette.water,
      waterway: nauticalPalette.waterInk,
    },
    labels: {
      country: nauticalPalette.ink,
      halo: nauticalPalette.land,
      muted: nauticalPalette.inkMuted,
      neighborhood: nauticalPalette.inkMuted,
      poi: nauticalPalette.ink,
      primary: nauticalPalette.ink,
      road: nauticalPalette.inkMuted,
      settlement: nauticalPalette.ink,
      water: nauticalPalette.waterLabel,
    },
    landcover: {
      farmland: nauticalPalette.landDetail,
      flowerbed: nauticalPalette.landDetail,
      grass: nauticalPalette.landDetail,
      ice: '#F1F2E8',
      meadow: nauticalPalette.landDetail,
      protected: nauticalPalette.landMuted,
      recreationGround: nauticalPalette.landDetail,
      rock: nauticalPalette.landMuted,
      sand: nauticalPalette.sand,
      scrub: nauticalPalette.landMuted,
      urbanPark: nauticalPalette.landDetail,
      villageGreen: nauticalPalette.landDetail,
      wetland: nauticalPalette.wetland,
      wood: nauticalPalette.landMuted,
    },
    landuse: {
      cemetery: nauticalPalette.landDetail,
      civic: nauticalPalette.landDetail,
      commercial: nauticalPalette.landDetail,
      education: nauticalPalette.landDetail,
      government: nauticalPalette.landDetail,
      industrial: nauticalPalette.landMuted,
      medical: nauticalPalette.landDetail,
      military: nauticalPalette.landMuted,
      parking: nauticalPalette.land,
      recreation: nauticalPalette.landDetail,
      residential: nauticalPalette.landDetail,
    },
    poi: {
      halo: nauticalPalette.water,
      icon: nauticalPalette.ink,
      label: nauticalPalette.ink,
      'public-services': nauticalPalette.ink,
      transport: nauticalPalette.magenta,
      'visitor-amenity': nauticalPalette.ink,
    },
    roads: {
      ferry: nauticalPalette.waterInk,
      rail: nauticalPalette.inkMuted,
    },
  },
  // Nautical marks use the chart symbols of this directory. They are single-colour silhouettes:
  // buoys, light flares and notice boards take each mark's own colour, the others print in ink.
  images: {
    'nautical.buoy': 'soundings-buoy-pillar',
    'nautical.buoy.cardinal': 'soundings-buoy-cardinal',
    'nautical.buoy.port': 'soundings-buoy-port',
    'nautical.buoy.starboard': 'soundings-buoy-starboard',
    'nautical.distance-mark': 'soundings-distance-mark',
    'nautical.facility': 'soundings-facility',
    'nautical.facility.boat-hoist': 'soundings-boat-hoist',
    'nautical.facility.boatyard': 'soundings-boatyard',
    'nautical.facility.fuel-station': 'soundings-fuel-station',
    'nautical.facility.pump-out': 'soundings-pump-out',
    'nautical.facility.slipway': 'soundings-slipway',
    'nautical.facility.visitor-berth': 'soundings-visitor-berth',
    'nautical.facility.water-tap': 'soundings-water-tap',
    'nautical.harbour': 'soundings-harbor',
    'nautical.light': 'soundings-light-flare',
    'nautical.lighthouse': 'soundings-lighthouse',
    'nautical.marina': 'soundings-marina',
    'nautical.notice': 'soundings-notice',
    'nautical.notice.information': 'soundings-notice-information',
    'nautical.notice.prohibition': 'soundings-notice-prohibition',
    'nautical.notice.recommendation': 'soundings-notice-recommendation',
    'nautical.notice.regulation': 'soundings-notice-regulation',
    'nautical.notice.restriction': 'soundings-notice-restriction',
    'nautical.port': 'soundings-harbor',
    'nautical.wreck': 'soundings-wreck',
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.025,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.1, transform: 'uppercase'},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.035},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Bold', letterSpacing: 0.12, transform: 'uppercase'},
  },
  lighting: {
    anchor: 'viewport',
    color: '#F6EFD8',
    intensity: 0.08,
    position: [1.15, 210, 28],
  },
});

const chartInk = {color: nauticalPalette.ink, haloColor: nauticalPalette.water} as const;
const marineText = {
  color: nauticalPalette.waterLabel,
  font: 'Noto Sans Bold',
  haloColor: nauticalPalette.waterDeep,
  haloWidth: 1.5,
  haloBlur: 0.25,
} as const;

/**
 * A self-contained bathymetric-chart map. It shares only Tileflow's public
 * compiler contract; it neither imports nor extends the Streets map.
 *
 * Bathymetry supplies depth bands, model-derived contours and continuous relief
 * from its global and regional sources, rather than a certified navigation chart.
 * Its depths and vertical references are contextual. Nautical marks are reference cartography, and this map must
 * not be used for navigation.
 */
export const nautical = bindOfficialMapTheme(
  defineMap({
    id: 'nautical',
    version: 1,
    name: 'Nautical',
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    glyphs: {
      kind: 'url',
      url: officialGlyphsUrl,
      fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    },
    icons: [soundingsIcons],
    themes: {light: nauticalTheme},
    defaultTheme: 'light',
    projection: 'mercator',
    marine: {
      bathymetry: bathymetry({
        display: 'hybrid',
        vectorLayers: {contours: true, landforms: true, waterNames: true},
        relief: {
          exaggeration: fixed(0.24, {
            reason: 'Nautical gives the continuous seabed enough form to remain legible',
          }),
          multidirectional: true,
          opacity: fixed(0.18, {
            reason: 'Nautical balances continuous relief with vector depth bands and labels',
          }),
        },
      }),
      nautical: {},
    },
    terrain: 'none',
    modules: {
      addresses: disable(),
      aeroways: disable(),
      boundaries: boundaries({
        admin2: {
          color: nauticalPalette.inkMuted,
          dash: [7, 2, 1, 2],
          minZoom: 2,
          opacity: 0.46,
          width: zoom.linear([
            [2, 0.45],
            [10, 0.85],
          ]),
        },
        admin4: {
          color: nauticalPalette.inkMuted,
          dash: [2, 2],
          minZoom: 6,
          opacity: 0.28,
          width: 0.55,
        },
        disputed: {
          color: nauticalPalette.magenta,
          dash: [3, 1.5],
          minZoom: 3,
          opacity: 0.78,
          width: 1,
        },
        maritime: {
          color: nauticalPalette.magenta,
          dash: [7, 3, 1.25, 3],
          minZoom: 3,
          opacity: 0.66,
          width: zoom.linear([
            [3, 0.65],
            [10, 1.15],
          ]),
        },
      }),
      buildings: disable(),
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
                color: nauticalPalette.inkMuted,
                font: 'Noto Sans Bold',
                haloColor: nauticalPalette.land,
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
                color: nauticalPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: nauticalPalette.land,
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
                color: nauticalPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: nauticalPalette.land,
                haloWidth: 1.25,
                letterSpacing: 0.11,
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 5,
              text: {
                color: nauticalPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: nauticalPalette.land,
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
                color: nauticalPalette.ink,
                font: 'Noto Sans Regular',
                haloColor: nauticalPalette.land,
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
                color: nauticalPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: nauticalPalette.land,
                haloWidth: 1.1,
                letterSpacing: 0.07,
                size: 10,
                transform: 'uppercase',
              },
            },
            neighborhood: {
              minZoom: 13,
              text: {
                color: nauticalPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: nauticalPalette.land,
                haloWidth: 1,
                letterSpacing: 0.08,
                size: 9,
                transform: 'uppercase',
              },
            },
          },
          water: {
            ocean: {
              // Bathymetry supplies marine names through z6; World takes over at z7.
              minZoom: 7,
              text: {
                ...marineText,
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
                ...marineText,
                letterSpacing: 0.1,
                transform: 'uppercase',
              },
            },
            line: {
              minZoom: 8,
              text: {
                ...marineText,
                letterSpacing: 0.08,
                transform: 'uppercase',
              },
            },
            waterway: {
              minZoom: 11,
              text: {
                ...marineText,
                letterSpacing: 0.08,
                transform: 'uppercase',
              },
            },
          },
        },
        water: 'all',
      }),
      land: land({
        // Buildings are off, and so are the areas where their activity concentrates.
        activityAreas: {fill: {visible: false}, outline: {visible: false}},
        background: {opacity: 1, pattern: 'soundings-paper-grain'},
        globalLandcover: {
          color: expr.match(
            expr.get(field('class')),
            [
              {labels: 'barren', value: nauticalPalette.landMuted},
              {labels: 'crop', value: nauticalPalette.landDetail},
              {labels: 'grass', value: nauticalPalette.landDetail},
              {labels: 'shrub', value: nauticalPalette.landMuted},
              {labels: 'snow', value: '#F1F2E8'},
              {labels: 'trees', value: nauticalPalette.landMuted},
              {labels: 'urban', value: nauticalPalette.landDetail},
            ],
            'rgba(0, 0, 0, 0)',
          ),
          maxZoom: 9,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.42],
            [7, 0.3],
            [9, 0],
          ]),
        },
        landcover: {
          farmland: {fill: {color: nauticalPalette.landDetail, minZoom: 9, opacity: 0.25}},
          grass: {fill: {color: nauticalPalette.landDetail, minZoom: 9, opacity: 0.22}},
          ice: {fill: {color: '#F1F2E8', minZoom: 5, opacity: 0.72}},
          rock: {fill: {color: nauticalPalette.landMuted, minZoom: 8, opacity: 0.35}},
          sand: {fill: {color: nauticalPalette.sand, minZoom: 8, opacity: 0.55}},
          wetland: {fill: {color: nauticalPalette.wetland, minZoom: 9, opacity: 0.44}},
          wood: {fill: {color: nauticalPalette.landMuted, minZoom: 9, opacity: 0.28}},
        },
      }),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 11,
            text: {
              color: nauticalPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: nauticalPalette.land,
              haloWidth: 1,
              size: 9,
            },
          },
          peak: {
            minZoom: 8,
            text: {
              color: nauticalPalette.ink,
              font: 'Noto Sans Regular',
              haloColor: nauticalPalette.land,
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
              color: nauticalPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: nauticalPalette.land,
              haloWidth: 1,
              size: 10,
            },
          },
        },
      }),
      // Marks keep the module's data-driven colours and placement; Nautical only sets its
      // printed ink. Technical magenta stays on operational areas, traffic separation and cables.
      nautical: nauticalMarks({
        beacons: {marker: {strokeColor: nauticalPalette.ink}},
        // Bridges and berths are structures, printed in the chart ink like piers.
        berths: {outline: {color: nauticalPalette.ink}},
        bridges: {outline: {color: nauticalPalette.ink}},
        buoys: {icon: {haloColor: nauticalPalette.ink}, text: chartInk},
        distanceMarks: {icon: chartInk, text: {...chartInk, color: nauticalPalette.inkMuted}},
        facilities: {icon: chartInk, text: {...chartInk, color: nauticalPalette.inkMuted}},
        harbours: {icon: chartInk, text: {...chartInk, color: nauticalPalette.inkMuted}},
        hazards: {marker: {strokeColor: nauticalPalette.ink}, text: chartInk},
        labels: {bridges: {text: chartInk}},
        lighthouses: {icon: chartInk, text: chartInk},
        lights: {text: {...chartInk, color: nauticalPalette.inkMuted}},
        notices: {icon: {haloColor: nauticalPalette.water}, text: chartInk},
        ports: {icon: chartInk, text: chartInk},
        wrecks: {icon: chartInk, text: chartInk},
      }),
      // A broad transport category also contains airports, bus terminals and rail stations.
      // Painting all of them with a harbor glyph would be semantically false; harbours and ports
      // come from the dedicated Nautical layer instead of reinterpreting the World POI contract.
      poi: disable(),
      roads: disable(),
      transit: withRenderStack(
        transit({
          cableway: {visible: false},
          ferry: {
            color: nauticalPalette.waterInk,
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
        {
          // Ferry names are operational context, not a recommended track.
          ferryLabels: renderPass({
            placement: {above: 'transit.ferry'},
            feature: 'roadLabel',
            renderer: 'symbol',
            selector: {
              kind: 'all',
              selectors: [
                {geometry: 'line', kind: 'geometry'},
                {field: 'name', kind: 'has'},
                {
                  kind: 'any',
                  selectors: [
                    {field: 'class', kind: 'compare', operator: 'eq', value: 'ferry'},
                    {field: 'type', kind: 'compare', operator: 'eq', value: 'ferry'},
                  ],
                },
              ],
            },
            style: {
              minZoom: 9.5,
              placement: 'line',
              spacing: 480,
              text: {
                ...marineText,
                field: expr.get(field('name')),
                keepUpright: true,
                letterSpacing: 0.06,
                maxAngle: 25,
                opacity: zoom.linear([
                  [9.5, 0.9],
                  [11, 1],
                ]),
                optional: true,
                padding: 12,
                size: zoom.linear([
                  [9.5, 10.5],
                  [14, 12],
                ]),
                transform: 'uppercase',
              },
            },
          }),
        },
      ),
      vegetation: disable(),
      water: withRenderStack(
        water({
          bathymetry: {
            antialias: true,
            // The shared depth roles also colour the DEM, preserving the chart's
            // blue shallows and near-white deep water in both representations.
            maxZoom: 24,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.98],
              [8, 0.92],
              [9, 0.68],
              [12, 0.68],
            ]),
          },
          // Native isobaths start at z8. Keep their source detail when zooming in;
          // overzooming does not turn model-derived depths into safety contours.
          bathymetryContours: {
            color: nauticalPalette.waterInk,
            dash: [4, 2],
            join: 'round',
            maxZoom: 24,
            minZoom: 8,
            opacity: zoom.linear([
              [8, 0.32],
              [9.75, 0.72],
            ]),
            width: zoom.linear([
              [8, 0.45],
              [9.75, 0.75],
            ]),
          },
          bathymetryLabels: {
            maxZoom: 24,
            minZoom: 8,
            placement: 'line',
            spacing: 320,
            text: {
              ...marineText,
              allowOverlap: false,
              // Read the depth of the actual line, not a polygon edge or tile boundary.
              field: expr.concat(
                expr.toString(
                  expr.abs(expr.toNumber(expr.get(field('bathymetryContourDepth')), 0)),
                ),
                ' m',
              ),
              keepUpright: true,
              letterSpacing: 0.04,
              maxAngle: 20,
              opacity: zoom.linear([
                [8, 0.92],
                [9.5, 1],
              ]),
              padding: 18,
              size: zoom.linear([
                [8, 11],
                [10, 12],
              ]),
              transform: 'none',
            },
          },
          bathymetryWaterNames: {
            maxZoom: 7,
            text: {
              ...marineText,
              opacity: 1,
              size: expr.match(
                expr.get(field('class')),
                [
                  {labels: 'ocean', value: 16},
                  {labels: 'sea', value: 14},
                ],
                11,
              ),
            },
          },
          bodies: {
            fill: {color: nauticalPalette.water, opacity: 0.98},
            outline: {
              color: nauticalPalette.ink,
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
            bodies: {fill: {color: nauticalPalette.waterShallow, opacity: 0.54}},
            waterways: {color: nauticalPalette.waterInk, dash: [3, 2], opacity: 0.48},
          },
          waterways: {
            canal: {
              color: nauticalPalette.waterInk,
              minZoom: 8,
              opacity: 0.78,
              width: zoom.linear([
                [8, 0.35],
                [16, 1.65],
              ]),
            },
            other: {
              color: nauticalPalette.waterInk,
              minZoom: 12,
              opacity: 0.58,
              width: zoom.linear([
                [12, 0.25],
                [17, 0.9],
              ]),
            },
            river: {
              color: nauticalPalette.waterInk,
              minZoom: 6,
              opacity: 0.82,
              width: zoom.linear([
                [6, 0.4],
                [16, 2.1],
              ]),
            },
            stream: {
              color: nauticalPalette.waterInk,
              minZoom: 10,
              opacity: 0.68,
              width: zoom.linear([
                [10, 0.28],
                [16, 1.1],
              ]),
            },
          },
        }),
        {
          // Piers remain visible even though the terrestrial road family is disabled.
          // A dark outer stroke and ivory deck read as charted shoreline structures.
          pierOutline: renderPass({
            placement: {above: 'water.bodies.outline'},
            feature: 'road',
            renderer: 'line',
            selector: {
              kind: 'any',
              selectors: [
                {field: 'class', kind: 'compare', operator: 'eq', value: 'pier'},
                {field: 'type', kind: 'compare', operator: 'eq', value: 'pier'},
              ],
            },
            style: {
              cap: 'round',
              color: nauticalPalette.ink,
              join: 'round',
              minZoom: 12.5,
              opacity: zoom.linear([
                [12.5, 0],
                [13, 0.82],
                [17, 0.96],
              ]),
              width: zoom.linear([
                [12.5, 1.2],
                [15, 2.5],
                [18, 5.2],
              ]),
            },
          }),
          pierDeck: renderPass({
            placement: {above: 'water.render.pierOutline'},
            feature: 'road',
            renderer: 'line',
            selector: {
              kind: 'any',
              selectors: [
                {field: 'class', kind: 'compare', operator: 'eq', value: 'pier'},
                {field: 'type', kind: 'compare', operator: 'eq', value: 'pier'},
              ],
            },
            style: {
              cap: 'round',
              color: nauticalPalette.land,
              join: 'round',
              minZoom: 12.5,
              opacity: zoom.linear([
                [12.5, 0],
                [13, 1],
              ]),
              width: zoom.linear([
                [12.5, 0.35],
                [15, 1.25],
                [18, 3.4],
              ]),
            },
          }),
          chartDots: renderPass({
            placement: {above: 'water.bodies.fill'},
            feature: 'water',
            renderer: 'fill',
            selector: {field: 'intermittent', kind: 'compare', operator: 'ne', value: true},
            style: {
              minZoom: 7,
              opacity: zoom.linear([
                [7, 0.08],
                [13, 0.14],
                [18, 0.08],
              ]),
              pattern: 'soundings-water-dots',
            },
          }),
          intermittentChartDots: renderPass({
            placement: {above: 'water.intermittent.bodies.fill'},
            feature: 'water',
            renderer: 'fill',
            selector: {field: 'intermittent', kind: 'compare', operator: 'eq', value: true},
            style: {minZoom: 9, opacity: 0.16, pattern: 'soundings-water-dots'},
          }),
        },
      ),
    },
    view: {
      center: [-5.6, 36.05],
      pitch: 0,
      bearing: 0,
      zoom: 6.75,
    },
  }),
);
