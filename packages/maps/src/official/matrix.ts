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
  type TileflowLineCap,
  type TileflowLineJoin,
  type TileflowLineStyle,
  type TileflowRoadClassStyle,
  token,
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
  toMapLibreStyleValue,
} from '@tileflow/core/recipe';
import {matrixFonts, matrixIcons} from '../assets';
import {mapboxRailTransitStyle} from './mapbox-rail';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

const matrixPalette = {
  background: '#020D06',
  boundary: '#43DB60',
  building: '#05210E',
  buildingActive: '#082F15',
  buildingOutline: '#23933F',
  cyan: '#43DB60',
  cyanSoft: '#63F77B',
  cyanMuted: '#197234',
  acidGreen: '#43DB60',
  green: '#197234',
  halo: '#010704',
  land: '#05210E',
  labelCulture: '#B3FFC0',
  labelHalo: '#115827',
  labelMuted: '#B3FFC0',
  labelWater: '#87FF98',
  magenta: '#43DB60',
  magentaSoft: '#63F77B',
  neonCyan: '#63F77B',
  neonMagenta: '#63F77B',
  orange: '#43DB60',
  park: '#05210E',
  purple: '#63F77B',
  road: '#010704',
  roadBridge: '#082F15',
  roadCasing: '#23933F',
  roadTunnel: '#05210E',
  text: '#D9FFDE',
  textMuted: '#B3FFC0',
  water: '#05210E',
  waterDeep: '#010704',
  yellow: '#63F77B',
} as const;

function matrixColorForSemanticToken(name: string): string {
  const [group, role = ''] = name.split('.');
  switch (group) {
    case 'boundaries':
      return role === 'halo' ? matrixPalette.labelHalo : matrixPalette.boundary;
    case 'buildings':
      return role === 'outline' || role.endsWith('Outline')
        ? matrixPalette.buildingOutline
        : matrixPalette.building;
    case 'hydro':
      return role === 'label' || role === 'ferry' ? matrixPalette.cyanSoft : matrixPalette.water;
    case 'labels':
      if (role === 'halo' || role === 'waterHalo') return matrixPalette.labelHalo;
      if (role === 'muted' || role === 'neighborhood') return matrixPalette.labelMuted;
      if (role === 'water') return matrixPalette.labelWater;
      return matrixPalette.text;
    case 'landcover':
      return matrixPalette.park;
    case 'landuse':
      return role === 'recreation' || role === 'recreationOutline'
        ? matrixPalette.park
        : matrixPalette.land;
    case 'poi': {
      const accents: Readonly<Record<string, string>> = {
        'arts-entertainment': matrixPalette.labelCulture,
        'food-drink': matrixPalette.orange,
        halo: matrixPalette.labelHalo,
        landmark: matrixPalette.labelCulture,
        lodging: matrixPalette.magentaSoft,
        medical: matrixPalette.magentaSoft,
        'park-nature': matrixPalette.green,
        religion: matrixPalette.labelCulture,
        retail: matrixPalette.green,
        'sport-leisure': matrixPalette.green,
        transport: matrixPalette.neonMagenta,
      };
      return accents[role] ?? matrixPalette.cyanSoft;
    }
    case 'roads':
      if (name.includes('casing')) return matrixPalette.roadCasing;
      if (name.includes('tunnel')) return matrixPalette.roadTunnel;
      if (role === 'ferry') return matrixPalette.cyanMuted;
      if (role === 'rail' || role === 'railTransit') return matrixPalette.orange;
      if (role === 'cycleway' || role === 'parkPath') return matrixPalette.green;
      return matrixPalette.road;
    case 'surface':
      if (role === 'water') return matrixPalette.water;
      if (role === 'building') return matrixPalette.building;
      if (role === 'park') return matrixPalette.park;
      return matrixPalette.land;
    case 'transit':
      return matrixPalette.neonMagenta;
    case 'vegetation':
      return matrixPalette.park;
    default:
      throw new Error(`Matrix has no visual family for semantic token ${name}.`);
  }
}

const matrixSemanticColorRoles = {
  boundaries: ['admin', 'default', 'disputed', 'halo', 'major', 'maritime', 'regional'],
  buildings: [
    'active',
    'businessCorridor',
    'businessCorridorOutline',
    'civic',
    'commercial',
    'destination',
    'extrusion',
    'fill',
    'generic',
    'industrial',
    'outline',
    'residential',
    'shadow',
  ],
  hydro: [
    'depth.m0',
    'depth.m200',
    'depth.m2000',
    'depth.m7000',
    'ferry',
    'label',
    'water',
    'waterway',
  ],
  labels: [
    'country',
    'halo',
    'muted',
    'neighborhood',
    'overview',
    'poi',
    'primary',
    'road',
    'settlement',
    'strong',
    'water',
    'waterHalo',
  ],
  landcover: [
    'barren',
    'farmland',
    'flowerbed',
    'grass',
    'greenspace',
    'greenspaceDark',
    'ice',
    'meadow',
    'protected',
    'recreationGround',
    'rock',
    'sand',
    'scrub',
    'urbanPark',
    'villageGreen',
    'wetland',
    'wood',
  ],
  landuse: [
    'businessCorridor',
    'businessCorridorOutline',
    'cemetery',
    'civic',
    'commercial',
    'education',
    'government',
    'industrial',
    'medical',
    'parking',
    'parkingOutline',
    'railway',
    'recreation',
    'recreationOutline',
    'residential',
  ],
  poi: [
    'arts-entertainment',
    'education',
    'food-drink',
    'halo',
    'icon',
    'label',
    'landmark',
    'lodging',
    'medical',
    'park-nature',
    'public-services',
    'religion',
    'retail',
    'sport-leisure',
    'transport',
    'visitor-amenity',
  ],
  roads: [
    'bridge',
    'casing',
    'city.casing',
    'city.minor',
    'city.primary',
    'city.secondary',
    'city.tertiary',
    'city.tunnel',
    'city.tunnelCasing',
    'cycleway',
    'default',
    'default.casing',
    'default.tunnel',
    'ferry',
    'major',
    'minor',
    'motorway',
    'motorway.casing',
    'motorway.tunnel',
    'parkPath',
    'path',
    'path.casing',
    'path.transition',
    'path.tunnel',
    'primary',
    'rail',
    'railTransit',
    'secondary',
    'trunk',
    'trunk.casing',
    'trunk.tunnel',
    'tunnel',
  ],
  surface: ['background', 'building', 'land', 'park', 'water'],
  transit: ['primary'],
  vegetation: [
    'tree.bark',
    'tree.broadleaf.a',
    'tree.broadleaf.b',
    'tree.broadleaf.c',
    'tree.broadleaf.d',
    'tree.conifer.a',
    'tree.conifer.b',
    'tree.conifer.c',
  ],
} as const;

const matrixSemanticColors = Object.fromEntries(
  Object.entries(matrixSemanticColorRoles).flatMap(([group, roles]) =>
    roles.map((role) => {
      const name = `${group}.${role}`;
      return [name, matrixColorForSemanticToken(name)];
    }),
  ),
);

const matrixBuildingHeight2d = [
  'to-number',
  ['coalesce', ['get', semanticField('renderHeight')], 0],
  0,
];
const matrixBuildingTone2d = ['coalesce', ['get', semanticField('buildingTone')], ''];
const matrixImportanceTierField = semanticField('importanceTier');
const matrixPublishedImportanceTier = [
  'to-number',
  ['coalesce', ['get', matrixImportanceTierField], 0],
  0,
];
const matrixBuildingIsDestination = ['==', matrixBuildingTone2d, 'destination'];
const matrixBuildingHasColorFamily = [
  'match',
  matrixBuildingTone2d,
  ['active', 'commercial', 'destination'],
  true,
  false,
];
const matrixBuildingPublishedTierWithProminence = [
  'let',
  't',
  matrixPublishedImportanceTier,
  [
    'case',
    [
      'all',
      ['>=', ['var', 't'], 1],
      ['<=', ['var', 't'], 2],
      ['>=', matrixBuildingHeight2d, ['match', ['var', 't'], 1, 24, 36]],
    ],
    ['+', ['var', 't'], 1],
    ['var', 't'],
  ],
];
const matrixBuildingLegacyImportanceTier = [
  'case',
  matrixBuildingIsDestination,
  ['step', matrixBuildingHeight2d, 2, 36, 3],
  matrixBuildingHasColorFamily,
  ['step', matrixBuildingHeight2d, 1, 24, 2],
  ['>=', matrixBuildingHeight2d, 36],
  1,
  0,
];
const matrixBuildingImportanceTier = [
  'case',
  // Semantics establishes relevance. Physical prominence may add at most one
  // visual step, while an ordinary tall building is capped at a faint tier 1.
  ['has', matrixImportanceTierField],
  matrixBuildingPublishedTierWithProminence,
  matrixBuildingLegacyImportanceTier,
];
const matrixBuildingIsSelectedDestination = matrixBuildingIsDestination;
const matrixBuildingIsSignal = ['>=', matrixBuildingImportanceTier, 3];
const matrixBuildingIsActivityAccent = ['>=', matrixBuildingImportanceTier, 2];
const matrixBuildingGhostFill = [
  'case',
  matrixBuildingIsSelectedDestination,
  [
    'step',
    matrixBuildingImportanceTier,
    '#05210E',
    1,
    '#05210E',
    2,
    '#082F15',
    3,
    '#0C421D',
    4,
    '#0C421D',
  ],
  [
    'step',
    matrixBuildingImportanceTier,
    '#05210E',
    1,
    '#05210E',
    2,
    '#082F15',
    3,
    '#0C421D',
    4,
    '#115827',
  ],
];
const matrixBuildingGhostCore = [
  'case',
  matrixBuildingIsSelectedDestination,
  [
    'step',
    matrixBuildingImportanceTier,
    '#23933F',
    1,
    '#30B94E',
    2,
    '#43DB60',
    3,
    '#63F77B',
    4,
    '#87FF98',
  ],
  [
    'step',
    matrixBuildingImportanceTier,
    '#23933F',
    1,
    '#30B94E',
    2,
    '#43DB60',
    3,
    '#63F77B',
    4,
    '#87FF98',
  ],
];
const matrixBuildingGhostCoreOpacity = [
  'case',
  matrixBuildingIsSelectedDestination,
  ['step', matrixBuildingImportanceTier, 0.18, 1, 0.46, 2, 0.64, 3, 0.82, 4, 0.96],
  ['step', matrixBuildingImportanceTier, 0.18, 1, 0.52, 2, 0.68, 3, 0.84, 4, 0.96],
];

const matrixRoadClass = ['coalesce', ['get', semanticField('class')], ''];
const matrixRoadImportanceTier = [
  'case',
  ['has', matrixImportanceTierField],
  matrixPublishedImportanceTier,
  [
    'match',
    matrixRoadClass,
    ['motorway', 'trunk'],
    4,
    'primary',
    3,
    'secondary',
    2,
    'tertiary',
    1,
    0,
  ],
];

const matrixPoiCategory = ['coalesce', ['get', semanticField('poiCategory')], ''];
const matrixPoiFilterRank = ['to-number', ['get', semanticField('poiFilterRank')], 6];
const matrixPoiSizeRank = ['to-number', ['get', semanticField('poiSizeRank')], 17];
const matrixPoiImportanceTier = [
  'match',
  matrixPoiCategory,
  'landmark',
  4,
  'transport',
  3,
  ['arts-entertainment', 'park-nature', 'public-services', 'sport-leisure'],
  2,
  1,
];
const matrixHudPoiImportanceTier = matrixPoiImportanceTier;
const matrixPoiIsHudCandidate = [
  'all',
  ['has', semanticField('poiFilterRank')],
  ['>=', matrixPoiFilterRank, 0],
  ['<=', matrixPoiFilterRank, 2],
  ['has', semanticField('poiSizeRank')],
  ['>=', matrixPoiSizeRank, 0],
  ['<=', matrixPoiSizeRank, 16],
];
const matrixPoiPlacementPriority = ['+', ['*', matrixPoiFilterRank, 17], matrixPoiSizeRank];
const matrixPoiImportanceColor = [
  'match',
  matrixPoiImportanceTier,
  4,
  matrixPalette.yellow,
  3,
  matrixPalette.neonMagenta,
  2,
  matrixPalette.magentaSoft,
  matrixPalette.cyanSoft,
];
const matrixPoiIsActive = ['boolean', ['feature-state', 'active'], false];

type WidthStops = readonly (readonly [number, number])[];

const roadBorderTotalWidth = 1;
const roadWidthInterpolationBase = 1.5;
const expresswayWidthScale = 1.06;
const tunnelBorderDash = [8, 5] as const;
const tunnelBorderWidth = 1;
const roadClearanceExtraAtZ15 = [
  'to-number',
  ['coalesce', ['get', semanticField('circularClearanceExtraAtZoom15')], 0],
  0,
];
const roadNeedsStructuralButtCap = [
  'any',
  ['==', ['get', semanticField('brunnel')], 'tunnel'],
  ['==', ['get', semanticField('class')], 'steps'],
  ['==', ['get', semanticField('subclass')], 'steps'],
];
const roadNeedsControlledSurfaceButtCap = [
  'all',
  ['match', ['get', semanticField('brunnel')], ['tunnel', 'bridge'], false, true],
  ['==', ['get', semanticField('foot')], 'no'],
  [
    'match',
    ['get', semanticField('class')],
    [
      'motorway',
      'trunk',
      'primary',
      'motorway_construction',
      'trunk_construction',
      'primary_construction',
    ],
    true,
    false,
  ],
];
const roadLineCap = expression<TileflowLineCap>([
  'step',
  ['zoom'],
  ['case', roadNeedsStructuralButtCap, 'butt', 'round'],
  17,
  [
    'case',
    [
      'any',
      roadNeedsStructuralButtCap,
      roadNeedsControlledSurfaceButtCap,
      ['>', roadClearanceExtraAtZ15, 0],
    ],
    'butt',
    'round',
  ],
]);
const roadLineJoin = zoom.step<TileflowLineJoin>([
  [3, 'miter'],
  [14, 'round'],
]);
const pathLineCap = zoom.step<TileflowLineCap>([
  [12, 'butt'],
  [16, 'round'],
]);
const pathLineJoin = zoom.step<TileflowLineJoin>([
  [12, 'miter'],
  [16, 'round'],
]);
const pathCasingStrokeWidth = zoom.exponential(1.5, [
  [15, 0],
  [15.5, 0.5],
  [18, 1],
  [22, 2],
]);

const pathTunnelCasingWidth = zoom.linear([
  [15, 0],
  [15.5, tunnelBorderWidth],
  [22, tunnelBorderWidth],
]);

const matrixRoadWidths = {
  minor: [
    [3, 0],
    [12, 0.5],
    [18, 20],
    [22, 200],
  ],
  motorway: [
    [3, 0.8],
    [12, 3.2],
    [18, 30],
    [22, 300],
  ],
  primary: [
    [3, 0.8],
    [12, 3],
    [18, 28],
    [22, 280],
  ],
  secondary: [
    [3, 0],
    [12, 2.2],
    [18, 26],
    [22, 260],
  ],
  service: [
    [3, 0],
    [12, 0],
    [14, 0],
    [15, 2.2],
    [18, 10],
    [22, 100],
  ],
  tertiary: [
    [3, 0],
    [12, 2.2],
    [18, 26],
    [22, 260],
  ],
  track: [
    [3, 0],
    [12, 0],
    [14, 0],
    [15, 2.2],
    [18, 10],
    [22, 100],
  ],
  trunk: [
    [3, 0.8],
    [12, 3.2],
    [18, 30],
    [22, 300],
  ],
} as const satisfies Record<string, WidthStops>;

const mapboxMajorRampWidthStops = [
  [3, 0],
  [12, 0.8],
  [18, 20],
  [22, 200],
] as const satisfies WidthStops;
const mapboxArterialRampWidthStops = [
  [3, 0],
  [12, 0.4],
  [18, 18],
  [22, 180],
] as const satisfies WidthStops;
const mapboxPathWidthStops = [
  [12, 0],
  [18, 6],
  [22, 80],
] as const satisfies WidthStops;
const matrixParkPathWidthStops = [
  [12, 0],
  [15, 0.75],
  [16, 1],
  [18, 2],
  [22, 20],
] as const satisfies WidthStops;

function roadWidth(
  widths: WidthStops,
  oneWayScale: number,
  casing = false,
  clearance = true,
  rampWidths?: WidthStops,
) {
  const augmentedWidths = [...widths].sort(([left], [right]) => left - right);
  const widthOutput = (level: number, width: number) => {
    const ordinaryWidth =
      oneWayScale === 1
        ? width
        : ['match', ['get', semanticField('oneway')], [1, -1], width * oneWayScale, width];
    const rampWidth = rampWidths?.find(([rampLevel]) => rampLevel === level)?.[1];
    const surfaceWidth =
      rampWidth === undefined
        ? ordinaryWidth
        : ['case', ['==', ['get', semanticField('ramp')], 1], rampWidth, ordinaryWidth];
    if (!casing) return surfaceWidth;
    return typeof surfaceWidth === 'number'
      ? surfaceWidth + roadBorderTotalWidth
      : ['+', surfaceWidth, roadBorderTotalWidth];
  };
  const baseWidth = [
    'interpolate',
    ['exponential', roadWidthInterpolationBase],
    ['zoom'],
    ...augmentedWidths.flatMap(([level, width]) => [level, widthOutput(level, width)]),
  ];
  const clearanceWidth = clearance
    ? [
        '+',
        baseWidth,
        [
          'step',
          ['zoom'],
          0,
          17,
          [
            '*',
            roadClearanceExtraAtZ15,
            ['interpolate', ['exponential', 2], ['zoom'], 17, 4, 22, 128],
          ],
        ],
      ]
    : baseWidth;
  return expression<number>(clearanceWidth);
}

function roadCasingStrokeWidth() {
  return zoom.linear([
    [15, 0],
    [15.5, 0.5],
    [22, 0.5],
  ]);
}

const tunnelRoadCasingWidth = zoom.linear([
  [15, 0],
  [15.5, tunnelBorderWidth],
  [22, tunnelBorderWidth],
]);

function matrixRoadStyle(
  edgeColor: string,
  widths: WidthStops,
  options: {
    casingMinZoom?: number;
    edgeOpacity?: number;
    minZoom?: number;
    neon?: boolean;
    rampWidths?: WidthStops;
    tunnelVisible?: boolean;
  } = {},
): TileflowRoadClassStyle {
  const {
    casingMinZoom = 15,
    edgeOpacity = 1,
    minZoom,
    neon = false,
    rampWidths,
    tunnelVisible = true,
  } = options;
  const zoomRange = minZoom === undefined ? {} : {minZoom};
  const opacity = zoom.linear([
    [3, 0],
    [3.5, 1],
  ]);
  const fill = {
    ...zoomRange,
    cap: roadLineCap,
    color: matrixPalette.road,
    join: roadLineJoin,
    opacity,
    width: roadWidth(widths, 1, false, false, rampWidths),
  };
  const casing = {
    ...zoomRange,
    minZoom: Math.max(minZoom ?? 0, casingMinZoom),
    blur: neon ? 1.35 : 0,
    cap: roadLineCap,
    color: edgeColor,
    gapWidth: fill.width,
    join: roadLineJoin,
    opacity: edgeOpacity,
    width: roadCasingStrokeWidth(),
  };

  return {
    surface: {casing, fill},
    bridge: {
      casing,
      fill: {
        ...fill,
        color: matrixPalette.roadBridge,
      },
    },
    tunnel: tunnelVisible
      ? {
          casing: {
            ...casing,
            color: edgeColor,
            dash: tunnelBorderDash,
            gapWidth: fill.width,
            opacity: edgeOpacity,
            width: tunnelRoadCasingWidth,
          },
          fill: {
            ...fill,
            color: matrixPalette.roadTunnel,
            opacity: zoom.linear([
              [3, 0],
              [3.5, 0.8],
            ]),
          },
          hatch: {visible: false},
        }
      : {
          casing: {visible: false},
          fill: {visible: false},
          hatch: {visible: false},
          shadow: {visible: false},
        },
  };
}

function matrixPathRoadStyle(
  color: string,
  widths: WidthStops,
  options: {
    casingColor?: string;
    casingGapWidth?: TileflowLineStyle['gapWidth'];
    casingMinZoom?: number;
    casingWidth?: TileflowLineStyle['width'];
    dash?: TileflowLineStyle['dash'];
    fillOpacity?: TileflowLineStyle['opacity'];
    minZoom?: number;
    steps?: boolean;
    underlay?: TileflowLineStyle;
    width?: TileflowLineStyle['width'];
  } = {},
): TileflowRoadClassStyle {
  const zoomRange = options.minZoom === undefined ? {} : {minZoom: options.minZoom};
  const cap = options.steps ? ('butt' as const) : pathLineCap;
  const tunnelCap = 'butt' as const;
  const join = options.steps ? ('round' as const) : pathLineJoin;
  const fillWidth = options.width ?? roadWidth(widths, 1, false, false);
  const fill = {
    ...zoomRange,
    cap,
    color,
    ...(options.dash ? {dash: options.dash} : {}),
    join,
    opacity: options.fillOpacity ?? 1,
    width: fillWidth,
  };
  const casing = {
    ...zoomRange,
    minZoom: Math.max(options.minZoom ?? 0, options.casingMinZoom ?? 15),
    cap,
    color: options.casingColor ?? matrixPalette.roadCasing,
    gapWidth: options.casingGapWidth ?? fill.width,
    join,
    opacity: 1,
    width: options.casingWidth ?? pathCasingStrokeWidth,
  };

  return {
    surface: {...(options.underlay ? {shadow: options.underlay} : {}), casing, fill},
    bridge: {...(options.underlay ? {shadow: options.underlay} : {}), casing, fill},
    tunnel: {
      ...(options.underlay ? {shadow: {...options.underlay, cap: tunnelCap}} : {}),
      casing: {
        ...casing,
        cap: tunnelCap,
        color: matrixPalette.roadCasing,
        dash: tunnelBorderDash,
        gapWidth: fill.width,
        opacity: 1,
        width: pathTunnelCasingWidth,
      },
      fill: {...fill, cap: tunnelCap, color: '#05210E', dash: [1, 0], opacity: 1},
      hatch: {visible: false},
    },
  };
}

const unpavedPathCondition = ['==', ['get', semanticField('surface')], 'unpaved'] as const;
const contextualPathLineWidth = [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  12,
  ['case', unpavedPathCondition, 0, 0],
  15,
  ['case', unpavedPathCondition, 0.75, 1],
  16,
  ['case', unpavedPathCondition, 1, 1.5],
  17,
  ['case', unpavedPathCondition, 1.4, 3],
  18,
  ['case', unpavedPathCondition, 2, 6],
  19,
  ['case', unpavedPathCondition, 3.7, 12],
  20,
  ['case', unpavedPathCondition, 7.5, 22],
  22,
  ['case', unpavedPathCondition, 20, 60],
] as const;
const contextualPathCasingWidth = [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  15,
  ['case', unpavedPathCondition, 0, 0],
  15.5,
  ['case', unpavedPathCondition, 0, 0.5],
  18,
  ['case', unpavedPathCondition, 0, 1],
  22,
  ['case', unpavedPathCondition, 0, 2],
] as const;
const contextualPathClasses = ['pathway', 'footway', 'steps', 'pedestrian'] as const;

const matrixOverviewLandcoverColor = [
  'match',
  ['get', semanticField('class')],
  'barren',
  '#082F15',
  'crop',
  '#0C421D',
  'grass',
  '#082F15',
  'shrub',
  '#082F15',
  'snow',
  '#197234',
  'trees',
  '#082F15',
  'urban',
  '#115827',
  'rgba(0, 0, 0, 0)',
] as const;

const matrixRoadLabelIds = [
  'labels.roads.motorway',
  'labels.roads.trunk',
  'labels.roads.primary',
  'labels.roads.secondary',
  'labels.roads.tertiary',
  'labels.roads.minor',
  'labels.roads.service',
] as const;

const matrixPrimaryPlaceLabelIds = ['labels.places.country', 'labels.places.city'] as const;

const matrixSecondaryPlaceLabelIds = [
  'labels.places.other',
  'labels.places.neighborhood',
  'labels.places.village',
  'labels.places.town',
  'labels.places.state',
  'labels.places.continent',
] as const;

function matrixLabelSignals() {
  return [
    ...matrixRoadLabelIds.map((id) =>
      patchModuleLayer(
        'labels',
        id,
        {
          layout: {'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 13]},
          paint: {'text-halo-width': 1.6},
        },
        {requires: ['roads']},
      ),
    ),
    ...matrixPrimaryPlaceLabelIds.map((id) =>
      patchModuleLayer('labels', id, {paint: {'text-halo-width': 1.4}}),
    ),
    ...matrixSecondaryPlaceLabelIds.map((id) =>
      patchModuleLayer('labels', id, {
        paint: {
          'text-color': matrixPalette.labelMuted,
          'text-halo-width': 1.1,
        },
      }),
    ),
    ...(['poi.transport.label', 'poi.arts-entertainment.label'] as const).map((target) =>
      patchModuleLayer('poi', target, {paint: {'text-halo-width': 1.2}}),
    ),
  ];
}

function matrixPathOverrides() {
  return contextualPathClasses.flatMap((roadClass) =>
    (['surface', 'bridge'] as const).flatMap((structure) => [
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.fill`, {
        paint: {
          'line-color': roadClass === 'steps' ? '#05210E' : matrixPalette.road,
          ...(roadClass === 'steps' ? {'line-dasharray': [0.18, 0.15]} : {}),
          'line-width': contextualPathLineWidth,
        },
      }),
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.casing`, {
        paint: {
          'line-color': matrixPalette.roadCasing,
          'line-gap-width': roadClass === 'steps' ? 0 : contextualPathLineWidth,
          'line-width': roadClass === 'steps' ? contextualPathLineWidth : contextualPathCasingWidth,
        },
      }),
    ]),
  );
}

function matrixPrincipalRoadNeon() {
  const eligibleRoadFilter = [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['>=', matrixRoadImportanceTier, 1],
  ];
  const unobstructedRoadFilter = [
    ...eligibleRoadFilter,
    ['!=', ['get', semanticField('ramp')], 1],
    ['!=', ['get', semanticField('brunnel')], 'tunnel'],
  ];
  const roadAuraFilter = [...unobstructedRoadFilter, ['>=', matrixRoadImportanceTier, 3]];
  const roadGlowFilter = [...unobstructedRoadFilter, ['>=', matrixRoadImportanceTier, 2]];
  const principalRoadColor = [
    'match',
    matrixRoadClass,
    ['trunk', 'secondary'],
    matrixPalette.neonMagenta,
    matrixPalette.neonCyan,
  ];
  const roadWidthScale = ['match', matrixRoadImportanceTier, 4, 1, 3, 0.9, 2, 0.72, 1, 0.48, 0];
  return [
    addModuleLayer(
      'roads',
      'roads.effects.principalNeon.aura',
      {
        id: 'matrix-road-principal-neon-aura',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 8,
        filter: roadAuraFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'roads'},
        paint: {
          'line-blur': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            2,
            10,
            3.5,
            12,
            8,
            16,
            12,
            18,
            14,
            22,
            18,
          ],
          'line-color': principalRoadColor,
          'line-opacity': ['match', matrixRoadImportanceTier, 4, 0.24, 3, 0.17, 0],
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            8,
            0,
            10,
            0.35,
            11,
            0.9,
            12,
            ['*', 2.5, roadWidthScale],
            15,
            ['*', 7, roadWidthScale],
            16,
            ['*', 13.5, roadWidthScale],
            18,
            ['*', 24, roadWidthScale],
            22,
            ['*', 70, roadWidthScale],
          ],
        },
      },
      {after: 'roads.classes.motorway.surface.fill'},
    ),
    addModuleLayer(
      'roads',
      'roads.effects.principalNeon.glow',
      {
        id: 'matrix-road-principal-neon-glow',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 6,
        filter: roadGlowFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'roads'},
        paint: {
          'line-blur': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            0.8,
            8,
            1.5,
            10,
            2.5,
            12,
            4,
            16,
            5,
            18,
            6.5,
            22,
            9,
          ],
          'line-color': principalRoadColor,
          'line-opacity': ['match', matrixRoadImportanceTier, 4, 0.54, 3, 0.42, 2, 0.26, 0],
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            6,
            0,
            8,
            0.18,
            10,
            0.55,
            12,
            ['*', 1.3, roadWidthScale],
            15,
            ['*', 3.6, roadWidthScale],
            16,
            ['*', 7.2, roadWidthScale],
            18,
            ['*', 12, roadWidthScale],
            22,
            ['*', 34, roadWidthScale],
          ],
        },
      },
      {after: 'roads.effects.principalNeon.aura'},
    ),
  ];
}

function matrixBuildingGhost() {
  const buildingFootprintFilter = ['==', ['geometry-type'], 'Polygon'];
  const buildingStrongFilter = ['all', buildingFootprintFilter, matrixBuildingIsSignal];
  const buildingGlowFilter = ['all', buildingFootprintFilter, matrixBuildingIsActivityAccent];
  return [
    addModuleLayer(
      'buildings',
      'buildings.effects.ghostAura',
      {
        id: 'matrix-buildings-ghost-aura',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 15,
        filter: buildingStrongFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'buildings'},
        paint: {
          'line-blur': 0.8,
          'line-color': [
            'case',
            matrixBuildingIsSelectedDestination,
            matrixPalette.yellow,
            matrixPalette.neonMagenta,
          ],
          'line-opacity': ['match', matrixBuildingImportanceTier, 4, 0.22, 3, 0.13, 0],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 16, 4, 18, 6, 22, 10],
        },
      },
      {after: 'buildings.flat.fill'},
    ),
    addModuleLayer(
      'buildings',
      'buildings.effects.ghostGlow',
      {
        id: 'matrix-buildings-ghost-glow',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 15,
        filter: buildingGlowFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'buildings'},
        paint: {
          'line-blur': 0.05,
          'line-color': [
            'case',
            matrixBuildingIsSelectedDestination,
            matrixPalette.yellow,
            matrixPalette.neonMagenta,
          ],
          'line-gap-width': ['interpolate', ['linear'], ['zoom'], 15, 0.7, 16, 1.1, 18, 1.8, 22, 4],
          'line-opacity': [
            'case',
            matrixBuildingIsSelectedDestination,
            ['match', matrixBuildingImportanceTier, 4, 0.62, 3, 0.44, 2, 0.24, 0],
            ['match', matrixBuildingImportanceTier, 4, 0.64, 3, 0.48, 2, 0.28, 0],
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.35, 16, 0.5, 18, 0.8, 22, 1.6],
        },
      },
      {after: 'buildings.effects.ghostAura'},
    ),
    addModuleLayer(
      'buildings',
      'buildings.effects.signalTrace',
      {
        id: 'matrix-buildings-signal-trace',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 15,
        filter: buildingStrongFilter,
        layout: {'line-cap': 'butt', 'line-join': 'round'},
        metadata: {'tileflow:module': 'buildings'},
        paint: {
          'line-blur': 0,
          'line-color': ['case', matrixBuildingIsSelectedDestination, '#B3FFC0', '#D9FFDE'],
          'line-dasharray': [0.45, 1.25],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 15.5, -1, 18, -1.8, 22, -4],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.75,
            ['match', matrixBuildingImportanceTier, 4, 0.62, 3, 0.4, 0],
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15.5, 0.55, 18, 0.9, 22, 1.8],
        },
      },
      {after: 'buildings.effects.ghostGlow'},
    ),
  ];
}

function matrixDestinationBeacons() {
  const poiPointFilter = ['==', ['geometry-type'], 'Point'];
  const hudPoiFilter = ['all', poiPointFilter, matrixPoiIsHudCandidate];
  const beaconScale = ['match', matrixPoiImportanceTier, 4, 1.4, 3, 1.2, 2, 1, 1, 0.78, 0];
  return [
    addModuleLayer(
      'poi',
      'poi.effects.destination.scanRing',
      {
        id: 'matrix-destination-scan-ring',
        type: 'circle',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 15,
        filter: hudPoiFilter,
        layout: {'circle-sort-key': ['-', 0, matrixPoiPlacementPriority]},
        metadata: {'tileflow:module': 'poi'},
        paint: {
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 16, 8, 18, 14, 22, 24],
          'circle-stroke-color': [
            'case',
            matrixPoiIsActive,
            matrixPalette.acidGreen,
            [
              'match',
              matrixHudPoiImportanceTier,
              4,
              matrixPalette.yellow,
              3,
              matrixPalette.neonMagenta,
              matrixPalette.neonCyan,
            ],
          ],
          'circle-stroke-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            16,
            [
              'case',
              matrixPoiIsActive,
              1,
              ['match', matrixHudPoiImportanceTier, 4, 0.7, 3, 0.52, 0.28],
            ],
          ],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 1, 22, 1.6],
        },
      },
      {before: 'poi.transport.label'},
    ),
    addModuleLayer(
      'poi',
      'poi.effects.destination.beaconCore',
      {
        id: 'matrix-destination-beacon-core',
        type: 'circle',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 14,
        filter: hudPoiFilter,
        layout: {'circle-sort-key': ['-', 0, matrixPoiPlacementPriority]},
        metadata: {'tileflow:module': 'poi'},
        paint: {
          'circle-blur': ['match', matrixPoiImportanceTier, 4, 0.14, 3, 0.1, 2, 0.06, 0],
          'circle-color': matrixPoiImportanceColor,
          'circle-opacity': [
            'match',
            matrixPoiImportanceTier,
            4,
            0.96,
            3,
            0.9,
            2,
            0.74,
            1,
            0.46,
            0,
          ],
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            ['*', 1.25, beaconScale],
            16,
            ['*', 2.5, beaconScale],
            18,
            ['*', 4.5, beaconScale],
            22,
            ['*', 9, beaconScale],
          ],
          'circle-stroke-color': matrixPalette.halo,
          'circle-stroke-opacity': 0.9,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 1, 22, 2],
        },
      },
      {after: 'poi.effects.destination.scanRing'},
    ),
    addModuleLayer(
      'poi',
      'poi.effects.destination.brackets',
      {
        id: 'matrix-destination-poi-node',
        type: 'symbol',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 15,
        filter: hudPoiFilter,
        metadata: {'tileflow:module': 'poi'},
        layout: {
          'icon-allow-overlap': false,
          'icon-image': 'matrix-poi-node',
          'icon-ignore-placement': false,
          'icon-padding': 4,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.72, 16, 1, 18, 1.35, 22, 1.75],
          'symbol-sort-key': matrixPoiPlacementPriority,
          'text-allow-overlap': false,
          'text-anchor': 'top',
          'text-field': ['coalesce', ['get', semanticField('name')], ''],
          'text-font': ['Oxanium Medium'],
          'text-ignore-placement': false,
          'text-letter-spacing': 0.055,
          'text-offset': [0, 1.35],
          'text-optional': true,
          'text-padding': 4,
          'text-size': 10,
          'text-transform': 'uppercase',
        },
        paint: {
          'icon-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            16,
            ['match', matrixHudPoiImportanceTier, 4, 0.9, 3, 0.74, 0.52],
          ],
          'text-color': [
            'case',
            matrixPoiIsActive,
            matrixPalette.acidGreen,
            [
              'match',
              matrixHudPoiImportanceTier,
              4,
              matrixPalette.yellow,
              3,
              matrixPalette.neonMagenta,
              matrixPalette.neonCyan,
            ],
          ],
          'text-halo-color': matrixPalette.labelHalo,
          'text-halo-width': 1.2,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.82],
        },
      },
      {after: 'poi.arts-entertainment.label'},
    ),
  ];
}

function matrixPlanarSystems() {
  const polygonFilter = ['==', ['geometry-type'], 'Polygon'];
  const landuseClass = ['coalesce', ['get', semanticField('class')], ''];
  return [
    addModuleLayer(
      'water',
      'water.effects.shore.aura',
      {
        id: 'matrix-water-shore-aura',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 6,
        filter: polygonFilter,
        metadata: {'tileflow:module': 'water'},
        paint: {
          'line-blur': 2,
          'line-color': matrixPalette.neonCyan,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.16],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3, 18, 7],
        },
      },
      {after: 'water.bodies.fill'},
    ),
    addModuleLayer(
      'water',
      'water.effects.shore.core',
      {
        id: 'matrix-water-shore-core',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 6,
        filter: polygonFilter,
        metadata: {'tileflow:module': 'water'},
        paint: {
          'line-blur': 0.15,
          'line-color': matrixPalette.neonCyan,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.58],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 14, 0.7, 18, 1.5],
        },
      },
      {after: 'water.effects.shore.aura'},
    ),
    addModuleLayer(
      'land',
      'land.effects.businessGrid',
      {
        id: 'matrix-landuse-business-grid',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('landuse'),
        minzoom: 15,
        filter: ['all', polygonFilter, ['==', landuseClass, 'business_area']],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            16,
            0.08,
            18,
            0.12,
            22,
            0.16,
          ],
          'fill-pattern': 'matrix-data-grid',
        },
      },
      {after: 'land.landuse.residential.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.sectorTrace',
      {
        id: 'matrix-landuse-sector-trace',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('landuse'),
        minzoom: 11,
        filter: [
          'all',
          polygonFilter,
          [
            'match',
            landuseClass,
            [
              'business_area',
              'commercial',
              'retail',
              'industrial',
              'education',
              'school',
              'university',
              'hospital',
              'medical',
            ],
            true,
            false,
          ],
        ],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'line-blur': 0,
          'line-color': [
            'match',
            landuseClass,
            ['business_area', 'commercial', 'retail'],
            '#43DB60',
            ['hospital', 'medical'],
            '#63F77B',
            ['education', 'school', 'university'],
            '#87FF98',
            '#63F77B',
          ],
          'line-dasharray': [1.2, 1.8],
          'line-opacity': 0.34,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 16, 0.7, 20, 1.2],
        },
      },
      {after: 'land.effects.businessGrid'},
    ),
    addModuleLayer(
      'land',
      'land.effects.urbanParkTrace',
      {
        id: 'matrix-urban-park-circuit-trace',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('landcover'),
        minzoom: 11,
        filter: [
          'all',
          polygonFilter,
          ['==', ['get', semanticField('class')], 'grass'],
          ['match', ['get', semanticField('subclass')], ['park', 'garden'], true, false],
        ],
        metadata: {'tileflow:module': 'land'},
        paint: {
          'line-blur': 0.1,
          'line-color': '#30B94E',
          'line-dasharray': [2.5, 1.5],
          'line-opacity': 0.5,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 16, 0.9, 20, 1.5],
        },
      },
      {after: 'land.landcover.urbanPark.fill'},
    ),
  ];
}

const circularRoadRadiusAtZ15 = ['to-number', ['get', semanticField('circularRadiusAtZoom15')], 0];
const circularRoadRadiusMetres = ['to-number', ['get', semanticField('circularRadiusMeters')], 0];
const circularRoadOuterRadiusMetres = [
  'to-number',
  ['get', semanticField('circularOuterRadiusMeters')],
  0,
];
const circularRoadInnerRadiusMetres = [
  'to-number',
  ['get', semanticField('circularInnerRadiusMeters')],
  0,
];
const hasPhysicalCircularRadii = [
  'all',
  ['>', circularRoadRadiusMetres, 0],
  ['>', circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres],
  ['>=', circularRoadInnerRadiusMetres, 0],
];
const circularRoadBaseWidth = [
  'match',
  ['coalesce', ['get', semanticField('class')], 'minor'],
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

function circularRoadLegacyScale(level: number) {
  const interpolationBase = 1.35;
  const progress = (interpolationBase ** (level - 15) - 1) / (interpolationBase ** (22 - 15) - 1);
  return 1 + progress * 1.2;
}

function circularRoadWidthAtLevel(level: number) {
  const scale = circularRoadLegacyScale(level);
  return level === 15 ? circularRoadBaseWidth : ['*', circularRoadBaseWidth, scale];
}

function circularRoadInnerRadius(casing: boolean) {
  const stops: unknown[] = [];
  for (let level = 15; level <= 22; level += 1) {
    const centerlineRadius =
      level === 15 ? circularRoadRadiusAtZ15 : ['*', circularRoadRadiusAtZ15, 2 ** (level - 15)];
    const physicalInnerRadius = [
      '*',
      centerlineRadius,
      ['/', circularRoadInnerRadiusMetres, circularRoadRadiusMetres],
    ];
    const fallbackInnerRadius = ['-', centerlineRadius, ['/', circularRoadWidthAtLevel(level), 2]];
    const innerRadius = [
      'case',
      hasPhysicalCircularRadii,
      physicalInnerRadius,
      fallbackInnerRadius,
    ];
    stops.push(level, [
      'max',
      0,
      casing ? ['-', innerRadius, roadBorderTotalWidth / 2] : innerRadius,
    ]);
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

const circularRoadRadius = circularRoadInnerRadius(false);
const circularRoadCasingRadius = circularRoadInnerRadius(true);
const circularRoadWidth = circularRoadStrokeWidth(false);
const circularRoadCasingWidth = circularRoadStrokeWidth(true);
const roundaboutNeonColor = expression<string>([
  'match',
  ['coalesce', ['get', semanticField('class')], 'minor'],
  ['trunk', 'secondary'],
  matrixPalette.magenta,
  ['motorway', 'primary'],
  matrixPalette.cyan,
  matrixPalette.roadCasing,
]);

export const matrixTheme = defineOfficialTheme({
  id: 'matrix-dark',
  version: 1,
  colorScheme: 'dark',
  extraColors: matrixSemanticColors,
  fonts: {default: 'Oxanium Medium', places: 'Oxanium SemiBold'},
  colors: {
    background: matrixPalette.background,
    boundary: matrixPalette.boundary,
    building: matrixPalette.building,
    land: matrixPalette.land,
    park: matrixPalette.park,
    road: matrixPalette.road,
    roadCasing: matrixPalette.roadCasing,
    roadMajor: matrixPalette.road,
    text: matrixPalette.text,
    textHalo: matrixPalette.labelHalo,
    textMuted: matrixPalette.labelMuted,
    water: matrixPalette.water,
  },
  modules: {
    boundaries: {
      admin: matrixPalette.roadCasing,
      disputed: matrixPalette.magenta,
      major: matrixPalette.magenta,
      maritime: '#23933F',
    },
    buildings: {
      active: matrixPalette.buildingActive,
      businessCorridor: '#05210E',
      businessCorridorOutline: matrixPalette.magenta,
      civic: '#05210E',
      commercial: matrixPalette.buildingActive,
      destination: '#05210E',
      extrusion: '#05210E',
      fill: matrixPalette.building,
      generic: matrixPalette.building,
      highRise: '#05210E',
      highRiseOutline: matrixPalette.purple,
      industrial: '#05210E',
      lowRise: '#05210E',
      lowRiseOutline: matrixPalette.buildingOutline,
      outline: matrixPalette.buildingOutline,
      residential: '#05210E',
    },
    hydro: {
      ferry: matrixPalette.roadCasing,
      label: matrixPalette.cyanSoft,
      water: matrixPalette.water,
      waterway: matrixPalette.roadCasing,
    },
    labels: {
      country: matrixPalette.text,
      halo: matrixPalette.labelHalo,
      muted: matrixPalette.labelMuted,
      neighborhood: matrixPalette.labelMuted,
      poi: '#87FF98',
      primary: matrixPalette.text,
      road: matrixPalette.labelMuted,
      settlement: matrixPalette.text,
      water: matrixPalette.labelWater,
    },
    landcover: {
      farmland: '#082F15',
      flowerbed: '#082F15',
      grass: '#05210E',
      ice: '#115827',
      meadow: '#05210E',
      protected: '#05210E',
      recreationGround: '#05210E',
      rock: '#05210E',
      sand: '#082F15',
      scrub: '#05210E',
      urbanPark: matrixPalette.park,
      villageGreen: '#082F15',
      wetland: '#05210E',
      wood: '#05210E',
    },
    landuse: {
      cemetery: '#082F15',
      civic: '#082F15',
      commercial: '#082F15',
      education: '#082F15',
      government: '#082F15',
      industrial: '#05210E',
      medical: '#082F15',
      military: '#082F15',
      parking: '#031509',
      recreation: '#05210E',
      residential: '#082F15',
    },
    poi: {
      'arts-entertainment': matrixPalette.labelCulture,
      education: matrixPalette.cyanSoft,
      'food-drink': '#63F77B',
      halo: matrixPalette.labelHalo,
      icon: matrixPalette.cyan,
      label: matrixPalette.text,
      landmark: matrixPalette.labelCulture,
      lodging: matrixPalette.magentaSoft,
      medical: '#63F77B',
      'park-nature': matrixPalette.green,
      'public-services': matrixPalette.cyanSoft,
      religion: matrixPalette.labelCulture,
      retail: matrixPalette.green,
      'sport-leisure': matrixPalette.green,
      transport: matrixPalette.neonMagenta,
      'visitor-amenity': matrixPalette.cyanSoft,
    },
    roads: {
      bridge: matrixPalette.roadBridge,
      casing: matrixPalette.roadCasing,
      ferry: matrixPalette.cyanMuted,
      minor: matrixPalette.road,
      motorway: matrixPalette.road,
      path: '#05210E',
      primary: matrixPalette.road,
      rail: matrixPalette.orange,
      secondary: matrixPalette.road,
      trunk: matrixPalette.road,
      tunnel: matrixPalette.roadTunnel,
    },
  },
  typography: {
    font: 'Oxanium Medium',
    letterSpacing: 0.045,
    places: {font: 'Oxanium SemiBold', letterSpacing: 0.09},
    poi: {font: 'Oxanium Medium', letterSpacing: 0.055},
    roads: {font: 'Oxanium Medium', letterSpacing: 0.04},
    transform: 'uppercase',
    water: {font: 'Oxanium Medium', letterSpacing: 0.065},
  },
  lighting: {
    anchor: 'viewport',
    color: '#B3FFC0',
    intensity: 0.08,
    position: [1.15, 210, 40],
  },
});

export const matrix = bindOfficialMapTheme(
  defineRootMap({
    id: 'matrix',
    version: 1,
    name: 'Matrix',
    root: {compiler: 'streets', compilerVersion: 1},
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [matrixFonts],
    icons: [matrixIcons],
    themes: {dark: matrixTheme},
    defaultTheme: 'dark',
    modules: {
      addresses: addresses({enabled: false}),
      aeroways: aeroways({enabled: false}),
      boundaries: boundaries({
        admin2: {
          color: token.color('boundaries.admin'),
          dash: [10, 0],
          minZoom: 1,
          opacity: 1,
          width: zoom.linear([
            [3, 0.5],
            [12, 2],
          ]),
        },
        admin4: {
          color: token.color('boundaries.regional'),
          dash: [2, 0],
          minZoom: 2,
          opacity: zoom.linear([
            [2, 0],
            [3, 1],
          ]),
          width: zoom.linear([
            [3, 0.3],
            [12, 1.5],
          ]),
        },
        disputed: {
          color: token.color('boundaries.admin'),
          dash: expression<readonly number[]>([
            'step',
            ['zoom'],
            ['literal', [3, 2, 5]],
            7,
            ['literal', [2, 1.5]],
          ]),
          minZoom: 1,
          opacity: 1,
          width: zoom.linear([
            [3, 0.5],
            [12, 2],
          ]),
        },
        maritime: {visible: false},
      }),
      buildings: buildings({
        businessCorridor: {
          fill: {visible: false},
          outline: {visible: false},
        },
        flat: {
          fill: {
            color: expression<string>(matrixBuildingGhostFill),
            minZoom: 15,
            opacity: 0.56,
          },
          outline: {
            blur: 0,
            color: expression<string>(matrixBuildingGhostCore),
            minZoom: 15,
            opacity: expression<number>(matrixBuildingGhostCoreOpacity),
            width: zoom.linear([
              [15, 0.55],
              [16, 0.62],
              [18, 0.9],
              [22, 1.8],
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
        roadClasses: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'],
        roads: 'all',
        shields: 'none',
        water: 'major',
      }),
      land: land({
        background: {color: matrixPalette.land},
        globalLandcover: {
          color: expression<string>(matrixOverviewLandcoverColor),
          maxZoom: 9,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 0.9],
            [6, 0.75],
            [7, 0.45],
            [8, 0.15],
            [9, 0],
          ]),
        },
      }),
      roads: roads({
        areas: {
          pedestrian: {fill: {visible: false}, outline: {visible: false}},
          pier: {fill: {visible: false}, outline: {visible: false}},
          road: {fill: {visible: false}, outline: {visible: false}},
        },
        classes: {
          motorway: matrixRoadStyle(matrixPalette.cyan, matrixRoadWidths.motorway, {
            minZoom: 3,
            neon: true,
            rampWidths: mapboxMajorRampWidthStops,
          }),
          trunk: matrixRoadStyle(matrixPalette.magenta, matrixRoadWidths.trunk, {
            minZoom: 3,
            neon: true,
            rampWidths: mapboxMajorRampWidthStops,
          }),
          primary: matrixRoadStyle(matrixPalette.cyan, matrixRoadWidths.primary, {
            minZoom: 6,
            neon: true,
            rampWidths: mapboxArterialRampWidthStops,
          }),
          secondary: matrixRoadStyle(matrixPalette.magenta, matrixRoadWidths.secondary, {
            minZoom: 8,
            neon: true,
            rampWidths: mapboxArterialRampWidthStops,
          }),
          tertiary: matrixRoadStyle(matrixPalette.cyanSoft, matrixRoadWidths.tertiary, {
            edgeOpacity: 0.62,
            minZoom: 8,
            rampWidths: mapboxArterialRampWidthStops,
          }),
          minor: matrixRoadStyle(matrixPalette.cyan, matrixRoadWidths.minor, {
            edgeOpacity: 0.64,
            minZoom: 12,
          }),
          service: matrixRoadStyle(matrixPalette.cyanMuted, matrixRoadWidths.service, {
            casingMinZoom: 15,
            edgeOpacity: 0.44,
            minZoom: 14,
            tunnelVisible: false,
          }),
          track: matrixRoadStyle(matrixPalette.cyanMuted, matrixRoadWidths.track, {
            casingMinZoom: 15,
            edgeOpacity: 0.4,
            minZoom: 14,
          }),
          pathway: matrixPathRoadStyle(matrixPalette.road, matrixParkPathWidthStops, {
            casingColor: matrixPalette.roadCasing,
            casingWidth: 0,
            minZoom: 12,
          }),
          footway: matrixPathRoadStyle(matrixPalette.road, matrixParkPathWidthStops, {
            casingColor: matrixPalette.roadCasing,
            casingWidth: 0,
            minZoom: 12,
          }),
          cycleway: matrixPathRoadStyle(matrixPalette.cyan, mapboxPathWidthStops, {
            casingColor: matrixPalette.roadCasing,
            casingGapWidth: roadWidth(mapboxPathWidthStops, 1, false, false),
            fillOpacity: zoom.linear([
              [15, 0],
              [16, 1],
            ]),
            minZoom: 15,
            underlay: {
              cap: pathLineCap,
              color: matrixPalette.road,
              join: pathLineJoin,
              minZoom: 12,
              opacity: 1,
              width: roadWidth(mapboxPathWidthStops, 1, false, false),
            },
            width: zoom.linear([
              [12, 0],
              [18, 2],
              [22, 20],
            ]),
          }),
          steps: matrixPathRoadStyle(matrixPalette.road, matrixParkPathWidthStops, {
            casingColor: matrixPalette.roadCasing,
            casingMinZoom: 14,
            casingWidth: 0,
            dash: [0.18, 0.15],
            minZoom: 14,
            steps: true,
          }),
          pedestrian: matrixPathRoadStyle(matrixPalette.road, matrixParkPathWidthStops, {
            casingColor: matrixPalette.roadCasing,
            casingMinZoom: 14,
            casingWidth: 0,
            minZoom: 12,
          }),
        },
        detail: 'all',
        extras: {paths: true},
        hierarchy: 'clear',
        modifiers: {
          construction: {
            surface: {
              casing: {color: matrixPalette.roadCasing, dash: [1.5, 1], opacity: 0.82},
              fill: {color: matrixPalette.road, dash: [1.5, 1], opacity: 0.96},
            },
          },
          expressway: {widthScale: expresswayWidthScale},
          indoor: {surface: {casing: {dash: [1, 0]}, fill: {dash: [1, 0]}}},
          ramp: {enabled: false},
          unpaved: {
            surface: {
              casing: {color: matrixPalette.roadCasing, dash: [1, 0], opacity: 0.72},
              fill: {color: matrixPalette.road, dash: [1, 0], opacity: 0.96},
            },
          },
        },
        oneWayMarkers: false,
        outline: 'strong',
        restrictions: {
          access: {
            widthScale: 1,
            surface: {
              casing: {color: matrixPalette.roadCasing, dash: [1, 0], opacity: 0.62},
              fill: {color: matrixPalette.road, dash: [1, 0], opacity: 1},
            },
          },
          toll: {surface: {casing: {opacity: 1}}},
        },
        roundabouts: {
          casing: {
            color: 'rgba(0, 0, 0, 0)',
            minZoom: 15,
            pitchAlignment: 'map',
            pitchScale: 'map',
            radius: expression<number>(circularRoadCasingRadius),
            strokeColor: roundaboutNeonColor,
            strokeWidth: expression<number>(circularRoadCasingWidth),
          },
          fill: {
            color: 'rgba(0, 0, 0, 0)',
            minZoom: 15,
            pitchAlignment: 'map',
            pitchScale: 'map',
            radius: expression<number>(circularRoadRadius),
            strokeColor: matrixPalette.road,
            strokeWidth: expression<number>(circularRoadWidth),
          },
        },
        serviceTypes: {
          alley: {enabled: false},
          crossover: {enabled: false},
          driveway: {enabled: false},
          parkingAisle: {enabled: false},
          yard: {enabled: false},
        },
        sidewalks: {
          outline: {visible: false},
          pattern: {visible: false},
          surface: {visible: false},
        },
        weight: 'regular',
      }),
      transit: transit(mapboxRailTransitStyle(matrixPalette.orange)),
      landforms: landforms({enabled: false}),
      poi: poi({
        categories: ['transport', 'arts-entertainment'],
        color: 'category',
        density: 2,
        enabled: true,
        icons: false,
        labels: true,
        minZoom: 15,
        placement: {
          coupleIconAndLabel: false,
          iconPadding: 4,
          textPadding: 4,
        },
      }),
      vegetation: vegetation({enabled: false}),
      // Keep hydrography driven solely by Matrix's dark theme.
      water: water(),
    },
    projection: 'mercator',
    ...defineModuleEffects([
      addModuleLayer(
        'boundaries',
        'boundaries.admin2.background',
        {
          id: 'streets-boundary-admin2-background',
          type: 'line',
          source: 'tileflow',
          'source-layer': semanticLayer('boundary'),
          minzoom: 1,
          filter: [
            'all',
            ['==', ['to-number', ['get', semanticField('adminLevel')], 0], 2],
            ['!=', ['to-number', ['get', semanticField('maritime')], 0], 1],
          ],
          paint: {
            'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 0, 12, 2],
            'line-color': token.color('boundaries.halo'),
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4, 0.5],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 8],
          },
        },
        {before: 'boundaries.admin4'},
      ),
      ...matrixLabelSignals(),
      ...matrixPathOverrides(),
      ...matrixPrincipalRoadNeon(),
      ...matrixBuildingGhost(),
      ...matrixDestinationBeacons(),
      ...matrixPlanarSystems(),
      addModuleLayer(
        'labels',
        'labels.effects.crtMask',
        {
          id: 'matrix-crt-mask',
          type: 'background',
          metadata: {'tileflow:module': 'labels'},
          paint: {
            'background-opacity': 0.84,
            'background-pattern': 'matrix-crt-scanlines',
          },
        },
        {before: 'labels.roads.motorway'},
        {requires: ['roads']},
      ),
    ]),
    terrain: 'none',
    view: {
      bearing: 0,
      center: [-3.6942, 40.4146],
      pitch: 0,
      zoom: 15.25,
    },
  }),
);
