import {
  expr,
  field,
  refineRenderTarget,
  renderPass,
  type TileflowNamedRenderStack,
  type TileflowRenderSelector,
  type TileflowRoadClass,
  type TileflowRoadsModuleConfig,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {worldConstructionSelector, worldRoadSelector} from './world-roads';

// The Streets zoom progression, with 15% slimmer carriageways. Keep these
// atlas-owned so its colors, outlines and road treatments remain independent.
const majorWidths = [
  [3, 0.8],
  [12, 3.2],
  [18, 30],
  [22, 300],
] as const;
const secondaryWidths = [
  [3, 0],
  [12, 2.2],
  [18, 26],
  [22, 260],
] as const;
const serviceWidths = [
  [3, 0],
  [12, 0],
  [18, 10],
  [22, 100],
] as const;
const pathWidths = [
  [12, 0],
  [18, 6],
  [22, 80],
] as const;
const widths = {
  motorway: majorWidths,
  trunk: majorWidths,
  primary: [
    [3, 0.8],
    [12, 3],
    [18, 28],
    [22, 280],
  ],
  secondary: secondaryWidths,
  tertiary: secondaryWidths,
  minor: [
    [3, 0],
    [12, 0.5],
    [18, 20],
    [22, 200],
  ],
  service: serviceWidths,
  track: serviceWidths,
  pathway: pathWidths,
  footway: pathWidths,
  cycleway: pathWidths,
  steps: pathWidths,
  pedestrian: [
    [12, 0.2],
    [18, 12],
    [22, 120],
  ],
} as const satisfies Record<TileflowRoadClass, readonly (readonly [number, number])[]>;

export function map1777RoadBorder(roadClass: TileflowRoadClass) {
  return ['track', 'pathway', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(roadClass)
    ? 0.8
    : 1.3;
}

export function map1777RoadWidth(roadClass: TileflowRoadClass, border = 0) {
  return zoom.exponential(
    1.5,
    widths[roadClass].map(([level, width]) => [level, width * 0.85 + border] as const),
  );
}

const carriageways = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
] as const;

const restrictedAccess = expr.all(
  expr.has(field('access')),
  expr.not(
    expr.match(
      expr.get(field('access')),
      [
        {
          labels: ['yes', 'designated', 'official', 'permissive', 'unknown'],
          value: true,
        },
      ],
      false,
    ),
  ),
);

function roadSelector(
  roads: TileflowRenderSelector,
  structure: 'surface' | 'bridge',
  extra: readonly TileflowRenderSelector[] = [],
): TileflowRenderSelector {
  return {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'line'},
      roads,
      structure === 'bridge'
        ? {kind: 'compare', field: 'structure', operator: 'eq', value: 'bridge'}
        : {kind: 'not', selector: {kind: 'in', field: 'structure', values: ['bridge', 'tunnel']}},
      ...extra,
    ],
  };
}

const link = {kind: 'compare', field: 'link', operator: 'eq', value: true} as const;
/** Classes whose World features can be ramps. */
const rampClasses: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
]);

/** Separate ink plates for works and highway links without changing the atlas palette. */
export function withMap1777RoadDetail(
  module: TileflowRoadsModuleConfig,
  stack: TileflowNamedRenderStack,
) {
  const detail: Record<string, TileflowNamedRenderStack[string]> = {};
  for (const roadClass of carriageways) {
    const road = module.classes?.[roadClass];
    if (!road || road.enabled === false) continue;
    const width = (border: number) => {
      const stops = map1777RoadWidth(roadClass, border).stops.map(([z, base]) => {
        return [
          z,
          // Works on a ramp narrow like the ramp itself, as the domain draws it.
          rampClasses.has(roadClass)
            ? expr.case([{when: expr.eq(expr.get(field('link')), true), value: base * 0.72}], base)
            : base,
        ] as const;
      });
      return expr.interpolate({kind: 'exponential', base: 1.5}, expr.zoom(), [
        stops[0]!,
        ...stops.slice(1),
      ]);
    };
    const ordinary = worldRoadSelector([roadClass]);
    const construction = worldConstructionSelector(roadClass);
    const highway = roadClass === 'motorway' || roadClass === 'trunk';

    for (const phase of ['casing', 'fill'] as const) {
      const paint = road.surface?.[phase];
      if (!paint || paint.visible === false) continue;
      detail[`${roadClass}-${phase}-ordinary`] = refineRenderTarget({
        target: `roads.classes.${roadClass}.surface.${phase}`,
        renderer: 'line',
        selector: roadSelector(
          ordinary,
          'surface',
          highway && phase === 'fill'
            ? [{kind: 'compare', field: 'link', operator: 'ne', value: true}]
            : [],
        ),
        style: {},
      });
      detail[`${roadClass}-construction-${phase}`] = renderPass({
        feature: 'road',
        renderer: 'line',
        placement: 'below-roads',
        selector: roadSelector(construction, 'surface'),
        style: {
          ...paint,
          cap: 'square',
          dash: [2, 1],
          opacity: zoom.linear([
            [paint.minZoom ?? 0, 0],
            [(paint.minZoom ?? 0) + 1, phase === 'casing' ? 0.4 : 0.55],
          ]),
          width: width(phase === 'casing' ? map1777RoadBorder(roadClass) : 0),
        },
      });
    }

    if (!highway) continue;
    for (const structure of ['surface', 'bridge'] as const) {
      const fill = road[structure]?.fill;
      if (!fill || fill.visible === false) continue;
      if (structure === 'bridge') {
        detail[`${roadClass}-bridge-ordinary`] = refineRenderTarget({
          target: `roads.classes.${roadClass}.bridge.fill`,
          renderer: 'line',
          selector: roadSelector(worldRoadSelector([roadClass], {construction: true}), 'bridge', [
            {kind: 'not', selector: {kind: 'all', selectors: [ordinary, link]}},
          ]),
          style: {},
        });
      }
      detail[`${roadClass}-${structure}-links`] = renderPass({
        feature: 'road',
        renderer: 'line',
        // Receiving carriageways cover the end of a link in the same band.
        placement: {below: `roads.classes.track.${structure}.fill`},
        selector: roadSelector(ordinary, structure, [link]),
        style: {
          ...fill,
          width: width(0),
          ...(structure === 'surface'
            ? {
                // Match the existing road treatments and their precedence.
                opacity: expr.case(
                  [
                    {when: restrictedAccess, value: 0.9},
                    {when: expr.eq(expr.get(field('surface')), 'unpaved'), value: 0.82},
                    {when: expr.eq(expr.get(field('indoor')), true), value: 0.72},
                  ],
                  0.94,
                ),
              }
            : {}),
        },
      });
    }
  }
  return withRenderStack(module, {...stack, ...detail});
}
