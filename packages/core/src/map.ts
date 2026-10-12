import {
  tileflowCaptureSceneFitIssue,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureSceneSchema,
} from './capture-scene';
import {tileflowCaptureShotSchema} from './capture-shot';
import {
  createTileflowCompilationFailure,
  type TileflowCompilationResult,
} from './cartography/compilation-report';
import {
  compileSemanticStyle,
  compileSemanticStyleResult,
  type TileflowSemanticCompilationOptions,
  type TileflowSemanticCompileOptions,
  type TileflowSemanticMapConfig,
} from './cartography/streets';
import {type ResolvedTileflowMap, resolveMap, type TileflowMap, tileflowMapIdSchema} from './maps';
import {parseResolvedTileflowMap, TileflowResolvedMapValidationError} from './resolved-map-schema';
import type {MapLibreStyle, ValidationResult} from './types';

export type TileflowStyleOptions = TileflowSemanticCompileOptions;
export type TileflowCompilationOptions = TileflowSemanticCompilationOptions;

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
        version: compiled.version,
      } satisfies NonNullable<TileflowStyleOptions['map']>),
  });
}

/** Resolve and compile one map without throwing, returning deterministic compiler diagnostics. */
export function createStyleResult(
  config: TileflowMap,
  options: TileflowCompilationOptions = {},
): TileflowCompilationResult {
  try {
    const compiled = parseTileflowMap(config);
    return compileSemanticStyleResult(compiled, {
      ...options,
      map:
        options.map ??
        ({
          id: compiled.id,
          lineage: collectMapLineage(config),
          version: compiled.version,
        } satisfies NonNullable<TileflowStyleOptions['map']>),
    });
  } catch (error) {
    return createTileflowCompilationFailure({
      error,
      map: typeof config.id === 'string' ? config.id : '<unresolved>',
      phase: 'input',
      theme: options.theme,
    });
  }
}

function compileTileflowMap(
  config: TileflowSemanticMapConfig,
  options: TileflowStyleOptions,
): MapLibreStyle {
  return compileSemanticStyle(config, options);
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
    validateMapShots(node, resolved.id);
    const parsed = parseResolvedTileflowMap(resolved);
    if (node === map) parsedLeaf = parsed;
  }
  if (!parsedLeaf) throw new Error('Tileflow map lineage is empty.');
  return parsedLeaf;
}

function validateMapScenes(map: TileflowMap, mapId: string): void {
  validateMapCaptureEntries(map, mapId, 'scenes', (input) => {
    const result = tileflowCaptureSceneSchema.safeParse(input);
    return result.success ? tileflowCaptureSceneFitIssue(result.data) : result.error.issues[0];
  });
}

function validateMapShots(map: TileflowMap, mapId: string): void {
  validateMapCaptureEntries(map, mapId, 'shots', (input) => {
    const result = tileflowCaptureShotSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0];
  });
}

/** Scenes and shots are leaf-owned records keyed by portable names that imply their map id. */
function validateMapCaptureEntries(
  map: TileflowMap,
  mapId: string,
  key: 'scenes' | 'shots',
  findIssue: (
    input: Record<string, unknown>,
  ) => {message: string; path: readonly PropertyKey[]} | undefined,
): void {
  const entries = map[key];
  if (entries === undefined) return;
  if (!isPlainRecord(entries)) {
    throw new Error(`Invalid Tileflow map "${map.id}". ${key}: Expected a plain object.`);
  }
  const label = key === 'scenes' ? 'scene' : 'shot';

  const namesByCaseFold = new Map<string, string>();
  for (const [name, input] of Object.entries(entries)) {
    const nameResult = tileflowCaptureSceneNameSchema.safeParse(name);
    if (!nameResult.success) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". ${key}.${name}: ${nameResult.error.issues[0]?.message ?? `Invalid ${label} name`}`,
      );
    }
    const normalizedName = nameResult.data;
    const folded = normalizedName.toLowerCase();
    const existing = namesByCaseFold.get(folded);
    if (existing) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". ${key}.${name}: Expected an id that does not normalize to "${existing}".`,
      );
    }
    namesByCaseFold.set(folded, normalizedName);

    if (!isPlainRecord(input)) {
      throw new Error(`Invalid Tileflow map "${map.id}". ${key}.${name}: Expected an object.`);
    }
    if (Object.hasOwn(input, 'map')) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". ${key}.${name}.map: Unrecognized key; a singular map ${label} inherits its map id.`,
      );
    }
    const issue = findIssue({...input, map: mapId});
    if (issue) {
      throw new Error(
        `Invalid Tileflow map "${map.id}". ${key}.${name}${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
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
