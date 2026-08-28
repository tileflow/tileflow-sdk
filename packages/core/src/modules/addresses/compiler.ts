import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applySymbolStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowSymbolStyle} from '../../cartography/styles';
import {expression} from '../../cartography/values';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {TileflowAddressesModuleConfig} from './index';

export function compileAddresses(
  request: TileflowResolvedModuleConfig<TileflowAddressesModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];

  const typography = context.typography.roads;
  const style = mergeTileflowDesign<TileflowSymbolStyle>(
    {
      minZoom: 17,
      placement: 'point' as const,
      priority: 10,
      text: {
        allowOverlap: false,
        color: context.colors.labels.muted,
        ...typographyTextStyle(typography),
        haloColor: context.colors.labels.halo,
        haloWidth: 1,
        optional: true,
        padding: 2,
        size: 10,
      },
    },
    request?.labels,
    {
      text: {
        field: expression<string>(['to-string', ['get', context.data.schema.fields.houseNumber]]),
      },
    },
  );
  if (style.visible === false || style.text?.visible === false) return [];

  const {sourceId: source, schema} = context.data;
  return [
    {
      kind: 'layer',
      layer: applySymbolStyle(
        {
          id: 'tileflow-addresses-labels',
          type: 'symbol',
          source,
          'source-layer': schema.layers.houseNumber,
          filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', schema.fields.houseNumber]],
        },
        style,
      ),
      localOrder: 950,
      owner: 'addresses',
      slot: 'symbols',
      target: 'addresses.labels',
    },
  ];
}
