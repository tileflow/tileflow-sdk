import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, relative, resolve, sep} from 'node:path';
import {
  compareCodeUnits,
  getTileflowStyleFontFaces,
  type MapLibreStyle,
  serializeCanonicalJson,
  tileflowMapIdSchema,
  type TileflowStyleOptions,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import {
  createManifest,
  createStyleFromCatalog,
  createStylesFromCatalog,
  createStylesFromCatalogWithInspection,
  createTileflowMapBuildManifest,
  type TileflowBuildCatalog,
  type TileflowBuildStyles,
  tileflowMapBuildManifestFileName,
  type TileflowMapBuildManifestV1,
  type TileflowMapBuildProvenanceV1,
  type TileflowPreparedMapAssets,
  type TileflowStyleInspection,
} from '@tileflow/core/build';
import {parseTileflowRuntimeManifest, type TileflowRuntimeManifest} from '@tileflow/core/manifest';
import {
  defaultTileflowConfigPath,
  getTileflowMapNames,
  loadValidTileflowConfigWithInputs,
} from './config';
import {
  getTileflowFontWatchPaths,
  prepareTileflowStyleFonts,
  replaceTileflowStyleFontSources,
} from './fonts';
import {
  getTileflowIconWatchPaths,
  type PreparedTileflowBuildCatalog,
  type PreparedTileflowCatalog,
  prepareTileflowCatalogIcons,
  type TileflowBuildAsset,
  type TileflowSourceCatalog,
} from './icons';
import {isPathWithin} from './path-safety';
import {
  createTileflowArtifactSessionWithBuilder,
  type TileflowArtifactSession,
  type TileflowArtifactSessionOptions,
} from './session';
import {
  normalizeTileflowStyleValidationIssues,
  TileflowStyleValidationError,
  type TileflowStyleValidationIssue,
  validateTileflowStyle,
} from './style-validation';

export type {
  PreparedTileflowCatalog,
  PreparedTileflowBuildCatalog,
  TileflowBuildAsset,
  TileflowSourceCatalog,
} from './icons';

export {
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  joinTileflowPublicUrl,
  normalizeTileflowBasePath,
  resolveTileflowArtifactPublicUrls,
} from './public-paths';
export {defaultTileflowConfigPath} from './config';
export {createTileflowArtifactDiagnostics, tileflowArtifactSessionSchemaVersion} from './session';
export type {
  TileflowArtifactDiagnostic,
  TileflowArtifactSession,
  TileflowArtifactSessionOptions,
  TileflowArtifactSessionState,
} from './session';

export const tileflowArtifactPlanSchemaVersion = 1 as const;
export const tileflowArtifactInventoryFileName = '.tileflow-artifacts.json';

export type TileflowManifestOptions = {
  styleBaseUrl?: string;
};

export type TileflowBuildArtifactsOptions = {
  apiBaseUrl?: string;
  assetBaseUrl?: string;
  config?: string;
  cwd?: string;
  /** Build a memory-only compiler sidecar for local authoring tools. */
  inspection?: boolean;
  styleBaseUrl?: string;
};

export type TileflowBuildStyleInspections = Record<string, Record<string, TileflowStyleInspection>>;

/** Compatibility shape consumed by sessions and capture callers. */
export type TileflowBuildArtifacts = {
  assets: TileflowBuildAsset[];
  buildManifest: TileflowMapBuildManifestV1;
  manifest: TileflowRuntimeManifest;
  project: TileflowBuildCatalog;
  /** Optional local-only provenance. It is never serialized as a build artifact. */
  styleInspections?: TileflowBuildStyleInspections;
  styles: TileflowBuildStyles;
  watchPaths: string[];
};

export type TileflowArtifactFile = TileflowBuildAsset;

export type TileflowArtifactInputGraph = {
  /** Exact executable config modules and data files observed during evaluation. */
  files: string[];
  /** Asset directories whose children can change without changing the config module. */
  directories: string[];
};

/**
 * Complete, deterministic output of compiling one prepared source generation.
 * `sourceProject` is retained for diagnostics only; `project` is the portable runtime input.
 */
export type TileflowArtifactPlan = TileflowBuildArtifacts & {
  files: TileflowArtifactFile[];
  inputs: TileflowArtifactInputGraph;
  project: PreparedTileflowBuildCatalog;
  schemaVersion: typeof tileflowArtifactPlanSchemaVersion;
  sourceProject: TileflowSourceCatalog;
};

export type CreateTileflowArtifactPlanOptions = Pick<
  TileflowBuildArtifactsOptions,
  'apiBaseUrl' | 'assetBaseUrl' | 'inspection' | 'styleBaseUrl'
> & {
  inputFiles?: readonly string[];
};

export type WriteTileflowArtifactPlanOptions = {
  cwd?: string;
  outDir: string;
  /** Explicit escape hatch for replacing a Hosted delivery manifest with self-hosted artifacts. */
  overwriteHostedManifest?: boolean;
};

export type WriteTileflowBuildArtifactsOptions = TileflowBuildArtifactsOptions &
  WriteTileflowArtifactPlanOptions;
type TileflowArtifactInventory = {
  files: string[];
  generation: string;
  schemaVersion: 1;
};

export class TileflowHostedManifestOverwriteError extends Error {
  readonly code = 'HOSTED_MANIFEST_OVERWRITE_REFUSED' as const;

  constructor(path: string) {
    super(
      `Refusing to overwrite Hosted manifest at ${path}. Remove it, choose another output directory, or explicitly set overwriteHostedManifest: true.`,
    );
    this.name = 'TileflowHostedManifestOverwriteError';
  }
}

export function createTileflowManifest(
  project: TileflowBuildCatalog,
  options: TileflowManifestOptions = {},
): TileflowRuntimeManifest {
  return createManifest(project, options);
}

export function createTileflowStyle(
  project: TileflowBuildCatalog,
  mapName: string,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const style = createStyleFromCatalog(project, mapName, options);
  assertValidTileflowStyle(style, mapName);
  return style;
}

export function createTileflowStyles(
  project: TileflowBuildCatalog,
  options: Omit<TileflowStyleOptions, 'preparedAssets' | 'theme'> & {
    mapAssets?: Readonly<Record<string, TileflowPreparedMapAssets>>;
  } = {},
): TileflowBuildStyles {
  const {mapAssets, ...styleOptions} = options;
  const styles = createStylesFromCatalog(project, {
    ...styleOptions,
    mapAssets,
  });
  assertValidTileflowStyles(project, styles);

  return styles;
}

function createTileflowStylesWithInspection(
  project: TileflowBuildCatalog,
  options: Omit<TileflowStyleOptions, 'preparedAssets' | 'theme'> & {
    mapAssets?: Readonly<Record<string, TileflowPreparedMapAssets>>;
  } = {},
): {inspections: TileflowBuildStyleInspections; styles: TileflowBuildStyles} {
  const {mapAssets, ...styleOptions} = options;
  const inspected = createStylesFromCatalogWithInspection(project, {
    ...styleOptions,
    mapAssets,
  });
  const styles: TileflowBuildStyles = Object.fromEntries(
    Object.entries(inspected).map(([mapName, family]) => [
      mapName,
      Object.fromEntries(
        Object.entries(family).map(([themeName, result]) => [themeName, result.style]),
      ),
    ]),
  );
  const inspections: TileflowBuildStyleInspections = Object.fromEntries(
    Object.entries(inspected).map(([mapName, family]) => [
      mapName,
      Object.fromEntries(
        Object.entries(family).map(([themeName, result]) => [themeName, result.inspection]),
      ),
    ]),
  );
  assertValidTileflowStyles(project, styles);

  return {inspections, styles};
}

function assertValidTileflowStyles(
  project: TileflowBuildCatalog,
  styles: TileflowBuildStyles,
): void {
  const issues: TileflowStyleValidationIssue[] = [];

  for (const mapName of getTileflowMapNames(project).sort(compareCodeUnits)) {
    const family = styles[mapName];
    if (!family) continue;
    for (const themeName of Object.keys(family).sort(compareCodeUnits)) {
      const style = family[themeName]!;
      issues.push(...validateTileflowStyle(style, `${mapName}/${themeName}`));
    }
  }

  if (issues.length > 0) {
    throw new TileflowStyleValidationError(normalizeTileflowStyleValidationIssues(issues));
  }
}

/** Compiles only a prepared project, keeping local source resolution out of core compilation. */
export async function createTileflowArtifactPlan(
  prepared: PreparedTileflowCatalog,
  options: CreateTileflowArtifactPlanOptions = {},
): Promise<TileflowArtifactPlan> {
  const inspected = options.inspection
    ? createTileflowStylesWithInspection(prepared.project, {
        apiBaseUrl: options.apiBaseUrl,
        mapAssets: prepared.mapAssets,
      })
    : undefined;
  const compiledStyles =
    inspected?.styles ??
    createTileflowStyles(prepared.project, {
      apiBaseUrl: options.apiBaseUrl,
      mapAssets: prepared.mapAssets,
    });
  const preparedFonts = await prepareTileflowStyleFonts(prepared.project, compiledStyles, {
    assetBaseUrl: resolveAssetBaseUrl(options),
    baseDirectory: prepared.baseDirectory,
    cwd: prepared.cwd,
    target: 'local',
  });
  const styles = preparedFonts.styles;
  const assets = [...prepared.assets, ...preparedFonts.assets];
  const provenance = await createTileflowBuildProvenance(prepared.cwd);
  const buildManifest = await createTileflowMapBuildManifest(
    Object.fromEntries(
      Object.keys(prepared.project.maps)
        .sort(compareCodeUnits)
        .map((mapName) => {
          const map = prepared.project.maps[mapName]!;
          const style = styles[mapName]!;
          return [
            mapName,
            {
              assets: getMapBuildAssets(
                mapName,
                assets,
                preparedFonts.bundles[mapName]?.files ?? [],
              ),
              lineage: prepared.project.mapMetadata?.[mapName]?.lineage ?? [
                {id: map.id, mapVersion: map.version},
              ],
              map,
              sourceAssets: {
                fonts: preparedFonts.sourceIdentities[mapName] ?? [],
                icons: prepared.mapIconSources[mapName] ?? [],
              },
              styles: style,
            },
          ];
        }),
    ),
    {provenance},
  );
  const stableManifest = createFontAwareManifest(
    createManifest(prepared.project, {styleBaseUrl: options.styleBaseUrl}),
    styles,
  );
  const inputs: TileflowArtifactInputGraph = {
    directories: uniqueStrings(
      [...prepared.watchPaths, ...preparedFonts.watchPaths].map(canonicalInputPath),
    ),
    files: uniqueStrings((options.inputFiles ?? []).map(canonicalInputPath)),
  };
  const partial: TileflowBuildArtifacts = {
    assets,
    buildManifest,
    manifest: stableManifest,
    project: prepared.project,
    ...(inspected ? {styleInspections: inspected.inspections} : {}),
    styles,
    watchPaths: uniqueStrings([...inputs.files, ...inputs.directories]),
  };
  const generation = hashArtifactGeneration(getStableTileflowArtifactFiles(partial));
  const manifest = createGenerationManifest(stableManifest, generation, assets);
  const generationArtifacts = {...partial, manifest};

  return {
    ...generationArtifacts,
    files: createGenerationArtifactFiles(generationArtifacts, generation),
    inputs,
    project: prepared.project,
    schemaVersion: tileflowArtifactPlanSchemaVersion,
    sourceProject: prepared.sourceProject,
  };
}

export async function createTileflowBuildArtifacts(
  options: TileflowBuildArtifactsOptions = {},
): Promise<TileflowArtifactPlan> {
  const loaded = await loadValidTileflowConfigWithInputs(
    options.config ?? defaultTileflowConfigPath,
    {
      cwd: options.cwd,
      fresh: true,
    },
  );
  const prepared = await prepareTileflowCatalogIcons(loaded.project, {
    assetBaseUrl: resolveAssetBaseUrl(options),
    baseDirectory: dirname(loaded.configFile),
    cwd: options.cwd ?? process.cwd(),
  });

  return await createTileflowArtifactPlan(prepared, {...options, inputFiles: loaded.inputFiles});
}

export function getTileflowArtifactFiles(
  artifacts: TileflowBuildArtifacts,
): TileflowArtifactFile[] {
  if ('files' in artifacts && Array.isArray(artifacts.files)) {
    return validateArtifactFiles(artifacts.files as TileflowArtifactFile[]);
  }
  return getStableTileflowArtifactFiles(artifacts);
}

function getStableTileflowArtifactFiles(artifacts: TileflowBuildArtifacts): TileflowArtifactFile[] {
  const files: TileflowArtifactFile[] = [
    {
      contentType: 'application/json; charset=utf-8',
      fileName: tileflowMapBuildManifestFileName,
      source: `${serializeCanonicalJson(artifacts.buildManifest)}\n`,
    },
    {
      contentType: 'application/json; charset=utf-8',
      fileName: 'manifest.json',
      source: `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
    },
    ...Object.entries(artifacts.styles).flatMap(([mapName, themes]) =>
      Object.entries(themes).map(([themeName, style]) => ({
        contentType: 'application/json; charset=utf-8',
        fileName: `styles/${mapName}/${themeName}.json`,
        source: `${JSON.stringify(style, null, 2)}\n`,
      })),
    ),
    ...artifacts.assets,
  ];
  return validateArtifactFiles(files);
}

function validateArtifactFiles(files: TileflowArtifactFile[]): TileflowArtifactFile[] {
  const seen = new Set<string>();

  for (const file of files) {
    assertTileflowArtifactFileName(file.fileName);
    if (file.fileName === tileflowArtifactInventoryFileName) {
      throw new Error(`${file.fileName} is reserved for the Tileflow artifact inventory.`);
    }
    if (seen.has(file.fileName)) {
      throw new Error(`Duplicate Tileflow artifact file: ${file.fileName}`);
    }
    seen.add(file.fileName);
  }

  return [...files].sort((left, right) => compareCodeUnits(left.fileName, right.fileName));
}

function createGenerationManifest(
  manifest: TileflowRuntimeManifest,
  generation: string,
  assets: TileflowBuildAsset[],
): TileflowRuntimeManifest {
  return {
    ...manifest,
    maps: Object.fromEntries(
      Object.entries(manifest.maps).map(([mapName, map]) => [
        mapName,
        {
          ...map,
          themes: Object.fromEntries(
            Object.entries(map.themes).map(([themeName, theme]) => [
              themeName,
              {
                ...theme,
                styleUrl: insertGenerationInPublicUrl(
                  theme.styleUrl,
                  `styles/${mapName}/${themeName}.json`,
                  generation,
                ),
                ...(theme.fontFaces
                  ? {
                      fontFaces: theme.fontFaces.map((fontFace) => ({
                        ...fontFace,
                        source: retargetLocalFontAssetUrl(fontFace.source, assets, generation),
                      })),
                    }
                  : {}),
              },
            ]),
          ),
        },
      ]),
    ),
  };
}

function createGenerationArtifactFiles(
  artifacts: TileflowBuildArtifacts,
  generation: string,
): TileflowArtifactFile[] {
  const prefix = `generations/${generation}`;
  const stableFiles = getStableTileflowArtifactFiles(artifacts);
  const immutableStyles = Object.entries(artifacts.styles).flatMap(([mapName, themes]) =>
    Object.entries(themes).map(([themeName, style]) => {
      const hasLocalSprite = artifacts.assets.some((asset) =>
        asset.fileName.startsWith(`icons/${mapName}/`),
      );
      const sprite = (style as {sprite?: unknown}).sprite;
      const generationStyleWithSprite =
        hasLocalSprite && typeof sprite === 'string'
          ? {
              ...style,
              // Every theme in one logical map shares the same immutable sprite closure.
              sprite: isRelativePublicUrl(sprite)
                ? sprite
                : insertGenerationInPublicUrl(sprite, `icons/${mapName}/sprite`, generation),
            }
          : style;
      const generationStyle = replaceTileflowStyleFontSources(generationStyleWithSprite, (source) =>
        retargetLocalFontAssetUrl(source, artifacts.assets, generation),
      );
      return {
        contentType: 'application/json; charset=utf-8',
        fileName: `${prefix}/styles/${mapName}/${themeName}.json`,
        source: `${JSON.stringify(generationStyle, null, 2)}\n`,
      } satisfies TileflowArtifactFile;
    }),
  );
  const immutableAssets = artifacts.assets.map(
    (asset): TileflowArtifactFile => ({...asset, fileName: `${prefix}/${asset.fileName}`}),
  );

  return validateArtifactFiles([...stableFiles, ...immutableStyles, ...immutableAssets]);
}

function createFontAwareManifest(
  manifest: TileflowRuntimeManifest,
  styles: Readonly<Record<string, Readonly<Record<string, MapLibreStyle>>>>,
): TileflowRuntimeManifest {
  const maps = Object.fromEntries(
    Object.entries(manifest.maps).map(([mapName, map]) => [
      mapName,
      {
        ...map,
        themes: Object.fromEntries(
          Object.entries(map.themes).map(([themeName, theme]) => {
            const style = styles[mapName]?.[themeName];
            if (!style) {
              throw new Error(`Missing compiled Tileflow style for ${mapName}/${themeName}.`);
            }
            const definitions = getTileflowStyleFontFaces(style);
            return [themeName, {...theme, fontFaces: definitions}];
          }),
        ),
      },
    ]),
  );
  return parseTileflowRuntimeManifest({...manifest, maps});
}

function retargetLocalFontAssetUrl(
  source: string,
  assets: readonly TileflowBuildAsset[],
  generation: string,
): string {
  if (isRelativePublicUrl(source)) return source;
  const asset = assets.find(
    (candidate) =>
      candidate.fileName.startsWith('fonts/') &&
      (source === candidate.fileName || source.endsWith(`/${candidate.fileName}`)),
  );
  if (!asset) throw new Error(`Unable to resolve Tileflow font artifact URL: ${source}`);
  return insertGenerationInPublicUrl(source, asset.fileName, generation);
}

function getMapBuildAssets(
  mapName: string,
  assets: readonly TileflowBuildAsset[],
  fontAssets: readonly TileflowBuildAsset[],
): TileflowBuildAsset[] {
  const selected = new Map<string, TileflowBuildAsset>();
  for (const asset of assets) {
    if (asset.fileName.startsWith(`icons/${mapName}/`)) selected.set(asset.fileName, asset);
  }
  for (const asset of fontAssets) {
    selected.set(asset.fileName, asset);
  }
  return [...selected.values()].sort((left, right) =>
    compareCodeUnits(left.fileName, right.fileName),
  );
}

function hashBytes(source: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source))
    .digest('hex');
}

/** Resolve portable build provenance without making it part of any map authoring revision. */
export async function createTileflowBuildProvenance(
  cwd: string,
): Promise<TileflowMapBuildProvenanceV1> {
  const projectDirectory = resolve(cwd);
  const projectRequire = createRequire(
    resolve(projectDirectory, '__tileflow_build_provenance__.cjs'),
  );
  const toolRequire = createRequire(import.meta.url);
  const packages: Record<string, string> = {};
  packages['@tileflow/core'] = await readPackageVersion(
    '@tileflow/core',
    resolvePackageJson(projectRequire, '@tileflow/core') ??
      resolvePackageJson(toolRequire, '@tileflow/core'),
  );
  packages['@tileflow/dev'] = await readPackageVersion(
    '@tileflow/dev',
    new URL('../package.json', import.meta.url),
  );
  const mapsPackage = resolvePackageJson(projectRequire, '@tileflow/maps');
  if (mapsPackage) {
    packages['@tileflow/maps'] = await readPackageVersion('@tileflow/maps', mapsPackage);
  }
  const lockfile = await findNearestLockfile(projectDirectory);

  return {
    ...(lockfile ? {lockfile: {format: lockfile.format, sha256: hashBytes(lockfile.source)}} : {}),
    packages,
    schemaVersion: 1,
  };
}

function resolvePackageJson(require: NodeJS.Require, packageName: string): string | undefined {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
}

async function readPackageVersion(
  expectedName: string,
  path: string | URL | undefined,
): Promise<string> {
  if (!path) throw new Error(`Unable to resolve build package provenance for ${expectedName}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`Unable to read build package provenance for ${expectedName}.`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as {name?: unknown}).name !== expectedName ||
    typeof (parsed as {version?: unknown}).version !== 'string'
  ) {
    throw new Error(`Invalid build package provenance for ${expectedName}.`);
  }
  return (parsed as {version: string}).version;
}

async function findNearestLockfile(
  cwd: string,
): Promise<
  | {format: NonNullable<TileflowMapBuildProvenanceV1['lockfile']>['format']; source: Uint8Array}
  | undefined
> {
  const candidates = [
    {fileName: 'pnpm-lock.yaml', format: 'pnpm'},
    {fileName: 'package-lock.json', format: 'npm'},
    {fileName: 'yarn.lock', format: 'yarn'},
    {fileName: 'bun.lock', format: 'bun'},
    {fileName: 'bun.lockb', format: 'bun'},
  ] as const;
  let directory = cwd;
  while (true) {
    for (const candidate of candidates) {
      try {
        return {
          format: candidate.format,
          source: await readFile(resolve(directory, candidate.fileName)),
        };
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function insertGenerationInPublicUrl(url: string, logicalPath: string, generation: string): string {
  const marker = `/${logicalPath}`;
  const index = url.lastIndexOf(marker);
  if (index >= 0 && index + marker.length === url.length) {
    return `${url.slice(0, index)}/generations/${generation}${marker}`;
  }
  if (url === logicalPath) return `generations/${generation}/${logicalPath}`;
  throw new Error(`Unable to content-address Tileflow artifact URL: ${url}`);
}

export function createTileflowArtifactSession(
  options: TileflowArtifactSessionOptions = {},
): Promise<TileflowArtifactSession> {
  return createTileflowArtifactSessionWithBuilder(options, createTileflowBuildArtifacts, () =>
    getTileflowWatchPaths(options),
  );
}

export async function getTileflowWatchPaths(
  options: Pick<TileflowBuildArtifactsOptions, 'config' | 'cwd'> = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadValidTileflowConfigWithInputs(
    options.config ?? defaultTileflowConfigPath,
    {cwd, fresh: true},
  );

  const [iconPaths, fontPaths] = await Promise.all([
    getTileflowIconWatchPaths(loaded.project, cwd, dirname(loaded.configFile)),
    getTileflowFontWatchPaths(loaded.project, cwd, dirname(loaded.configFile)),
  ]);
  return uniqueStrings([...loaded.inputFiles, ...iconPaths, ...fontPaths]);
}

export function isTileflowArtifactInputPath(
  inputs: TileflowArtifactInputGraph,
  path: string,
): boolean {
  const candidate = canonicalInputPath(path);
  return (
    inputs.files.some((input) => canonicalInputPath(input) === candidate) ||
    inputs.directories.some((input) => isPathWithin(canonicalInputPath(input), candidate))
  );
}

/** Shared refresh gate for adapters that receive filesystem or framework lifecycle events. */
export async function refreshTileflowArtifactSession(
  session: TileflowArtifactSession,
  options: {inputPath?: string; reason: string},
): Promise<boolean> {
  const inputs = getArtifactInputGraph(session.getLastGoodArtifacts());
  if (options.inputPath && inputs && !isTileflowArtifactInputPath(inputs, options.inputPath)) {
    return false;
  }
  await session.refresh(options.reason);
  return true;
}

function getArtifactInputGraph(
  artifacts: TileflowBuildArtifacts | undefined,
): TileflowArtifactInputGraph | undefined {
  if (!artifacts || !('inputs' in artifacts)) return undefined;
  const inputs = (artifacts as Partial<TileflowArtifactPlan>).inputs;
  return inputs && Array.isArray(inputs.files) && Array.isArray(inputs.directories)
    ? inputs
    : undefined;
}

export async function writeTileflowBuildArtifacts(
  options: WriteTileflowBuildArtifactsOptions,
): Promise<TileflowArtifactPlan> {
  const artifacts = await createTileflowBuildArtifacts(options);
  await writeTileflowArtifactPlan(artifacts, options);
  return artifacts;
}

/**
 * Replaces one managed artifact generation and records its exact file inventory. Unmanaged files
 * are never scanned or removed. A caught filesystem failure restores every previous managed file.
 */
export async function writeTileflowArtifactPlan(
  artifacts: TileflowArtifactPlan,
  options: WriteTileflowArtifactPlanOptions,
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const output = await prepareTileflowOutputDirectory(cwd, options.outDir);
  const files = getTileflowArtifactFiles(artifacts);

  await assertTileflowSelfHostedManifestTarget(resolve(output.outDir, 'manifest.json'), options);
  await commitTileflowArtifactFiles(output, files);
}

/** Prevents a framework build from silently replacing the frontend's Hosted delivery contract. */
export async function assertTileflowSelfHostedManifestTarget(
  manifestPath: string,
  options: {overwriteHostedManifest?: boolean} = {},
): Promise<void> {
  if (options.overwriteHostedManifest) return;
  let source: string;
  try {
    source = await readFile(resolve(manifestPath), 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }

  try {
    const manifest = parseTileflowRuntimeManifest(JSON.parse(source));
    if (isHostedRuntimeManifest(manifest)) {
      throw new TileflowHostedManifestOverwriteError(resolve(manifestPath));
    }
  } catch (error) {
    if (error instanceof TileflowHostedManifestOverwriteError) throw error;
    // An unrelated or malformed file is not treated as Hosted state. The managed writer will
    // preserve it in its rollback backup before replacement.
  }
}

function isHostedRuntimeManifest(manifest: TileflowRuntimeManifest): boolean {
  return Boolean(
    manifest.apiUrl ||
    Object.values(manifest.maps).some(
      (map) =>
        map.apiUrl ||
        map.environment ||
        map.mapId ||
        map.usageMode ||
        map.worldGeneration ||
        Object.values(map.themes).some((theme) => theme.styleId),
    ),
  );
}

function assertValidTileflowStyle(style: MapLibreStyle, mapName: string): void {
  const issues = validateTileflowStyle(style, mapName);
  if (issues.length > 0) {
    throw new TileflowStyleValidationError(normalizeTileflowStyleValidationIssues(issues));
  }
}

async function commitTileflowArtifactFiles(
  output: SafeTileflowOutputDirectory,
  files: TileflowArtifactFile[],
): Promise<void> {
  await assertTileflowOutputDirectoryIsSafe(output);
  const {outDir} = output;
  const previous = await readTileflowArtifactInventory(outDir);
  const desiredNames = files.map((file) => file.fileName);
  const generation = getArtifactGeneration(files);
  const retainedGenerations = previous
    ? generation === previous.generation
      ? getManagedGenerations(previous.files)
      : [previous.generation]
    : [];
  const retainedPrefixes = retainedGenerations.map((item) => `generations/${item}/`);
  const retainedNames = previous
    ? previous.files.filter((name) => retainedPrefixes.some((prefix) => name.startsWith(prefix)))
    : [];
  const inventoryNames = uniqueStrings([...desiredNames, ...retainedNames]);
  const inventory: TileflowArtifactInventory = {
    files: inventoryNames,
    generation,
    schemaVersion: 1,
  };
  const inventoryFile: TileflowArtifactFile = {
    contentType: 'application/json; charset=utf-8',
    fileName: tileflowArtifactInventoryFileName,
    source: `${JSON.stringify(inventory, null, 2)}\n`,
  };
  const stagedFiles = [...files, inventoryFile];
  const staleNames = (previous?.files ?? []).filter((name) => !inventoryNames.includes(name));
  const affectedNames = uniqueStrings([
    ...desiredNames,
    ...staleNames,
    tileflowArtifactInventoryFileName,
  ]);
  const stageDir = await mkdtemp(resolve(outDir, '.tileflow-stage-'));
  const newDir = resolve(stageDir, 'new');
  const backupDir = resolve(stageDir, 'backup');
  const backedUp = new Set<string>();
  const installed = new Set<string>();

  try {
    for (const file of stagedFiles) {
      const stagePath = managedPath(newDir, file.fileName);
      await mkdir(dirname(stagePath), {recursive: true});
      await writeFileDurably(stagePath, file.source);
    }

    for (const name of affectedNames) {
      await assertManagedTargetIsSafe(outDir, name);
      const targetPath = managedPath(outDir, name);
      if (!(await isFile(targetPath))) continue;
      const backupPath = managedPath(backupDir, name);
      await mkdir(dirname(backupPath), {recursive: true});
      await copyFile(targetPath, backupPath);
      backedUp.add(name);
    }

    const commitOrder = stagedFiles
      .map((file) => file.fileName)
      .sort((left, right) => {
        const leftRank = commitRank(left);
        const rightRank = commitRank(right);
        return leftRank - rightRank || compareCodeUnits(left, right);
      });

    for (const name of commitOrder.filter(
      (candidate) => candidate !== tileflowArtifactInventoryFileName,
    )) {
      const sourcePath = managedPath(newDir, name);
      const targetPath = managedPath(outDir, name);
      await mkdir(dirname(targetPath), {recursive: true});
      await rename(sourcePath, targetPath);
      installed.add(name);
    }

    for (const name of staleNames) {
      await removeManagedFile(managedPath(outDir, name));
    }

    const stagedInventoryPath = managedPath(newDir, tileflowArtifactInventoryFileName);
    const inventoryPath = managedPath(outDir, tileflowArtifactInventoryFileName);
    await rename(stagedInventoryPath, inventoryPath);
    installed.add(tileflowArtifactInventoryFileName);
  } catch (error) {
    await rollbackManagedFiles(outDir, backupDir, affectedNames, backedUp, installed);
    throw error;
  } finally {
    await rm(stageDir, {force: true, recursive: true});
  }
}

function getArtifactGeneration(files: TileflowArtifactFile[]): string {
  const generations = getManagedGenerations(files.map((file) => file.fileName));
  if (generations.length !== 1) {
    throw new Error('A Tileflow artifact plan must contain exactly one content generation.');
  }
  return generations[0]!;
}

function getManagedGenerations(fileNames: string[]): string[] {
  return uniqueStrings(
    fileNames.flatMap((fileName) => {
      const match = /^generations\/([a-f0-9]{64})\//.exec(fileName);
      return match?.[1] ? [match[1]] : [];
    }),
  );
}

function commitRank(fileName: string): number {
  if (fileName === tileflowArtifactInventoryFileName) return 2;
  if (fileName === 'manifest.json') return 1;
  return 0;
}

async function rollbackManagedFiles(
  outDir: string,
  backupDir: string,
  affectedNames: string[],
  backedUp: Set<string>,
  installed: Set<string>,
): Promise<void> {
  const rollbackErrors: unknown[] = [];

  for (const name of [...affectedNames].reverse()) {
    try {
      const targetPath = managedPath(outDir, name);
      if (installed.has(name) && !backedUp.has(name)) {
        await removeManagedFile(targetPath);
      }
      if (backedUp.has(name)) {
        await mkdir(dirname(targetPath), {recursive: true});
        await copyFile(managedPath(backupDir, name), targetPath);
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }

  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, 'Unable to restore the previous Tileflow generation.');
  }
}

async function readTileflowArtifactInventory(
  outDir: string,
): Promise<TileflowArtifactInventory | undefined> {
  const inventoryPath = managedPath(outDir, tileflowArtifactInventoryFileName);
  let source: string;

  try {
    source = await readFile(inventoryPath, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(source);
  } catch {
    throw new Error(`Invalid Tileflow artifact inventory: ${inventoryPath}`);
  }

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    (candidate as {schemaVersion?: unknown}).schemaVersion !== 1 ||
    typeof (candidate as {generation?: unknown}).generation !== 'string' ||
    !/^[a-f0-9]{64}$/.test((candidate as {generation: string}).generation) ||
    !Array.isArray((candidate as {files?: unknown}).files) ||
    (candidate as {files: unknown[]}).files.length > 10_000
  ) {
    throw new Error(`Invalid Tileflow artifact inventory: ${inventoryPath}`);
  }

  const files = (candidate as {files: unknown[]}).files;
  if (!files.every((name): name is string => typeof name === 'string')) {
    throw new Error(`Invalid Tileflow artifact inventory: ${inventoryPath}`);
  }
  try {
    for (const name of files) assertTileflowArtifactFileName(name);
  } catch {
    throw new Error(`Invalid Tileflow artifact inventory: ${inventoryPath}`);
  }
  if (new Set(files).size !== files.length || files.includes(tileflowArtifactInventoryFileName)) {
    throw new Error(`Invalid Tileflow artifact inventory: ${inventoryPath}`);
  }

  return {
    files: [...files],
    generation: (candidate as {generation: string}).generation,
    schemaVersion: 1,
  };
}

async function assertManagedTargetIsSafe(outDir: string, fileName: string): Promise<void> {
  assertSafeManagedFileName(fileName);
  const rootStats = await lstat(outDir);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`Tileflow refuses to write through a symbolic link: ${outDir}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Tileflow artifact output is not a directory: ${outDir}`);
  }
  const segments = fileName.split('/');
  let current = outDir;

  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]!);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Tileflow refuses to write through a symbolic link: ${fileName}`);
      }
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error(`Tileflow artifact parent is not a directory: ${fileName}`);
      }
      if (index === segments.length - 1 && !stats.isFile()) {
        throw new Error(`Tileflow artifact target is not a file: ${fileName}`);
      }
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return;
      throw error;
    }
  }
}

type SafeTileflowOutputDirectory = {outDir: string; rootDir: string};

async function prepareTileflowOutputDirectory(
  cwd: string,
  requestedOutDir: string,
): Promise<SafeTileflowOutputDirectory> {
  const logicalRoot = resolve(cwd);
  const logicalOutDir = resolve(logicalRoot, requestedOutDir);
  if (!isPathWithin(logicalRoot, logicalOutDir)) {
    throw new Error(`Tileflow artifact output escapes its working directory: ${logicalOutDir}`);
  }

  const rootStats = await lstat(logicalRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`Tileflow artifact working directory is not a directory: ${logicalRoot}`);
  }
  const rootDir = await realpath(logicalRoot);
  const relativeOutDir = relative(logicalRoot, logicalOutDir);
  const segments = relativeOutDir ? relativeOutDir.split(sep) : [];
  let current = rootDir;

  for (const segment of segments) {
    current = resolve(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      await mkdir(current);
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Tileflow refuses to write through a symbolic link: ${current}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Tileflow artifact output ancestor is not a directory: ${current}`);
    }
  }

  const outDir = await realpath(current);
  const output = {outDir, rootDir};
  await assertTileflowOutputDirectoryIsSafe(output);
  return output;
}

async function assertTileflowOutputDirectoryIsSafe(
  output: SafeTileflowOutputDirectory,
): Promise<void> {
  if (!isPathWithin(output.rootDir, output.outDir)) {
    throw new Error(`Tileflow artifact output escapes its working directory: ${output.outDir}`);
  }
  const stats = await lstat(output.outDir);
  if (stats.isSymbolicLink()) {
    throw new Error(`Tileflow refuses to write through a symbolic link: ${output.outDir}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Tileflow artifact output is not a directory: ${output.outDir}`);
  }
  const canonicalOutDir = await realpath(output.outDir);
  if (canonicalOutDir !== output.outDir || !isPathWithin(output.rootDir, canonicalOutDir)) {
    throw new Error(`Tileflow artifact output escapes its working directory: ${output.outDir}`);
  }
}

function assertSafeManagedFileName(fileName: string): void {
  if (
    !fileName ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    fileName.startsWith('/') ||
    fileName.endsWith('/') ||
    fileName.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe Tileflow artifact file name: ${fileName}`);
  }
}

function assertTileflowArtifactFileName(fileName: string): void {
  assertSafeManagedFileName(fileName);
  const logicalName = fileName.replace(/^generations\/[a-f0-9]{64}\//, '');
  const styleMatch = /^styles\/([^/]+)\/([^/]+)\.json$/u.exec(logicalName);
  const iconMatch = /^icons\/([^/]+)\/sprite(?:@2x)?\.(?:json|png)$/u.exec(logicalName);
  if (
    fileName === 'manifest.json' ||
    fileName === tileflowMapBuildManifestFileName ||
    (styleMatch &&
      tileflowMapIdSchema.safeParse(styleMatch[1]).success &&
      tileflowThemeNameSchema.safeParse(styleMatch[2]).success) ||
    (iconMatch && tileflowMapIdSchema.safeParse(iconMatch[1]).success) ||
    /^fonts\/[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{64}\.(?:otf|ttf|woff2)$/.test(logicalName) ||
    /^fonts\/licenses\/license-[a-f0-9]{64}\.txt$/.test(logicalName)
  ) {
    return;
  }
  throw new Error(`Unexpected Tileflow managed artifact file name: ${fileName}`);
}

function managedPath(root: string, fileName: string): string {
  assertSafeManagedFileName(fileName);
  const path = resolve(root, ...fileName.split('/'));
  if (!isPathWithin(root, path)) {
    throw new Error(`Unsafe Tileflow artifact file name: ${fileName}`);
  }
  return path;
}

async function writeFileDurably(path: string, source: string | Uint8Array): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function removeManagedFile(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error(`Refusing to remove non-file artifact target: ${path}`);
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

function hashArtifactGeneration(files: TileflowArtifactFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    const source =
      typeof file.source === 'string' ? Buffer.from(file.source, 'utf8') : Buffer.from(file.source);
    hash.update(`${file.fileName}\0${file.contentType}\0${source.byteLength}\0`, 'utf8');
    hash.update(source);
  }
  return hash.digest('hex');
}

function resolveAssetBaseUrl(options: TileflowBuildArtifactsOptions): string {
  if (options.assetBaseUrl !== undefined) return options.assetBaseUrl;
  if (options.styleBaseUrl && !isRelativePublicUrl(options.styleBaseUrl)) {
    return options.styleBaseUrl;
  }
  // Theme styles live at styles/<map>/<theme>.json. Their shared sprite and font closure lives
  // at the artifact root, two owner-directory levels above the style document.
  return '../..';
}

function isRelativePublicUrl(value: string): boolean {
  return !(
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    value.startsWith('data:')
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function canonicalInputPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    try {
      return resolve(realpathSync.native(dirname(resolved)), resolved.split(/[\\/]/).at(-1)!);
    } catch {
      return resolved;
    }
  }
}
