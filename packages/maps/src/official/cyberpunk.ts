import {
  boundaries,
  buildings,
  defineMap,
  disable,
  expr,
  field,
  labels,
  land,
  poi,
  refineRenderTarget,
  renderPass,
  roads,
  type TileflowDataExpressionInput,
  type TileflowLineCap,
  type TileflowLineJoin,
  type TileflowLineStyle,
  type TileflowNamedRenderStack,
  type TileflowRenderSelector,
  type TileflowRoadClassStyle,
  token,
  transit,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {cyberpunkFonts, cyberpunkIcons} from '../assets';
import {mapboxRailTransitStyle} from './mapbox-rail';
import {bindOfficialMapTheme, defineOfficialTheme} from './theme-helpers';

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

function cyberpunkColorForSemanticToken(name: string): string {
  const [group, role = ''] = name.split('.');
  switch (group) {
    case 'boundaries':
      return role === 'halo' ? cyberpunkPalette.labelHalo : cyberpunkPalette.boundary;
    case 'buildings':
      return role === 'outline' || role.endsWith('Outline')
        ? cyberpunkPalette.buildingOutline
        : cyberpunkPalette.building;
    case 'hydro':
      return role === 'label' || role === 'ferry'
        ? cyberpunkPalette.cyanSoft
        : cyberpunkPalette.water;
    case 'labels':
      if (role === 'halo' || role === 'waterHalo') return cyberpunkPalette.labelHalo;
      if (role === 'muted' || role === 'neighborhood') return cyberpunkPalette.labelMuted;
      if (role === 'water') return cyberpunkPalette.labelWater;
      return cyberpunkPalette.text;
    case 'landcover':
      return cyberpunkPalette.park;
    case 'landuse':
      return role === 'recreation' || role === 'recreationOutline'
        ? cyberpunkPalette.park
        : cyberpunkPalette.land;
    case 'poi': {
      const accents: Readonly<Record<string, string>> = {
        'arts-entertainment': cyberpunkPalette.labelCulture,
        'food-drink': cyberpunkPalette.orange,
        halo: cyberpunkPalette.labelHalo,
        landmark: cyberpunkPalette.labelCulture,
        lodging: cyberpunkPalette.magentaSoft,
        medical: cyberpunkPalette.magentaSoft,
        'park-nature': cyberpunkPalette.green,
        religion: cyberpunkPalette.labelCulture,
        retail: cyberpunkPalette.green,
        'sport-leisure': cyberpunkPalette.green,
        transport: cyberpunkPalette.neonMagenta,
      };
      return accents[role] ?? cyberpunkPalette.cyanSoft;
    }
    case 'roads':
      if (name.includes('casing')) return cyberpunkPalette.roadCasing;
      if (name.includes('tunnel')) return cyberpunkPalette.roadTunnel;
      if (role === 'ferry') return cyberpunkPalette.cyanMuted;
      if (role === 'rail' || role === 'railTransit') return cyberpunkPalette.orange;
      if (role === 'cycleway' || role === 'parkPath') return cyberpunkPalette.green;
      return cyberpunkPalette.road;
    case 'surface':
      if (role === 'water') return cyberpunkPalette.water;
      if (role === 'building') return cyberpunkPalette.building;
      if (role === 'park') return cyberpunkPalette.park;
      return cyberpunkPalette.land;
    case 'transit':
      return cyberpunkPalette.neonMagenta;
    case 'vegetation':
      return cyberpunkPalette.park;
    default:
      throw new Error(`Cyberpunk has no visual family for semantic token ${name}.`);
  }
}

const cyberpunkSemanticColorRoles = {
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

const cyberpunkSemanticColors = Object.fromEntries(
  Object.entries(cyberpunkSemanticColorRoles).flatMap(([group, roles]) =>
    roles.map((role) => {
      const name = `${group}.${role}`;
      return [name, cyberpunkColorForSemanticToken(name)];
    }),
  ),
);

const cyberpunkBuildingHeight2d = expr.toNumber(
  expr.coalesce(expr.get(field('renderHeight')), 0),
  0,
);
const cyberpunkBuildingTone2d = expr.coalesce(expr.get(field('buildingTone')), '');
const cyberpunkPublishedImportanceTier = expr.toNumber(
  expr.coalesce(expr.get(field('importanceTier')), 0),
  0,
);
const cyberpunkPublishedTierVariable = expr.var<number>('t');
const cyberpunkBuildingIsDestination = expr.eq(cyberpunkBuildingTone2d, 'destination');
const cyberpunkBuildingHasColorFamily = expr.match<string, boolean>(
  cyberpunkBuildingTone2d,
  [{labels: ['active', 'commercial', 'destination'], value: true}],
  false,
);
const cyberpunkBuildingPublishedTierWithProminence = expr.let(
  't',
  cyberpunkPublishedImportanceTier,
  expr.case<number>(
    [
      {
        when: expr.all(
          expr.gte(cyberpunkPublishedTierVariable, 1),
          expr.lte(cyberpunkPublishedTierVariable, 2),
          expr.gte(
            cyberpunkBuildingHeight2d,
            expr.match<number, number>(
              cyberpunkPublishedTierVariable,
              [{labels: 1, value: 24}],
              36,
            ),
          ),
        ),
        value: expr.add(cyberpunkPublishedTierVariable, 1),
      },
    ],
    cyberpunkPublishedTierVariable,
  ),
);
const cyberpunkBuildingLegacyImportanceTier = expr.case<number>(
  [
    {
      when: cyberpunkBuildingIsDestination,
      value: expr.step(cyberpunkBuildingHeight2d, 2, [[36, 3]]),
    },
    {
      when: cyberpunkBuildingHasColorFamily,
      value: expr.step(cyberpunkBuildingHeight2d, 1, [[24, 2]]),
    },
    {when: expr.gte(cyberpunkBuildingHeight2d, 36), value: 1},
  ],
  0,
);
const cyberpunkBuildingImportanceTier = expr.case<number>(
  [
    {
      // Semantics establishes relevance. Physical prominence may add at most one
      // visual step, while an ordinary tall building is capped at a faint tier 1.
      when: expr.has(field('importanceTier')),
      value: cyberpunkBuildingPublishedTierWithProminence,
    },
  ],
  cyberpunkBuildingLegacyImportanceTier,
);
const cyberpunkBuildingIsSelectedDestination = cyberpunkBuildingIsDestination;
const cyberpunkBuildingGhostFill = expr.case<string>(
  [
    {
      when: cyberpunkBuildingIsSelectedDestination,
      value: expr.step(cyberpunkBuildingImportanceTier, '#0C1528', [
        [1, '#201E14'],
        [2, '#302A12'],
        [3, '#433812'],
        [4, '#5A4B0E'],
      ]),
    },
  ],
  expr.step(cyberpunkBuildingImportanceTier, '#0C1528', [
    [1, '#29132A'],
    [2, '#351235'],
    [3, '#48123F'],
    [4, '#5B144D'],
  ]),
);
const cyberpunkBuildingGhostCore = expr.case<string>(
  [
    {
      when: cyberpunkBuildingIsSelectedDestination,
      value: expr.step(cyberpunkBuildingImportanceTier, '#45608C', [
        [1, '#AAA13D'],
        [2, '#D6CA3D'],
        [3, '#F3E941'],
        [4, '#FFF27A'],
      ]),
    },
  ],
  expr.step(cyberpunkBuildingImportanceTier, '#45608C', [
    [1, '#B64996'],
    [2, '#D654B5'],
    [3, '#FF5CCF'],
    [4, '#FF86DD'],
  ]),
);
const cyberpunkBuildingGhostCoreOpacity = expr.case<number>(
  [
    {
      when: cyberpunkBuildingIsSelectedDestination,
      value: expr.step(cyberpunkBuildingImportanceTier, 0.18, [
        [1, 0.46],
        [2, 0.64],
        [3, 0.82],
        [4, 0.96],
      ]),
    },
  ],
  expr.step(cyberpunkBuildingImportanceTier, 0.18, [
    [1, 0.52],
    [2, 0.68],
    [3, 0.84],
    [4, 0.96],
  ]),
);

const cyberpunkRoadClass = expr.coalesce(expr.get(field('class')), '');
const cyberpunkRoadImportanceTier = expr.case<number>(
  [{when: expr.has(field('importanceTier')), value: cyberpunkPublishedImportanceTier}],
  expr.match<string, number>(
    cyberpunkRoadClass,
    [
      {labels: ['motorway', 'trunk'], value: 4},
      {labels: 'primary', value: 3},
      {labels: 'secondary', value: 2},
      {labels: 'tertiary', value: 1},
    ],
    0,
  ),
);

const cyberpunkPoiCategory = expr.coalesce(expr.get(field('poiCategory')), '');
const cyberpunkPoiFilterRank = expr.toNumber(expr.get(field('poiFilterRank')), 6);
const cyberpunkPoiSizeRank = expr.toNumber(expr.get(field('poiSizeRank')), 17);
const cyberpunkPoiImportanceTier = expr.match<string, number>(
  cyberpunkPoiCategory,
  [
    {labels: 'landmark', value: 4},
    {labels: 'transport', value: 3},
    {
      labels: ['arts-entertainment', 'park-nature', 'public-services', 'sport-leisure'],
      value: 2,
    },
  ],
  1,
);
const cyberpunkHudPoiImportanceTier = cyberpunkPoiImportanceTier;
const cyberpunkPoiPlacementPriority = expr.add(
  expr.multiply(cyberpunkPoiFilterRank, 17),
  cyberpunkPoiSizeRank,
);
const cyberpunkPoiImportanceColor = expr.match<number, string>(
  cyberpunkPoiImportanceTier,
  [
    {labels: 4, value: cyberpunkPalette.yellow},
    {labels: 3, value: cyberpunkPalette.neonMagenta},
    {labels: 2, value: cyberpunkPalette.magentaSoft},
  ],
  cyberpunkPalette.cyanSoft,
);
const cyberpunkPoiIsActive = expr.toBoolean(expr.featureState('active'), false);

type WidthStops = readonly (readonly [number, number])[];

const roadBorderTotalWidth = 1;
const roadWidthInterpolationBase = 1.5;
const expresswayWidthScale = 1.06;
const tunnelBorderDash = [8, 5] as const;
const tunnelBorderWidth = 1;
const roadClearanceExtraAtZ15 = expr.toNumber(
  expr.coalesce(expr.get(field('circularClearanceExtraAtZoom15')), 0),
  0,
);
const roadNeedsStructuralButtCap = expr.any(
  expr.eq(expr.get(field('brunnel')), 'tunnel'),
  expr.eq(expr.get(field('class')), 'steps'),
  expr.eq(expr.get(field('subclass')), 'steps'),
);
const roadNeedsControlledSurfaceButtCap = expr.all(
  expr.match<string, boolean>(
    expr.get(field('brunnel')),
    [{labels: ['tunnel', 'bridge'], value: false}],
    true,
  ),
  expr.eq(expr.get(field('foot')), 'no'),
  expr.match<string, boolean>(
    expr.get(field('class')),
    [
      {
        labels: [
          'motorway',
          'trunk',
          'primary',
          'motorway_construction',
          'trunk_construction',
          'primary_construction',
        ],
        value: true,
      },
    ],
    false,
  ),
);
const roadLineCap = expr.step<TileflowLineCap>(
  expr.zoom(),
  expr.case<TileflowLineCap>([{when: roadNeedsStructuralButtCap, value: 'butt'}], 'round'),
  [
    [
      17,
      expr.case<TileflowLineCap>(
        [
          {
            when: expr.any(
              roadNeedsStructuralButtCap,
              roadNeedsControlledSurfaceButtCap,
              expr.gt(roadClearanceExtraAtZ15, 0),
            ),
            value: 'butt',
          },
        ],
        'round',
      ),
    ],
  ],
);
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

function roadWidth(
  widths: WidthStops,
  oneWayScale: number,
  casing = false,
  clearance = true,
  rampWidths?: WidthStops,
) {
  const augmentedWidths = [...widths].sort(([left], [right]) => left - right);
  const widthOutput = (level: number, width: number): TileflowDataExpressionInput<number> => {
    const ordinaryWidth =
      oneWayScale === 1
        ? width
        : expr.match<number, number>(
            expr.get(field('oneway')),
            [{labels: [1, -1], value: width * oneWayScale}],
            width,
          );
    const rampWidth = rampWidths?.find(([rampLevel]) => rampLevel === level)?.[1];
    const surfaceWidth =
      rampWidth === undefined
        ? ordinaryWidth
        : expr.case<number>(
            [{when: expr.eq(expr.get(field('ramp')), 1), value: rampWidth}],
            ordinaryWidth,
          );
    if (!casing) return surfaceWidth;
    return typeof surfaceWidth === 'number'
      ? surfaceWidth + roadBorderTotalWidth
      : expr.add(surfaceWidth, roadBorderTotalWidth);
  };
  const widthStops = augmentedWidths.map(
    ([level, width]) => [level, widthOutput(level, width)] as const,
  );
  const firstWidthStop = widthStops[0];
  if (firstWidthStop === undefined) throw new Error('Road widths require at least one zoom stop.');
  const baseWidth = expr.interpolate(
    {base: roadWidthInterpolationBase, kind: 'exponential'},
    expr.zoom(),
    [firstWidthStop, ...widthStops.slice(1)],
  );
  const clearanceWidth = clearance
    ? expr.add(
        baseWidth,
        expr.step(expr.zoom(), 0, [
          [
            17,
            expr.multiply(
              roadClearanceExtraAtZ15,
              expr.interpolate({base: 2, kind: 'exponential'}, expr.zoom(), [
                [17, 4],
                [22, 128],
              ]),
            ),
          ],
        ]),
      )
    : baseWidth;
  return clearanceWidth;
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
      ...(options.underlay ? {shadow: {...options.underlay, cap: tunnelCap}} : {}),
      casing: {
        ...casing,
        cap: tunnelCap,
        color: cyberpunkPalette.roadCasing,
        dash: tunnelBorderDash,
        gapWidth: fill.width,
        opacity: 1,
        width: pathTunnelCasingWidth,
      },
      fill: {...fill, cap: tunnelCap, color: '#06152E', dash: [1, 0], opacity: 1},
      hatch: {visible: false},
    },
  };
}

const unpavedPathCondition = expr.eq(expr.get(field('surface')), 'unpaved');
const contextualPathLineWidth = expr.interpolate<number>(
  {base: 1.5, kind: 'exponential'},
  expr.zoom(),
  [
    [12, expr.case<number>([{when: unpavedPathCondition, value: 0}], 0)],
    [15, expr.case<number>([{when: unpavedPathCondition, value: 0.75}], 1)],
    [16, expr.case<number>([{when: unpavedPathCondition, value: 1}], 1.5)],
    [17, expr.case<number>([{when: unpavedPathCondition, value: 1.4}], 3)],
    [18, expr.case<number>([{when: unpavedPathCondition, value: 2}], 6)],
    [19, expr.case<number>([{when: unpavedPathCondition, value: 3.7}], 12)],
    [20, expr.case<number>([{when: unpavedPathCondition, value: 7.5}], 22)],
    [22, expr.case<number>([{when: unpavedPathCondition, value: 20}], 60)],
  ],
);
const contextualPathCasingWidth = expr.interpolate<number>(
  {base: 1.5, kind: 'exponential'},
  expr.zoom(),
  [
    [15, expr.case<number>([{when: unpavedPathCondition, value: 0}], 0)],
    [15.5, expr.case<number>([{when: unpavedPathCondition, value: 0}], 0.5)],
    [18, expr.case<number>([{when: unpavedPathCondition, value: 0}], 1)],
    [22, expr.case<number>([{when: unpavedPathCondition, value: 0}], 2)],
  ],
);
const contextualPathClasses = ['pathway', 'footway', 'steps', 'pedestrian'] as const;

const cyberpunkOverviewLandcoverColor = expr.match<string, string>(
  expr.get(field('class')),
  [
    {labels: 'barren', value: '#0A2143'},
    {labels: 'crop', value: '#0B2C4A'},
    {labels: 'grass', value: '#173A36'},
    {labels: 'shrub', value: '#163D38'},
    {labels: 'snow', value: '#1B447A'},
    {labels: 'trees', value: '#11352F'},
    {labels: 'urban', value: '#292D4B'},
  ],
  'rgba(0, 0, 0, 0)',
);

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

function cyberpunkRenderOperationName(prefix: string, ...parts: string[]): string {
  return `${prefix}${parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]+/u))
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('')}`;
}

function cyberpunkLabelRenderStack(): TileflowNamedRenderStack {
  return Object.fromEntries([
    ...cyberpunkRoadLabelIds.map(
      (target) =>
        [
          cyberpunkRenderOperationName('roadLabel', target.split('.').at(-1) ?? ''),
          refineRenderTarget({
            renderer: 'symbol',
            requirements: ['roads'],
            target,
            style: {
              text: {
                haloWidth: 1.6,
                size: expr.interpolate({kind: 'linear'}, expr.zoom(), [
                  [10, 9],
                  [16, 13],
                ]),
              },
            },
          }),
        ] as const,
    ),
    ...cyberpunkPrimaryPlaceLabelIds.map(
      (target) =>
        [
          cyberpunkRenderOperationName('placeLabel', target.split('.').at(-1) ?? ''),
          refineRenderTarget({renderer: 'symbol', target, style: {text: {haloWidth: 1.4}}}),
        ] as const,
    ),
    ...cyberpunkSecondaryPlaceLabelIds.map(
      (target) =>
        [
          cyberpunkRenderOperationName('placeLabel', target.split('.').at(-1) ?? ''),
          refineRenderTarget({
            renderer: 'symbol',
            target,
            style: {text: {color: cyberpunkPalette.labelMuted, haloWidth: 1.1}},
          }),
        ] as const,
    ),
  ]);
}

function cyberpunkPoiLabelRenderStack(): TileflowNamedRenderStack {
  return Object.fromEntries(
    (['poi.transport.label', 'poi.arts-entertainment.label'] as const).map((target) => [
      cyberpunkRenderOperationName('poiLabel', target.split('.').at(-2) ?? ''),
      refineRenderTarget({renderer: 'symbol', target, style: {text: {haloWidth: 1.2}}}),
    ]),
  );
}

function cyberpunkPathRenderStack(): TileflowNamedRenderStack {
  return Object.fromEntries(
    contextualPathClasses.flatMap((roadClass) =>
      (['surface', 'bridge'] as const).flatMap((structure) => [
        [
          cyberpunkRenderOperationName('path', roadClass, structure, 'fill'),
          refineRenderTarget({
            renderer: 'line',
            target: `roads.classes.${roadClass}.${structure}.fill`,
            style: {
              color: roadClass === 'steps' ? '#06152E' : cyberpunkPalette.road,
              ...(roadClass === 'steps' ? {dash: [0.18, 0.15] as const} : {}),
              width: contextualPathLineWidth,
            },
          }),
        ],
        [
          cyberpunkRenderOperationName('path', roadClass, structure, 'casing'),
          refineRenderTarget({
            renderer: 'line',
            target: `roads.classes.${roadClass}.${structure}.casing`,
            style: {
              color: cyberpunkPalette.roadCasing,
              gapWidth: roadClass === 'steps' ? 0 : contextualPathLineWidth,
              width: roadClass === 'steps' ? contextualPathLineWidth : contextualPathCasingWidth,
            },
          }),
        ],
      ]),
    ),
  );
}

function cyberpunkRoadImportanceSelector(
  minimum: 1 | 2 | 3,
  unobstructed: boolean,
): TileflowRenderSelector {
  const legacyClasses = {
    1: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
    2: ['motorway', 'trunk', 'primary', 'secondary'],
    3: ['motorway', 'trunk', 'primary'],
  }[minimum];
  return {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'line'},
      {
        kind: 'any',
        selectors: [
          {
            kind: 'all',
            selectors: [
              {kind: 'has', field: 'importanceTier'},
              {
                kind: 'compare',
                field: 'importanceTier',
                operator: 'gte',
                value: minimum,
                coerce: 'number',
                fallback: 0,
              },
            ],
          },
          {
            kind: 'all',
            selectors: [
              {kind: 'not', selector: {kind: 'has', field: 'importanceTier'}},
              {kind: 'in', field: 'class', values: legacyClasses, fallback: ''},
            ],
          },
        ],
      },
      ...(unobstructed
        ? ([
            {
              kind: 'compare',
              field: 'ramp',
              operator: 'ne',
              value: 1,
              coerce: 'number',
              fallback: 0,
            },
            {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'tunnel', fallback: ''},
          ] satisfies TileflowRenderSelector[])
        : []),
    ],
  };
}

function cyberpunkPrincipalRoadRenderStack(): TileflowNamedRenderStack {
  const principalRoadColor = expr.match<string, string>(
    cyberpunkRoadClass,
    [{labels: ['trunk', 'secondary'], value: cyberpunkPalette.neonMagenta}],
    cyberpunkPalette.neonCyan,
  );
  const roadWidthScale = expr.match<number, number>(
    cyberpunkRoadImportanceTier,
    [
      {labels: 4, value: 1},
      {labels: 3, value: 0.9},
      {labels: 2, value: 0.72},
      {labels: 1, value: 0.48},
    ],
    0,
  );
  const roadCoreOpacity = expr.match<number, number>(
    cyberpunkRoadImportanceTier,
    [
      {labels: 4, value: 0.94},
      {labels: 3, value: 0.82},
      {labels: 2, value: 0.62},
      {labels: 1, value: 0.32},
    ],
    0,
  );
  const roadCoreStructureAttenuation = expr.case<number>(
    [
      {when: expr.eq(expr.get(field('brunnel')), 'tunnel'), value: 0.32},
      {when: expr.eq(expr.get(field('ramp')), 1), value: 0.55},
    ],
    1,
  );
  return {
    principalNeonAura: renderPass({
      attachTo: 'roads.classes.motorway.surface.fill',
      feature: 'road',
      phase: 'overlay',
      renderer: 'line',
      selector: cyberpunkRoadImportanceSelector(3, true),
      style: {
        blur: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [8, 2],
          [10, 3.5],
          [12, 8],
          [16, 12],
          [18, 14],
          [22, 18],
        ]),
        cap: 'round',
        color: principalRoadColor,
        join: 'round',
        minZoom: 8,
        opacity: expr.match<number, number>(
          cyberpunkRoadImportanceTier,
          [
            {labels: 4, value: 0.24},
            {labels: 3, value: 0.17},
          ],
          0,
        ),
        width: expr.interpolate({base: 1.5, kind: 'exponential'}, expr.zoom(), [
          [8, 0],
          [10, 0.35],
          [11, 0.9],
          [12, expr.multiply(2.5, roadWidthScale)],
          [15, expr.multiply(7, roadWidthScale)],
          [16, expr.multiply(13.5, roadWidthScale)],
          [18, expr.multiply(24, roadWidthScale)],
          [22, expr.multiply(70, roadWidthScale)],
        ]),
      },
    }),
    principalNeonGlow: renderPass({
      attachTo: 'roads.render.principalNeonAura',
      feature: 'road',
      phase: 'overlay',
      renderer: 'line',
      selector: cyberpunkRoadImportanceSelector(2, true),
      style: {
        blur: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [6, 0.8],
          [8, 1.5],
          [10, 2.5],
          [12, 4],
          [16, 5],
          [18, 6.5],
          [22, 9],
        ]),
        cap: 'round',
        color: principalRoadColor,
        join: 'round',
        minZoom: 6,
        opacity: expr.match<number, number>(
          cyberpunkRoadImportanceTier,
          [
            {labels: 4, value: 0.54},
            {labels: 3, value: 0.42},
            {labels: 2, value: 0.26},
          ],
          0,
        ),
        width: expr.interpolate({base: 1.5, kind: 'exponential'}, expr.zoom(), [
          [6, 0],
          [8, 0.18],
          [10, 0.55],
          [12, expr.multiply(1.3, roadWidthScale)],
          [15, expr.multiply(3.6, roadWidthScale)],
          [16, expr.multiply(7.2, roadWidthScale)],
          [18, expr.multiply(12, roadWidthScale)],
          [22, expr.multiply(34, roadWidthScale)],
        ]),
      },
    }),
    principalNeonCore: renderPass({
      attachTo: 'roads.render.principalNeonGlow',
      feature: 'road',
      phase: 'overlay',
      renderer: 'line',
      selector: cyberpunkRoadImportanceSelector(1, false),
      style: {
        blur: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [3, 0.2],
          [8, 0.35],
          [10, 0.5],
          [12, 0.75],
          [18, 0.35],
        ]),
        cap: 'round',
        color: principalRoadColor,
        join: 'round',
        minZoom: 3,
        opacity: expr.multiply(roadCoreOpacity, roadCoreStructureAttenuation),
        width: expr.interpolate({base: 1.5, kind: 'exponential'}, expr.zoom(), [
          [3, 0],
          [4, 0.24],
          [8, 0.48],
          [10, 0.6],
          [12, expr.multiply(0.7, roadWidthScale)],
          [15, expr.multiply(2, roadWidthScale)],
          [16, expr.multiply(3, roadWidthScale)],
          [18, expr.multiply(5, roadWidthScale)],
          [22, expr.multiply(15, roadWidthScale)],
        ]),
      },
    }),
  };
}

function cyberpunkBuildingImportanceSelector(minimum: 2 | 3): TileflowRenderSelector {
  const hasPublishedTier = {kind: 'has', field: 'importanceTier'} as const;
  const heightAtLeast = (value: number): TileflowRenderSelector => ({
    kind: 'compare',
    field: 'renderHeight',
    operator: 'gte',
    value,
    coerce: 'number',
    fallback: 0,
  });
  const publishedBranch: TileflowRenderSelector = {
    kind: 'all',
    selectors: [
      hasPublishedTier,
      {
        kind: 'any',
        selectors:
          minimum === 3
            ? [
                {
                  kind: 'compare',
                  field: 'importanceTier',
                  operator: 'gte',
                  value: 3,
                  coerce: 'number',
                  fallback: 0,
                },
                {
                  kind: 'all',
                  selectors: [
                    {
                      kind: 'compare',
                      field: 'importanceTier',
                      operator: 'eq',
                      value: 2,
                      coerce: 'number',
                      fallback: 0,
                    },
                    heightAtLeast(36),
                  ],
                },
              ]
            : [
                {
                  kind: 'compare',
                  field: 'importanceTier',
                  operator: 'gte',
                  value: 2,
                  coerce: 'number',
                  fallback: 0,
                },
                {
                  kind: 'all',
                  selectors: [
                    {
                      kind: 'compare',
                      field: 'importanceTier',
                      operator: 'eq',
                      value: 1,
                      coerce: 'number',
                      fallback: 0,
                    },
                    heightAtLeast(24),
                  ],
                },
              ],
      },
    ],
  };
  const legacyBranch: TileflowRenderSelector = {
    kind: 'all',
    selectors: [
      {kind: 'not', selector: hasPublishedTier},
      ...(minimum === 3
        ? ([
            {
              kind: 'compare',
              field: 'buildingTone',
              operator: 'eq',
              value: 'destination',
              fallback: '',
            },
            heightAtLeast(36),
          ] satisfies TileflowRenderSelector[])
        : ([
            {
              kind: 'any',
              selectors: [
                {
                  kind: 'compare',
                  field: 'buildingTone',
                  operator: 'eq',
                  value: 'destination',
                  fallback: '',
                },
                {
                  kind: 'all',
                  selectors: [
                    {
                      kind: 'in',
                      field: 'buildingTone',
                      values: ['active', 'commercial', 'destination'],
                      fallback: '',
                    },
                    heightAtLeast(24),
                  ],
                },
              ],
            },
          ] satisfies TileflowRenderSelector[])),
    ],
  };
  return {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'polygon'},
      {kind: 'any', selectors: [publishedBranch, legacyBranch]},
    ],
  };
}

function cyberpunkBuildingRenderStack(): TileflowNamedRenderStack {
  const strongSelector = cyberpunkBuildingImportanceSelector(3);
  const activitySelector = cyberpunkBuildingImportanceSelector(2);
  return {
    circuitFill: renderPass({
      attachTo: 'buildings.flat.fill',
      feature: 'building',
      phase: 'overlay',
      renderer: 'fill',
      selector: strongSelector,
      style: {
        minZoom: 15,
        opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0],
          [
            15.75,
            expr.match<number, number>(
              cyberpunkBuildingImportanceTier,
              [
                {labels: 4, value: 0.28},
                {labels: 3, value: 0.16},
              ],
              0,
            ),
          ],
        ]),
        pattern: 'cyber-circuit',
      },
    }),
    ghostAura: renderPass({
      attachTo: 'buildings.render.circuitFill',
      feature: 'building',
      phase: 'overlay',
      renderer: 'line',
      selector: strongSelector,
      style: {
        blur: 0.8,
        cap: 'round',
        color: expr.case<string>(
          [
            {
              when: cyberpunkBuildingIsSelectedDestination,
              value: cyberpunkPalette.yellow,
            },
          ],
          cyberpunkPalette.neonMagenta,
        ),
        join: 'round',
        minZoom: 15,
        opacity: expr.match<number, number>(
          cyberpunkBuildingImportanceTier,
          [
            {labels: 4, value: 0.22},
            {labels: 3, value: 0.13},
          ],
          0,
        ),
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 3],
          [16, 4],
          [18, 6],
          [22, 10],
        ]),
      },
    }),
    ghostGlow: renderPass({
      attachTo: 'buildings.render.ghostAura',
      feature: 'building',
      phase: 'overlay',
      renderer: 'line',
      selector: activitySelector,
      style: {
        blur: 0.05,
        cap: 'round',
        color: expr.case<string>(
          [
            {
              when: cyberpunkBuildingIsSelectedDestination,
              value: cyberpunkPalette.yellow,
            },
          ],
          cyberpunkPalette.neonMagenta,
        ),
        gapWidth: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0.7],
          [16, 1.1],
          [18, 1.8],
          [22, 4],
        ]),
        join: 'round',
        minZoom: 15,
        opacity: expr.case<number>(
          [
            {
              when: cyberpunkBuildingIsSelectedDestination,
              value: expr.match<number, number>(
                cyberpunkBuildingImportanceTier,
                [
                  {labels: 4, value: 0.62},
                  {labels: 3, value: 0.44},
                  {labels: 2, value: 0.24},
                ],
                0,
              ),
            },
          ],
          expr.match<number, number>(
            cyberpunkBuildingImportanceTier,
            [
              {labels: 4, value: 0.64},
              {labels: 3, value: 0.48},
              {labels: 2, value: 0.28},
            ],
            0,
          ),
        ),
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0.35],
          [16, 0.5],
          [18, 0.8],
          [22, 1.6],
        ]),
      },
    }),
    signalTrace: renderPass({
      attachTo: 'buildings.render.ghostGlow',
      feature: 'building',
      phase: 'overlay',
      renderer: 'line',
      selector: strongSelector,
      style: {
        blur: 0,
        cap: 'butt',
        color: expr.case<string>(
          [{when: cyberpunkBuildingIsSelectedDestination, value: '#FFF7B2'}],
          '#FFF4FB',
        ),
        dash: [0.45, 1.25],
        join: 'round',
        minZoom: 15,
        offset: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15.5, -1],
          [18, -1.8],
          [22, -4],
        ]),
        opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0],
          [
            15.75,
            expr.match<number, number>(
              cyberpunkBuildingImportanceTier,
              [
                {labels: 4, value: 0.62},
                {labels: 3, value: 0.4},
              ],
              0,
            ),
          ],
        ]),
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15.5, 0.55],
          [18, 0.9],
          [22, 1.8],
        ]),
      },
    }),
  };
}

function cyberpunkDestinationRenderStack(): TileflowNamedRenderStack {
  const hudPoiSelector = {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'point'},
      {kind: 'has', field: 'poiFilterRank'},
      {
        kind: 'compare',
        field: 'poiFilterRank',
        operator: 'gte',
        value: 0,
        coerce: 'number',
        fallback: 6,
      },
      {
        kind: 'compare',
        field: 'poiFilterRank',
        operator: 'lte',
        value: 2,
        coerce: 'number',
        fallback: 6,
      },
      {kind: 'has', field: 'poiSizeRank'},
      {
        kind: 'compare',
        field: 'poiSizeRank',
        operator: 'gte',
        value: 0,
        coerce: 'number',
        fallback: 17,
      },
      {
        kind: 'compare',
        field: 'poiSizeRank',
        operator: 'lte',
        value: 16,
        coerce: 'number',
        fallback: 17,
      },
    ],
  } as const satisfies TileflowRenderSelector;
  const beaconScale = expr.match<number, number>(
    cyberpunkPoiImportanceTier,
    [
      {labels: 4, value: 1.4},
      {labels: 3, value: 1.2},
      {labels: 2, value: 1},
      {labels: 1, value: 0.78},
    ],
    0,
  );
  return {
    destinationScanRing: renderPass({
      attachTo: 'poi.transport.label',
      feature: 'poi',
      phase: 'underlay',
      renderer: 'circle',
      selector: hudPoiSelector,
      style: {
        color: 'rgba(0, 0, 0, 0)',
        minZoom: 15,
        priority: cyberpunkPoiPlacementPriority,
        radius: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 6],
          [16, 8],
          [18, 14],
          [22, 24],
        ]),
        strokeColor: expr.case<string>(
          [{when: cyberpunkPoiIsActive, value: cyberpunkPalette.acidGreen}],
          expr.match<number, string>(
            cyberpunkHudPoiImportanceTier,
            [
              {labels: 4, value: cyberpunkPalette.yellow},
              {labels: 3, value: cyberpunkPalette.neonMagenta},
            ],
            cyberpunkPalette.neonCyan,
          ),
        ),
        strokeOpacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0],
          [
            16,
            expr.case<number>(
              [{when: cyberpunkPoiIsActive, value: 1}],
              expr.match<number, number>(
                cyberpunkHudPoiImportanceTier,
                [
                  {labels: 4, value: 0.7},
                  {labels: 3, value: 0.52},
                ],
                0.28,
              ),
            ),
          ],
        ]),
        strokeWidth: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0.5],
          [18, 1],
          [22, 1.6],
        ]),
      },
    }),
    destinationBeaconCore: renderPass({
      attachTo: 'poi.render.destinationScanRing',
      feature: 'poi',
      phase: 'overlay',
      renderer: 'circle',
      selector: hudPoiSelector,
      style: {
        blur: expr.match<number, number>(
          cyberpunkPoiImportanceTier,
          [
            {labels: 4, value: 0.14},
            {labels: 3, value: 0.1},
            {labels: 2, value: 0.06},
          ],
          0,
        ),
        color: cyberpunkPoiImportanceColor,
        minZoom: 14,
        opacity: expr.match<number, number>(
          cyberpunkPoiImportanceTier,
          [
            {labels: 4, value: 0.96},
            {labels: 3, value: 0.9},
            {labels: 2, value: 0.74},
            {labels: 1, value: 0.46},
          ],
          0,
        ),
        pitchAlignment: 'map',
        pitchScale: 'map',
        priority: cyberpunkPoiPlacementPriority,
        radius: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [14, expr.multiply(1.25, beaconScale)],
          [16, expr.multiply(2.5, beaconScale)],
          [18, expr.multiply(4.5, beaconScale)],
          [22, expr.multiply(9, beaconScale)],
        ]),
        strokeColor: cyberpunkPalette.halo,
        strokeOpacity: 0.9,
        strokeWidth: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [14, 0.5],
          [18, 1],
          [22, 2],
        ]),
      },
    }),
    destinationBrackets: renderPass({
      attachTo: 'poi.arts-entertainment.label',
      feature: 'poi',
      phase: 'annotation',
      renderer: 'symbol',
      selector: hudPoiSelector,
      style: {
        icon: {
          allowOverlap: false,
          image: 'cyber-target-brackets',
          ignorePlacement: false,
          opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [15, 0],
            [
              16,
              expr.match<number, number>(
                cyberpunkHudPoiImportanceTier,
                [
                  {labels: 4, value: 0.9},
                  {labels: 3, value: 0.74},
                ],
                0.52,
              ),
            ],
          ]),
          padding: 4,
          size: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [15, 0.72],
            [16, 1],
            [18, 1.35],
            [22, 1.75],
          ]),
        },
        minZoom: 15,
        priority: expr.subtract(0, cyberpunkPoiPlacementPriority),
        text: {
          allowOverlap: false,
          anchor: 'top',
          color: expr.case<string>(
            [{when: cyberpunkPoiIsActive, value: cyberpunkPalette.acidGreen}],
            expr.match<number, string>(
              cyberpunkHudPoiImportanceTier,
              [
                {labels: 4, value: cyberpunkPalette.yellow},
                {labels: 3, value: cyberpunkPalette.neonMagenta},
              ],
              cyberpunkPalette.neonCyan,
            ),
          ),
          field: expr.coalesce(expr.get(field('name')), ''),
          font: 'Oxanium Medium',
          haloColor: cyberpunkPalette.labelHalo,
          haloWidth: 1.2,
          ignorePlacement: false,
          letterSpacing: 0.055,
          offset: [0, 1.35],
          opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [15, 0],
            [16, 0.82],
          ]),
          optional: true,
          padding: 4,
          size: 10,
          transform: 'uppercase',
        },
      },
    }),
  };
}

function cyberpunkWaterRenderStack(): TileflowNamedRenderStack {
  const polygonSelector = {kind: 'geometry', geometry: 'polygon'} as const;
  return {
    shoreAura: renderPass({
      attachTo: 'water.bodies.fill',
      feature: 'water',
      phase: 'overlay',
      renderer: 'line',
      selector: polygonSelector,
      style: {
        blur: 2,
        color: cyberpunkPalette.neonCyan,
        minZoom: 6,
        opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [6, 0],
          [8, 0.16],
        ]),
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [8, 1],
          [14, 3],
          [18, 7],
        ]),
      },
    }),
    shoreCore: renderPass({
      attachTo: 'water.render.shoreAura',
      feature: 'water',
      phase: 'overlay',
      renderer: 'line',
      selector: polygonSelector,
      style: {
        blur: 0.15,
        color: cyberpunkPalette.neonCyan,
        minZoom: 6,
        opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [6, 0],
          [8, 0.58],
        ]),
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [8, 0.3],
          [14, 0.7],
          [18, 1.5],
        ]),
      },
    }),
  };
}

function cyberpunkLandRenderStack(): TileflowNamedRenderStack {
  const polygonSelector = {kind: 'geometry', geometry: 'polygon'} as const;
  return {
    businessGrid: renderPass({
      attachTo: 'land.landuse.residential.fill',
      feature: 'landuse',
      phase: 'overlay',
      renderer: 'fill',
      selector: {
        kind: 'all',
        selectors: [
          polygonSelector,
          {kind: 'compare', field: 'class', operator: 'eq', value: 'business_area', fallback: ''},
        ],
      },
      style: {
        minZoom: 15,
        opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 0],
          [16, 0.08],
          [18, 0.12],
          [22, 0.16],
        ]),
        pattern: 'cyber-data-grid',
      },
    }),
    sectorTrace: renderPass({
      attachTo: 'land.render.businessGrid',
      feature: 'landuse',
      phase: 'overlay',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          polygonSelector,
          {
            kind: 'in',
            field: 'class',
            values: [
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
            fallback: '',
          },
        ],
      },
      style: {
        blur: 0,
        color: expr.match<string, string>(
          expr.coalesce(expr.get(field('class')), ''),
          [
            {labels: ['business_area', 'commercial', 'retail'], value: '#E63BB0'},
            {labels: ['hospital', 'medical'], value: '#FF4D87'},
            {labels: ['education', 'school', 'university'], value: '#9D73FF'},
          ],
          '#7657FF',
        ),
        dash: [1.2, 1.8],
        minZoom: 11,
        opacity: 0.34,
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [11, 0.3],
          [16, 0.7],
          [20, 1.2],
        ]),
      },
    }),
    urbanParkTrace: renderPass({
      attachTo: 'land.landcover.urbanPark.fill',
      feature: 'landcover',
      phase: 'overlay',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          polygonSelector,
          {kind: 'compare', field: 'class', operator: 'eq', value: 'grass'},
          {kind: 'in', field: 'subclass', values: ['park', 'garden']},
        ],
      },
      style: {
        blur: 0.1,
        color: '#28D7A5',
        dash: [2.5, 1.5],
        minZoom: 11,
        opacity: 0.5,
        width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [11, 0.35],
          [16, 0.9],
          [20, 1.5],
        ]),
      },
    }),
  };
}

const circularRoadRadiusAtZ15 = expr.toNumber(expr.get(field('circularRadiusAtZoom15')), 0);
const circularRoadRadiusMetres = expr.toNumber(expr.get(field('circularRadiusMeters')), 0);
const circularRoadOuterRadiusMetres = expr.toNumber(
  expr.get(field('circularOuterRadiusMeters')),
  0,
);
const circularRoadInnerRadiusMetres = expr.toNumber(
  expr.get(field('circularInnerRadiusMeters')),
  0,
);
const hasPhysicalCircularRadii = expr.all(
  expr.gt(circularRoadRadiusMetres, 0),
  expr.gt(circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres),
  expr.gte(circularRoadInnerRadiusMetres, 0),
);
const circularRoadBaseWidth = expr.match<string, number>(
  expr.coalesce(expr.get(field('class')), 'minor'),
  [
    {labels: 'motorway', value: 6},
    {labels: 'trunk', value: 5.5},
    {labels: 'primary', value: 5},
    {labels: 'secondary', value: 4.5},
    {labels: 'tertiary', value: 4},
    {labels: 'service', value: 2.5},
    {labels: 'track', value: 2},
  ],
  3,
);

function circularRoadLegacyScale(level: number) {
  const interpolationBase = 1.35;
  const progress = (interpolationBase ** (level - 15) - 1) / (interpolationBase ** (22 - 15) - 1);
  return 1 + progress * 1.2;
}

function circularRoadWidthAtLevel(level: number): TileflowDataExpressionInput<number> {
  const scale = circularRoadLegacyScale(level);
  return level === 15 ? circularRoadBaseWidth : expr.multiply(circularRoadBaseWidth, scale);
}

function circularRoadCenterlineRadiusAtLevel(level: number) {
  return level === 15
    ? circularRoadRadiusAtZ15
    : expr.multiply(circularRoadRadiusAtZ15, 2 ** (level - 15));
}

function circularRoadInnerRadiusAtLevel(level: number, casing: boolean) {
  const centerlineRadius = circularRoadCenterlineRadiusAtLevel(level);
  const physicalInnerRadius = expr.multiply(
    centerlineRadius,
    expr.divide(circularRoadInnerRadiusMetres, circularRoadRadiusMetres),
  );
  const fallbackInnerRadius = expr.subtract(
    centerlineRadius,
    expr.divide(circularRoadWidthAtLevel(level), 2),
  );
  const innerRadius = expr.case<number>(
    [{when: hasPhysicalCircularRadii, value: physicalInnerRadius}],
    fallbackInnerRadius,
  );
  return expr.max(0, casing ? expr.subtract(innerRadius, roadBorderTotalWidth / 2) : innerRadius);
}

function circularRoadInnerRadius(casing: boolean) {
  return expr.interpolate({kind: 'linear'}, expr.zoom(), [
    [15, circularRoadInnerRadiusAtLevel(15, casing)],
    [16, circularRoadInnerRadiusAtLevel(16, casing)],
    [17, circularRoadInnerRadiusAtLevel(17, casing)],
    [18, circularRoadInnerRadiusAtLevel(18, casing)],
    [19, circularRoadInnerRadiusAtLevel(19, casing)],
    [20, circularRoadInnerRadiusAtLevel(20, casing)],
    [21, circularRoadInnerRadiusAtLevel(21, casing)],
    [22, circularRoadInnerRadiusAtLevel(22, casing)],
  ]);
}

function circularRoadStrokeWidthAtLevel(level: number, casing: boolean) {
  const fallbackWidth = circularRoadWidthAtLevel(level);
  const centerlineRadius = circularRoadCenterlineRadiusAtLevel(level);
  const physicalWidth = expr.multiply(
    centerlineRadius,
    expr.divide(
      expr.subtract(circularRoadOuterRadiusMetres, circularRoadInnerRadiusMetres),
      circularRoadRadiusMetres,
    ),
  );
  const physicalOutput = casing ? expr.add(physicalWidth, roadBorderTotalWidth) : physicalWidth;
  const fallbackOutput = casing ? expr.add(fallbackWidth, roadBorderTotalWidth) : fallbackWidth;
  return expr.case<number>(
    [{when: hasPhysicalCircularRadii, value: physicalOutput}],
    fallbackOutput,
  );
}

function circularRoadStrokeWidth(casing: boolean) {
  return expr.interpolate({kind: 'linear'}, expr.zoom(), [
    [15, circularRoadStrokeWidthAtLevel(15, casing)],
    [16, circularRoadStrokeWidthAtLevel(16, casing)],
    [17, circularRoadStrokeWidthAtLevel(17, casing)],
    [18, circularRoadStrokeWidthAtLevel(18, casing)],
    [19, circularRoadStrokeWidthAtLevel(19, casing)],
    [20, circularRoadStrokeWidthAtLevel(20, casing)],
    [21, circularRoadStrokeWidthAtLevel(21, casing)],
    [22, circularRoadStrokeWidthAtLevel(22, casing)],
  ]);
}

const circularRoadRadius = circularRoadInnerRadius(false);
const circularRoadCasingRadius = circularRoadInnerRadius(true);
const circularRoadWidth = circularRoadStrokeWidth(false);
const circularRoadCasingWidth = circularRoadStrokeWidth(true);
const roundaboutNeonColor = expr.match<string, string>(
  expr.coalesce(expr.get(field('class')), 'minor'),
  [
    {labels: ['trunk', 'secondary'], value: cyberpunkPalette.magenta},
    {labels: ['motorway', 'primary'], value: cyberpunkPalette.cyan},
  ],
  cyberpunkPalette.roadCasing,
);

export const cyberpunkTheme = defineOfficialTheme({
  id: 'cyberpunk-dark',
  version: 1,
  colorScheme: 'dark',
  extraColors: cyberpunkSemanticColors,
  fonts: {default: 'Oxanium Medium', places: 'Oxanium SemiBold'},
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
      'arts-entertainment': cyberpunkPalette.labelCulture,
      education: cyberpunkPalette.cyanSoft,
      'food-drink': '#FF8A3D',
      halo: cyberpunkPalette.labelHalo,
      icon: cyberpunkPalette.cyan,
      label: cyberpunkPalette.text,
      landmark: cyberpunkPalette.labelCulture,
      lodging: cyberpunkPalette.magentaSoft,
      medical: '#FF4D6D',
      'park-nature': cyberpunkPalette.green,
      'public-services': cyberpunkPalette.cyanSoft,
      religion: cyberpunkPalette.labelCulture,
      retail: cyberpunkPalette.green,
      'sport-leisure': cyberpunkPalette.green,
      transport: cyberpunkPalette.neonMagenta,
      'visitor-amenity': cyberpunkPalette.cyanSoft,
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
  lighting: {
    anchor: 'viewport',
    color: '#FFE6F6',
    intensity: 0.22,
    position: [1.15, 210, 40],
  },
});

export const cyberpunk = bindOfficialMapTheme(
  defineMap({
    id: 'cyberpunk',
    version: 1,
    name: 'Cyberpunk',
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    fonts: [cyberpunkFonts],
    icons: [cyberpunkIcons],
    themes: {dark: cyberpunkTheme},
    defaultTheme: 'dark',
    modules: {
      addresses: disable(),
      aeroways: disable(),
      boundaries: withRenderStack(
        boundaries({
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
            dash: expr.step<readonly number[]>(
              expr.zoom(),
              expr.literal<readonly number[]>([3, 2, 5]),
              [[7, expr.literal<readonly number[]>([2, 1.5])]],
            ),
            minZoom: 1,
            opacity: 1,
            width: zoom.linear([
              [3, 0.5],
              [12, 2],
            ]),
          },
          maritime: {visible: false},
        }),
        {
          admin2Background: renderPass({
            attachTo: 'boundaries.admin4',
            feature: 'boundary',
            phase: 'underlay',
            renderer: 'line',
            selector: {
              kind: 'all',
              selectors: [
                {
                  kind: 'compare',
                  field: 'adminLevel',
                  operator: 'eq',
                  value: 2,
                  coerce: 'number',
                  fallback: 0,
                },
                {
                  kind: 'compare',
                  field: 'maritime',
                  operator: 'ne',
                  value: 1,
                  coerce: 'number',
                  fallback: 0,
                },
              ],
            },
            style: {
              blur: expr.interpolate({kind: 'linear'}, expr.zoom(), [
                [3, 0],
                [12, 2],
              ]),
              color: token.color('boundaries.halo'),
              minZoom: 1,
              opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
                [3, 0],
                [4, 0.5],
              ]),
              width: expr.interpolate({kind: 'linear'}, expr.zoom(), [
                [3, 4],
                [12, 8],
              ]),
            },
          }),
        },
      ),
      buildings: withRenderStack(
        buildings({
          businessCorridor: {
            fill: {visible: false},
            outline: {visible: false},
          },
          flat: {
            fill: {
              color: cyberpunkBuildingGhostFill,
              minZoom: 15,
              opacity: 0.56,
            },
            outline: {
              blur: 0,
              color: cyberpunkBuildingGhostCore,
              minZoom: 15,
              opacity: cyberpunkBuildingGhostCoreOpacity,
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
        cyberpunkBuildingRenderStack(),
      ),
      labels: withRenderStack(
        labels({
          aerodromeCodes: 'none',
          junctions: false,
          language: 'local',
          places: 'all',
          roadClasses: [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service',
          ],
          roads: 'all',
          shields: 'none',
          water: 'major',
        }),
        cyberpunkLabelRenderStack(),
      ),
      land: withRenderStack(
        land({
          background: {color: cyberpunkPalette.land},
          globalLandcover: {
            color: cyberpunkOverviewLandcoverColor,
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
        cyberpunkLandRenderStack(),
      ),
      roads: withRenderStack(
        roads({
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
              radius: circularRoadCasingRadius,
              strokeColor: roundaboutNeonColor,
              strokeWidth: circularRoadCasingWidth,
            },
            fill: {
              color: 'rgba(0, 0, 0, 0)',
              minZoom: 15,
              pitchAlignment: 'map',
              pitchScale: 'map',
              radius: circularRoadRadius,
              strokeColor: cyberpunkPalette.road,
              strokeWidth: circularRoadWidth,
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
        {
          ...cyberpunkPathRenderStack(),
          ...cyberpunkPrincipalRoadRenderStack(),
        },
      ),
      transit: transit(mapboxRailTransitStyle(cyberpunkPalette.orange)),
      landforms: disable(),
      poi: withRenderStack(
        poi({
          categories: ['transport', 'arts-entertainment'],
          color: 'category',
          density: 2,
          icons: false,
          labels: true,
          minZoom: 15,
          placement: {
            coupleIconAndLabel: false,
            iconPadding: 4,
            textPadding: 4,
          },
        }),
        {
          ...cyberpunkPoiLabelRenderStack(),
          ...cyberpunkDestinationRenderStack(),
        },
      ),
      vegetation: disable(),
      // Keep hydrography driven solely by Cyberpunk's dark theme.
      water: withRenderStack(water(), cyberpunkWaterRenderStack()),
    },
    projection: 'mercator',
    terrain: 'none',
    view: {
      bearing: 0,
      center: [-3.69275, 40.40866],
      pitch: 0,
      zoom: 15,
    },
  }),
);
