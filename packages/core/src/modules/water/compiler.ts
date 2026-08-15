import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyFillStyle, applyLineStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {TileflowWaterModuleConfig, TileflowWaterwayClass} from './index';

const waterwayClasses: Record<TileflowWaterwayClass, readonly string[]> = {
  canal: ['canal'],
  other: ['ditch', 'drain'],
  river: ['river'],
  stream: ['stream'],
};

export function compileWater(
  request: TileflowWaterModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowWaterModuleConfig>(
    {
      type: 'water',
      enabled: true,
      bodies: {color: context.colors.hydro.water, opacity: 1},
      intermittent: {
        bodies: {color: context.colors.hydro.water, opacity: 0.68},
        waterways: {color: context.colors.hydro.waterway, opacity: 0.65, dash: [2, 1]},
      },
      waterways: {
        canal: {
          color: context.colors.hydro.waterway,
          width: zoom.linear([
            [8, 0.3],
            [16, 2.2],
          ]),
        },
        other: {
          color: context.colors.hydro.waterway,
          width: zoom.linear([
            [12, 0.25],
            [16, 1.2],
          ]),
        },
        river: {
          color: context.colors.hydro.waterway,
          width: zoom.linear([
            [6, 0.4],
            [16, 3.2],
          ]),
        },
        stream: {
          color: context.colors.hydro.waterway,
          width: zoom.linear([
            [10, 0.25],
            [16, 1.8],
          ]),
        },
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const {fields, layers} = context.data.schema;
  const contributions: TileflowLayerContribution[] = [];
  if (config.bodies?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-water',
          type: 'fill',
          source,
          'source-layer': layers.water,
          filter: ['!=', ['get', fields.intermittent], 1],
        },
        config.bodies ?? {},
      ),
      localOrder: 0,
      owner: 'water',
      slot: 'hydro',
      target: 'water.bodies',
    });
  }

  if (config.intermittent?.bodies?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-water-intermittent',
          type: 'fill',
          source,
          'source-layer': layers.water,
          filter: ['==', ['get', fields.intermittent], 1],
        },
        config.intermittent?.bodies ?? {},
      ),
      localOrder: 1,
      owner: 'water',
      slot: 'hydro',
      target: 'water.intermittent.bodies',
    });
  }

  let localOrder = 10;
  for (const [name, classes] of Object.entries(waterwayClasses) as Array<
    [TileflowWaterwayClass, readonly string[]]
  >) {
    const style = config.waterways?.[name];
    if (!style || style.visible === false) continue;
    contributions.push({
      kind: 'layer',
      layer: applyLineStyle(
        {
          id: `streets-waterway-${name}`,
          type: 'line',
          source,
          'source-layer': layers.waterway,
          filter: [
            'all',
            classFilter(fields.class, classes),
            ['!=', ['get', fields.intermittent], 1],
          ],
        },
        style,
      ),
      localOrder: localOrder++,
      owner: 'water',
      slot: 'hydro',
      target: `water.waterways.${name}`,
    });

    const intermittent = config.intermittent?.waterways;
    if (intermittent?.visible === false) continue;
    contributions.push({
      kind: 'layer',
      layer: applyLineStyle(
        {
          id: `streets-waterway-${name}-intermittent`,
          type: 'line',
          source,
          'source-layer': layers.waterway,
          filter: [
            'all',
            classFilter(fields.class, classes),
            ['==', ['get', fields.intermittent], 1],
          ],
        },
        mergeTileflowDesign(style, intermittent),
      ),
      localOrder: localOrder++,
      owner: 'water',
      slot: 'hydro',
      target: `water.intermittent.waterways.${name}`,
    });
  }

  return contributions;
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}
