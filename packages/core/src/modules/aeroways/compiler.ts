import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyLineStyle, applySymbolStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression, zoom} from '../../cartography/values';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {TileflowAerowaysModuleConfig} from './index';

export function compileAeroways(
  request: TileflowResolvedModuleConfig<TileflowAerowaysModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowAerowaysModuleConfig>>(
    {
      type: 'aeroways',
      enabled: true,
      area: {fill: {color: context.colors.road, minZoom: 10, opacity: 0.42}},
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
      runwayRef: {
        minZoom: 14,
        placement: 'line-center',
        priority: 70,
        text: {
          allowOverlap: false,
          color: context.colors.labels.road,
          ...typographyTextStyle(context.typography.roads),
          haloColor: context.colors.labels.halo,
          haloWidth: 1.5,
          keepUpright: true,
          optional: true,
          padding: 6,
          size: zoom.linear([
            [14, 10],
            [18, 13],
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
  if (config.area) {
    for (const area of createAreaLayers(
      {
        id: 'tileflow-aeroway-area',
        type: 'fill',
        source,
        'source-layer': schema.layers.aeroway,
        filter: ['==', ['geometry-type'], 'Polygon'],
      },
      config.area,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? 0 : 1,
        owner: 'aeroways',
        slot: 'aeroways',
        target: `aeroways.area.${area.phase}`,
      });
    }
  }

  for (const [name, target, order] of [
    ['taxiway', config.taxiway, 10],
    ['runway', config.runway, 20],
  ] as const) {
    for (const [phase, style, phaseOrder] of [
      ['shadow', target?.shadow, 0],
      ['casing', target?.casing, 1],
      ['fill', target?.fill, 2],
    ] as const) {
      if (!style || style.visible === false) continue;
      contributions.push({
        kind: 'layer',
        layer: applyLineStyle(
          {
            id: `tileflow-aeroway-${name}-${phase}`,
            type: 'line',
            source,
            'source-layer': schema.layers.aeroway,
            filter: [
              'all',
              ['==', ['geometry-type'], 'LineString'],
              ['==', ['get', schema.fields.class], name],
            ],
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

  const runwayRef = config.runwayRef;
  if (runwayRef && runwayRef.visible !== false && runwayRef.text?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applySymbolStyle(
        {
          id: 'tileflow-aeroway-runway-ref',
          type: 'symbol',
          source,
          'source-layer': schema.layers.aeroway,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['get', schema.fields.class], 'runway'],
            ['has', schema.fields.ref],
          ],
        },
        mergeTileflowDesign(runwayRef, {
          text: {field: expression<string>(['to-string', ['get', schema.fields.ref]])},
        }),
      ),
      localOrder: 650,
      owner: 'aeroways',
      slot: 'symbols',
      target: 'aeroways.runwayRef',
    });
  }
  return contributions;
}
