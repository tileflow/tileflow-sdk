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
import {sanFrancistoIcons} from '../assets';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * Architectural blueprint ink on a deep Prussian-blue drawing sheet. The
 * palette deliberately avoids naturalistic land, park, and water colours:
 * geometry, line weight, and hatch vocabulary carry the hierarchy instead:
 * prominent silhouettes, infrastructure, local streets, internal details,
 * land parcels, and auxiliary hatches each occupy a distinct visual tier.
 */
const sanFrancistoPalette = {
  annotation: '#F2E6B9',
  background: '#061D35',
  boundary: '#7EA7BD',
  building: '#123B5C',
  buildingInk: '#E8F0E8',
  buildingMuted: '#91B7C9',
  contour: '#6F9AB2',
  grid: '#426E8A',
  halo: '#082743',
  ink: '#EEF3EA',
  inkMuted: '#9AB9C9',
  inkQuiet: '#6289A0',
  land: '#0A2D4D',
  landDetail: '#0D3455',
  park: '#0B3858',
  rail: '#C5D9D8',
  road: '#8EAFBE',
  roadCasing: '#051A30',
  roadDetail: '#648BA2',
  roadMajor: '#B7CCD1',
  water: '#071F39',
  waterInk: '#82B2CA',
} as const;

function blueprintRoadStyle(
  color: string,
  minZoom: number,
  options: {
    casingOpacity?: number;
    dash?: readonly number[];
    opacity?: number;
    tunnelOpacity?: number;
  } = {},
): TileflowRoadClassStyle {
  const casing = {
    color: sanFrancistoPalette.roadCasing,
    minZoom,
    opacity: options.casingOpacity ?? 0.8,
  };
  const fill = {
    color,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.opacity ?? 0.9,
  };

  return {
    bridge: {
      casing: {...casing, color: sanFrancistoPalette.buildingMuted, opacity: 0.5},
      fill,
    },
    surface: {casing, fill},
    tunnel: {
      casing: {
        ...casing,
        color: sanFrancistoPalette.inkQuiet,
        dash: [3, 2],
        opacity: options.tunnelOpacity ?? 0.28,
      },
      fill: {
        ...fill,
        color: sanFrancistoPalette.road,
        dash: [3, 2],
        opacity: options.tunnelOpacity ?? 0.4,
      },
    },
  };
}

const blueprintRoadLabel = {
  placement: 'line',
  priority: 60,
  spacing: 480,
  text: {
    color: sanFrancistoPalette.inkMuted,
    font: 'Noto Sans Regular',
    haloBlur: 0,
    haloColor: sanFrancistoPalette.halo,
    haloWidth: 1.2,
    letterSpacing: 0.075,
    maxAngle: 24,
    opacity: 0.7,
    padding: 5,
    size: zoom.linear([
      [10, 7.75],
      [18, 10],
    ]),
    transform: 'uppercase',
  },
} satisfies TileflowSymbolStyle;

const blueprintSecondaryRoadLabel = {
  ...blueprintRoadLabel,
  spacing: 600,
  text: {
    ...blueprintRoadLabel.text,
    color: sanFrancistoPalette.roadDetail,
    haloWidth: 0.7,
    letterSpacing: 0.065,
    opacity: 0.5,
    size: zoom.linear([
      [11, 7.5],
      [18, 9.25],
    ]),
  },
} satisfies TileflowSymbolStyle;

const blueprintDetailRoadLabel = {
  ...blueprintRoadLabel,
  spacing: 720,
  text: {
    ...blueprintRoadLabel.text,
    color: sanFrancistoPalette.inkQuiet,
    haloWidth: 0.45,
    letterSpacing: 0.055,
    opacity: zoom.linear([
      [16, 0],
      [17, 0.26],
      [20, 0.36],
    ]),
    padding: 9,
    size: zoom.linear([
      [15, 6.75],
      [19, 8.25],
    ]),
  },
} satisfies TileflowSymbolStyle;

const blueprintPoiLabel = {
  minZoom: 16,
  text: {
    anchor: 'left',
    color: sanFrancistoPalette.inkQuiet,
    font: 'Noto Sans Regular',
    haloColor: sanFrancistoPalette.halo,
    haloWidth: 0.7,
    letterSpacing: 0.055,
    maxWidth: 10,
    offset: [1.2, 0],
    opacity: 0.4,
    padding: 10,
    size: zoom.linear([
      [15, 7.5],
      [18, 9],
    ]),
    transform: 'uppercase',
  },
} as const;

const blueprintPrimaryPoiLabel = {
  minZoom: 15.25,
  text: {
    ...blueprintPoiLabel.text,
    color: sanFrancistoPalette.annotation,
    font: 'Noto Sans Bold',
    opacity: 0.68,
  },
} as const;

const blueprintPoiFilterRank = expr.toNumber(expr.get(field('poiFilterRank')), 6);
const blueprintPoiSizeRank = expr.toNumber(expr.get(field('poiSizeRank')), 17);
const blueprintPoiPlacementPriority = expr.add(
  expr.multiply(blueprintPoiFilterRank, 17),
  blueprintPoiSizeRank,
);
const blueprintPoiCalloutName = expr.coalesce(
  expr.get(field('name')),
  expr.get(field('nameLatin')),
  expr.get(field('nameEnglish')),
  '',
);

const prominentBuildingSelector = {
  kind: 'all',
  selectors: [
    {geometry: 'polygon', kind: 'geometry'},
    {
      kind: 'any',
      selectors: [
        {
          kind: 'all',
          selectors: [
            {field: 'importanceTier', kind: 'has'},
            {
              coerce: 'number',
              fallback: 0,
              field: 'importanceTier',
              kind: 'compare',
              operator: 'gte',
              value: 2,
            },
          ],
        },
        {
          kind: 'all',
          selectors: [
            {kind: 'not', selector: {field: 'importanceTier', kind: 'has'}},
            {
              kind: 'any',
              selectors: [
                {
                  fallback: '',
                  field: 'buildingTone',
                  kind: 'compare',
                  operator: 'eq',
                  value: 'destination',
                },
                {
                  kind: 'all',
                  selectors: [
                    {
                      fallback: '',
                      field: 'buildingTone',
                      kind: 'in',
                      values: ['active', 'commercial'],
                    },
                    {
                      coerce: 'number',
                      fallback: 0,
                      field: 'renderHeight',
                      kind: 'compare',
                      operator: 'gte',
                      value: 24,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as const satisfies TileflowRenderSelector;

function technicalLandPattern(
  target: string,
  feature: 'landcover' | 'landuse',
  pattern: string,
  selector: TileflowRenderSelector,
  minZoom: number,
  opacity: number,
) {
  return renderPass({
    attachTo: target,
    feature,
    phase: 'overlay',
    renderer: 'fill',
    selector,
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

export const sanFrancistoTheme = defineOfficialTheme({
  id: 'san-francisto-blueprint',
  version: 1,
  colorScheme: 'dark',
  colors: {
    background: sanFrancistoPalette.background,
    boundary: sanFrancistoPalette.boundary,
    building: sanFrancistoPalette.building,
    land: sanFrancistoPalette.land,
    park: sanFrancistoPalette.park,
    road: sanFrancistoPalette.road,
    roadCasing: sanFrancistoPalette.roadCasing,
    roadMajor: sanFrancistoPalette.roadMajor,
    text: sanFrancistoPalette.ink,
    textHalo: sanFrancistoPalette.halo,
    textMuted: sanFrancistoPalette.inkMuted,
    water: sanFrancistoPalette.water,
  },
  modules: {
    boundaries: {
      admin: sanFrancistoPalette.boundary,
      disputed: sanFrancistoPalette.annotation,
      major: sanFrancistoPalette.inkMuted,
      maritime: sanFrancistoPalette.waterInk,
    },
    buildings: {
      active: sanFrancistoPalette.buildingInk,
      businessCorridor: sanFrancistoPalette.building,
      businessCorridorOutline: sanFrancistoPalette.buildingMuted,
      civic: sanFrancistoPalette.buildingInk,
      commercial: sanFrancistoPalette.building,
      destination: sanFrancistoPalette.buildingInk,
      extrusion: sanFrancistoPalette.building,
      fill: sanFrancistoPalette.building,
      generic: sanFrancistoPalette.building,
      highRise: sanFrancistoPalette.building,
      highRiseOutline: sanFrancistoPalette.buildingInk,
      industrial: sanFrancistoPalette.building,
      lowRise: sanFrancistoPalette.building,
      lowRiseOutline: sanFrancistoPalette.buildingMuted,
      outline: sanFrancistoPalette.buildingInk,
      residential: sanFrancistoPalette.building,
    },
    hydro: {
      ferry: sanFrancistoPalette.waterInk,
      label: sanFrancistoPalette.waterInk,
      water: sanFrancistoPalette.water,
      waterway: sanFrancistoPalette.waterInk,
    },
    labels: {
      country: sanFrancistoPalette.ink,
      halo: sanFrancistoPalette.halo,
      muted: sanFrancistoPalette.inkMuted,
      neighborhood: sanFrancistoPalette.inkMuted,
      poi: sanFrancistoPalette.annotation,
      primary: sanFrancistoPalette.ink,
      road: sanFrancistoPalette.inkMuted,
      settlement: sanFrancistoPalette.ink,
      water: sanFrancistoPalette.waterInk,
    },
    landcover: {
      farmland: sanFrancistoPalette.landDetail,
      flowerbed: sanFrancistoPalette.park,
      grass: sanFrancistoPalette.park,
      ice: sanFrancistoPalette.landDetail,
      meadow: sanFrancistoPalette.park,
      protected: sanFrancistoPalette.park,
      recreationGround: sanFrancistoPalette.park,
      rock: sanFrancistoPalette.landDetail,
      sand: sanFrancistoPalette.landDetail,
      scrub: sanFrancistoPalette.park,
      urbanPark: sanFrancistoPalette.park,
      villageGreen: sanFrancistoPalette.park,
      wetland: sanFrancistoPalette.park,
      wood: sanFrancistoPalette.park,
    },
    landuse: {
      cemetery: sanFrancistoPalette.landDetail,
      civic: sanFrancistoPalette.landDetail,
      commercial: sanFrancistoPalette.landDetail,
      education: sanFrancistoPalette.landDetail,
      government: sanFrancistoPalette.landDetail,
      industrial: sanFrancistoPalette.landDetail,
      medical: sanFrancistoPalette.landDetail,
      military: sanFrancistoPalette.landDetail,
      parking: sanFrancistoPalette.land,
      recreation: sanFrancistoPalette.park,
      residential: sanFrancistoPalette.landDetail,
    },
    poi: {
      'arts-entertainment': sanFrancistoPalette.annotation,
      education: sanFrancistoPalette.annotation,
      'food-drink': sanFrancistoPalette.inkMuted,
      halo: sanFrancistoPalette.halo,
      icon: sanFrancistoPalette.annotation,
      label: sanFrancistoPalette.annotation,
      landmark: sanFrancistoPalette.annotation,
      lodging: sanFrancistoPalette.inkMuted,
      medical: sanFrancistoPalette.annotation,
      'park-nature': sanFrancistoPalette.inkMuted,
      'public-services': sanFrancistoPalette.inkMuted,
      religion: sanFrancistoPalette.annotation,
      retail: sanFrancistoPalette.inkMuted,
      'sport-leisure': sanFrancistoPalette.inkMuted,
      transport: sanFrancistoPalette.annotation,
      'visitor-amenity': sanFrancistoPalette.inkMuted,
    },
    roads: {
      bridge: sanFrancistoPalette.ink,
      casing: sanFrancistoPalette.roadCasing,
      ferry: sanFrancistoPalette.waterInk,
      minor: sanFrancistoPalette.roadDetail,
      motorway: sanFrancistoPalette.roadMajor,
      path: sanFrancistoPalette.inkQuiet,
      primary: sanFrancistoPalette.road,
      rail: sanFrancistoPalette.rail,
      secondary: sanFrancistoPalette.road,
      trunk: sanFrancistoPalette.roadMajor,
      tunnel: sanFrancistoPalette.inkQuiet,
    },
    terrain: {
      'contour.halo': sanFrancistoPalette.halo,
      'contour.index': sanFrancistoPalette.contour,
      'contour.label': sanFrancistoPalette.contour,
      'contour.minor': sanFrancistoPalette.contour,
    },
  },
  images: {
    'blueprint.background': 'san-francisto-blueprint-grid',
    'blueprint.building': 'san-francisto-building-hatch',
    'blueprint.landscape': 'san-francisto-landscape-hatch',
    'blueprint.poi': 'san-francisto-poi-node',
    'blueprint.water': 'san-francisto-water-hatch',
  },
  typography: {
    font: 'Noto Sans Regular',
    letterSpacing: 0.055,
    places: {font: 'Noto Sans Bold', letterSpacing: 0.13, transform: 'uppercase'},
    poi: {font: 'Noto Sans Regular', letterSpacing: 0.07, transform: 'uppercase'},
    roads: {font: 'Noto Sans Regular', letterSpacing: 0.075, transform: 'uppercase'},
    transform: 'uppercase',
    water: {font: 'Noto Sans Regular', letterSpacing: 0.16, transform: 'uppercase'},
  },
  lighting: {
    anchor: 'viewport',
    color: sanFrancistoPalette.ink,
    intensity: 0.02,
    position: [1.15, 210, 35],
  },
});

/**
 * San Francisco redrawn as an architect's working blueprint. This standalone
 * root uses precise footprints, restrained road weights, survey-like labels,
 * contour dimensions, and original technical hatches instead of naturalistic
 * map colour.
 */
export const sanFrancisto = bindOfficialMapTheme(
  defineMap({
    id: 'san-francisto',
    version: 1,
    name: 'Blueprint',
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
    icons: [sanFrancistoIcons],
    themes: {blueprint: sanFrancistoTheme},
    defaultTheme: 'blueprint',
    projection: 'mercator',
    terrain: {
      attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
      contours: {
        demMaxZoom: 12,
        demUrl: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
        index: {
          color: sanFrancistoPalette.contour,
          opacity: 0.46,
          width: 0.62,
        },
        labels: {
          color: sanFrancistoPalette.contour,
          font: 'Noto Sans Regular',
          haloColor: sanFrancistoPalette.halo,
          haloWidth: 0.75,
          minZoom: 12,
          opacity: 0.58,
          size: 8,
          spacing: 420,
        },
        maxZoom: 14,
        minZoom: 9,
        minor: {
          color: sanFrancistoPalette.contour,
          opacity: 0.17,
          width: 0.28,
        },
        overzoom: 2,
        sourceId: 'san-francisto-contours',
        thresholds: {
          9: [50, 250],
          11: [20, 100],
          13: [10, 50],
          14: [10, 50],
        },
      },
      encoding: 'terrarium',
      mode: 'none',
    },
    modules: {
      addresses: addresses({
        labels: {
          minZoom: 18,
          text: {
            color: sanFrancistoPalette.inkQuiet,
            font: 'Noto Sans Regular',
            haloColor: sanFrancistoPalette.halo,
            haloWidth: 0.8,
            letterSpacing: 0.08,
            size: 8,
          },
        },
      }),
      aeroways: aeroways({
        area: {
          fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.55},
          outline: {
            color: sanFrancistoPalette.boundary,
            minZoom: 9,
            opacity: 0.5,
            width: 0.55,
          },
        },
        runway: {
          casing: {
            color: sanFrancistoPalette.buildingMuted,
            minZoom: 9,
            opacity: 0.58,
          },
          fill: {color: sanFrancistoPalette.land, minZoom: 9, opacity: 0.96},
        },
        runwayRef: {
          minZoom: 12,
          text: {
            color: sanFrancistoPalette.annotation,
            font: 'Noto Sans Bold',
            haloColor: sanFrancistoPalette.halo,
            haloWidth: 1,
            letterSpacing: 0.12,
            size: 9,
          },
        },
        taxiway: {
          casing: {
            color: sanFrancistoPalette.inkQuiet,
            minZoom: 12,
            opacity: 0.46,
          },
          fill: {color: sanFrancistoPalette.land, minZoom: 12, opacity: 0.9},
        },
      }),
      boundaries: boundaries({
        admin2: {
          color: sanFrancistoPalette.boundary,
          dash: [8, 2, 1, 2],
          minZoom: 2,
          opacity: 0.5,
          width: zoom.linear([
            [2, 0.45],
            [10, 0.9],
          ]),
        },
        admin4: {
          color: sanFrancistoPalette.inkQuiet,
          dash: [3, 2],
          minZoom: 6,
          opacity: 0.38,
          width: 0.5,
        },
        disputed: {
          color: sanFrancistoPalette.annotation,
          dash: [2, 1],
          minZoom: 3,
          opacity: 0.7,
          width: 0.8,
        },
        maritime: {
          color: sanFrancistoPalette.waterInk,
          dash: [7, 3, 1, 3],
          minZoom: 3,
          opacity: 0.48,
          width: 0.65,
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
              color: sanFrancistoPalette.building,
              minZoom: 13,
              opacity: zoom.linear([
                [13, 0],
                [14, 0.46],
                [16, 0.62],
              ]),
            },
            outline: {
              color: sanFrancistoPalette.buildingMuted,
              minZoom: 13.5,
              opacity: zoom.linear([
                [13.5, 0],
                [14.5, 0.56],
                [17, 0.74],
              ]),
              width: zoom.linear([
                [13.5, 0.2],
                [17, 0.5],
                [20, 0.72],
              ]),
            },
          },
          mode: 'flat',
        }),
        {
          footprintHatch: renderPass({
            attachTo: 'buildings.flat.fill',
            feature: 'building',
            phase: 'overlay',
            renderer: 'fill',
            // A section hatch is reserved for the few footprints that carry
            // architectural emphasis; ordinary building fills remain quiet.
            selector: prominentBuildingSelector,
            style: {
              minZoom: 16,
              opacity: zoom.linear([
                [16, 0],
                [17, 0.1],
                [19, 0.16],
              ]),
              pattern: 'san-francisto-building-hatch',
            },
          }),
          measuredEdge: renderPass({
            attachTo: 'buildings.flat.outline',
            feature: 'building',
            phase: 'overlay',
            renderer: 'line',
            selector: {geometry: 'polygon', kind: 'geometry'},
            style: {
              color: sanFrancistoPalette.buildingMuted,
              dash: [1.2, 1.2],
              minZoom: 17,
              offset: zoom.linear([
                [17, -0.7],
                [20, -1.2],
              ]),
              opacity: zoom.linear([
                [17, 0],
                [18, 0.34],
              ]),
              width: 0.32,
            },
          }),
          prominentOutline: renderPass({
            attachTo: 'buildings.render.measuredEdge',
            feature: 'building',
            phase: 'overlay',
            renderer: 'line',
            selector: prominentBuildingSelector,
            style: {
              color: sanFrancistoPalette.buildingInk,
              join: 'miter',
              minZoom: 14,
              opacity: zoom.linear([
                [14, 0],
                [15, 0.82],
                [17, 0.96],
              ]),
              width: zoom.linear([
                [14, 0.55],
                [17, 1.15],
                [20, 1.75],
              ]),
            },
          }),
          buildingAnnotations: renderPass({
            attachTo: 'buildings.render.prominentOutline',
            feature: 'building',
            phase: 'annotation',
            renderer: 'symbol',
            selector: {
              kind: 'all',
              selectors: [prominentBuildingSelector, {field: 'name', kind: 'has'}],
            },
            style: {
              minZoom: 17,
              priority: 18,
              text: {
                allowOverlap: false,
                color: sanFrancistoPalette.buildingInk,
                field: expr.coalesce(expr.get(field('name')), ''),
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 0.7,
                letterSpacing: 0.08,
                maxWidth: 8,
                optional: true,
                padding: 6,
                opacity: 0.72,
                size: 8.5,
                transform: 'uppercase',
              },
            },
          }),
          heightAnnotations: renderPass({
            attachTo: 'buildings.render.buildingAnnotations',
            feature: 'building',
            phase: 'annotation',
            renderer: 'symbol',
            selector: {
              kind: 'all',
              selectors: [
                prominentBuildingSelector,
                {field: 'height', kind: 'has'},
                {
                  coerce: 'number',
                  fallback: 0,
                  field: 'height',
                  kind: 'compare',
                  operator: 'gte',
                  value: 24,
                },
              ],
            },
            style: {
              minZoom: 18,
              priority: 20,
              text: {
                allowOverlap: false,
                anchor: 'top',
                color: sanFrancistoPalette.annotation,
                field: expr.concat(
                  'H ≈ ',
                  expr.toString(expr.toNumber(expr.get(field('height')), 0)),
                  ' M',
                ),
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 0.8,
                letterSpacing: 0.08,
                offset: [0, 0.8],
                optional: true,
                padding: 8,
                size: 8,
              },
            },
          }),
        },
      ),
      labels: labels({
        aerodromeCodes: 'none',
        junctions: false,
        language: 'local',
        places: 'all',
        roadClasses: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
        roads: 'all',
        shields: 'none',
        styles: {
          aerodrome: {
            minZoom: 9,
            text: {
              color: sanFrancistoPalette.inkMuted,
              font: 'Noto Sans Regular',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 1,
              letterSpacing: 0.09,
              size: 9,
              transform: 'uppercase',
            },
          },
          places: {
            continent: {
              maxZoom: 3.5,
              minZoom: 0,
              text: {
                color: sanFrancistoPalette.inkQuiet,
                font: 'Noto Sans Bold',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.2,
                size: zoom.linear([
                  [0, 9],
                  [3, 13],
                ]),
                transform: 'uppercase',
              },
            },
            country: {
              minZoom: 1,
              text: {
                color: sanFrancistoPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1.25,
                letterSpacing: 0.18,
                size: zoom.linear([
                  [1, 10],
                  [7, 15],
                ]),
                transform: 'uppercase',
              },
            },
            state: {
              minZoom: 4,
              text: {
                color: sanFrancistoPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1.1,
                letterSpacing: 0.15,
                size: zoom.linear([
                  [4, 9],
                  [9, 13],
                ]),
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 4,
              text: {
                color: sanFrancistoPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1.35,
                letterSpacing: 0.16,
                size: zoom.linear([
                  [4, 11],
                  [13, 18],
                ]),
                transform: 'uppercase',
              },
            },
            town: {
              minZoom: 7,
              text: {
                color: sanFrancistoPalette.ink,
                font: 'Noto Sans Bold',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1.2,
                letterSpacing: 0.12,
                size: zoom.linear([
                  [7, 9],
                  [14, 14],
                ]),
                transform: 'uppercase',
              },
            },
            village: {
              minZoom: 9,
              text: {
                color: sanFrancistoPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1.1,
                letterSpacing: 0.1,
                opacity: 0.44,
                size: 9,
                transform: 'uppercase',
              },
            },
            neighborhood: {
              minZoom: 12.5,
              text: {
                color: sanFrancistoPalette.inkMuted,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.16,
                opacity: 0.74,
                padding: 12,
                size: zoom.linear([
                  [12, 8],
                  [16, 10],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              visible: false,
            },
          },
          roads: {
            cycleway: {...blueprintDetailRoadLabel, visible: false},
            footway: {...blueprintDetailRoadLabel, visible: false},
            minor: {...blueprintDetailRoadLabel, minZoom: 16, priority: 52},
            motorway: {...blueprintRoadLabel, minZoom: 9, priority: 74},
            pathway: {...blueprintDetailRoadLabel, visible: false},
            pedestrian: {...blueprintDetailRoadLabel, visible: false},
            primary: {...blueprintRoadLabel, minZoom: 11, priority: 70},
            secondary: {...blueprintSecondaryRoadLabel, minZoom: 12, priority: 66},
            service: {...blueprintDetailRoadLabel, visible: false},
            steps: {...blueprintDetailRoadLabel, visible: false},
            tertiary: {...blueprintSecondaryRoadLabel, minZoom: 14, priority: 58},
            track: {...blueprintDetailRoadLabel, visible: false},
            trunk: {...blueprintRoadLabel, minZoom: 9, priority: 72},
          },
          water: {
            line: {
              minZoom: 12,
              text: {
                color: sanFrancistoPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.14,
                opacity: 0.58,
                size: 9,
                transform: 'uppercase',
              },
            },
            ocean: {
              text: {
                color: sanFrancistoPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.25,
                size: zoom.linear([
                  [1, 10],
                  [8, 15],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              minZoom: 15.5,
              text: {
                color: sanFrancistoPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.18,
                opacity: 0.42,
                size: 9,
                transform: 'uppercase',
              },
            },
            waterway: {
              text: {
                color: sanFrancistoPalette.waterInk,
                font: 'Noto Sans Regular',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.12,
                size: 8,
                transform: 'uppercase',
              },
            },
          },
        },
        water: 'major',
      }),
      land: withRenderStack(
        land({
          background: {opacity: 1, pattern: 'san-francisto-blueprint-grid'},
          globalLandcover: {
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'barren', value: sanFrancistoPalette.landDetail},
                {labels: 'crop', value: sanFrancistoPalette.landDetail},
                {labels: 'grass', value: sanFrancistoPalette.park},
                {labels: 'shrub', value: sanFrancistoPalette.park},
                {labels: 'snow', value: sanFrancistoPalette.landDetail},
                {labels: 'trees', value: sanFrancistoPalette.park},
                {labels: 'urban', value: sanFrancistoPalette.land},
              ],
              sanFrancistoPalette.land,
            ),
            maxZoom: 8,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.26],
              [6, 0.16],
              [8, 0],
            ]),
          },
          landcover: {
            farmland: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.38},
            },
            flowerbed: {
              fill: {color: sanFrancistoPalette.park, minZoom: 13, opacity: 0.5},
            },
            grass: {fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.44}},
            ice: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 7, opacity: 0.52},
            },
            meadow: {fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.44}},
            protected: {
              fill: {color: sanFrancistoPalette.park, minZoom: 8, opacity: 0.48},
              outline: {
                color: sanFrancistoPalette.inkQuiet,
                dash: [4, 2],
                minZoom: 9,
                opacity: 0.32,
                width: 0.35,
              },
            },
            recreationGround: {
              fill: {color: sanFrancistoPalette.park, minZoom: 10, opacity: 0.44},
            },
            rock: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.36},
            },
            sand: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.38},
            },
            scrub: {fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.4}},
            urbanPark: {
              fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.5},
              outline: {
                color: sanFrancistoPalette.inkQuiet,
                minZoom: 11,
                opacity: 0.3,
                width: 0.35,
              },
            },
            villageGreen: {
              fill: {color: sanFrancistoPalette.park, minZoom: 11, opacity: 0.5},
            },
            wetland: {
              fill: {color: sanFrancistoPalette.park, minZoom: 10, opacity: 0.38},
            },
            wood: {
              fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.44},
              outline: {
                color: sanFrancistoPalette.inkQuiet,
                minZoom: 12,
                opacity: 0.26,
                width: 0.3,
              },
            },
          },
          landuse: {
            cemetery: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 11, opacity: 0.4},
            },
            civic: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 10, opacity: 0.46},
            },
            commercial: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 10, opacity: 0.42},
            },
            education: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 10, opacity: 0.44},
            },
            government: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 10, opacity: 0.46},
            },
            industrial: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 10, opacity: 0.5},
            },
            medical: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 11, opacity: 0.46},
            },
            military: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.4},
            },
            parking: {
              fill: {color: sanFrancistoPalette.land, minZoom: 16, opacity: 0.62},
              outline: {
                color: sanFrancistoPalette.inkQuiet,
                dash: [2, 2],
                minZoom: 17,
                opacity: 0.28,
                width: 0.3,
              },
            },
            railway: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 11, opacity: 0.42},
            },
            recreation: {
              fill: {color: sanFrancistoPalette.park, minZoom: 9, opacity: 0.48},
              outline: {
                color: sanFrancistoPalette.inkQuiet,
                minZoom: 12,
                opacity: 0.3,
                width: 0.34,
              },
            },
            residential: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 9, opacity: 0.36},
            },
          },
        }),
        {
          landscapeHatch: technicalLandPattern(
            'land.landcover.wood.fill',
            'landcover',
            'san-francisto-landscape-hatch',
            {
              fallback: '',
              field: 'class',
              kind: 'in',
              values: ['wood', 'forest'],
            },
            11,
            0.2,
          ),
          parkHatch: technicalLandPattern(
            'land.landcover.urbanPark.fill',
            'landcover',
            'san-francisto-landscape-hatch',
            {
              kind: 'all',
              selectors: [
                {
                  fallback: '',
                  field: 'class',
                  kind: 'compare',
                  operator: 'eq',
                  value: 'grass',
                },
                {
                  fallback: '',
                  field: 'subclass',
                  kind: 'in',
                  values: ['park', 'garden'],
                },
              ],
            },
            12,
            0.17,
          ),
          recreationHatch: technicalLandPattern(
            'land.landuse.recreation.fill',
            'landuse',
            'san-francisto-landscape-hatch',
            {
              fallback: '',
              field: 'class',
              kind: 'in',
              values: ['pitch', 'track', 'playground', 'zoo'],
            },
            12,
            0.16,
          ),
          industrialHatch: technicalLandPattern(
            'land.landuse.industrial.fill',
            'landuse',
            'san-francisto-building-hatch',
            {
              fallback: '',
              field: 'class',
              kind: 'in',
              values: ['industrial', 'railway'],
            },
            13,
            0.1,
          ),
        },
      ),
      landforms: landforms({
        elevation: true,
        classes: {
          arete: {
            minZoom: 13,
            text: {
              color: sanFrancistoPalette.contour,
              font: 'Noto Sans Regular',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.8,
              letterSpacing: 0.08,
              size: 8,
              transform: 'uppercase',
            },
          },
          cliff: {
            minZoom: 12,
            text: {
              color: sanFrancistoPalette.contour,
              font: 'Noto Sans Regular',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.8,
              letterSpacing: 0.08,
              size: 8,
              transform: 'uppercase',
            },
          },
          peak: {
            minZoom: 9,
            text: {
              color: sanFrancistoPalette.annotation,
              font: 'Noto Sans Bold',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.9,
              letterSpacing: 0.08,
              size: 9,
              transform: 'uppercase',
            },
          },
          ridge: {
            minZoom: 13,
            text: {
              color: sanFrancistoPalette.contour,
              font: 'Noto Sans Regular',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.8,
              letterSpacing: 0.08,
              size: 8,
              transform: 'uppercase',
            },
          },
          saddle: {
            minZoom: 13,
            text: {
              color: sanFrancistoPalette.contour,
              font: 'Noto Sans Regular',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.8,
              letterSpacing: 0.08,
              size: 8,
              transform: 'uppercase',
            },
          },
          volcano: {
            minZoom: 8,
            text: {
              color: sanFrancistoPalette.annotation,
              font: 'Noto Sans Bold',
              haloColor: sanFrancistoPalette.halo,
              haloWidth: 0.9,
              letterSpacing: 0.08,
              size: 9,
              transform: 'uppercase',
            },
          },
        },
      }),
      poi: withRenderStack(
        poi({
          categories: [
            'arts-entertainment',
            'education',
            'medical',
            'park-nature',
            'public-services',
            'transport',
            'visitor-amenity',
          ],
          color: 'category',
          density: 1,
          icons: false,
          labels: true,
          minZoom: 14.5,
          placement: {
            coupleIconAndLabel: false,
            iconPadding: 3,
            textPadding: 7,
          },
          styles: {
            'arts-entertainment': blueprintPoiLabel,
            education: blueprintPoiLabel,
            medical: blueprintPrimaryPoiLabel,
            'park-nature': blueprintPoiLabel,
            'public-services': blueprintPoiLabel,
            transport: blueprintPrimaryPoiLabel,
            'visitor-amenity': blueprintPoiLabel,
          },
        }),
        {
          architecturalCallouts: renderPass({
            attachTo: 'poi.visitor-amenity.label',
            feature: 'poi',
            phase: 'annotation',
            renderer: 'symbol',
            selector: {
              kind: 'all',
              selectors: [
                {geometry: 'point', kind: 'geometry'},
                {
                  fallback: '',
                  field: 'poiCategory',
                  kind: 'compare',
                  operator: 'eq',
                  value: 'landmark',
                },
                {
                  kind: 'any',
                  selectors: [
                    {field: 'name', kind: 'has'},
                    {field: 'nameLatin', kind: 'has'},
                    {field: 'nameEnglish', kind: 'has'},
                  ],
                },
                {field: 'poiFilterRank', kind: 'has'},
                {
                  coerce: 'number',
                  fallback: 6,
                  field: 'poiFilterRank',
                  kind: 'compare',
                  operator: 'gte',
                  value: 0,
                },
                {
                  coerce: 'number',
                  fallback: 6,
                  field: 'poiFilterRank',
                  kind: 'compare',
                  operator: 'lte',
                  value: 1,
                },
                {field: 'poiSizeRank', kind: 'has'},
                {
                  coerce: 'number',
                  fallback: 17,
                  field: 'poiSizeRank',
                  kind: 'compare',
                  operator: 'gte',
                  value: 0,
                },
                {
                  coerce: 'number',
                  fallback: 17,
                  field: 'poiSizeRank',
                  kind: 'compare',
                  operator: 'lte',
                  value: 8,
                },
              ],
            },
            style: {
              icon: {
                allowOverlap: false,
                anchor: 'right',
                image: 'san-francisto-poi-node',
                ignorePlacement: false,
                opacity: zoom.linear([
                  [16, 0],
                  [17, 0.68],
                ]),
                optional: false,
                padding: 7,
                size: zoom.linear([
                  [16, 0.68],
                  [18, 0.82],
                  [20, 0.9],
                ]),
              },
              minZoom: 16,
              priority: blueprintPoiPlacementPriority,
              priorityOrder: 'lower-first',
              text: {
                allowOverlap: false,
                anchor: 'left',
                color: sanFrancistoPalette.inkMuted,
                field: blueprintPoiCalloutName,
                font: 'Noto Sans Bold',
                haloColor: sanFrancistoPalette.halo,
                haloWidth: 0.7,
                ignorePlacement: false,
                letterSpacing: 0.075,
                maxWidth: 12,
                offset: [0.65, 0],
                opacity: zoom.linear([
                  [16, 0],
                  [17, 0.68],
                ]),
                optional: false,
                padding: 5,
                size: zoom.linear([
                  [16, 7.5],
                  [18, 9.25],
                ]),
                transform: 'uppercase',
              },
            },
          }),
        },
      ),
      roads: withRenderStack(
        roads({
          areas: {
            pedestrian: {
              fill: {color: sanFrancistoPalette.landDetail, minZoom: 13, opacity: 0.7},
              outline: {
                color: sanFrancistoPalette.roadDetail,
                dash: [2, 2],
                minZoom: 14,
                opacity: 0.28,
                width: 0.34,
              },
            },
            pier: {
              fill: {color: sanFrancistoPalette.land, minZoom: 12, opacity: 0.94},
              outline: {
                color: sanFrancistoPalette.waterInk,
                minZoom: 12,
                opacity: 0.72,
                width: 0.65,
              },
            },
            road: {
              fill: {color: sanFrancistoPalette.land, minZoom: 13, opacity: 0.86},
            },
          },
          classes: {
            cycleway: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 13, {
              casingOpacity: 0.1,
              dash: [3, 1.5],
              opacity: 0.42,
            }),
            footway: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 14, {
              casingOpacity: 0.08,
              dash: [1.5, 1.5],
              opacity: 0.34,
            }),
            minor: blueprintRoadStyle(sanFrancistoPalette.roadDetail, 12, {
              casingOpacity: 0.26,
              opacity: 0.52,
            }),
            motorway: blueprintRoadStyle(sanFrancistoPalette.roadMajor, 5, {
              casingOpacity: 0.72,
              opacity: 0.86,
            }),
            pathway: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 13, {
              casingOpacity: 0.08,
              dash: [3, 1.5],
              opacity: 0.36,
            }),
            pedestrian: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 13, {
              casingOpacity: 0.09,
              dash: [1, 1.5],
              opacity: 0.38,
            }),
            primary: blueprintRoadStyle(sanFrancistoPalette.road, 7, {
              casingOpacity: 0.62,
              opacity: 0.78,
            }),
            secondary: blueprintRoadStyle(sanFrancistoPalette.road, 9, {
              casingOpacity: 0.44,
              opacity: 0.66,
            }),
            service: blueprintRoadStyle(sanFrancistoPalette.roadDetail, 14, {
              casingOpacity: 0.18,
              opacity: 0.44,
            }),
            steps: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 15, {
              casingOpacity: 0.06,
              dash: [0.5, 0.5],
              opacity: 0.32,
            }),
            tertiary: blueprintRoadStyle(sanFrancistoPalette.roadDetail, 10, {
              casingOpacity: 0.32,
              opacity: 0.56,
            }),
            track: blueprintRoadStyle(sanFrancistoPalette.inkQuiet, 13, {
              casingOpacity: 0.07,
              dash: [4, 2],
              opacity: 0.36,
            }),
            trunk: blueprintRoadStyle(sanFrancistoPalette.roadMajor, 6, {
              casingOpacity: 0.7,
              opacity: 0.84,
            }),
          },
          crossings: {image: 'san-francisto-blueprint-grid', visible: false},
          detail: 'all',
          extras: {paths: true},
          hierarchy: 'strong',
          modifiers: {
            construction: {
              surface: {
                casing: {dash: [2, 1], opacity: 0.3},
                fill: {dash: [2, 1], opacity: 0.48},
              },
            },
            indoor: {
              surface: {
                casing: {opacity: 0.12},
                fill: {dash: [1, 1], opacity: 0.24},
              },
            },
            unpaved: {
              surface: {
                casing: {dash: [3, 1], opacity: 0.3},
                fill: {dash: [3, 1], opacity: 0.48},
              },
            },
          },
          oneWayMarkers: false,
          outline: 'subtle',
          restrictions: {
            access: {
              surface: {
                casing: {dash: [1, 1], opacity: 0.24},
                fill: {dash: [1, 1], opacity: 0.34},
              },
            },
          },
          roundabouts: {
            casing: {visible: false},
            fill: {
              strokeColor: sanFrancistoPalette.roadDetail,
              strokeOpacity: 0.42,
              strokeWidth: zoom.linear([
                [15, 0.35],
                [20, 0.65],
              ]),
            },
          },
          sidewalks: {
            outline: {
              color: sanFrancistoPalette.inkQuiet,
              minZoom: 17,
              opacity: 0.3,
              width: 0.4,
            },
            surface: {
              color: sanFrancistoPalette.landDetail,
              minZoom: 17,
              opacity: 0.52,
            },
          },
          weight: 'thin',
          widthScale: {
            cycleway: 0.26,
            footway: 0.22,
            minor: 0.36,
            motorway: 0.88,
            pathway: 0.24,
            pedestrian: 0.34,
            primary: 0.74,
            secondary: 0.6,
            service: 0.3,
            steps: 0.2,
            tertiary: 0.44,
            track: 0.26,
            trunk: 0.84,
          },
        }),
        {
          majorRoadCenterline: renderPass({
            attachTo: 'roads.classes.motorway.surface.fill',
            feature: 'road',
            phase: 'overlay',
            renderer: 'line',
            selector: {
              kind: 'all',
              selectors: [
                {geometry: 'line', kind: 'geometry'},
                {
                  fallback: '',
                  field: 'class',
                  kind: 'in',
                  values: ['motorway', 'trunk', 'primary'],
                },
                {
                  fallback: '',
                  field: 'brunnel',
                  kind: 'compare',
                  operator: 'ne',
                  value: 'bridge',
                },
                {
                  fallback: '',
                  field: 'brunnel',
                  kind: 'compare',
                  operator: 'ne',
                  value: 'tunnel',
                },
              ],
            },
            style: {
              cap: 'butt',
              color: sanFrancistoPalette.roadCasing,
              dash: [6, 2, 1, 2],
              join: 'miter',
              minZoom: 12,
              opacity: zoom.linear([
                [12, 0],
                [13, 0.5],
                [17, 0.72],
              ]),
              width: zoom.linear([
                [12, 0.28],
                [17, 0.55],
                [20, 0.8],
              ]),
            },
          }),
        },
      ),
      transit: transit({
        cableway: {
          color: sanFrancistoPalette.inkQuiet,
          dash: [2, 2],
          minZoom: 10,
          opacity: 0.42,
          width: 0.65,
        },
        ferry: {
          color: sanFrancistoPalette.waterInk,
          dash: [7, 2, 1, 2],
          minZoom: 5,
          opacity: 0.62,
          width: zoom.linear([
            [5, 0.4],
            [16, 1.35],
          ]),
        },
        rail: {
          bridge: {
            color: sanFrancistoPalette.rail,
            minZoom: 7,
            opacity: 0.84,
            width: 1.1,
          },
          surface: {
            color: sanFrancistoPalette.rail,
            minZoom: 7,
            opacity: 0.78,
            width: 0.95,
          },
          tunnel: {
            color: sanFrancistoPalette.rail,
            dash: [3, 2],
            minZoom: 9,
            opacity: 0.34,
            width: 0.8,
          },
        },
        railHatching: {
          bridge: {
            color: sanFrancistoPalette.roadCasing,
            dash: [1, 1.3],
            minZoom: 9,
            width: 0.55,
          },
          surface: {
            color: sanFrancistoPalette.roadCasing,
            dash: [1, 1.3],
            minZoom: 9,
            width: 0.5,
          },
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {
            color: sanFrancistoPalette.rail,
            minZoom: 12,
            opacity: 0.46,
            width: 0.7,
          },
          surface: {
            color: sanFrancistoPalette.rail,
            minZoom: 12,
            opacity: 0.42,
            width: 0.62,
          },
          tunnel: {
            color: sanFrancistoPalette.rail,
            dash: [2, 2],
            minZoom: 12,
            opacity: 0.24,
            width: 0.58,
          },
        },
      }),
      vegetation: vegetation({
        flat: {
          color: sanFrancistoPalette.park,
          minZoom: 16,
          opacity: 0.2,
          radius: zoom.linear([
            [16, 1.2],
            [20, 3.3],
          ]),
          strokeColor: sanFrancistoPalette.inkQuiet,
          strokeOpacity: 0.58,
          strokeWidth: 0.55,
        },
        minZoom: 16,
        mode: 'flat',
      }),
      water: withRenderStack(
        water({
          bathymetry: {
            color: sanFrancistoPalette.water,
            maxZoom: 9,
            minZoom: 0,
            opacity: 0,
          },
          bodies: {
            fill: {color: sanFrancistoPalette.water, opacity: 1},
            outline: {
              color: sanFrancistoPalette.waterInk,
              minZoom: 6,
              opacity: 0.72,
              width: zoom.linear([
                [6, 0.3],
                [14, 0.7],
                [18, 1],
              ]),
            },
          },
          intermittent: {
            bodies: {fill: {color: sanFrancistoPalette.water, opacity: 0.62}},
            waterways: {
              color: sanFrancistoPalette.waterInk,
              dash: [3, 2],
              opacity: 0.46,
            },
          },
          waterways: {
            canal: {
              color: sanFrancistoPalette.waterInk,
              minZoom: 8,
              opacity: 0.78,
              width: zoom.linear([
                [8, 0.3],
                [16, 1.45],
              ]),
            },
            other: {
              color: sanFrancistoPalette.waterInk,
              minZoom: 12,
              opacity: 0.56,
              width: zoom.linear([
                [12, 0.22],
                [17, 0.85],
              ]),
            },
            river: {
              color: sanFrancistoPalette.waterInk,
              minZoom: 6,
              opacity: 0.82,
              width: zoom.linear([
                [6, 0.35],
                [16, 1.75],
              ]),
            },
            stream: {
              color: sanFrancistoPalette.waterInk,
              minZoom: 10,
              opacity: 0.66,
              width: zoom.linear([
                [10, 0.24],
                [16, 0.95],
              ]),
            },
          },
        }),
        {
          waterHatch: renderPass({
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
                [7, 0.14],
                [13, 0.24],
                [18, 0.18],
              ]),
              pattern: 'san-francisto-water-hatch',
            },
          }),
          intermittentWaterHatch: renderPass({
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
              opacity: 0.2,
              pattern: 'san-francisto-water-hatch',
            },
          }),
        },
      ),
    },
    view: {
      center: [-122.3995, 37.795],
      pitch: 0,
      bearing: 0,
      zoom: 15,
    },
  }),
);
