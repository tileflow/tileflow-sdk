import {createJiti} from 'jiti';
import {existsSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve, sep} from 'node:path';
import {
  parseTileflowMap,
  tileflowCaptureSceneNameSchema,
  type TileflowMap,
  TileflowResolvedMapValidationError,
  type ValidationMessage,
} from '@tileflow/core';
import {collectTileflowMapBuildLineage, type TileflowBuildCatalog} from '@tileflow/core/build';
import {isPathWithin} from './path-safety';

export const defaultTileflowApiUrl = 'https://api.tileflow.dev';
export const defaultTileflowConfigPath = 'tileflow.config.ts';
export const defaultTileflowManifestPath = 'public/tileflow/manifest.json';

export type LoadTileflowConfigOptions = {
  cwd?: string;
  fresh?: boolean;
};

export type LoadedTileflowConfig = {
  /** Tooling-only authoring definitions retained for resolved-config provenance. Never serialize. */
  authoringMaps: Record<string, TileflowMap>;
  /** Absolute executable config path. Asset directories resolve from its parent directory. */
  configFile: string;
  inputFiles: string[];
  project: TileflowBuildCatalog;
};

export class TileflowValidationError extends Error {
  readonly code = 'CONFIG_INVALID' as const;
  readonly messages: ValidationMessage[];
  readonly phase = 'config-validation' as const;

  constructor(messages: ValidationMessage[]) {
    super('Invalid Tileflow config');
    this.name = 'TileflowValidationError';
    this.messages = messages;
  }
}

export async function loadTileflowConfig(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<TileflowBuildCatalog> {
  return (await loadTileflowConfigWithInputs(configPath, options)).project;
}

export async function loadTileflowConfigWithInputs(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<LoadedTileflowConfig> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = resolve(cwd, configPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  if (options.fresh) {
    clearTileflowLocalModuleCache(resolvedPath, cwd);
  }

  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: true,
  });
  const imported = await jiti.import(resolvedPath, {default: true});
  const allowWorkspace = /\.workspace\.(?:[cm]?[jt]s)$/u.test(resolvedPath);
  const project = asTileflowBuildCatalog(imported, {allowWorkspace});

  return {
    authoringMaps: getTileflowAuthoringMaps(imported, project, allowWorkspace),
    configFile: resolvedPath,
    inputFiles: collectTileflowConfigInputs(resolvedPath, cwd),
    project,
  };
}

export async function loadValidTileflowConfig(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<TileflowBuildCatalog> {
  const project = await loadTileflowConfig(configPath, options);

  assertValidTileflowConfig(project);

  return project;
}

export async function loadValidTileflowConfigWithInputs(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<LoadedTileflowConfig> {
  const loaded = await loadTileflowConfigWithInputs(configPath, options);
  assertValidTileflowConfig(loaded.project);
  return loaded;
}

export function assertValidTileflowConfig(project: TileflowBuildCatalog): void {
  const messages: ValidationMessage[] = [];
  for (const [mapId, map] of Object.entries(project.maps)) {
    try {
      parseTileflowMap(map);
    } catch (error) {
      messages.push({
        level: 'error',
        path: `maps.${mapId}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const [sceneId, scene] of Object.entries(project.scenes ?? {})) {
    if (!Object.hasOwn(project.maps, scene.map)) {
      messages.push({
        level: 'error',
        path: `scenes.${sceneId}.map`,
        message: `Unknown Tileflow map "${scene.map}".`,
      });
    }
  }
  if (messages.length > 0) throw new TileflowValidationError(messages);
}

function asTileflowBuildCatalog(
  input: unknown,
  options: {allowWorkspace?: boolean} = {},
): TileflowBuildCatalog {
  if (isRecord(input) && isRecord(input.maps)) {
    if (!options.allowWorkspace) {
      throw tileflowConfigValidationError(
        'maps',
        new Error(
          'tileflow.config.ts must export one map. Multi-map catalogs are internal workspaces and must use a *.workspace.ts file.',
        ),
      );
    }
    const unknownKey = Object.keys(input).find((key) => key !== 'maps');
    if (unknownKey) {
      throw tileflowConfigValidationError(
        unknownKey,
        new Error(`Tileflow workspace has unrecognized key "${unknownKey}".`),
      );
    }
    const entries = Object.entries(input.maps).map(([key, value]) => {
      const map = value as TileflowMap;
      const resolved = parseTileflowCatalogMap(map, `maps.${key}`);
      if (key !== resolved.id) {
        throw tileflowConfigValidationError(
          `maps.${key}`,
          new Error(`Tileflow workspace map key "${key}" must match the map id "${resolved.id}".`),
        );
      }
      return [
        key,
        resolved,
        collectTileflowMapBuildLineage(map),
        normalizeSingularMapScenes(map, resolved.id),
      ] as const;
    });
    if (entries.length === 0) {
      throw tileflowConfigValidationError(
        'maps',
        new Error('Tileflow workspace must contain at least one map.'),
      );
    }
    const scenes = new Map<string, NonNullable<TileflowBuildCatalog['scenes']>[string]>();
    for (const [mapId, , , mapScenes] of entries) {
      for (const [sceneId, scene] of Object.entries(mapScenes ?? {})) {
        if (scenes.has(sceneId)) {
          throw tileflowConfigValidationError(
            `maps.${mapId}.scenes.${sceneId}`,
            new Error(`Tileflow workspace scene "${sceneId}" is already defined by another map.`),
          );
        }
        scenes.set(sceneId, scene);
      }
    }
    return {
      mapMetadata: Object.fromEntries(
        entries.map(([id, map, lineage]) => [
          id,
          {id, lineage, root: map.root, version: map.version},
        ]),
      ),
      maps: Object.fromEntries(entries.map(([id, map]) => [id, map])),
      ...(scenes.size > 0 ? {scenes: Object.fromEntries(scenes)} : {}),
    };
  }

  const map = input as TileflowMap;
  const resolved = parseTileflowCatalogMap(map, '');
  let scenes: TileflowBuildCatalog['scenes'] | undefined;
  try {
    scenes = normalizeSingularMapScenes(map, resolved.id);
  } catch (error) {
    throw tileflowConfigValidationError('scenes', error);
  }
  return {
    mapMetadata: {
      [resolved.id]: {
        id: resolved.id,
        lineage: collectTileflowMapBuildLineage(map),
        root: resolved.root,
        version: resolved.version,
      },
    },
    maps: {[resolved.id]: resolved},
    ...(scenes ? {scenes} : {}),
  };
}

function parseTileflowCatalogMap(map: TileflowMap, path: string) {
  try {
    return parseTileflowMap(map);
  } catch (error) {
    throw tileflowConfigValidationError(path, error);
  }
}

function getTileflowAuthoringMaps(
  input: unknown,
  project: TileflowBuildCatalog,
  allowWorkspace: boolean,
): Record<string, TileflowMap> {
  if (allowWorkspace && isRecord(input) && isRecord(input.maps)) {
    const maps = input.maps;
    return Object.fromEntries(
      Object.keys(project.maps).map((mapId) => [mapId, maps[mapId] as TileflowMap]),
    );
  }

  const [mapId] = Object.keys(project.maps);
  return mapId ? {[mapId]: input as TileflowMap} : {};
}

function tileflowConfigValidationError(path: string, error: unknown): TileflowValidationError {
  if (error instanceof TileflowValidationError) return error;
  if (error instanceof TileflowResolvedMapValidationError) {
    return new TileflowValidationError(
      error.messages.map((message) => ({
        ...message,
        path: prefixValidationPath(path, message.path),
      })),
    );
  }
  return new TileflowValidationError([
    {
      level: 'error',
      path: path || 'map',
      message: error instanceof Error ? error.message : String(error),
    },
  ]);
}

function prefixValidationPath(prefix: string, path: string): string {
  const child = path === 'config' ? '' : path;
  if (!prefix) return child || 'map';
  return child ? `${prefix}.${child}` : prefix;
}

function normalizeSingularMapScenes(
  map: TileflowMap,
  mapId: string,
): TileflowBuildCatalog['scenes'] | undefined {
  if (!map.scenes) return undefined;
  return Object.fromEntries(
    Object.entries(map.scenes).map(([sceneId, scene]) => {
      const normalizedSceneId = tileflowCaptureSceneNameSchema.parse(sceneId);
      return [normalizedSceneId, {...scene, map: mapId}];
    }),
  );
}

export function getTileflowMapNames(project: TileflowBuildCatalog): string[] {
  return Object.keys(project.maps);
}

export function getFirstTileflowMapName(project: TileflowBuildCatalog): string {
  const [mapName] = getTileflowMapNames(project);

  if (!mapName) {
    throw new Error('Tileflow config must define at least one map.');
  }

  return mapName;
}

const localRequire = createRequire(import.meta.url);

function collectTileflowConfigInputs(configPath: string, cwd: string): string[] {
  const roots = [canonicalPath(cwd), canonicalPath(dirname(resolve(configPath)))];
  const inputs = new Set<string>([canonicalPath(configPath)]);
  const pending = [localRequire.cache[canonicalPath(configPath)]];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const module = pending.pop();
    if (!module || visited.has(module.filename)) continue;
    visited.add(module.filename);
    const path = canonicalPath(module.filename);
    if (
      !path.split(sep).includes('node_modules') &&
      roots.some((root) => isPathWithin(root, path))
    ) {
      inputs.add(path);
    }
    pending.push(...module.children);
  }

  // Jiti can evaluate an ESM fallback without linking it into the root CommonJS module. Include
  // newly populated local cache entries so that those transitive inputs remain watchable.
  for (const cachePath of Object.keys(localRequire.cache)) {
    const path = canonicalPath(cachePath);
    if (
      !path.split(sep).includes('node_modules') &&
      roots.some((root) => isPathWithin(root, path))
    ) {
      inputs.add(path);
    }
  }

  return [...inputs].sort();
}

function clearTileflowLocalModuleCache(configPath: string, cwd: string): void {
  const roots = [canonicalPath(cwd), canonicalPath(dirname(resolve(configPath)))];

  for (const cachePath of Object.keys(localRequire.cache)) {
    if (cachePath.split(sep).includes('node_modules')) continue;
    if (roots.some((root) => isPathWithin(root, canonicalPath(cachePath)))) {
      delete localRequire.cache[cachePath];
    }
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
