import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution, TileflowLayerSlot} from '../../cartography/contributions';
import {applyFillStyle, applyLineStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {zoom} from '../../cartography/values';
import type {
  TileflowRoadClass,
  TileflowRoadClassStyle,
  TileflowRoadLayerStyle,
  TileflowRoadsModuleConfig,
  TileflowRoadStructure,
} from '../../types';
import {resolveRoads, roadClassesForDetail, roadStyleMetrics} from './index';

const roadClassOrder: readonly TileflowRoadClass[] = [
  'path',
  'track',
  'service',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
];

const structureSlots: Record<
  TileflowRoadStructure,
  Record<'casing' | 'fill' | 'shadow', TileflowLayerSlot>
> = {
  tunnel: {
    shadow: 'transport-tunnel-shadow',
    casing: 'transport-tunnel-casing',
    fill: 'transport-tunnel-fill',
  },
  surface: {
    shadow: 'transport-surface-shadow',
    casing: 'transport-surface-casing',
    fill: 'transport-surface-fill',
  },
  bridge: {
    shadow: 'transport-bridge-shadow',
    casing: 'transport-bridge-casing',
    fill: 'transport-bridge-fill',
  },
};

export function compileRoads(
  request: TileflowRoadsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolveRoads(request);
  if (semantics.detail === 'none') return [];
  const metrics = roadStyleMetrics(semantics);
  const visible = new Set<TileflowRoadClass>(
    roadClassesForDetail(semantics.detail) as TileflowRoadClass[],
  );
  if (semantics.extras.paths) visible.add('path');

  const defaults = defaultClassStyles(context, metrics, semantics);
  const contributions: TileflowLayerContribution[] = [];
  const {sourceId: source, schema} = context.data;

  for (const [classIndex, roadClass] of roadClassOrder.entries()) {
    if (!visible.has(roadClass) || request?.classes?.[roadClass]?.enabled === false) continue;
    const classConfig = mergeTileflowDesign<TileflowRoadClassStyle>(
      defaults[roadClass],
      Object.fromEntries(
        (['tunnel', 'surface', 'bridge'] as const).map((structure) => [
          structure,
          request?.structures?.[structure],
        ]),
      ),
      request?.classes?.[roadClass],
    );

    for (const structure of ['tunnel', 'surface', 'bridge'] as const) {
      const structureConfig = classConfig[structure];
      if (!structureConfig) continue;
      for (const [phaseIndex, phase] of (['shadow', 'casing', 'fill'] as const).entries()) {
        const style = structureConfig[phase];
        if (!style || style.visible === false) continue;
        contributions.push({
          kind: 'layer',
          layer: applyLineStyle(
            {
              id: `streets-road-${structure}-${roadClass}-${phase}`,
              type: 'line',
              source,
              'source-layer': schema.layers.road,
              filter: [
                'all',
                classFilter(schema.fields.class, roadClass),
                structureFilter(schema.fields.brunnel, structure),
              ],
            },
            style,
          ),
          localOrder: classIndex * 10 + phaseIndex,
          owner: 'roads',
          slot: structureSlots[structure][phase],
          target: `roads.classes.${roadClass}.${structure}.${phase}`,
        });
      }
    }
  }

  const areaStyles = mergeTileflowDesign(
    {
      road: {color: context.colors.road, minZoom: 13, opacity: 0.9},
      pier: {color: context.colors.land, minZoom: 12, opacity: 1},
      pierLine: {color: context.colors.roads.casing, minZoom: 12, width: 1},
    },
    request?.areas,
  );
  contributions.push(
    {
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-road-area',
          type: 'fill',
          source,
          'source-layer': schema.layers.road,
          filter: ['==', ['geometry-type'], 'Polygon'],
        },
        areaStyles.road,
      ),
      localOrder: 900,
      owner: 'roads',
      slot: 'transport-surface-fill',
      target: 'roads.areas.road',
    },
    {
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: 'streets-road-pier-area',
          type: 'fill',
          source,
          'source-layer': schema.layers.road,
          filter: ['==', ['get', schema.fields.class], 'pier'],
        },
        areaStyles.pier,
      ),
      localOrder: 901,
      owner: 'roads',
      slot: 'transport-surface-fill',
      target: 'roads.areas.pier',
    },
    {
      kind: 'layer',
      layer: applyLineStyle(
        {
          id: 'streets-road-pier-line',
          type: 'line',
          source,
          'source-layer': schema.layers.road,
          filter: ['==', ['get', schema.fields.class], 'pier'],
        },
        areaStyles.pierLine,
      ),
      localOrder: 902,
      owner: 'roads',
      slot: 'transport-surface-fill',
      target: 'roads.areas.pierLine',
    },
  );

  if (semantics.oneWayMarkers) {
    contributions.push({
      kind: 'layer',
      layer: {
        id: 'streets-road-oneway',
        type: 'symbol',
        source,
        'source-layer': schema.layers.road,
        minzoom: 15,
        filter: ['match', ['get', schema.fields.oneway], [1, -1], true, false],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 120,
          'text-field': ['case', ['==', ['get', schema.fields.oneway], -1], '‹', '›'],
          'text-size': 12,
        },
        paint: {'text-color': context.colors.labels.road},
      },
      localOrder: 100,
      owner: 'roads',
      slot: 'symbols',
      target: 'roads.oneWayMarkers',
    });
  }

  return contributions;
}

function defaultClassStyles(
  context: TileflowDomainCompileContext,
  metrics: ReturnType<typeof roadStyleMetrics>,
  options: ReturnType<typeof resolveRoads>,
): Record<TileflowRoadClass, TileflowRoadClassStyle> {
  return Object.fromEntries(
    roadClassOrder.map((roadClass) => {
      const fillColor = roadColor(context, roadClass);
      const minor = ['path', 'track', 'service', 'minor'].includes(roadClass);
      const width = roadWidth(
        roadClass,
        metrics.weightScale *
          (minor ? metrics.minorWidthScale : metrics.majorWidthScale) *
          (options.widthScale?.[roadClass] ?? 1),
      );
      const opacity = minor ? metrics.minorOpacity : metrics.majorOpacity;
      const outlineOpacity = metrics.outlineOpacity;
      const base: TileflowRoadLayerStyle = {
        ...(outlineOpacity > 0
          ? {
              casing: {
                cap: 'round',
                color: context.colors.roads.casing,
                join: 'round',
                opacity: outlineOpacity,
                width: widen(width, 1.3),
              },
            }
          : {}),
        fill: {cap: 'round', color: fillColor, join: 'round', opacity, width},
      };
      return [
        roadClass,
        {
          surface: base,
          tunnel: mergeTileflowDesign(base, {
            casing: {color: context.colors.roads.tunnel, dash: [2, 1], opacity: 0.45},
            fill: {dash: [2, 1], opacity: opacity * 0.45},
          }),
          bridge: mergeTileflowDesign(base, {
            casing: {opacity: Math.max(outlineOpacity, 0.35)},
            fill: {color: context.colors.roads.bridge},
          }),
        },
      ];
    }),
  ) as Record<TileflowRoadClass, TileflowRoadClassStyle>;
}

function roadColor(context: TileflowDomainCompileContext, roadClass: TileflowRoadClass): string {
  if (roadClass === 'motorway') return context.colors.roads.motorway;
  if (roadClass === 'trunk') return context.colors.roads.trunk;
  if (roadClass === 'primary') return context.colors.roads.primary;
  if (roadClass === 'secondary' || roadClass === 'tertiary') {
    return context.colors.roads.secondary;
  }
  if (roadClass === 'path' || roadClass === 'track') return context.colors.roads.path;
  return context.colors.roads.minor;
}

function roadWidth(roadClass: TileflowRoadClass, scale: number) {
  const stops: Record<TileflowRoadClass, readonly (readonly [number, number])[]> = {
    motorway: [
      [5, 0.7],
      [10, 1.8],
      [16, 8],
    ],
    trunk: [
      [6, 0.6],
      [10, 1.6],
      [16, 7],
    ],
    primary: [
      [7, 0.5],
      [12, 2],
      [16, 6],
    ],
    secondary: [
      [9, 0.4],
      [13, 1.8],
      [16, 5],
    ],
    tertiary: [
      [10, 0.35],
      [14, 1.6],
      [16, 4.5],
    ],
    minor: [
      [12, 0.5],
      [16, 3.5],
    ],
    service: [
      [14, 0.4],
      [16, 2.4],
    ],
    track: [
      [13, 0.35],
      [16, 1.8],
    ],
    path: [
      [13, 0.3],
      [16, 1.4],
    ],
  };
  return zoom.linear(stops[roadClass].map(([z, value]) => [z, value * scale] as const));
}

function widen(
  value: ReturnType<typeof roadWidth>,
  addition: number,
): ReturnType<typeof roadWidth> {
  return zoom.linear(value.stops.map(([z, width]) => [z, width + addition] as const));
}

function classFilter(field: string, roadClass: TileflowRoadClass): unknown[] {
  const classes =
    roadClass === 'minor'
      ? ['minor', 'residential', 'unclassified']
      : roadClass === 'service'
        ? ['service']
        : [roadClass];
  return ['match', ['get', field], classes, true, false];
}

function structureFilter(field: string, structure: TileflowRoadStructure): unknown[] {
  if (structure === 'surface') {
    return ['match', ['get', field], ['tunnel', 'bridge'], false, true];
  }
  return ['==', ['get', field], structure];
}
