import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyFillStyle, applyLineStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {TileflowAerowaysModuleConfig} from './index';

export function compileAeroways(
  request: TileflowAerowaysModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowAerowaysModuleConfig>(
    {
      type: 'aeroways',
      enabled: true,
      area: {color: context.colors.road, minZoom: 10, opacity: 0.42},
      runway: {
        casing: {
          color: context.colors.roads.casing,
          minZoom: 8,
          width: zoom.linear([
            [8, 2],
            [16, 18],
          ]),
        },
        fill: {
          color: context.colors.road,
          minZoom: 8,
          width: zoom.linear([
            [8, 1],
            [16, 16],
          ]),
        },
      },
      taxiway: {
        casing: {
          color: context.colors.roads.casing,
          minZoom: 11,
          width: zoom.linear([
            [11, 1],
            [16, 7],
          ]),
        },
        fill: {
          color: context.colors.road,
          minZoom: 11,
          width: zoom.linear([
            [11, 0.5],
            [16, 5],
          ]),
        },
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const {sourceId: source, schema} = context.data;
  const contributions: TileflowLayerContribution[] = [];
  if (config.area?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-aeroway-area',
          type: 'fill',
          source,
          'source-layer': schema.layers.aeroway,
          filter: ['==', ['geometry-type'], 'Polygon'],
        },
        config.area ?? {},
      ),
      localOrder: 0,
      owner: 'aeroways',
      slot: 'aeroways',
      target: 'aeroways.area',
    });
  }

  for (const [name, target, order] of [
    ['taxiway', config.taxiway, 10],
    ['runway', config.runway, 20],
  ] as const) {
    for (const [phase, style, phaseOrder] of [
      ['casing', target?.casing, 0],
      ['fill', target?.fill, 1],
    ] as const) {
      if (!style || style.visible === false) continue;
      contributions.push({
        kind: 'layer',
        layer: applyLineStyle(
          {
            id: `streets-aeroway-${name}-${phase}`,
            type: 'line',
            source,
            'source-layer': schema.layers.aeroway,
            filter: ['==', ['get', schema.fields.class], name],
          },
          style,
        ),
        localOrder: order + phaseOrder,
        owner: 'aeroways',
        slot: 'aeroways',
        target: `aeroways.${name}.${phase}`,
      });
    }
  }
  return contributions;
}
