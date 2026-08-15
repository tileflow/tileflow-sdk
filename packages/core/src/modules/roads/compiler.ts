import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution, TileflowLayerSlot} from '../../cartography/contributions';
import {applyLineStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression, toMapLibreStyleValue, zoom} from '../../cartography/values';
import {textFont} from '../../themes';
import type {
  TileflowRoadAreaStyle,
  TileflowRoadClass,
  TileflowRoadClassStyle,
  TileflowRoadLayerStyle,
  TileflowRoadsModuleConfig,
  TileflowRoadStructure,
  TileflowRoadTreatmentLineStyle,
  TileflowRoadTreatmentStyle,
} from '../../types';
import {resolveRoads, roadStyleMetrics, visibleRoadClasses} from './index';
import {
  isTileflowPathRoadClass,
  tileflowPathRoadClasses,
  tileflowRoadClassFilter,
  tileflowRoadConstructionClasses,
} from './semantics';

const roadClassOrder: readonly TileflowRoadClass[] = [
  ...tileflowPathRoadClasses,
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

const serviceTypeValues = {
  alley: 'alley',
  crossover: 'crossover',
  driveway: 'driveway',
  parkingAisle: 'parking_aisle',
  yard: 'yard',
} as const;

const treatmentPaintDefaults = {
  blur: 0,
  color: '#000000',
  dash: [1, 0] as readonly number[],
  gapWidth: 0,
  offset: 0,
  opacity: 1,
  width: 1,
} as const;

type RoadTreatmentEntry = {
  condition: unknown[];
  style: TileflowRoadTreatmentStyle;
};
type ConditionalBranch = {
  condition: unknown[];
  resolve: (baseOutput: unknown) => unknown;
};

export function compileRoads(
  request: TileflowRoadsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolveRoads(request);
  const visible = new Set<TileflowRoadClass>(visibleRoadClasses(semantics));
  const metrics = roadStyleMetrics(semantics);

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
    const treatments = resolveRoadTreatments(request, schema.fields, roadClass);

    for (const structure of ['tunnel', 'surface', 'bridge'] as const) {
      const structureConfig = classConfig[structure];
      if (!structureConfig) continue;
      for (const [phaseIndex, phase] of (['shadow', 'casing', 'fill'] as const).entries()) {
        const style = structureConfig[phase];
        if (!style || style.visible === false) continue;
        const treatedStyle = applyRoadTreatments(style, treatments, structure, phase);
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
                tileflowRoadClassFilter(schema.fields, roadClass),
                structureFilter(schema.fields.brunnel, structure),
              ],
              layout: {
                'line-sort-key': [
                  'coalesce',
                  ['get', schema.fields.layer],
                  ['get', schema.fields.level],
                  0,
                ],
              },
            },
            treatedStyle,
          ),
          localOrder: classIndex * 10 + phaseIndex,
          owner: 'roads',
          slot: structureSlots[structure][phase],
          target: `roads.classes.${roadClass}.${structure}.${phase}`,
        });
      }
    }
  }

  const areaStyles = mergeTileflowDesign<TileflowRoadAreaStyle>(
    {
      road: {fill: {color: context.colors.road, minZoom: 13, opacity: 0.9}},
      pedestrian: {
        fill: {color: context.colors.road, minZoom: 13, opacity: 1},
        outline: {color: context.colors.roads.casing, minZoom: 13, width: 1},
      },
      pier: {
        fill: {color: context.colors.land, minZoom: 12, opacity: 1},
        outline: {color: context.colors.roads.casing, minZoom: 12, width: 1},
      },
    },
    request?.areas,
  );
  const areaTargets = [
    {
      id: 'streets-road-area',
      filter: ['==', ['geometry-type'], 'Polygon'],
      name: 'road',
      style: areaStyles.road,
    },
    {
      id: 'streets-road-pedestrian-area',
      filter: [
        'all',
        ['==', ['geometry-type'], 'Polygon'],
        tileflowRoadClassFilter(schema.fields, 'pedestrian'),
      ],
      name: 'pedestrian',
      style: areaStyles.pedestrian,
    },
    {
      id: 'streets-road-pier-area',
      filter: ['==', ['get', schema.fields.class], 'pier'],
      name: 'pier',
      style: areaStyles.pier,
    },
  ] as const;
  let areaOrder = 900;
  for (const target of areaTargets) {
    if (!target.style) continue;
    for (const area of createAreaLayers(
      {
        id: target.id,
        type: 'fill',
        source,
        'source-layer': schema.layers.road,
        filter: target.filter,
      },
      target.style,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: areaOrder++,
        owner: 'roads',
        slot: 'transport-surface-fill',
        target: `roads.areas.${target.name}.${area.phase}`,
      });
    }
  }

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
          'text-font': textFont(context.typography, 'roads'),
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

function resolveRoadTreatments(
  request: TileflowRoadsModuleConfig | undefined,
  fields: TileflowDomainCompileContext['data']['schema']['fields'],
  roadClass: TileflowRoadClass,
): RoadTreatmentEntry[] {
  const entries: RoadTreatmentEntry[] = [];
  const add = (style: TileflowRoadTreatmentStyle | undefined, condition: unknown[]) => {
    if (style && style.enabled !== false) entries.push({condition, style});
  };

  add(request?.modifiers?.construction, [
    'match',
    ['get', fields.class],
    tileflowRoadConstructionClasses,
    true,
    false,
  ]);
  add(request?.restrictions?.bicycle, restrictedAccessFilter(fields.bicycle));
  add(request?.restrictions?.foot, restrictedAccessFilter(fields.foot));
  add(request?.restrictions?.horse, restrictedAccessFilter(fields.horse));
  add(request?.restrictions?.access, restrictedAccessFilter(fields.access));
  add(request?.restrictions?.toll, flagFilter(fields.toll));
  add(request?.modifiers?.expressway, flagFilter(fields.expressway));
  add(request?.modifiers?.ramp, flagFilter(fields.ramp));
  add(request?.modifiers?.unpaved, ['==', ['get', fields.surface], 'unpaved']);
  add(request?.modifiers?.indoor, flagFilter(fields.indoor));
  add(request?.modifiers?.official, flagFilter(fields.official));

  for (const [scale, style] of Object.entries(request?.mountainBike ?? {})) {
    add(style, ['==', ['to-string', ['get', fields.mtbScale]], scale]);
  }

  if (roadClass === 'service') {
    for (const [serviceType, value] of Object.entries(serviceTypeValues)) {
      add(request?.serviceTypes?.[serviceType as keyof typeof serviceTypeValues], [
        '==',
        ['get', fields.service],
        value,
      ]);
    }
  }

  return entries;
}

function applyRoadTreatments(
  base: TileflowRoadLayerStyle[keyof TileflowRoadLayerStyle] & object,
  treatments: readonly RoadTreatmentEntry[],
  structure: TileflowRoadStructure,
  phase: 'casing' | 'fill' | 'shadow',
): typeof base {
  const result = {...base} as Record<string, unknown>;
  const paintProperties = [
    'blur',
    'color',
    'dash',
    'gapWidth',
    'offset',
    'opacity',
    'width',
  ] as const satisfies readonly (keyof TileflowRoadTreatmentLineStyle)[];

  for (const property of paintProperties) {
    const branches = treatments.flatMap(({condition, style}) => {
      const value = style[structure]?.[phase]?.[property];
      return value === undefined
        ? []
        : [{condition, resolve: () => expressionOutput(value)} satisfies ConditionalBranch];
    });
    if (branches.length > 0) {
      result[property] = conditionalStyleValue(
        result[property],
        branches,
        treatmentPaintDefaults[property],
      );
    }
  }

  const widthBranches = treatments.flatMap(({condition, style}) =>
    style.widthScale === undefined
      ? []
      : [
          {
            condition,
            resolve: (baseOutput: unknown) => ['*', expressionOutput(baseOutput), style.widthScale],
          } satisfies ConditionalBranch,
        ],
  );
  if (widthBranches.length > 0) {
    result.width = conditionalStyleValue(result.width, widthBranches, treatmentPaintDefaults.width);
  }

  return result as typeof base;
}

function conditionalStyleValue(
  base: unknown,
  branches: readonly ConditionalBranch[],
  fallback: unknown,
) {
  const resolvedBase = toMapLibreStyleValue((base ?? fallback) as never);
  return expression(
    rewriteZoomOutputs(resolvedBase, (baseOutput) => [
      'case',
      ...branches.flatMap(({condition, resolve}) => [condition, resolve(baseOutput)]),
      expressionOutput(baseOutput),
    ]),
  );
}

function rewriteZoomOutputs(
  value: unknown,
  rewrite: (output: unknown) => unknown,
): readonly unknown[] {
  if (!Array.isArray(value)) return rewrite(value) as readonly unknown[];
  if (value[0] === 'interpolate' && isZoomInput(value[2])) {
    return value.map((entry, index) => (index >= 4 && index % 2 === 0 ? rewrite(entry) : entry));
  }
  if (value[0] === 'step' && isZoomInput(value[1])) {
    return value.map((entry, index) =>
      index === 2 || (index >= 4 && index % 2 === 0) ? rewrite(entry) : entry,
    );
  }
  return rewrite(value) as readonly unknown[];
}

function expressionOutput(value: unknown): unknown {
  return Array.isArray(value) && typeof value[0] !== 'string' ? ['literal', value] : value;
}

function isZoomInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

function restrictedAccessFilter(field: string): unknown[] {
  return [
    'all',
    ['has', field],
    [
      '!',
      [
        'match',
        ['get', field],
        ['yes', 'designated', 'official', 'permissive', 'unknown'],
        true,
        false,
      ],
    ],
  ];
}

function flagFilter(field: string): unknown[] {
  return ['==', ['get', field], 1];
}

function defaultClassStyles(
  context: TileflowDomainCompileContext,
  metrics: ReturnType<typeof roadStyleMetrics>,
  options: ReturnType<typeof resolveRoads>,
): Record<TileflowRoadClass, TileflowRoadClassStyle> {
  return Object.fromEntries(
    roadClassOrder.map((roadClass) => {
      const fillColor = roadColor(context, roadClass);
      const minor =
        isTileflowPathRoadClass(roadClass) || ['track', 'service', 'minor'].includes(roadClass);
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
  if (isTileflowPathRoadClass(roadClass) || roadClass === 'track') {
    return context.colors.roads.path;
  }
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
    pathway: [
      [13, 0.3],
      [16, 1.4],
    ],
    footway: [
      [13, 0.25],
      [16, 1.2],
    ],
    cycleway: [
      [13, 0.3],
      [16, 1.5],
    ],
    steps: [
      [14, 0.35],
      [16, 1.4],
    ],
    pedestrian: [
      [13, 0.5],
      [16, 3.4],
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

function structureFilter(field: string, structure: TileflowRoadStructure): unknown[] {
  if (structure === 'surface') {
    return ['match', ['get', field], ['tunnel', 'bridge'], false, true];
  }
  return ['==', ['get', field], structure];
}
