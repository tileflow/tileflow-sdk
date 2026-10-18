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

/** Keep construction ground and marks beneath the roads that are already in service. */
export function withStreetsConstruction(
  module: TileflowRoadsModuleConfig,
  stack: TileflowNamedRenderStack,
): TileflowModuleWithRenderStack<TileflowRoadsModuleConfig, TileflowNamedRenderStack> {
  const constructionPath = expr.eq(expr.get(field('class')), 'path_construction');
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
      const selector: TileflowRenderSelector = {
        kind: 'all',
        selectors: [
          {kind: 'geometry', geometry: 'line'},
          {
            kind: 'in',
            field: 'class',
            values:
              roadClass === 'track'
                ? ['track_construction', 'raceway_construction']
                : [`${roadClass}_construction`],
          },
          {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'bridge'},
          {kind: 'compare', field: 'brunnel', operator: 'ne', value: 'tunnel'},
          {
            kind: 'step',
            fallback: {kind: 'compare', field: 'ramp', operator: 'ne', value: 1},
            stops: [{zoom: 12, selector: {kind: 'literal', value: true}}],
          },
        ],
      };
      return [
        [
          `construction-${roadClass}-underlay`,
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
          `construction-${roadClass}`,
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
      ];
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
