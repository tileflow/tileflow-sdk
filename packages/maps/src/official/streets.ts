import {
  addresses,
  boundaries,
  buildings,
  defineRootMap,
  expression,
  fixed,
  labels,
  land,
  poi,
  roads,
  type TileflowLineCap,
  type TileflowLineJoin,
  type TileflowLineStyle,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  type TileflowThemeColorValue,
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
} from '@tileflow/core/recipe';
import {streetsIcons} from '../assets';
import {mapboxRailTransitStyle} from './mapbox-rail';
import {streetsThemes, streetsVisual} from './streets-themes';
import {bindOfficialMapTheme} from './theme-helpers';

// Shared detail roles for labels, POI, paths, trees, and transit. Every value
// remains a semantic theme reference; this object does not carry a second
// physical palette beside streetsSurfacePalette.
const streetsDetailPalette = {
  greenspace: streetsVisual.landcover.greenspace,
  greenspaceDark: streetsVisual.landcover.greenspaceDark,
  halo: streetsVisual.label.halo,
  parkPath: streetsVisual.road.parkPath,
  rail: streetsVisual.road.rail,
  roadCasing: streetsVisual.road.cityCasing,
  roadTunnel: streetsVisual.road.cityTunnel,
  roadTunnelBorder: streetsVisual.road.cityTunnelCasing,
  transit: streetsVisual.transit,
  waterText: streetsVisual.label.water,
} as const;

// Mapbox Standard's default/day and default/night presets expose
// three road families rather than a different hue for every OSM hierarchy:
// motorway, trunk, and all remaining drivable roads. Paths have their own
// z15-z16 transition and cycleways retain the Standard green.
const mapboxRoadPalette = {
  motorway: streetsVisual.road.motorway,
  motorwayCasing: streetsVisual.road.motorwayCasing,
  motorwayTunnel: streetsVisual.road.motorwayTunnel,
  trunk: streetsVisual.road.trunk,
  trunkCasing: streetsVisual.road.trunkCasing,
  trunkTunnel: streetsVisual.road.trunkTunnel,
  road: streetsVisual.road.default,
  roadCasing: streetsVisual.road.casing,
  roadTunnel: streetsVisual.road.tunnel,
  pathAtZ15: streetsVisual.road.pathTransition,
  pathFromZ16: streetsVisual.road.path,
  pathCasing: streetsVisual.road.pathCasing,
  pathTunnel: streetsVisual.road.pathTunnel,
  cycleway: streetsVisual.road.cycleway,
} as const;

const mapboxRailColor = streetsVisual.road.railTransit;

// One semantic surface system from world view through city detail. Values are
// calibrated against the dated Mapbox Standard snapshot, but their names describe Tileflow's
// data contract so the style does not depend on another vendor's taxonomy.
const streetsSurfacePalette = {
  background: streetsVisual.surface.background,
  barren: streetsVisual.landcover.barren,
  businessCorridor: streetsVisual.landuse.businessCorridor,
  businessCorridorOutline: streetsVisual.landuse.businessCorridorOutline,
  cemetery: streetsVisual.landuse.cemetery,
  civic: streetsVisual.landuse.civic,
  crop: streetsVisual.landcover.farmland,
  education: streetsVisual.landuse.education,
  flowerbed: streetsVisual.landcover.flowerbed,
  government: streetsVisual.landuse.government,
  ice: streetsVisual.landcover.ice,
  industrial: streetsVisual.landuse.industrial,
  land: streetsVisual.surface.land,
  meadow: streetsVisual.landcover.meadow,
  medical: streetsVisual.landuse.medical,
  parking: streetsVisual.landuse.parking,
  parkingOutline: streetsVisual.landuse.parkingOutline,
  protected: streetsVisual.landcover.protected,
  railway: streetsVisual.landuse.railway,
  recreation: streetsVisual.landuse.recreation,
  recreationGround: streetsVisual.landcover.recreationGround,
  recreationOutline: streetsVisual.landuse.recreationOutline,
  residential: streetsVisual.landuse.residential,
  rock: streetsVisual.landcover.rock,
  sand: streetsVisual.landcover.sand,
  scrub: streetsVisual.landcover.scrub,
  urbanPark: streetsVisual.landcover.urbanPark,
  villageGreen: streetsVisual.landcover.villageGreen,
  water: streetsVisual.hydro.water,
  waterOcean: streetsVisual.hydro.ocean,
  waterDepth0: streetsVisual.hydro.depth0,
  waterDepth200: streetsVisual.hydro.depth200,
  waterDepth2000: streetsVisual.hydro.depth2000,
  waterDepth7000: streetsVisual.hydro.depth7000,
  wetland: streetsVisual.landcover.wetland,
  wood: streetsVisual.landcover.wood,
} as const;

// The generalized world product needs a quieter overview palette than the
// detailed OSM polygons. Keeping these roles separate prevents a z0-z10
// calibration from washing out parks and forests at city zooms.
const streetsGlobalLandcoverPalette = {
  barren: streetsVisual.globalLandcover.barren,
  crop: streetsVisual.globalLandcover.crop,
  grass: streetsVisual.globalLandcover.grass,
  shrub: streetsVisual.globalLandcover.shrub,
  snow: streetsVisual.globalLandcover.snow,
  trees: streetsVisual.globalLandcover.trees,
  urban: streetsVisual.globalLandcover.urban,
} as const;

const globalLandcoverOpacity = zoom.linear([
  // At world and country zooms the source classes are the terrain palette.
  // Blending them into the neutral land token desaturates forests and crops
  // into one pale wash, so keep the authored colours intact until the detailed
  // OSM handoff begins.
  [0, 1],
  [5, 1],
  [7, 1],
  [8, 0.85],
  [9, 0.78],
  [10, 0.75],
  [10.5, 0.5],
  [10.75, 0.25],
  [11, 0],
]);
const detailedLandcoverOpacity = zoom.linear([
  [7, 0],
  [8, 0.35],
  [9, 0.7],
  [10, 0.9],
  [11, 1],
]);
const detailedUrbanGreenOpacity = zoom.linear([
  [8, 0],
  [9, 1],
]);
const protectedAreaOpacity = zoom.linear([
  [7, 0],
  [8, 0.28],
  [9, 0.32],
]);

// Match Standard's warm 2D footprints here; authored 3D extrusions keep their
// separate neutral palette.
const mapboxBuildingPalette = {
  fill: streetsVisual.building.fill,
  outline: streetsVisual.building.outline,
} as const;

// Standard uses a softer local-road hierarchy below the detailed z15 handoff.
// The named roles keep that transition explicit without coupling themes to
// physical compiler layer IDs.
const streetsCityRoadPalette = {
  primary: streetsVisual.road.cityPrimary,
  secondary: streetsVisual.road.citySecondary,
  tertiary: streetsVisual.road.cityTertiary,
  minor: streetsVisual.road.cityMinor,
} as const;

// Overview-only boundaries, labels, and translucent bathymetry.
const streetsOverviewPalette = {
  admin0: streetsVisual.boundary.admin,
  admin1: streetsVisual.boundary.regional,
  label: streetsVisual.label.country,
} as const;

type WidthStops = readonly (readonly [number, number])[];
type ColorValue = TileflowThemeColorValue;
type ColorStops = readonly (readonly [number, ColorValue])[];

const detailedRoadTransitionStartZoom = 14;
const detailedRoadZoom = 15;

function cityRoadColorStops(
  minZoom: number,
  cityColor: ColorValue,
  detailedColor: ColorValue,
): ColorStops {
  return [
    [minZoom, cityColor],
    [detailedRoadTransitionStartZoom, cityColor],
    [detailedRoadZoom, detailedColor],
    [22, detailedColor],
  ];
}

const roadBorderZoom = detailedRoadZoom;
// Circle casings express the total diameter delta, so 1 px leaves a subtle
// 0.5 px edge on either side of the carriageway at detailed zooms.
const roadBorderTotalWidth = 1;
const roadWidthInterpolationBase = 1.5;
const roadSurfaceColor = mapboxRoadPalette.road;
const roadCasingColor = mapboxRoadPalette.roadCasing;
const primaryRoadSurfaceColor = mapboxRoadPalette.road;
const secondaryRoadSurfaceColor = mapboxRoadPalette.road;
const tertiaryRoadSurfaceColor = mapboxRoadPalette.road;
const buildingFillColor = mapboxBuildingPalette.fill;
const buildingOutlineColor = mapboxBuildingPalette.outline;
const buildingColors = {
  active: buildingFillColor,
  civic: buildingFillColor,
  commercial: buildingFillColor,
  destination: buildingFillColor,
  generic: buildingFillColor,
  industrial: buildingFillColor,
  residential: buildingFillColor,
} as const;
const building3dColor = streetsVisual.building.extrusion;
const building3dShadowColor = streetsVisual.building.shadow;
const visibleBuilding3dFilter = [
  'all',
  ['!=', ['get', semanticField('hide3d')], true],
  ['!=', ['get', semanticField('hide3d')], 1],
  ['!=', ['get', semanticField('hide3d')], '1'],
  // A parent with parts is only an association footprint. Drawing
  // it as a solid extrusion buries the richer building:part volumes.
  ['!=', ['get', semanticField('hasParts')], true],
  ['!=', ['get', semanticField('hasParts')], 1],
  ['!=', ['get', semanticField('hasParts')], '1'],
];
const building3dHeight = [
  'max',
  0,
  ['to-number', ['coalesce', ['get', semanticField('renderHeight')], 5], 5],
];
const building3dBase = [
  'max',
  0,
  [
    'min',
    ['to-number', ['coalesce', ['get', semanticField('renderMinHeight')], 0], 0],
    building3dHeight,
  ],
];
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
const roadClearanceExtraAtZ15 = [
  'to-number',
  ['coalesce', ['get', semanticField('circularClearanceExtraAtZoom15')], 0],
  0,
];
// Round caps overlap ordinary feature endpoints just enough to hide the
// antialiasing seam between adjacent road segments. Tunnels and steps must not
// extend beyond their structural endpoints, and at detailed zooms approaches
// with precomputed circular clearance must still meet procedural roundabouts
// without creating a lobe inside the ring.
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
const circularRoadRadius = circularRoadInnerRadius(false);
const circularRoadCasingRadius = circularRoadInnerRadius(true);
const circularRoadWidth = circularRoadStrokeWidth(false);
const circularRoadCasingWidth = circularRoadStrokeWidth(true);
const expresswayWidthScale = 1.06;
const tunnelBorderDash = [3, 3] as const;
const tunnelBorderWidth = 1;
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

function roadWidth(
  widths: WidthStops,
  oneWayScale: number,
  casing = false,
  clearance = true,
  rampWidths?: WidthStops,
) {
  const augmentedWidths = [...widths];
  augmentedWidths.sort(([left], [right]) => left - right);
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
    // Keep the visible border below one physical pixel at ordinary city
    // zooms. A full 1 px stroke per side can cover a second pixel column on
    // curved or fractionally positioned lines and make one edge look doubled.
    [15, 0.75],
    [18, 1],
    [22, 1.5],
  ]);
}

const tunnelRoadCasingWidth = zoom.linear([
  [15, 0],
  [15.5, tunnelBorderWidth],
  [22, tunnelBorderWidth],
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

const mapboxPathWidthStops = [
  [12, 0],
  [18, 6],
  [22, 80],
] as const satisfies WidthStops;
// Google keeps unpaved park paths subordinate to the street network. At z16
// they read as a single 1 px green stroke instead of a small carriageway.
const googleParkPathWidthStops = [
  [12, 0],
  [15, 0.75],
  [16, 1],
  [18, 2],
  [22, 20],
] as const satisfies WidthStops;
const unpavedPathCondition = ['==', ['get', semanticField('surface')], 'unpaved'] as const;
// Paved footways keep the same compact hierarchy but need enough carriageway
// to retain their Mapbox-like casing. Use an explicit stop at every integer
// zoom in the close-view range: the reference width is almost geometric from
// z16 through z19, while z20 grows slightly less than another full doubling.
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
const contextualPathColor = [
  'interpolate',
  ['linear'],
  ['zoom'],
  15,
  ['case', unpavedPathCondition, streetsDetailPalette.parkPath, mapboxRoadPalette.pathAtZ15],
  16,
  ['case', unpavedPathCondition, streetsDetailPalette.parkPath, mapboxRoadPalette.pathFromZ16],
] as const;
const contextualPathCasingColor = [
  'case',
  unpavedPathCondition,
  streetsDetailPalette.parkPath,
  mapboxRoadPalette.pathCasing,
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
const googleParkPathClasses = ['pathway', 'footway', 'steps', 'pedestrian'] as const;

function googleParkPathOverrides() {
  return googleParkPathClasses.flatMap((roadClass) =>
    (['surface', 'bridge'] as const).flatMap((structure) => [
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.fill`, {
        paint: {
          'line-color': roadClass === 'steps' ? mapboxRoadPalette.pathFromZ16 : contextualPathColor,
          ...(roadClass === 'steps' ? {'line-dasharray': [0.18, 0.15]} : {}),
          'line-width': contextualPathLineWidth,
        },
      }),
      patchModuleLayer('roads', `roads.classes.${roadClass}.${structure}.casing`, {
        paint: {
          'line-color': contextualPathCasingColor,
          'line-gap-width': roadClass === 'steps' ? 0 : contextualPathLineWidth,
          'line-width': roadClass === 'steps' ? contextualPathLineWidth : contextualPathCasingWidth,
        },
      }),
    ]),
  );
}
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

function roadCasingColorStops(explicitStops: ColorStops | undefined): ColorStops {
  if (explicitStops) return explicitStops;
  return [
    [roadBorderZoom, mapboxRoadPalette.roadCasing],
    [22, mapboxRoadPalette.roadCasing],
  ];
}

function cityRoadStyle(
  color: ColorValue,
  widths: WidthStops,
  options: {
    casingColorStops?: ColorStops;
    casingMinZoom?: number;
    clearance?: boolean;
    colorStops?: ColorStops;
    minZoom?: number;
    oneWayScale?: number;
    rampWidths?: WidthStops;
    tunnelCasingColor?: ColorValue;
    tunnelColor?: ColorValue;
    tunnelVisible?: boolean;
  } = {},
): TileflowRoadClassStyle {
  const {
    casingColorStops,
    casingMinZoom = roadBorderZoom,
    clearance = true,
    colorStops,
    minZoom,
    oneWayScale = 1,
    rampWidths,
    tunnelCasingColor = streetsDetailPalette.roadTunnelBorder,
    tunnelColor = streetsDetailPalette.roadTunnel,
    tunnelVisible = true,
  } = options;
  // Country zooms keep only the main hierarchy on screen; each class joins at
  // its own minZoom so low zooms stay as simple as the reference maps.
  const zoomRange = minZoom === undefined ? {} : {minZoom};
  const opacity = zoom.linear([
    [3, 0],
    [3.5, 1],
  ]);
  const surfaceColor = colorStops ? zoom.linear(colorStops) : color;
  const resolvedCasingColor = zoom.linear(roadCasingColorStops(casingColorStops));
  const fill = {
    ...zoomRange,
    cap: roadLineCap,
    color: surfaceColor,
    join: roadLineJoin,
    opacity,
    width: roadWidth(widths, oneWayScale, false, clearance, rampWidths),
  };
  const casing = {
    ...zoomRange,
    // The layer itself starts at the border threshold, so the width expression
    // needs no second zoom-based step (MapLibre permits only one per expression).
    minZoom: Math.max(minZoom ?? 0, casingMinZoom),
    cap: roadLineCap,
    // Border reads as a subtle shade of the road itself rather than a white halo.
    color: resolvedCasingColor,
    gapWidth: fill.width,
    join: roadLineJoin,
    opacity,
    width: roadCasingStrokeWidth(),
  };

  return {
    surface: {casing, fill},
    bridge: {casing, fill},
    tunnel: tunnelVisible
      ? {
          casing: {
            ...casing,
            cap: roadLineCap,
            color: tunnelCasingColor,
            dash: tunnelBorderDash,
            gapWidth: roadWidth(widths, oneWayScale, false, clearance, rampWidths),
            opacity: 1,
            width: tunnelRoadCasingWidth,
          },
          fill: {
            ...fill,
            cap: roadLineCap,
            color: tunnelColor,
            opacity: zoom.linear([
              [3, 0],
              [3.5, 0.8],
            ]),
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
  color: ColorValue,
  widths: WidthStops,
  options: {
    casingColor?: ColorValue;
    casingGapWidth?: TileflowLineStyle['gapWidth'];
    casingMinZoom?: number;
    casingWidth?: TileflowLineStyle['width'];
    colorStops?: ColorStops;
    dash?: TileflowLineStyle['dash'];
    fillOpacity?: TileflowLineStyle['opacity'];
    minZoom?: number;
    steps?: boolean;
    underlay?: TileflowLineStyle;
    width?: TileflowLineStyle['width'];
  } = {},
): TileflowRoadClassStyle {
  const zoomRange = options.minZoom === undefined ? {} : {minZoom: options.minZoom};
  const surfaceColor = options.colorStops ? zoom.linear(options.colorStops) : color;
  const cap = options.steps ? ('butt' as const) : pathLineCap;
  const tunnelCap = 'butt' as const;
  const join = options.steps ? ('round' as const) : pathLineJoin;
  const fillWidth = options.width ?? roadWidth(widths, 1, false, false);
  const fill = {
    ...zoomRange,
    cap,
    color: surfaceColor,
    ...(options.dash ? {dash: options.dash} : {}),
    join,
    opacity: options.fillOpacity ?? 1,
    width: fillWidth,
  };
  const casing = {
    ...zoomRange,
    minZoom: Math.max(options.minZoom ?? 0, options.casingMinZoom ?? roadBorderZoom),
    cap,
    color: options.casingColor ?? mapboxRoadPalette.pathCasing,
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
        color: mapboxRoadPalette.pathCasing,
        dash: tunnelBorderDash,
        gapWidth: fill.width,
        opacity: 1,
        width: pathTunnelCasingWidth,
      },
      fill: {
        ...fill,
        cap: tunnelCap,
        color: mapboxRoadPalette.pathTunnel,
        dash: [1, 0],
        opacity: 1,
      },
      hatch: {visible: false},
    },
  };
}

type RoadLabelKind = 'major' | 'path' | 'pedestrian' | 'street';

function roadLabelStyle(kind: RoadLabelKind): TileflowSymbolStyle {
  const major = kind === 'major';
  const pedestrian = kind === 'pedestrian';
  const path = kind === 'path';
  const startSize = major ? 9 : pedestrian ? 9 : path ? 6.5 : 8;
  const endSize = major ? 16 : pedestrian ? 14 : path ? 13 : 14;

  return {
    placement: 'line',
    priority: major ? 90 : 50,
    spacing: 250,
    text: {
      color: streetsVisual.label.road,
      font: streetsVisual.font.default,
      haloColor: streetsDetailPalette.halo,
      haloWidth: 1,
      letterSpacing: path || pedestrian ? 0.01 : 0.15,
      maxAngle: 30,
      padding: 1,
      size: zoom.linear([
        [10, startSize],
        [18, endSize],
      ]),
      transform: 'uppercase',
    },
  };
}

export const streets = bindOfficialMapTheme(
  defineRootMap({
    id: 'streets',
    version: 1,
    name: 'Streets',
    root: {compiler: 'streets', compilerVersion: 1},
    glyphs: {
      kind: 'url',
      url: 'https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    },
    themes: streetsThemes,
    defaultTheme: 'light',
    systemThemes: {light: 'light', dark: 'dark'},
    projection: 'globe', // 'globe' | 'mercator'. Globe becomes planar at street zooms.
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    icons: [streetsIcons],
    // The development terrain archive currently returns uncached tiles in the reviewed cities.
    // Keep it disabled until that archive is complete so navigation does not wait on failed DEM requests.
    terrain: 'none',
    modules: {
      // Optional keys: addresses, aeroways, boundaries, buildings, labels, land,
      // landforms, poi, roads, transit, vegetation, water. Object order never
      // controls layer order.
      // Streets deliberately omits parcel-level house numbers. POI and road/place
      // labels carry the useful navigation hierarchy without close-zoom numeric noise.
      addresses: addresses({enabled: false}),
      land: land({
        background: {
          color: streetsSurfacePalette.background,
          opacity: 1,
        },
        globalLandcover: {
          color: expression<string>([
            'match',
            ['get', semanticField('class')],
            'barren',
            streetsGlobalLandcoverPalette.barren,
            'crop',
            streetsGlobalLandcoverPalette.crop,
            'grass',
            streetsGlobalLandcoverPalette.grass,
            'shrub',
            streetsGlobalLandcoverPalette.shrub,
            'snow',
            streetsGlobalLandcoverPalette.snow,
            'trees',
            streetsGlobalLandcoverPalette.trees,
            'urban',
            streetsGlobalLandcoverPalette.urban,
            fixed('rgba(0, 0, 0, 0)', {reason: 'Transparent fallback for absent landcover'}),
          ]),
          // World V1 materializes this generalized underlay through native z10.
          // It remains a soft macro bridge while detailed OSM coverage takes
          // ownership; MapLibre maxzoom is exclusive, so it is gone at z11.
          maxZoom: 11,
          minZoom: 0,
          opacity: globalLandcoverOpacity,
        },
        landcover: {
          farmland: {
            fill: {
              color: streetsSurfacePalette.crop,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          flowerbed: {
            fill: {
              color: streetsSurfacePalette.flowerbed,
              minZoom: 12,
              opacity: detailedUrbanGreenOpacity,
            },
          },
          grass: {
            fill: {
              color: streetsSurfacePalette.meadow,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          ice: {
            fill: {
              color: streetsSurfacePalette.ice,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          meadow: {
            fill: {
              color: streetsSurfacePalette.meadow,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          protected: {
            fill: {
              color: streetsSurfacePalette.protected,
              minZoom: 7,
              opacity: protectedAreaOpacity,
            },
          },
          recreationGround: {
            fill: {
              color: streetsSurfacePalette.recreationGround,
              minZoom: 8,
              opacity: detailedUrbanGreenOpacity,
            },
          },
          rock: {
            fill: {
              color: streetsSurfacePalette.rock,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          sand: {
            fill: {
              color: streetsSurfacePalette.sand,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          scrub: {
            fill: {
              color: streetsSurfacePalette.scrub,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          urbanPark: {
            fill: {
              color: streetsSurfacePalette.urbanPark,
              minZoom: 8,
              opacity: detailedUrbanGreenOpacity,
            },
          },
          villageGreen: {
            fill: {
              color: streetsSurfacePalette.villageGreen,
              minZoom: 10,
              opacity: detailedUrbanGreenOpacity,
            },
          },
          wetland: {
            fill: {
              color: streetsSurfacePalette.wetland,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
          wood: {
            fill: {
              color: streetsSurfacePalette.wood,
              minZoom: 7,
              opacity: detailedLandcoverOpacity,
            },
          },
        },
        landuse: {
          cemetery: {fill: {color: streetsSurfacePalette.cemetery, opacity: 1}},
          civic: {fill: {color: streetsSurfacePalette.civic, opacity: 1}},
          commercial: {
            // The producer emits reviewed, road-bounded commercial ground as
            // landuse.class=business_area. An explicit layer below excludes
            // broad OSM commercial/retail zoning and places that ground above
            // an overlapping residential polygon.
            fill: {visible: false},
          },
          // Mapbox keeps schools in its warm education tier rather than
          // treating them as generic greenspace.
          education: {fill: {color: streetsSurfacePalette.education, opacity: 1}},
          government: {fill: {color: streetsSurfacePalette.government, opacity: 1}},
          industrial: {fill: {color: streetsSurfacePalette.industrial, opacity: 1}},
          medical: {fill: {color: streetsSurfacePalette.medical, opacity: 1}},
          parking: {
            fill: {color: streetsSurfacePalette.parking, minZoom: 15, opacity: 0.9},
            outline: {
              color: streetsSurfacePalette.parkingOutline,
              minZoom: 16,
              opacity: 0.5,
              width: 0.5,
            },
          },
          railway: {fill: {color: streetsSurfacePalette.railway, opacity: 1}},
          recreation: {
            fill: {
              color: streetsSurfacePalette.recreation,
              minZoom: 8,
              opacity: detailedUrbanGreenOpacity,
            },
            outline: {
              color: streetsSurfacePalette.recreationOutline,
              minZoom: 15,
              opacity: 0.65,
              width: 0.5,
            },
          },
          residential: {fill: {color: streetsSurfacePalette.residential, opacity: 1}},
        },
      }),
      water: water({
        bathymetry: {
          antialias: false,
          color: expression<string>([
            'interpolate',
            ['linear'],
            ['*', -1, ['to-number', ['get', semanticField('bathymetryMinDepth')], 0]],
            0,
            streetsSurfacePalette.waterDepth0,
            200,
            streetsSurfacePalette.waterDepth200,
            2000,
            streetsSurfacePalette.waterDepth2000,
            7000,
            streetsSurfacePalette.waterDepth7000,
          ]),
          maxZoom: 8,
          minZoom: 0,
          opacity: zoom.linear([
            [0, 1],
            [6, 1],
            [8, 0],
          ]),
        },
        bodies: {
          fill: {
            color: expression<string>([
              'match',
              ['get', semanticField('class')],
              ['ocean', 'sea'],
              streetsSurfacePalette.waterOcean,
              streetsSurfacePalette.water,
            ]),
            opacity: 1,
          },
        },
        intermittent: {
          bodies: {fill: {color: streetsSurfacePalette.water, opacity: 1}},
          // Casa de Campo's named streams are mostly tagged intermittent.
          // A continuous, nearly opaque stroke keeps the real source geometry
          // legible over woodland without inventing a permanent water body.
          waterways: {
            color: streetsSurfacePalette.water,
            dash: [1, 0],
            opacity: 0.9,
          },
        },
        waterways: {
          canal: {
            cap: 'round',
            color: streetsSurfacePalette.water,
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
            color: streetsSurfacePalette.water,
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
            color: streetsSurfacePalette.water,
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
            color: streetsSurfacePalette.water,
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
      vegetation: vegetation({
        flat: {
          color: streetsDetailPalette.greenspaceDark,
          minZoom: 16,
          opacity: 0.82,
          pitchAlignment: 'map',
          pitchScale: 'map',
          radius: zoom.linear([
            [16, 2.2],
            [20, 8],
          ]),
          strokeColor: streetsDetailPalette.greenspace,
          strokeOpacity: 0.55,
          strokeWidth: 0.8,
        },
        mode: '3d',
        threeDimensional: {
          barkColor: streetsVisual.tree.bark,
          broadleafColors: streetsVisual.tree.broadleaf,
          coniferColors: streetsVisual.tree.conifer,
          crownScale: 1,
          heightScale: 1,
        },
      }),
      boundaries: boundaries({
        // Mapbox Standard's admin-0/admin-1 layers map to OpenMapTiles
        // admin_level 2/4 respectively.
        admin2: {
          color: streetsOverviewPalette.admin0,
          dash: [10, 0],
          minZoom: 1,
          opacity: 1,
          width: zoom.linear([
            [3, 0.5],
            [12, 2],
          ]),
        },
        admin4: {
          color: streetsOverviewPalette.admin1,
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
          color: streetsOverviewPalette.admin0,
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
      roads: roads({
        detail: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
        hierarchy: 'clear', // 'subtle' | 'clear' | 'strong'.
        outline: 'strong', // 'none' | 'subtle' | 'strong'.
        weight: 'regular', // 'thin' | 'regular' | 'bold'.
        oneWayMarkers: true, // true | false.
        extras: {
          paths: true, // true | false.
        },
        crossings: {
          image: streetsVisual.image.crosswalk,
          minZoom: 15,
          opacity: zoom.linear([
            [15, 0],
            [15.5, 1],
          ]),
        },
        roundabouts: {
          casing: {
            color: fixed('rgba(0, 0, 0, 0)', {reason: 'Invisible circular-road underlay'}),
            minZoom: 15,
            pitchAlignment: 'map',
            pitchScale: 'map',
            radius: expression<number>(circularRoadCasingRadius),
            strokeColor: roadCasingColor,
            strokeWidth: expression<number>(circularRoadCasingWidth),
          },
          fill: {
            color: fixed('rgba(0, 0, 0, 0)', {reason: 'Invisible circular-road underlay'}),
            minZoom: 15,
            pitchAlignment: 'map',
            pitchScale: 'map',
            radius: expression<number>(circularRoadRadius),
            strokeColor: roadSurfaceColor,
            strokeWidth: expression<number>(circularRoadWidth),
          },
        },
        sidewalks: {
          pattern: {
            minZoom: 17,
            opacity: 0.62,
            pattern: streetsVisual.image.sidewalkPattern,
          },
          surface: {
            color: streetsDetailPalette.roadCasing,
            minZoom: 17,
            opacity: 0.96,
          },
        },
        modifiers: {
          // Optional keys: construction, expressway, indoor, official, ramp, unpaved.
          // Treatments accept enabled, widthScale, surface, tunnel, and bridge;
          // phases accept color, opacity, dash, blur, gapWidth, offset, and width.
          construction: {
            surface: {
              casing: {
                color: mapboxRoadPalette.roadCasing,
                dash: [1.5, 1],
                opacity: 0.9,
              },
              fill: {
                color: mapboxRoadPalette.road,
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
            // Exact per-class link curves are authored directly into the
            // class widths above; disable the recipe's proportional scale.
            enabled: false,
          },
          unpaved: {
            surface: {
              // A continuous earth tone reads as a footpath without the
              // bead-like texture produced by short round dashes.
              casing: {
                color: mapboxRoadPalette.roadCasing,
                dash: [1, 0],
                opacity: 0.9,
              },
              fill: {
                color: mapboxRoadPalette.road,
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
                color: mapboxRoadPalette.roadCasing,
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
          alley: {enabled: false},
          crossover: {enabled: false},
          driveway: {enabled: false},
          parkingAisle: {enabled: false},
          yard: {enabled: false},
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
            mapboxRoadPalette.motorway,
            [
              [3, 0.8],
              [12, 3.2],
              [18, 30],
              [22, 300],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.motorwayCasing],
                [22, mapboxRoadPalette.motorwayCasing],
              ],
              colorStops: [
                [3, mapboxRoadPalette.motorway],
                [22, mapboxRoadPalette.motorway],
              ],
              minZoom: 3,
              rampWidths: mapboxMajorRampWidthStops,
              tunnelCasingColor: mapboxRoadPalette.motorwayCasing,
              tunnelColor: mapboxRoadPalette.motorwayTunnel,
            },
          ),
          trunk: cityRoadStyle(
            mapboxRoadPalette.trunk,
            [
              [3, 0.8],
              [12, 3.2],
              [18, 30],
              [22, 300],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.trunkCasing],
                [22, mapboxRoadPalette.trunkCasing],
              ],
              colorStops: [
                [3, mapboxRoadPalette.trunk],
                [22, mapboxRoadPalette.trunk],
              ],
              minZoom: 3,
              rampWidths: mapboxMajorRampWidthStops,
              tunnelCasingColor: mapboxRoadPalette.trunkCasing,
              tunnelColor: mapboxRoadPalette.trunkTunnel,
            },
          ),
          primary: cityRoadStyle(
            primaryRoadSurfaceColor,
            [
              [3, 0.8],
              [12, 3],
              [18, 28],
              [22, 280],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              colorStops: cityRoadColorStops(
                6,
                streetsCityRoadPalette.primary,
                primaryRoadSurfaceColor,
              ),
              minZoom: 6,
              rampWidths: mapboxArterialRampWidthStops,
              tunnelCasingColor: mapboxRoadPalette.roadCasing,
              tunnelColor: mapboxRoadPalette.roadTunnel,
            },
          ),
          secondary: cityRoadStyle(
            secondaryRoadSurfaceColor,
            [
              [3, 0],
              [12, 2.2],
              [18, 26],
              [22, 260],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              colorStops: cityRoadColorStops(
                8,
                streetsCityRoadPalette.secondary,
                secondaryRoadSurfaceColor,
              ),
              minZoom: 8,
              rampWidths: mapboxArterialRampWidthStops,
              tunnelCasingColor: mapboxRoadPalette.roadCasing,
              tunnelColor: mapboxRoadPalette.roadTunnel,
            },
          ),
          tertiary: cityRoadStyle(
            tertiaryRoadSurfaceColor,
            [
              [3, 0],
              [12, 2.2],
              [18, 26],
              [22, 260],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              colorStops: cityRoadColorStops(
                8,
                streetsCityRoadPalette.tertiary,
                tertiaryRoadSurfaceColor,
              ),
              minZoom: 8,
              rampWidths: mapboxArterialRampWidthStops,
              tunnelCasingColor: mapboxRoadPalette.roadCasing,
              tunnelColor: mapboxRoadPalette.roadTunnel,
            },
          ),
          minor: cityRoadStyle(
            roadSurfaceColor,
            [
              [3, 0],
              [12, 0.5],
              [18, 20],
              [22, 200],
            ],
            {
              clearance: false,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              colorStops: cityRoadColorStops(12, streetsCityRoadPalette.minor, roadSurfaceColor),
              minZoom: 12,
              tunnelCasingColor: mapboxRoadPalette.roadCasing,
              tunnelColor: mapboxRoadPalette.roadTunnel,
            },
          ),
          service: cityRoadStyle(
            roadSurfaceColor,
            [
              [3, 0],
              [12, 0],
              [14, 0],
              [15, 2.2],
              [18, 10],
              [22, 100],
            ],
            {
              casingMinZoom: 15,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              clearance: false,
              colorStops: [
                [15, roadSurfaceColor],
                [22, roadSurfaceColor],
              ],
              minZoom: 14,
              tunnelVisible: false,
            },
          ),
          track: cityRoadStyle(
            mapboxRoadPalette.road,
            [
              [3, 0],
              [12, 0],
              [14, 0],
              [15, 2.2],
              [18, 10],
              [22, 100],
            ],
            {
              casingMinZoom: 15,
              casingColorStops: [
                [15, mapboxRoadPalette.roadCasing],
                [22, mapboxRoadPalette.roadCasing],
              ],
              clearance: false,
              colorStops: [
                [15, mapboxRoadPalette.road],
                [22, mapboxRoadPalette.road],
              ],
              minZoom: 14,
              tunnelCasingColor: mapboxRoadPalette.roadCasing,
              tunnelColor: mapboxRoadPalette.roadTunnel,
            },
          ),
          pathway: pathRoadStyle(streetsDetailPalette.parkPath, googleParkPathWidthStops, {
            casingColor: streetsDetailPalette.parkPath,
            casingWidth: 0,
            minZoom: 12,
          }),
          footway: pathRoadStyle(streetsDetailPalette.parkPath, googleParkPathWidthStops, {
            casingColor: streetsDetailPalette.parkPath,
            casingWidth: 0,
            minZoom: 12,
          }),
          cycleway: pathRoadStyle(mapboxRoadPalette.cycleway, mapboxPathWidthStops, {
            casingColor: mapboxRoadPalette.pathCasing,
            casingGapWidth: roadWidth(mapboxPathWidthStops, 1, false, false),
            fillOpacity: zoom.linear([
              [15, 0],
              [16, 1],
            ]),
            minZoom: 15,
            underlay: {
              cap: pathLineCap,
              color: zoom.linear([
                [15, mapboxRoadPalette.pathAtZ15],
                [16, mapboxRoadPalette.pathFromZ16],
              ]),
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
          steps: pathRoadStyle(streetsDetailPalette.parkPath, googleParkPathWidthStops, {
            casingMinZoom: 14,
            casingColor: streetsDetailPalette.parkPath,
            casingWidth: 0,
            // World V1 overzooms its native z15 tile above street level.
            // Keep this literal: a zoom-dependent dash is evaluated at the
            // source tile zoom and would remain a continuous line at z16+.
            // The final layer override above also keeps road treatments from
            // replacing the stair pattern with a continuous path.
            dash: [0.18, 0.15],
            minZoom: 14,
            steps: true,
          }),
          pedestrian: pathRoadStyle(streetsDetailPalette.parkPath, googleParkPathWidthStops, {
            casingMinZoom: 14,
            casingColor: streetsDetailPalette.parkPath,
            casingWidth: 0,
            minZoom: 12,
          }),
        },
      }),
      transit: transit(mapboxRailTransitStyle(mapboxRailColor)),
      buildings: buildings({
        mode: 'flat', // 'flat' | '3d'.
        businessCorridor: {
          // This compatibility layer contains selected building footprints,
          // not ground. Streets renders the derived business_area class through
          // landuse instead.
          fill: {visible: false},
          outline: {visible: false},
        },
        flat: {
          fill: {color: buildingFillColor, minZoom: 15, opacity: 1},
          outline: {
            color: buildingOutlineColor,
            minZoom: 15,
            opacity: zoom.linear([
              [15, 0.48],
              [16, 0.7],
              [17, 0.86],
              [20, 0.94],
            ]),
            width: zoom.linear([
              [15, 0.45],
              [16, 0.65],
              [17, 0.85],
              [20, 1],
            ]),
          },
        },
      }),
      labels: labels({
        enabled: true,
        language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
        places: 'all', // 'none' | 'major' | 'all'.
        roads: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
        shields: 'major', // 'none' | 'major' | 'all'.
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
                color: streetsOverviewPalette.label,
                haloColor: streetsDetailPalette.halo,
                haloWidth: 1.5,
                letterSpacing: 0.05,
                lineHeight: 1.1,
                maxWidth: 6,
                opacity: zoom.linear([
                  [0, 0.8],
                  [1.5, 0.5],
                  [2.5, 0.5],
                ]),
                size: zoom.exponential(0.5, [
                  [0, 10],
                  [2.5, 15],
                ]),
                transform: 'uppercase',
              },
            },
            country: {
              minZoom: 1,
              maxZoom: 10,
              priority: 95,
              text: {
                color: streetsOverviewPalette.label,
                haloColor: streetsDetailPalette.halo,
                haloWidth: 1.25,
                lineHeight: 1.1,
                maxWidth: 6,
                padding: 3,
                radialOffset: zoom.step([
                  [1, 0.6],
                  [8, 0],
                ]),
                size: expression<number>([
                  'interpolate',
                  ['cubic-bezier', 0.2, 0, 0.7, 1],
                  ['zoom'],
                  1,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 11, 4, 9, 5, 8],
                  9,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 22, 4, 19, 5, 17],
                ]),
                variableAnchors: ['left', 'right', 'top', 'bottom'],
              },
            },
            state: {
              minZoom: 3,
              maxZoom: 9,
              priority: 86,
              text: {
                color: streetsOverviewPalette.label,
                haloColor: streetsDetailPalette.halo,
                haloWidth: 1,
                letterSpacing: 0.15,
                maxWidth: 6,
                opacity: 0.5,
                size: expression<number>([
                  'interpolate',
                  ['cubic-bezier', 0.85, 0.7, 0.65, 1],
                  ['zoom'],
                  4,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 9, 6, 8, 7, 7],
                  9,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 21, 6, 16, 7, 14],
                ]),
                transform: 'uppercase',
              },
            },
            city: {
              minZoom: 2,
              maxZoom: 15,
              priority: expression<number>([
                '-',
                100,
                ['coalesce', ['get', semanticField('rank')], 20],
              ]),
              text: {
                color: zoom.linear([
                  [2, streetsOverviewPalette.label],
                  [4, streetsOverviewPalette.label],
                  [6, streetsVisual.label.settlement],
                ]),
                haloColor: streetsDetailPalette.halo,
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
                  ['cubic-bezier', 0.2, 0, 0.9, 1],
                  ['zoom'],
                  3,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 13, 6, 11],
                  6,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 18, 6, 16, 7, 14],
                  8,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 20, 9, 16, 10, 14],
                  15,
                  [
                    'step',
                    ['coalesce', ['get', semanticField('rank')], 99],
                    24,
                    9,
                    20,
                    12,
                    16,
                    15,
                    14,
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
              },
            },
            town: {
              minZoom: 2,
              maxZoom: 13,
              priority: expression<number>([
                '-',
                80,
                ['coalesce', ['get', semanticField('rank')], 20],
              ]),
              text: {
                color: streetsVisual.label.settlement,
                haloColor: streetsDetailPalette.halo,
                haloBlur: 1,
                haloWidth: 1,
                lineHeight: 1.1,
                maxWidth: 7,
                padding: 1,
                radialOffset: zoom.step([
                  [2, 0.55],
                  [8, 0],
                ]),
                size: expression<number>([
                  'interpolate',
                  ['cubic-bezier', 0.2, 0, 0.9, 1],
                  ['zoom'],
                  3,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 11, 9, 10],
                  6,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 14, 9, 12, 12, 10],
                  8,
                  [
                    'step',
                    ['coalesce', ['get', semanticField('rank')], 99],
                    16,
                    9,
                    14,
                    12,
                    12,
                    15,
                    10,
                  ],
                  13,
                  [
                    'step',
                    ['coalesce', ['get', semanticField('rank')], 99],
                    22,
                    9,
                    20,
                    12,
                    16,
                    15,
                    14,
                  ],
                ]),
                font: streetsVisual.font.default,
              },
            },
            village: {
              minZoom: 2,
              maxZoom: 13,
              priority: expression<number>([
                '-',
                65,
                ['coalesce', ['get', semanticField('rank')], 20],
              ]),
              text: {
                color: streetsVisual.label.settlement,
                haloColor: streetsDetailPalette.halo,
                haloBlur: 1,
                haloWidth: 1,
                lineHeight: 1.1,
                maxWidth: 7,
                padding: 1,
                radialOffset: zoom.step([
                  [2, 0.55],
                  [8, 0],
                ]),
                size: expression<number>([
                  'interpolate',
                  ['cubic-bezier', 0.2, 0, 0.9, 1],
                  ['zoom'],
                  3,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 11, 9, 10],
                  6,
                  ['step', ['coalesce', ['get', semanticField('rank')], 99], 14, 9, 12, 12, 10],
                  8,
                  [
                    'step',
                    ['coalesce', ['get', semanticField('rank')], 99],
                    16,
                    9,
                    14,
                    12,
                    12,
                    15,
                    10,
                  ],
                  13,
                  [
                    'step',
                    ['coalesce', ['get', semanticField('rank')], 99],
                    22,
                    9,
                    20,
                    12,
                    16,
                    15,
                    14,
                  ],
                ]),
                font: streetsVisual.font.default,
              },
            },
            neighborhood: {
              minZoom: 10,
              maxZoom: 15,
              priority: 55,
              text: {
                color: streetsVisual.label.neighborhood,
                haloColor: streetsDetailPalette.halo,
                haloBlur: 0.5,
                haloWidth: 1.3,
                letterSpacing: expression<number>([
                  'match',
                  ['get', semanticField('class')],
                  'suburb',
                  0.15,
                  0.05,
                ]),
                maxWidth: 7,
                padding: 3,
                size: expression<number>([
                  'interpolate',
                  ['cubic-bezier', 0.5, 0, 1, 1],
                  ['zoom'],
                  11,
                  ['match', ['get', semanticField('class')], 'suburb', 12, 11.5],
                  15,
                  ['match', ['get', semanticField('class')], 'suburb', 16, 15],
                ]),
                transform: 'uppercase',
              },
            },
            other: {
              minZoom: 11,
              maxZoom: 15,
              priority: 40,
              text: {
                color: streetsVisual.label.neighborhood,
                haloColor: streetsDetailPalette.halo,
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
              color: streetsVisual.label.road,
              font: streetsVisual.font.default,
              haloColor: streetsDetailPalette.halo,
              haloWidth: 2,
              size: 10,
            },
          },
          roads: {
            motorway: {...roadLabelStyle('major'), minZoom: 10},
            trunk: {...roadLabelStyle('major'), minZoom: 10},
            primary: {...roadLabelStyle('major'), minZoom: 12},
            secondary: {...roadLabelStyle('major'), minZoom: 12},
            tertiary: {...roadLabelStyle('major'), minZoom: 13},
            minor: {...roadLabelStyle('street'), minZoom: 13},
            service: {...roadLabelStyle('street'), minZoom: 15},
            track: {...roadLabelStyle('path'), visible: false},
            pathway: {...roadLabelStyle('path'), minZoom: 15},
            footway: {...roadLabelStyle('path'), minZoom: 15},
            cycleway: {...roadLabelStyle('path'), minZoom: 15},
            steps: {...roadLabelStyle('path'), minZoom: 15},
            pedestrian: {...roadLabelStyle('pedestrian'), minZoom: 12},
          },
          shields: {
            default: {
              minZoom: 6,
              icon: {
                image: streetsVisual.image.shieldRectangleNeutral,
                keepUpright: true,
                optional: false,
                padding: 2,
                pitchAlignment: 'viewport',
                rotationAlignment: 'viewport',
                textFit: 'width',
                textFitPadding: [0, 4, 0, 4],
              },
              text: {
                color: streetsVisual.label.shieldDark,
                font: streetsVisual.font.places,
                haloWidth: 0,
                letterSpacing: 0.05,
                maxAngle: 38,
                optional: false,
                padding: 2,
                pitchAlignment: 'viewport',
                rotationAlignment: 'viewport',
                size: 9,
              },
            },
            overview: {
              // Low-zoom candidates are pre-deduplicated point features by the World producer.
              minZoom: 6,
            },
            detail: {
              // Core switches to line placement at street scale while retaining viewport
              // alignment, so each route reference remains horizontal during navigation.
              spacing: zoom.linear([
                [11, 400],
                [14, 600],
              ]),
            },
            kinds: {
              default: {image: streetsVisual.image.shieldRectangleNeutral},
              'rectangle-neutral': {image: streetsVisual.image.shieldRectangleNeutral},
              'rectangle-blue': {image: streetsVisual.image.shieldRectangleBlue},
              'rectangle-green': {image: streetsVisual.image.shieldRectangleGreen},
              'rectangle-red': {image: streetsVisual.image.shieldRectangleRed},
              'rectangle-orange': {image: streetsVisual.image.shieldRectangleOrange},
              'rectangle-yellow': {image: streetsVisual.image.shieldRectangleYellow},
              'circle-neutral': {image: streetsVisual.image.shieldCircleNeutral},
            },
            textColors: {
              light: {color: streetsVisual.label.shieldLight},
              dark: {color: streetsVisual.label.shieldDark},
            },
          },
          water: {
            ocean: {
              minZoom: 1,
              priority: 70,
              text: {
                color: streetsDetailPalette.waterText,
                haloColor: streetsVisual.label.waterHalo,
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
                color: streetsDetailPalette.waterText,
                haloColor: streetsVisual.label.waterHalo,
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
                color: streetsDetailPalette.waterText,
                haloColor: streetsVisual.label.waterHalo,
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
                color: streetsDetailPalette.waterText,
                haloColor: streetsVisual.label.waterHalo,
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
              color: streetsDetailPalette.transit,
              haloColor: streetsDetailPalette.halo,
              haloWidth: 1,
              letterSpacing: 0.01,
              lineHeight: 1.1,
              maxWidth: 9,
              size: zoom.linear([
                [8, 12],
                [14, 15],
              ]),
            },
          },
        },
      }),
      poi: poi({
        enabled: true,
        // World owns POI taxonomy, zoom eligibility and density tiers. Streets
        // selects only the canonical categories and leaves final placement to
        // MapLibre collision handling.
        categories: [
          'visitor-amenity',
          'retail',
          'food-drink',
          'sport-leisure',
          'religion',
          'public-services',
          'education',
          'medical',
          'lodging',
          'arts-entertainment',
          'park-nature',
          'landmark',
          'transport',
        ],
        // Standard carries the POI category into both marker and label colour.
        // A uniform grey treatment suppresses a meaningful amount of chroma
        // and makes the whole light map read as if a pale overlay sat above it.
        color: 'category',
        density: 3,
        icons: true,
        labels: true,
        placement: {
          // One collision unit: the circular icon is required while its name is
          // optional and may move around the marker when space is tight.
          coupleIconAndLabel: true,
          iconPadding: 2,
          textPadding: 3,
        },
      }),
    },
    ...defineModuleEffects([
      // Standard places a broad white admin-0 halo below the coloured
      // national and regional strokes. It fades in between z3 and z4.
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
            'line-color': streetsVisual.boundary.halo,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4, 0.5],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 8],
          },
        },
        {before: 'boundaries.admin4'},
      ),
      addModuleLayer(
        'land',
        'land.landuse.businessArea.fill',
        {
          id: 'streets-landuse-business-area',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('landuse'),
          minzoom: 11,
          filter: ['==', ['get', semanticField('class')], 'business_area'],
          paint: {
            'fill-color': streetsSurfacePalette.businessCorridor,
            'fill-opacity': 1,
          },
        },
        {after: 'land.landuse.residential.fill'},
      ),
      // Override only semantic pedestrian layers after road treatments have
      // been composed. This prevents unpaved/access styling from leaking the
      // blue road palette back into park paths while leaving every drivable
      // road class byte-for-byte unchanged.
      ...googleParkPathOverrides(),
      // Dense z15 footprints turn the translated passes into a black mesh.
      // Start the unchanged close-view shadow at z16, where it reads cleanly.
      addModuleLayer(
        'buildings',
        'buildings.effects.shadowSoft',
        {
          id: 'streets-buildings-3d-shadow-soft',
          type: 'line',
          source: 'tileflow',
          'source-layer': semanticLayer('building'),
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
        {before: 'buildings.flat.fill'},
      ),
      addModuleLayer(
        'buildings',
        'buildings.effects.shadowCore',
        {
          id: 'streets-buildings-3d-shadow-core',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('building'),
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
        {before: 'buildings.flat.fill'},
      ),
      // Keep the original subtle real extrusion below the authored shadow.
      addModuleLayer(
        'buildings',
        'buildings.effects.extrusion',
        {
          id: 'streets-buildings-3d',
          type: 'fill-extrusion',
          source: 'tileflow',
          'source-layer': semanticLayer('building'),
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
        {after: 'buildings.flat.outline'},
      ),
      // Mapbox Streets uses small settlement dots while the map is still at
      // country scale. They disappear at z8, when the labels become centred.
      addModuleLayer(
        'labels',
        'labels.places.settlementMarker',
        {
          id: 'streets-label-place-settlement-marker',
          type: 'circle',
          source: 'tileflow',
          'source-layer': semanticLayer('place'),
          minzoom: 2,
          maxzoom: 8,
          filter: [
            'all',
            ['has', semanticField('name')],
            ['==', ['get', semanticField('class')], 'city'],
            [
              'any',
              ['>', ['to-number', ['get', semanticField('capital')], 0], 0],
              [
                'step',
                ['zoom'],
                false,
                2,
                ['<=', ['to-number', ['get', semanticField('rank')], 99], 6],
                4,
                ['<=', ['to-number', ['get', semanticField('rank')], 99], 15],
                6,
                true,
              ],
            ],
          ],
          paint: {
            'circle-color': streetsVisual.label.settlement,
            'circle-radius': [
              'step',
              ['coalesce', ['get', semanticField('rank')], 99],
              3,
              3,
              2.5,
              7,
              2,
            ],
            'circle-stroke-color': streetsDetailPalette.halo,
            'circle-stroke-width': 0.8,
          },
        },
        {before: 'labels.places.city'},
      ),
      // The reference style delegates low-zoom country/state thinning to its
      // tiles. Tileflow World already generalises these layers, so avoid a
      // second SDK rank gate that hid otherwise valid labels.
      patchModuleLayer('labels', 'labels.places.country', {
        filter: [
          'all',
          ['has', semanticField('name')],
          ['==', ['get', semanticField('class')], 'country'],
        ],
      }),
      patchModuleLayer('labels', 'labels.places.state', {
        filter: [
          'all',
          ['has', semanticField('name')],
          [
            'match',
            ['get', semanticField('class')],
            ['state', 'province', 'aboriginal_lands'],
            true,
            false,
          ],
          [
            'step',
            ['zoom'],
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 1],
            7,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 2],
            8,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 4],
          ],
        ],
      }),
      // OpenMapTiles splits settlements into city/town/village classes while
      // Mapbox Standard partitions one settlement class into major and minor
      // ranks. Broaden the city gate progressively so the combined result has
      // the same density without applying Mapbox's complementary rank test to
      // a different source schema.
      patchModuleLayer('labels', 'labels.places.city', {
        filter: [
          'all',
          ['has', semanticField('name')],
          ['==', ['get', semanticField('class')], 'city'],
          [
            'any',
            ['>', ['to-number', ['get', semanticField('capital')], 0], 0],
            [
              'step',
              ['zoom'],
              false,
              2,
              ['<=', ['to-number', ['get', semanticField('rank')], 99], 6],
              4,
              ['<=', ['to-number', ['get', semanticField('rank')], 99], 15],
              6,
              true,
            ],
          ],
        ],
      }),
      patchModuleLayer('labels', 'labels.places.town', {
        filter: [
          'all',
          ['has', semanticField('name')],
          ['==', ['get', semanticField('class')], 'town'],
          [
            'step',
            ['zoom'],
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 7],
            4,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 12],
            6,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 15],
            8,
            true,
          ],
        ],
      }),
      patchModuleLayer('labels', 'labels.places.village', {
        filter: [
          'all',
          ['has', semanticField('name')],
          ['==', ['get', semanticField('class')], 'village'],
          [
            'step',
            ['zoom'],
            false,
            6,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 8],
            8,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 12],
            10,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 15],
            12,
            true,
          ],
        ],
      }),
      patchModuleLayer('labels', 'labels.places.neighborhood', {
        filter: [
          'all',
          ['has', semanticField('name')],
          [
            'match',
            ['get', semanticField('class')],
            ['suburb', 'neighbourhood', 'quarter', 'borough'],
            true,
            false,
          ],
          [
            'step',
            ['zoom'],
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 12],
            12,
            ['<=', ['to-number', ['get', semanticField('rank')], 99], 16],
            14,
            true,
          ],
        ],
      }),
      patchModuleLayer('roads', 'roads.oneWayMarkers', {
        minzoom: 15,
        layout: {
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-image': streetsVisual.image.oneway,
          'icon-keep-upright': false,
          'icon-padding': 0,
          'icon-pitch-alignment': 'map',
          'icon-rotate': ['case', ['==', ['get', semanticField('oneway')], -1], 180, 0],
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
          'text-field': ['case', ['==', ['get', semanticField('oneway')], -1], '←', '→'],
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
    ]),
    view: {
      center: [-3.69275, 40.40866],
      zoom: 14,
    },
  }),
);
