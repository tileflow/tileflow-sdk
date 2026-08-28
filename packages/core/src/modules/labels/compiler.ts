import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applySymbolStyle} from '../../cartography/layer-style';
import {labelField, labelFieldExpression} from '../../cartography/localization';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowColorStyleValue,
  TileflowImageStyleValue,
  TileflowSymbolPlacementStyle,
  TileflowSymbolStyle,
  TileflowTextStyle,
} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import type {
  TileflowAerodromeCodeDetail,
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowPlaceLabelClass,
  TileflowRoadClass,
  TileflowRoadsModuleConfig,
  TileflowWaterLabelClass,
} from '../../types';
import {resolveRoads} from '../roads';
import {tileflowRoadClasses, tileflowRoadClassFilter} from '../roads/semantics';
import {resolveLabels, visibleRoadLabelClasses} from './index';

const placeClasses: Record<TileflowPlaceLabelClass, readonly string[]> = {
  continent: ['continent'],
  country: ['country'],
  state: ['state', 'province', 'aboriginal_lands'],
  city: ['city'],
  town: ['town'],
  village: ['village'],
  neighborhood: ['suburb', 'neighbourhood', 'quarter', 'borough'],
  other: ['hamlet', 'isolated_dwelling', 'island', 'strait'],
};

// Mapbox-style collision priority: detailed settlements are offered first in
// the layer stack, while cities, regions, countries, and continents are drawn
// later so the broad orientation labels win when candidates overlap.
const placeLabelOrder: readonly TileflowPlaceLabelClass[] = [
  'other',
  'neighborhood',
  'village',
  'town',
  'city',
  'state',
  'country',
  'continent',
];

export function compileLabels(
  request: TileflowLabelsModuleConfig | undefined,
  roadRequest: TileflowRoadsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolveLabels(request);
  const roads = resolveRoads(roadRequest);
  const {colors} = context;
  const rankField = context.data.schema.fields.rank;
  const capitalField = context.data.schema.fields.capital;
  const defaults = {
    places: {
      continent: symbolStyle(context, 'places', {
        minZoom: 0,
        maxZoom: 3,
        priority: 100,
        size: zoom.linear([
          [0, 11],
          [4, 15],
        ]),
      }),
      country: symbolStyle(context, 'places', {
        minZoom: 1,
        maxZoom: 10,
        priority: placePriority(rankField, 95),
        size: zoom.linear([
          [1, 10],
          [6, 16],
        ]),
      }),
      state: symbolStyle(context, 'places', {
        minZoom: 4,
        maxZoom: 10,
        priority: placePriority(rankField, 85),
        size: zoom.linear([
          [3, 10],
          [8, 14],
        ]),
      }),
      city: symbolStyle(context, 'places', {
        minZoom: 2,
        maxZoom: 15,
        priority: placePriority(rankField, 100, true, capitalField),
        size: zoom.linear([
          [2, 10],
          [4, 12],
          [12, 18],
        ]),
      }),
      town: symbolStyle(context, 'places', {
        minZoom: 7,
        maxZoom: 14,
        priority: placePriority(rankField, 80),
        size: zoom.linear([
          [7, 10],
          [14, 16],
        ]),
      }),
      village: symbolStyle(context, 'places', {
        minZoom: 9,
        maxZoom: 15,
        priority: placePriority(rankField, 65),
        size: zoom.linear([
          [9, 10],
          [16, 14],
        ]),
      }),
      neighborhood: symbolStyle(context, 'places', {
        color: colors.labels.neighborhood,
        minZoom: 10,
        maxZoom: 16,
        priority: placePriority(rankField, 55),
        size: zoom.linear([
          [10, 10],
          [17, 13],
        ]),
      }),
      other: symbolStyle(context, 'places', {
        minZoom: 6,
        maxZoom: 16,
        priority: placePriority(rankField, 40),
        size: zoom.linear([
          [6, 9],
          [17, 12],
        ]),
      }),
    },
    roads: Object.fromEntries(
      tileflowRoadClasses.map((roadClass) => [
        roadClass,
        symbolStyle(context, 'roads', {
          color: colors.labels.road,
          minZoom: ['motorway', 'trunk', 'primary'].includes(roadClass)
            ? 10
            : ['pathway', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(roadClass)
              ? 15
              : 13,
          placement: 'line',
          size: zoom.linear([
            [10, 10],
            [16, 14],
          ]),
          spacing: 280,
        }),
      ]),
    ) as Partial<Record<TileflowRoadClass, TileflowSymbolStyle>>,
    shields: {
      default: symbolStyle(context, 'roads', {
        color: colors.labels.road,
        size: 10,
        padding: 8,
        haloWidth: 1.8,
      }),
      detail: {minZoom: 11, spacing: 240},
      overview: {maxZoom: 11, minZoom: 6},
    },
    junctions: symbolStyle(context, 'roads', {
      color: colors.labels.road,
      minZoom: 13,
      maxZoom: 18,
      placement: 'point',
      priority: 90,
      size: 10,
      padding: 6,
      haloWidth: 1.8,
    }),
    water: {
      ocean: symbolStyle(context, 'water', {
        minZoom: 2,
        size: zoom.linear([
          [2, 12],
          [8, 18],
        ]),
      }),
      other: symbolStyle(context, 'water', {
        minZoom: 5,
        size: zoom.linear([
          [5, 11],
          [14, 15],
        ]),
      }),
      line: symbolStyle(context, 'water', {
        minZoom: 7,
        placement: 'line',
        size: 13,
        spacing: 320,
      }),
      waterway: symbolStyle(context, 'water', {
        minZoom: 10,
        placement: 'line',
        size: 12,
        spacing: 320,
      }),
    },
    aerodrome: symbolStyle(context, 'places', {
      minZoom: 9,
      size: zoom.linear([
        [9, 10],
        [16, 14],
      ]),
    }),
  } satisfies NonNullable<TileflowLabelsModuleConfig['styles']>;
  const styles = mergeTileflowDesign<NonNullable<TileflowLabelsModuleConfig['styles']>>(
    defaults,
    request?.styles,
  );
  const result: TileflowLayerContribution[] = [];
  const {sourceId: source, schema} = context.data;
  const field = labelField(semantics.language, context);
  const aerodromeField = expression<string>(
    aerodromeLabelExpression(semantics.aerodromeCodes, semantics.language, context),
  );
  let order = 0;

  const visiblePlaceClasses =
    semantics.places === 'none'
      ? []
      : semantics.places === 'major'
        ? placeLabelOrder.filter((placeClass) =>
            ['continent', 'country', 'state', 'city', 'town'].includes(placeClass),
          )
        : placeLabelOrder;
  for (const placeClass of visiblePlaceClasses) {
    const style = styles.places?.[placeClass];
    if (!style || style.visible === false || style.text?.visible === false) continue;
    const id = `streets-label-place-${placeClass}`;
    result.push(
      symbolContribution(
        `labels.places.${placeClass}`,
        800 + order++,
        applySymbolStyle(
          {
            id,
            type: 'symbol',
            source,
            'source-layer': schema.layers.place,
            filter: [
              'all',
              ['has', schema.fields.name],
              placeFilter(
                placeClass,
                schema.fields.class,
                schema.fields.rank,
                schema.fields.capital,
              ),
            ],
          },
          mergeTileflowDesign(style, {text: {field}}),
        ),
      ),
    );
  }

  const visibleRoads = visibleRoadLabelClasses(semantics.roads, roads, semantics.roadClasses);
  for (const roadClass of visibleRoads as TileflowRoadClass[]) {
    const style = styles.roads?.[roadClass];
    if (!style || style.visible === false || style.text?.visible === false) continue;
    const id = `streets-label-road-${roadClass}`;
    result.push(
      symbolContribution(
        `labels.roads.${roadClass}`,
        200 + order++,
        applySymbolStyle(
          {
            id,
            type: 'symbol',
            source,
            'source-layer': schema.layers.roadName,
            filter: [
              'all',
              ['has', schema.fields.name],
              tileflowRoadClassFilter(schema.fields, roadClass),
            ],
          },
          mergeTileflowDesign(style, {text: {field}}),
        ),
        'transport-symbols',
      ),
    );
  }

  // Shield visibility is independent from road-name visibility. A map may
  // deliberately suppress road names while retaining route references.
  const shieldRoads =
    semantics.shields === 'none'
      ? []
      : visibleRoadLabelClasses(
          semantics.shields === 'major' ? 'major' : 'all',
          roads,
          semantics.roadClasses,
        );
  const eligibleShieldRoads = shieldRoads.filter(
    (roadClass) => !['pedestrian', 'service'].includes(roadClass),
  );
  const shieldDefaults = styles.shields?.default;
  const shieldKinds = Object.entries(styles.shields?.kinds ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const shieldTextColors = Object.entries(styles.shields?.textColors ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  if (shieldDefaults && shieldDefaults.visible !== false && eligibleShieldRoads.length > 0) {
    const shieldKindField = schema.fields.shieldKind;
    const shieldLineLengthField = schema.fields.shieldLineLengthMeters;
    const shieldRankField = schema.fields.shieldRank;
    const shieldTextField = schema.fields.shieldText ?? schema.fields.ref;
    const shieldTextColorField = schema.fields.shieldTextColor;
    const commonFilter = [
      'all',
      ['has', schema.fields.ref],
      ...(shieldKindField ? [['has', shieldKindField]] : []),
      ['>=', ['to-number', ['get', schema.fields.refLength], 0], 1],
      ['<=', ['to-number', ['coalesce', ['get', schema.fields.refLength], 99], 99], 6],
      roadClassesFilter(schema.fields, eligibleShieldRoads as TileflowRoadClass[]),
    ];
    const phases = [
      ...(shieldKindField && schema.layers.roadShield
        ? [
            {
              geometry: 'Point',
              name: 'overview',
              order: 400,
              placement: 'point',
              sourceLayer: schema.layers.roadShield,
              style: styles.shields?.overview,
            } as const,
          ]
        : []),
      {
        geometry: 'LineString',
        name: 'detail',
        order: 401,
        placement: 'line',
        sourceLayer: schema.layers.roadName,
        style: styles.shields?.detail,
      } as const,
    ];
    for (const phase of phases) {
      if (phase.style?.visible === false) continue;
      let style = mergeTileflowDesign(shieldDefaults, phase.style, {
        placement: phase.placement,
        ...(shieldRankField
          ? {
              priority: expression<number>(['*', -1, ['to-number', ['get', shieldRankField], 999]]),
            }
          : {}),
        icon: {pitchAlignment: 'viewport', rotationAlignment: 'viewport'},
        text: {
          field: expression<string>(['to-string', ['get', shieldTextField]]),
          pitchAlignment: 'viewport',
          rotationAlignment: 'viewport',
        },
      });
      const image = shieldImageMatch(shieldKindField, shieldKinds, style.icon?.image);
      const color = shieldColorMatch(shieldTextColorField, shieldTextColors, style.text?.color);
      style = mergeTileflowDesign(style, {
        ...(image === undefined ? {} : {icon: {image}}),
        ...(color === undefined ? {} : {text: {color}}),
      });
      result.push(
        symbolContribution(
          `labels.shields.${phase.name}`,
          phase.order,
          applySymbolStyle(
            {
              id: `streets-label-road-shield-${phase.name}`,
              type: 'symbol',
              source,
              'source-layer': phase.sourceLayer,
              filter: [
                'all',
                commonFilter,
                ['==', ['geometry-type'], phase.geometry],
                ...(phase.name === 'detail' && shieldLineLengthField
                  ? [shieldLineLengthFilter(shieldLineLengthField)]
                  : []),
              ],
            },
            style,
          ),
          'transport-symbols',
        ),
      );
    }
  }

  const geometryRoads = visibleRoadLabelClasses('all', roads);
  if (
    semantics.junctions &&
    geometryRoads.some((roadClass) => ['motorway', 'trunk'].includes(roadClass)) &&
    styles.junctions &&
    styles.junctions?.visible !== false &&
    styles.junctions?.text?.visible !== false
  ) {
    result.push(
      symbolContribution(
        'labels.junctions',
        450,
        applySymbolStyle(
          {
            id: 'streets-label-road-junction',
            type: 'symbol',
            source,
            'source-layer': schema.layers.roadName,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Point'],
              [
                'any',
                ['==', ['get', schema.fields.class], 'motorway_junction'],
                ['==', ['get', schema.fields.subclass], 'junction'],
              ],
              ['any', ['has', schema.fields.ref], ['has', schema.fields.name]],
            ],
          },
          mergeTileflowDesign(styles.junctions, {
            text: {
              field: expression<string>([
                'case',
                ['has', schema.fields.ref],
                ['to-string', ['get', schema.fields.ref]],
                labelFieldExpression(semantics.language, context),
              ]),
            },
          }),
        ),
        'transport-symbols',
      ),
    );
  }

  if (semantics.water !== 'none') {
    const waterTargets: Array<{
      filter: unknown[];
      name: TileflowWaterLabelClass;
      sourceLayer: string;
    }> = [
      {
        name: 'ocean',
        sourceLayer: schema.layers.waterName,
        filter: [
          'all',
          ['has', schema.fields.name],
          classFilter(schema.fields.class, ['ocean', 'sea']),
          ['==', ['geometry-type'], 'Point'],
        ],
      },
      {
        name: 'other',
        sourceLayer: schema.layers.waterName,
        filter: [
          'all',
          ['has', schema.fields.name],
          classFilter(schema.fields.class, ['lake', 'reservoir', 'bay']),
          ['==', ['geometry-type'], 'Point'],
        ],
      },
      {
        name: 'line',
        sourceLayer: schema.layers.waterName,
        filter: [
          'all',
          ['has', schema.fields.name],
          classFilter(schema.fields.class, ['ocean', 'sea', 'lake', 'reservoir', 'bay']),
          ['==', ['geometry-type'], 'LineString'],
        ],
      },
      {
        name: 'waterway',
        sourceLayer: schema.layers.waterway,
        filter: ['all', ['has', schema.fields.name], ['==', ['geometry-type'], 'LineString']],
      },
    ];
    const visibleTargets =
      semantics.water === 'major'
        ? waterTargets.filter((target) => target.name !== 'waterway')
        : waterTargets;
    for (const target of visibleTargets) {
      const style = styles.water?.[target.name];
      if (!style || style.visible === false || style.text?.visible === false) continue;
      result.push(
        symbolContribution(
          `labels.water.${target.name}`,
          500 + order++,
          applySymbolStyle(
            {
              id: `streets-label-water-${target.name}`,
              type: 'symbol',
              source,
              'source-layer': target.sourceLayer,
              filter: target.filter,
            },
            mergeTileflowDesign(style, {text: {field}}),
          ),
        ),
      );
    }
  }

  if (
    styles.aerodrome &&
    styles.aerodrome.visible !== false &&
    styles.aerodrome.text?.visible !== false
  ) {
    result.push(
      symbolContribution(
        'labels.aerodrome',
        700,
        applySymbolStyle(
          {
            id: 'streets-label-aerodrome',
            type: 'symbol',
            source,
            'source-layer': schema.layers.aerodromeLabel,
            filter: ['has', schema.fields.name],
          },
          mergeTileflowDesign(styles.aerodrome, {text: {field: aerodromeField}}),
        ),
      ),
    );
  }

  return result;
}

function shieldLineLengthFilter(field: string): unknown[] {
  const length = ['to-number', ['get', field], 0];
  return [
    'step',
    ['zoom'],
    ['>', length, 5_000],
    12,
    ['>', length, 2_500],
    13,
    ['>', length, 1_000],
    14,
    true,
  ];
}

function shieldImageMatch(
  field: string | undefined,
  entries: readonly (readonly [string, {image: unknown}])[],
  fallback: TileflowImageStyleValue | undefined,
): TileflowImageStyleValue | undefined {
  if (entries.length === 0 || !field) return fallback;
  if (fallback === undefined) {
    throw new TypeError(
      'Road-shield image kinds require labels.styles.shields.default.icon.image.',
    );
  }
  return expression<string>([
    'match',
    ['get', field],
    ...entries.flatMap(([kind, style]) => [kind, style.image]),
    fallback,
  ]);
}

function shieldColorMatch(
  field: string | undefined,
  entries: readonly (readonly [string, {color: unknown}])[],
  fallback: TileflowColorStyleValue | undefined,
): TileflowColorStyleValue | undefined {
  if (entries.length === 0 || !field) return fallback;
  if (fallback === undefined) {
    throw new TypeError(
      'Road-shield text colors require labels.styles.shields.default.text.color.',
    );
  }
  return expression<string>([
    'match',
    ['get', field],
    ...entries.flatMap(([name, style]) => [name, style.color]),
    fallback,
  ]);
}

function symbolStyle(
  context: TileflowDomainCompileContext,
  domain: 'places' | 'roads' | 'water',
  overrides: TileflowTextStyle & TileflowSymbolPlacementStyle,
): TileflowSymbolStyle {
  const {maxZoom, minZoom, placement, priority, spacing, visible, zOrder, ...text} = overrides;
  const typography = context.typography[domain];
  return {
    ...(maxZoom === undefined ? {} : {maxZoom}),
    ...(minZoom === undefined ? {} : {minZoom}),
    ...(placement === undefined ? {} : {placement}),
    ...(priority === undefined ? {} : {priority}),
    ...(spacing === undefined ? {} : {spacing}),
    ...(visible === undefined ? {} : {visible}),
    ...(zOrder === undefined ? {} : {zOrder}),
    text: mergeTileflowDesign(
      {
        allowOverlap: false,
        color: domain === 'water' ? context.colors.labels.water : context.colors.labels.primary,
        ...typographyTextStyle(typography),
        haloColor: context.colors.labels.halo,
        haloWidth: 1.2,
        optional: true,
        padding: 4,
      },
      text,
    ),
  };
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}

function aerodromeLabelExpression(
  detail: TileflowAerodromeCodeDetail,
  language: TileflowLabelLanguage,
  context: TileflowDomainCompileContext,
): readonly unknown[] {
  const name = labelFieldExpression(language, context);
  if (detail === 'none') return name;

  const fields = context.data.schema.fields;
  const code =
    detail === 'all'
      ? ['coalesce', ['get', fields.iata], ['get', fields.icao], '']
      : ['coalesce', ['get', fields.iata], ''];
  return [
    'case',
    ['!=', ['to-string', code], ''],
    ['concat', name, ' · ', ['to-string', code]],
    name,
  ];
}

function placeFilter(
  placeClass: TileflowPlaceLabelClass,
  classField: string,
  rankField: string,
  capitalField: string,
): unknown[] {
  if (placeClass === 'other') {
    return [
      'any',
      [
        'all',
        classFilter(classField, ['island', 'strait']),
        zoomRankFilter(rankField, [
          [0, 4],
          [8, 8],
          [10, true],
        ]),
      ],
      [
        'all',
        classFilter(classField, ['hamlet', 'isolated_dwelling']),
        zoomRankFilter(rankField, [
          [0, false],
          [11, 8],
          [13, 12],
          [15, true],
        ]),
      ],
    ];
  }

  const hierarchy =
    placeClass === 'country'
      ? zoomRankFilter(rankField, [
          [0, 2],
          [2, 4],
          [4, true],
        ])
      : placeClass === 'state'
        ? zoomRankFilter(rankField, [
            [0, 4],
            [5, 8],
            [7, true],
          ])
        : placeClass === 'city'
          ? [
              'any',
              capitalFilter(capitalField),
              zoomRankFilter(rankField, [
                [0, 2],
                [3, 3],
                [4, 4],
                [6, 5],
                [8, true],
              ]),
            ]
          : placeClass === 'town'
            ? zoomRankFilter(rankField, [
                [0, 7],
                [8, 10],
                [10, 15],
                [12, true],
              ])
            : placeClass === 'village'
              ? zoomRankFilter(rankField, [
                  [0, 8],
                  [11, 12],
                  [13, true],
                ])
              : placeClass === 'neighborhood'
                ? zoomRankFilter(rankField, [
                    [0, 8],
                    [12, 12],
                    [14, true],
                  ])
                : undefined;

  const classes = classFilter(classField, placeClasses[placeClass]);
  return hierarchy === undefined ? classes : ['all', classes, hierarchy];
}

function zoomRankFilter(
  rankField: string,
  stops: readonly (readonly [number, number | true | false])[],
): unknown[] {
  const [[, first], ...rest] = stops;
  const rank = ['to-number', ['get', rankField], 99];
  const output = (limit: number | true | false): unknown =>
    typeof limit === 'number' ? ['<=', rank, limit] : limit;
  return [
    'step',
    ['zoom'],
    output(first!),
    ...rest.flatMap(([stop, limit]) => [stop, output(limit)]),
  ];
}

function placePriority(
  rankField: string,
  base: number,
  capitals = false,
  capitalField = 'capital',
) {
  const rankedPriority = ['-', base, ['to-number', ['get', rankField], 99]];
  return expression<number>(
    capitals
      ? ['+', ['case', capitalFilter(capitalField), 100, 0], rankedPriority]
      : rankedPriority,
  );
}

function capitalFilter(capitalField: string): unknown[] {
  return ['>', ['to-number', ['get', capitalField], 0], 0];
}

function roadClassesFilter(
  fields: TileflowDomainCompileContext['data']['schema']['fields'],
  roadClasses: readonly TileflowRoadClass[],
): unknown[] {
  return roadClasses.length === 1
    ? tileflowRoadClassFilter(fields, roadClasses[0]!)
    : ['any', ...roadClasses.map((roadClass) => tileflowRoadClassFilter(fields, roadClass))];
}

function symbolContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
  slot: TileflowLayerContribution['slot'] = 'symbols',
): TileflowLayerContribution {
  return {kind: 'layer', layer, localOrder, owner: 'labels', slot, target};
}
