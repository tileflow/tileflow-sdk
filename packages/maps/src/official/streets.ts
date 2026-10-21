import {
  addresses,
  boundaries,
  buildings,
  defineMap,
  expr,
  field,
  fixed,
  labels,
  land,
  poi,
  refineRenderTarget,
  renderPass,
  roads,
  type TileflowDataExpressionInput,
  type TileflowLandModuleOptions,
  type TileflowLineCap,
  type TileflowLineJoin,
  type TileflowLineStyle,
  type TileflowPoiCategory,
  type TileflowPoiCategoryStyle,
  type TileflowRenderSelector,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  type TileflowThemeColorValue,
  token,
  transit,
  water,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {streetsIcons, streetsModels} from '../assets';
import {mapboxRailTransitStyle} from './mapbox-rail';
import {withStreetsConstruction} from './streets-construction';
import {streetsPoiImage} from './streets-poi';
import {streetsThemes, streetsVisual} from './streets-themes';
import {streetsTrees} from './streets-trees';
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
  detailCasing: streetsVisual.road.detailCasing,
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
  background: zoom.linear([
    [13, streetsVisual.surface.backgroundOverview],
    [14, streetsVisual.surface.background],
  ]),
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
  water: expr.interpolate<TileflowThemeColorValue>({kind: 'linear'}, expr.zoom(), [
    [5, streetsVisual.hydro.overview],
    [7, streetsVisual.hydro.regional],
    [13, streetsVisual.hydro.regional],
    [
      14,
      expr.match<string, TileflowThemeColorValue>(
        expr.get(field('class')),
        [{labels: ['ocean', 'sea'], value: streetsVisual.hydro.ocean}],
        streetsVisual.hydro.water,
      ),
    ],
  ]),
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
  [10, 1],
  [10.5, 0.55],
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
// The material already carries the reference's 50% alpha; do not multiply it by
// another translucent overlay at full visibility.
const protectedAreaOpacity = zoom.linear([
  [5, 0],
  [6, 1],
]);

// World size ranks are not Mapbox sizeranks: even small named parks can be
// size_rank=0. Reserve the 18 px tier for the producer's highest priorities,
// rather than enlarging every small green space in a city overview.
// Every category shares one placement layer, so only per-feature properties vary: the
// pictogram follows World's transport mode and type (streets-poi.ts) and transport keeps its
// fixed label size.
function streetsPoiStyle(category: TileflowPoiCategory): TileflowPoiCategoryStyle {
  const filterRank = expr.toNumber(expr.get(field('poiFilterRank')), 6);
  const sizeRank = expr.toNumber(expr.get(field('poiSizeRank')), 17);
  const featured = expr.all(expr.lte(filterRank, 0), expr.lt(sizeRank, 5));
  const featuredDetail = expr.all(expr.lte(filterRank, 1), expr.lt(sizeRank, 13));
  return {
    icon: {
      image: streetsPoiImage(),
      // Keep the authored 24px cell at native scale. Fractional resizing
      // softens the small pictogram strokes even with a correct 2x atlas.
      // The SVG itself fits the Maki artwork into a centered 12px box.
      size: 1,
    },
    text: {
      font: streetsVisual.font.default,
      haloWidth: 1,
      haloBlur: 0,
      letterSpacing: 0.01,
      lineHeight: 1.2,
      maxWidth: 9,
      anchor: 'top',
      offset: [0, 0.8],
      padding: zoom.linear([
        [16, 6],
        [17, 4],
      ]),
      size:
        category === 'transport'
          ? 13
          : expr.step(expr.zoom(), expr.case([{when: featured, value: 18}], 13), [
              [17, expr.case([{when: featuredDetail, value: 18}], 13)],
            ]),
    },
  };
}

// Match Standard's warm 2D footprints here; authored 3D extrusions keep their
// separate neutral palette. The light palette stores rendered day colours,
// rather than the raw Standard configuration roles, so footprints remain
// distinct from residential and commercial ground without relying on opacity.
const mapboxBuildingPalette = {
  fill: streetsVisual.building.fill,
  outline: streetsVisual.building.outline,
} as const;

// Keep city and detailed road roles independent so each theme can tune the
// z14-z15 transition without coupling to physical compiler layer IDs. Day uses
// the same slate-blue family across this handoff; widths carry the hierarchy.
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

type WidthStop = readonly [number, number];
type WidthStops = readonly [WidthStop, ...WidthStop[]];
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

function cityRoadCasingColorStops(minZoom: number): ColorStops {
  return cityRoadColorStops(
    minZoom,
    streetsDetailPalette.roadCasing,
    mapboxRoadPalette.detailCasing,
  );
}

// Standard's surface casings start at street detail; an overview casing
// overwhelms subpixel carriageways and turns the regional network into a mesh.
const roadBorderZoom = 15;
const roadBorderTotalWidth = 1;
const roadWidthInterpolationBase = 1.5;
const roadSurfaceColor = mapboxRoadPalette.road;
const roadCasingColor = mapboxRoadPalette.detailCasing;
const primaryRoadSurfaceColor = mapboxRoadPalette.road;
const secondaryRoadSurfaceColor = mapboxRoadPalette.road;
const tertiaryRoadSurfaceColor = mapboxRoadPalette.road;
const buildingFillColor = mapboxBuildingPalette.fill;
const buildingOutlineColor = mapboxBuildingPalette.outline;
const building3dColor = streetsVisual.building.extrusion;
const buildingShadowColor = streetsVisual.building.shadow;
const visibleBuilding3dSelector = {
  kind: 'all',
  selectors: [
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: true},
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: 1},
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: '1'},
  ],
} as const satisfies TileflowRenderSelector;
// Contact shading belongs only where a raised building meets the ground.
const groundedBuilding3dSelector = {
  kind: 'all',
  selectors: [
    visibleBuilding3dSelector,
    {
      field: 'renderMinHeight',
      coerce: 'number',
      fallback: 0,
      kind: 'compare',
      operator: 'lte',
      value: 0,
    },
    {
      kind: 'any',
      selectors: [
        {kind: 'not', selector: {kind: 'has', field: 'renderHeight'}},
        {
          field: 'renderHeight',
          coerce: 'number',
          fallback: 5,
          kind: 'compare',
          operator: 'gt',
          value: 0,
        },
      ],
    },
  ],
} as const satisfies TileflowRenderSelector;
const building3dHeight = expr.max(
  0,
  expr.toNumber(expr.coalesce(expr.get(field('renderHeight')), 5), 5),
);
const building3dBase = expr.max(
  0,
  expr.min(
    expr.toNumber(expr.coalesce(expr.get(field('renderMinHeight')), 0), 0),
    building3dHeight,
  ),
);
// Surface caps follow the reference's z14 transition. Structural layers use
// their own constant caps so tunnels cannot extend past their portals.
const roadLineCap = zoom.step<TileflowLineCap>([
  [3, 'butt'],
  [14, 'round'],
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
// Only Streets' fallback width profile is authored here. Core owns the physical
// ring geometry, fractional-zoom scaling and its relationship to the road casing.
const circularRoadFallbackWidth = expr.interpolate<number>(
  {kind: 'exponential', base: 2},
  expr.zoom(),
  [
    [15, circularRoadBaseWidth],
    ...Array.from({length: 9}, (_, index) => {
      const level = 16 + index;
      const scale = 1 + ((1.35 ** (level - 15) - 1) / (1.35 ** 7 - 1)) * 1.2;
      return [level, expr.multiply(circularRoadBaseWidth, scale)] as const;
    }),
  ],
);
const expresswayWidthScale = 1;
const tunnelBorderDash = [3, 3] as const;
const tunnelBorderWidth = 1;

function roadWidth(widths: WidthStops, oneWayScale: number, rampWidths?: WidthStops) {
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
    return surfaceWidth;
  };
  const widthStops = augmentedWidths.map(
    ([level, width]) => [level, widthOutput(level, width)] as const,
  );
  const firstWidthStop = widthStops[0];
  if (firstWidthStop === undefined) throw new Error('Road widths require at least one zoom stop.');
  return expr.interpolate({base: roadWidthInterpolationBase, kind: 'exponential'}, expr.zoom(), [
    firstWidthStop,
    ...widthStops.slice(1),
  ]);
}

function roadCasingWidth(major: boolean) {
  return expr.interpolate({kind: 'exponential', base: 1.5}, expr.zoom(), [
    [
      14,
      major ? expr.case<number>([{when: expr.eq(expr.get(field('ramp')), 1), value: 0.8}], 1) : 0.8,
    ],
    [22, 2],
  ]);
}

const pathCasingStrokeWidth = zoom.exponential(1.5, [
  [14, 0.5],
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
// Unpaved paths need the same contrast over grass as paved footways. A thin
// green stroke without a casing disappears into park and lawn polygons.
// Match Standard's continuous base-1.5 interpolation, including fractional
// zooms. Extra hand-tuned stops overstate overview paths and flatten detail.
const contextualPathLineWidth = zoom.exponential(1.5, mapboxPathWidthStops);
const contextualPathColor = expr.interpolate<ColorValue>({kind: 'linear'}, expr.zoom(), [
  [15, mapboxRoadPalette.pathAtZ15],
  [16, mapboxRoadPalette.pathFromZ16],
]);
const parkPathClasses = ['pathway', 'footway', 'steps', 'pedestrian'] as const;

function parkPathRefinements() {
  return Object.fromEntries(
    parkPathClasses.flatMap((roadClass) =>
      (['surface', 'bridge'] as const).flatMap((structure) => [
        [
          `${roadClass}-${structure}-fill`,
          refineRenderTarget({
            renderer: 'line',
            style: {
              color: roadClass === 'steps' ? mapboxRoadPalette.pathFromZ16 : contextualPathColor,
              minZoom:
                roadClass === 'steps'
                  ? 14
                  : structure === 'surface'
                    ? 12
                    : roadClass === 'pedestrian'
                      ? 13
                      : 14,
              ...(roadClass === 'steps' ? {dash: [0.18, 0.15]} : {}),
              width: contextualPathLineWidth,
            },
            target: `roads.classes.${roadClass}.${structure}.fill`,
          }),
        ],
        [
          `${roadClass}-${structure}-casing`,
          refineRenderTarget({
            renderer: 'line',
            style: {
              color: mapboxRoadPalette.pathCasing,
              minZoom:
                roadClass === 'steps' || (roadClass === 'pedestrian' && structure === 'surface')
                  ? 14
                  : 15,
              gapWidth: roadClass === 'steps' ? 0 : contextualPathLineWidth,
              width: roadClass === 'steps' ? contextualPathLineWidth : pathCasingStrokeWidth,
            },
            target: `roads.classes.${roadClass}.${structure}.casing`,
          }),
        ],
      ]),
    ),
  );
}

function rankAtMost(value: number): TileflowRenderSelector {
  return {
    coerce: 'number',
    fallback: 99,
    field: 'rank',
    kind: 'compare',
    operator: 'lte',
    value,
  };
}

const namedCitySelector = {
  kind: 'all',
  selectors: [
    {field: 'name', kind: 'has'},
    {field: 'class', kind: 'compare', operator: 'eq', value: 'city'},
    {
      kind: 'any',
      selectors: [
        {
          coerce: 'number',
          fallback: 0,
          field: 'capital',
          kind: 'compare',
          operator: 'gt',
          value: 0,
        },
        {
          fallback: {kind: 'literal', value: false},
          kind: 'step',
          stops: [
            {selector: rankAtMost(6), zoom: 2},
            {selector: rankAtMost(15), zoom: 4},
            {selector: {kind: 'literal', value: true}, zoom: 6},
          ],
        },
      ],
    },
  ],
} as const satisfies TileflowRenderSelector;

function streetsBoundaryRenderStack() {
  return {
    admin2Background: renderPass({
      placement: {below: 'boundaries.admin4'},
      feature: 'boundary',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          {
            coerce: 'number',
            fallback: 0,
            field: 'adminLevel',
            kind: 'compare',
            operator: 'eq',
            value: 2,
          },
          {
            coerce: 'number',
            fallback: 0,
            field: 'maritime',
            kind: 'compare',
            operator: 'ne',
            value: 1,
          },
        ],
      },
      style: {
        blur: zoom.linear([
          [3, 0],
          [12, 2],
        ]),
        color: streetsVisual.boundary.halo,
        minZoom: 1,
        opacity: zoom.linear([
          [3, 0],
          [4, 0.5],
        ]),
        width: zoom.linear([
          [3, 4],
          [12, 8],
        ]),
      },
    }),
    admin4Background: renderPass({
      placement: {below: 'boundaries.admin4'},
      feature: 'boundary',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          {
            coerce: 'number',
            fallback: 0,
            field: 'adminLevel',
            kind: 'compare',
            operator: 'eq',
            value: 4,
          },
          {
            coerce: 'number',
            fallback: 0,
            field: 'maritime',
            kind: 'compare',
            operator: 'ne',
            value: 1,
          },
        ],
      },
      style: {
        blur: zoom.linear([
          [3, 0],
          [12, 1],
        ]),
        color: streetsVisual.boundary.halo,
        minZoom: 2,
        opacity: zoom.linear([
          [2, 0],
          [4, 0.42],
        ]),
        width: zoom.linear([
          [3, 2.4],
          [6, 3.1],
          [12, 4.2],
        ]),
      },
    }),
    // OpenMapTiles carries admin-6 boundaries, but the generic boundaries
    // module deliberately exposes only the stable admin-2/admin-4 pair.
    // Standard uses the next tier as a restrained dotted municipal cue from
    // metro zooms onward, so Streets adds it as an explicit semantic pass.
    admin6: renderPass({
      placement: {above: 'boundaries.admin4'},
      feature: 'boundary',
      renderer: 'line',
      selector: {
        kind: 'all',
        selectors: [
          {
            coerce: 'number',
            fallback: 0,
            field: 'adminLevel',
            kind: 'compare',
            operator: 'eq',
            value: 6,
          },
          {
            coerce: 'number',
            fallback: 0,
            field: 'maritime',
            kind: 'compare',
            operator: 'ne',
            value: 1,
          },
        ],
      },
      style: {
        color: streetsVisual.boundary.regional,
        dash: [1, 1.5],
        minZoom: 8,
        opacity: zoom.linear([
          [8, 0],
          [9, 0.5],
          [12, 0.68],
        ]),
        width: zoom.linear([
          [8, 0.45],
          [10, 0.7],
          [12, 0.95],
        ]),
      },
    }),
  };
}

function streetsLandRenderStack() {
  return {
    // Core orders general cover, parks, lawn detail and mapped built surfaces.
    // Streets adds only its own business-corridor treatment.
    businessArea: renderPass({
      placement: {above: 'land.landuse.residential.fill'},
      feature: 'landuse',
      renderer: 'fill',
      selector: {field: 'class', kind: 'compare', operator: 'eq', value: 'business_area'},
      style: {
        color: streetsSurfacePalette.businessCorridor,
        minZoom: 11,
        opacity: 1,
      },
    }),
  };
}

// Hedges, fences and walls, as Mapbox Standard's gate-fence-hedge layer draws them: hedges in a
// darker park green over a shade offset from z17, fences and walls in grey from z16. Hedges start
// at z15, a zoom before Standard's, and a hedge mapped as an area is filled, where Standard's line
// layer only outlines it. The land module draws them last in its band, above car parks.
const hedgeWidth = zoom.linear([
  [15, 0.6],
  [16, 1],
  [18, 2],
  [20, 3.5],
]);

const streetsBarriers = {
  fence: {
    line: {
      color: streetsVisual.barrier.fence,
      minZoom: 16,
      width: zoom.linear([
        [16, 1],
        [20, 3],
      ]),
    },
  },
  wall: {
    line: {
      color: streetsVisual.barrier.wall,
      minZoom: 16,
      width: zoom.linear([
        [16, 1],
        [20, 3.5],
      ]),
    },
  },
  hedge: {
    area: {color: streetsVisual.barrier.hedge, minZoom: 15, opacity: 1},
    shadow: {
      cap: 'round',
      color: streetsVisual.barrier.hedgeShade,
      join: 'round',
      minZoom: 17,
      opacity: zoom.linear([
        [17, 0],
        [18, 0.7],
      ]),
      translate: [1.5, 1.5],
      width: hedgeWidth,
    },
    line: {
      cap: 'round',
      color: streetsVisual.barrier.hedge,
      join: 'round',
      minZoom: 15,
      width: hedgeWidth,
    },
  },
} as const satisfies TileflowLandModuleOptions['barriers'];

function streetsBuildingRenderStack() {
  return {
    // Keep just enough ambient separation for dense footprint clusters. The
    // fill and its close-colour outline carry the 2D building hierarchy; a
    // dark shadow at z15 would turn every footprint into a heavy sticker.
    flatShadow: renderPass({
      placement: {below: 'buildings.flat.fill'},
      feature: 'building',
      renderer: 'line',
      style: {
        blur: 2,
        color: buildingShadowColor,
        minZoom: 15.5,
        opacity: zoom.linear([
          [15.5, 0],
          [16, 0.03],
          [18, 0.08],
          [20, 0.1],
        ]),
        translate: [0.5, 0.75],
        translateAnchor: 'viewport',
        width: zoom.linear([
          [15.5, 0.5],
          [16, 1],
          [18, 3],
          [20, 4],
        ]),
      },
    }),
    shadowSoft: renderPass({
      placement: {below: 'buildings.flat.fill'},
      feature: 'building',
      renderer: 'line',
      selector: groundedBuilding3dSelector,
      style: {
        // A diffuse contact band, not a displaced footprint. It stays attached
        // to the walls when the camera rotates and fades in at street detail.
        blur: zoom.linear([
          [15.5, 2],
          [18, 6],
          [20, 10],
        ]),
        cap: 'round',
        color: streetsVisual.building.contactShadow,
        join: 'round',
        minZoom: 15.5,
        opacity: zoom.linear([
          [15.5, 0],
          [16.5, 0.12],
          [18, 0.22],
          [20, 0.24],
        ]),
        visibilityGroup: 'building',
        width: zoom.linear([
          [15.5, 1],
          [16.5, 4],
          [18, 10],
          [20, 18],
        ]),
      },
    }),
    shadowCore: renderPass({
      placement: {below: 'buildings.flat.fill'},
      feature: 'building',
      renderer: 'line',
      selector: groundedBuilding3dSelector,
      style: {
        blur: zoom.linear([
          [15.5, 0.5],
          [18, 1.5],
          [20, 2.5],
        ]),
        cap: 'round',
        color: streetsVisual.building.contactShadow,
        join: 'round',
        minZoom: 15.5,
        opacity: zoom.linear([
          [15.5, 0],
          [16.5, 0.08],
          [18, 0.16],
          [20, 0.18],
        ]),
        visibilityGroup: 'building',
        width: zoom.linear([
          [15.5, 0.5],
          [16.5, 1],
          [18, 2.5],
          [20, 4],
        ]),
      },
    }),
    extrusion: renderPass({
      placement: {above: 'buildings.flat.outline'},
      feature: 'building',
      renderer: 'extrusion',
      selector: visibleBuilding3dSelector,
      style: {
        base: building3dBase,
        color: building3dColor,
        height: building3dHeight,
        minZoom: 15,
        opacity: 1,
        verticalGradient: true,
        visibilityGroup: 'building',
      },
    }),
  };
}

function streetsLabelRenderStack() {
  return {
    ferry: renderPass({
      feature: 'roadName',
      placement: 'below-labels',
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {field: 'name', kind: 'compare', operator: 'ne', value: ''},
          {
            kind: 'any',
            selectors: [
              {field: 'class', kind: 'compare', operator: 'eq', value: 'ferry'},
              {field: 'subclass', kind: 'compare', operator: 'eq', value: 'ferry'},
            ],
          },
        ],
      },
      style: {
        minZoom: 15,
        placement: 'line',
        spacing: 250,
        text: {
          field: expr.get(field('name')),
          font: streetsVisual.font.default,
          color: streetsVisual.label.ferry,
          haloColor: streetsVisual.label.ferryHalo,
          haloWidth: 1,
          haloBlur: 1,
          letterSpacing: 0.01,
          maxAngle: 30,
          padding: 1,
          pitchAlignment: 'viewport',
          rotationAlignment: 'map',
          size: zoom.linear([
            [10, 6.5],
            [18, 13],
          ]),
          transform: 'uppercase',
        },
      },
    }),
    settlementMarker: renderPass({
      placement: {below: 'labels.places.city'},
      feature: 'place',
      renderer: 'circle',
      selector: namedCitySelector,
      style: {
        color: streetsVisual.label.settlement,
        maxZoom: 8,
        minZoom: 2,
        radius: expr.step(expr.coalesce(expr.get(field('rank')), 99), 3, [
          [3, 2.5],
          [7, 2],
        ]),
        strokeColor: streetsDetailPalette.halo,
        strokeWidth: 0.8,
      },
    }),
    country: refineRenderTarget({
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {field: 'class', kind: 'compare', operator: 'eq', value: 'country'},
          {
            fallback: rankAtMost(4),
            kind: 'step',
            stops: [
              {selector: rankAtMost(4), zoom: 3},
              {selector: {kind: 'literal', value: true}, zoom: 5},
            ],
          },
        ],
      },
      style: {},
      target: 'labels.places.country',
    }),
    state: refineRenderTarget({
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {
            field: 'class',
            kind: 'in',
            values: ['state', 'province', 'aboriginal_lands'],
          },
          {
            fallback: rankAtMost(1),
            kind: 'step',
            stops: [
              {selector: rankAtMost(2), zoom: 7},
              {selector: rankAtMost(4), zoom: 8},
            ],
          },
        ],
      },
      style: {},
      target: 'labels.places.state',
    }),
    city: refineRenderTarget({
      renderer: 'symbol',
      selector: namedCitySelector,
      style: {},
      target: 'labels.places.city',
    }),
    town: refineRenderTarget({
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {field: 'class', kind: 'compare', operator: 'eq', value: 'town'},
          {
            fallback: rankAtMost(7),
            kind: 'step',
            stops: [
              {selector: rankAtMost(12), zoom: 4},
              {selector: rankAtMost(15), zoom: 6},
              {selector: {kind: 'literal', value: true}, zoom: 8},
            ],
          },
        ],
      },
      style: {},
      target: 'labels.places.town',
    }),
    village: refineRenderTarget({
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {field: 'class', kind: 'compare', operator: 'eq', value: 'village'},
          {
            fallback: {kind: 'literal', value: false},
            kind: 'step',
            stops: [
              {selector: rankAtMost(8), zoom: 6},
              {selector: rankAtMost(12), zoom: 8},
              {selector: rankAtMost(15), zoom: 10},
              {selector: {kind: 'literal', value: true}, zoom: 12},
            ],
          },
        ],
      },
      style: {},
      target: 'labels.places.village',
    }),
    neighborhood: refineRenderTarget({
      renderer: 'symbol',
      selector: {
        kind: 'all',
        selectors: [
          {field: 'name', kind: 'has'},
          {
            field: 'class',
            kind: 'in',
            values: ['suburb', 'neighbourhood', 'quarter', 'borough'],
          },
          {
            fallback: rankAtMost(18),
            kind: 'step',
            stops: [
              // World ranks are local to each source zoom: Manhattan, for
              // example, moves from rank 11 at z12 to 30 at z13. Once city
              // detail begins, retain the producer's candidates and let
              // collisions choose which fit instead of hiding them again.
              {selector: {kind: 'literal', value: true}, zoom: 12},
            ],
          },
        ],
      },
      style: {},
      target: 'labels.places.neighborhood',
    }),
  };
}

// Links are part of their parent class in World tiles. Keep them out of the
// overview until z12, matching the separate link classes in the reference.
function streetsRoadEligibility() {
  return Object.fromEntries(
    (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] as const).flatMap((roadClass) =>
      (['fill', 'rampFill'] as const).map((phase) => [
        `${roadClass}-surface-${phase}-eligibility`,
        refineRenderTarget({
          renderer: 'line',
          selector: {
            kind: 'all',
            selectors: [
              {kind: 'geometry', geometry: 'line'},
              {kind: 'in', field: 'class', values: [roadClass, `${roadClass}_construction`]},
              {
                kind: 'compare',
                field: 'ramp',
                operator: phase === 'rampFill' ? 'eq' : 'ne',
                value: 1,
              },
              {
                kind: 'step',
                fallback: {kind: 'literal', value: true},
                stops: [
                  {
                    zoom: 5,
                    selector: {
                      kind: 'all',
                      selectors: [
                        {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'tunnel'},
                        {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'bridge'},
                      ],
                    },
                  },
                ],
              },
            ],
          },
          // Core places links before receiving carriageways. Streets owns only
          // their reference-specific visibility threshold and palette/widths.
          style: phase === 'rampFill' ? {minZoom: 12} : {},
          target: `roads.classes.${roadClass}.surface.${phase}`,
        }),
      ]),
    ),
  );
}

function streetsRoadRenderStack() {
  return {
    pedestrianGround: refineRenderTarget({
      // Walkable ground covers commercial zoning, while explicit grass, gardens
      // and parks remain above broad pedestrian complexes. Share the canonical
      // anchor with the earlier business-area pass; replacement land modules do
      // not inherit that Streets-only pass.
      placement: {above: 'land.landuse.residential.fill'},
      requirements: ['land'],
      target: 'roads.areas.pedestrian.fill',
    }),
    ...parkPathRefinements(),
    ...streetsRoadEligibility(),
    oneWayMarkers: refineRenderTarget({
      renderer: 'symbol',
      style: {
        icon: {
          allowOverlap: true,
          ignorePlacement: true,
          image: streetsVisual.image.oneway,
          keepUpright: false,
          opacity: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [16.5, 0],
            [17, 0.92],
            [17.5, 1],
          ]),
          padding: 0,
          pitchAlignment: 'map',
          rotate: expr.case<number>(
            [{when: expr.eq(expr.get(field('oneway')), -1), value: 180}],
            0,
          ),
          rotationAlignment: 'map',
          size: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [15, 0.38],
            [17, 0.55],
            [19, 0.7],
            [22, 1],
          ]),
        },
        minZoom: 16.5,
        spacing: expr.interpolate({kind: 'linear'}, expr.zoom(), [
          [15, 95],
          [17, 115],
          [19, 150],
          [22, 220],
        ]),
        text: {
          allowOverlap: true,
          field: expr.case<string>(
            [{when: expr.eq(expr.get(field('oneway')), -1), value: '←'}],
            '→',
          ),
          ignorePlacement: true,
          keepUpright: false,
          opacity: 0,
          padding: 0,
          pitchAlignment: 'map',
          rotationAlignment: 'map',
          size: expr.interpolate({kind: 'linear'}, expr.zoom(), [
            [15, 11],
            [17, 17],
            [19, 20],
            [22, 24],
          ]),
        },
      },
      target: 'roads.oneWayMarkers',
    }),
  };
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
    [roadBorderZoom, mapboxRoadPalette.detailCasing],
    [22, mapboxRoadPalette.detailCasing],
  ];
}

function cityRoadStyle(
  color: ColorValue,
  widths: WidthStops,
  options: {
    casingColorStops?: ColorStops;
    casingMinZoom?: number;
    major?: boolean;
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
    colorStops,
    minZoom,
    major = false,
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
    width: roadWidth(widths, oneWayScale, rampWidths),
  };
  const casing = {
    ...zoomRange,
    // The layer itself starts at the border threshold, so the width expression
    // needs no second zoom-based step (MapLibre permits only one per expression).
    minZoom: Math.max(minZoom ?? 0, casingMinZoom),
    cap: roadLineCap,
    // Border reads as a subtle shade of the road itself rather than a white halo.
    color: resolvedCasingColor,
    gapWidth: roadWidth(widths, oneWayScale, rampWidths),
    join: roadLineJoin,
    opacity,
    width: roadCasingWidth(major),
  };

  return {
    surface: {casing, fill},
    bridge: {
      casing: {...casing, cap: 'butt', join: 'miter', width: roadCasingWidth((minZoom ?? 0) < 12)},
      fill: {...fill, cap: 'round', join: 'miter', minZoom: Math.max(minZoom ?? 0, 13)},
    },
    tunnel: tunnelVisible
      ? {
          casing: {
            ...casing,
            cap: 'butt',
            join: 'miter',
            minZoom: minZoom === 3 ? 13 : (minZoom ?? 0) < 12 ? 14 : minZoom === 12 ? 15 : 16,
            // Standard's HD setting unifies carriageway borders at z15, including tunnels.
            color: expr.step<ColorValue>(expr.zoom(), tunnelCasingColor, [
              [15, mapboxRoadPalette.detailCasing],
            ]),
            dash: tunnelBorderDash,
            gapWidth: roadWidth(widths, oneWayScale, rampWidths),
            opacity: 1,
            width: roadCasingWidth((minZoom ?? 0) < 12),
          },
          fill: {
            ...fill,
            cap: 'butt',
            join: 'miter',
            minZoom: Math.max(minZoom ?? 0, 13),
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
  const fillWidth = options.width ?? roadWidth(widths, 1);
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

type RoadLabelKind = 'major' | 'path' | 'pedestrian' | 'service' | 'street';

function roadLabelStyle(kind: RoadLabelKind, minZoom: number): TileflowSymbolStyle {
  const major = kind === 'major';
  const pedestrian = kind === 'pedestrian';
  const path = kind === 'path';
  const small = path || kind === 'service';
  const startSize = major ? 9 : pedestrian ? 9 : small ? 6.5 : 8;
  const endSize = major ? 16 : pedestrian ? 14 : small ? 13 : 14;

  return {
    placement: 'line',
    minZoom,
    priority: major ? 90 : 50,
    spacing: 250,
    text: {
      color: streetsVisual.label.road,
      font: streetsVisual.font.default,
      haloColor: streetsVisual.label.roadHalo,
      haloWidth: 1,
      letterSpacing: path || pedestrian ? 0.01 : 0.15,
      maxAngle: 30,
      padding: 1,
      pitchAlignment: 'map',
      rotationAlignment: 'map',
      size: zoom.linear([
        [10, startSize],
        [18, endSize],
      ]),
      transform: 'uppercase',
    },
  };
}

export const streets = bindOfficialMapTheme(
  defineMap({
    id: 'streets',
    version: 1,
    name: 'Streets',
    glyphs: {
      kind: 'url',
      url: 'https://api.tileflow.dev/base/33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3/glyphs/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'],
    },
    themes: streetsThemes,
    timeOfDay: {
      light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'},
      faded: {day: 'faded', dawn: 'dawn-faded', dusk: 'dusk-faded', night: 'dark-faded'},
      monochrome: {
        day: 'monochrome',
        dawn: 'dawn-monochrome',
        dusk: 'dusk-monochrome',
        night: 'dark-monochrome',
      },
    },
    defaultTheme: 'light',
    systemThemes: {light: 'light', dark: 'dark'},
    projection: 'globe', // 'globe' | 'mercator'. Globe becomes planar at street zooms.
    // Each theme paints the sky seen when the camera tilts up the street; night shows stars.
    sky: {
      color: token.color('sky.color'),
      horizonColor: token.color('sky.horizon'),
      horizonBlend: token.number('sky.horizonBlend'),
      starIntensity: 0.6,
    },
    data: {
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
      type: 'tileflow-world',
    },
    icons: [streetsIcons],
    models: [streetsModels],
    // Global regional relief: native resolution is capped independently of visibility.
    // Higher zooms reuse z12 DEM tiles instead of requesting unavailable local detail.
    terrain: {
      mode: 'hillshade',
      encoding: 'terrarium',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxZoom: 12,
      attribution:
        'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">© Mapzen, data sources</a>',
      hillshade: {
        minZoom: 5,
        maxZoom: 14,
        accentColor: streetsVisual.terrain.accent,
        highlightColor: streetsVisual.terrain.highlight,
        shadowColor: streetsVisual.terrain.shadow,
        exaggeration: 0.23,
        illuminationAnchor: 'map',
        illuminationDirection: 315,
      },
    },
    modules: {
      // Optional keys: addresses, aeroways, boundaries, buildings, labels, land,
      // landforms, poi, roads, transit, vegetation, water. Object order never
      // controls layer order.
      // Streets deliberately omits parcel-level house numbers. POI and road/place
      // labels carry the useful navigation hierarchy without close-zoom numeric noise.
      addresses: addresses({
        labels: {
          minZoom: 17,
          text: {
            font: streetsVisual.font.default,
            color: streetsVisual.label.muted,
            haloColor: streetsVisual.label.placeHalo,
            haloWidth: 1,
            maxWidth: 10,
            padding: 20,
            size: zoom.linear([
              [18, 11],
              [20, 13],
            ]),
          },
        },
      }),
      land: withRenderStack(
        land({
          barriers: streetsBarriers,
          background: {
            color: streetsSurfacePalette.background,
            opacity: 1,
          },
          globalLandcover: {
            color: expr.match<string, ColorValue>(
              expr.get(field('class')),
              [
                {labels: 'barren', value: streetsGlobalLandcoverPalette.barren},
                {labels: 'crop', value: streetsGlobalLandcoverPalette.crop},
                {labels: 'grass', value: streetsGlobalLandcoverPalette.grass},
                {labels: 'shrub', value: streetsGlobalLandcoverPalette.shrub},
                {labels: 'snow', value: streetsGlobalLandcoverPalette.snow},
                {labels: 'trees', value: streetsGlobalLandcoverPalette.trees},
                {labels: 'urban', value: streetsGlobalLandcoverPalette.urban},
              ],
              fixed('rgba(0, 0, 0, 0)', {reason: 'Transparent fallback for absent landcover'}),
            ),
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
                minZoom: 5,
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
              fill: {color: streetsSurfacePalette.parking, minZoom: 15, opacity: 1},
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
        streetsLandRenderStack(),
      ),
      water: water({
        bathymetry: {
          antialias: false,
          color: expr.interpolate<ColorValue>(
            {kind: 'linear'},
            expr.multiply(-1, expr.toNumber(expr.get(field('bathymetryMinDepth')), 0)),
            [
              [0, streetsSurfacePalette.waterDepth0],
              [200, streetsSurfacePalette.waterDepth200],
              [2000, streetsSurfacePalette.waterDepth2000],
              [7000, streetsSurfacePalette.waterDepth7000],
            ],
          ),
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
            color: streetsSurfacePalette.water,
            opacity: 1,
          },
        },
        intermittent: {
          bodies: {fill: {color: streetsSurfacePalette.water, opacity: 1}},
          // Casa de Campo's named streams are mostly tagged intermittent.
          // A continuous, nearly opaque stroke keeps the real source geometry
          // legible over woodland without inventing a permanent water body.
          waterways: {
            color: streetsVisual.hydro.waterway,
            dash: [1, 0],
            opacity: 0.9,
          },
        },
        waterways: {
          canal: {
            cap: 'round',
            color: streetsVisual.hydro.waterway,
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
            color: streetsVisual.hydro.waterway,
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
            color: streetsVisual.hydro.waterway,
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
            color: streetsVisual.hydro.waterway,
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
      vegetation: streetsTrees,
      boundaries: withRenderStack(
        boundaries({
          // Mapbox Standard's admin-0/admin-1 layers map to OpenMapTiles
          // admin_level 2/4 respectively.
          admin2: {
            color: streetsOverviewPalette.admin0,
            dash: [10, 0],
            minZoom: 1,
            opacity: 1,
            width: zoom.linear([
              [3, 0.8],
              [6, 1.35],
              [12, 2.1],
            ]),
          },
          admin4: {
            color: streetsOverviewPalette.admin1,
            dash: [3, 2],
            minZoom: 2,
            opacity: zoom.linear([
              [2, 0],
              [3, 1],
            ]),
            width: zoom.linear([
              [3, 0.7],
              [6, 1.2],
              [12, 1.8],
            ]),
          },
          disputed: {
            color: streetsOverviewPalette.admin0,
            dash: expr.step<readonly number[]>(expr.zoom(), expr.literal([3, 2, 5]), [
              [7, expr.literal([2, 1.5])],
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
        streetsBoundaryRenderStack(),
      ),
      roads: withStreetsConstruction(
        roads({
          streetLights: {enabled: false},
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
            // At city detail these white markings wash out otherwise matching
            // road fills. Introduce them with the closer street-level detail.
            minZoom: 16.5,
            opacity: zoom.linear([
              [16.5, 0],
              [17, 1],
            ]),
          },
          roundabouts: {
            fallbackWidth: circularRoadFallbackWidth,
            borderWidth: roadBorderTotalWidth,
            casing: {
              color: fixed('rgba(0, 0, 0, 0)', {reason: 'Invisible circular-road underlay'}),
              minZoom: 15,
              pitchAlignment: 'map',
              pitchScale: 'map',
              strokeColor: roadCasingColor,
              strokeOpacity: 1,
            },
            fill: {
              color: fixed('rgba(0, 0, 0, 0)', {reason: 'Invisible circular-road underlay'}),
              minZoom: 15,
              pitchAlignment: 'map',
              pitchScale: 'map',
              strokeColor: roadSurfaceColor,
              strokeOpacity: 1,
            },
          },
          sidewalks: {
            pattern: {
              minZoom: 17,
              opacity: 0.62,
              pattern: streetsVisual.image.sidewalkPattern,
            },
            surface: {
              // Preserve the ground beneath mapped pedestrian polygons. A
              // neutral translucent tint darkens grass as green and pavement
              // as neutral, without requiring a spatial join in the style.
              color: streetsVisual.road.sidewalkSurface,
              minZoom: 17,
              opacity: 1,
            },
          },
          modifiers: {
            // Optional keys: construction, expressway, indoor, official, ramp, unpaved.
            // Treatments accept enabled, widthScale, surface, tunnel, and bridge;
            // phases accept color, opacity, dash, blur, gapWidth, offset, and width.
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
              // class widths above; disable the module's proportional scale.
              enabled: false,
            },
            unpaved: {
              surface: {
                // A continuous earth tone reads as a footpath without the
                // bead-like texture produced by short round dashes.
                casing: {
                  color: mapboxRoadPalette.detailCasing,
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
              // Preserve each road class's colors across access restrictions so
              // a restricted segment does not break the road's visual continuity.
              widthScale: 1,
              surface: {
                casing: {
                  dash: [1, 0],
                  opacity: 1,
                },
                fill: {dash: [1, 0], opacity: 1},
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
              fill: {color: streetsVisual.road.pedestrianSurface, minZoom: 13, opacity: 1},
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
                casingColorStops: [
                  [15, mapboxRoadPalette.detailCasing],
                  [22, mapboxRoadPalette.detailCasing],
                ],
                colorStops: [
                  [3, mapboxRoadPalette.motorway],
                  [22, mapboxRoadPalette.motorway],
                ],
                minZoom: 3,
                major: true,
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
                casingColorStops: [
                  [15, mapboxRoadPalette.detailCasing],
                  [22, mapboxRoadPalette.detailCasing],
                ],
                colorStops: [
                  [3, mapboxRoadPalette.trunk],
                  [22, mapboxRoadPalette.trunk],
                ],
                minZoom: 3,
                major: true,
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
                casingColorStops: cityRoadCasingColorStops(5),
                colorStops: cityRoadColorStops(
                  5,
                  streetsCityRoadPalette.primary,
                  primaryRoadSurfaceColor,
                ),
                minZoom: 6,
                major: true,
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
                casingColorStops: cityRoadCasingColorStops(8),
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
                casingColorStops: cityRoadCasingColorStops(8),
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
                casingColorStops: cityRoadCasingColorStops(12),
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
                [18, 10],
                [22, 100],
              ],
              {
                casingMinZoom: 16,
                casingColorStops: [
                  [14.5, mapboxRoadPalette.detailCasing],
                  [22, mapboxRoadPalette.detailCasing],
                ],
                colorStops: [
                  [13.5, roadSurfaceColor],
                  [22, roadSurfaceColor],
                ],
                minZoom: 15,
                tunnelCasingColor: mapboxRoadPalette.roadCasing,
                tunnelColor: mapboxRoadPalette.roadTunnel,
              },
            ),
            track: cityRoadStyle(
              mapboxRoadPalette.road,
              [
                [3, 0],
                [12, 0],
                [18, 10],
                [22, 100],
              ],
              {
                casingMinZoom: 16,
                casingColorStops: [
                  [14.5, mapboxRoadPalette.detailCasing],
                  [22, mapboxRoadPalette.detailCasing],
                ],
                colorStops: [
                  [13.5, mapboxRoadPalette.road],
                  [22, mapboxRoadPalette.road],
                ],
                minZoom: 15,
                tunnelCasingColor: mapboxRoadPalette.roadCasing,
                tunnelColor: mapboxRoadPalette.roadTunnel,
              },
            ),
            pathway: pathRoadStyle(mapboxRoadPalette.pathFromZ16, mapboxPathWidthStops, {
              minZoom: 12,
            }),
            footway: pathRoadStyle(mapboxRoadPalette.pathFromZ16, mapboxPathWidthStops, {
              minZoom: 12,
            }),
            cycleway: pathRoadStyle(mapboxRoadPalette.cycleway, mapboxPathWidthStops, {
              casingColor: mapboxRoadPalette.pathCasing,
              casingGapWidth: roadWidth(mapboxPathWidthStops, 1),
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
                width: roadWidth(mapboxPathWidthStops, 1),
              },
              width: zoom.linear([
                [12, 0],
                [18, 2],
                [22, 20],
              ]),
            }),
            steps: pathRoadStyle(mapboxRoadPalette.pathFromZ16, mapboxPathWidthStops, {
              casingMinZoom: 14,
              casingWidth: contextualPathLineWidth,
              casingGapWidth: 0,
              // World V1 overzooms its native z15 tile above street level.
              // Keep this literal: a zoom-dependent dash is evaluated at the
              // source tile zoom and would remain a continuous line at z16+.
              // The final layer override above also keeps road treatments from
              // replacing the stair pattern with a continuous path.
              dash: [0.18, 0.15],
              minZoom: 14,
              steps: true,
            }),
            pedestrian: pathRoadStyle(mapboxRoadPalette.pathFromZ16, mapboxPathWidthStops, {
              casingMinZoom: 14,
              minZoom: 12,
            }),
          },
        }),
        streetsRoadRenderStack(),
      ),
      transit: transit({
        ...mapboxRailTransitStyle(mapboxRailColor),
        // Fine blue routes fade in at regional scale; street-scale dashes
        // and names follow the same hierarchy as the Standard reference.
        ferry: {
          color: streetsVisual.road.ferry,
          minZoom: 8,
          dash: expr.step<readonly number[]>(expr.zoom(), expr.literal([1, 0]), [
            [13, expr.literal([12, 4])],
          ]),
          opacity: zoom.linear([
            [8, 0],
            [17, 1],
          ]),
          width: zoom.exponential(1.5, [
            [14, 0.5],
            [20, 1],
          ]),
        },
      }),
      buildings: withRenderStack(
        buildings({
          // Footprints; the render stack's extrusion pass raises them from z15, and its shadows
          // stand beside the flat fill, so they require this mode.
          mode: 'flat',
          threeDimensional: {
            floodLight: {
              intensity: token.number('buildings.floodLight.intensity'),
              brightnessScale: token.number('buildings.floodLight.brightnessScale'),
              color: token.color('buildings.floodLight'),
            },
            modelLighting: {
              wall: {
                emissiveStrength: token.number('buildings.modelEmission.strength'),
                emissiveColor: token.color('buildings.modelEmission'),
                emissiveHeight: [
                  token.number('buildings.modelEmission.start'),
                  token.number('buildings.modelEmission.end'),
                  0,
                  1,
                  token.number('buildings.modelEmission.curve'),
                ],
                color: token.color('buildings.modelEmission'),
                roughness: 1,
                metallic: 0,
              },
              roof: {color: token.color('buildings.modelRoof'), roughness: 1, metallic: 0},
              window: {
                roughness: 0,
                metallic: 1,
                emissiveStrength: token.number('buildings.modelWindow.strength'),
                emissiveVariation: token.number('buildings.modelWindow.variation'),
                emissiveHeight: [0, 0.9, 0, 1, 0.5],
                colorVariation: {
                  hue: [
                    token.number('buildings.modelWindow.hueLow'),
                    token.number('buildings.modelWindow.hueHigh'),
                  ],
                  saturation: [
                    token.number('buildings.modelWindow.saturationLow'),
                    token.number('buildings.modelWindow.saturationHigh'),
                  ],
                  lightness: [
                    token.number('buildings.modelWindow.lightnessLow'),
                    token.number('buildings.modelWindow.lightnessHigh'),
                  ],
                  space: 'linear',
                },
              },
              ...Object.fromEntries(
                (['unclassified', 'door', 'lamp', 'logo'] as const).map((role) => [
                  role,
                  {
                    roughness: 1,
                    metallic: 0,
                    emissiveStrength:
                      role === 'door'
                        ? token.number('buildings.modelDoor.strength')
                        : role === 'logo'
                          ? 0.6
                          : 0,
                    colorMix: role === 'logo' ? token.number('buildings.modelLogo.mix') : 1,
                    colorVariation: {
                      hue: [10, 70],
                      saturation: [
                        token.number('buildings.modelOther.saturation'),
                        token.number('buildings.modelOther.saturation'),
                      ],
                      lightness: [
                        token.number('buildings.modelOther.lightnessLow'),
                        token.number('buildings.modelOther.lightnessHigh'),
                      ],
                      space: 'linear',
                    },
                  },
                ]),
              ),
            },
          },
          businessCorridor: {
            // This compatibility layer contains selected building footprints,
            // not ground. Streets renders the derived business_area class through
            // landuse instead.
            fill: {visible: false},
            outline: {visible: false},
          },
          flat: {
            fill: {
              color: buildingFillColor,
              minZoom: 14.25,
              opacity: zoom.linear([
                [14.25, 0],
                [14.75, 0.5],
                [15, 1],
              ]),
            },
            outline: {
              color: buildingOutlineColor,
              minZoom: 14.5,
              opacity: zoom.linear([
                [14.5, 0],
                [15, 0.6],
                [16, 0.82],
                [17, 0.96],
                [18, 1],
              ]),
              width: zoom.linear([
                [14.5, 0.25],
                [15, 0.4],
                [16, 0.65],
                [17, 0.9],
                [20, 1],
              ]),
            },
          },
        }),
        streetsBuildingRenderStack(),
      ),
      labels: withRenderStack(
        labels({
          collisionPriority: 'navigation',
          language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
          places: 'all', // 'none' | 'major' | 'all'.
          roadPlacement: 'ground',
          roads: 'all',
          // Preserve Streets' selection while Core owns class aliases, language
          // fallback, ground placement and collision ordering.
          roadClasses: [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service',
            'pathway',
            'footway',
            'cycleway',
            'steps',
            'pedestrian',
          ],
          shields: 'major', // 'none' | 'major' | 'all'.
          junctions: true, // true | false.
          water: 'all', // 'none' | 'major' | 'all'.
          styles: {
            roads: {
              motorway: roadLabelStyle('major', 10),
              trunk: roadLabelStyle('major', 10),
              primary: roadLabelStyle('major', 12),
              secondary: roadLabelStyle('major', 12),
              tertiary: roadLabelStyle('major', 13),
              minor: roadLabelStyle('street', 13),
              service: roadLabelStyle('service', 15),
              pathway: roadLabelStyle('path', 15),
              footway: roadLabelStyle('path', 15),
              cycleway: roadLabelStyle('path', 15),
              steps: roadLabelStyle('path', 15),
              pedestrian: roadLabelStyle('pedestrian', 12),
            },
            places: {
              // Standard overview hierarchy: continents disappear first, then
              // countries and administrative regions hand over to settlements.
              continent: {
                minZoom: 0.75,
                maxZoom: 3,
                priority: 100,
                text: {
                  color: streetsOverviewPalette.label,
                  haloColor: streetsVisual.label.placeHalo,
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
                  font: streetsVisual.font.default,
                  color: streetsOverviewPalette.label,
                  haloColor: streetsVisual.label.placeHalo,
                  haloWidth: 1.25,
                  lineHeight: 1.1,
                  maxWidth: 6,
                  padding: 3,
                  radialOffset: zoom.step([
                    [1, 0.6],
                    [8, 0],
                  ]),
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.2, x2: 0.7, y1: 0, y2: 1},
                    expr.zoom(),
                    [
                      [
                        1,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 11, [
                          [4, 9],
                          [5, 8],
                        ]),
                      ],
                      [
                        9,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 22, [
                          [4, 19],
                          [5, 17],
                        ]),
                      ],
                    ],
                  ),
                  variableAnchors: ['left', 'right', 'top', 'bottom'],
                },
              },
              state: {
                minZoom: 3,
                maxZoom: 9,
                priority: 86,
                text: {
                  font: streetsVisual.font.places,
                  color: streetsOverviewPalette.label,
                  haloColor: streetsVisual.label.placeHalo,
                  haloWidth: 1,
                  letterSpacing: 0.15,
                  maxWidth: 6,
                  opacity: 0.5,
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.85, x2: 0.65, y1: 0.7, y2: 1},
                    expr.zoom(),
                    [
                      [
                        4,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 9, [
                          [6, 8],
                          [7, 7],
                        ]),
                      ],
                      [
                        9,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 21, [
                          [6, 16],
                          [7, 14],
                        ]),
                      ],
                    ],
                  ),
                  transform: 'uppercase',
                },
              },
              city: {
                minZoom: 2,
                maxZoom: 15,
                priority: expr.subtract(100, expr.coalesce(expr.get(field('rank')), 20)),
                text: {
                  color: zoom.linear([
                    [2, streetsOverviewPalette.label],
                    [4, streetsOverviewPalette.label],
                    [6, streetsVisual.label.settlement],
                  ]),
                  haloColor: streetsVisual.label.placeHalo,
                  haloBlur: 1,
                  haloWidth: 1,
                  lineHeight: 1.1,
                  maxWidth: 7,
                  padding: 1,
                  radialOffset: zoom.step([
                    [2, 0.6],
                    [8, 0],
                  ]),
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.2, x2: 0.9, y1: 0, y2: 1},
                    expr.zoom(),
                    [
                      [3, expr.step(expr.coalesce(expr.get(field('rank')), 99), 13, [[6, 11]])],
                      [
                        6,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 18, [
                          [6, 16],
                          [7, 14],
                        ]),
                      ],
                      [
                        8,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 20, [
                          [9, 16],
                          [10, 14],
                        ]),
                      ],
                      [
                        15,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 24, [
                          [9, 20],
                          [12, 16],
                          [15, 14],
                        ]),
                      ],
                    ],
                  ),
                  font: streetsVisual.font.default,
                  variableAnchors: ['right'],
                },
              },
              town: {
                minZoom: 2,
                maxZoom: 13,
                priority: expr.subtract(80, expr.coalesce(expr.get(field('rank')), 20)),
                text: {
                  color: streetsVisual.label.settlement,
                  haloColor: streetsVisual.label.placeHalo,
                  haloBlur: 1,
                  haloWidth: 1,
                  lineHeight: 1.1,
                  maxWidth: 7,
                  padding: 1,
                  radialOffset: zoom.step([
                    [2, 0.55],
                    [8, 0],
                  ]),
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.2, x2: 0.9, y1: 0, y2: 1},
                    expr.zoom(),
                    [
                      [3, expr.step(expr.coalesce(expr.get(field('rank')), 99), 11, [[9, 10]])],
                      [
                        6,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 14, [
                          [9, 12],
                          [12, 10],
                        ]),
                      ],
                      [
                        8,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 16, [
                          [9, 14],
                          [12, 12],
                          [15, 10],
                        ]),
                      ],
                      [
                        13,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 22, [
                          [9, 20],
                          [12, 16],
                          [15, 14],
                        ]),
                      ],
                    ],
                  ),
                  font: streetsVisual.font.regular,
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
              village: {
                minZoom: 2,
                maxZoom: 13,
                priority: expr.subtract(65, expr.coalesce(expr.get(field('rank')), 20)),
                text: {
                  color: streetsVisual.label.settlement,
                  haloColor: streetsVisual.label.placeHalo,
                  haloBlur: 1,
                  haloWidth: 1,
                  lineHeight: 1.1,
                  maxWidth: 7,
                  padding: 1,
                  radialOffset: zoom.step([
                    [2, 0.55],
                    [8, 0],
                  ]),
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.2, x2: 0.9, y1: 0, y2: 1},
                    expr.zoom(),
                    [
                      [3, expr.step(expr.coalesce(expr.get(field('rank')), 99), 11, [[9, 10]])],
                      [
                        6,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 14, [
                          [9, 12],
                          [12, 10],
                        ]),
                      ],
                      [
                        8,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 16, [
                          [9, 14],
                          [12, 12],
                          [15, 10],
                        ]),
                      ],
                      [
                        13,
                        expr.step(expr.coalesce(expr.get(field('rank')), 99), 22, [
                          [9, 20],
                          [12, 16],
                          [15, 14],
                        ]),
                      ],
                    ],
                  ),
                  font: streetsVisual.font.regular,
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
              neighborhood: {
                minZoom: 10,
                maxZoom: 15,
                priority: expr.subtract(65, expr.coalesce(expr.get(field('rank')), 20)),
                text: {
                  font: streetsVisual.font.default,
                  color: streetsVisual.label.neighborhood,
                  haloColor: streetsVisual.label.placeHalo,
                  haloBlur: 0,
                  haloWidth: 1.3,
                  letterSpacing: expr.match<string, number>(
                    expr.get(field('class')),
                    [{labels: 'suburb', value: 0.15}],
                    0.05,
                  ),
                  lineHeight: 1.1,
                  maxWidth: 7,
                  padding: 3,
                  size: expr.interpolate(
                    {kind: 'cubic-bezier', x1: 0.5, x2: 1, y1: 0, y2: 1},
                    expr.zoom(),
                    [
                      [
                        11,
                        expr.match<string, number>(
                          expr.get(field('class')),
                          [{labels: 'suburb', value: 12}],
                          11.5,
                        ),
                      ],
                      [
                        15,
                        expr.match<string, number>(
                          expr.get(field('class')),
                          [{labels: 'suburb', value: 16}],
                          15,
                        ),
                      ],
                    ],
                  ),
                  transform: 'uppercase',
                },
              },
              other: {
                minZoom: 11,
                maxZoom: 16,
                priority: 40,
                text: {
                  font: streetsVisual.font.default,
                  color: streetsVisual.label.neighborhood,
                  haloColor: streetsVisual.label.placeHalo,
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
              // Standard exit references start at z14 and use the shield weight.
              minZoom: 14,
              placement: 'point',
              text: {
                color: streetsVisual.label.road,
                font: streetsVisual.font.places,
                haloColor: streetsDetailPalette.halo,
                haloWidth: 1,
                size: 10,
              },
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
                  size: 10,
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
                  font: streetsVisual.font.water,
                  color: streetsDetailPalette.waterText,
                  haloColor: streetsVisual.label.waterHalo,
                  haloWidth: 0,
                  letterSpacing: 0.25,
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
                  font: streetsVisual.font.water,
                  color: streetsDetailPalette.waterText,
                  haloColor: streetsVisual.label.waterHalo,
                  haloWidth: 0,
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
                  font: streetsVisual.font.water,
                  color: streetsDetailPalette.waterText,
                  haloColor: streetsVisual.label.waterHalo,
                  haloWidth: 0,
                  letterSpacing: expr.match<string, number>(
                    expr.get(field('class')),
                    [
                      {labels: 'ocean', value: 0.25},
                      {labels: ['sea', 'bay'], value: 0.15},
                    ],
                    0,
                  ),
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
                  font: streetsVisual.font.water,
                  color: streetsDetailPalette.waterText,
                  haloColor: streetsVisual.label.waterHalo,
                  haloWidth: 0,
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
                font: streetsVisual.font.default,
                color: streetsVisual.label.aerodrome,
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
        streetsLabelRenderStack(),
      ),
      poi: poi({
        // World owns taxonomy, zoom eligibility, density ranks and importance. Streets
        // shows every category at one density and places them all in World's importance
        // order, so collision keeps the most relevant places whatever their category.
        categories: [
          'transport',
          'food-drink',
          'lodging',
          'retail',
          'arts-entertainment',
          'landmark',
          'park-nature',
          'medical',
          'education',
          'public-services',
          'sport-leisure',
          'religion',
          'visitor-amenity',
        ],
        // Standard carries the POI category into both marker and label colour.
        // A uniform grey treatment suppresses a meaningful amount of chroma
        // and makes the whole light map read as if a pale overlay sat above it.
        color: 'category',
        density: 3,
        icons: true,
        labels: true,
        placement: {
          // One collision unit: a POI shows its disc and its name, or nothing. Parking and
          // toilets, whose pictogram says what they are, show the disc alone.
          coupleIconAndLabel: true,
          iconPadding: 3,
          order: 'importance',
          // Street and place names outrank everyday destinations ('navigation' labels), but
          // not the places that make a city recognisable: World's two most important ranks.
          prominentRank: 1,
          textPadding: 3,
        },
        styles: {
          'arts-entertainment': streetsPoiStyle('arts-entertainment'),
          education: streetsPoiStyle('education'),
          'food-drink': streetsPoiStyle('food-drink'),
          landmark: streetsPoiStyle('landmark'),
          lodging: streetsPoiStyle('lodging'),
          medical: streetsPoiStyle('medical'),
          'park-nature': streetsPoiStyle('park-nature'),
          'public-services': streetsPoiStyle('public-services'),
          religion: streetsPoiStyle('religion'),
          retail: streetsPoiStyle('retail'),
          'sport-leisure': streetsPoiStyle('sport-leisure'),
          transport: streetsPoiStyle('transport'),
          'visitor-amenity': streetsPoiStyle('visitor-amenity'),
        },
      }),
    },
    view: {
      center: [-3.69275, 40.40866],
      zoom: 14,
    },
  }),
);
