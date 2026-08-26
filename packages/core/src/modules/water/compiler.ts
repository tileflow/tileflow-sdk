import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyFillStyle, applyLineStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression, zoom} from '../../cartography/values';
import {mix} from '../../themes';
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
      bodies: {fill: {color: context.colors.hydro.water, opacity: 1}},
      intermittent: {
        bodies: {fill: {color: context.colors.hydro.water, opacity: 0.68}},
        waterways: {color: context.colors.hydro.waterway, opacity: 0.65, dash: [2, 1]},
      },
      waterways: {
        canal: {
          color: context.colors.hydro.waterway,
          minZoom: 8,
          width: zoom.linear([
            [8, 0.3],
            [16, 2.2],
          ]),
        },
        other: {
          color: context.colors.hydro.waterway,
          minZoom: 12,
          width: zoom.linear([
            [12, 0.25],
            [16, 1.2],
          ]),
        },
        river: {
          color: context.colors.hydro.waterway,
          minZoom: 6,
          width: zoom.linear([
            [6, 0.4],
            [16, 3.2],
          ]),
        },
        stream: {
          color: context.colors.hydro.waterway,
          minZoom: 10,
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
  if (config.bodies) {
    for (const area of createAreaLayers(
      {
        id: 'streets-water',
        type: 'fill',
        source,
        'source-layer': layers.water,
        filter: ['!=', ['get', fields.intermittent], 1],
      },
      config.bodies,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? 0 : 1,
        owner: 'water',
        slot: 'hydro',
        target: `water.bodies.${area.phase}`,
      });
    }
  }

  if (config.intermittent?.bodies) {
    for (const area of createAreaLayers(
      {
        id: 'streets-water-intermittent',
        type: 'fill',
        source,
        'source-layer': layers.water,
        filter: ['==', ['get', fields.intermittent], 1],
      },
      config.intermittent.bodies,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? 3 : 4,
        owner: 'water',
        slot: 'hydro',
        target: `water.intermittent.bodies.${area.phase}`,
      });
    }
  }

  const bathymetryLayer = layers.bathymetry;
  const bathymetryDepthField = fields.bathymetryMinDepth;
  const bathymetrySortField = fields.bathymetrySortKey;
  if (bathymetryLayer && bathymetryDepthField && bathymetrySortField) {
    const waterColor =
      typeof config.bodies?.fill?.color === 'string'
        ? config.bodies.fill.color
        : context.colors.hydro.water;
    const deepWater = mix(waterColor, '#000000', 0.18);
    const bathymetry = mergeTileflowDesign(
      {
        antialias: false,
        color: expression<string>([
          'match',
          ['to-number', ['get', bathymetryDepthField], 0],
          0,
          waterColor,
          -200,
          mix(waterColor, deepWater, 0.2),
          -1000,
          mix(waterColor, deepWater, 0.4),
          -2000,
          mix(waterColor, deepWater, 0.6),
          -4000,
          mix(waterColor, deepWater, 0.8),
          -6000,
          deepWater,
          waterColor,
        ]),
        maxZoom: 10,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.84],
          [7, 0.76],
          [9, 0.56],
          [10, 0],
        ]),
        visible: config.bodies?.fill?.visible !== false,
      },
      config.bathymetry,
    );
    if (bathymetry.visible !== false) {
      contributions.push({
        kind: 'layer',
        layer: applyFillStyle(
          {
            id: 'streets-bathymetry',
            type: 'fill',
            source,
            'source-layer': bathymetryLayer,
            layout: {
              'fill-sort-key': ['to-number', ['get', bathymetrySortField], 0],
            },
          },
          bathymetry,
        ),
        localOrder: 2,
        owner: 'water',
        slot: 'hydro',
        target: 'water.bathymetry',
      });
    }
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
