import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyExtrusionStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression} from '../../cartography/values';
import type {TileflowBuildingsModuleConfig} from './index';

export function compileBuildings(
  request: TileflowBuildingsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const {colors} = context;
  const config = mergeTileflowDesign<TileflowBuildingsModuleConfig>(
    {
      type: 'buildings',
      enabled: true,
      mode: 'flat',
      flat: {
        fill: {color: colors.buildings.fill, minZoom: 13, opacity: 0.5},
        outline: {color: colors.buildings.outline, minZoom: 15, opacity: 0.24, width: 0.6},
      },
      extrusion: {
        base: expression<number>([
          'coalesce',
          ['get', context.data.schema.fields.renderMinHeight],
          ['get', context.data.schema.fields.minHeight],
          0,
        ]),
        color: colors.buildings.extrusion,
        height: expression<number>([
          'coalesce',
          ['get', context.data.schema.fields.renderHeight],
          ['get', context.data.schema.fields.height],
          18,
        ]),
        minZoom: 14,
        opacity: 0.72,
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const sourceLayer = context.data.schema.layers.building;

  if (config.mode === '3d') {
    const style = config.extrusion ?? {};
    return [
      {
        kind: 'layer',
        layer: applyExtrusionStyle(
          {
            id: 'streets-buildings-3d',
            type: 'fill-extrusion',
            source,
            'source-layer': sourceLayer,
            filter: ['!=', ['get', context.data.schema.fields.hide3d], true],
          },
          style,
        ),
        localOrder: 0,
        owner: 'buildings',
        slot: 'buildings',
        target: 'buildings.extrusion',
      },
    ];
  }

  const contributions: TileflowLayerContribution[] = [];
  for (const area of createAreaLayers(
    {
      id: 'streets-buildings-fill',
      type: 'fill',
      source,
      'source-layer': sourceLayer,
    },
    config.flat ?? {},
  )) {
    contributions.push({
      kind: 'layer',
      layer: area.layer,
      localOrder: area.phase === 'fill' ? 0 : 1,
      owner: 'buildings',
      slot: 'buildings',
      target: `buildings.flat.${area.phase}`,
    });
  }
  return contributions;
}
