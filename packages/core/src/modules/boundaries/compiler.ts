import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyLineStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {TileflowBoundariesModuleConfig} from './index';

export function compileBoundaries(
  request: TileflowBoundariesModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowBoundariesModuleConfig>(
    {
      type: 'boundaries',
      enabled: true,
      admin2: {
        color: context.colors.boundaries.major,
        minZoom: 1,
        opacity: 0.65,
        width: zoom.linear([
          [1, 0.5],
          [8, 1.4],
        ]),
      },
      admin4: {
        color: context.colors.boundaries.admin,
        dash: [3, 2],
        minZoom: 4,
        opacity: 0.4,
        width: zoom.linear([
          [4, 0.35],
          [10, 1],
        ]),
      },
      disputed: {
        color: context.colors.boundaries.disputed,
        dash: [2, 2],
        minZoom: 2,
        opacity: 0.8,
        width: zoom.linear([
          [2, 0.6],
          [8, 1.3],
        ]),
      },
      maritime: {
        color: context.colors.boundaries.maritime,
        dash: [2, 2],
        minZoom: 1,
        opacity: 0.5,
        width: zoom.linear([
          [1, 0.4],
          [8, 1],
        ]),
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const {sourceId: source, schema} = context.data;
  const targets = [
    ['admin4', config.admin4, ['==', ['to-number', ['get', schema.fields.adminLevel]], 4]],
    ['admin2', config.admin2, ['==', ['to-number', ['get', schema.fields.adminLevel]], 2]],
    ['disputed', config.disputed, ['==', ['get', schema.fields.disputed], 1]],
    ['maritime', config.maritime, ['==', ['get', schema.fields.class], 'maritime']],
  ] as const;

  return targets.flatMap(([name, style, targetFilter], index) => {
    if (!style || style.visible === false) return [];
    return [
      {
        kind: 'layer' as const,
        layer: applyLineStyle(
          {
            id: `streets-boundary-${name}`,
            type: 'line',
            source,
            'source-layer': schema.layers.boundary,
            filter: targetFilter,
          },
          style,
        ),
        localOrder: index,
        owner: 'boundaries' as const,
        slot: 'boundaries' as const,
        target: `boundaries.${name}`,
      },
    ];
  });
}
