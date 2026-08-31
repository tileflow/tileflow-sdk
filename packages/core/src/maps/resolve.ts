import {mergeTileflowDesign} from '../cartography/merge';
import {isTileflowRemoveOperation} from '../overlays';
import {
  isTileflowModuleOperation,
  isTileflowReset,
  type TileflowModuleOperation,
} from './operations';
import {
  type ResolvedTileflowMap,
  type ResolveMapOptions,
  type TileflowMap,
  tileflowMapIdSchema,
} from './types';

export const tileflowMapDefaultMaxDepth = 64;

/** Structured authoring failure surfaced unchanged by validate/explain JSON commands. */
export class TileflowMapResolutionError extends Error {
  readonly code: string;
  readonly mapId: string;
  readonly path: string;

  constructor(code: string, mapId: string, path: string, message: string) {
    super(`Invalid Tileflow map "${mapId}" at ${path}: ${message}`);
    this.code = code;
    this.mapId = mapId;
    this.name = 'TileflowMapResolutionError';
    this.path = path;
  }
}

type MapMergeStrategy =
  | 'atomic'
  | 'deep'
  | 'icons'
  | 'identity'
  | 'keyed-resources'
  | 'leaf'
  | 'lineage'
  | 'modules'
  | 'text-assets';

/** Every public map key must choose one resolution strategy explicitly. */
export const tileflowMapMergeStrategies = {
  data: 'atomic',
  defaultTheme: 'atomic',
  extends: 'lineage',
  fonts: 'text-assets',
  glyphs: 'text-assets',
  icons: 'icons',
  id: 'identity',
  marine: 'atomic',
  modules: 'modules',
  name: 'identity',
  overlays: 'keyed-resources',
  projection: 'atomic',
  scenes: 'leaf',
  sources: 'keyed-resources',
  systemThemes: 'atomic',
  terrain: 'atomic',
  themes: 'atomic',
  version: 'identity',
  view: 'deep',
} as const satisfies Record<keyof TileflowMap, MapMergeStrategy>;

type TileflowMapKey = keyof typeof tileflowMapMergeStrategies;

/** Resolve an imported map lineage to one standalone authoring map. */
export function resolveMap(map: TileflowMap, options: ResolveMapOptions = {}): ResolvedTileflowMap {
  const maxDepth = options.maxDepth ?? tileflowMapDefaultMaxDepth;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new Error('Tileflow map resolution maxDepth must be a positive integer.');
  }

  const lineage = collectLineage(map, maxDepth);

  const design: Record<string, unknown> = {};
  let modules: Record<string, unknown> | undefined;

  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const current = lineage[index]!;
    const currentId = current.id;

    // A theme collection and its browser scheme mapping form one semantic family. Replacing the
    // collection clears an inherited mapping; the same map may declare a new mapping explicitly.
    if (current.themes !== undefined) delete design.systemThemes;

    for (const key of Object.keys(current) as TileflowMapKey[]) {
      const value = current[key];
      const strategy = tileflowMapMergeStrategies[key];
      switch (strategy) {
        case 'atomic': {
          if (value !== undefined) design[key] = cloneDesign(value);
          break;
        }
        case 'deep': {
          const merged = mergeOptionalDesign(design[key], value);
          if (merged !== undefined) design[key] = merged;
          break;
        }
        case 'icons': {
          if (value === undefined) break;
          if (!Array.isArray(value)) {
            throw new Error(`Tileflow map "${current.id}" icons must be an array of directories.`);
          }
          design.icons = cloneDesign(value);
          break;
        }
        case 'keyed-resources': {
          if (value === undefined) break;
          if (!isPlainRecord(value)) {
            throw new Error(`Tileflow map "${current.id}" ${key} must be a plain object.`);
          }
          const resources: Record<string, unknown> = value;
          const existing = isPlainRecord(design[key]) ? cloneDesign(design[key]) : {};
          for (const resourceId of Object.keys(resources).sort()) {
            const resource = resources[resourceId];
            if (isTileflowRemoveOperation(resource)) {
              delete existing[resourceId];
            } else {
              existing[resourceId] = cloneDesign(resource);
            }
          }
          design[key] = Object.fromEntries(
            Object.entries(existing).sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            ),
          );
          break;
        }
        case 'modules': {
          if (value === undefined) break;
          if (!isPlainRecord(value)) {
            throw new Error(`Tileflow map "${current.id}" modules must be a plain object.`);
          }
          modules = applyModuleRequests(modules, value, currentId);
          break;
        }
        case 'text-assets': {
          if (value === undefined) break;
          if (current.fonts !== undefined && current.glyphs !== undefined) {
            throw new Error(
              `Tileflow map "${currentId}" must declare either fonts or glyphs, not both.`,
            );
          }
          if (key === 'fonts') {
            delete design.glyphs;
            design.fonts = cloneDesign(value);
          } else {
            delete design.fonts;
            design.glyphs = cloneDesign(value);
          }
          break;
        }
        case 'identity':
        case 'leaf':
        case 'lineage':
          break;
        default:
          assertNever(strategy);
      }
    }
  }

  const leaf = lineage[0]!;
  const id = parseMapId(leaf.id);
  const resolved = {
    id,
    name: leaf.name ?? id,
    version: leaf.version,
    ...design,
    ...(modules === undefined ? {} : {modules}),
  } as ResolvedTileflowMap;
  return resolved;
}

function applyModuleRequests(
  inherited: Record<string, unknown> | undefined,
  requests: Record<string, unknown>,
  mapId: string,
): Record<string, unknown> {
  const resolved = cloneDesign(inherited ?? {});
  for (const [moduleName, request] of Object.entries(requests)) {
    const path = `/modules/${escapeJsonPointer(moduleName)}`;
    if (!isPlainRecord(request)) {
      throw moduleResolutionError(
        'TILEFLOW_INVALID_MODULE_REQUEST',
        mapId,
        path,
        'Expected a semantic module or module operation.',
      );
    }

    if (isTileflowModuleOperation(request)) {
      applyModuleOperation(resolved, moduleName, request, mapId, path);
      continue;
    }
    if (Object.hasOwn(request, 'op')) {
      throw moduleResolutionError(
        'TILEFLOW_INVALID_MODULE_OPERATION',
        mapId,
        `${path}/op`,
        `Unsupported operation ${JSON.stringify(request.op)}.`,
      );
    }
    assertNoTopLevelModuleEnabled(request, mapId, path);
    assertNoReset(request, mapId, path, false);
    assertModuleOwner(request, moduleName, mapId, path);
    resolved[moduleName] = cloneDesign(request);
  }
  return resolved;
}

function applyModuleOperation(
  resolved: Record<string, unknown>,
  moduleName: string,
  operation: TileflowModuleOperation<object>,
  mapId: string,
  path: string,
): void {
  switch (operation.op) {
    case 'disable': {
      assertExactKeys(operation, ['op'], mapId, path);
      resolved[moduleName] = {enabled: false, type: moduleName};
      return;
    }
    case 'refine': {
      assertExactKeys(operation, ['op', 'patches'], mapId, path);
      if (!Array.isArray(operation.patches) || operation.patches.length === 0) {
        throw moduleResolutionError(
          'TILEFLOW_INVALID_MODULE_PATCH',
          mapId,
          `${path}/patches`,
          'Expected at least one semantic patch.',
        );
      }
      const inherited = resolved[moduleName];
      if (!isPlainRecord(inherited)) {
        throw moduleResolutionError(
          'TILEFLOW_REFINE_WITHOUT_BASE',
          mapId,
          path,
          'Cannot refine this domain because no inherited module exists; declare it directly on a base map first.',
        );
      }
      let next = cloneDesign(inherited);
      for (const [index, patch] of operation.patches.entries()) {
        if (!isPlainRecord(patch) || isTileflowReset(patch)) {
          throw moduleResolutionError(
            'TILEFLOW_INVALID_MODULE_PATCH',
            mapId,
            `${path}/patches/${index}`,
            'Expected a semantic record.',
          );
        }
        assertNoTopLevelModulePatchKeys(patch, mapId, `${path}/patches/${index}`);
        assertNoReset(patch, mapId, `${path}/patches/${index}`, true);
        next = applyModulePatch(next, patch, mapId, `${path}/patches/${index}`);
      }
      assertModuleOwner(next, moduleName, mapId, path);
      resolved[moduleName] = next;
      return;
    }
    default:
      assertNever(operation);
  }
}

function assertNoTopLevelModuleEnabled(
  module: Record<string, unknown>,
  mapId: string,
  path: string,
): void {
  if (!Object.hasOwn(module, 'enabled')) return;
  throw moduleResolutionError(
    'TILEFLOW_MODULE_ENABLED_RESERVED',
    mapId,
    `${path}/enabled`,
    'enabled is compiler-owned state; use disable() to suppress a complete semantic domain.',
  );
}

function assertNoTopLevelModulePatchKeys(
  patch: Record<string, unknown>,
  mapId: string,
  path: string,
): void {
  assertNoTopLevelModuleEnabled(patch, mapId, path);
  if (!Object.hasOwn(patch, 'type')) return;
  throw moduleResolutionError(
    'TILEFLOW_MODULE_TYPE_RESERVED',
    mapId,
    `${path}/type`,
    'type is immutable module ownership and cannot be refined.',
  );
}

function applyModulePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  mapId: string,
  path: string,
): Record<string, unknown> {
  const result = cloneDesign(base);
  for (const [key, value] of Object.entries(patch)) {
    const childPath = `${path}/${escapeJsonPointer(key)}`;
    if (isTileflowReset(value)) {
      delete result[key];
      continue;
    }
    const inherited = result[key];
    result[key] =
      isPlainRecord(inherited) && isPlainRecord(value)
        ? applyModulePatch(inherited, value, mapId, childPath)
        : cloneDesign(value);
  }
  return result;
}

function assertNoReset(value: unknown, mapId: string, path: string, allowReset: boolean): void {
  if (isTileflowReset(value)) {
    if (!allowReset) {
      throw moduleResolutionError(
        'TILEFLOW_RESET_OUTSIDE_REFINE',
        mapId,
        path,
        'reset() is only valid inside refine().',
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      if (isTileflowReset(child)) {
        throw moduleResolutionError(
          'TILEFLOW_RESET_IN_ARRAY',
          mapId,
          `${path}/${index}`,
          'reset() cannot appear inside an array.',
        );
      }
      assertNoReset(child, mapId, `${path}/${index}`, false);
    }
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    assertNoReset(child, mapId, `${path}/${escapeJsonPointer(key)}`, allowReset);
  }
}

function assertModuleOwner(
  module: Record<string, unknown>,
  moduleName: string,
  mapId: string,
  path: string,
): void {
  if (module.type !== moduleName) {
    throw moduleResolutionError(
      'TILEFLOW_MODULE_OWNER_MISMATCH',
      mapId,
      `${path}/type`,
      `Expected ${JSON.stringify(moduleName)}, received ${JSON.stringify(module.type)}.`,
    );
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  mapId: string,
  path: string,
): void {
  const allowed = new Set(expected);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw moduleResolutionError(
      'TILEFLOW_INVALID_MODULE_OPERATION',
      mapId,
      `${path}/${escapeJsonPointer(unexpected)}`,
      `Property is not valid for ${String(value.op)}().`,
    );
  }
}

function moduleResolutionError(
  code: string,
  mapId: string,
  path: string,
  message: string,
): TileflowMapResolutionError {
  return new TileflowMapResolutionError(code, mapId, path, message);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function collectLineage(map: TileflowMap, maxDepth: number): TileflowMap[] {
  const lineage: TileflowMap[] = [];
  const seen = new Map<object, number>();
  let current: unknown = map;

  while (true) {
    if (!isPlainRecord(current)) {
      throw new Error('Tileflow map extends must reference another map object.');
    }

    const unknownKey = Object.keys(current).find(
      (key) => !Object.hasOwn(tileflowMapMergeStrategies, key),
    );
    if (unknownKey) {
      throw new Error(
        `Tileflow map "${describeMap(current)}" has unrecognized key "${unknownKey}".`,
      );
    }

    const repeatedAt = seen.get(current);
    if (repeatedAt !== undefined) {
      const cycle = [...lineage.slice(repeatedAt).map(describeMap), describeMap(current)].join(
        ' -> ',
      );
      throw new Error(`Circular Tileflow map inheritance: ${cycle}.`);
    }
    if (lineage.length >= maxDepth) {
      throw new Error(
        `Tileflow map inheritance exceeds maxDepth ${maxDepth}: ${[
          ...lineage.map(describeMap),
          describeMap(current),
        ].join(' -> ')}.`,
      );
    }

    assertIdentity(current);
    const hasParent = current.extends !== undefined;

    seen.set(current, lineage.length);
    lineage.push(current as TileflowMap);
    if (!hasParent) return lineage;
    current = current.extends;
  }
}

function assertIdentity(map: Record<string, unknown>): asserts map is Record<string, unknown> & {
  id: string;
  version: number;
} {
  parseMapId(map.id);
  if (!Number.isSafeInteger(map.version) || (map.version as number) < 1) {
    throw new Error(`Tileflow map "${map.id}" version must be a positive integer.`);
  }
}

function parseMapId(input: unknown): string {
  const result = tileflowMapIdSchema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(
    `Tileflow map id must be portable and at most 64 characters: ${result.error.issues[0]?.message ?? 'Invalid identifier'}.`,
  );
}

function mergeOptionalDesign(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return cloneDesign(base);
  if (base === undefined) return cloneDesign(overlay);
  return mergeTileflowDesign(base, overlay);
}

function cloneDesign<T>(value: T): T {
  return mergeTileflowDesign(value);
}

function describeMap(value: Record<string, unknown>): string {
  return typeof value.id === 'string' && value.id ? value.id : '<anonymous>';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Tileflow map merge strategy: ${String(value)}`);
}
