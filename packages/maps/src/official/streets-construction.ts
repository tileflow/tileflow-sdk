import {
  expr,
  field,
  renderPass,
  type TileflowModuleWithRenderStack,
  type TileflowNamedRenderStack,
  type TileflowRenderSelector,
  type TileflowRoadsModuleConfig,
  token,
  withRenderStack,
} from '@tileflow/core';
import {worldConstructionSelector, worldConstructionTypes} from './world-roads';

/** Classes whose World ramps (`link`) are drawn narrower than their carriageways. */
const rampClasses: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
]);

/** Keep construction ground and marks beneath the roads that are already in service. */
export function withStreetsConstruction(
  module: TileflowRoadsModuleConfig,
  stack: TileflowNamedRenderStack,
): TileflowModuleWithRenderStack<TileflowRoadsModuleConfig, TileflowNamedRenderStack> {
  const constructionPath = expr.all(
    expr.eq(expr.get(field('class')), 'construction'),
    expr.match(
      expr.get(field('type')),
      [{labels: [...worldConstructionTypes.pathway, 'footway', 'cycleway', 'steps'], value: true}],
      false,
    ),
  );
  const marks = Object.fromEntries(
    (
      [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'minor',
        'service',
        'track',
      ] as const
    ).flatMap((roadClass) => {
      const fill = module.classes?.[roadClass]?.surface?.fill;
      if (!fill || fill.visible === false || module.classes?.[roadClass]?.enabled === false)
        return [];
      const base: TileflowRenderSelector[] = [
        {kind: 'geometry', geometry: 'line'},
        worldConstructionSelector(roadClass),
        {kind: 'compare', field: 'structure', operator: 'ne', value: 'bridge'},
        {kind: 'compare', field: 'structure', operator: 'ne', value: 'tunnel'},
      ];
      // Ramps join their class at z12, with a narrower width. Their own passes keep that width
      // camera-only: in one layer it would depend on zoom and `link`, which MapLibre evaluates at
      // each tile's zoom, so tilted views would draw the marks at a different width where tile
      // zooms meet.
      const variants: Array<[suffix: string, selector: TileflowRenderSelector]> = rampClasses.has(
        roadClass,
      )
        ? [
            [
              '-ramp',
              {
                kind: 'all',
                selectors: [
                  ...base,
                  {kind: 'compare', field: 'link', operator: 'eq', value: true},
                  {
                    kind: 'step',
                    fallback: {kind: 'literal', value: false},
                    stops: [{zoom: 12, selector: {kind: 'literal', value: true}}],
                  },
                ],
              },
            ],
            [
              '',
              {
                kind: 'all',
                selectors: [...base, {kind: 'compare', field: 'link', operator: 'ne', value: true}],
              },
            ],
          ]
        : [
            [
              '',
              {
                kind: 'all',
                selectors: [
                  ...base,
                  {
                    kind: 'step',
                    fallback: {kind: 'compare', field: 'link', operator: 'ne', value: true},
                    stops: [{zoom: 12, selector: {kind: 'literal', value: true}}],
                  },
                ],
              },
            ],
          ];
      return variants.flatMap(([suffix, selector]) => [
        [
          `construction-${roadClass}${suffix}-underlay`,
          renderPass({
            feature: 'road',
            placement: 'below-roads',
            selector,
            renderer: 'line',
            style: {
              ...fill,
              color: token.color('roads.default'),
              dash: [1, 0],
              opacity: 0.16,
            },
          }),
        ],
        [
          `construction-${roadClass}${suffix}`,
          renderPass({
            feature: 'road',
            placement: 'below-roads',
            selector,
            renderer: 'line',
            style: {
              // Reuse the class's exact width, including ramp and one-way curves.
              ...fill,
              minZoom: Math.max(fill.minZoom ?? 0, 14),
              cap: 'butt',
              join: 'round',
              color: token.color('roads.default'),
              // Short transverse strokes with flat ends avoid the former round capsules.
              dash: [0.1, 0.18],
              opacity: 0.9,
            },
          }),
        ],
      ]);
    }),
  );
  return withRenderStack(
    {
      ...module,
      modifiers: {
        ...module.modifiers,
        construction: {
          surface: {
            // Override the domain's dashed casing even though this casing is hidden:
            // its dash expression otherwise forces ordinary borders through the SDF shader.
            casing: {dash: [1, 0], opacity: 0},
            fill: {
              color: token.color('roads.default'),
              // Footpaths keep their existing treatment; hatching is for carriageways.
              dash: expr.case(
                [{when: constructionPath, value: expr.literal<readonly number[]>([1.5, 1])}],
                expr.literal<readonly number[]>([1, 0]),
              ),
              // The separate underlay supplies carriageway ground below all live roads.
              opacity: expr.case([{when: constructionPath, value: 0.96}], 0),
            },
          },
        },
      },
    },
    {...stack, ...marks},
  );
}
