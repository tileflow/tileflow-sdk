import {isAbsolute, relative, resolve, win32} from 'node:path';
import {
  auditTileflowMapThemeValues,
  compareCodeUnits,
  parseTileflowMap,
  type ResolvedTileflowMap,
  resolveTileflowTheme,
  type TileflowMap,
  type TileflowThemeAuditDiagnostic,
  type TileflowThemeColorScheme,
} from '@tileflow/core';
import {
  defaultTileflowConfigPath,
  type LoadedTileflowConfig,
  type LoadTileflowConfigOptions,
  loadValidTileflowConfigWithInputs,
} from './config';
import {sanitizeDiagnosticSecrets} from './diagnostic-sanitization';
import {
  createTileflowCommandSummary,
  type TileflowCommandSummary,
  type TileflowStructuredDiagnostic,
} from './validation';

export {inspectTileflowFeatures} from './feature-inspection';
export type {
  TileflowFeatureInspection,
  TileflowFeatureInspectionOptions,
  TileflowInspectedFeature,
  TileflowInspectedProperty,
} from './feature-inspection';

export type TileflowConfigInspectionOptions = LoadTileflowConfigOptions & {
  config?: string;
  map?: string;
};

export type TileflowMapLineageInspection = {
  depth: number;
  declaredPaths: string[];
  id: string;
  version: number;
};

export type TileflowMapMergeProvenance = {
  declared: boolean;
  inherited: boolean;
  operation: 'defined' | 'overridden';
  path: string;
  /** Stable root-to-leaf lineage depth; disambiguates repeated map ids. */
  sourceDepth: number;
  sourceMap: string;
};

export type TileflowResolvedMapInspection = {
  id: string;
  lineage: TileflowMapLineageInspection[];
  provenance: TileflowMapMergeProvenance[];
  resolved: Record<string, unknown>;
  themeContract: TileflowThemeContractInspection;
};

export type TileflowThemeDifferenceInspection = {
  from: unknown;
  path: string;
  to: unknown;
};

export type TileflowThemeInspection = {
  colorScheme: TileflowThemeColorScheme;
  differencesFromDefault: TileflowThemeDifferenceInspection[];
  id: string;
  isDefault: boolean;
  lighting: Record<string, unknown>;
  name: string;
  systemFor: TileflowThemeColorScheme[];
  tokens: {
    color: Record<string, string>;
    font: Record<string, string>;
    image: Record<string, string>;
    number: Record<string, number>;
  };
  typography: Record<string, unknown>;
  version: number;
};

export type TileflowThemeContractInspection = {
  audit: TileflowThemeAuditDiagnostic[];
  defaultTheme: string;
  systemThemes?: {dark: string; light: string};
  themes: Record<string, TileflowThemeInspection>;
  tokenSchema: {
    color: string[];
    font: string[];
    image: string[];
    number: string[];
  };
};

export type TileflowConfigInspection = TileflowCommandSummary & {
  command: 'inspect';
  ok: true;
  maps: TileflowResolvedMapInspection[];
  diagnostics: TileflowStructuredDiagnostic[];
};

/** Resolve a config once and expose only deterministic, secret-free authoring information. */
export async function inspectTileflowConfig(
  options: TileflowConfigInspectionOptions = {},
): Promise<TileflowConfigInspection> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadValidTileflowConfigWithInputs(
    options.config ?? defaultTileflowConfigPath,
    options,
  );
  return inspectLoadedTileflowConfig(loaded, {cwd, map: options.map});
}

export function inspectLoadedTileflowConfig(
  loaded: LoadedTileflowConfig,
  options: {cwd: string; map?: string},
): TileflowConfigInspection {
  const mapIds = Object.keys(loaded.project.maps).sort(compareCodeUnits);
  if (options.map && !Object.hasOwn(loaded.project.maps, options.map)) {
    throw new TileflowConfigInspectionError(
      'INSPECT_MAP_NOT_FOUND',
      `Unknown Tileflow map "${options.map}". Available maps: ${mapIds.join(', ') || '(none)'}.`,
      'map',
    );
  }
  const selectedMapIds = options.map ? [options.map] : mapIds;
  const maps = selectedMapIds.map((mapId) =>
    inspectResolvedMap(loaded, mapId, resolve(options.cwd)),
  );
  const summary = createTileflowCommandSummary({
    code: 'INSPECTION_READY',
    command: 'inspect',
    message: `Resolved Tileflow config inspection is ready (${maps.length} ${maps.length === 1 ? 'map' : 'maps'}).`,
    ok: true,
    path: '',
    phase: 'config-inspection',
    severity: 'info',
    suggestion: 'Use lineage and provenance paths to make the smallest authoring change.',
  });

  return {...summary, command: 'inspect', ok: true, maps, diagnostics: []};
}

export class TileflowConfigInspectionError extends Error {
  readonly phase = 'config-inspection' as const;
  readonly issues: Array<{code: string; message: string; path: string; phase: string}>;

  constructor(
    readonly code: string,
    message: string,
    path: string,
  ) {
    super(message);
    this.name = 'TileflowConfigInspectionError';
    this.issues = [{code, message, path, phase: this.phase}];
  }
}

function inspectResolvedMap(
  loaded: LoadedTileflowConfig,
  mapId: string,
  cwd: string,
): TileflowResolvedMapInspection {
  const sourceMap = loaded.authoringMaps[mapId];
  const resolvedMap = loaded.project.maps[mapId];
  if (!sourceMap || !resolvedMap) {
    throw new TileflowConfigInspectionError(
      'INSPECT_MAP_SOURCE_MISSING',
      `Unable to inspect Tileflow map "${mapId}".`,
      `maps.${mapId}`,
    );
  }
  const sourceLineage = collectAuthoringLineage(sourceMap).reverse();
  const snapshots = sourceLineage.map((map) => parseTileflowMap(map));
  const resolved = sanitizeInspectValue(resolvedMap, cwd);
  if (!isRecord(resolved)) {
    throw new TileflowConfigInspectionError(
      'INSPECT_RESOLVED_MAP_INVALID',
      `Resolved Tileflow map "${mapId}" is not an object.`,
      `maps.${mapId}`,
    );
  }

  return {
    id: sanitizeDiagnosticSecrets(mapId),
    lineage: sourceLineage.map((map, depth) => ({
      depth,
      declaredPaths: collectLeafEntries(map, {cwd, excludeExtends: true}).map(
        (entry) => entry.path,
      ),
      id: sanitizeDiagnosticSecrets(map.id),
      version: map.version,
    })),
    provenance: createMergeProvenance(
      resolvedMap as ResolvedTileflowMap,
      sourceLineage,
      snapshots,
      cwd,
    ),
    resolved,
    themeContract: inspectThemeContract(resolvedMap as ResolvedTileflowMap, cwd),
  };
}

function inspectThemeContract(
  map: ResolvedTileflowMap,
  cwd: string,
): TileflowThemeContractInspection {
  const names = Object.keys(map.themes).sort(compareCodeUnits);
  const defaultResolved = resolveTileflowTheme(map.themes[map.defaultTheme]!);
  const comparableDefault = {
    colorScheme: defaultResolved.colorScheme,
    lighting: defaultResolved.lighting,
    tokens: defaultResolved.tokens,
    typography: defaultResolved.typography,
  };
  const themes = Object.fromEntries(
    names.map((name) => {
      const resolved = resolveTileflowTheme(map.themes[name]!);
      const comparable = {
        colorScheme: resolved.colorScheme,
        lighting: resolved.lighting,
        tokens: resolved.tokens,
        typography: resolved.typography,
      };
      return [
        name,
        {
          colorScheme: resolved.colorScheme,
          differencesFromDefault:
            name === map.defaultTheme ? [] : compareThemeValues(comparableDefault, comparable, cwd),
          id: sanitizeDiagnosticSecrets(resolved.id),
          isDefault: name === map.defaultTheme,
          lighting: sanitizeInspectableRecord(resolved.lighting, cwd),
          name,
          systemFor: (['dark', 'light'] as const).filter(
            (scheme) => map.systemThemes?.[scheme] === name,
          ),
          tokens: sanitizeInspectValue(resolved.tokens, cwd) as TileflowThemeInspection['tokens'],
          typography: sanitizeInspectableRecord(resolved.typography, cwd),
          version: resolved.version,
        } satisfies TileflowThemeInspection,
      ];
    }),
  );
  const tokenSchema = {
    color: Object.keys(defaultResolved.tokens.color).sort(compareCodeUnits),
    font: Object.keys(defaultResolved.tokens.font).sort(compareCodeUnits),
    image: Object.keys(defaultResolved.tokens.image).sort(compareCodeUnits),
    number: Object.keys(defaultResolved.tokens.number).sort(compareCodeUnits),
  };
  const audit = auditTileflowMapThemeValues(map).map((diagnostic) => {
    const value = sanitizeInspectValue(diagnostic.value, cwd);
    return {
      ...diagnostic,
      message: sanitizeDiagnosticSecrets(diagnostic.message),
      ...(diagnostic.owner === undefined
        ? {}
        : {owner: sanitizeDiagnosticSecrets(diagnostic.owner)}),
      path: sanitizeDiagnosticSecrets(diagnostic.path),
      suggestion: sanitizeDiagnosticSecrets(diagnostic.suggestion),
      ...(diagnostic.target === undefined
        ? {}
        : {target: sanitizeDiagnosticSecrets(diagnostic.target)}),
      value: typeof value === 'number' ? value : String(value),
    };
  });

  return {
    audit,
    defaultTheme: map.defaultTheme,
    ...(map.systemThemes ? {systemThemes: map.systemThemes} : {}),
    themes,
    tokenSchema,
  };
}

function compareThemeValues(
  from: unknown,
  to: unknown,
  cwd: string,
): TileflowThemeDifferenceInspection[] {
  const differences: TileflowThemeDifferenceInspection[] = [];
  const visit = (left: unknown, right: unknown, segments: string[]) => {
    if (isRecord(left) || isRecord(right)) {
      const keys = new Set([
        ...Object.keys(isRecord(left) ? left : {}),
        ...Object.keys(isRecord(right) ? right : {}),
      ]);
      for (const key of [...keys].sort(compareCodeUnits)) {
        visit(isRecord(left) ? left[key] : undefined, isRecord(right) ? right[key] : undefined, [
          ...segments,
          key,
        ]);
      }
      return;
    }
    if (equalInspectableValues(left, right)) return;
    differences.push({
      from: sanitizeInspectValue(left, cwd),
      path: formatConfigPath(segments, cwd),
      to: sanitizeInspectValue(right, cwd),
    });
  };
  visit(from, to, []);
  return differences.sort((left, right) => compareCodeUnits(left.path, right.path));
}

function sanitizeInspectableRecord(value: object, cwd: string): Record<string, unknown> {
  const sanitized = sanitizeInspectValue(value, cwd);
  return isRecord(sanitized) ? sanitized : {};
}

function collectAuthoringLineage(map: TileflowMap): TileflowMap[] {
  const lineage: TileflowMap[] = [];
  const seen = new Set<TileflowMap>();
  let current: TileflowMap | undefined = map;
  while (current && !seen.has(current) && lineage.length < 64) {
    seen.add(current);
    lineage.push(current);
    current = current.extends;
  }
  return lineage;
}

function createMergeProvenance(
  resolved: ResolvedTileflowMap,
  lineage: readonly TileflowMap[],
  snapshots: readonly ResolvedTileflowMap[],
  cwd: string,
): TileflowMapMergeProvenance[] {
  return collectLeafEntries(resolved, {cwd}).map(({path, segments}) => {
    let sourceIndex = 0;
    let declared = hasPath(lineage[0], segments);
    for (let index = 1; index < snapshots.length; index += 1) {
      const explicitlyDeclared = hasPath(lineage[index], segments);
      if (
        explicitlyDeclared ||
        !equalInspectableValues(
          getPath(snapshots[index - 1], segments),
          getPath(snapshots[index], segments),
        )
      ) {
        sourceIndex = index;
        declared = explicitlyDeclared;
      }
    }
    return {
      declared,
      inherited: sourceIndex < lineage.length - 1,
      operation:
        sourceIndex === 0 || !hasPath(snapshots[sourceIndex - 1], segments)
          ? 'defined'
          : 'overridden',
      path,
      sourceDepth: sourceIndex,
      sourceMap: sanitizeDiagnosticSecrets(lineage[sourceIndex]!.id),
    };
  });
}

function collectLeafEntries(
  value: unknown,
  options: {cwd: string; excludeExtends?: boolean},
): Array<{path: string; segments: string[]}> {
  const entries: Array<{path: string; segments: string[]}> = [];
  const visit = (candidate: unknown, segments: string[]) => {
    if (isRecord(candidate) && Object.keys(candidate).length > 0) {
      for (const key of Object.keys(candidate).sort(compareCodeUnits)) {
        if (options.excludeExtends && segments.length === 0 && key === 'extends') continue;
        visit(candidate[key], [...segments, key]);
      }
      return;
    }
    entries.push({path: formatConfigPath(segments, options.cwd), segments});
  };
  visit(value, []);
  return entries.sort((left, right) => compareCodeUnits(left.path, right.path));
}

function formatConfigPath(segments: readonly string[], cwd: string): string {
  return segments
    .map((segment, index) => {
      const safeSegment = sanitizeInspectKey(segment, cwd);
      return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(safeSegment)
        ? `${index === 0 ? '' : '.'}${safeSegment}`
        : `[${JSON.stringify(safeSegment).slice(0, 132)}]`;
    })
    .join('');
}

function getPath(value: unknown, segments: readonly string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasPath(value: unknown, segments: readonly string[]): boolean {
  let current = value;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

function equalInspectableValues(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortInspectableValue(left)) === JSON.stringify(sortInspectableValue(right));
}

function sortInspectableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortInspectableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => [key, sortInspectableValue(value[key])]),
  );
}

/** Sanitize a deterministic JSON-like authoring value for machine-facing CLI output. */
export function sanitizeTileflowInspectableValue(value: unknown, cwd: string): unknown {
  return sanitizeInspectValue(value, cwd);
}

function sanitizeInspectValue(
  value: unknown,
  cwd: string,
  seen = new WeakSet<object>(),
  path: readonly string[] = [],
): unknown {
  if (typeof value === 'string') return sanitizeInspectString(value, cwd, path);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeInspectValue(item, cwd, seen, path));
  if (!isRecord(value)) return null;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (value[key] === undefined) continue;
    const safeKey = uniqueInspectKey(result, sanitizeInspectKey(key, cwd));
    result[safeKey] = sanitizeInspectValue(value[key], cwd, seen, [...path, key]);
  }
  seen.delete(value);
  return result;
}

function sanitizeInspectKey(value: string, cwd: string): string {
  return boundInspectString(sanitizeInspectString(value, cwd, [])) || '(empty)';
}

function uniqueInspectKey(target: Record<string, unknown>, key: string): string {
  if (!Object.hasOwn(target, key)) return key;
  let suffix = 2;
  while (Object.hasOwn(target, `${key}#${suffix}`)) suffix += 1;
  return `${key}#${suffix}`;
}

function sanitizeInspectString(value: string, cwd: string, path: readonly string[]): string {
  const normalizedCwd = resolve(cwd);
  if (value === normalizedCwd || value.startsWith(`${normalizedCwd}/`)) {
    const local = relative(normalizedCwd, value).replaceAll('\\', '/');
    return sanitizeDiagnosticSecrets(local ? `./${local}` : '.');
  }
  if (value.startsWith('data:')) return 'data:[redacted]';
  if (/^https?:\/\//iu.test(value)) {
    try {
      const url = new URL(value);
      const suffix = `${url.search ? '?[redacted]' : ''}${url.hash ? '#[redacted]' : ''}`;
      return boundInspectString(
        sanitizeDiagnosticSecrets(`${url.protocol}//${url.host}${sanitizeUrlPath(url)}${suffix}`),
      );
    } catch {
      return '(resource URL)';
    }
  }
  if (win32.isAbsolute(value) || value.startsWith('file:')) {
    return '(external path)';
  }
  if (path.at(-1) === 'url') return sanitizeRelativeResourceUrl(value);
  if (isAbsolute(value)) {
    return '(external path)';
  }
  const sanitized = sanitizeDiagnosticSecrets(value.replace(/[\r\n]+/gu, ' ').trim());
  return boundInspectString(sanitized);
}

function sanitizeUrlPath(url: URL): string {
  try {
    const decoded = decodeURIComponent(url.pathname);
    if (sanitizeDiagnosticSecrets(decoded) !== decoded) return '/[redacted]';
  } catch {
    return '/[redacted]';
  }
  return sanitizeDiagnosticSecrets(url.pathname);
}

function sanitizeRelativeResourceUrl(value: string): string {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  const cutoffs = [queryIndex, hashIndex].filter((index) => index >= 0);
  const cutoff = cutoffs.length ? Math.min(...cutoffs) : value.length;
  const path = sanitizeDiagnosticSecrets(value.slice(0, cutoff));
  const hasQuery = queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex);
  return boundInspectString(
    `${path}${hasQuery ? '?[redacted]' : ''}${hashIndex >= 0 ? '#[redacted]' : ''}`,
  );
}

function boundInspectString(value: string): string {
  return value.length <= 2_048 ? value : `${value.slice(0, 2_047)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
