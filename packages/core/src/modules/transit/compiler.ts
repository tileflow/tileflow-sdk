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
        color: context.colors.roads.rail,
        minZoom: 7,
        opacity: 0.72,
        width: zoom.linear([
          [7, 0.5],
          [16, 2.4],
        ]),
      },
      railHatching: {
        color: context.colors.background,
        dash: [1, 2],
        minZoom: 10,
        width: zoom.linear([
          [10, 0.5],
          [16, 1.2],
        ]),
      },
      serviceRail: {
        color: context.colors.roads.rail,
        minZoom: 12,
        opacity: 0.5,
        width: zoom.linear([
          [12, 0.35],
          [16, 1.4],
        ]),
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
  const targets = [
    [
      'ferry',
      config.ferry,
      ['==', ['get', schema.fields.class], 'ferry'],
      'transport-surface-fill',
      1000,
    ],
    ['rail', config.rail, railFilter, 'transport-surface-fill', 1010],
    ['rail-hatching', config.railHatching, railFilter, 'transport-surface-fill', 1011],
    [
      'service-rail',
      config.serviceRail,
      ['all', ['==', ['get', schema.fields.class], 'rail'], ['has', schema.fields.service]],
      'transport-surface-fill',
      1020,
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
    typeof config.rail,
    readonly unknown[],
    TileflowLayerSlot,
    number,
  ])[];

  return targets.flatMap(([name, style, targetFilter, slot, localOrder]) => {
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
  });
}
