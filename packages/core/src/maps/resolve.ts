import {mergeTileflowDesign} from '../cartography/merge';
import {attachResolvedModuleEffects} from '../cartography/module-effects';
import {
  tileflowMapIdSchema,
  tileflowStreetsCompilerVersion,
  type ResolvedTileflowMap,
  type ResolveMapOptions,
  type TileflowMap,
  type TileflowMapRoot,
  type TileflowRootMap,
} from './types';

export const tileflowMapDefaultMaxDepth = 64;

type MapMergeStrategy =
  | 'atomic'
  | 'deep'
  | 'icons'
  | 'identity'
  | 'leaf'
  | 'lineage'
  | 'modules'
  | 'text-assets';

/** Every public map key must choose one resolution strategy explicitly. */
export const tileflowMapMergeStrategies = {
  data: 'atomic',
  delivery: 'leaf',
  extends: 'lineage',
  fonts: 'text-assets',
  glyphs: 'text-assets',
  icons: 'icons',
  id: 'identity',
  light: 'deep',
  modules: 'modules',
  name: 'identity',
  projection: 'atomic',
  root: 'lineage',
  scenes: 'leaf',
  terrain: 'atomic',
  theme: 'deep',
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
  const rootMap = lineage[lineage.length - 1] as TileflowRootMap;
  assertRoot(rootMap.root, rootMap.id);

  const design: Record<string, unknown> = {};
  let modules: Record<string, unknown> | undefined;

  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const current = lineage[index]!;
    const currentId = current.id;

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
        case 'modules': {
          if (value === undefined) break;
          if (!isPlainRecord(value)) {
            throw new Error(`Tileflow map "${current.id}" modules must be a plain object.`);
          }
          modules = {...modules, ...cloneDesign(value)};
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
    root: cloneDesign(rootMap.root),
    ...design,
    ...(modules === undefined ? {} : {modules}),
    ...(leaf.delivery === undefined ? {} : {delivery: cloneDesign(leaf.delivery)}),
  } as ResolvedTileflowMap;
  attachResolvedModuleEffects(resolved, lineage);
  return resolved;
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
    const hasRoot = current.root !== undefined;
    const hasParent = current.extends !== undefined;
    if (hasRoot === hasParent) {
      throw new Error(`Tileflow map "${current.id}" must define exactly one of root or extends.`);
    }

    seen.set(current, lineage.length);
    lineage.push(current as TileflowMap);
    if (hasRoot) return lineage;
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

function assertRoot(root: TileflowMapRoot, mapId: string): void {
  if (
    !isRecord(root) ||
    root.compiler !== 'streets' ||
    root.compilerVersion !== tileflowStreetsCompilerVersion ||
    Object.keys(root).some((key) => key !== 'compiler' && key !== 'compilerVersion')
  ) {
    throw new Error(
      `Tileflow map "${mapId}" has an unsupported root; expected ` +
        `{compiler: "streets", compilerVersion: ${tileflowStreetsCompilerVersion}}.`,
    );
  }
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
