import {
  type OpenMapTilesFieldBindings,
  type OpenMapTilesLayerBindings,
  type OpenMapTilesSchema,
  type ResolvedTileflowData,
  tileflowWorldV1Schema,
} from '../data';
import {tileflowBathymetryV1Schema} from '../marine';

/*
 * Build the runtime vocabularies from the most complete supported data contract.
 * This keeps TypeScript's `keyof` vocabulary, runtime selector validation, the
 * authoring manifest, and generated JSON Schema on one source of truth.
 */
const completeSemanticDataContract = tileflowWorldV1Schema();

export const tileflowSemanticFieldNames = Object.freeze(
  Object.keys(completeSemanticDataContract.fields).sort(compareCodeUnits),
) as readonly [keyof OpenMapTilesFieldBindings, ...(keyof OpenMapTilesFieldBindings)[]];

export const tileflowSemanticLayerNames = Object.freeze(
  Object.keys(completeSemanticDataContract.layers).sort(compareCodeUnits),
) as readonly [keyof OpenMapTilesLayerBindings, ...(keyof OpenMapTilesLayerBindings)[]];

const auxiliaryFieldBindings = Object.freeze({
  bathymetryContourDepth: tileflowBathymetryV1Schema.fields.depth,
});

export type TileflowDataFieldName =
  keyof OpenMapTilesFieldBindings | keyof typeof auxiliaryFieldBindings;

/** Expression fields include fixed auxiliary contracts without extending the primary schema. */
export const tileflowSemanticExpressionFieldNames = Object.freeze(
  [...tileflowSemanticFieldNames, ...Object.keys(auxiliaryFieldBindings)].sort(compareCodeUnits),
) as readonly TileflowDataFieldName[];

/** A schema-bound data field whose physical name is assigned only during compilation. */
export type TileflowDataFieldReference<
  TName extends TileflowDataFieldName = TileflowDataFieldName,
> = Readonly<{
  kind: 'tileflow-data-field';
  name: TName;
}>;

export type TileflowNumericDataFieldName =
  | 'activityScore'
  | 'adminLevel'
  | 'bathymetryContourDepth'
  | 'bathymetryMinDepth'
  | 'bathymetrySortKey'
  | 'canopyClearanceAtZoom15'
  | 'canopyCoverPercent'
  | 'canopyRank'
  | 'circularClearanceExtraAtZoom15'
  | 'circularInnerRadiusMeters'
  | 'circularOuterRadiusMeters'
  | 'circularRadiusAtZoom15'
  | 'circularRadiusMeters'
  | 'confidence'
  | 'circumference'
  | 'diameterCrown'
  | 'elevation'
  | 'elevationFeet'
  | 'hasParts'
  | 'height'
  | 'hide3d'
  | 'importanceTier'
  | 'minHeight'
  | 'minZoom'
  | 'oneway'
  | 'poiFilterRank'
  | 'poiSizeRank'
  | 'ramp'
  | 'rank'
  | 'refLength'
  | 'renderHeight'
  | 'renderMinHeight'
  | 'shieldLineLengthMeters'
  | 'shieldRank';

/** Runtime value implied by one registered semantic field, independent of its physical name. */
export type TileflowDataFieldValue<TName extends TileflowDataFieldName> =
  TName extends TileflowNumericDataFieldName ? number : string;

/** Internal source-layer reference preserved until the compiler's lowering boundary. */
export type TileflowDataLayerReference<
  TName extends keyof OpenMapTilesLayerBindings = keyof OpenMapTilesLayerBindings,
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

export function dataLayer<const TName extends keyof OpenMapTilesLayerBindings>(
  name: TName,
): TileflowDataLayerReference<TName> {
  return Object.freeze({kind: 'tileflow-data-layer', name});
}

export function dataSource(): TileflowDataSourceReference {
  return Object.freeze({kind: 'tileflow-data-source', name: 'primary'});
}

/**
 * Present the active data contract to domain compilers as semantic references.
 * Optional capabilities retain their exact present/absent shape; physical names
 * are restored only by `bindSemanticReferences` at the lowering boundary.
 */
export function createSemanticDataView(data: ResolvedTileflowData): ResolvedTileflowData {
  const fields = Object.fromEntries(
    Object.entries(data.schema.fields).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, field(name as keyof OpenMapTilesFieldBindings)] as const],
    ),
  );
  const layers = Object.fromEntries(
    Object.entries(data.schema.layers).flatMap(([name, value]) =>
      value === undefined
        ? []
        : [[name, dataLayer(name as keyof OpenMapTilesLayerBindings)] as const],
    ),
  );
  return {
    ...data,
    sourceId: dataSource(),
    schema: {...data.schema, fields, layers},
  } as unknown as ResolvedTileflowData;
}

export function bindSemanticReferences<T>(value: T, data: ResolvedTileflowData): T {
  return bindSemanticValue(value, data.schema, data.sourceId) as T;
}

function bindSemanticValue(value: unknown, schema: OpenMapTilesSchema, sourceId: string): unknown {
  if (isDataFieldReference(value)) {
    if (Object.hasOwn(auxiliaryFieldBindings, value.name)) {
      return auxiliaryFieldBindings[value.name as keyof typeof auxiliaryFieldBindings];
    }
    const binding = schema.fields[value.name as keyof OpenMapTilesFieldBindings];
    if (!binding) throw new Error(`Tileflow data schema does not provide field ${value.name}.`);
    return binding;
  }
  if (isDataLayerReference(value)) {
    const binding = schema.layers[value.name];
    if (!binding) throw new Error(`Tileflow data schema does not provide layer ${value.name}.`);
    return binding;
  }
  if (isDataSourceReference(value)) return sourceId;
  if (Array.isArray(value)) return value.map((item) => bindSemanticValue(item, schema, sourceId));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, bindSemanticValue(item, schema, sourceId)]),
  );
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
