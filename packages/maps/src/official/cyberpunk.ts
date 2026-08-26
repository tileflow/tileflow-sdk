import {
  addresses,
  aeroways,
  buildings,
  defineMap,
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
  type TileflowThemeConfig,
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
import {cyberpunkFonts, cyberpunkIcons} from '../assets';
import {mapboxRailTransitStyle} from './mapbox-rail';
import {streets} from './streets';

const cyberpunkPalette = {
  background: '#060B18',
  boundary: '#E82098',
  building: '#11182B',
  buildingActive: '#1A2138',
  buildingOutline: '#45608C',
  cyan: '#147DFF',
  cyanSoft: '#6C8CCB',
  cyanMuted: '#33486F',
  acidGreen: '#2CF58A',
  green: '#168F96',
  halo: '#03050B',
  land: '#09142A',
  labelCulture: '#B69BFF',
  labelHalo: '#2A405F',
  labelMuted: '#B9CDEF',
  labelWater: '#8EBBFF',
  magenta: '#E82098',
  magentaSoft: '#F24CB6',
  neonCyan: '#43E4FF',
  neonMagenta: '#FF5CCF',
  orange: '#FF9F1C',
  park: '#0D2828',
  purple: '#7657FF',
  road: '#010208',
  roadBridge: '#0A2146',
  roadCasing: '#45608C',
  roadTunnel: '#06152E',
  text: '#EAF6FF',
  textMuted: '#93A7C4',
  water: '#071E31',
  waterDeep: '#01040C',
  yellow: '#F8EF42',
} as const;

const cyberpunkBuildingHeight2d = [
  'to-number',
  ['coalesce', ['get', semanticField('renderHeight')], 0],
  0,
];
const cyberpunkBuildingTone2d = ['coalesce', ['get', semanticField('buildingTone')], ''];
const cyberpunkImportanceTierField = semanticField('importanceTier');
const cyberpunkPublishedImportanceTier = [
  'to-number',
  ['coalesce', ['get', cyberpunkImportanceTierField], 0],
  0,
];
const cyberpunkBuildingIsDestination = ['==', cyberpunkBuildingTone2d, 'destination'];
const cyberpunkBuildingHasColorFamily = [
  'match',
  cyberpunkBuildingTone2d,
  ['active', 'commercial', 'destination'],
  true,
  false,
];
const cyberpunkBuildingPublishedTierWithProminence = [
  'let',
  't',
  cyberpunkPublishedImportanceTier,
  [
    'case',
    [
      'all',
      ['>=', ['var', 't'], 1],
      ['<=', ['var', 't'], 2],
      ['>=', cyberpunkBuildingHeight2d, ['match', ['var', 't'], 1, 24, 36]],
    ],
    ['+', ['var', 't'], 1],
    ['var', 't'],
  ],
];
const cyberpunkBuildingLegacyImportanceTier = [
  'case',
  cyberpunkBuildingIsDestination,
  ['step', cyberpunkBuildingHeight2d, 2, 36, 3],
  cyberpunkBuildingHasColorFamily,
  ['step', cyberpunkBuildingHeight2d, 1, 24, 2],
  ['>=', cyberpunkBuildingHeight2d, 36],
  1,
  0,
];
const cyberpunkBuildingImportanceTier = [
  'case',
  // Semantics establishes relevance. Physical prominence may add at most one
  // visual step, while an ordinary tall building is capped at a faint tier 1.
  ['has', cyberpunkImportanceTierField],
  cyberpunkBuildingPublishedTierWithProminence,
  cyberpunkBuildingLegacyImportanceTier,
];
const cyberpunkBuildingIsSelectedDestination = cyberpunkBuildingIsDestination;
const cyberpunkBuildingIsSignal = ['>=', cyberpunkBuildingImportanceTier, 3];
const cyberpunkBuildingIsActivityAccent = ['>=', cyberpunkBuildingImportanceTier, 2];
const cyberpunkBuildingGhostFill = [
  'case',
  cyberpunkBuildingIsSelectedDestination,
  [
    'step',
    cyberpunkBuildingImportanceTier,
    '#0C1528',
    1,
    '#201E14',
    2,
    '#302A12',
    3,
    '#433812',
    4,
    '#5A4B0E',
  ],
  [
    'step',
    cyberpunkBuildingImportanceTier,
    '#0C1528',
    1,
    '#29132A',
    2,
    '#351235',
    3,
    '#48123F',
    4,
    '#5B144D',
  ],
];
const cyberpunkBuildingGhostCore = [
  'case',
  cyberpunkBuildingIsSelectedDestination,
  [
    'step',
    cyberpunkBuildingImportanceTier,
    '#45608C',
    1,
    '#AAA13D',
    2,
    '#D6CA3D',
    3,
    '#F3E941',
    4,
    '#FFF27A',
  ],
  [
    'step',
    cyberpunkBuildingImportanceTier,
    '#45608C',
    1,
    '#B64996',
    2,
    '#D654B5',
    3,
    '#FF5CCF',
    4,
    '#FF86DD',
  ],
];
const cyberpunkBuildingGhostCoreOpacity = [
  'case',
  cyberpunkBuildingIsSelectedDestination,
  ['step', cyberpunkBuildingImportanceTier, 0.18, 1, 0.46, 2, 0.64, 3, 0.82, 4, 0.96],
  ['step', cyberpunkBuildingImportanceTier, 0.18, 1, 0.52, 2, 0.68, 3, 0.84, 4, 0.96],
];

const cyberpunkRoadClass = ['coalesce', ['get', semanticField('class')], ''];
const cyberpunkRoadImportanceTier = [
  'case',
  ['has', cyberpunkImportanceTierField],
  cyberpunkPublishedImportanceTier,
  [
    'match',
    cyberpunkRoadClass,
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

const cyberpunkPoiClass = ['coalesce', ['get', semanticField('class')], ''];
const cyberpunkPoiSubclass = ['coalesce', ['get', semanticField('subclass')], ''];
const cyberpunkPoiIsStadiumDestination = [
  'all',
  ['==', cyberpunkPoiClass, 'stadium'],
  [
    'match',
    cyberpunkPoiSubclass,
    [
      '',
      'arena',
      'baseball_stadium',
      'basketball_stadium',
      'football_stadium',
      'hockey_stadium',
      'indoor_arena',
      'multi_purpose_arena',
      'rugby_stadium',
      'soccer_stadium',
      'stadium',
      'stadium_arena',
      'sports_arena',
      'track_and_field_stadium',
    ],
    true,
    false,
  ],
];
const cyberpunkPoiIsHighValueDestination = [
  'any',
  [
    'match',
    cyberpunkPoiClass,
    [
      'art_gallery',
      'attraction',
      'castle',
      'monument',
      'museum',
      'square',
      'theme_park',
      'theatre',
      'town_hall',
    ],
    true,
    false,
  ],
  [
    'match',
    cyberpunkPoiSubclass,
    [
      'archaeological_site',
      'art_museum',
      'arts_centre',
      'artwork',
      'attraction',
      'castle',
      'central_government_office',
      'city_gate',
      'courthouse',
      'government',
      'history_museum',
      'ministry',
      'monument',
      'museum',
      'palace',
      'public_plaza',
      'square',
      'theme_park',
      'theatre',
      'town_hall',
      'townhall',
    ],
    true,
    false,
  ],
  cyberpunkPoiIsStadiumDestination,
];
const cyberpunkPoiIsArtwork = ['==', cyberpunkPoiSubclass, 'artwork'];
const cyberpunkPoiIsLandmarkDestination = [
  'any',
  [
    'match',
    cyberpunkPoiClass,
    ['castle', 'monument', 'museum', 'square', 'theme_park', 'theatre', 'town_hall'],
    true,
    false,
  ],
  [
    'match',
    cyberpunkPoiSubclass,
    [
      'amusement_park',
      'archaeological_site',
      'art_museum',
      'castle',
      'central_government_office',
      'city_gate',
      'courthouse',
      'government',
      'history_museum',
      'ministry',
      'monument',
      'museum',
      'palace',
      'public_plaza',
      'square',
      'theme_park',
      'theatre',
      'town_hall',
      'townhall',
    ],
    true,
    false,
  ],
  cyberpunkPoiIsStadiumDestination,
];
const cyberpunkPoiLegacyImportanceTier = [
  'case',
  cyberpunkPoiIsLandmarkDestination,
  3,
  ['all', cyberpunkPoiIsHighValueDestination, ['!', cyberpunkPoiIsArtwork]],
  2,
  cyberpunkPoiIsArtwork,
  1,
  0,
];
// Decorative artwork is useful context at close zooms, but should not compete with destinations
// in Cyberpunk's HUD even when the source publishes it as a general tier-2 POI.
const cyberpunkPoiImportanceTier = [
  'case',
  cyberpunkPoiIsArtwork,
  1,
  ['has', cyberpunkImportanceTierField],
  cyberpunkPublishedImportanceTier,
  cyberpunkPoiLegacyImportanceTier,
];
const cyberpunkHudPoiImportanceTier = cyberpunkPoiImportanceTier;
const cyberpunkPoiRank = ['to-number', ['coalesce', ['get', semanticField('rank')], 999], 999];
const cyberpunkPoiRankStops = [
  [15, 14],
  [17, 120],
  [18, 240],
  [19, 500],
  [20, 750],
  [21, 999],
] as const;
const cyberpunkPoiMaxRank = zoom.step(cyberpunkPoiRankStops);
const cyberpunkPoiMaxRankExpression = toMapLibreStyleValue(cyberpunkPoiMaxRank);
const cyberpunkTierOneMaxRankExpression = [
  'step',
  ['zoom'],
  0,
  18,
  14,
  19,
  40,
  20,
  120,
  21,
  320,
  22,
  999,
];
const cyberpunkPoiIsHudCandidate = [
  'case',
  ['>=', cyberpunkHudPoiImportanceTier, 4],
  true,
  ['==', cyberpunkHudPoiImportanceTier, 3],
  ['>=', ['zoom'], 15],
  ['==', cyberpunkHudPoiImportanceTier, 2],
  ['all', ['>=', ['zoom'], 16], ['<=', cyberpunkPoiRank, cyberpunkPoiMaxRankExpression]],
  ['==', cyberpunkHudPoiImportanceTier, 1],
  ['all', ['>=', ['zoom'], 18], ['<=', cyberpunkPoiRank, cyberpunkTierOneMaxRankExpression]],
  false,
];
const cyberpunkPoiPlacementPriority = [
  '+',
  ['*', ['-', 4, cyberpunkHudPoiImportanceTier], 1000],
  cyberpunkPoiRank,
];
const cyberpunkPoiImportanceColor = [
  'match',
  cyberpunkPoiImportanceTier,
  4,
  cyberpunkPalette.yellow,
  3,
  cyberpunkPalette.neonMagenta,
  2,
  cyberpunkPalette.magentaSoft,
  cyberpunkPalette.cyanSoft,
];
const cyberpunkPoiIsActive = ['boolean', ['feature-state', 'active'], false];

type WidthStops = readonly (readonly [number, number])[];

const roadBorderTotalWidth = 1;
const roadWidthInterpolationBase = 1.5;
const expresswayWidthScale = 1.06;
const tunnelBorderDash = [8, 5] as const;
const tunnelBorderWidth = 1;
const roadLineCap = 'butt' as const;
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

const streetsRoadWidths = {
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
const streetsParkPathWidthStops = [
  [12, 0],
  [15, 0.75],
  [16, 1],
  [18, 2],
  [22, 20],
] as const satisfies WidthStops;

const roadClearanceExtraAtZ15 = [
  'to-number',
  ['coalesce', ['get', semanticField('circularClearanceExtraAtZoom15')], 0],
  0,
];

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

function cyberpunkRoadStyle(
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
    color: cyberpunkPalette.road,
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
        color: cyberpunkPalette.roadBridge,
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
            color: cyberpunkPalette.roadTunnel,
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

function cyberpunkPathRoadStyle(
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
    color: options.casingColor ?? cyberpunkPalette.roadCasing,
    gapWidth: options.casingGapWidth ?? fill.width,
    join,
    opacity: 1,
    width: options.casingWidth ?? pathCasingStrokeWidth,
  };

  return {
    surface: {...(options.underlay ? {shadow: options.underlay} : {}), casing, fill},
    bridge: {...(options.underlay ? {shadow: options.underlay} : {}), casing, fill},
    tunnel: {
      ...(options.underlay ? {shadow: options.underlay} : {}),
      casing: {
        ...casing,
        color: cyberpunkPalette.roadCasing,
        dash: tunnelBorderDash,
        gapWidth: fill.width,
        opacity: 1,
        width: pathTunnelCasingWidth,
      },
      fill: {...fill, color: '#06152E', dash: [1, 0], opacity: 1},
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

const cyberpunkOverviewLandcoverColor = [
  'match',
  ['get', semanticField('class')],
  'barren',
  '#0A2143',
  'crop',
  '#0B2C4A',
  'grass',
  '#173A36',
  'shrub',
  '#163D38',
  'snow',
  '#1B447A',
  'trees',
  '#11352F',
  'urban',
  '#292D4B',
  'rgba(0, 0, 0, 0)',
] as const;

const cyberpunkRoadLabelIds = [
  'labels.roads.motorway',
  'labels.roads.trunk',
  'labels.roads.primary',
  'labels.roads.secondary',
  'labels.roads.tertiary',
  'labels.roads.minor',
  'labels.roads.service',
] as const;

const cyberpunkPrimaryPlaceLabelIds = ['labels.places.country', 'labels.places.city'] as const;

const cyberpunkSecondaryPlaceLabelIds = [
  'labels.places.other',
  'labels.places.neighborhood',
  'labels.places.village',
  'labels.places.town',
  'labels.places.state',
  'labels.places.continent',
] as const;

function cyberpunkLabelSignals() {
  return [
    ...cyberpunkRoadLabelIds.map((id) =>
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
    ...cyberpunkPrimaryPlaceLabelIds.map((id) =>
      patchModuleLayer('labels', id, {paint: {'text-halo-width': 1.4}}),
    ),
    ...cyberpunkSecondaryPlaceLabelIds.map((id) =>
      patchModuleLayer('labels', id, {
        paint: {
          'text-color': cyberpunkPalette.labelMuted,
          'text-halo-width': 1.1,
        },
      }),
    ),
    ...(['poi.transit.label', 'poi.culture.label'] as const).map((target) =>
      patchModuleLayer('poi', target, {paint: {'text-halo-width': 1.2}}),
    ),
  ];
}

function cyberpunkPathOverrides() {
  return contextualPathClasses.flatMap((roadClass) =>
    (['surface', 'bridge'] as const).flatMap((structure) => [
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.fill`, {
        paint: {
          'line-color': roadClass === 'steps' ? '#06152E' : cyberpunkPalette.road,
          ...(roadClass === 'steps' ? {'line-dasharray': [0.18, 0.15]} : {}),
          'line-width': contextualPathLineWidth,
        },
      }),
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.casing`, {
        paint: {
          'line-color': cyberpunkPalette.roadCasing,
          'line-gap-width': roadClass === 'steps' ? 0 : contextualPathLineWidth,
          'line-width': roadClass === 'steps' ? contextualPathLineWidth : contextualPathCasingWidth,
        },
      }),
    ]),
  );
}

function cyberpunkPrincipalRoadNeon() {
  const eligibleRoadFilter = [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['>=', cyberpunkRoadImportanceTier, 1],
  ];
  const unobstructedRoadFilter = [
    ...eligibleRoadFilter,
    ['!=', ['get', semanticField('ramp')], 1],
    ['!=', ['get', semanticField('brunnel')], 'tunnel'],
  ];
  const roadAuraFilter = [...unobstructedRoadFilter, ['>=', cyberpunkRoadImportanceTier, 3]];
  const roadGlowFilter = [...unobstructedRoadFilter, ['>=', cyberpunkRoadImportanceTier, 2]];
  const principalRoadColor = [
    'match',
    cyberpunkRoadClass,
    ['trunk', 'secondary'],
    cyberpunkPalette.neonMagenta,
    cyberpunkPalette.neonCyan,
  ];
  const roadWidthScale = ['match', cyberpunkRoadImportanceTier, 4, 1, 3, 0.9, 2, 0.72, 1, 0.48, 0];
  const roadCoreOpacity = [
    'match',
    cyberpunkRoadImportanceTier,
    4,
    0.94,
    3,
    0.82,
    2,
    0.62,
    1,
    0.32,
    0,
  ];
  const roadCoreStructureAttenuation = [
    'case',
    ['==', ['get', semanticField('brunnel')], 'tunnel'],
    0.32,
    ['==', ['get', semanticField('ramp')], 1],
    0.55,
    1,
  ];
  return [
    addModuleLayer(
      'roads',
      'roads.effects.principalNeon.aura',
      {
        id: 'cyberpunk-road-principal-neon-aura',
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
          'line-opacity': ['match', cyberpunkRoadImportanceTier, 4, 0.24, 3, 0.17, 0],
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
        id: 'cyberpunk-road-principal-neon-glow',
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
          'line-opacity': ['match', cyberpunkRoadImportanceTier, 4, 0.54, 3, 0.42, 2, 0.26, 0],
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
    addModuleLayer(
      'roads',
      'roads.effects.principalNeon.core',
      {
        id: 'cyberpunk-road-principal-neon-core',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('road'),
        minzoom: 3,
        filter: eligibleRoadFilter,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        metadata: {'tileflow:module': 'roads'},
        paint: {
          'line-blur': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3,
            0.2,
            8,
            0.35,
            10,
            0.5,
            12,
            0.75,
            18,
            0.35,
          ],
          'line-color': principalRoadColor,
          'line-opacity': ['*', roadCoreOpacity, roadCoreStructureAttenuation],
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            3,
            0,
            4,
            0.24,
            8,
            0.48,
            10,
            0.6,
            12,
            ['*', 0.7, roadWidthScale],
            15,
            ['*', 2, roadWidthScale],
            16,
            ['*', 3, roadWidthScale],
            18,
            ['*', 5, roadWidthScale],
            22,
            ['*', 15, roadWidthScale],
          ],
        },
      },
      {after: 'roads.effects.principalNeon.glow'},
    ),
  ];
}

function cyberpunkBuildingGhost() {
  const buildingFootprintFilter = ['==', ['geometry-type'], 'Polygon'];
  const buildingStrongFilter = ['all', buildingFootprintFilter, cyberpunkBuildingIsSignal];
  const buildingGlowFilter = ['all', buildingFootprintFilter, cyberpunkBuildingIsActivityAccent];
  return [
    addModuleLayer(
      'buildings',
      'buildings.effects.circuitFill',
      {
        id: 'cyberpunk-buildings-circuit-fill',
        type: 'fill',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 15,
        filter: buildingStrongFilter,
        metadata: {'tileflow:module': 'buildings'},
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.75,
            ['match', cyberpunkBuildingImportanceTier, 4, 0.28, 3, 0.16, 0],
          ],
          'fill-pattern': 'cyber-circuit',
        },
      },
      {after: 'buildings.flat.fill'},
    ),
    addModuleLayer(
      'buildings',
      'buildings.effects.ghostAura',
      {
        id: 'cyberpunk-buildings-ghost-aura',
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
            cyberpunkBuildingIsSelectedDestination,
            cyberpunkPalette.yellow,
            cyberpunkPalette.neonMagenta,
          ],
          'line-opacity': ['match', cyberpunkBuildingImportanceTier, 4, 0.22, 3, 0.13, 0],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 16, 4, 18, 6, 22, 10],
        },
      },
      {after: 'buildings.effects.circuitFill'},
    ),
    addModuleLayer(
      'buildings',
      'buildings.effects.ghostGlow',
      {
        id: 'cyberpunk-buildings-ghost-glow',
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
            cyberpunkBuildingIsSelectedDestination,
            cyberpunkPalette.yellow,
            cyberpunkPalette.neonMagenta,
          ],
          'line-gap-width': ['interpolate', ['linear'], ['zoom'], 15, 0.7, 16, 1.1, 18, 1.8, 22, 4],
          'line-opacity': [
            'case',
            cyberpunkBuildingIsSelectedDestination,
            ['match', cyberpunkBuildingImportanceTier, 4, 0.62, 3, 0.44, 2, 0.24, 0],
            ['match', cyberpunkBuildingImportanceTier, 4, 0.64, 3, 0.48, 2, 0.28, 0],
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
        id: 'cyberpunk-buildings-signal-trace',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('building'),
        minzoom: 15,
        filter: buildingStrongFilter,
        layout: {'line-cap': 'butt', 'line-join': 'round'},
        metadata: {'tileflow:module': 'buildings'},
        paint: {
          'line-blur': 0,
          'line-color': ['case', cyberpunkBuildingIsSelectedDestination, '#FFF7B2', '#FFF4FB'],
          'line-dasharray': [0.45, 1.25],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 15.5, -1, 18, -1.8, 22, -4],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.75,
            ['match', cyberpunkBuildingImportanceTier, 4, 0.62, 3, 0.4, 0],
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15.5, 0.55, 18, 0.9, 22, 1.8],
        },
      },
      {after: 'buildings.effects.ghostGlow'},
    ),
  ];
}

function cyberpunkDestinationBeacons() {
  const poiPointFilter = ['==', ['geometry-type'], 'Point'];
  const hudPoiFilter = ['all', poiPointFilter, cyberpunkPoiIsHudCandidate];
  const beaconScale = ['match', cyberpunkPoiImportanceTier, 4, 1.4, 3, 1.2, 2, 1, 1, 0.78, 0];
  return [
    addModuleLayer(
      'poi',
      'poi.effects.destination.scanRing',
      {
        id: 'cyberpunk-destination-scan-ring',
        type: 'circle',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 15,
        filter: hudPoiFilter,
        layout: {'circle-sort-key': ['-', 0, cyberpunkPoiPlacementPriority]},
        metadata: {'tileflow:module': 'poi'},
        paint: {
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 16, 8, 18, 14, 22, 24],
          'circle-stroke-color': [
            'case',
            cyberpunkPoiIsActive,
            cyberpunkPalette.acidGreen,
            [
              'match',
              cyberpunkHudPoiImportanceTier,
              4,
              cyberpunkPalette.yellow,
              3,
              cyberpunkPalette.neonMagenta,
              cyberpunkPalette.neonCyan,
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
              cyberpunkPoiIsActive,
              1,
              ['match', cyberpunkHudPoiImportanceTier, 4, 0.7, 3, 0.52, 0.28],
            ],
          ],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 1, 22, 1.6],
        },
      },
      {before: 'poi.transit.label'},
    ),
    addModuleLayer(
      'poi',
      'poi.effects.destination.beaconCore',
      {
        id: 'cyberpunk-destination-beacon-core',
        type: 'circle',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 14,
        filter: hudPoiFilter,
        layout: {'circle-sort-key': ['-', 0, cyberpunkPoiPlacementPriority]},
        metadata: {'tileflow:module': 'poi'},
        paint: {
          'circle-blur': ['match', cyberpunkPoiImportanceTier, 4, 0.14, 3, 0.1, 2, 0.06, 0],
          'circle-color': cyberpunkPoiImportanceColor,
          'circle-opacity': [
            'match',
            cyberpunkPoiImportanceTier,
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
          'circle-stroke-color': cyberpunkPalette.halo,
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
        id: 'cyberpunk-destination-target-brackets',
        type: 'symbol',
        source: 'tileflow',
        'source-layer': semanticLayer('poi'),
        minzoom: 15,
        filter: hudPoiFilter,
        metadata: {'tileflow:module': 'poi'},
        layout: {
          'icon-allow-overlap': false,
          'icon-image': 'cyber-target-brackets',
          'icon-ignore-placement': false,
          'icon-padding': 4,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.72, 16, 1, 18, 1.35, 22, 1.75],
          'symbol-sort-key': cyberpunkPoiPlacementPriority,
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
            ['match', cyberpunkHudPoiImportanceTier, 4, 0.9, 3, 0.74, 0.52],
          ],
          'text-color': [
            'case',
            cyberpunkPoiIsActive,
            cyberpunkPalette.acidGreen,
            [
              'match',
              cyberpunkHudPoiImportanceTier,
              4,
              cyberpunkPalette.yellow,
              3,
              cyberpunkPalette.neonMagenta,
              cyberpunkPalette.neonCyan,
            ],
          ],
          'text-halo-color': cyberpunkPalette.labelHalo,
          'text-halo-width': 1.2,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.82],
        },
      },
      {after: 'poi.culture.label'},
    ),
  ];
}

function cyberpunkPlanarSystems() {
  const polygonFilter = ['==', ['geometry-type'], 'Polygon'];
  const landuseClass = ['coalesce', ['get', semanticField('class')], ''];
  return [
    addModuleLayer(
      'water',
      'water.effects.shore.aura',
      {
        id: 'cyberpunk-water-shore-aura',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 6,
        filter: polygonFilter,
        metadata: {'tileflow:module': 'water'},
        paint: {
          'line-blur': 2,
          'line-color': cyberpunkPalette.neonCyan,
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
        id: 'cyberpunk-water-shore-core',
        type: 'line',
        source: 'tileflow',
        'source-layer': semanticLayer('water'),
        minzoom: 6,
        filter: polygonFilter,
        metadata: {'tileflow:module': 'water'},
        paint: {
          'line-blur': 0.15,
          'line-color': cyberpunkPalette.neonCyan,
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
        id: 'cyberpunk-landuse-business-grid',
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
          'fill-pattern': 'cyber-data-grid',
        },
      },
      {after: 'land.landuse.residential.fill'},
    ),
    addModuleLayer(
      'land',
      'land.effects.sectorTrace',
      {
        id: 'cyberpunk-landuse-sector-trace',
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
            '#E63BB0',
            ['hospital', 'medical'],
            '#FF4D87',
            ['education', 'school', 'university'],
            '#9D73FF',
            '#7657FF',
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
        id: 'cyberpunk-urban-park-circuit-trace',
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
          'line-color': '#28D7A5',
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
  cyberpunkPalette.magenta,
  ['motorway', 'primary'],
  cyberpunkPalette.cyan,
  cyberpunkPalette.roadCasing,
]);

export const cyberpunkTheme = {
  mode: 'dark',
  colors: {
    background: cyberpunkPalette.background,
    boundary: cyberpunkPalette.boundary,
    building: cyberpunkPalette.building,
    land: cyberpunkPalette.land,
    park: cyberpunkPalette.park,
    road: cyberpunkPalette.road,
    roadCasing: cyberpunkPalette.roadCasing,
    roadMajor: cyberpunkPalette.road,
    text: cyberpunkPalette.text,
    textHalo: cyberpunkPalette.labelHalo,
    textMuted: cyberpunkPalette.labelMuted,
    water: cyberpunkPalette.water,
  },
  modules: {
    boundaries: {
      admin: cyberpunkPalette.roadCasing,
      disputed: cyberpunkPalette.magenta,
      major: cyberpunkPalette.magenta,
      maritime: '#274A99',
    },
    buildings: {
      active: cyberpunkPalette.buildingActive,
      businessCorridor: '#071733',
      businessCorridorOutline: cyberpunkPalette.magenta,
      civic: '#071733',
      commercial: cyberpunkPalette.buildingActive,
      destination: '#071733',
      extrusion: '#071733',
      fill: cyberpunkPalette.building,
      generic: cyberpunkPalette.building,
      highRise: '#071733',
      highRiseOutline: cyberpunkPalette.purple,
      industrial: '#071733',
      lowRise: '#071733',
      lowRiseOutline: cyberpunkPalette.buildingOutline,
      outline: cyberpunkPalette.buildingOutline,
      residential: '#071733',
    },
    hydro: {
      ferry: cyberpunkPalette.roadCasing,
      label: cyberpunkPalette.cyanSoft,
      water: cyberpunkPalette.water,
      waterway: cyberpunkPalette.roadCasing,
    },
    labels: {
      country: cyberpunkPalette.text,
      halo: cyberpunkPalette.labelHalo,
      muted: cyberpunkPalette.labelMuted,
      neighborhood: cyberpunkPalette.labelMuted,
      poi: '#8EB8FF',
      primary: cyberpunkPalette.text,
      road: cyberpunkPalette.labelMuted,
      settlement: cyberpunkPalette.text,
      water: cyberpunkPalette.labelWater,
    },
    landcover: {
      farmland: '#071B43',
      flowerbed: '#10312E',
      grass: '#0F2527',
      ice: '#123469',
      meadow: '#102A2A',
      protected: '#102F2D',
      recreationGround: '#0D2928',
      rock: '#061737',
      sand: '#101C42',
      scrub: '#102826',
      urbanPark: cyberpunkPalette.park,
      villageGreen: '#10302D',
      wetland: '#082229',
      wood: '#0A2425',
    },
    landuse: {
      cemetery: '#081F47',
      civic: '#071A3F',
      commercial: '#091B43',
      education: '#0A1D48',
      government: '#0B1944',
      industrial: '#061634',
      medical: '#10183F',
      military: '#121638',
      parking: '#020A20',
      recreation: '#0D2928',
      residential: '#06183A',
    },
    poi: {
      coffee: cyberpunkPalette.yellow,
      culture: cyberpunkPalette.labelCulture,
      education: cyberpunkPalette.cyanSoft,
      food: '#FF8A3D',
      halo: cyberpunkPalette.labelHalo,
      health: '#FF4D6D',
      icon: cyberpunkPalette.cyan,
      label: cyberpunkPalette.text,
      lodging: cyberpunkPalette.magentaSoft,
      services: cyberpunkPalette.cyanSoft,
      shopping: cyberpunkPalette.green,
      transit: cyberpunkPalette.neonMagenta,
    },
    roads: {
      bridge: cyberpunkPalette.roadBridge,
      casing: cyberpunkPalette.roadCasing,
      ferry: cyberpunkPalette.cyanMuted,
      minor: cyberpunkPalette.road,
      motorway: cyberpunkPalette.road,
      path: '#06152E',
      primary: cyberpunkPalette.road,
      rail: cyberpunkPalette.orange,
      secondary: cyberpunkPalette.road,
      trunk: cyberpunkPalette.road,
      tunnel: cyberpunkPalette.roadTunnel,
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
} satisfies TileflowThemeConfig;

export const cyberpunk = defineMap({
  id: 'cyberpunk',
  version: 1,
  name: 'Cyberpunk',
  extends: streets,
  fonts: [cyberpunkFonts],
  icons: [...streets.icons, cyberpunkIcons],
  light: {
    anchor: 'viewport',
    color: '#FFE6F6',
    intensity: 0.22,
    position: [1.15, 210, 40],
  },
  modules: {
    addresses: addresses({enabled: false}),
    aeroways: aeroways({enabled: false}),
    buildings: buildings({
      businessCorridor: {
        fill: {visible: false},
        outline: {visible: false},
      },
      flat: {
        fill: {
          color: expression<string>(cyberpunkBuildingGhostFill),
          minZoom: 15,
          opacity: 0.56,
        },
        outline: {
          blur: 0,
          color: expression<string>(cyberpunkBuildingGhostCore),
          minZoom: 15,
          opacity: expression<number>(cyberpunkBuildingGhostCoreOpacity),
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
      background: {color: cyberpunkPalette.land},
      globalLandcover: {
        color: expression<string>(cyberpunkOverviewLandcoverColor),
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
        motorway: cyberpunkRoadStyle(cyberpunkPalette.cyan, streetsRoadWidths.motorway, {
          minZoom: 3,
          neon: true,
          rampWidths: mapboxMajorRampWidthStops,
        }),
        trunk: cyberpunkRoadStyle(cyberpunkPalette.magenta, streetsRoadWidths.trunk, {
          minZoom: 3,
          neon: true,
          rampWidths: mapboxMajorRampWidthStops,
        }),
        primary: cyberpunkRoadStyle(cyberpunkPalette.cyan, streetsRoadWidths.primary, {
          minZoom: 6,
          neon: true,
          rampWidths: mapboxArterialRampWidthStops,
        }),
        secondary: cyberpunkRoadStyle(cyberpunkPalette.magenta, streetsRoadWidths.secondary, {
          minZoom: 8,
          neon: true,
          rampWidths: mapboxArterialRampWidthStops,
        }),
        tertiary: cyberpunkRoadStyle(cyberpunkPalette.cyanSoft, streetsRoadWidths.tertiary, {
          edgeOpacity: 0.62,
          minZoom: 8,
          rampWidths: mapboxArterialRampWidthStops,
        }),
        minor: cyberpunkRoadStyle(cyberpunkPalette.cyan, streetsRoadWidths.minor, {
          edgeOpacity: 0.64,
          minZoom: 12,
        }),
        service: cyberpunkRoadStyle(cyberpunkPalette.cyanMuted, streetsRoadWidths.service, {
          casingMinZoom: 15,
          edgeOpacity: 0.44,
          minZoom: 14,
          tunnelVisible: false,
        }),
        track: cyberpunkRoadStyle(cyberpunkPalette.cyanMuted, streetsRoadWidths.track, {
          casingMinZoom: 15,
          edgeOpacity: 0.4,
          minZoom: 14,
        }),
        pathway: cyberpunkPathRoadStyle(cyberpunkPalette.road, streetsParkPathWidthStops, {
          casingColor: cyberpunkPalette.roadCasing,
          casingWidth: 0,
          minZoom: 12,
        }),
        footway: cyberpunkPathRoadStyle(cyberpunkPalette.road, streetsParkPathWidthStops, {
          casingColor: cyberpunkPalette.roadCasing,
          casingWidth: 0,
          minZoom: 12,
        }),
        cycleway: cyberpunkPathRoadStyle(cyberpunkPalette.cyan, mapboxPathWidthStops, {
          casingColor: cyberpunkPalette.roadCasing,
          casingGapWidth: roadWidth(mapboxPathWidthStops, 1, false, false),
          fillOpacity: zoom.linear([
            [15, 0],
            [16, 1],
          ]),
          minZoom: 15,
          underlay: {
            cap: pathLineCap,
            color: cyberpunkPalette.road,
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
        steps: cyberpunkPathRoadStyle(cyberpunkPalette.road, streetsParkPathWidthStops, {
          casingColor: cyberpunkPalette.roadCasing,
          casingMinZoom: 14,
          casingWidth: 0,
          dash: [0.18, 0.15],
          minZoom: 14,
          steps: true,
        }),
        pedestrian: cyberpunkPathRoadStyle(cyberpunkPalette.road, streetsParkPathWidthStops, {
          casingColor: cyberpunkPalette.roadCasing,
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
            casing: {color: cyberpunkPalette.roadCasing, dash: [1.5, 1], opacity: 0.82},
            fill: {color: cyberpunkPalette.road, dash: [1.5, 1], opacity: 0.96},
          },
        },
        expressway: {widthScale: expresswayWidthScale},
        indoor: {surface: {casing: {dash: [1, 0]}, fill: {dash: [1, 0]}}},
        ramp: {enabled: false},
        unpaved: {
          surface: {
            casing: {color: cyberpunkPalette.roadCasing, dash: [1, 0], opacity: 0.72},
            fill: {color: cyberpunkPalette.road, dash: [1, 0], opacity: 0.96},
          },
        },
      },
      oneWayMarkers: false,
      outline: 'strong',
      restrictions: {
        access: {
          widthScale: 1,
          surface: {
            casing: {color: cyberpunkPalette.roadCasing, dash: [1, 0], opacity: 0.62},
            fill: {color: cyberpunkPalette.road, dash: [1, 0], opacity: 1},
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
          strokeColor: cyberpunkPalette.road,
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
    transit: transit(mapboxRailTransitStyle(cyberpunkPalette.orange)),
    landforms: landforms({enabled: false}),
    poi: poi({
      categories: ['transit', 'culture'],
      color: 'category',
      density: 'sparse',
      enabled: true,
      icons: false,
      labels: 'minimal',
      maxRank: cyberpunkPoiMaxRank,
      minZoom: 15,
      placement: {
        coupleIconAndLabel: false,
        iconPadding: 4,
        textPadding: 4,
      },
      preset: 'minimal',
    }),
    vegetation: vegetation({enabled: false}),
    // Replace Streets' explicit light-water recipe so this map's dark hydro theme drives it.
    water: water(),
  },
  projection: 'mercator',
  ...defineModuleEffects([
    ...cyberpunkLabelSignals(),
    ...cyberpunkPathOverrides(),
    ...cyberpunkPrincipalRoadNeon(),
    ...cyberpunkBuildingGhost(),
    ...cyberpunkDestinationBeacons(),
    ...cyberpunkPlanarSystems(),
  ]),
  terrain: 'none',
  theme: cyberpunkTheme,
  view: {
    bearing: 0,
    center: [-3.69275, 40.40866],
    pitch: 0,
    zoom: 15,
  },
});
