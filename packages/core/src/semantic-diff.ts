import {parseTileflowMap} from './map';
import type {ResolvedTileflowMap, TileflowMap} from './maps';
import {parseResolvedTileflowMap} from './resolved-map-schema';

export const tileflowSemanticDiffSchemaVersion = 1 as const;

export type TileflowSemanticMapIdentity = Readonly<{
  id: string;
  version: number;
}>;

export type TileflowSemanticJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly TileflowSemanticJsonValue[]
  | Readonly<{[key: string]: TileflowSemanticJsonValue}>;

export type TileflowSemanticAdd = Readonly<{
  after: TileflowSemanticJsonValue;
  kind: 'add';
  path: string;
}>;

export type TileflowSemanticRemove = Readonly<{
  before: TileflowSemanticJsonValue;
  kind: 'remove';
  path: string;
}>;

export type TileflowSemanticChange = Readonly<{
  after: TileflowSemanticJsonValue;
  before: TileflowSemanticJsonValue;
  kind: 'change';
  path: string;
}>;

export type TileflowSemanticDifference =
  | TileflowSemanticAdd
  | TileflowSemanticChange
  | TileflowSemanticRemove;

export type TileflowSemanticDiff = Readonly<{
  changes: readonly TileflowSemanticDifference[];
  from: TileflowSemanticMapIdentity;
  schemaVersion: typeof tileflowSemanticDiffSchemaVersion;
  summary: Readonly<{
    add: number;
    change: number;
    remove: number;
    total: number;
  }>;
  to: TileflowSemanticMapIdentity;
}>;

type SemanticRecord = Readonly<Record<string, TileflowSemanticJsonValue>>;

/**
 * Compare the resolved semantic designs of two maps. Identity metadata identifies the endpoints
 * but is intentionally not reported as a cartographic change. Arrays are atomic because map
 * inheritance replaces them rather than merging their members.
 */
export function diffTileflowMaps(
  from: TileflowMap | ResolvedTileflowMap,
  to: TileflowMap | ResolvedTileflowMap,
): TileflowSemanticDiff {
  const resolvedFrom = resolveSemanticDiffInput(from);
  const resolvedTo = resolveSemanticDiffInput(to);
  const changes: TileflowSemanticDifference[] = [];
  compareValues(semanticDesign(resolvedFrom), semanticDesign(resolvedTo), '', changes);
  const summary = {
    add: changes.filter(({kind}) => kind === 'add').length,
    change: changes.filter(({kind}) => kind === 'change').length,
    remove: changes.filter(({kind}) => kind === 'remove').length,
    total: changes.length,
  };
  return deepFreeze({
    changes,
    from: {id: resolvedFrom.id, version: resolvedFrom.version},
    schemaVersion: tileflowSemanticDiffSchemaVersion,
    summary,
    to: {id: resolvedTo.id, version: resolvedTo.version},
  });
}

function resolveSemanticDiffInput(input: TileflowMap | ResolvedTileflowMap): ResolvedTileflowMap {
  if (isAuthoringOnlyMapShape(input)) return parseTileflowMap(input as TileflowMap);
  return parseResolvedTileflowMap(input);
}

/**
 * Derived maps, owner-local scenes, omitted resolved names, and module operations exist only in
 * authoring. A standalone map without those features overlaps the resolved shape and can be
 * validated directly without catching and replacing a meaningful resolved-map validation error.
 */
function isAuthoringOnlyMapShape(input: unknown): boolean {
  if (!isUnknownRecord(input)) return true;
  if (
    !Object.hasOwn(input, 'name') ||
    Object.hasOwn(input, 'extends') ||
    Object.hasOwn(input, 'scenes')
  ) {
    return true;
  }
  if (!isUnknownRecord(input.modules)) return false;
  return Object.values(input.modules).some(
    (module) => isUnknownRecord(module) && Object.hasOwn(module, 'op'),
  );
}

function semanticDesign(map: ResolvedTileflowMap): SemanticRecord {
  const {extends: _extends, id: _id, name: _name, version: _version, ...design} = map;
  return toSemanticValue(design, '') as SemanticRecord;
}

function compareValues(
  before: TileflowSemanticJsonValue,
  after: TileflowSemanticJsonValue,
  path: string,
  output: TileflowSemanticDifference[],
): void {
  if (Object.is(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(
      compareCodeUnits,
    );
    for (const key of keys) {
      const nextPath = `${path}/${escapeJsonPointerSegment(key)}`;
      const hasBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      if (!hasBefore) {
        output.push({after: after[key]!, kind: 'add', path: nextPath});
      } else if (!hasAfter) {
        output.push({before: before[key]!, kind: 'remove', path: nextPath});
      } else {
        compareValues(before[key]!, after[key]!, nextPath, output);
      }
    }
    return;
  }
  if (deepEqual(before, after)) return;
  output.push({after, before, kind: 'change', path: path || ''});
}

function toSemanticValue(value: unknown, path: string): TileflowSemanticJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Tileflow semantic value at ${path || '/'} must be a finite number.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => toSemanticValue(entry, `${path}/${index}`));
  }
  if (isUnknownRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort(compareCodeUnits)
        .map((key) => [
          key,
          toSemanticValue(value[key], `${path}/${escapeJsonPointerSegment(key)}`),
        ]),
    );
  }
  throw new TypeError(`Tileflow semantic value at ${path || '/'} is not JSON-serializable.`);
}

function isRecord(value: TileflowSemanticJsonValue): value is SemanticRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepEqual(left: TileflowSemanticJsonValue, right: TileflowSemanticJsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]!))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareCodeUnits);
  const rightKeys = Object.keys(right).sort(compareCodeUnits);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key]!, right[key]!))
  );
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
