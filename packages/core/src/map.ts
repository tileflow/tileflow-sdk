import {tileflowCaptureSceneNameSchema, tileflowCaptureSceneSchema} from './capture-scene';
import {
  compileStreetsStyle,
  type TileflowStreetsCompileOptions,
  type TileflowStreetsMapConfig,
} from './cartography/streets';
import {
  type ResolvedTileflowMap,
  resolveMap,
  type TileflowMap,
  tileflowMapIdSchema,
  tileflowStreetsCompilerVersion,
} from './maps';
import {parseResolvedTileflowMap, TileflowResolvedMapValidationError} from './resolved-map-schema';
import type {MapLibreStyle, ValidationResult} from './types';

export type TileflowStyleOptions = TileflowStreetsCompileOptions;

export function createStyle(
  config: TileflowMap,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const compiled = parseTileflowMap(config);
  return compileTileflowMap(compiled, {
    ...options,
    map:
      options.map ??
      ({
        id: compiled.id,
        lineage: collectMapLineage(config),
        root: compiled.root,
        version: compiled.version,
      } satisfies NonNullable<TileflowStyleOptions['map']>),
  });
}

function compileTileflowMap(
  config: TileflowStreetsMapConfig,
  options: TileflowStyleOptions,
): MapLibreStyle {
  switch (config.root.compiler) {
    case 'streets': {
      if (config.root.compilerVersion !== tileflowStreetsCompilerVersion) {
        throw new Error(
          `Unsupported Streets compiler version: ${String(config.root.compilerVersion)}`,
        );
      }
      return compileStreetsStyle(config, options);
    }
  }
}

export function collectMapLineage(map: TileflowMap): string[] {
  const lineage: string[] = [];
  const seen = new Set<TileflowMap>();
  let current: TileflowMap | undefined = map;
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    lineage.push(tileflowMapIdSchema.parse(current.id));
    current = current.extends;
  }
  return lineage;
}

/** Resolve and validate one public authoring map before asset preparation or compilation. */
export function parseTileflowMap(map: TileflowMap): ResolvedTileflowMap {
  const resolvedLeaf = resolveMap(map);
  const lineage: TileflowMap[] = [];
  let current: TileflowMap | undefined = map;
  while (current) {
    lineage.push(current);
    current = current.extends;
  }

  let parsedLeaf: ResolvedTileflowMap | undefined;
  for (const node of lineage.reverse()) {
    const resolved = node === map ? resolvedLeaf : resolveMap(node);
    validateMapScenes(node, resolved.id);
    const parsed = parseResolvedTileflowMap(resolved);
    if (node === map) parsedLeaf = parsed;
  }
  if (!parsedLeaf) throw new Error('Tileflow map lineage is empty.');
  return parsedLeaf;
}

function validateMapScenes(map: TileflowMap, mapId: string): void {
  if (map.scenes === undefined) return;
  if (!isPlainRecord(map.scenes)) {
    throw new Error(`Invalid Tileflow map "${map.id}". scenes: Expected a plain object.`);
  }

  const namesByCaseFold = new Map<string, string>();
  for (const [sceneName, input] of Object.entries(map.scenes)) {
    const nameResult = tileflowCaptureSceneNameSchema.safeParse(sceneName);
    if (!nameResult.success) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". scenes.${sceneName}: ${nameResult.error.issues[0]?.message ?? 'Invalid scene name'}`,
      );
    }
    const normalizedSceneName = nameResult.data;
    const folded = normalizedSceneName.toLowerCase();
    const existing = namesByCaseFold.get(folded);
    if (existing) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". scenes.${sceneName}: Expected an id that does not normalize to "${existing}".`,
      );
    }
    namesByCaseFold.set(folded, normalizedSceneName);

    if (!isPlainRecord(input)) {
      throw new Error(`Invalid Tileflow map "${map.id}". scenes.${sceneName}: Expected an object.`);
    }
    if (Object.hasOwn(input, 'map')) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". scenes.${sceneName}.map: Unrecognized key; a singular map scene inherits its map id.`,
      );
    }
    const result = tileflowCaptureSceneSchema.safeParse({...input, map: mapId});
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(
        `Invalid Tileflow map "${map.id}". scenes.${sceneName}${issue?.path.length ? `.${issue.path.join('.')}` : ''}: ${issue?.message ?? 'Invalid scene'}`,
      );
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validate one singular authoring map, including its complete extends lineage. */
export function validateTileflowMap(input: unknown): ValidationResult {
  try {
    parseTileflowMap(input as TileflowMap);
    return {valid: true, messages: []};
  } catch (error) {
    if (error instanceof TileflowResolvedMapValidationError) {
      return {valid: false, messages: error.messages};
    }
    return {
      valid: false,
      messages: [
        {
          level: 'error',
          path: 'map',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
