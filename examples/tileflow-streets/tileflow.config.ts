import {
  addLayer,
  buildings,
  defineTileflow,
  expression,
  labels,
  land,
  patchLayer,
  poi,
  roads,
  streets,
  type TileflowLineCap,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  tileflowWorldV1Schema,
  transit,
  vectorTiles,
  water,
  zoom,
} from '@tileflow/core';

const developmentTilesRevision = 'tileflow-world-v1-recipe-1.1.0-local';
const developmentTilesAttribution =
  '© OpenMapTiles, © OpenStreetMap contributors, © ESA WorldCover, © Overture Maps Foundation, GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa';
const developmentTilesUrl =
  process.env.TILEFLOW_STREETS_TILEJSON_URL ?? 'http://127.0.0.1:8080/tiles.json';
const developmentTileSchema = tileflowWorldV1Schema();

// Measured from the current Google Maps light basemap. Keep the semantic
// colours in one place: module defaults, explicit class styles, and local
// overlays must not drift into separate visual systems.
const googlePalette = {
  background: '#FAFAFA',
  boundary: '#BFC8CF',
  building: '#E4E5EA',
  buildingActive: '#F5E9CE',
  buildingCommercial: '#F5E9CE',
  buildingDestination: '#F5E9CE',
  buildingIndustrial: '#F5E9CE',
  buildingOutline: '#BFC2C6',
  businessCorridor: '#F5E9CE',
  businessCorridorOutline: '#E6DCC5',
  cemetery: '#D4E8D9',
  farmland: '#DCECCB',
  greenspace: '#C3F1D5',
  greenspaceDark: '#C6E8D2',
  greenspaceLight: '#DAF0DF',
  halo: '#FFFFFF',
  ice: '#F5FAFC',
  land: '#FAFAFA',
  landuseMedical: '#F9E9E6',
  parking: '#F0EDED',
  parkPath: '#50AD90',
  poiCoffee: '#EF8840',
  poiCulture: '#7A45CC',
  poiEducation: '#7D8F9B',
  poiFood: '#EF8840',
  poiHealth: '#F04455',
  poiLodging: '#E556C2',
  poiParking: '#8C78F6',
  poiServices: '#7D8F9B',
  poiShopping: '#0F9D82',
  protected: '#D1E3D9',
  rail: '#7D8F9B',
  road: '#B3BDCC',
  roadCasing: '#FDFDFD',
  roadMajor: '#B3BDCC',
  roadMinor: '#B3BDCC',
  roadTunnel: '#D9E1E7',
  roadTunnelBorder: '#AAB8C3',
  roadTrunk: '#B1C0CF',
  roadTrunkOverview: '#ADBDCD',
  sand: '#F4EBD7',
  text: '#48556B',
  textMuted: '#7D8F9B',
  textStrong: '#3C3834',
  transit: '#5474D4',
  water: '#A2D9F3',
  waterDeep: '#72C5EE',
  waterText: '#43869A',
  waterway: '#72CBE7',
  wetland: '#C0DCD0',
} as const;

type WidthStops = readonly (readonly [number, number])[];
type ColorStops = readonly (readonly [number, string])[];

function darkenColor(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const channel = (offset: number) =>
    Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

const roadBorderZoom = 16;
const roadBorderTotalWidth = 2;
const roadBorderDarkening = 0.1;
const expresswayBorderDarkening = 0.2;
const roadSurfaceColor = googlePalette.roadMinor;
const roadCasingColor = googlePalette.roadCasing;
const primaryRoadSurfaceColor = googlePalette.road;
const secondaryRoadSurfaceColor = googlePalette.road;
const tertiaryRoadSurfaceColor = googlePalette.roadMinor;
const parkPathSurfaceColor = googlePalette.parkPath;
const buildingFillColor = googlePalette.building;
const buildingOutlineColor = googlePalette.buildingOutline;
const buildingColors = {
  active: googlePalette.buildingActive,
  civic: googlePalette.building,
  commercial: googlePalette.buildingCommercial,
  destination: googlePalette.buildingDestination,
  generic: buildingFillColor,
  industrial: googlePalette.buildingIndustrial,
  residential: googlePalette.building,
} as const;
const warmBuildingFilter = [
  'any',
  [
    'match',
    ['coalesce', ['get', 'building_tone'], ''],
    ['active', 'commercial', 'destination'],
    true,
    false,
  ],
  // Immutable V8.9 archives remain readable while new candidates emit building_tone.
  ['==', ['coalesce', ['get', 'building_kind'], 'generic'], 'commercial'],
  ['==', ['get', 'has_business'], true],
  ['==', ['get', 'has_business'], 1],
  ['==', ['get', 'has_business'], '1'],
];
const building3dColors = {
  commercial: {bottom: '#BDB9B2', top: '#ECE5D8'},
  neutral: {bottom: '#ACADB1', top: '#DEDFE7'},
} as const;
const building3dColor = [
  'case',
  warmBuildingFilter,
  building3dColors.commercial.top,
  building3dColors.neutral.top,
];
const building3dShadowColor = [
  'case',
  warmBuildingFilter,
  building3dColors.commercial.bottom,
  building3dColors.neutral.bottom,
];
const buildingSemanticColor = [
  'case',
  warmBuildingFilter,
  buildingColors.active,
  buildingColors.generic,
];
const visibleBuilding3dFilter = [
  'all',
  ['!=', ['get', 'hide_3d'], true],
  ['!=', ['get', 'hide_3d'], 1],
  ['!=', ['get', 'hide_3d'], '1'],
  // A parent with parts is only an association footprint. Drawing
  // it as a solid extrusion buries the richer building:part volumes.
  ['!=', ['get', 'has_parts'], true],
  ['!=', ['get', 'has_parts'], 1],
  ['!=', ['get', 'has_parts'], '1'],
];
const building3dHeight = ['max', 0, ['to-number', ['coalesce', ['get', 'render_height'], 5], 5]];
const building3dBase = [
  'max',
  0,
  ['min', ['to-number', ['coalesce', ['get', 'render_min_height'], 0], 0], building3dHeight],
];
const circularRoadRadiusAtZ15 = ['to-number', ['get', 'radius_px_z15'], 0];
const circularRoadRadiusMetres = ['to-number', ['get', 'radius_m'], 0];
const circularRoadOuterRadiusMetres = ['to-number', ['get', 'outer_radius_m'], 0];
const circularRoadInnerRadiusMetres = ['to-number', ['get', 'inner_radius_m'], 0];
const roadClearanceExtraAtZ15 = [
  'to-number',
  ['coalesce', ['get', 'clearance_extra_px_z15'], 0],
  0,
];
const roadNeedsStructuralButtCap = [
  'any',
  ['==', ['get', 'brunnel'], 'tunnel'],
  ['==', ['get', 'class'], 'steps'],
  ['==', ['get', 'subclass'], 'steps'],
];
const nonExtendingRoadCap = expression<TileflowLineCap>([
  'step',
  ['zoom'],
  ['case', roadNeedsStructuralButtCap, 'butt', 'round'],
  17,
  ['case', ['any', roadNeedsStructuralButtCap, ['>', roadClearanceExtraAtZ15, 0]], 'butt', 'round'],
]);
const hasPhysicalCircularRadii = [
  'all',
  ['>', circularRoadRadiusMetres, 0],
  ['>', circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres],
  ['>=', circularRoadInnerRadiusMetres, 0],
];
const circularRoadBaseWidth = [
  'match',
  ['coalesce', ['get', 'class'], 'minor'],
  'motorway',
  6,
  'trunk',
  5.5,
  'primary',
  5,
  'secondary',
  4.5,
  'tertiary',
  4,
  'service',
  2.5,
  'track',
  2,
  3,
];
const circularRoadRadius = circularRoadMetricRadius();
const circularRoadWidth = circularRoadStrokeWidth(false);
const circularRoadCasingWidth = circularRoadStrokeWidth(true);
const expresswayWidthScale = 1.06;
const rampWidthScale = 0.52;
const tunnelBorderDash = [8, 5] as const;
const tunnelBorderWidth = 1;
const serviceRoadWidthScales = {
  alley: 0.68,
  crossover: 0.5,
  driveway: 0.58,
  parking_aisle: 0.62,
  yard: 0.55,
} as const;

function addFixedRoadBorder(width: unknown) {
  return ['+', width, roadBorderTotalWidth];
}

function circularRoadLegacyScale(level: number) {
  const interpolationBase = 1.35;
  const progress = (interpolationBase ** (level - 15) - 1) / (interpolationBase ** (22 - 15) - 1);
  return 1 + progress * 1.2;
}

function circularRoadWidthAtLevel(level: number) {
  const scale = circularRoadLegacyScale(level);
  return level === 15 ? circularRoadBaseWidth : ['*', circularRoadBaseWidth, scale];
}

function circularRoadMetricRadius() {
  const stops: unknown[] = [];
  for (let level = 15; level <= 22; level += 1) {
    const centerlineRadius =
      level === 15 ? circularRoadRadiusAtZ15 : ['*', circularRoadRadiusAtZ15, 2 ** (level - 15)];
    const physicalRadius = [
      '*',
      centerlineRadius,
      [
        '/',
        ['+', circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres],
        ['*', 2, circularRoadRadiusMetres],
      ],
    ];
    const fallbackRadius =
      level === 15 ? circularRoadRadiusAtZ15 : ['*', circularRoadRadiusAtZ15, 2 ** (level - 15)];
    stops.push(level, ['case', hasPhysicalCircularRadii, physicalRadius, fallbackRadius]);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

function circularRoadStrokeWidth(casing: boolean) {
  const stops: unknown[] = [];
  for (let level = 15; level <= 22; level += 1) {
    const fallbackWidth = circularRoadWidthAtLevel(level);
    const centerlineRadius =
      level === 15 ? circularRoadRadiusAtZ15 : ['*', circularRoadRadiusAtZ15, 2 ** (level - 15)];
    const physicalWidth = [
      '*',
      centerlineRadius,
      [
        '/',
        ['-', circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres],
        circularRoadRadiusMetres,
      ],
    ];
    const physicalOutput = casing ? ['+', physicalWidth, roadBorderTotalWidth] : physicalWidth;
    const fallbackOutput = casing ? ['+', fallbackWidth, roadBorderTotalWidth] : fallbackWidth;
    stops.push(level, ['case', hasPhysicalCircularRadii, physicalOutput, fallbackOutput]);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

function numberAtZoom(stops: WidthStops, level: number): number {
  const first = stops[0]!;
  if (level <= first[0]) return first[1];
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]!;
    const next = stops[index]!;
    if (level <= next[0]) {
      return (
        previous[1] + ((next[1] - previous[1]) * (level - previous[0])) / (next[0] - previous[0])
      );
    }
  }
  return stops.at(-1)![1];
}

function roadWidth(widths: WidthStops, oneWayScale: number, casing = false, clearance = true) {
  const augmentedWidths = [...widths];
  augmentedWidths.sort(([left], [right]) => left - right);
  const widthOutput = (width: number) =>
    oneWayScale === 1 ? width : ['match', ['get', 'oneway'], [1, -1], width * oneWayScale, width];
  const resolvedWidths: Array<readonly [number, unknown]> = casing
    ? [
        ...augmentedWidths
          .filter(([level]) => level < roadBorderZoom - 0.01)
          .map(([level, width]) => [level, widthOutput(width)] as const),
        [roadBorderZoom - 0.01, widthOutput(numberAtZoom(widths, roadBorderZoom - 0.01))],
        [roadBorderZoom, addFixedRoadBorder(widthOutput(numberAtZoom(widths, roadBorderZoom)))],
        ...augmentedWidths
          .filter(([level]) => level > roadBorderZoom)
          .map(([level, width]) => [level, addFixedRoadBorder(widthOutput(width))] as const),
      ]
    : augmentedWidths.map(([level, width]) => [level, widthOutput(width)] as const);
  if (!clearance) {
    return expression<number>([
      'interpolate',
      ['linear'],
      ['zoom'],
      ...resolvedWidths.flatMap(([level, width]) => [level, width]),
    ]);
  }
  const clearanceStart = 17;
  const gatedWidths = [
    ...resolvedWidths,
    [
      clearanceStart - 0.001,
      casing
        ? addFixedRoadBorder(widthOutput(numberAtZoom(widths, clearanceStart - 0.001)))
        : widthOutput(numberAtZoom(widths, clearanceStart - 0.001)),
    ] as const,
    [
      clearanceStart,
      casing
        ? addFixedRoadBorder(widthOutput(numberAtZoom(widths, clearanceStart)))
        : widthOutput(numberAtZoom(widths, clearanceStart)),
    ] as const,
  ]
    .sort(([left], [right]) => left - right)
    .filter(
      ([level], index, values) => index === values.length - 1 || values[index + 1]![0] !== level,
    )
    .map(
      ([level, width]) =>
        [
          level,
          level >= clearanceStart
            ? ['+', width, ['*', roadClearanceExtraAtZ15, 2 ** (level - 15)]]
            : width,
        ] as const,
    );
  return expression<number>([
    'interpolate',
    ['linear'],
    ['zoom'],
    ...gatedWidths.flatMap(([level, width]) => [level, width]),
  ]);
}

function mixHexColors(left: string, right: string, amount: number): string {
  const leftValue = left.replace('#', '');
  const rightValue = right.replace('#', '');
  const channel = (offset: number) =>
    Math.round(
      Number.parseInt(leftValue.slice(offset, offset + 2), 16) * (1 - amount) +
        Number.parseInt(rightValue.slice(offset, offset + 2), 16) * amount,
    )
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function colorAtZoom(stops: ColorStops, level: number): string {
  const first = stops[0]!;
  if (level <= first[0]) return first[1];
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]!;
    const next = stops[index]!;
    if (level <= next[0]) {
      return mixHexColors(previous[1], next[1], (level - previous[0]) / (next[0] - previous[0]));
    }
  }
  return stops.at(-1)![1];
}

function roadCasingColorStops(
  surfaceColor: string,
  surfaceStops: ColorStops | undefined,
  legacyStops: ColorStops | undefined,
  darkening = roadBorderDarkening,
): ColorStops {
  const resolvedSurfaceStops = surfaceStops ?? [
    [0, surfaceColor],
    [22, surfaceColor],
  ];
  const resolvedLegacyStops = legacyStops ?? [
    [0, roadCasingColor],
    [22, roadCasingColor],
  ];
  const transitionStart = roadBorderZoom - 0.01;
  const stops: Array<readonly [number, string]> = resolvedLegacyStops.filter(
    ([level]) => level < transitionStart,
  );
  stops.push([transitionStart, colorAtZoom(resolvedLegacyStops, transitionStart)]);
  stops.push([
    roadBorderZoom,
    darkenColor(colorAtZoom(resolvedSurfaceStops, roadBorderZoom), darkening),
  ]);
  for (const [level, color] of resolvedSurfaceStops) {
    if (level > roadBorderZoom) stops.push([level, darkenColor(color, darkening)]);
  }
  if (stops.at(-1)![0] < 22) {
    stops.push([22, darkenColor(colorAtZoom(resolvedSurfaceStops, 22), darkening)]);
  }
  return stops;
}

function cityRoadStyle(
  color: string,
  widths: WidthStops,
  options: {
    casingColorStops?: ColorStops;
    casingDarkening?: number;
    clearance?: boolean;
    colorStops?: ColorStops;
    minZoom?: number;
    oneWayScale?: number;
    opacityStops?: WidthStops;
    rankedLowZoom?: boolean;
    smallBridge?: boolean;
    tunnelVisible?: boolean;
  } = {},
): TileflowRoadClassStyle {
  const {
    casingColorStops,
    casingDarkening = roadBorderDarkening,
    clearance = true,
    colorStops,
    minZoom,
    oneWayScale = 1,
    opacityStops,
    rankedLowZoom = false,
    smallBridge = false,
    tunnelVisible = true,
  } = options;
  // Country zooms keep only the main hierarchy on screen; each class joins at
  // its own minZoom so low zooms stay as simple as the reference basemaps.
  const zoomRange = minZoom === undefined ? {} : {minZoom};
  const topMotorway = [
    'any',
    ['==', ['slice', ['coalesce', ['get', 'ref'], ''], 0, 1], 'E'],
    ['==', ['get', 'network'], 'e-road'],
  ];
  const opacity = rankedLowZoom
    ? expression<number>([
        'interpolate',
        ['linear'],
        ['zoom'],
        3.2,
        ['case', topMotorway, 0.12, 0],
        4,
        ['case', topMotorway, 0.45, 0],
        4.6,
        ['case', topMotorway, 0.8, 0.18],
        5,
        ['case', topMotorway, 1, 0.65],
        5.8,
        1,
      ])
    : opacityStops
      ? zoom.linear(opacityStops)
      : 1;
  const surfaceColor = colorStops ? zoom.linear(colorStops) : color;
  const resolvedCasingColor = zoom.linear(
    roadCasingColorStops(color, colorStops, casingColorStops, casingDarkening),
  );
  const fill = {
    ...zoomRange,
    cap: nonExtendingRoadCap,
    color: surfaceColor,
    join: 'round' as const,
    opacity,
    width: roadWidth(widths, oneWayScale, false, clearance),
  };
  const casing = {
    ...zoomRange,
    // Before z16 the casing width is identical to the fill and is fully covered.
    // Do not make MapLibre build duplicate road buckets for an invisible pass.
    minZoom: Math.max(minZoom ?? 0, roadBorderZoom),
    cap: nonExtendingRoadCap,
    // Border reads as a subtle shade of the road itself rather than a white halo.
    color: resolvedCasingColor,
    join: 'round' as const,
    opacity,
    width: roadWidth(widths, oneWayScale, true, clearance),
  };

  return {
    surface: {casing, fill},
    bridge: smallBridge
      ? {
          casing: {...casing, color: googlePalette.roadTunnelBorder, opacity: 1},
          fill: {...fill, color: googlePalette.roadTunnel, opacity: 1},
        }
      : {casing, fill},
    tunnel: tunnelVisible
      ? {
          casing: {
            ...casing,
            cap: nonExtendingRoadCap,
            color: googlePalette.roadTunnelBorder,
            dash: tunnelBorderDash,
            gapWidth: roadWidth(widths, oneWayScale, false, clearance),
            opacity: 1,
            width: tunnelBorderWidth,
          },
          fill: {
            ...fill,
            cap: nonExtendingRoadCap,
            color: googlePalette.roadTunnel,
            opacity: 0.5,
          },
          hatch: {
            visible: false,
          },
        }
      : {
          casing: {visible: false},
          fill: {visible: false},
          hatch: {visible: false},
          shadow: {visible: false},
        },
  };
}

function pathRoadStyle(
  color: string,
  widths: WidthStops,
  options: {
    casingColor?: string;
    dash?: readonly number[];
    minZoom?: number;
  } = {},
): TileflowRoadClassStyle {
  const zoomRange = options.minZoom === undefined ? {} : {minZoom: options.minZoom};
  const fill = {
    ...zoomRange,
    cap: nonExtendingRoadCap,
    color,
    ...(options.dash ? {dash: [...options.dash]} : {}),
    join: 'round' as const,
    opacity: 1,
    width: roadWidth(widths, 1, false, false),
  };
  const casing = {
    ...zoomRange,
    minZoom: Math.max(options.minZoom ?? 0, roadBorderZoom),
    cap: nonExtendingRoadCap,
    color: options.casingColor ?? darkenColor(color, roadBorderDarkening),
    join: 'round' as const,
    opacity: 1,
    width: roadWidth(widths, 1, true, false),
  };

  return {
    surface: {casing, fill},
    // Local, pedestrian, and path bridges use the quiet structural grey. Main
    // road bridges retain their class colour in cityRoadStyle.
    bridge: {
      casing: {...casing, color: googlePalette.roadTunnelBorder, opacity: 1},
      fill: {...fill, color: googlePalette.roadTunnel, opacity: 1},
    },
    tunnel: {
      casing: {
        ...casing,
        cap: nonExtendingRoadCap,
        color: googlePalette.roadTunnelBorder,
        dash: tunnelBorderDash,
        gapWidth: fill.width,
        opacity: 1,
        width: tunnelBorderWidth,
      },
      fill: {
        ...fill,
        cap: nonExtendingRoadCap,
        color: googlePalette.roadTunnel,
        dash: [1, 0],
        opacity: 0.5,
      },
      hatch: {visible: false},
    },
  };
}

function roadLabelStyle(major: boolean): TileflowSymbolStyle {
  return {
    placement: 'line',
    priority: major ? 90 : 50,
    spacing: major ? 260 : 320,
    text: {
      color: googlePalette.textStrong,
      font: 'Metropolis',
      haloBlur: 1,
      haloColor: googlePalette.halo,
      haloWidth: 1,
      letterSpacing: 0.01,
      maxAngle: 30,
      padding: 1,
      size: zoom.linear([
        [10, major ? 10 : 9],
        [15, major ? 13.75 : 12.25],
        [18, major ? 16 : 14],
      ]),
      weight: 'regular',
    },
  };
}

export default defineTileflow({
  themes: {
    // Record of reusable theme names.
    editorial: {
      // 'standard' | 'light' | 'dark' | 'minimal' | another project theme name.
      extends: 'light',
      mode: 'light', // 'light' | 'dark'.
      colors: {
        // Optional keys: background, land, water, park, building, road, roadMajor,
        // roadCasing, boundary, text, textMuted, and textHalo.
        background: googlePalette.background, // Hex: #RGB | #RGBA | #RRGGBB | #RRGGBBAA.
        land: googlePalette.land, // Hex color.
        water: googlePalette.water, // Hex color.
        park: googlePalette.greenspace, // Hex color.
        building: buildingFillColor, // Hex color.
        road: googlePalette.roadMinor, // Hex color.
        roadMajor: googlePalette.roadMajor, // Hex color.
        roadCasing: googlePalette.roadCasing, // Hex color.
        boundary: googlePalette.boundary, // Hex color.
        text: googlePalette.text, // Hex color.
        textMuted: googlePalette.textMuted, // Hex color.
        textHalo: googlePalette.halo, // Hex color.
      },
      modules: {
        buildings: {
          active: buildingColors.active,
          businessCorridor: googlePalette.businessCorridor,
          businessCorridorOutline: googlePalette.businessCorridorOutline,
          civic: buildingColors.civic,
          commercial: buildingColors.commercial,
          destination: buildingColors.destination,
          generic: buildingColors.generic,
          industrial: buildingColors.industrial,
          residential: buildingColors.residential,
        },
        hydro: {
          // Optional keys: ferry, label, water, waterway.
          label: googlePalette.waterText, // Hex color.
          water: googlePalette.water, // Hex color.
          waterway: googlePalette.waterway, // Hex color.
        },
        labels: {
          // Optional keys: country, halo, muted, neighborhood, poi, primary, road,
          // settlement, water.
          country: googlePalette.text, // Hex color.
          halo: googlePalette.halo, // Hex color.
          neighborhood: googlePalette.textMuted, // Hex color.
          road: googlePalette.text, // Hex color.
          settlement: googlePalette.text, // Hex color.
          water: googlePalette.waterText, // Hex color.
        },
        landcover: {
          // Optional keys: farmland, grass, ice, park, protected, rock, sand,
          // wetland, wood.
          farmland: googlePalette.farmland, // Hex color.
          grass: googlePalette.greenspace, // Hex color.
          ice: googlePalette.ice, // Hex color.
          park: googlePalette.greenspace, // Hex color.
          protected: googlePalette.protected, // Hex color.
          rock: googlePalette.background, // Hex color.
          sand: googlePalette.sand, // Hex color.
          wetland: googlePalette.wetland, // Hex color.
          wood: googlePalette.greenspaceDark, // Hex color.
        },
        landuse: {
          // Optional keys: cemetery, civic, commercial, education, government,
          // industrial, medical, parking, residential.
          cemetery: googlePalette.cemetery, // Hex color.
          civic: buildingFillColor, // Hex color.
          commercial: googlePalette.land, // Hex color; corridors come from business_corridor.
          education: googlePalette.greenspaceLight, // Hex color.
          government: googlePalette.buildingDestination, // Hex color.
          industrial: googlePalette.land, // Hex color.
          medical: googlePalette.land, // Hex color.
          parking: googlePalette.parking, // Hex color.
          residential: googlePalette.land, // Hex color.
        },
        poi: {
          // Optional keys: coffee, culture, education, food, halo, health, icon,
          // label, lodging, services, shopping, transit.
          coffee: googlePalette.poiCoffee, // Hex color.
          culture: googlePalette.poiCulture, // Hex color.
          education: googlePalette.poiEducation, // Hex color.
          food: googlePalette.poiFood, // Hex color.
          health: googlePalette.poiHealth, // Hex color.
          icon: googlePalette.poiServices, // Hex color.
          label: googlePalette.textStrong, // Hex color.
          lodging: googlePalette.poiLodging, // Hex color.
          services: googlePalette.poiServices, // Hex color.
          shopping: googlePalette.poiShopping, // Hex color.
          transit: googlePalette.transit, // Hex color.
        },
        roads: {
          // Optional keys: bridge, casing, ferry, minor, motorway, path, primary,
          // rail, secondary, trunk, tunnel.
          bridge: googlePalette.roadMajor, // Hex color.
          casing: googlePalette.roadCasing, // Hex color.
          minor: googlePalette.roadMinor, // Hex color.
          motorway: googlePalette.roadMajor, // Hex color.
          path: googlePalette.roadMinor, // Hex color.
          primary: googlePalette.roadMajor, // Hex color.
          rail: googlePalette.rail, // Hex color.
          secondary: googlePalette.road, // Hex color.
          trunk: googlePalette.roadMajor, // Hex color.
          tunnel: googlePalette.road, // Hex color.
        },
      },
      typography: {
        // Any non-empty font family available from the configured glyph endpoint.
        font: 'Metropolis',
        weight: 'regular', // 'regular' | 'medium' | 'semibold' | 'bold'.
        places: {
          // Domain overrides also accept font; domains: places, roads, water, poi.
          weight: 'medium', // 'regular' | 'medium' | 'semibold' | 'bold'.
        },
      },
    },
  },
  maps: {
    'editorial-city': {
      // Any safe map ID: letters, numbers, underscores, or hyphens.
      name: 'Tileflow Editorial City', // Any non-empty display name.
      basemap: streets(), // streets({variant: 'light' | 'dark'}).
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      light: {
        anchor: 'viewport',
        // A low directional intensity keeps the authored palette dominant
        // while MapLibre's height-aware wall gradient adds slightly more
        // depth to tall extrusions than to short buildings.
        color: '#FFFFFF',
        intensity: 0.15,
        position: [1.15, 210, 30],
      },
      projection: 'globe', // 'globe' | 'mercator'. Globe becomes planar at street zooms.
      data: vectorTiles({
        attribution: developmentTilesAttribution,
        revision: developmentTilesRevision,
        schema: developmentTileSchema,
        url: developmentTilesUrl,
      }),
      icons: {
        mapping: {'major-transit': 'train'},
        source: './examples/tileflow-streets/icons',
      },
      theme: 'editorial', // 'standard' | 'light' | 'dark' | 'minimal' | project theme name.
      // The development terrain archive currently returns uncached tiles in the reviewed cities.
      // Keep it disabled until that archive is complete so navigation does not wait on failed DEM requests.
      terrain: 'none',
      modules: {
        // Optional keys: land, water, roads, transit, aeroways, buildings,
        // boundaries, labels, poi. Object order never controls layer order.
        land: land({
          background: {color: googlePalette.land, opacity: 1},
          landcover: {
            farmland: {fill: {color: googlePalette.farmland, opacity: 1}},
            grass: {fill: {color: googlePalette.greenspace, opacity: 1}},
            ice: {fill: {color: googlePalette.ice, opacity: 1}},
            park: {fill: {color: googlePalette.greenspace, opacity: 1}},
            protected: {fill: {color: googlePalette.protected, opacity: 1}},
            rock: {fill: {color: googlePalette.background, opacity: 1}},
            sand: {fill: {color: googlePalette.sand, opacity: 1}},
            scrub: {fill: {color: googlePalette.greenspace, opacity: 1}},
            wetland: {fill: {color: googlePalette.wetland, opacity: 1}},
            wood: {fill: {color: googlePalette.greenspaceDark, opacity: 1}},
          },
          landuse: {
            cemetery: {fill: {color: googlePalette.cemetery, opacity: 1}},
            civic: {fill: {color: googlePalette.land, opacity: 1}},
            commercial: {
              // Explicit OSM commercial/retail surfaces complement the
              // ranked activity corridors at overview zooms.
              fill: {color: googlePalette.businessCorridor, minZoom: 12, opacity: 1},
            },
            // Google treats university and school grounds as part of the
            // surrounding green fabric at overview zooms. Keep the tint light
            // enough that buildings and paths retain their hierarchy.
            education: {fill: {color: googlePalette.greenspaceLight, opacity: 1}},
            government: {fill: {color: googlePalette.land, opacity: 1}},
            industrial: {fill: {color: googlePalette.land, opacity: 1}},
            medical: {fill: {color: googlePalette.land, opacity: 1}},
            parking: {
              fill: {color: googlePalette.parking, minZoom: 15, opacity: 0.9},
              outline: {
                color: googlePalette.buildingOutline,
                minZoom: 16,
                opacity: 0.5,
                width: 0.5,
              },
            },
            railway: {fill: {color: googlePalette.background, opacity: 1}},
            residential: {fill: {color: googlePalette.land, opacity: 1}},
          },
        }),
        water: water({
          bodies: {fill: {color: googlePalette.water, opacity: 1}},
          intermittent: {
            bodies: {fill: {color: googlePalette.water, opacity: 0.78}},
            // Casa de Campo's named streams are mostly tagged intermittent.
            // A continuous, nearly opaque stroke keeps the real source geometry
            // legible over woodland without inventing a permanent water body.
            waterways: {
              color: googlePalette.waterway,
              dash: [1, 0],
              opacity: 0.9,
            },
          },
          waterways: {
            canal: {
              cap: 'round',
              color: googlePalette.waterway,
              join: 'round',
              minZoom: 8,
              opacity: 0.96,
              width: zoom.linear([
                [8, 0.35],
                [13, 1.05],
                [16, 2.2],
              ]),
            },
            other: {
              cap: 'round',
              color: googlePalette.waterway,
              join: 'round',
              minZoom: 12,
              opacity: 0.92,
              width: zoom.linear([
                [12, 0.35],
                [14, 0.8],
                [16, 1.4],
              ]),
            },
            river: {
              cap: 'round',
              color: googlePalette.waterway,
              join: 'round',
              minZoom: 6,
              opacity: 0.96,
              width: zoom.linear([
                [6, 0.45],
                [13, 1.25],
                [16, 3.2],
              ]),
            },
            stream: {
              cap: 'round',
              color: googlePalette.waterway,
              join: 'round',
              minZoom: 10,
              opacity: 0.94,
              width: zoom.linear([
                [10, 0.3],
                [12, 0.55],
                [13, 0.9],
                [14, 1.25],
                [16, 2],
              ]),
            },
          },
        }),
        roads: roads({
          detail: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          hierarchy: 'clear', // 'subtle' | 'clear' | 'strong'.
          outline: 'strong', // 'none' | 'subtle' | 'strong'.
          weight: 'regular', // 'thin' | 'regular' | 'bold'.
          oneWayMarkers: true, // true | false.
          extras: {
            paths: true, // true | false.
          },
          modifiers: {
            // Optional keys: construction, expressway, indoor, official, ramp, unpaved.
            // Treatments accept enabled, widthScale, surface, tunnel, and bridge;
            // phases accept color, opacity, dash, blur, gapWidth, offset, and width.
            construction: {
              surface: {
                casing: {
                  color: darkenColor(googlePalette.businessCorridor, roadBorderDarkening),
                  dash: [1.5, 1],
                  opacity: 0.9,
                },
                fill: {
                  color: googlePalette.businessCorridor,
                  dash: [1.5, 1],
                  opacity: 0.96,
                },
              },
            },
            expressway: {widthScale: expresswayWidthScale}, // Finite number > 0.
            indoor: {
              surface: {
                // Indoor/covered links remain continuous at street zooms. The
                // former round dash pattern rendered every link as a row of pills.
                casing: {dash: [1, 0], opacity: 1},
                fill: {dash: [1, 0], opacity: 1},
              },
            },
            ramp: {
              // Mapbox separates slip roads from the darker trunk carriageway.
              // Keep the geometry narrower, but use the normal street blue.
              widthScale: rampWidthScale,
              surface: {
                casing: {color: darkenColor(roadSurfaceColor, roadBorderDarkening)},
                fill: {color: roadSurfaceColor},
              },
            }, // Finite number > 0.
            unpaved: {
              surface: {
                // A continuous earth tone reads as a footpath without the
                // bead-like texture produced by short round dashes.
                casing: {
                  color: darkenColor(googlePalette.businessCorridorOutline, roadBorderDarkening),
                  dash: [1, 0],
                  opacity: 0.9,
                },
                fill: {
                  color: googlePalette.businessCorridorOutline,
                  dash: [1, 0],
                  opacity: 0.96,
                },
              },
            },
          },
          restrictions: {
            // Optional keys: access, bicycle, foot, horse, toll. A key styles explicit
            // restrictions for that mode without exposing OpenMapTiles field names.
            access: {
              // Private/service access is common inside the ministerial complex;
              // Mapbox keeps those links visually equal to the surrounding
              // service network at street zooms.
              widthScale: 1,
              surface: {
                casing: {
                  color: darkenColor(roadSurfaceColor, roadBorderDarkening),
                  dash: [1, 0],
                  opacity: 1,
                },
                fill: {color: roadSurfaceColor, dash: [1, 0], opacity: 1},
              },
            },
            toll: {
              surface: {casing: {opacity: 1}},
            },
          },
          // Optional exact keys: '0', '0+', '1', '1+', '2', '2+', '3', '3+', '4', '5', '6'.
          // Values use the same treatment shape as modifiers and restrictions.
          mountainBike: {
            '4': {surface: {fill: {dash: [2, 1], opacity: 0.72}}},
            '5': {surface: {fill: {dash: [1.5, 1], opacity: 0.62}}},
            '6': {surface: {fill: {dash: [1, 1], opacity: 0.52}}},
          },
          serviceTypes: {
            // Optional keys: alley, crossover, driveway, parkingAisle, yard.
            alley: {widthScale: serviceRoadWidthScales.alley},
            crossover: {widthScale: serviceRoadWidthScales.crossover},
            driveway: {widthScale: serviceRoadWidthScales.driveway},
            parkingAisle: {widthScale: serviceRoadWidthScales.parking_aisle},
            yard: {widthScale: serviceRoadWidthScales.yard},
          },
          areas: {
            road: {
              // The road source contains large polygonal complexes that overlap
              // parks and land use. Linear carriageways already provide the
              // intended street geometry, so keep those polygons transparent.
              fill: {visible: false},
              outline: {visible: false},
            },
            // Polygon pedestrian plazas; line-like pedestrian ways use classes.pedestrian.
            pedestrian: {
              // The source contains very broad pedestrian complexes around
              // Nuevos Ministerios. Leave their underlying land use visible;
              // the actual pedestrian ways are still rendered as lines.
              fill: {visible: false},
              outline: {visible: false},
            },
            pier: {
              // The transport extract also classifies broad station/platform
              // polygons as piers here; leave the park surface unobscured.
              fill: {visible: false},
              outline: {visible: false},
            },
          },
          classes: {
            // Optional semantic targets: motorway, trunk, primary, secondary,
            // tertiary, minor, service, track, pathway, footway, cycleway,
            // steps, pedestrian. Each accepts surface, tunnel, bridge, enabled;
            // a structure accepts shadow, casing, fill, and diagonal hatch.
            motorway: cityRoadStyle(
              googlePalette.roadMajor,
              [
                [3.2, 0.42],
                [4, 0.6],
                [5, 0.78],
                [6, 0.9],
                [8, 1.1],
                [10, 1.6],
                [12, 4.2],
                [14, 7],
                [16, 18],
                [17, 31],
                [19, 72],
                [20, 140],
                [21, 240],
                [22, 380],
              ],
              {
                casingColorStops: [
                  [3.2, darkenColor(googlePalette.roadMajor, 0.15)],
                  [13, darkenColor(googlePalette.roadMajor, 0.15)],
                  [14, googlePalette.roadMinor],
                  [15, googlePalette.roadCasing],
                  [16, roadCasingColor],
                  [22, roadCasingColor],
                ],
                casingDarkening: expresswayBorderDarkening,
                colorStops: [
                  [3.2, googlePalette.roadMajor],
                  [14, googlePalette.roadMajor],
                  [16, googlePalette.roadMajor],
                  [22, googlePalette.roadMajor],
                ],
                minZoom: 3.2,
                oneWayScale: 0.62,
                rankedLowZoom: true,
                opacityStops: [
                  [3.2, 0.35],
                  [3.8, 0.8],
                  [4.4, 1],
                ],
              },
            ),
            trunk: cityRoadStyle(
              googlePalette.roadTrunk,
              [
                [5.8, 0.35],
                [6.5, 0.65],
                [8, 1.05],
                [10, 1.45],
                [12, 3.8],
                [14, 6.3],
                [16, 16],
                [17, 34],
                [19, 58],
                [20, 120],
                [21, 205],
                [22, 330],
              ],
              {
                casingColorStops: [
                  [5.5, darkenColor(googlePalette.roadMajor, 0.1)],
                  [13.5, darkenColor(googlePalette.roadMajor, 0.1)],
                  [15, googlePalette.roadCasing],
                  [16, roadCasingColor],
                  [22, roadCasingColor],
                ],
                casingDarkening: expresswayBorderDarkening,
                colorStops: [
                  [5.5, googlePalette.roadMajor],
                  [14, googlePalette.roadTrunkOverview],
                  [16, googlePalette.roadTrunk],
                  [22, googlePalette.roadTrunk],
                ],
                minZoom: 5.8,
                oneWayScale: 0.58,
                opacityStops: [
                  [5.8, 0.1],
                  [6.5, 0.65],
                  [7.2, 1],
                ],
              },
            ),
            primary: cityRoadStyle(
              primaryRoadSurfaceColor,
              [
                [6, 0.25],
                [7, 0.4],
                [8, 0.6],
                [10, 1.05],
                [12, 2.1],
                [14, 4],
                [15, 7],
                [16, 11],
                [17, 24],
                [19, 52],
                [20, 105],
                [21, 180],
                [22, 285],
              ],
              {
                casingColorStops: [
                  [6, darkenColor(googlePalette.roadMajor, 0.06)],
                  [13.5, darkenColor(googlePalette.roadMajor, 0.06)],
                  [15, googlePalette.roadCasing],
                  [16, roadCasingColor],
                  [22, roadCasingColor],
                ],
                colorStops: [
                  [6, googlePalette.roadMajor],
                  [9, mixHexColors(googlePalette.roadMajor, googlePalette.road, 0.65)],
                  [11, primaryRoadSurfaceColor],
                  [14, primaryRoadSurfaceColor],
                  [16, primaryRoadSurfaceColor],
                  [22, primaryRoadSurfaceColor],
                ],
                minZoom: 6,
                oneWayScale: 0.62,
                opacityStops: [
                  [6, 0.08],
                  [7, 0.45],
                  [8, 1],
                ],
              },
            ),
            secondary: cityRoadStyle(
              secondaryRoadSurfaceColor,
              [
                [7.5, 0.18],
                [8.5, 0.3],
                [10, 0.7],
                [12, 1.35],
                [13, 2.35],
                [14, 3.2],
                [15, 5.2],
                [16, 8],
                [17, 18],
                [19, 40],
                [20, 85],
                [21, 150],
                [22, 240],
              ],
              {
                casingColorStops: [
                  [7.5, googlePalette.roadMajor],
                  [13.5, googlePalette.road],
                  [15, googlePalette.roadCasing],
                  [16, roadCasingColor],
                  [22, roadCasingColor],
                ],
                colorStops: [
                  [7.5, googlePalette.roadMinor],
                  [14, googlePalette.road],
                  [16, secondaryRoadSurfaceColor],
                  [22, secondaryRoadSurfaceColor],
                ],
                minZoom: 7.5,
                oneWayScale: 0.68,
                opacityStops: [
                  [7.5, 0.08],
                  [8.5, 0.55],
                  [9.5, 1],
                ],
              },
            ),
            tertiary: cityRoadStyle(
              tertiaryRoadSurfaceColor,
              [
                [9, 0.15],
                [10, 0.35],
                [12, 0.75],
                [13, 1.35],
                [14, 2.1],
                [15, 3.7],
                [16, 6],
                [17, 14],
                [19, 30],
                [20, 65],
                [21, 115],
                [22, 185],
              ],
              {
                casingColorStops: [
                  [9, googlePalette.road],
                  [14, googlePalette.road],
                  [15, googlePalette.roadCasing],
                  [16, roadCasingColor],
                  [22, roadCasingColor],
                ],
                colorStops: [
                  [9, googlePalette.roadMinor],
                  [14, googlePalette.roadMinor],
                  [16, tertiaryRoadSurfaceColor],
                  [22, tertiaryRoadSurfaceColor],
                ],
                minZoom: 9,
                oneWayScale: 0.72,
                opacityStops: [
                  [9, 0.08],
                  [10, 0.55],
                  [11, 1],
                ],
              },
            ),
            minor: cityRoadStyle(
              roadSurfaceColor,
              [
                [10.5, 0.16],
                [11.5, 0.3],
                [12, 0.8],
                [13, 1.2],
                [14, 1.8],
                [15, 2.8],
                [16, 5],
                [17, 10],
                [19, 23],
                [20, 52],
                [21, 90],
                [22, 145],
              ],
              {
                casingColorStops: [
                  [10.5, googlePalette.roadMinor],
                  [14, googlePalette.road],
                  [15, googlePalette.roadMinor],
                  [16, googlePalette.roadCasing],
                  [17, roadCasingColor],
                  [22, roadCasingColor],
                ],
                colorStops: [
                  [10.5, googlePalette.background],
                  [11.7, googlePalette.background],
                  [12, googlePalette.roadMinor],
                  [14, googlePalette.roadMinor],
                  [16, googlePalette.road],
                  [17, roadSurfaceColor],
                  [22, roadSurfaceColor],
                ],
                minZoom: 12,
                oneWayScale: 0.78,
                smallBridge: true,
                opacityStops: [
                  [11.5, 0],
                  [12, 0.5],
                  [12.6, 0.78],
                  [13.2, 1],
                ],
              },
            ),
            service: cityRoadStyle(
              roadSurfaceColor,
              [
                [13.5, 0.2],
                [14, 0.45],
                [15, 0.9],
                [16, 3.2],
                [17, 9],
                [19, 15],
                [20, 34],
                [21, 62],
                [22, 100],
              ],
              {
                casingColorStops: [
                  [13.5, googlePalette.roadMinor],
                  [15, googlePalette.roadMinor],
                  [16, googlePalette.roadCasing],
                  [17, roadCasingColor],
                  [22, roadCasingColor],
                ],
                clearance: false,
                colorStops: [
                  [13.5, googlePalette.background],
                  [15, googlePalette.roadMinor],
                  [17, googlePalette.road],
                  [18, roadSurfaceColor],
                  [22, roadSurfaceColor],
                ],
                minZoom: 16,
                smallBridge: true,
                tunnelVisible: false,
                opacityStops: [
                  [13.5, 0],
                  [14, 0.35],
                  [15, 1],
                ],
              },
            ),
            track: pathRoadStyle(
              parkPathSurfaceColor,
              [
                [13, 0.45],
                [14, 0.6],
                [15, 0.8],
                [16, 1.05],
                [17, 1.45],
                [18, 1.9],
                [19, 2.6],
                [20, 3.5],
                [21, 5],
                [22, 8],
              ],
              {minZoom: 16},
            ),
            pathway: pathRoadStyle(
              parkPathSurfaceColor,
              [
                [13, 0.45],
                [14, 0.6],
                [15, 0.8],
                [16, 1.05],
                [17, 1.45],
                [18, 1.9],
                [19, 2.6],
                [20, 3.5],
                [21, 5],
                [22, 8],
              ],
              {minZoom: 16},
            ),
            footway: pathRoadStyle(
              googlePalette.roadCasing,
              [
                [14, 0.45],
                [17, 1.4],
                [19, 2.3],
                [22, 5],
              ],
              {minZoom: 16},
            ),
            cycleway: pathRoadStyle(
              parkPathSurfaceColor,
              [
                [13, 0.45],
                [14, 0.6],
                [15, 0.8],
                [16, 1.05],
                [17, 1.45],
                [18, 1.9],
                [19, 2.6],
                [20, 3.5],
                [21, 5],
                [22, 8],
              ],
              {minZoom: 16},
            ),
            steps: pathRoadStyle(
              googlePalette.roadMinor,
              [
                [15, 0.55],
                [17, 1.6],
                [19, 2.8],
                [20, 6],
                [21, 12],
                [22, 18],
              ],
              {dash: [1, 0.75], minZoom: 16},
            ),
            pedestrian: pathRoadStyle(
              googlePalette.roadCasing,
              [
                [14, 0.7],
                [16, 2.2],
                [17, 4],
                [19, 10],
                [22, 30],
              ],
              {minZoom: 16},
            ),
          },
        }),
        transit: transit({
          rail: {
            surface: {
              color: googlePalette.rail,
              minZoom: 12,
              opacity: 0.56,
              width: zoom.linear([
                [12, 0.5],
                [16, 1.2],
                [18, 2],
              ]),
            },
            bridge: {
              color: googlePalette.rail,
              minZoom: 12,
              opacity: 0.56,
              width: zoom.linear([
                [12, 0.5],
                [16, 1.2],
                [18, 2],
              ]),
            },
            tunnel: {visible: false},
          },
          railHatching: {
            surface: {
              color: googlePalette.roadCasing,
              dash: [1, 2.5],
              minZoom: 13,
              opacity: 0.8,
              width: zoom.linear([
                [13, 0.3],
                [17, 0.8],
                [19, 1.2],
              ]),
            },
            bridge: {
              color: googlePalette.roadCasing,
              dash: [1, 2.5],
              minZoom: 13,
              opacity: 0.8,
              width: zoom.linear([
                [13, 0.3],
                [17, 0.8],
                [19, 1.2],
              ]),
            },
            tunnel: {visible: false},
          },
          serviceRail: {
            surface: {
              color: googlePalette.rail,
              minZoom: 14,
              opacity: 0.32,
              width: zoom.linear([
                [14, 0.4],
                [17, 1],
                [19, 1.6],
              ]),
            },
            bridge: {
              color: googlePalette.rail,
              minZoom: 14,
              opacity: 0.32,
              width: zoom.linear([
                [14, 0.4],
                [17, 1],
                [19, 1.6],
              ]),
            },
            tunnel: {visible: false},
          },
        }),
        buildings: buildings({
          mode: 'flat', // 'flat' | '3d'.
          businessCorridor: {
            // Activity selects real building/building-part footprints. z14 is
            // the first overview scale where those silhouettes read cleanly;
            // the source progressively preserves finer parts from z15 onward.
            fill: {
              color: googlePalette.businessCorridor,
              minZoom: 14,
              maxZoom: 16,
              opacity: 0.82,
            },
            outline: {visible: false},
          },
          flat: {
            fill: {color: expression<string>(buildingSemanticColor), minZoom: 15, opacity: 1},
            outline: {
              color: buildingOutlineColor,
              minZoom: 16,
              opacity: zoom.linear([
                [15, 0.42],
                [16, 0.62],
                [17, 0.74],
                [20, 0.84],
              ]),
              width: zoom.linear([
                [15, 0.4],
                [16, 0.55],
                [17, 0.7],
                [20, 0.9],
              ]),
            },
          },
        }),
        labels: labels({
          enabled: true,
          language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
          places: 'all', // 'none' | 'major' | 'all'.
          roads: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          shields: 'all', // 'none' | 'major' | 'all'.
          junctions: true, // true | false.
          water: 'all', // 'none' | 'major' | 'all'.
          styles: {
            places: {
              // Mapbox Streets v12 hierarchy: continents disappear first, then
              // countries and administrative regions hand over to settlements.
              continent: {
                minZoom: 0.75,
                maxZoom: 3,
                priority: 100,
                text: {
                  color: googlePalette.textStrong,
                  haloColor: googlePalette.halo,
                  haloWidth: 1.5,
                  letterSpacing: 0.05,
                  lineHeight: 1.1,
                  maxWidth: 6,
                  opacity: zoom.linear([
                    [0, 0.8],
                    [1.5, 0.5],
                    [2.5, 0],
                  ]),
                  size: zoom.linear([
                    [0, 10],
                    [2.5, 15],
                  ]),
                  transform: 'uppercase',
                  weight: 'medium',
                },
              },
              country: {
                minZoom: 1,
                maxZoom: 10,
                priority: 95,
                text: {
                  color: googlePalette.textStrong,
                  haloColor: googlePalette.halo,
                  haloWidth: 1.25,
                  lineHeight: 1.1,
                  maxWidth: 6,
                  padding: 3,
                  radialOffset: zoom.step([
                    [1, 1.35],
                    [7, 0],
                  ]),
                  size: zoom.linear([
                    [1, 10],
                    [4, 16],
                    [5, 18],
                    [9, 21],
                  ]),
                  variableAnchors: ['left', 'right', 'top', 'bottom'],
                  weight: 'bold',
                },
              },
              state: {
                minZoom: 6,
                maxZoom: 9,
                priority: 86,
                text: {
                  color: googlePalette.text,
                  haloColor: googlePalette.halo,
                  haloWidth: 1,
                  letterSpacing: 0.15,
                  maxWidth: 6,
                  opacity: 0.58,
                  size: zoom.linear([
                    [4, 9],
                    [9, 18],
                  ]),
                  transform: 'uppercase',
                  weight: 'medium',
                },
              },
              city: {
                minZoom: 2,
                maxZoom: 15,
                priority: expression<number>(['-', 100, ['coalesce', ['get', 'rank'], 20]]),
                text: {
                  color: googlePalette.textStrong,
                  haloColor: googlePalette.halo,
                  haloBlur: 1,
                  haloWidth: 1,
                  lineHeight: 1.1,
                  maxWidth: 7,
                  padding: 3,
                  radialOffset: zoom.step([
                    [2, 0.6],
                    [8, 0],
                  ]),
                  size: expression<number>([
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    3,
                    [
                      'case',
                      ['>', ['coalesce', ['get', 'capital'], 0], 0],
                      12,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 1],
                      11,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 2],
                      10,
                      9.5,
                    ],
                    5,
                    [
                      'case',
                      ['>', ['coalesce', ['get', 'capital'], 0], 0],
                      15,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 1],
                      13.5,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 2],
                      12,
                      11,
                    ],
                    8,
                    [
                      'case',
                      ['>', ['coalesce', ['get', 'capital'], 0], 0],
                      18,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 1],
                      16,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 2],
                      14,
                      12,
                    ],
                    15,
                    [
                      'case',
                      ['>', ['coalesce', ['get', 'capital'], 0], 0],
                      22,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 1],
                      20,
                      ['<=', ['coalesce', ['get', 'rank'], 99], 2],
                      18,
                      16,
                    ],
                  ]),
                  variableAnchors: [
                    'left',
                    'right',
                    'top',
                    'bottom',
                    'top-left',
                    'top-right',
                    'bottom-left',
                    'bottom-right',
                  ],
                  weight: 'medium',
                },
              },
              town: {
                minZoom: 7,
                maxZoom: 13,
                priority: expression<number>(['-', 80, ['coalesce', ['get', 'rank'], 20]]),
                text: {
                  color: googlePalette.textStrong,
                  haloColor: googlePalette.halo,
                  haloBlur: 1,
                  haloWidth: 1,
                  maxWidth: 7,
                  padding: 1,
                  size: zoom.linear([
                    [4, 10],
                    [8, 14],
                    [13, 20],
                  ]),
                },
              },
              village: {
                minZoom: 7,
                maxZoom: 14,
                priority: expression<number>(['-', 65, ['coalesce', ['get', 'rank'], 20]]),
                text: {
                  color: googlePalette.textStrong,
                  haloColor: googlePalette.halo,
                  haloBlur: 1,
                  haloWidth: 1,
                  maxWidth: 7,
                  size: zoom.linear([
                    [7, 10],
                    [12, 15],
                    [14, 18],
                  ]),
                },
              },
              neighborhood: {
                minZoom: 10,
                maxZoom: 15,
                priority: 55,
                text: {
                  color: googlePalette.text,
                  haloColor: googlePalette.halo,
                  haloBlur: 0.5,
                  haloWidth: 1,
                  letterSpacing: 0.12,
                  maxWidth: 7,
                  padding: 3,
                  size: zoom.linear([
                    [11, 11],
                    [15, 15],
                  ]),
                  transform: 'uppercase',
                },
              },
              other: {
                minZoom: 11,
                maxZoom: 15,
                priority: 40,
                text: {
                  color: googlePalette.text,
                  haloColor: googlePalette.halo,
                  haloBlur: 0.5,
                  haloWidth: 1,
                  size: zoom.linear([
                    [11, 10],
                    [15, 14],
                  ]),
                },
              },
            },
            junctions: {
              // Exit references are useful at street scale but overwhelm city overviews.
              minZoom: 16,
              placement: 'point',
              text: {
                color: googlePalette.text,
                font: 'Metropolis',
                haloColor: googlePalette.halo,
                haloWidth: 2,
                size: 10,
                weight: 'medium',
              },
            },
            roads: {
              motorway: {...roadLabelStyle(true), minZoom: 10},
              trunk: {...roadLabelStyle(true), minZoom: 10},
              primary: {...roadLabelStyle(true), minZoom: 10},
              secondary: {...roadLabelStyle(true), minZoom: 10},
              tertiary: {...roadLabelStyle(true), minZoom: 10},
              minor: {...roadLabelStyle(false), minZoom: 14},
              service: {...roadLabelStyle(false), minZoom: 16},
              track: {...roadLabelStyle(false), visible: false},
              pathway: {...roadLabelStyle(false), minZoom: 16},
              footway: {...roadLabelStyle(false), minZoom: 16},
              cycleway: {...roadLabelStyle(false), minZoom: 16},
              steps: {...roadLabelStyle(false), minZoom: 16},
              pedestrian: {...roadLabelStyle(false), minZoom: 12},
            },
            shields: {
              default: {
                minZoom: 6,
                placement: 'line',
                spacing: zoom.linear([
                  [11, 400],
                  [14, 600],
                ]),
                text: {
                  color: googlePalette.textStrong,
                  font: 'Metropolis',
                  haloColor: googlePalette.halo,
                  haloWidth: 1.25,
                  padding: 3,
                  size: 9,
                  weight: 'medium',
                },
              },
              // Optional `networks` record applies exact overrides by data-network value.
            },
            water: {
              ocean: {
                minZoom: 1,
                priority: 70,
                text: {
                  color: googlePalette.waterText,
                  haloColor: 'rgba(255, 255, 255, 0.5)',
                  haloWidth: 0.5,
                  letterSpacing: 0.2,
                  size: zoom.linear([
                    [1, 12],
                    [8, 18],
                  ]),
                },
              },
              other: {
                minZoom: 1,
                maxZoom: 15,
                priority: 60,
                text: {
                  color: googlePalette.waterText,
                  haloColor: 'rgba(255, 255, 255, 0.5)',
                  haloWidth: 0.5,
                  size: zoom.linear([
                    [5, 11],
                    [14, 16],
                  ]),
                },
              },
              line: {
                minZoom: 1,
                placement: 'line-center',
                priority: 65,
                text: {
                  color: googlePalette.waterText,
                  haloColor: 'rgba(255, 255, 255, 0.5)',
                  haloWidth: 0.5,
                  letterSpacing: 0.12,
                  maxAngle: 30,
                  size: zoom.linear([
                    [1, 12],
                    [8, 18],
                  ]),
                },
              },
              waterway: {
                minZoom: 13,
                placement: 'line',
                spacing: zoom.linear([
                  [15, 250],
                  [17, 400],
                ]),
                text: {
                  color: googlePalette.waterText,
                  haloColor: 'rgba(255, 255, 255, 0.5)',
                  maxAngle: 30,
                  size: zoom.linear([
                    [13, 12],
                    [18, 18],
                  ]),
                },
              },
            },
            aerodrome: {
              minZoom: 8,
              priority: 68,
              text: {
                color: googlePalette.transit,
                haloColor: googlePalette.halo,
                haloWidth: 1,
                letterSpacing: 0.01,
                lineHeight: 1.1,
                maxWidth: 9,
                size: zoom.linear([
                  [8, 12],
                  [14, 15],
                ]),
                weight: 'medium',
              },
            },
          },
        }),
        poi: poi({
          enabled: false,
          // Built-ins: food, coffee, culture, transit, shopping, lodging, health,
          // education, services; custom safe category IDs are also accepted.
          categories: [
            'food',
            'coffee',
            'culture',
            'major-transit',
            'parking',
            'shopping',
            'lodging',
            'health',
            'education',
            'services',
          ],
          classMapping: {
            // Avoid treating every tram and bus stop as a city-scale landmark.
            'major-transit': ['railway', 'station', 'subway'],
            parking: ['parking'],
            // Tileflow World preserves useful OpenMapTiles classes beyond the compact
            // built-in buckets. Keep them semantic here instead of exposing raw layers.
            culture: ['art_gallery', 'attraction', 'memorial', 'monument'],
            food: ['ice_cream'],
            services: ['atm', 'information', 'post'],
            shopping: ['clothing_store', 'grocery'],
          },
          color: 'category', // 'uniform' | 'category'.
          // Balanced keeps a broad candidate set; MapLibre collision placement makes
          // the final viewport-aware selection from the overscaled z14 source tile.
          density: 'balanced', // 'sparse' | 'balanced' | 'dense'.
          icons: 'full', // false | true | 'essential' | 'full'. Streets supplies the default sprite.
          labels: 'balanced', // 'none' | 'minimal' | 'balanced' | 'full'.
          minZoom: 12.5, // Number from 0 through 24.
          placement: {
            coupleIconAndLabel: false, // true | false.
            iconPadding: 3, // Finite number >= 0, in pixels.
            textPadding: 14, // Finite number >= 0, in pixels.
          },
          styles: {
            // Important orientation landmarks arrive first; everyday businesses wait
            // until street zooms. Rank filtering keeps dense centres readable.
            culture: {
              maxRank: 120, // Positive integer; replaces the category's preset rank ceiling.
              minZoom: 12.5,
              priority: 95,
              text: {
                color: googlePalette.poiCulture,
                haloColor: googlePalette.halo,
                haloWidth: 1.6,
                size: zoom.linear([
                  [12.5, 10],
                  [17, 12],
                ]),
                weight: 'medium',
              },
            },
            'major-transit': {
              maxRank: 40, // Positive integer.
              minZoom: 12.5,
              priority: 100,
              marker: {
                color: googlePalette.transit,
                radius: zoom.linear([
                  [12.5, 3],
                  [17, 5],
                ]),
                strokeColor: googlePalette.halo,
                strokeWidth: 1.5,
              },
              text: {
                color: googlePalette.transit,
                haloColor: googlePalette.halo,
                haloWidth: 1.7,
                size: zoom.linear([
                  [12.5, 10],
                  [17, 12.5],
                ]),
                weight: 'medium',
              },
            },
            parking: {
              maxRank: 500,
              minZoom: 16,
              priority: 90,
              icon: {visible: false},
              marker: {
                color: googlePalette.poiParking,
                radius: 9,
                strokeColor: googlePalette.halo,
                strokeWidth: 1.4,
              },
              text: {
                allowOverlap: true,
                color: googlePalette.halo,
                field: 'P',
                haloWidth: 0,
                ignorePlacement: true,
                padding: 0,
                size: 12,
                weight: 'medium',
              },
            },
            lodging: {
              maxRank: 100, // Positive integer.
              minZoom: 14,
              priority: 75,
              text: {
                color: googlePalette.poiLodging,
                haloColor: googlePalette.halo,
                haloWidth: 1.5,
              },
            },
            education: {
              maxRank: 100, // Positive integer.
              minZoom: 14.5,
              priority: 65,
              text: {
                color: googlePalette.poiEducation,
                haloColor: googlePalette.halo,
                haloWidth: 1.5,
              },
            },
            health: {
              maxRank: 120, // Positive integer.
              minZoom: 16,
              priority: 70,
              text: {
                color: googlePalette.poiHealth,
                haloColor: googlePalette.halo,
                haloWidth: 1.5,
              },
            },
            shopping: {
              maxRank: 70, // Positive integer.
              minZoom: 16,
              priority: 55,
              text: {
                color: googlePalette.poiShopping,
                haloColor: googlePalette.halo,
                haloWidth: 1.4,
              },
            },
            services: {
              maxRank: 100, // Positive integer.
              minZoom: 16,
              priority: 55,
              text: {
                color: googlePalette.poiServices,
                haloColor: googlePalette.halo,
                haloWidth: 1.4,
              },
            },
            food: {
              maxRank: 120, // Positive integer.
              minZoom: 16,
              priority: 50,
              text: {
                color: googlePalette.poiFood,
                haloColor: googlePalette.halo,
                haloWidth: 1.4,
              },
            },
            coffee: {
              maxRank: 180, // Positive integer.
              minZoom: 16,
              priority: 40,
              text: {
                color: googlePalette.poiCoffee,
                haloColor: googlePalette.halo,
                haloWidth: 1.4,
              },
            },
          },
        }),
      },
      overrides: [
        patchLayer('streets-business-corridor', {
          filter: [
            'all',
            ['>=', ['zoom'], ['to-number', ['coalesce', ['get', 'min_zoom'], 14], 14]],
            ['<=', ['to-number', ['coalesce', ['get', 'rank'], 99], 99], 1],
            ['>=', ['to-number', ['coalesce', ['get', 'activity_score'], 0], 0], 0.85],
          ],
        }),
        // Dense z15 footprints turn the translated passes into a black mesh.
        // Start the unchanged close-view shadow at z16, where it reads cleanly.
        addLayer(
          {
            id: 'streets-buildings-3d-shadow-soft',
            type: 'line',
            source: 'tileflow',
            'source-layer': 'building',
            minzoom: 16,
            filter: visibleBuilding3dFilter,
            layout: {visibility: 'none'},
            metadata: {'tileflow:3d-toggle': 'building'},
            paint: {
              'line-blur': 7,
              'line-color': building3dShadowColor,
              'line-opacity': 0.12,
              'line-translate': [3, 5],
              'line-translate-anchor': 'viewport',
              'line-width': 9,
            },
          },
          {before: 'streets-buildings-fill'},
        ),
        addLayer(
          {
            id: 'streets-buildings-3d-shadow-core',
            type: 'fill',
            source: 'tileflow',
            'source-layer': 'building',
            minzoom: 16,
            filter: visibleBuilding3dFilter,
            layout: {visibility: 'none'},
            metadata: {'tileflow:3d-toggle': 'building'},
            paint: {
              'fill-antialias': true,
              'fill-color': building3dShadowColor,
              'fill-opacity': 0.1,
              'fill-translate': [2, 4],
              'fill-translate-anchor': 'viewport',
            },
          },
          {before: 'streets-buildings-fill'},
        ),
        // Keep the original subtle real extrusion below the authored shadow.
        addLayer(
          {
            id: 'streets-buildings-3d',
            type: 'fill-extrusion',
            source: 'tileflow',
            'source-layer': 'building',
            minzoom: 15,
            filter: visibleBuilding3dFilter,
            layout: {visibility: 'none'},
            metadata: {'tileflow:3d-toggle': 'building'},
            paint: {
              'fill-extrusion-base': building3dBase,
              'fill-extrusion-color': building3dColor,
              'fill-extrusion-height': building3dHeight,
              'fill-extrusion-opacity': 1,
              'fill-extrusion-vertical-gradient': true,
            },
          },
          {after: 'streets-buildings-fill-outline'},
        ),
        patchLayer('streets-bathymetry', {
          layout: {'fill-sort-key': ['get', developmentTileSchema.fields.bathymetrySortKey]},
          paint: {
            'fill-antialias': false,
            'fill-color': [
              'match',
              ['get', developmentTileSchema.fields.bathymetryMinDepth],
              0,
              googlePalette.water,
              -200,
              mixHexColors(googlePalette.water, googlePalette.waterDeep, 0.2),
              -1000,
              mixHexColors(googlePalette.water, googlePalette.waterDeep, 0.4),
              -2000,
              mixHexColors(googlePalette.water, googlePalette.waterDeep, 0.6),
              -4000,
              mixHexColors(googlePalette.water, googlePalette.waterDeep, 0.8),
              -6000,
              googlePalette.waterDeep,
              googlePalette.water,
            ],
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              [
                'match',
                ['get', developmentTileSchema.fields.bathymetryMinDepth],
                [0, -200],
                0.84,
                0,
              ],
              3.5,
              [
                'match',
                ['get', developmentTileSchema.fields.bathymetryMinDepth],
                [0, -200],
                0.82,
                0,
              ],
              4.25,
              [
                'match',
                ['get', developmentTileSchema.fields.bathymetryMinDepth],
                [0, -200, -1000],
                0.84,
                0,
              ],
              4.75,
              [
                'match',
                ['get', developmentTileSchema.fields.bathymetryMinDepth],
                [0, -200, -1000, -2000],
                0.82,
                0,
              ],
              5.25,
              [
                'match',
                ['get', developmentTileSchema.fields.bathymetryMinDepth],
                [0, -200, -1000, -2000, -4000],
                0.8,
                0,
              ],
              5.75,
              0.78,
              7,
              0.76,
              9,
              0.56,
              10,
              0,
            ],
          },
        }),
        // Mapbox Streets uses small settlement dots while the map is still at
        // country scale. They disappear at z8, when the labels become centred.
        addLayer(
          {
            id: 'streets-label-place-settlement-marker',
            type: 'circle',
            source: 'tileflow',
            'source-layer': 'place',
            minzoom: 2,
            maxzoom: 8,
            filter: [
              'step',
              ['zoom'],
              [
                'all',
                ['has', 'name'],
                ['==', ['get', 'class'], 'city'],
                ['<=', ['coalesce', ['get', 'rank'], 99], 2],
              ],
              3,
              [
                'all',
                ['has', 'name'],
                ['==', ['get', 'class'], 'city'],
                ['<=', ['coalesce', ['get', 'rank'], 99], 3],
              ],
              4,
              [
                'all',
                ['has', 'name'],
                ['==', ['get', 'class'], 'city'],
                ['<=', ['coalesce', ['get', 'rank'], 99], 4],
              ],
              6,
              [
                'all',
                ['has', 'name'],
                ['==', ['get', 'class'], 'city'],
                ['<=', ['coalesce', ['get', 'rank'], 99], 5],
              ],
            ],
            paint: {
              'circle-color': googlePalette.textStrong,
              'circle-radius': ['step', ['coalesce', ['get', 'rank'], 99], 3, 3, 2.5, 7, 2],
              'circle-stroke-color': googlePalette.halo,
              'circle-stroke-width': 0.8,
            },
          },
          {before: 'streets-label-place-city'},
        ),
        patchLayer('streets-label-place-city', {
          filter: [
            'all',
            ['has', 'name'],
            ['==', ['get', 'class'], 'city'],
            [
              'step',
              ['zoom'],
              ['<=', ['coalesce', ['get', 'rank'], 99], 2],
              3,
              ['<=', ['coalesce', ['get', 'rank'], 99], 4],
              4,
              ['<=', ['coalesce', ['get', 'rank'], 99], 3],
              6,
              ['<=', ['coalesce', ['get', 'rank'], 99], 5],
              8,
              true,
            ],
          ],
          layout: {
            'text-font': [
              'case',
              ['>', ['coalesce', ['get', 'capital'], 0], 0],
              ['literal', ['Metropolis Bold']],
              ['<=', ['coalesce', ['get', 'rank'], 99], 1],
              ['literal', ['Metropolis Medium']],
              ['literal', ['Metropolis Regular']],
            ],
          },
        }),
        patchLayer('streets-label-place-town', {
          filter: [
            'all',
            ['has', 'name'],
            ['==', ['get', 'class'], 'town'],
            [
              'step',
              ['zoom'],
              ['<=', ['coalesce', ['get', 'rank'], 99], 7],
              6,
              ['<=', ['coalesce', ['get', 'rank'], 99], 10],
              8,
              ['<=', ['coalesce', ['get', 'rank'], 99], 15],
              10,
              true,
            ],
          ],
        }),
        patchLayer('streets-label-place-village', {
          filter: [
            'all',
            ['has', 'name'],
            ['==', ['get', 'class'], 'village'],
            [
              'step',
              ['zoom'],
              ['<=', ['coalesce', ['get', 'rank'], 99], 8],
              9,
              ['<=', ['coalesce', ['get', 'rank'], 99], 12],
              11,
              true,
            ],
          ],
        }),
        // The z13 source tile already carries the complete generalized path
        // family in Casa de Campo. Draw it as one lightweight overview pass
        // instead of activating every class/structure stack three zooms early.
        // At z16 the semantic road layers take over with their full casing,
        // bridge, tunnel, surface, and accessibility treatments.
        addLayer(
          {
            id: 'streets-park-path-overview',
            type: 'line',
            source: 'tileflow',
            'source-layer': 'transportation',
            minzoom: 13,
            maxzoom: 16,
            filter: [
              'all',
              ['==', ['geometry-type'], 'LineString'],
              [
                'any',
                ['match', ['get', 'class'], ['track', 'track_construction'], true, false],
                [
                  'all',
                  ['match', ['get', 'class'], ['path', 'path_construction'], true, false],
                  [
                    'match',
                    ['get', 'subclass'],
                    ['path', 'bridleway', 'corridor', 'cycleway', 'footway', 'pedestrian', 'steps'],
                    true,
                    false,
                  ],
                ],
              ],
            ],
            layout: {'line-cap': 'round', 'line-join': 'round'},
            paint: {
              'line-color': parkPathSurfaceColor,
              'line-dasharray': [1, 0],
              'line-opacity': 0.86,
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                0.45,
                14,
                0.6,
                15,
                0.8,
                16,
                1.05,
              ],
            },
          },
          {before: 'streets-road-surface-track-fill'},
        ),
        // Park paths are orientation geometry, not pale miniature streets. Keep
        // their source-specific access/surface modifiers from changing the
        // green hairline treatment used throughout parks such as El Retiro.
        // A zero-length gap keeps that treatment explicitly continuous.
        // Footways remain light and cased so sidewalks read separately.
        ...(['pathway', 'track', 'cycleway'] as const).flatMap((roadClass) => [
          patchLayer(`streets-road-surface-${roadClass}-fill`, {
            paint: {
              'line-color': parkPathSurfaceColor,
              'line-dasharray': [1, 0],
              'line-opacity': 0.86,
            },
          }),
          patchLayer(`streets-road-bridge-${roadClass}-fill`, {
            paint: {
              'line-color': googlePalette.roadTunnel,
              'line-dasharray': [1, 0],
              'line-opacity': 1,
            },
          }),
        ]),
        // OpenMapTiles classifies many of the Retiro's compacted-earth walks as
        // footways with surface=unpaved. They must still read as park geometry,
        // not as brown rural tracks: use the same green hairline and suppress
        // only their pale sidewalk casing. Paved footways remain white/cased.
        patchLayer('streets-road-surface-footway-fill', {
          paint: {
            'line-color': [
              'case',
              ['==', ['get', 'surface'], 'unpaved'],
              parkPathSurfaceColor,
              googlePalette.roadCasing,
            ],
            'line-dasharray': [1, 0],
            'line-opacity': ['case', ['==', ['get', 'surface'], 'unpaved'], 0.86, 1],
          },
        }),
        patchLayer('streets-road-surface-footway-casing', {
          paint: {
            'line-opacity': ['case', ['==', ['get', 'surface'], 'unpaved'], 0, 1],
          },
        }),
        patchLayer('streets-road-bridge-footway-fill', {
          paint: {
            'line-color': googlePalette.roadTunnel,
            'line-dasharray': [1, 0],
            'line-opacity': 1,
          },
        }),
        patchLayer('streets-road-bridge-footway-casing', {
          paint: {
            'line-color': googlePalette.roadTunnelBorder,
            'line-opacity': 1,
          },
        }),
        patchLayer('streets-road-oneway', {
          minzoom: 16,
          layout: {
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-image': 'oneway',
            'icon-keep-upright': false,
            'icon-padding': 0,
            'icon-pitch-alignment': 'map',
            'icon-rotate': ['case', ['==', ['get', 'oneway'], -1], 180, 0],
            'icon-rotation-alignment': 'map',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.38, 17, 0.55, 19, 0.7, 22, 1],
            'symbol-spacing': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15,
              95,
              17,
              115,
              19,
              150,
              22,
              220,
            ],
            'text-allow-overlap': true,
            'text-field': ['case', ['==', ['get', 'oneway'], -1], '←', '→'],
            'text-ignore-placement': true,
            'text-keep-upright': false,
            'text-padding': 0,
            'text-pitch-alignment': 'map',
            'text-rotation-alignment': 'map',
            'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 17, 17, 19, 20, 22, 24],
          },
          paint: {
            'icon-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 0.92, 16, 1],
            'text-opacity': 0,
          },
        }),
        addLayer(
          {
            id: 'streets-road-circular-casing',
            type: 'circle',
            source: 'tileflow',
            'source-layer': 'circular_feature',
            minzoom: 15,
            filter: ['==', ['get', 'circle_kind'], 'road_ring'],
            paint: {
              'circle-color': 'rgba(0, 0, 0, 0)',
              'circle-pitch-alignment': 'map',
              'circle-pitch-scale': 'map',
              'circle-radius': circularRoadRadius,
              'circle-stroke-color': roadCasingColor,
              'circle-stroke-width': circularRoadCasingWidth,
            },
          },
          {before: 'streets-road-oneway'},
        ),
        addLayer(
          {
            id: 'streets-road-circular-fill',
            type: 'circle',
            source: 'tileflow',
            'source-layer': 'circular_feature',
            minzoom: 15,
            filter: ['==', ['get', 'circle_kind'], 'road_ring'],
            paint: {
              'circle-color': 'rgba(0, 0, 0, 0)',
              'circle-pitch-alignment': 'map',
              'circle-pitch-scale': 'map',
              'circle-radius': circularRoadRadius,
              'circle-stroke-color': roadSurfaceColor,
              'circle-stroke-width': circularRoadWidth,
            },
          },
          {after: 'streets-road-circular-casing'},
        ),
        // V8.8 exposes only source-backed OSM pedestrian-area polygons. A pale
        // base plus a sparse sprite pattern distinguishes walkable pavement
        // without buffering road centerlines or implying complete coverage.
        addLayer(
          {
            id: 'streets-sidewalk-surface',
            type: 'fill',
            source: 'tileflow',
            'source-layer': 'sidewalk',
            minzoom: 17,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Polygon'],
              ['match', ['get', 'class'], ['sidewalk', 'pedestrian'], true, false],
            ],
            paint: {
              'fill-color': googlePalette.roadCasing,
              'fill-opacity': 0.96,
            },
          },
          {before: 'streets-aeroway-area'},
        ),
        addLayer(
          {
            id: 'streets-sidewalk-pattern',
            type: 'fill',
            source: 'tileflow',
            'source-layer': 'sidewalk',
            minzoom: 17,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Polygon'],
              ['match', ['get', 'class'], ['sidewalk', 'pedestrian'], true, false],
            ],
            paint: {
              'fill-opacity': 0.62,
              'fill-pattern': 'sidewalk-dot',
            },
          },
          {before: 'streets-aeroway-area'},
        ),
        // The development tileset exposes pedestrian crossings as
        // street-furniture points at z16. Render every available crossing
        // above the complete road stack; `markings` is not consistently
        // populated across road classes.
        addLayer(
          {
            id: 'streets-road-crossing',
            type: 'symbol',
            source: 'tileflow',
            'source-layer': 'street_furniture',
            minzoom: 16,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Point'],
              ['==', ['get', 'subclass'], 'crossing'],
            ],
            layout: {
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-image': 'crosswalk',
              'icon-padding': 0,
              'icon-pitch-alignment': 'map',
              // `direction` follows the carriageway. Turn the landscape sprite
              // a quarter turn so its long axis spans the full road width.
              'icon-rotate': ['+', ['to-number', ['get', 'direction'], 0], 90],
              'icon-rotation-alignment': 'map',
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0.22,
                16,
                0.3,
                17,
                0.5,
                18,
                0.75,
                19,
                1.05,
                20,
                2,
                21,
                3.5,
                22,
                5.5,
              ],
            },
            paint: {
              'icon-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.72, 15.5, 1],
            },
          },
          {after: 'streets-road-oneway'},
        ),
        addLayer(
          {
            id: 'streets-parking-symbol-disc',
            type: 'symbol',
            source: 'tileflow',
            'source-layer': 'landuse',
            minzoom: 16,
            filter: ['==', ['get', 'class'], 'parking'],
            layout: {
              'text-allow-overlap': true,
              'text-field': '●',
              'text-font': ['Metropolis Medium'],
              'text-ignore-placement': true,
              'text-size': 20,
            },
            paint: {
              'text-color': googlePalette.poiParking,
              'text-halo-color': googlePalette.halo,
              'text-halo-width': 1,
            },
          },
          {after: 'streets-label-aerodrome'},
        ),
        addLayer(
          {
            id: 'streets-parking-symbol-label',
            type: 'symbol',
            source: 'tileflow',
            'source-layer': 'landuse',
            minzoom: 16,
            filter: ['==', ['get', 'class'], 'parking'],
            layout: {
              'text-allow-overlap': true,
              'text-field': 'P',
              'text-font': ['Metropolis Medium'],
              'text-ignore-placement': true,
              'text-size': 10,
            },
            paint: {'text-color': googlePalette.halo},
          },
          {after: 'streets-parking-symbol-disc'},
        ),
      ],
      view: {
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14, // Number from 0 through 24; optional bearing is -180..180.
      },
    },
  },
  scenes: {
    'madrid-overview': {
      // Any portable scene ID: letters, numbers, underscores, or hyphens.
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        // Alternative: type 'bounds' with bounds [west, south, east, north].
        type: 'center', // 'center' | 'bounds'.
        center: [-3.7038, 40.4168], // [longitude -180..180, latitude -90..90].
        zoom: 11.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1440, // Integer from 64 through 4096 CSS pixels.
        height: 900, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-center': {
      map: 'editorial-city',
      camera: {
        type: 'center',
        center: [-3.7038, 40.4168],
        zoom: 14.25,
      },
      viewport: {
        width: 1440,
        height: 900,
        dpr: 1,
      },
    },
    'madrid-sol-close': {
      map: 'editorial-city',
      camera: {
        type: 'center',
        center: [-3.70379, 40.41695],
        zoom: 16.5,
      },
      viewport: {
        width: 1440,
        height: 900,
        dpr: 1,
      },
    },
    'madrid-neighborhood': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-close-street': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 17, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-motorway': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.6634, 40.4331], // [longitude -180..180, latitude -90..90].
        zoom: 13.25, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-airport': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.5695, 40.4983], // [longitude -180..180, latitude -90..90].
        zoom: 13, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-transit': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.6892, 40.4065], // [longitude -180..180, latitude -90..90].
        zoom: 15, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-tunnels': {
      map: 'editorial-city',
      camera: {
        type: 'center',
        // Puente del Rey / M-30 interchange, immediately west of the Royal Palace.
        center: [-3.72197, 40.41885],
        zoom: 16,
      },
      viewport: {
        width: 720,
        height: 1000,
        dpr: 1,
      },
    },
    'madrid-rural-edge': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.763, 40.617], // [longitude -180..180, latitude -90..90].
        zoom: 11.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'barcelona-waterfront': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [2.1894, 41.3786], // [longitude -180..180, latitude -90..90].
        zoom: 13.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-mobile': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 390, // Integer from 64 through 4096 CSS pixels.
        height: 844, // Integer from 64 through 4096 CSS pixels.
        dpr: 2, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
  },
});
