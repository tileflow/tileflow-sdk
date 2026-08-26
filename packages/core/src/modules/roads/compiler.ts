import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution, TileflowLayerSlot} from '../../cartography/contributions';
import {
  applyCircleStyle,
  applyFillStyle,
  applyIconStyle,
  applyLineStyle,
  createAreaLayers,
} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowLineStyle} from '../../cartography/styles';
import {expression, toMapLibreStyleValue, zoom} from '../../cartography/values';
import {textFont} from '../../themes';
import type {
  TileflowRoadAreaStyle,
  TileflowRoadClass,
  TileflowRoadClassStyle,
  TileflowRoadCrossingStyle,
  TileflowRoadLayerStyle,
  TileflowRoadRoundaboutStyle,
  TileflowRoadSidewalkStyle,
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
type WidthScaleEntry = {
  condition: unknown[];
  scale: number;
};

const fixedRoadBorderVariable = '__tileflow_fixed_road_border';

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
      const filter = [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        tileflowRoadClassFilter(schema.fields, roadClass),
        structureFilter(schema.fields.brunnel, structure),
      ];
      for (const [phaseIndex, phase] of (['shadow', 'casing', 'fill'] as const).entries()) {
        const style = structureConfig[phase];
        if (style?.visible === false) continue;
        const materializingConditions = style
          ? []
          : roadTreatmentPhaseConditions(treatments, structure, phase);
        if (!style && materializingConditions.length === 0) continue;
        const treatedStyle = applyRoadTreatments(style ?? {}, treatments, structure, phase);
        contributions.push({
          kind: 'layer',
          layer: applyLineStyle(
            {
              id: `streets-road-${structure}-${roadClass}-${phase}`,
              type: 'line',
              source,
              'source-layer': schema.layers.road,
              filter:
                materializingConditions.length === 0
                  ? filter
                  : [
                      ...filter,
                      materializingConditions.length === 1
                        ? materializingConditions[0]
                        : ['any', ...materializingConditions],
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

      const hatch = structureConfig.hatch;
      const fill = structureConfig.fill;
      if (hatch && hatch.visible !== false && fill && fill.visible !== false) {
        const treatedFill = applyRoadTreatments(fill, treatments, structure, 'fill');
        const size =
          hatch.size === undefined
            ? scaleStyleValue(treatedFill.width ?? 1, 0.68)
            : toMapLibreStyleValue(hatch.size as never);
        const minZoom = hatch.minZoom ?? treatedFill.minZoom;
        const maxZoom = hatch.maxZoom ?? treatedFill.maxZoom;

        if (hatch.pattern !== undefined) {
          const pattern =
            hatch.patternWidths === undefined
              ? hatch.pattern
              : widthMatchedHatchPattern(
                  hatch.pattern,
                  hatch.patternWidths,
                  treatedFill.width ?? 1,
                  minZoom,
                  maxZoom,
                );
          contributions.push({
            kind: 'layer',
            layer: applyLineStyle(
              {
                id: `streets-road-${structure}-${roadClass}-hatch`,
                type: 'line',
                source,
                'source-layer': schema.layers.road,
                filter,
                layout: {
                  'line-sort-key': [
                    'coalesce',
                    ['get', schema.fields.layer],
                    ['get', schema.fields.level],
                    0,
                  ],
                },
              },
              {
                cap: 'butt',
                join: 'round',
                ...(minZoom === undefined ? {} : {minZoom}),
                ...(maxZoom === undefined ? {} : {maxZoom}),
                opacity: hatch.opacity ?? 1,
                pattern,
                // A line pattern is clipped by this width, so it can never
                // protrude beyond the underlying tunnel fill.
                width: treatedFill.width ?? 1,
              },
            ),
            localOrder: roadClassOrder.length * 10 + classIndex,
            owner: 'roads',
            slot: structureSlots[structure].fill,
            target: `roads.classes.${roadClass}.${structure}.hatch`,
          });
          continue;
        }

        contributions.push({
          kind: 'layer',
          layer: {
            id: `streets-road-${structure}-${roadClass}-hatch`,
            type: 'symbol',
            source,
            'source-layer': schema.layers.road,
            filter,
            ...(minZoom === undefined ? {} : {minzoom: minZoom}),
            ...(maxZoom === undefined ? {} : {maxzoom: maxZoom}),
            layout: {
              'symbol-placement': 'line',
              'symbol-sort-key': [
                'coalesce',
                ['get', schema.fields.layer],
                ['get', schema.fields.level],
                0,
              ],
              'symbol-spacing': toMapLibreStyleValue((hatch.spacing ?? 16) as never),
              'text-allow-overlap': true,
              // Rotate an ASCII vertical stroke rather than relying on the
              // box-drawing diagonal U+2571, which many glyph endpoints omit.
              // The symmetric stroke also stays centered inside the road deck.
              'text-field': '|',
              'text-font': textFont(context.typography, 'roads'),
              'text-ignore-placement': true,
              'text-keep-upright': false,
              'text-padding': 0,
              'text-pitch-alignment': 'map',
              'text-rotation-alignment': 'map',
              'text-size': size,
              ...(hatch.angle === undefined
                ? {'text-rotate': 45}
                : {'text-rotate': toMapLibreStyleValue(hatch.angle as never)}),
            },
            paint: {
              'text-color': toMapLibreStyleValue(
                (hatch.color ?? context.colors.roads.tunnel) as never,
              ),
              'text-opacity': toMapLibreStyleValue((hatch.opacity ?? 0.24) as never),
            },
          },
          // Keep every hatch above every road fill. Besides making the visual
          // stacking deterministic at class crossings, this makes equivalent
          // hatch layers contiguous so the style optimizer can safely cohort
          // them without moving across a fill pass.
          localOrder: roadClassOrder.length * 10 + classIndex,
          owner: 'roads',
          slot: structureSlots[structure].fill,
          target: `roads.classes.${roadClass}.${structure}.hatch`,
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
      filter: [
        'all',
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['get', schema.fields.class], 'pier'],
      ],
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
        slot: 'transport-areas',
        target: `roads.areas.${target.name}.${area.phase}`,
      });
    }
  }

  compileSidewalks(request?.sidewalks, context, contributions);
  compileRoundabouts(request?.roundabouts, context, contributions);
  compileCrossings(request?.crossings, context, contributions);

  if (semantics.oneWayMarkers && visible.size > 0) {
    contributions.push({
      kind: 'layer',
      layer: {
        id: 'streets-road-oneway',
        type: 'symbol',
        source,
        'source-layer': schema.layers.road,
        minzoom: 15,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['match', ['get', schema.fields.oneway], [1, -1], true, false],
          [
            'any',
            ...roadClassOrder
              .filter((roadClass) => visible.has(roadClass))
              .map((roadClass) => tileflowRoadClassFilter(schema.fields, roadClass)),
          ],
        ],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 120,
          'text-field': ['case', ['==', ['get', schema.fields.oneway], -1], '‹', '›'],
          'text-font': textFont(context.typography, 'roads'),
          // Directional glyphs must follow the encoded line direction. The
          // MapLibre default keeps line text upright by rotating it 180°, which
          // is correct for words but can reverse an arrow's meaning.
          'text-keep-upright': false,
          'text-pitch-alignment': 'map',
          'text-rotation-alignment': 'map',
          'text-size': 12,
        },
        paint: {'text-color': context.colors.labels.road},
      },
      localOrder: 100,
      owner: 'roads',
      slot: 'transport-symbols',
      target: 'roads.oneWayMarkers',
    });
  }

  return contributions;
}

function compileSidewalks(
  request: TileflowRoadSidewalkStyle | undefined,
  context: TileflowDomainCompileContext,
  contributions: TileflowLayerContribution[],
): void {
  const {fields, layers} = context.data.schema;
  if (!layers.sidewalk) return;

  const config = mergeTileflowDesign<TileflowRoadSidewalkStyle>(
    {
      surface: {
        color: context.colors.roads.casing,
        minZoom: 17,
        opacity: 0.96,
      },
    },
    request,
  );
  const base = {
    type: 'fill',
    source: context.data.sourceId,
    'source-layer': layers.sidewalk,
    filter: [
      'all',
      ['==', ['geometry-type'], 'Polygon'],
      ['match', ['get', fields.class], ['sidewalk', 'pedestrian'], true, false],
    ],
  } as const;

  if (config.surface?.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle({...base, id: 'streets-sidewalk-surface'}, config.surface ?? {}),
      localOrder: 0,
      owner: 'roads',
      slot: 'transport-pedestrian-areas',
      target: 'roads.sidewalks.surface',
    });
  }
  if (config.pattern && config.pattern.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle({...base, id: 'streets-sidewalk-pattern'}, config.pattern),
      localOrder: 1,
      owner: 'roads',
      slot: 'transport-pedestrian-areas',
      target: 'roads.sidewalks.pattern',
    });
  }
  if (config.outline && config.outline.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyLineStyle(
        {...base, id: 'streets-sidewalk-outline', type: 'line'},
        config.outline,
      ),
      localOrder: 2,
      owner: 'roads',
      slot: 'transport-pedestrian-areas',
      target: 'roads.sidewalks.outline',
    });
  }
}

function compileRoundabouts(
  request: TileflowRoadRoundaboutStyle | undefined,
  context: TileflowDomainCompileContext,
  contributions: TileflowLayerContribution[],
): void {
  const {fields, layers} = context.data.schema;
  if (
    !layers.circularFeature ||
    !fields.circularKind ||
    !fields.circularRadiusAtZoom15 ||
    !fields.circularRadiusMeters ||
    !fields.circularOuterRadiusMeters ||
    !fields.circularInnerRadiusMeters
  ) {
    return;
  }

  const circularFields: CircularRoadFields = {
    circularInnerRadiusMeters: fields.circularInnerRadiusMeters,
    circularOuterRadiusMeters: fields.circularOuterRadiusMeters,
    circularRadiusAtZoom15: fields.circularRadiusAtZoom15,
    circularRadiusMeters: fields.circularRadiusMeters,
    class: fields.class,
  };
  const radius = expression<number>(circularRoadInnerRadius(circularFields, false));
  const casingRadius = expression<number>(circularRoadInnerRadius(circularFields, true));
  const config = mergeTileflowDesign<TileflowRoadRoundaboutStyle>(
    {
      casing: {
        color: 'rgba(0, 0, 0, 0)',
        minZoom: 15,
        pitchAlignment: 'map',
        pitchScale: 'map',
        radius: casingRadius,
        strokeColor: context.colors.roads.casing,
        strokeWidth: expression<number>(circularRoadStrokeWidth(circularFields, true)),
      },
      fill: {
        color: 'rgba(0, 0, 0, 0)',
        minZoom: 15,
        pitchAlignment: 'map',
        pitchScale: 'map',
        radius,
        strokeColor: expression<string>([
          'match',
          ['coalesce', ['get', fields.class], 'minor'],
          'motorway',
          context.colors.roads.motorway,
          'trunk',
          context.colors.roads.trunk,
          'primary',
          context.colors.roads.primary,
          ['secondary', 'tertiary'],
          context.colors.roads.secondary,
          context.colors.roads.minor,
        ]),
        strokeWidth: expression<number>(circularRoadStrokeWidth(circularFields, false)),
      },
    },
    request,
  );
  const base = {
    type: 'circle',
    source: context.data.sourceId,
    'source-layer': layers.circularFeature,
    filter: ['==', ['get', fields.circularKind], 'road_ring'],
  } as const;

  if (config.casing && config.casing.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyCircleStyle({...base, id: 'streets-road-circular-casing'}, config.casing),
      localOrder: 10,
      owner: 'roads',
      slot: 'transport-symbols',
      target: 'roads.roundabouts.casing',
    });
  }
  if (config.fill && config.fill.visible !== false) {
    contributions.push({
      kind: 'layer',
      layer: applyCircleStyle({...base, id: 'streets-road-circular-fill'}, config.fill),
      localOrder: 20,
      owner: 'roads',
      slot: 'transport-symbols',
      target: 'roads.roundabouts.fill',
    });
  }
}

function compileCrossings(
  request: TileflowRoadCrossingStyle | undefined,
  context: TileflowDomainCompileContext,
  contributions: TileflowLayerContribution[],
): void {
  const {fields, layers} = context.data.schema;
  if (!request || !layers.streetFurniture || !fields.direction) return;

  const config = mergeTileflowDesign<TileflowRoadCrossingStyle>(
    {
      allowOverlap: true,
      ignorePlacement: true,
      image: request.image,
      minZoom: 15,
      opacity: zoom.linear([
        [15, 0],
        [15.5, 1],
      ]),
      padding: 0,
      pitchAlignment: 'map',
      rotate: expression<number>(['+', ['to-number', ['get', fields.direction], 0], 90]),
      rotationAlignment: 'map',
      size: zoom.linear([
        [15, 0.22],
        [16, 0.3],
        [17, 0.5],
        [18, 0.75],
        [19, 1.05],
        [20, 2],
        [21, 3.5],
        [22, 5.5],
      ]),
    },
    request,
  );
  if (config.visible === false) return;

  contributions.push({
    kind: 'layer',
    layer: applyIconStyle(
      {
        id: 'streets-road-crossing',
        type: 'symbol',
        source: context.data.sourceId,
        'source-layer': layers.streetFurniture,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', fields.subclass], 'crossing'],
        ],
      },
      config,
    ),
    localOrder: 200,
    owner: 'roads',
    slot: 'transport-symbols',
    target: 'roads.crossings',
  });
}

type CircularRoadFields = {
  circularRadiusAtZoom15: string;
  circularRadiusMeters: string;
  circularInnerRadiusMeters: string;
  circularOuterRadiusMeters: string;
  class: string;
};

const circularRoadBorderTotalWidth = 1;

function circularRoadInnerRadius(fields: CircularRoadFields, casing: boolean): readonly unknown[] {
  const values = circularRoadValues(fields);
  const stops: unknown[] = [];
  for (let level = 15; level <= 22; level += 1) {
    const centerlineRadius =
      level === 15 ? values.radiusAtZoom15 : ['*', values.radiusAtZoom15, 2 ** (level - 15)];
    const physicalInnerRadius = [
      '*',
      centerlineRadius,
      ['/', values.innerRadiusMeters, values.radiusMeters],
    ];
    const baseWidth = circularRoadBaseWidth(fields.class);
    const fallbackWidth =
      level === 15 ? baseWidth : ['*', baseWidth, circularRoadLegacyScale(level)];
    const fallbackInnerRadius = ['-', centerlineRadius, ['/', fallbackWidth, 2]];
    const innerRadius = ['case', values.hasPhysicalRadii, physicalInnerRadius, fallbackInnerRadius];
    stops.push(level, [
      'max',
      0,
      casing ? ['-', innerRadius, circularRoadBorderTotalWidth / 2] : innerRadius,
    ]);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

function circularRoadStrokeWidth(fields: CircularRoadFields, casing: boolean): readonly unknown[] {
  const values = circularRoadValues(fields);
  const baseWidth = circularRoadBaseWidth(fields.class);
  const stops: unknown[] = [];
  for (let level = 15; level <= 22; level += 1) {
    const centerlineRadius =
      level === 15 ? values.radiusAtZoom15 : ['*', values.radiusAtZoom15, 2 ** (level - 15)];
    const physicalWidth = [
      '*',
      centerlineRadius,
      ['/', ['-', values.outerRadiusMeters, values.innerRadiusMeters], values.radiusMeters],
    ];
    const fallbackWidth =
      level === 15 ? baseWidth : ['*', baseWidth, circularRoadLegacyScale(level)];
    stops.push(level, [
      'case',
      values.hasPhysicalRadii,
      casing ? ['+', physicalWidth, circularRoadBorderTotalWidth] : physicalWidth,
      casing ? ['+', fallbackWidth, circularRoadBorderTotalWidth] : fallbackWidth,
    ]);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

function circularRoadBaseWidth(classField: string): readonly unknown[] {
  return [
    'match',
    ['coalesce', ['get', classField], 'minor'],
    'motorway',
    6,
    'trunk',
    5.5,
    'primary',
    5,
    'secondary',
    4.5,
    'tertiary',
    4,
    'service',
    2.5,
    'track',
    2,
    3,
  ];
}

function circularRoadValues(fields: CircularRoadFields) {
  const radiusAtZoom15 = ['to-number', ['get', fields.circularRadiusAtZoom15], 0];
  const radiusMeters = ['to-number', ['get', fields.circularRadiusMeters], 0];
  const outerRadiusMeters = ['to-number', ['get', fields.circularOuterRadiusMeters], 0];
  const innerRadiusMeters = ['to-number', ['get', fields.circularInnerRadiusMeters], 0];
  return {
    hasPhysicalRadii: [
      'all',
      ['>', radiusMeters, 0],
      ['>', outerRadiusMeters, innerRadiusMeters],
      ['>=', innerRadiusMeters, 0],
    ],
    innerRadiusMeters,
    outerRadiusMeters,
    radiusAtZoom15,
    radiusMeters,
  };
}

function circularRoadLegacyScale(level: number): number {
  const interpolationBase = 1.35;
  const progress = (interpolationBase ** (level - 15) - 1) / (interpolationBase ** (22 - 15) - 1);
  return 1 + progress * 1.2;
}

function widthMatchedHatchPattern(
  pattern: unknown,
  widths: readonly number[],
  renderedWidth: unknown,
  minZoom: number | undefined,
  maxZoom: number | undefined,
) {
  if (typeof pattern !== 'string') {
    throw new Error('Road hatch patternWidths requires a literal pattern prefix');
  }

  const startZoom = Math.max(0, Math.floor(minZoom ?? 0));
  const endZoom = Math.min(24, Math.ceil(maxZoom ?? 24));
  const resolvedWidth = toMapLibreStyleValue(renderedWidth as never);
  const outputAtZoom = (level: number) =>
    widthMatchedHatchOutput(pattern, widths, evaluateWidthAtZoom(resolvedWidth, level));
  const initialOutput = outputAtZoom(startZoom);
  const stops: unknown[] = [];
  let previousOutput = initialOutput;
  for (let level = startZoom + 1; level <= endZoom; level += 1) {
    const output = outputAtZoom(level);
    if (JSON.stringify(output) === JSON.stringify(previousOutput)) continue;
    stops.push(level, output);
    previousOutput = output;
  }

  return expression<string>(['step', ['zoom'], initialOutput, ...stops]);
}

function widthMatchedHatchOutput(
  pattern: string,
  widths: readonly number[],
  renderedWidth: unknown,
) {
  const widthVariable = '__tileflow_hatch_width';
  const stops = widths.slice(0, -1).flatMap((width, index) => {
    const next = widths[index + 1]!;
    // A geometric midpoint bounds multiplicative scaling error equally on
    // both sides. With sqrt(2)-spaced assets the mark remains within about
    // 19% of its authored pixel thickness before MapLibre cross-fading.
    const boundary = Math.sqrt(width * next);
    return [boundary, `${pattern}-${next}`];
  });

  return [
    'let',
    widthVariable,
    expressionOutput(renderedWidth),
    ['step', ['var', widthVariable], `${pattern}-${widths[0]}`, ...stops],
  ];
}

function evaluateWidthAtZoom(value: unknown, level: number): unknown {
  if (
    Array.isArray(value) &&
    value[0] === 'interpolate' &&
    Array.isArray(value[2]) &&
    value[2].length === 1 &&
    value[2][0] === 'zoom'
  ) {
    const stops: Array<{level: number; output: unknown}> = [];
    for (let index = 3; index < value.length - 1; index += 2) {
      if (typeof value[index] === 'number') {
        stops.push({level: value[index] as number, output: value[index + 1]});
      }
    }
    const exact = stops.find((stop) => stop.level === level);
    if (exact) return exact.output;
    const lower = [...stops].reverse().find((stop) => stop.level < level);
    const upper = stops.find((stop) => stop.level > level);
    if (!lower) return upper?.output ?? 1;
    if (!upper) return lower.output;
    return [
      'interpolate',
      value[1],
      level,
      lower.level,
      expressionOutput(lower.output),
      upper.level,
      expressionOutput(upper.output),
    ];
  }
  return substituteZoom(value, level);
}

function substituteZoom(value: unknown, level: number): unknown {
  if (!Array.isArray(value)) return value;
  if (value[0] === 'literal') return value;
  if (value.length === 1 && value[0] === 'zoom') return level;
  return value.map((entry) => substituteZoom(entry, level));
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
  base: TileflowLineStyle & object,
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

  const widthScales = treatments.flatMap(({condition, style}) =>
    style.widthScale === undefined
      ? []
      : [{condition, scale: style.widthScale} satisfies WidthScaleEntry],
  );
  if (widthScales.length > 0) {
    result.width = conditionalWidthScaleValue(
      result.width,
      widthScales,
      treatmentPaintDefaults.width,
    );
  }

  return result as typeof base;
}

function roadTreatmentPhaseConditions(
  treatments: readonly RoadTreatmentEntry[],
  structure: TileflowRoadStructure,
  phase: 'casing' | 'fill' | 'shadow',
): unknown[][] {
  return treatments.flatMap(({condition, style}) =>
    style[structure]?.[phase] === undefined ? [] : [condition],
  );
}

function scaleStyleValue(value: unknown, scale: number): readonly unknown[] {
  return rewriteZoomOutputs(toMapLibreStyleValue(value as never), (output) => [
    '*',
    expressionOutput(output),
    scale,
  ]);
}

function conditionalStyleValue(
  base: unknown,
  branches: readonly ConditionalBranch[],
  fallback: unknown,
) {
  const resolvedBase = toMapLibreStyleValue((base ?? fallback) as never);
  return expression(
    rewriteZoomOutputs(resolvedBase, (baseOutput) => conditionalOutput(baseOutput, branches)),
  );
}

function conditionalWidthScaleValue(
  base: unknown,
  entries: readonly WidthScaleEntry[],
  fallback: number,
) {
  const resolvedBase = toMapLibreStyleValue((base ?? fallback) as never);
  return expression(
    rewriteZoomOutputs(resolvedBase, (baseOutput) => {
      const fixedBorder = fixedRoadBorderParts(baseOutput);
      if (!fixedBorder) {
        return conditionalOutput(
          baseOutput,
          entries.map(({condition, scale}) => ({
            condition,
            resolve: (output: unknown) => ['*', expressionOutput(output), scale],
          })),
        );
      }

      const baseVariable = '__tileflow_road_base';
      return [
        'let',
        baseVariable,
        expressionOutput(fixedBorder.width),
        [
          '+',
          [
            'case',
            ...entries.flatMap(({condition, scale}) => [
              condition,
              ['*', ['var', baseVariable], scale],
            ]),
            ['var', baseVariable],
          ],
          fixedBorder.border,
        ],
      ];
    }),
  );
}

function fixedRoadBorderParts(value: unknown): {border: unknown; width: unknown} | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value[0] !== 'let' ||
    value[1] !== fixedRoadBorderVariable ||
    !Array.isArray(value[3]) ||
    value[3].length !== 3 ||
    value[3][0] !== '+' ||
    !Array.isArray(value[3][2]) ||
    value[3][2][0] !== 'var' ||
    value[3][2][1] !== fixedRoadBorderVariable
  ) {
    return undefined;
  }
  return {border: value[2], width: value[3][1]};
}

function conditionalOutput(baseOutput: unknown, branches: readonly ConditionalBranch[]) {
  if (!isExpressionOutput(baseOutput)) {
    return [
      'case',
      ...branches.flatMap(({condition, resolve}) => [condition, resolve(baseOutput)]),
      expressionOutput(baseOutput),
    ];
  }

  const baseVariable = '__tileflow_road_base';
  return [
    'let',
    baseVariable,
    baseOutput,
    [
      'case',
      ...branches.flatMap(({condition, resolve}) => [condition, resolve(['var', baseVariable])]),
      ['var', baseVariable],
    ],
  ];
}

function isExpressionOutput(value: unknown): value is unknown[] {
  return Array.isArray(value) && typeof value[0] === 'string';
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
            casing: {
              cap: 'butt',
              color: context.colors.roads.tunnel,
              opacity: 1,
            },
            fill: {cap: 'butt', color: context.colors.background, opacity: 1},
            hatch: {
              color: context.colors.roads.tunnel,
              minZoom: 17,
              opacity: 0.3,
              spacing: 16,
            },
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
