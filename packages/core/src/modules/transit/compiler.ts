import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution, TileflowLayerSlot} from '../../cartography/contributions';
import {applyLineStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {TileflowTransitModuleConfig} from './index';

export function compileTransit(
  request: TileflowTransitModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowTransitModuleConfig>(
    {
      type: 'transit',
      enabled: true,
      cableway: {
        color: context.colors.roads.rail,
        dash: [2, 2],
        minZoom: 10,
        opacity: 0.75,
        width: zoom.linear([
          [10, 0.5],
          [16, 1.5],
        ]),
      },
      ferry: {
        color: context.colors.hydro.ferry,
        dash: [2, 1.5],
        minZoom: 5,
        opacity: 0.8,
        width: zoom.linear([
          [5, 0.4],
          [16, 2.4],
        ]),
      },
      rail: {
        surface: railStyle(context.colors.roads.rail, 0.72),
        bridge: railStyle(context.colors.roads.rail, 0.72),
        tunnel: {...railStyle(context.colors.roads.rail, 0.42), dash: [2, 1.5]},
      },
      railHatching: {
        surface: railHatchingStyle(context.colors.background, 1),
        bridge: railHatchingStyle(context.colors.background, 1),
        tunnel: railHatchingStyle(context.colors.background, 0.52),
      },
      serviceRail: {
        surface: serviceRailStyle(context.colors.roads.rail, 0.5),
        bridge: serviceRailStyle(context.colors.roads.rail, 0.5),
        tunnel: {...serviceRailStyle(context.colors.roads.rail, 0.32), dash: [2, 1.5]},
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const {sourceId: source, schema} = context.data;
  const railFilter = [
    'all',
    ['match', ['get', schema.fields.class], ['rail', 'transit'], true, false],
    ['!', ['has', schema.fields.service]],
  ];
  const lineTargets = [
    [
      'ferry',
      config.ferry,
      ['==', ['get', schema.fields.class], 'ferry'],
      'transport-surface-fill',
      1000,
    ],
    [
      'cableway',
      config.cableway,
      [
        'match',
        ['get', schema.fields.subclass],
        ['cable_car', 'gondola', 'chair_lift', 'drag_lift', 'funicular'],
        true,
        false,
      ],
      'transport-surface-fill',
      1030,
    ],
  ] as const satisfies readonly (readonly [
    string,
    typeof config.ferry,
    readonly unknown[],
    TileflowLayerSlot,
    number,
  ])[];

  const contributions: TileflowLayerContribution[] = lineTargets.flatMap(
    ([name, style, targetFilter, slot, localOrder]) => {
      if (!style || style.visible === false) return [];
      return [
        {
          kind: 'layer' as const,
          layer: applyLineStyle(
            {
              id: `streets-transit-${name}`,
              type: 'line',
              source,
              'source-layer': schema.layers.road,
              filter: targetFilter,
            },
            style,
          ),
          localOrder,
          owner: 'transit' as const,
          slot,
          target: `transit.${name}`,
        },
      ];
    },
  );

  const structuredTargets = [
    ['rail', config.rail, railFilter, 1010],
    ['rail-hatching', config.railHatching, railFilter, 1011],
    [
      'service-rail',
      config.serviceRail,
      ['all', ['==', ['get', schema.fields.class], 'rail'], ['has', schema.fields.service]],
      1020,
    ],
  ] as const;
  for (const [name, styles, semanticFilter, baseOrder] of structuredTargets) {
    if (!styles) continue;
    for (const [structure, style, order] of [
      ['tunnel', styles.tunnel, 0],
      ['surface', styles.surface, 1],
      ['bridge', styles.bridge, 2],
    ] as const) {
      if (!style || style.visible === false) continue;
      contributions.push({
        kind: 'layer',
        layer: applyLineStyle(
          {
            id: `streets-transit-${name}-${structure}`,
            type: 'line',
            source,
            'source-layer': schema.layers.road,
            filter: ['all', semanticFilter, structureFilter(schema.fields.brunnel, structure)],
          },
          style,
        ),
        localOrder: baseOrder + order,
        owner: 'transit',
        slot: `transport-${structure}-fill` as TileflowLayerSlot,
        target: `transit.${name}.${structure}`,
      });
    }
  }
  return contributions;
}

function railStyle(color: string, opacity: number) {
  return {
    color,
    minZoom: 7,
    opacity,
    width: zoom.linear([
      [7, 0.5],
      [16, 2.4],
    ]),
  };
}

function railHatchingStyle(color: string, opacity: number) {
  return {
    color,
    dash: [1, 2],
    minZoom: 10,
    opacity,
    width: zoom.linear([
      [10, 0.5],
      [16, 1.2],
    ]),
  };
}

function serviceRailStyle(color: string, opacity: number) {
  return {
    color,
    minZoom: 12,
    opacity,
    width: zoom.linear([
      [12, 0.35],
      [16, 1.4],
    ]),
  };
}

function structureFilter(field: string, structure: 'bridge' | 'surface' | 'tunnel'): unknown[] {
  return structure === 'surface'
    ? ['match', ['get', field], ['tunnel', 'bridge'], false, true]
    : ['==', ['get', field], structure];
}
