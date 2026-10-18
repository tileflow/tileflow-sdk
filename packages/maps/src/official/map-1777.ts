import {
  addresses,
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
  refineRenderTarget,
  renderPass,
  roads,
  type TileflowFillStyle,
  type TileflowRenderSelector,
  type TileflowRoadClass,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  type TileflowThemeImageValue,
  token,
  transit,
  vegetation,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {map1777Fonts, map1777Icons} from '../assets';
import {map1777RoadBorder, map1777RoadWidth, withMap1777RoadDetail} from './map-1777-roads';
import {map1777TimeThemes} from './map-1777-themes';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

/**
 * Ink and watercolor inspired by the 1777 cabinet sheets: pale laid paper,
 * vermilion buildings, green washes and finely drawn vegetation.
 */
const map1777Regular = 'Cormorant Garamond Regular';
const map1777Semibold = 'Cormorant Garamond SemiBold';
const map1777Italic = 'Cormorant Garamond Italic';

const map1777Palette = {
  aeroway: '#B9AB8B',
  boundary: '#8B4D45',
  boundaryMuted: '#9A806B',
  building: '#BE5A50',
  buildingActive: '#AC493E',
  buildingOutline: '#86463B',
  farmland: '#E5D8AC',
  grass: '#C2CFA7',
  halo: '#F0E8D2',
  heath: '#B7C197',
  ice: '#E5E7D8',
  ink: '#39382D',
  inkMuted: '#68624C',
  land: '#EFE7CD',
  meadow: '#CFD7B0',
  military: '#D4B7AA',
  paperBright: '#F7F0DD',
  parking: '#E8DFC8',
  rail: '#625B47',
  recreation: '#B7C68D',
  road: '#F5EEDA',
  roadCasing: '#8F8265',
  roadMajor: '#F6F0DE',
  roadSecondary: '#F3EDD9',
  sand: '#E6D5A8',
  urban: '#D8B5A2',
  water: '#CEDCD0',
  waterBank: '#718C7D',
  waterInk: '#718D7C',
  wetland: '#B9CBAA',
  wood: '#9FB583',
} as const;

function map1777RoadStyle(
  roadClass: TileflowRoadClass,
  fillColor: string,
  casingColor: string,
  minZoom: number,
  options: {
    casingFade?: number;
    casingOpacity?: number;
    dash?: readonly number[];
    fillOpacity?: number;
    tunnelOpacity?: number;
  } = {},
): TileflowRoadClassStyle {
  const casing = {
    cap: 'round' as const,
    color: casingColor,
    join: 'round' as const,
    minZoom,
    opacity: options.casingFade
      ? zoom.linear([
          [minZoom, 0],
          [minZoom + options.casingFade, options.casingOpacity ?? 0.72],
        ])
      : (options.casingOpacity ?? 0.72),
    width: map1777RoadWidth(roadClass, map1777RoadBorder(roadClass)),
  };
  const fill = {
    // Engraved dashes need square ends; round caps turn narrow paths into beads.
    cap: options.dash ? ('square' as const) : ('round' as const),
    color: fillColor,
    join: 'round' as const,
    ...(options.dash ? {dash: options.dash} : {}),
    minZoom,
    opacity: options.fillOpacity ?? 0.94,
    width: map1777RoadWidth(roadClass),
  };

  return {
    bridge: {
      casing: {
        ...casing,
        cap: 'butt',
        join: 'miter',
        opacity: Math.min(1, (options.casingOpacity ?? 0.72) + 0.1),
      },
      fill: {...fill, join: 'miter'},
    },
    surface: {casing, fill},
    tunnel: {
      casing: {
        ...casing,
        cap: 'butt',
        // Dashes belong to the fine border, never across the whole passage.
        dash: [4, 3],
        gapWidth: map1777RoadWidth(roadClass),
        width: map1777RoadBorder(roadClass) / 2,
        opacity: options.tunnelOpacity ?? 0.4,
      },
      fill: {
        ...fill,
        cap: 'butt',
        color: fillColor,
        // Keep the passage continuous; the broken casing identifies the tunnel.
        dash: [1, 0],
        opacity: options.tunnelOpacity ?? 0.62,
      },
    },
  };
}

const map1777BuildingHeight = expr.max(
  0,
  expr.toNumber(expr.coalesce(expr.get(field('renderHeight')), 5), 5),
);
const map1777BuildingBase = expr.max(
  0,
  expr.min(
    expr.toNumber(expr.coalesce(expr.get(field('renderMinHeight')), 0), 0),
    map1777BuildingHeight,
  ),
);

function map1777PathStyle(
  roadClass: TileflowRoadClass,
  color: string,
  minZoom: number,
  dash?: readonly number[],
): TileflowRoadClassStyle {
  const style = map1777RoadStyle(roadClass, color, map1777Palette.roadCasing, minZoom, {
    casingOpacity: 0.3,
    ...(dash ? {dash} : {}),
    fillOpacity: 0.9,
    tunnelOpacity: 0.48,
  });
  return {
    ...style,
    surface: {
      ...style.surface,
      casing: {...style.surface?.casing, opacity: detailFade(minZoom, 0.3)},
      fill: {...style.surface?.fill, opacity: detailFade(minZoom, 0.9)},
    },
  };
}

function detailFade(minZoom: number, opacity: number) {
  return zoom.linear([
    [minZoom, 0],
    [minZoom + 1, opacity],
  ]);
}

const map1777RoadLabel = {
  placement: 'line',
  priority: 60,
  spacing: 280,
  text: {
    color: map1777Palette.ink,
    font: map1777Italic,
    haloBlur: 0.25,
    haloColor: map1777Palette.halo,
    haloWidth: 0.7,
    letterSpacing: 0.015,
    maxAngle: 28,
    padding: 2,
    pitchAlignment: 'map',
    rotationAlignment: 'map',
    size: zoom.linear([
      [11, 12],
      [17, 17],
    ]),
    transform: 'none',
  },
} satisfies TileflowSymbolStyle;

const map1777PathLabel = {
  ...map1777RoadLabel,
  minZoom: 15,
  priority: 38,
  spacing: 380,
  text: {
    ...map1777RoadLabel.text,
    color: map1777Palette.inkMuted,
    letterSpacing: 0.01,
    size: zoom.linear([
      [15, 11],
      [18, 14],
    ]),
  },
} satisfies TileflowSymbolStyle;

function map1777StreetName(
  style: TileflowSymbolStyle,
  classes: readonly string[],
  subclasses?: readonly string[],
) {
  return renderPass({
    feature: 'roadName',
    renderer: 'symbol',
    requirements: ['roads'],
    placement: 'below-buildings',
    selector: {
      kind: 'all',
      selectors: [
        {field: 'name', kind: 'has'},
        {field: 'class', kind: 'in', values: classes},
        ...(subclasses ? [{field: 'subclass', kind: 'in', values: subclasses} as const] : []),
      ],
    },
    style: {
      ...style,
      text: {
        ...style.text,
        field: expr.coalesce(
          expr.get(field('name')),
          expr.get(field('nameLatin')),
          expr.get(field('nameEnglish')),
        ),
      },
    },
  });
}

// Each mapped field keeps one wash and stroke direction. Missing IDs use the first plate.
const map1777FieldVariant = expr.modulo(expr.toNumber(expr.id(), 0), 3);

function landcoverPattern(
  target: string,
  pattern: NonNullable<TileflowFillStyle['pattern']>,
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
    placement: {above: target},
    feature: 'landcover',
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
  pattern: NonNullable<TileflowFillStyle['pattern']>,
  classes: readonly string[],
  minZoom: number,
  opacity: number,
) {
  return renderPass({
    placement: {above: target},
    feature: 'landuse',
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

export const map1777Theme = defineOfficialTheme({
  id: 'map-1777-light',
  version: 1,
  colorScheme: 'light',
  images: {
    'land.field.hatch': 'map-1777-crop-hatch',
    'land.field.cross': 'map-1777-crop-cross',
    'land.field.lines': 'map-1777-crop-lines',
  },
  colors: {
    background: map1777Palette.land,
    boundary: map1777Palette.boundary,
    building: map1777Palette.building,
    land: map1777Palette.land,
    park: map1777Palette.wood,
    road: map1777Palette.road,
    roadCasing: map1777Palette.roadCasing,
    roadMajor: map1777Palette.roadMajor,
    text: map1777Palette.ink,
    textHalo: map1777Palette.halo,
    textMuted: map1777Palette.inkMuted,
    water: map1777Palette.water,
  },
  modules: {
    boundaries: {
      admin: map1777Palette.boundary,
      disputed: '#A84E46',
      major: map1777Palette.boundary,
      maritime: map1777Palette.waterInk,
    },
    buildings: {
      active: map1777Palette.buildingActive,
      businessCorridor: map1777Palette.building,
      businessCorridorOutline: map1777Palette.buildingOutline,
      civic: '#AF4C42',
      commercial: '#C25B4D',
      destination: map1777Palette.buildingActive,
      extrusion: map1777Palette.building,
      fill: map1777Palette.building,
      generic: map1777Palette.building,
      highRise: '#B65349',
      highRiseOutline: map1777Palette.buildingOutline,
      industrial: '#A46C5C',
      lowRise: '#C96A5A',
      lowRiseOutline: map1777Palette.buildingOutline,
      outline: map1777Palette.buildingOutline,
      residential: map1777Palette.building,
    },
    hydro: {
      ferry: map1777Palette.waterInk,
      label: map1777Palette.waterInk,
      water: map1777Palette.water,
      waterway: map1777Palette.waterInk,
    },
    labels: {
      country: map1777Palette.ink,
      halo: map1777Palette.halo,
      muted: map1777Palette.inkMuted,
      neighborhood: map1777Palette.inkMuted,
      poi: map1777Palette.ink,
      primary: map1777Palette.ink,
      road: map1777Palette.ink,
      settlement: map1777Palette.ink,
      water: map1777Palette.waterInk,
    },
    landcover: {
      farmland: map1777Palette.farmland,
      flowerbed: '#C8C592',
      grass: map1777Palette.grass,
      ice: map1777Palette.ice,
      meadow: map1777Palette.meadow,
      protected: '#AABC8A',
      recreationGround: map1777Palette.recreation,
      rock: '#D4C9AD',
      sand: map1777Palette.sand,
      scrub: map1777Palette.heath,
      urbanPark: '#AFC39A',
      villageGreen: '#BFCF9C',
      wetland: map1777Palette.wetland,
      wood: map1777Palette.wood,
    },
    landuse: {
      cemetery: '#BCC99D',
      civic: '#E8DCC3',
      commercial: '#E5D4BC',
      education: '#E4DDC1',
      government: '#E7D8BF',
      industrial: '#D7CFBA',
      medical: '#E8D9C6',
      military: map1777Palette.military,
      parking: map1777Palette.parking,
      recreation: map1777Palette.recreation,
      residential: '#ECE0C6',
    },
    poi: {
      'arts-entertainment': map1777Palette.boundary,
      education: map1777Palette.inkMuted,
      'food-drink': map1777Palette.boundary,
      halo: map1777Palette.halo,
      icon: map1777Palette.ink,
      label: map1777Palette.ink,
      landmark: map1777Palette.boundary,
      lodging: map1777Palette.boundaryMuted,
      medical: map1777Palette.boundary,
      'park-nature': map1777Palette.inkMuted,
      'public-services': map1777Palette.inkMuted,
      religion: map1777Palette.boundary,
      retail: map1777Palette.inkMuted,
      'sport-leisure': map1777Palette.inkMuted,
      transport: map1777Palette.rail,
      'visitor-amenity': map1777Palette.inkMuted,
    },
    roads: {
      bridge: map1777Palette.roadMajor,
      casing: map1777Palette.roadCasing,
      ferry: map1777Palette.waterInk,
      minor: map1777Palette.road,
      motorway: map1777Palette.roadMajor,
      path: map1777Palette.inkMuted,
      primary: map1777Palette.roadMajor,
      rail: map1777Palette.rail,
      secondary: map1777Palette.roadSecondary,
      trunk: map1777Palette.roadMajor,
      tunnel: map1777Palette.paperBright,
    },
  },
  typography: {
    font: map1777Regular,
    letterSpacing: 0.015,
    transform: 'none',
    places: {font: map1777Semibold, letterSpacing: 0.06, transform: 'uppercase'},
    poi: {font: map1777Regular, letterSpacing: 0.01, transform: 'none'},
    roads: {font: map1777Italic, letterSpacing: 0.015, transform: 'none'},
    water: {font: map1777Italic, letterSpacing: 0.05, transform: 'none'},
  },
  lighting: {
    // The day print's fixed atlas light stays attached to the map on rotation.
    anchor: 'map',
    color: '#F4E7C8',
    intensity: 0.28,
    position: [1.15, 215, 42],
    sun: {
      azimuth: 215,
      altitude: 48,
      color: '#F4E7C8',
      intensity: 0.38,
      shadowIntensity: 0.62,
    },
    ambient: {color: '#F7F0DD', intensity: 0.72},
  },
});

/**
 * A self-contained historical-atlas map. It shares only Tileflow's public
 * semantic compiler contract; it neither imports nor extends the Streets map.
 */
const map1777Day = bindOfficialMapTheme(
  defineMap({
    id: 'map-1777',
    version: 1,
    name: '1777',
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [map1777Fonts],
    icons: [map1777Icons],
    themes: {light: map1777Theme},
    defaultTheme: 'light',
    projection: 'mercator',
    terrain: 'none',
    modules: {
      addresses: addresses({
        labels: {
          minZoom: 19,
          text: {
            color: map1777Palette.inkMuted,
            font: map1777Regular,
            haloColor: map1777Palette.halo,
            haloWidth: 1,
            size: 9,
          },
        },
      }),
      aeroways: aeroways({
        area: {
          fill: {color: '#E4DCC6', minZoom: 10, opacity: 0.52},
          outline: {color: map1777Palette.aeroway, minZoom: 10, opacity: 0.55, width: 0.7},
        },
        runway: {
          casing: {color: map1777Palette.aeroway, minZoom: 10, opacity: 0.55},
          fill: {color: map1777Palette.paperBright, minZoom: 10, opacity: 0.72},
        },
        runwayRef: {visible: false},
        taxiway: {
          casing: {color: map1777Palette.aeroway, minZoom: 13, opacity: 0.4},
          fill: {color: map1777Palette.paperBright, minZoom: 13, opacity: 0.62},
        },
      }),
      boundaries: boundaries({
        admin2: {
          color: map1777Palette.boundary,
          dash: [5, 2, 1, 2],
          minZoom: 2,
          opacity: 0.82,
          width: zoom.linear([
            [2, 0.7],
            [10, 1.5],
          ]),
        },
        admin4: {
          color: map1777Palette.boundaryMuted,
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
          color: map1777Palette.waterInk,
          dash: [4, 3],
          minZoom: 3,
          opacity: 0.5,
          width: 0.8,
        },
      }),
      buildings: withRenderStack(
        buildings({
          threeDimensional: {
            lighting: 'sun',
            shadows: true,
            occlusion: true,
            edgeRadius: 0.45,
            edges: 0.32,
            edgeColor: map1777Palette.buildingOutline,
            colorVariation: 0.035,
          },
          businessCorridor: {
            fill: {visible: false},
            outline: {visible: false},
          },
          flat: {
            fill: {
              color: map1777Palette.building,
              minZoom: 13,
              opacity: zoom.linear([
                [13, 0],
                [14, 0.72],
                [16, 0.9],
              ]),
            },
            outline: {
              color: map1777Palette.buildingOutline,
              minZoom: 14,
              // Let red blocks read together before revealing individual plots.
              opacity: zoom.linear([
                [14, 0.32],
                [17, 0.55],
                [19, 0.72],
              ]),
              width: zoom.linear([
                [14, 0.25],
                [17, 0.45],
                [20, 0.75],
              ]),
            },
          },
          mode: 'flat',
        }),
        {
          printShadow: renderPass({
            placement: {below: 'buildings.flat.fill'},
            feature: 'building',
            renderer: 'line',
            style: {
              blur: 1.5,
              color: map1777Palette.ink,
              minZoom: 15,
              opacity: zoom.linear([
                [15, 0],
                [16, 0.08],
                [19, 0.14],
              ]),
              width: zoom.linear([
                [15, 0.6],
                [19, 3],
              ]),
            },
          }),
          // Keep the printed 2D footprints; the same 3D control as Streets raises
          // the city and replaces this group with Core's shared shadow renderer.
          extrusion: renderPass({
            placement: {above: 'buildings.flat.outline'},
            feature: 'building',
            renderer: 'extrusion',
            selector: {
              kind: 'all',
              selectors: [
                {field: 'hide3d', kind: 'compare', operator: 'ne', value: true},
                {field: 'hide3d', kind: 'compare', operator: 'ne', value: 1},
                {field: 'hide3d', kind: 'compare', operator: 'ne', value: '1'},
              ],
            },
            style: {
              base: map1777BuildingBase,
              color: map1777Palette.building,
              height: map1777BuildingHeight,
              minZoom: 15,
              opacity: 1,
              verticalGradient: true,
              visibilityGroup: 'building',
            },
          }),
        },
      ),
      labels: withRenderStack(
        labels({
          aerodromeCodes: 'none',
          junctions: false,
          language: 'local',
          places: 'all',
          roads: 'none',
          shields: 'none',
          styles: {
            aerodrome: {minZoom: 13},
            places: {
              continent: {
                maxZoom: 3.5,
                minZoom: 0,
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Semibold,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.7,
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
                  color: map1777Palette.ink,
                  font: map1777Semibold,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.8,
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
                  color: map1777Palette.ink,
                  font: map1777Semibold,
                  haloBlur: 0.4,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.8,
                  letterSpacing: 0.1,
                  size: zoom.linear([
                    [4, 15],
                    [13, 25],
                  ]),
                  transform: 'uppercase',
                },
              },
              town: {
                minZoom: 7,
                text: {
                  color: map1777Palette.ink,
                  font: map1777Semibold,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.7,
                  letterSpacing: 0.07,
                  size: zoom.linear([
                    [7, 13],
                    [14, 20],
                  ]),
                  transform: 'uppercase',
                },
              },
              village: {
                minZoom: 9,
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.7,
                  letterSpacing: 0.02,
                  size: zoom.linear([
                    [9, 12],
                    [15, 17],
                  ]),
                  transform: 'none',
                },
              },
              neighborhood: {
                minZoom: 12,
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloColor: map1777Palette.halo,
                  haloWidth: 0.6,
                  letterSpacing: 0.04,
                  size: zoom.linear([
                    [12, 13],
                    [16, 17],
                  ]),
                  transform: 'none',
                },
              },
            },
            water: {
              ocean: {
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloBlur: 0.6,
                  haloColor: map1777Palette.water,
                  haloWidth: 0.55,
                  letterSpacing: 0.08,
                  size: zoom.linear([
                    [1, 11],
                    [8, 17],
                  ]),
                  transform: 'none',
                },
              },
              other: {
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloBlur: 0.6,
                  haloColor: map1777Palette.water,
                  haloWidth: 0.55,
                  letterSpacing: 0.05,
                  transform: 'none',
                },
              },
              line: {
                spacing: 720,
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloBlur: 0.6,
                  haloColor: map1777Palette.water,
                  haloWidth: 0.55,
                  letterSpacing: 0.05,
                  transform: 'none',
                },
              },
              waterway: {
                minZoom: 12,
                spacing: 720,
                text: {
                  color: map1777Palette.inkMuted,
                  font: map1777Italic,
                  haloBlur: 0.6,
                  haloColor: map1777Palette.water,
                  haloWidth: 0.55,
                  letterSpacing: 0.04,
                  transform: 'none',
                },
              },
            },
          },
          water: 'all',
        }),
        {
          // Own these ground labels here: replacing the roads module must not
          // leave refinements pointing at optional road-label contributions.
          roadPaths: map1777StreetName(
            map1777PathLabel,
            ['path', 'path_construction'],
            ['path', 'bridleway', 'corridor', 'footway', 'cycleway', 'steps', 'pedestrian'],
          ),
          roadTrack: map1777StreetName(map1777PathLabel, [
            'track',
            'raceway',
            'track_construction',
            'raceway_construction',
          ]),
          roadService: map1777StreetName(
            {...map1777RoadLabel, minZoom: 16, priority: 48, spacing: 340},
            ['service', 'busway', 'bus_guideway', 'service_construction'],
          ),
          roadMinor: map1777StreetName({...map1777RoadLabel, minZoom: 14}, [
            'minor',
            'residential',
            'unclassified',
            'minor_construction',
          ]),
          roadTertiary: map1777StreetName({...map1777RoadLabel, minZoom: 12, priority: 72}, [
            'tertiary',
            'tertiary_construction',
          ]),
          roadSecondary: map1777StreetName(
            {...map1777RoadLabel, minZoom: 11, priority: 80, spacing: 360},
            ['secondary', 'secondary_construction'],
          ),
          roadPrimary: map1777StreetName(
            {...map1777RoadLabel, minZoom: 10, priority: 86, spacing: 360},
            ['primary', 'primary_construction'],
          ),
          roadTrunk: map1777StreetName(
            {...map1777RoadLabel, minZoom: 9, priority: 90, spacing: 400},
            ['trunk', 'trunk_construction'],
          ),
          roadMotorway: map1777StreetName(
            {...map1777RoadLabel, minZoom: 8, priority: 94, spacing: 400},
            ['motorway', 'motorway_construction'],
          ),
        },
      ),
      land: withRenderStack(
        land({
          background: {opacity: 1, pattern: 'map-1777-paper-grain'},
          globalLandcover: {
            color: expr.match(
              expr.get(field('class')),
              [
                {labels: 'barren', value: '#D4C9AD'},
                {labels: 'crop', value: map1777Palette.farmland},
                {labels: 'grass', value: map1777Palette.grass},
                {labels: 'shrub', value: map1777Palette.heath},
                {labels: 'snow', value: map1777Palette.ice},
                {labels: 'trees', value: map1777Palette.wood},
                {labels: 'urban', value: map1777Palette.urban},
              ],
              'rgba(0, 0, 0, 0)',
            ),
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
              fill: {
                color: expr.match(
                  map1777FieldVariant,
                  [
                    {labels: 1, value: map1777Palette.meadow},
                    {labels: 2, value: '#E5D4BC'},
                  ],
                  map1777Palette.farmland,
                ),
                minZoom: 7,
                opacity: detailFade(7, 0.74),
              },
            },
            flowerbed: {
              fill: {color: '#C8C592', minZoom: 12, opacity: detailFade(12, 0.72)},
            },
            grass: {fill: {color: map1777Palette.grass, minZoom: 7, opacity: detailFade(7, 0.68)}},
            ice: {fill: {color: map1777Palette.ice, minZoom: 7, opacity: detailFade(7, 0.72)}},
            meadow: {
              fill: {color: map1777Palette.meadow, minZoom: 7, opacity: detailFade(7, 0.68)},
            },
            protected: {fill: {color: '#AABC8A', minZoom: 7, opacity: detailFade(7, 0.42)}},
            recreationGround: {
              fill: {color: map1777Palette.recreation, minZoom: 9, opacity: detailFade(9, 0.62)},
            },
            rock: {fill: {color: '#D4C9AD', minZoom: 7, opacity: detailFade(7, 0.58)}},
            sand: {fill: {color: map1777Palette.sand, minZoom: 7, opacity: detailFade(7, 0.72)}},
            scrub: {fill: {color: map1777Palette.heath, minZoom: 7, opacity: detailFade(7, 0.7)}},
            urbanPark: {fill: {color: '#AFC39A', minZoom: 9, opacity: detailFade(9, 0.7)}},
            villageGreen: {fill: {color: '#BFCF9C', minZoom: 10, opacity: detailFade(10, 0.68)}},
            wetland: {
              fill: {color: map1777Palette.wetland, minZoom: 7, opacity: detailFade(7, 0.72)},
            },
            wood: {fill: {color: map1777Palette.wood, minZoom: 7, opacity: detailFade(7, 0.76)}},
          },
          landuse: {
            cemetery: {
              fill: {color: '#BCC99D', minZoom: 10, opacity: detailFade(10, 0.7)},
              outline: {color: '#778B5E', minZoom: 12, opacity: 0.55, width: 0.6},
            },
            civic: {fill: {color: '#E8DCC3', minZoom: 10, opacity: detailFade(10, 0.48)}},
            commercial: {fill: {color: '#E5D4BC', minZoom: 10, opacity: detailFade(10, 0.42)}},
            education: {fill: {color: '#E4DDC1', minZoom: 10, opacity: detailFade(10, 0.52)}},
            government: {fill: {color: '#E7D8BF', minZoom: 10, opacity: detailFade(10, 0.48)}},
            industrial: {fill: {color: '#D7CFBA', minZoom: 10, opacity: detailFade(10, 0.5)}},
            medical: {fill: {color: '#E8D9C6', minZoom: 11, opacity: detailFade(11, 0.48)}},
            military: {
              fill: {color: map1777Palette.military, minZoom: 8, opacity: detailFade(8, 0.42)},
            },
            parking: {
              fill: {color: map1777Palette.parking, minZoom: 15, opacity: detailFade(15, 0.55)},
              outline: {color: '#ADA186', minZoom: 16, opacity: 0.5, width: 0.5},
            },
            railway: {fill: {color: '#D9D1BD', minZoom: 11, opacity: detailFade(11, 0.42)}},
            recreation: {
              fill: {color: map1777Palette.recreation, minZoom: 9, opacity: detailFade(9, 0.58)},
              outline: {color: '#778B5E', minZoom: 13, opacity: 0.45, width: 0.6},
            },
            residential: {
              fill: {
                // Real settlement polygons carry the red wash before individual
                // buildings resolve, then give way to the detailed paper ground.
                color: zoom.linear([
                  [8, map1777Palette.urban],
                  [12, map1777Palette.urban],
                  [14, '#ECE0C6'],
                ]),
                minZoom: 7,
                opacity: detailFade(7, 0.62),
              },
            },
          },
        }),
        {
          farmlandTexture: landcoverPattern(
            'land.landcover.farmland.fill',
            expr.match<number, TileflowThemeImageValue>(
              map1777FieldVariant,
              [
                {labels: 1, value: token.image('land.field.cross')},
                {labels: 2, value: token.image('land.field.lines')},
              ],
              token.image('land.field.hatch'),
            ),
            ['farmland'],
            {minZoom: 8, opacity: 0.82},
          ),
          heathTexture: landcoverPattern('land.landcover.scrub.fill', 'map-1777-heath', ['grass'], {
            minZoom: 9,
            opacity: 0.72,
            subclasses: ['scrub'],
          }),
          orchardTexture: landcoverPattern(
            'land.landcover.urbanPark.fill',
            'map-1777-orchard',
            ['grass'],
            {minZoom: 11, opacity: 0.64, subclasses: ['park', 'garden']},
          ),
          sandTexture: landcoverPattern(
            'land.landcover.sand.fill',
            'map-1777-sand',
            ['sand', 'beach'],
            {minZoom: 9, opacity: 0.72},
          ),
          wetlandTexture: landcoverPattern(
            'land.landcover.wetland.fill',
            'map-1777-wetland',
            ['wetland'],
            {minZoom: 9, opacity: 0.78},
          ),
          woodTexture: landcoverPattern(
            'land.landcover.wood.fill',
            'map-1777-woodland',
            ['wood', 'forest'],
            {minZoom: 8, opacity: 0.82},
          ),
          residentialTexture: landusePattern(
            'land.landuse.residential.fill',
            'map-1777-residential',
            ['residential'],
            11,
            0.5,
          ),
        },
      ),
      landforms: landforms({
        elevation: true,
        classes: {
          cliff: {
            minZoom: 13,
            text: {
              color: map1777Palette.inkMuted,
              font: map1777Regular,
              haloColor: map1777Palette.halo,
              haloWidth: 1,
              size: 9,
            },
          },
          peak: {
            minZoom: 12,
            text: {
              color: map1777Palette.ink,
              font: map1777Regular,
              haloColor: map1777Palette.halo,
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
              color: map1777Palette.boundary,
              font: map1777Regular,
              haloColor: map1777Palette.halo,
              haloWidth: 1,
              size: 10,
            },
          },
        },
      }),
      poi: disable(),
      roads: withMap1777RoadDetail(
        roads({
          // This map supplies its own link passes and construction ordering.
          rampOrder: 'by-class',
          streetLights: {enabled: false},
          areas: {
            pedestrian: {
              fill: {color: '#EEE3C9', minZoom: 13, opacity: 0.68},
              outline: {color: map1777Palette.roadCasing, minZoom: 14, opacity: 0.42, width: 0.6},
            },
            pier: {
              fill: {visible: false},
              outline: {visible: false},
            },
            // Broad transport polygons can cover gardens and station grounds.
            // The mapped carriageways carry the road geometry instead.
            road: {fill: {visible: false}, outline: {visible: false}},
          },
          classes: {
            cycleway: map1777PathStyle('cycleway', '#E9E1C9', 13),
            footway: map1777PathStyle('footway', '#E9E1C9', 14),
            minor: map1777RoadStyle('minor', map1777Palette.road, map1777Palette.roadCasing, 12, {
              casingFade: 2,
              casingOpacity: 0.52,
              fillOpacity: 0.9,
            }),
            motorway: map1777RoadStyle('motorway', map1777Palette.roadMajor, '#8B7454', 5, {
              casingOpacity: 0.78,
            }),
            pathway: map1777PathStyle('pathway', '#E9E1C9', 14),
            pedestrian: map1777PathStyle('pedestrian', map1777Palette.road, 13),
            primary: map1777RoadStyle('primary', map1777Palette.roadMajor, '#8B7454', 7, {
              casingOpacity: 0.76,
            }),
            secondary: map1777RoadStyle('secondary', map1777Palette.roadSecondary, '#9C8868', 9, {
              casingOpacity: 0.68,
            }),
            service: map1777RoadStyle(
              'service',
              map1777Palette.road,
              map1777Palette.roadCasing,
              14,
              {
                casingOpacity: 0.4,
                fillOpacity: 0.82,
              },
            ),
            steps: map1777PathStyle('steps', map1777Palette.boundaryMuted, 15, [0.25, 0.2]),
            tertiary: map1777RoadStyle('tertiary', map1777Palette.roadSecondary, '#A19273', 10, {
              casingFade: 2,
              casingOpacity: 0.6,
              fillOpacity: 0.88,
            }),
            track: map1777PathStyle('track', '#E9E1C9', 13),
            trunk: map1777RoadStyle('trunk', map1777Palette.roadMajor, '#8B7454', 6, {
              casingOpacity: 0.78,
            }),
          },
          detail: 'all',
          extras: {paths: true},
          hierarchy: 'clear',
          modifiers: {
            construction: {
              // Works have their own ink plates below live roads. Disable the
              // inherited conditional dash so solid roads use the solid-line shader.
              enabled: false,
            },
            indoor: {
              surface: {
                casing: {dash: [1, 0], opacity: 0.4},
                fill: {dash: [1, 0], opacity: 0.72},
              },
            },
            unpaved: {
              surface: {
                casing: {dash: [1, 0], opacity: 0.42},
                fill: {dash: [1, 0], opacity: 0.82},
              },
            },
          },
          oneWayMarkers: false,
          outline: 'strong',
          restrictions: {
            access: {
              widthScale: 1,
              surface: {
                casing: {dash: [1, 0], opacity: 0.52},
                fill: {dash: [1, 0], opacity: 0.9},
              },
            },
          },
          sidewalks: {
            outline: {color: '#8E7A61', minZoom: 17, opacity: 0.32, width: 0.5},
            surface: {color: '#EEE5D0', minZoom: 17, opacity: 0.58},
          },
          weight: 'thin',
        }),
        {
          pedestrianGround: refineRenderTarget({
            target: 'roads.areas.pedestrian.fill',
            // A built-in target survives replacing the land module in an extension.
            placement: {below: 'land.landcover.farmland.fill'},
            requirements: ['land'],
          }),
          pedestrianOutline: refineRenderTarget({
            target: 'roads.areas.pedestrian.outline',
            placement: {above: 'roads.areas.pedestrian.fill'},
            requirements: ['land'],
          }),
        },
      ),
      transit: transit({
        cableway: {
          color: map1777Palette.inkMuted,
          dash: [2, 2],
          minZoom: 10,
          opacity: 0.5,
          width: 0.8,
        },
        ferry: {
          color: map1777Palette.waterInk,
          dash: [4, 2],
          minZoom: 5,
          opacity: 0.46,
          width: zoom.linear([
            [5, 0.4],
            [16, 0.8],
          ]),
        },
        rail: {
          bridge: {color: map1777Palette.rail, minZoom: 7, opacity: 0.88, width: 1.4},
          surface: {color: map1777Palette.rail, minZoom: 7, opacity: 0.82, width: 1.2},
          tunnel: {
            color: map1777Palette.rail,
            dash: [2, 1.5],
            minZoom: 9,
            opacity: 0.42,
            width: 1,
          },
        },
        railHatching: {
          bridge: {color: map1777Palette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.7},
          surface: {color: map1777Palette.paperBright, dash: [1, 1.4], minZoom: 9, width: 0.65},
          tunnel: {visible: false},
        },
        serviceRail: {
          bridge: {color: map1777Palette.rail, minZoom: 12, opacity: 0.55, width: 0.8},
          surface: {color: map1777Palette.rail, minZoom: 12, opacity: 0.5, width: 0.75},
          tunnel: {
            color: map1777Palette.rail,
            dash: [2, 1.5],
            minZoom: 12,
            opacity: 0.3,
            width: 0.7,
          },
        },
      }),
      vegetation: vegetation({
        flat: {
          color: expr.match(
            expr.coalesce(expr.get(field('leafType')), ''),
            [
              {labels: ['needleleaved', 'needleleaf'], value: '#82985F'},
              {labels: ['broadleaved', 'broadleaf'], value: '#9AAC73'},
            ],
            map1777Palette.wood,
          ),
          minZoom: 15,
          opacity: detailFade(15, 0.76),
          radius: zoom.linear([
            [15, 1.6],
            [19, 4.2],
          ]),
          strokeColor: '#4E6541',
          strokeOpacity: detailFade(15, 0.42),
          strokeWidth: 0.45,
        },
        mode: 'auto',
        fallback: 'flat',
        threeDimensional: {
          barkColor: map1777Palette.inkMuted,
          broadleafColors: ['#82985F', '#9AAC73', map1777Palette.wood, '#AABC8A'],
          coniferColors: ['#6F8855', '#82985F', '#9AAC73'],
          palmColors: ['#82985F', '#9AAC73', '#AABC8A'],
          finish: 'toon',
          edges: 0.24,
          edgeColor: '#4E6541',
          heightScale: 1,
          crownScale: 1,
        },
      }),
      water: withRenderStack(
        water({
          bathymetry: {
            color: expr.match(
              expr.toNumber(expr.get(field('bathymetryMinDepth')), 0),
              [
                {labels: 0, value: map1777Palette.water},
                {labels: -200, value: '#BACDB1'},
                {labels: -1000, value: '#AFC5AC'},
                {labels: -2000, value: '#A2BBA3'},
                {labels: -4000, value: '#96B29C'},
                {labels: -6000, value: '#89A593'},
              ],
              map1777Palette.water,
            ),
            maxZoom: 9,
            minZoom: 0,
            opacity: zoom.linear([
              [0, 0.72],
              [7, 0.55],
              [9, 0],
            ]),
          },
          bodies: {
            fill: {color: map1777Palette.water, opacity: 1},
            outline: {
              color: map1777Palette.waterInk,
              minZoom: 5,
              opacity: 0.58,
              width: zoom.linear([
                [5, 0.25],
                [14, 0.55],
                [18, 0.75],
              ]),
            },
          },
          intermittent: {
            bodies: {fill: {color: map1777Palette.water, opacity: 0.52}},
            waterways: {
              color: map1777Palette.waterInk,
              dash: [3, 2],
              opacity: 0.48,
            },
          },
          waterways: {
            canal: {
              color: map1777Palette.waterInk,
              minZoom: 8,
              opacity: 0.9,
              width: zoom.linear([
                [8, 0.35],
                [16, 1.8],
              ]),
            },
            other: {
              color: map1777Palette.waterInk,
              minZoom: 12,
              opacity: 0.7,
              width: zoom.linear([
                [12, 0.25],
                [17, 1],
              ]),
            },
            river: {
              color: map1777Palette.waterInk,
              minZoom: 6,
              opacity: 0.94,
              width: zoom.linear([
                [6, 0.4],
                [16, 2.2],
              ]),
            },
            stream: {
              color: map1777Palette.waterInk,
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
          // A mapped river polygon covers its survey centreline. Small streams
          // without an area remain visible, including their intermittent marks.
          ...Object.fromEntries(
            (['canal', 'other', 'river', 'stream'] as const).flatMap((waterway) =>
              ['', 'intermittent.'].map((variant) => [
                `${variant ? 'intermittent' : 'regular'}${waterway}UnderWash`,
                refineRenderTarget({
                  target: `water.${variant}waterways.${waterway}`,
                  placement: {below: 'water.bodies.fill'},
                }),
              ]),
            ),
          ),
          bankOutline: refineRenderTarget({
            target: 'water.bodies.outline',
            // Opaque water masks the inside half of the shore ink, including
            // shared polygon edges at confluences; the exterior bank survives.
            placement: {below: 'water.bodies.fill'},
          }),
          bankWash: renderPass({
            placement: {below: 'water.bodies.outline'},
            feature: 'water',
            renderer: 'line',
            selector: {
              coerce: 'number',
              fallback: 0,
              field: 'intermittent',
              kind: 'compare',
              operator: 'ne',
              value: 1,
            },
            style: {
              color: map1777Palette.waterBank,
              minZoom: 9,
              blur: 3,
              join: 'round',
              opacity: detailFade(9, 0.19),
              width: zoom.linear([
                [9, 2],
                [14, 4],
                [18, 7],
              ]),
            },
          }),
          ripples: renderPass({
            placement: {above: 'water.bodies.fill'},
            feature: 'water',
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
                [9, 0.44],
                [16, 0.3],
              ]),
              pattern: 'map-1777-water-ripples',
            },
          }),
          intermittentRipples: renderPass({
            placement: {above: 'water.intermittent.bodies.fill'},
            feature: 'water',
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
              pattern: 'map-1777-water-ripples',
            },
          }),
        },
      ),
    },
    view: {
      center: [4.3517, 50.8503],
      pitch: 0,
      bearing: 0,
      zoom: 13.5,
    },
  }),
);

export const map1777 = defineMap({
  ...map1777Day,
  themes: map1777TimeThemes(map1777Day.themes!.light),
  systemThemes: {light: 'light', dark: 'dark'},
  timeOfDay: {light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'}},
});
