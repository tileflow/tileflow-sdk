import {
  isTileflowWorldDetailLayer,
  type ResolvedTileflowData,
  type TileflowDataBinding,
  type TileflowDataFieldAccessor,
  type TileflowDataLayerPartition,
  type TileflowWorldFieldName,
  tileflowWorldFields,
  type TileflowWorldLayerName,
  tileflowWorldLayers,
} from '../data';
import {tileflowBathymetryV1Schema} from '../marine';
import {foldMappedComparison, mappedValue} from './mapped-comparisons';

/*
 * The SDK reads data through the Tileflow World schema's layers and fields. This keeps
 * TypeScript's `keyof` vocabulary, runtime selector validation, the authoring manifest, and
 * generated JSON Schema on one source of truth.
 */
export const tileflowSemanticFieldNames = Object.freeze(
  Object.keys(tileflowWorldFields).sort(compareCodeUnits),
) as readonly [TileflowWorldFieldName, ...TileflowWorldFieldName[]];

export const tileflowSemanticLayerNames = Object.freeze(
  Object.keys(tileflowWorldLayers).sort(compareCodeUnits),
) as readonly [TileflowWorldLayerName, ...TileflowWorldLayerName[]];

const auxiliaryFieldBindings = Object.freeze({
  bathymetryContourDepth: tileflowBathymetryV1Schema.fields.depth,
});

export type TileflowDataFieldName = TileflowWorldFieldName | keyof typeof auxiliaryFieldBindings;

/** Expression fields include fixed auxiliary contracts without extending the primary schema. */
export const tileflowSemanticExpressionFieldNames = Object.freeze(
  [...tileflowSemanticFieldNames, ...Object.keys(auxiliaryFieldBindings)].sort(compareCodeUnits),
) as readonly TileflowDataFieldName[];

/** A schema-bound data field whose physical name is assigned only during compilation. */
export type TileflowDataFieldReference<
  TName extends TileflowDataFieldName = TileflowDataFieldName,
> = Readonly<{
  kind: 'tileflow-data-field';
  /** For `name`, the BCP 47 code of a translated name. */
  language?: string;
  name: TName;
}>;

export type TileflowNumericDataFieldName =
  | 'activity'
  | 'adminLevel'
  | 'bathymetryContourDepth'
  | 'bathymetryMinDepth'
  | 'bathymetrySortKey'
  | 'canopyClearanceAtZoom15'
  | 'canopyCoverPercent'
  | 'canopyRank'
  | 'capital'
  | 'circularClearanceExtraAtZoom15'
  | 'circularInnerRadiusMeters'
  | 'circularOuterRadiusMeters'
  | 'circularRadiusAtZoom15'
  | 'circularRadiusMeters'
  | 'confidence'
  | 'circumference'
  | 'diameterCrown'
  | 'elevation'
  | 'filterrank'
  | 'height'
  | 'importanceTier'
  | 'layer'
  | 'level'
  | 'levelMax'
  | 'minHeight'
  | 'minZoom'
  | 'reflen'
  | 'shieldLineLengthMeters'
  | 'shieldRank'
  | 'sizerank'
  | 'sortKey'
  | 'symbolrank';

export type TileflowBooleanDataFieldName =
  | 'covered'
  | 'disputed'
  | 'expressway'
  | 'extrude'
  | 'hasParts'
  | 'indoor'
  | 'intermittent'
  | 'link'
  | 'lit'
  | 'maritime'
  | 'oneway'
  | 'toll'
  | 'underground';

/** Runtime value implied by one registered semantic field, independent of its physical name. */
export type TileflowDataFieldValue<TName extends TileflowDataFieldName> =
  TName extends TileflowNumericDataFieldName
    ? number
    : TName extends TileflowBooleanDataFieldName
      ? boolean
      : string;

/** Internal source-layer reference preserved until the compiler's lowering boundary. */
export type TileflowDataLayerReference<
  TName extends TileflowWorldLayerName = TileflowWorldLayerName,
> = Readonly<{
  kind: 'tileflow-data-layer';
  name: TName;
}>;

/** The primary vector source; its configured Style ID is assigned at lowering. */
export type TileflowDataSourceReference = Readonly<{
  kind: 'tileflow-data-source';
  name: 'primary';
}>;

/**
 * Reference a semantic field in a typed expression. Primary fields follow the active data schema;
 * auxiliary fields use their fixed product contract at the final lowering boundary.
 */
export function field<const TName extends TileflowDataFieldName>(
  name: TName,
): TileflowDataFieldReference<TName> {
  return Object.freeze({kind: 'tileflow-data-field', name});
}

/** Reference the name of a feature in one language, by its BCP 47 code. */
export function nameField(language: string): TileflowDataFieldReference<'name'> {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)) {
    throw new Error(`Tileflow label language ${language} is not a BCP 47 code.`);
  }
  return Object.freeze({kind: 'tileflow-data-field', language, name: 'name'});
}

export function dataLayer<const TName extends TileflowWorldLayerName>(
  name: TName,
): TileflowDataLayerReference<TName> {
  return Object.freeze({kind: 'tileflow-data-layer', name});
}

export function dataSource(): TileflowDataSourceReference {
  return Object.freeze({kind: 'tileflow-data-source', name: 'primary'});
}

/**
 * Present the active data contract to domain compilers as semantic references.
 * Optional layers and fields retain their exact present/absent shape; physical names
 * are restored only by `bindSemanticReferences` at the lowering boundary.
 */
export function createSemanticDataView(data: ResolvedTileflowData): ResolvedTileflowData {
  const fields = Object.fromEntries(
    Object.entries(data.schema.fields).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, field(name as TileflowWorldFieldName)] as const],
    ),
  );
  const layers = Object.fromEntries(
    Object.entries(data.schema.layers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, dataLayer(name as TileflowWorldLayerName)] as const],
    ),
  );
  return {
    ...data,
    sourceId: dataSource(),
    schema: {...data.schema, fields, layers},
  } as unknown as ResolvedTileflowData;
}

/** Bind references outside a style layer: every field takes its schema-wide property. */
export function bindSemanticReferences<T>(value: T, data: ResolvedTileflowData): T {
  return bindSemanticValue(value, {data}) as T;
}

/**
 * Bind one style layer. A World layer the data splits over several source layers becomes one
 * style layer per source layer its filter can draw from; the first keeps the layer's ID.
 */
export function bindSemanticLayer<T extends Record<string, unknown> & {id: string}>(
  layer: T,
  data: ResolvedTileflowData,
): T[] {
  const sourceLayer = layer['source-layer'];
  if (!isDataLayerReference(sourceLayer)) return [bindSemanticValue(layer, {data}) as T];
  const name = sourceLayer.name;
  const physical = data.schema.layers[name];
  if (!physical) throw new Error(`Tileflow data schema does not provide layer ${name}.`);
  const partitions: readonly TileflowDataLayerPartition[] = data.schema.adapter?.layers[name] ?? [
    {layer: physical},
  ];
  const source =
    isDataSourceReference(layer.source) && isTileflowWorldDetailLayer(name)
      ? detailSourceId(data)
      : undefined;
  const drawn = partitions.filter(
    (partition) =>
      !partition.classes ||
      partition.classes.some((value) => mayMatchClass(layer.filter, value) !== false),
  );
  return drawn.map((partition, index) => {
    const bound = bindSemanticValue(layer, {data, partition}) as T & {filter?: unknown};
    const filter =
      partition.filter === undefined
        ? bound.filter
        : bound.filter === undefined
          ? partition.filter
          : ['all', partition.filter, bound.filter];
    return {
      ...bound,
      ...(index === 0 ? {} : {id: `${layer.id}~${partition.layer}`}),
      ...(source === undefined ? {} : {source}),
      'source-layer': partition.layer,
      ...(filter === undefined ? {} : {filter}),
    };
  });
}

/** The style source of World's detail layers. */
function detailSourceId(data: ResolvedTileflowData): string {
  return data.detail?.delivery === 'separate' ? data.detail.sourceId : data.sourceId;
}

type BindingContext = Readonly<{
  data: ResolvedTileflowData;
  partition?: TileflowDataLayerPartition;
}>;

function bindSemanticValue(value: unknown, context: BindingContext): unknown {
  if (Array.isArray(value)) {
    const [operator, operand] = value;
    if ((operator === 'get' || operator === 'has') && value.length === 2) {
      if (isDataFieldReference(operand)) {
        const accessor = fieldAccessor(operand, context);
        if (typeof accessor === 'string') return [operator, accessor];
        return operator === 'get'
          ? mappedValue(accessor.expression)
          : ['!=', accessor.expression, null];
      }
    }
    const bound = value.map((item) => bindSemanticValue(item, context));
    return context.data.schema.adapter ? foldMappedComparison(bound) : bound;
  }
  if (isDataFieldReference(value)) {
    const accessor = fieldAccessor(value, context);
    if (typeof accessor !== 'string') {
      throw new Error(
        `Tileflow data field ${value.name} has no single property in this data schema.`,
      );
    }
    return accessor;
  }
  if (isDataLayerReference(value)) {
    const binding = context.data.schema.layers[value.name];
    if (!binding) throw new Error(`Tileflow data schema does not provide layer ${value.name}.`);
    return binding;
  }
  if (isDataSourceReference(value)) return context.data.sourceId;
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, bindSemanticValue(item, context)]),
  );
}

function fieldAccessor(
  reference: TileflowDataFieldReference,
  context: BindingContext,
): TileflowDataFieldAccessor {
  const schema: TileflowDataBinding = context.data.schema;
  if (reference.language !== undefined) {
    return `${schema.nameLanguagePrefix}${reference.language}`;
  }
  if (Object.hasOwn(auxiliaryFieldBindings, reference.name)) {
    return auxiliaryFieldBindings[reference.name as keyof typeof auxiliaryFieldBindings];
  }
  const name = reference.name as TileflowWorldFieldName;
  const accessor = context.partition?.fields?.[name] ?? schema.fields[name];
  if (accessor) return accessor;
  // A World field the data lacks reads as absent, so designs made for World still draw other data
  // without requiring properties it does not publish.
  // It reads an empty object rather than the feature, so its value is null of any type.
  if (Object.hasOwn(tileflowWorldFields, name)) {
    return {expression: ['get', tileflowWorldFields[name], ['literal', {}]]};
  }
  throw new Error(`Tileflow data schema does not provide field ${name}.`);
}

/**
 * Whether a filter can match a feature of one World class: false only when it provably cannot.
 * Every other property is unknown, so anything that depends on it may match.
 */
function mayMatchClass(expression: unknown, value: string): boolean | string | undefined {
  if (expression === undefined) return true;
  if (!Array.isArray(expression)) return expression as string;
  const [operator, ...args] = expression;
  if (operator === 'get' && args.length === 1 && isDataFieldReference(args[0])) {
    return args[0].name === 'class' && args[0].language === undefined ? value : undefined;
  }
  if (operator === 'literal') return args[0] as string;
  if (operator === 'all') {
    const results = args.map((arg) => mayMatchClass(arg, value));
    if (results.includes(false)) return false;
    return results.every((result) => result === true) ? true : undefined;
  }
  if (operator === 'any') {
    const results = args.map((arg) => mayMatchClass(arg, value));
    if (results.includes(true)) return true;
    return results.every((result) => result === false) ? false : undefined;
  }
  if (operator === '!') {
    const result = mayMatchClass(args[0], value);
    return typeof result === 'boolean' ? !result : undefined;
  }
  if ((operator === '==' || operator === '!=') && args.length === 2) {
    const [left, right] = args.map((arg) => mayMatchClass(arg, value));
    if (left === undefined || right === undefined) return undefined;
    return operator === '==' ? left === right : left !== right;
  }
  if (operator === 'match' && args.length >= 3) {
    const input = mayMatchClass(args[0], value);
    if (input === undefined || typeof input === 'boolean') return undefined;
    for (let index = 1; index < args.length - 1; index += 2) {
      const labels = Array.isArray(args[index]) ? (args[index] as unknown[]) : [args[index]];
      if (labels.includes(input)) return mayMatchClass(args[index + 1], value);
    }
    return mayMatchClass(args.at(-1), value);
  }
  return undefined;
}

function isDataFieldReference(value: unknown): value is TileflowDataFieldReference {
  return isRecord(value) && value.kind === 'tileflow-data-field' && typeof value.name === 'string';
}

function isDataLayerReference(value: unknown): value is TileflowDataLayerReference {
  return isRecord(value) && value.kind === 'tileflow-data-layer' && typeof value.name === 'string';
}

function isDataSourceReference(value: unknown): value is TileflowDataSourceReference {
  return isRecord(value) && value.kind === 'tileflow-data-source' && value.name === 'primary';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
