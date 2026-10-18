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
type Carriageway = (typeof carriageways)[number];

const aliases: Partial<Record<Carriageway, readonly string[]>> = {
  minor: ['residential', 'unclassified'],
  service: ['busway', 'bus_guideway'],
  track: ['raceway'],
};

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
  classes: readonly string[],
  structure: 'surface' | 'bridge',
  extra: readonly TileflowRenderSelector[] = [],
): TileflowRenderSelector {
  return {
    kind: 'all',
    selectors: [
      {kind: 'geometry', geometry: 'line'},
      {kind: 'in', field: 'class', values: classes},
      structure === 'bridge'
        ? {kind: 'compare', field: 'brunnel', operator: 'eq', value: 'bridge'}
        : {kind: 'not', selector: {kind: 'in', field: 'brunnel', values: ['bridge', 'tunnel']}},
      ...extra,
    ],
  };
}

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
          expr.case(
            [
              // Preserve the domain's first-match width rules, including service ways.
              {when: restrictedAccess, value: base},
              {
                when: expr.eq(expr.toNumber(expr.get(field('expressway')), 0), 1),
                value: base * 1.06,
              },
              {when: expr.eq(expr.get(field('ramp')), 1), value: base * 0.72},
              ...(roadClass === 'service'
                ? Object.entries({
                    alley: 0.82,
                    crossover: 0.62,
                    driveway: 0.76,
                    parking_aisle: 0.62,
                    yard: 0.7,
                  }).map(([service, factor]) => ({
                    when: expr.eq(expr.get(field('service')), service),
                    value: base * factor,
                  }))
                : []),
            ],
            base,
          ),
        ] as const;
      });
      return expr.interpolate({kind: 'exponential', base: 1.5}, expr.zoom(), [
        stops[0]!,
        ...stops.slice(1),
      ]);
    };
    const ordinary = [roadClass, ...(aliases[roadClass] ?? [])];
    const construction = ordinary
      .filter((name) => name === roadClass || name === 'raceway')
      .map((name) => `${name}_construction`);
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
            ? [{kind: 'compare', field: 'ramp', operator: 'ne', value: 1}]
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
          selector: roadSelector([...ordinary, ...construction], 'bridge', [
            {
              kind: 'not',
              selector: {
                kind: 'all',
                selectors: [
                  {kind: 'in', field: 'class', values: ordinary},
                  {kind: 'compare', field: 'ramp', operator: 'eq', value: 1},
                ],
              },
            },
          ]),
          style: {},
        });
      }
      detail[`${roadClass}-${structure}-links`] = renderPass({
        feature: 'road',
        renderer: 'line',
        // Receiving carriageways cover the end of a link in the same band.
        placement: {below: `roads.classes.track.${structure}.fill`},
        selector: roadSelector(ordinary, structure, [
          {kind: 'compare', field: 'ramp', operator: 'eq', value: 1},
        ]),
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
                    {when: expr.eq(expr.toNumber(expr.get(field('indoor')), 0), 1), value: 0.72},
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
