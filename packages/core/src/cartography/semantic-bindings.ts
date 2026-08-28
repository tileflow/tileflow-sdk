import {
  tileflowWorldV1Schema,
  type OpenMapTilesFieldBindings,
  type OpenMapTilesLayerBindings,
  type OpenMapTilesSchema,
  type ResolvedTileflowData,
} from '../data';

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

/** A schema-bound data field whose physical name is assigned only during compilation. */
export type TileflowDataFieldReference<
  TName extends keyof OpenMapTilesFieldBindings = keyof OpenMapTilesFieldBindings,
> = Readonly<{
  kind: 'tileflow-data-field';
  name: TName;
}>;

export type TileflowNumericDataFieldName =
  | 'activityScore'
  | 'adminLevel'
  | 'bathymetryMinDepth'
  | 'bathymetrySortKey'
  | 'circularClearanceExtraAtZoom15'
  | 'circularInnerRadiusMeters'
  | 'circularOuterRadiusMeters'
  | 'circularRadiusAtZoom15'
  | 'circularRadiusMeters'
  | 'classificationConfidence'
  | 'confidence'
  | 'circumference'
  | 'diameterCrown'
  | 'elevation'
  | 'elevationFeet'
  | 'hasBusiness'
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
  | 'renderMinZoom'
  | 'shieldLineLengthMeters'
  | 'shieldRank';

/** Runtime value implied by one registered semantic field, independent of its physical name. */
export type TileflowDataFieldValue<TName extends keyof OpenMapTilesFieldBindings> =
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
 * Reference a semantic field in a typed expression without capturing an
 * OpenMapTiles property name. The active data schema supplies the physical
 * binding at the final lowering boundary.
 */
export function field<const TName extends keyof OpenMapTilesFieldBindings>(
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
    const binding = schema.fields[value.name];
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
