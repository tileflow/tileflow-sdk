import {
  TileflowIconSetError,
  tileflowIconsLockfileName,
  tileflowIconSpriteIndexSchema,
  type TileflowIconCompositionV1,
  type TileflowIconDirectory,
  type TileflowIconSource,
} from '@tileflow/core';
import {
  loadSharp,
  type TileflowSpriteIndex as SpriteIndex,
  type TileflowRenderedIcon,
} from './icon-sprite';
import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {extname, isAbsolute, relative, resolve as resolvePath, sep} from 'node:path';
import {SaxesParser} from 'saxes';
import {
  compareCodeUnits,
  hashTileflowIconPackageManifest,
  hashTileflowRenderedIconPixels,
  parseResolvedTileflowMap,
  parseTileflowIconJson,
  serializeCanonicalJson,
  sha256Hex,
  tileflowIconIdPattern,
  type TileflowIconPackageFileName,
  tileflowIconPackageLimits,
  type TileflowIconPackageManifest,
  tileflowIconPackageManifestSchema,
} from '@tileflow/core';
import type {
  TileflowBuildCatalog,
  TileflowEffectiveIconSourceIdentity,
  TileflowPreparedMapAssets,
} from '@tileflow/core/build';
import {
  type ResolvedTileflowAssetDirectory,
  resolveTileflowAssetDirectories,
  TileflowAssetDirectoryError,
} from './asset-directories';
import {
  composeTileflowIconSources,
  type TileflowComposedIconContributor,
  type TileflowComposedIconSources,
} from './icon-composition';
import type {TileflowIconCacheOptions} from './icon-cache';

export type TileflowBuildAsset = {
  contentType: string;
  fileName: string;
  source: string | Uint8Array;
};

/** Executable authoring input before local sources have been resolved into runtime URLs. */
export type TileflowSourceCatalog = TileflowBuildCatalog;

declare const preparedTileflowBuildCatalog: unique symbol;

/** A validated catalog paired with build-owned portable assets. */
export type PreparedTileflowBuildCatalog = TileflowBuildCatalog & {
  readonly [preparedTileflowBuildCatalog]: true;
};

export type PreparedTileflowCatalog = {
  assets: TileflowBuildAsset[];
  baseDirectory: string;
  cwd: string;
  mapAssets: Record<string, TileflowPreparedMapAssets>;
  /** Ordered shared dependency receipts, present only for maps that declare an Icon Set. */
  mapIconCompositions: Record<string, TileflowIconCompositionV1>;
  mapIconSources: Record<string, readonly TileflowEffectiveIconSourceIdentity[]>;
  project: PreparedTileflowBuildCatalog;
  sourceProject: TileflowSourceCatalog;
  /** Exact files whose contents select the composition, such as the icon lock. */
  watchFiles: string[];
  watchPaths: string[];
};

/**
 * Explicit, trusted resolution settings for declared shared Icon Sets.
 *
 * These are supplied by the calling command or adapter. A lock file can never widen them, and no
 * ambient process state selects a cache, an origin, or a transport.
 */
export type TileflowIconResolutionOptions = TileflowIconCacheOptions;

export type TileflowIconCompilationTarget = 'hosted' | 'local';

export type TileflowIconCompilationIssue = {
  message: string;
  path: string;
};

export type CompiledTileflowIconPackageFile = {
  contentType: 'application/json' | 'image/png';
  fileName: TileflowIconPackageFileName;
  source: Uint8Array;
};

export type CompiledTileflowIconPackage = {
  contentHash: string;
  files: CompiledTileflowIconPackageFile[];
  manifest: TileflowIconPackageManifest;
};

export type TileflowMapIconPackageBinding = {
  iconIds: readonly string[];
  label: string;
  mapName: string;
  packageHash: string;
};

export type CompileTileflowIconPackagesOptions = {
  baseDirectory?: string;
  cwd: string;
  /** Trusted shared-set resolution settings; omitted means the default verified cache. */
  icons?: TileflowIconResolutionOptions;
  target: TileflowIconCompilationTarget;
};

export type CompileTileflowIconPackagesResult = {
  bindings: TileflowMapIconPackageBinding[];
  /** Exact ordered dependency receipts, keyed by map, for maps that declare an Icon Set. */
  compositions: Record<string, TileflowIconCompositionV1>;
  packages: CompiledTileflowIconPackage[];
  sourceIdentities: Record<string, readonly TileflowEffectiveIconSourceIdentity[]>;
  /** Exact files whose contents select the composition, such as the icon lock. */
  watchFiles: string[];
  watchPaths: string[];
};

export type InspectTileflowIconCatalogsOptions = {
  baseDirectory?: string;
  cwd: string;
  icons?: TileflowIconResolutionOptions;
  mapNames?: readonly string[];
};

export type TileflowIconCatalogSourceFormat = 'jpeg' | 'png' | 'svg' | 'webp';

export type TileflowIconCatalogAtlasRectangle = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type TileflowIconCatalogRenderedDensity = {
  atlas: TileflowIconCatalogAtlasRectangle;
  height: number;
  pixelRatio: 1 | 2;
  pixelSha256: string;
  width: number;
};

/** One winning icon's origin: a repository/package original, or an exact shared revision cell. */
export type TileflowIconCatalogIconSource =
  | {
      byteLength: number;
      contributor: number;
      dimensions: {height: number; width: number} | null;
      format: TileflowIconCatalogSourceFormat;
      kind: 'file';
      path: string;
    }
  | {
      contributor: number;
      kind: 'icon-set';
      reference: string;
      version: number;
    };

export type TileflowIconCatalogIcon = {
  id: string;
  rendered: {
    oneX: TileflowIconCatalogRenderedDensity;
    twoX: TileflowIconCatalogRenderedDensity;
  };
  source: TileflowIconCatalogIconSource;
};

/** One declared contributor in authoring order, retained even when fully shadowed. */
export type TileflowIconCatalogContributor =
  | {
      iconIds: string[];
      insideWorkingTree: boolean;
      kind: 'local' | 'package';
      label: string;
    }
  | {
      iconIds: string[];
      kind: 'icon-set';
      label: string;
      reference: string;
      version: number;
    };

export type TileflowIconCatalog = {
  compiledPackage: CompiledTileflowIconPackage;
  composition: TileflowIconCompositionV1 | null;
  contributors: TileflowIconCatalogContributor[];
  icons: TileflowIconCatalogIcon[];
  insideWorkingTree: boolean;
  replacements: TileflowIconReplacement[];
};

export type TileflowIconReplacement = {
  id: string;
  replaced: string;
  winner: string;
};

export type TileflowIconCatalogMap = {
  name: string;
  icons:
    | {
        composition: TileflowIconCompositionV1 | null;
        contributors: TileflowIconCatalogContributor[];
        iconIds: string[];
        kind: 'sources';
        label: string;
        packageHash: string;
      }
    | {
        kind: 'none';
      };
};

export type TileflowIconCatalogInspection = {
  catalogs: TileflowIconCatalog[];
  maps: TileflowIconCatalogMap[];
};

export class TileflowIconCompilationError extends Error {
  readonly code = 'ICON_INVALID' as const;
  readonly issues: TileflowIconCompilationIssue[];
  readonly phase = 'icon-compilation' as const;

  constructor(issues: TileflowIconCompilationIssue[]) {
    super(
      [
        'Invalid Tileflow icon package',
        ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'TileflowIconCompilationError';
    this.issues = issues;
  }
}

type MapIconRequest = {
  mapName: string;
  sequenceKey: string;
  sources: readonly TileflowIconSource[];
};

type ComposeMapIconSourcesResult = {
  composedBySequence: Map<string, TileflowComposedIconSources>;
  mapRequests: MapIconRequest[];
};

type IconInput = {
  displayPath: string;
  fileName: string;
  format: TileflowIconCatalogSourceFormat;
  kind: 'icon' | 'pattern';
  name: string;
  path: string;
  source: Uint8Array;
};

type InspectedIconSource = {
  icons: IconInput[];
  replacements?: TileflowIconReplacement[];
};

type DecodedIconDimensions = {
  height: number;
  width: number;
};

type CompiledIcon = {
  dimensions: DecodedIconDimensions;
  input: IconInput;
  oneX: Awaited<ReturnType<typeof renderIcon>>;
  pixelSha256: {oneX: string; twoX: string};
  sourceSha256: string;
  twoX: Awaited<ReturnType<typeof renderIcon>>;
};

const iconFileExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const iconSpriteSize = 24;

export async function compileTileflowIconPackages(
  project: TileflowBuildCatalog,
  options: CompileTileflowIconPackagesOptions,
): Promise<CompileTileflowIconPackagesResult> {
  const result = await composeMapIconSources(project, options);
  const packagesByHash = new Map<string, CompiledTileflowIconPackage>();

  for (const composed of result.composedBySequence.values()) {
    if (composed.package) packagesByHash.set(composed.package.contentHash, composed.package);
  }

  const compositions: Record<string, TileflowIconCompositionV1> = {};
  const sourceIdentities: Record<string, readonly TileflowEffectiveIconSourceIdentity[]> = {};
  for (const request of result.mapRequests) {
    const composed = result.composedBySequence.get(request.sequenceKey);
    sourceIdentities[request.mapName] = composed?.sourceIdentities ?? [];
    if (composed?.composition) compositions[request.mapName] = composed.composition;
  }

  const bindings = result.mapRequests.flatMap((request): TileflowMapIconPackageBinding[] => {
    if (request.sources.length === 0) return [];
    const composed = result.composedBySequence.get(request.sequenceKey);

    if (!composed?.package) {
      throw new Error(`Missing compiled icon package for map ${request.mapName}`);
    }

    return [
      {
        iconIds: composed.package.manifest.iconNames,
        label: request.mapName,
        mapName: request.mapName,
        packageHash: composed.package.contentHash,
      },
    ];
  });

  return {
    bindings,
    compositions,
    packages: [...packagesByHash.values()].sort((left, right) =>
      compareCodeUnits(left.contentHash, right.contentHash),
    ),
    sourceIdentities,
    watchFiles: uniqueStrings(
      result.mapRequests.flatMap(
        (request) => result.composedBySequence.get(request.sequenceKey)?.watchFiles ?? [],
      ),
    ).sort(compareCodeUnits),
    watchPaths: uniqueStrings(
      result.mapRequests.flatMap(
        (request) => result.composedBySequence.get(request.sequenceKey)?.watchPaths ?? [],
      ),
    ).sort(compareCodeUnits),
  };
}

export async function inspectTileflowIconCatalogs(
  project: TileflowBuildCatalog,
  options: InspectTileflowIconCatalogsOptions,
): Promise<TileflowIconCatalogInspection> {
  const result = await composeMapIconSources(project, {
    ...options,
    target: 'local',
  });
  const maps: TileflowIconCatalogMap[] = result.mapRequests.map((request) => {
    if (request.sources.length === 0) return {name: request.mapName, icons: {kind: 'none'}};
    const composed = result.composedBySequence.get(request.sequenceKey);
    if (!composed?.package)
      throw new Error(`Missing compiled icon catalog for map ${request.mapName}`);
    return {
      name: request.mapName,
      icons: {
        composition: composed.composition,
        contributors: composed.contributors.map(describeComposedContributor),
        iconIds: [...composed.package.manifest.iconNames],
        kind: 'sources',
        label: request.mapName,
        packageHash: composed.package.contentHash,
      },
    };
  });

  const requestBySequence = new Map(
    result.mapRequests
      .filter((request) => request.sources.length > 0)
      .map((request) => [request.sequenceKey, request]),
  );
  const catalogs = await Promise.all(
    [...result.composedBySequence.entries()].map(
      async ([sequenceKey, composed]): Promise<TileflowIconCatalog> => {
        const request = requestBySequence.get(sequenceKey);
        if (!request || !composed.package)
          throw new Error(`Missing icon contributor sequence ${sequenceKey}`);
        const atlas = await readComposedAtlasIndexes(composed.package);
        return {
          composition: composed.composition,
          compiledPackage: composed.package,
          contributors: composed.contributors.map(describeComposedContributor),
          icons: composed.winners.map((winner, index): TileflowIconCatalogIcon => {
            const manifestIcon = composed.package!.manifest.renderedIcons[index];
            const oneXAtlas = atlas.oneX[winner.id];
            const twoXAtlas = atlas.twoX[winner.id];
            const contributor = composed.contributors[winner.contributor];

            if (
              !manifestIcon ||
              manifestIcon.name !== winner.id ||
              !oneXAtlas ||
              !twoXAtlas ||
              !contributor
            ) {
              throw new Error(`Missing compiled catalog metadata for icon ${winner.id}`);
            }

            return {
              id: winner.id,
              rendered: {
                oneX: {
                  atlas: atlasRectangle(oneXAtlas),
                  height: oneXAtlas.height,
                  pixelRatio: 1,
                  pixelSha256: manifestIcon.pixelSha256.oneX,
                  width: oneXAtlas.width,
                },
                twoX: {
                  atlas: atlasRectangle(twoXAtlas),
                  height: twoXAtlas.height,
                  pixelRatio: 2,
                  pixelSha256: manifestIcon.pixelSha256.twoX,
                  width: twoXAtlas.width,
                },
              },
              source:
                winner.source === null
                  ? {
                      contributor: winner.contributor,
                      kind: 'icon-set',
                      reference: contributor.kind === 'icon-set' ? contributor.reference : '',
                      version: contributor.kind === 'icon-set' ? contributor.version : 0,
                    }
                  : {
                      byteLength: winner.source.byteLength,
                      contributor: winner.contributor,
                      dimensions: {...winner.source.dimensions},
                      format: winner.source.format,
                      kind: 'file',
                      path: winner.source.path,
                    },
            };
          }),
          insideWorkingTree: composed.contributors.every(
            (contributor) => contributor.kind === 'icon-set' || contributor.insideWorkingTree,
          ),
          replacements: composed.replacements.map((replacement) =>
            describeComposedReplacement(replacement, composed.contributors),
          ),
        };
      },
    ),
  );
  catalogs.sort((left, right) =>
    compareCodeUnits(
      left.contributors.map((contributor) => contributor.label).join('\0'),
      right.contributors.map((contributor) => contributor.label).join('\0'),
    ),
  );

  return {catalogs, maps};
}

/**
 * Compose every selected map through the one shared icon path.
 *
 * Identical declared contributor sequences are composed once. A declared shared set is resolved
 * only from the exact lock beside the selected config; no catalog head is ever consulted here.
 */
async function composeMapIconSources(
  project: TileflowBuildCatalog,
  options: CompileTileflowIconPackagesOptions & {mapNames?: readonly string[]},
): Promise<ComposeMapIconSourcesResult> {
  const mapRequests = getMapIconRequests(project, options.mapNames);
  const issues: TileflowIconCompilationIssue[] = [];
  const composedBySequence = new Map<string, TileflowComposedIconSources>();

  for (const request of uniqueSequences(mapRequests)) {
    if (request.sources.length === 0) continue;
    try {
      composedBySequence.set(
        request.sequenceKey,
        await composeTileflowIconSources(request.sources, {
          ...options.icons,
          baseDirectory: options.baseDirectory ?? options.cwd,
          configPath: `maps.${request.mapName}.icons`,
          cwd: options.cwd,
          target: options.target,
        }),
      );
    } catch (error) {
      if (error instanceof TileflowIconSetError) throw error;
      if (error instanceof TileflowIconCompilationError) issues.push(...error.issues);
      else if (error instanceof TileflowAssetDirectoryError) issues.push(...error.issues);
      else
        issues.push({
          message: error instanceof Error ? error.message : 'Icon compilation failed',
          path: `maps.${request.mapName}.icons`,
        });
    }
  }
  if (issues.length > 0) throw new TileflowIconCompilationError(issues);
  return {composedBySequence, mapRequests};
}

export async function prepareTileflowCatalogIcons(
  project: TileflowBuildCatalog,
  options: {
    assetBaseUrl: string;
    baseDirectory?: string;
    cwd: string;
    icons?: TileflowIconResolutionOptions;
  },
): Promise<PreparedTileflowCatalog> {
  const compiled = await compileTileflowIconPackages(project, {
    baseDirectory: options.baseDirectory,
    cwd: options.cwd,
    ...(options.icons ? {icons: options.icons} : {}),
    target: 'local',
  });
  const packagesByHash = new Map(
    compiled.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
  );
  const assets: TileflowBuildAsset[] = [];
  const mapAssets: Record<string, TileflowPreparedMapAssets> = {};
  const mapIconCompositions: Record<string, TileflowIconCompositionV1> = {};
  const mapIconSources: Record<string, readonly TileflowEffectiveIconSourceIdentity[]> = {};

  for (const mapName of Object.keys(project.maps)) mapIconSources[mapName] = [];

  for (const binding of compiled.bindings) {
    const iconPackage = packagesByHash.get(binding.packageHash);
    if (!iconPackage) throw new Error(`Missing compiled icon package for map ${binding.mapName}`);

    const spriteUrl = joinUrl(options.assetBaseUrl, `icons/${binding.mapName}/sprite`);
    mapAssets[binding.mapName] = {icons: {ids: binding.iconIds, sprite: spriteUrl}};
    mapIconSources[binding.mapName] = compiled.sourceIdentities[binding.mapName] ?? [];
    const composition = compiled.compositions[binding.mapName];
    if (composition) mapIconCompositions[binding.mapName] = composition;

    for (const file of iconPackage.files) {
      assets.push({
        contentType:
          file.contentType === 'application/json'
            ? 'application/json; charset=utf-8'
            : file.contentType,
        fileName: `icons/${binding.mapName}/${file.fileName}`,
        source:
          file.contentType === 'application/json'
            ? new TextDecoder().decode(file.source)
            : file.source,
      });
    }
  }

  return {
    assets,
    baseDirectory: await realpath(options.baseDirectory ?? options.cwd),
    cwd: await realpath(options.cwd),
    mapAssets,
    mapIconCompositions,
    mapIconSources,
    project: project as PreparedTileflowBuildCatalog,
    sourceProject: project,
    watchFiles: compiled.watchFiles,
    watchPaths: compiled.watchPaths,
  };
}

/**
 * Report the exact filesystem inputs that can change the composed sprite.
 *
 * The lock beside the selected config is one of them; a lock edit rebuilds from its new exact
 * pins. Catalog heads are never polled, so a newly published revision changes nothing here.
 */
export async function getTileflowIconWatchPaths(
  project: TileflowBuildCatalog,
  cwd: string,
  baseDirectory = cwd,
): Promise<string[]> {
  const requests = getMapIconRequests(project);
  const paths = new Set<string>();
  let realBaseDirectory: string | undefined;
  for (const request of uniqueSequences(requests)) {
    for (const source of request.sources) {
      if (typeof source === 'object' && source.kind === 'icon-set') {
        realBaseDirectory ??= await realpath(baseDirectory);
        paths.add(resolvePath(realBaseDirectory, tileflowIconsLockfileName));
        continue;
      }
      try {
        const directory = await readTileflowIconDirectory(source, {
          baseDirectory,
          configPath: `maps.${request.mapName}.icons`,
          cwd,
          target: 'local',
        });
        if (directory.watchPath) paths.add(directory.watchPath);
      } catch {
        // A directory that cannot be read yet is reported by the build, not by watch discovery.
      }
    }
  }
  return [...paths].sort(compareCodeUnits);
}

function getMapIconRequests(
  project: TileflowBuildCatalog,
  mapNames?: readonly string[],
): MapIconRequest[] {
  const selectedNames = (
    mapNames === undefined ? Object.keys(project.maps) : [...new Set(mapNames)]
  ).sort(compareCodeUnits);
  return selectedNames.map((mapName) => {
    const mapConfig = project.maps[mapName];
    if (!mapConfig) throw new Error(`Unknown Tileflow map: ${mapName}`);
    const sources = (parseResolvedTileflowMap(mapConfig).icons ?? []) as TileflowIconSource[];
    return {mapName, sequenceKey: serializeCanonicalJson(sources), sources};
  });
}

function uniqueSequences(requests: readonly MapIconRequest[]): MapIconRequest[] {
  return [...new Map(requests.map((request) => [request.sequenceKey, request])).values()].sort(
    (left, right) => compareCodeUnits(left.sequenceKey, right.sequenceKey),
  );
}

function describeComposedContributor(
  contributor: TileflowComposedIconContributor,
): TileflowIconCatalogContributor {
  return contributor.kind === 'icon-set'
    ? {
        iconIds: [...contributor.iconIds],
        kind: 'icon-set',
        label: contributor.label,
        reference: contributor.reference,
        version: contributor.version,
      }
    : {
        iconIds: [...contributor.iconIds],
        insideWorkingTree: contributor.insideWorkingTree,
        kind: contributor.kind,
        label: contributor.label,
      };
}

/** Name a replacement by its authored file or exact shared reference, never by an invented path. */
function describeComposedReplacement(
  replacement: {id: string; replaced: number; winner: number},
  contributors: readonly TileflowComposedIconContributor[],
): TileflowIconReplacement {
  return {
    id: replacement.id,
    replaced: describeContributorExport(contributors[replacement.replaced], replacement.id),
    winner: describeContributorExport(contributors[replacement.winner], replacement.id),
  };
}

function describeContributorExport(
  contributor: TileflowComposedIconContributor | undefined,
  id: string,
): string {
  if (!contributor) return id;
  if (contributor.kind === 'icon-set') return contributor.label;
  return contributor.entries.find((entry) => entry.id === id)?.path ?? contributor.label;
}

/** Read the atlas geometry the composed package already publishes in its verified indexes. */
async function readComposedAtlasIndexes(
  iconPackage: CompiledTileflowIconPackage,
): Promise<{oneX: SpriteIndex; twoX: SpriteIndex}> {
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const read = (fileName: TileflowIconPackageFileName): SpriteIndex => {
    const file = iconPackage.files.find((candidate) => candidate.fileName === fileName);
    if (!file) throw new Error(`Missing generated ${fileName}`);
    return tileflowIconSpriteIndexSchema.parse(
      parseTileflowIconJson(
        decoder.decode(file.source),
        tileflowIconPackageLimits.maxGeneratedFileBytes,
      ),
    );
  };
  return {oneX: read('sprite.json'), twoX: read('sprite@2x.json')};
}

function describeAssetDirectory(directory: ResolvedTileflowAssetDirectory): string {
  return typeof directory.authoring === 'string'
    ? directory.authoring
    : `npm:${directory.authoring.package}/${directory.authoring.path}`;
}

function describeAssetFile(directory: ResolvedTileflowAssetDirectory, fileName: string): string {
  return `${describeAssetDirectory(directory).replace(/\/+$/u, '')}/${fileName}`;
}

async function inspectIconSource(
  directory: ResolvedTileflowAssetDirectory,
  target: TileflowIconCompilationTarget,
  issues: TileflowIconCompilationIssue[],
): Promise<InspectedIconSource | null> {
  let entries;
  const issueCount = issues.length;

  try {
    entries = await readdir(directory.realPath, {withFileTypes: true});
  } catch (error) {
    issues.push({
      message: describeFileSystemError(error, 'Icon source could not be read'),
      path: directory.configPath,
    });
    return null;
  }

  entries.sort((left, right) => compareCodeUnits(left.name, right.name));
  const candidates: Array<{
    displayPath: string;
    fileName: string;
    format: TileflowIconCatalogSourceFormat;
    kind: 'icon' | 'pattern';
    name: string;
    path: string;
    size: number;
  }> = [];
  const names = new Set<string>();

  for (const entry of entries) {
    const entryPath = resolvePath(directory.realPath, entry.name);
    const path = `${directory.configPath}/${entry.name}`;

    if (entry.isDirectory()) {
      issues.push({message: 'Nested directories are not supported', path});
      continue;
    }

    let entryStat;
    let realEntryPath = entryPath;

    try {
      if (entry.isSymbolicLink()) {
        realEntryPath = await realpath(entryPath);

        if (!isPathInside(directory.containmentRoot, realEntryPath)) {
          issues.push({message: 'Icon symlink escapes its owning directory boundary', path});
          continue;
        }
      }

      entryStat = await stat(realEntryPath);
    } catch (error) {
      issues.push({message: describeFileSystemError(error, 'Icon entry could not be read'), path});
      continue;
    }

    if (!entryStat.isFile()) {
      issues.push({message: 'Icon entries must be regular files', path});
      continue;
    }

    const extension = extname(entry.name).toLowerCase();

    if (!iconFileExtensions.has(extension)) {
      continue;
    }

    const sourceName = entry.name.slice(0, -extname(entry.name).length);
    // `.pattern` assets retain their intrinsic pixel dimensions in the
    // generated PNG sprite. Their runtime ID omits the marker, so
    // `tunnel-32.pattern.svg` is referenced as `tunnel-32`.
    const kind = sourceName.endsWith('.pattern') ? 'pattern' : 'icon';
    const name = kind === 'pattern' ? sourceName.slice(0, -'.pattern'.length) : sourceName;

    if (names.has(name)) {
      issues.push({
        message: `Duplicate icon basename "${name}"`,
        path,
      });
      continue;
    }
    names.add(name);

    if (!tileflowIconIdPattern.test(name) || name.length > 64) {
      issues.push({
        message: 'Icon filenames must produce a lower-kebab ID of at most 64 characters',
        path,
      });
    }

    if (entryStat.size > tileflowIconPackageLimits.maxSourceFileBytes) {
      issues.push({
        message: `Icon source exceeds ${tileflowIconPackageLimits.maxSourceFileBytes} bytes`,
        path,
      });
    }

    candidates.push({
      displayPath: describeAssetFile(directory, entry.name),
      fileName: entry.name,
      format: iconSourceFormat(extension),
      kind,
      name,
      path: realEntryPath,
      size: entryStat.size,
    });
  }

  candidates.sort((left, right) => compareCodeUnits(left.name, right.name));

  if (candidates.length === 0) {
    issues.push({
      message: 'No supported .svg, .png, .jpg, .jpeg, or .webp icon files were found',
      path: directory.configPath,
    });
  }

  if (issues.length > issueCount) {
    return null;
  }

  const icons: IconInput[] = [];

  for (const candidate of candidates) {
    const displayPath = candidate.displayPath;

    try {
      const source = await readFile(candidate.path);

      if (
        source.byteLength !== candidate.size ||
        source.byteLength > tileflowIconPackageLimits.maxSourceFileBytes
      ) {
        throw new Error('Icon changed while it was being validated');
      }

      if (target === 'hosted' && extname(candidate.fileName).toLowerCase() === '.svg') {
        validateHostedSvg(source, displayPath);
      }

      icons.push({
        displayPath,
        fileName: candidate.fileName,
        format: candidate.format,
        kind: candidate.kind,
        name: candidate.name,
        path: candidate.path,
        source,
      });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : 'Icon could not be read',
        path: displayPath,
      });
    }
  }

  if (issues.length > issueCount) {
    return null;
  }

  return {icons};
}

async function validateDecodedDimensions(icon: IconInput): Promise<DecodedIconDimensions> {
  const sharp = await loadSharp();
  const metadata = await sharp(icon.source, {
    density: 72,
    failOn: 'error',
    limitInputPixels: tileflowIconPackageLimits.maxDecodedPixelsPerIcon,
  }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= 0 || height <= 0) {
    throw new Error(`Unable to determine decoded dimensions for ${icon.fileName}`);
  }

  if (width * height > tileflowIconPackageLimits.maxDecodedPixelsPerIcon) {
    throw new Error(
      `${icon.fileName} exceeds ${tileflowIconPackageLimits.maxDecodedPixelsPerIcon} decoded pixels`,
    );
  }

  return {height, width};
}

async function renderIcon(
  icon: IconInput,
  dimensions: DecodedIconDimensions,
  pixelRatio: 1 | 2,
): Promise<{height: number; png: Uint8Array; rgba: Uint8Array; width: number}> {
  const sharp = await loadSharp();
  const targetWidth = (icon.kind === 'pattern' ? dimensions.width : iconSpriteSize) * pixelRatio;
  const targetHeight = (icon.kind === 'pattern' ? dimensions.height : iconSpriteSize) * pixelRatio;
  const {data, info} = await sharp(icon.source, {
    density: 72 * pixelRatio,
    failOn: 'error',
    limitInputPixels: tileflowIconPackageLimits.maxDecodedPixelsPerIcon,
  })
    .resize(targetWidth, targetHeight, {
      background: {alpha: 0, b: 0, g: 0, r: 0},
      fit: 'contain',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});

  if (info.channels !== 4 || info.width !== targetWidth || info.height !== targetHeight) {
    throw new Error(`Rendered icon ${icon.fileName} did not produce canonical RGBA pixels`);
  }

  const rgba = new Uint8Array(data);
  const png = await sharp(data, {
    raw: {channels: 4, height: info.height, width: info.width},
  })
    .png({adaptiveFiltering: false, compressionLevel: 9, palette: false})
    .toBuffer();

  return {height: info.height, png, rgba, width: info.width};
}

function validateHostedSvg(source: Uint8Array, displayPath: string): void {
  const parser = new SaxesParser({fileName: displayPath, xmlns: true});
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let styleDepth = 0;
  let styleText = '';

  parser.on('doctype', () => {
    throw new Error('Hosted SVGs cannot contain a document type or entity declarations');
  });
  parser.on('processinginstruction', (instruction) => {
    if (instruction.target.toLowerCase() === 'xml-stylesheet') {
      throw new Error('Hosted SVGs cannot load external stylesheets');
    }
  });
  parser.on('opentag', (tag) => {
    const localName = tag.local.toLowerCase();

    if (localName === 'script') {
      throw new Error('Hosted SVGs cannot contain scripts');
    }

    if (localName === 'style') {
      styleDepth += 1;
    }

    for (const attribute of Object.values(tag.attributes)) {
      const attributeName = attribute.local.toLowerCase();
      const value = attribute.value.trim();

      if (attributeName.startsWith('on')) {
        throw new Error('Hosted SVGs cannot contain script event handlers');
      }

      if (attributeName === 'href' && value.length > 0 && !value.startsWith('#')) {
        throw new Error('Hosted SVG resource references must use local fragments');
      }

      if (containsExternalCssUrl(value)) {
        throw new Error('Hosted SVG resource references must use local fragments');
      }
    }
  });
  parser.on('text', (text) => {
    if (styleDepth > 0) {
      styleText += text;
    }
  });
  parser.on('cdata', (text) => {
    if (styleDepth > 0) {
      styleText += text;
    }
  });
  parser.on('closetag', (tag) => {
    if (tag.local.toLowerCase() !== 'style') {
      return;
    }

    styleDepth -= 1;

    if (styleDepth === 0) {
      if (styleText.toLowerCase().includes('@import') || containsExternalCssUrl(styleText)) {
        throw new Error('Hosted SVGs cannot load external stylesheets or resources');
      }

      styleText = '';
    }
  });
  parser.on('error', (error) => {
    throw error;
  });

  const chunkBytes = 64 * 1024;

  for (let offset = 0; offset < source.byteLength; offset += chunkBytes) {
    parser.write(decoder.decode(source.subarray(offset, offset + chunkBytes), {stream: true}));
  }

  parser.write(decoder.decode());
  parser.close();
}

function containsExternalCssUrl(value: string): boolean {
  const lowerValue = value.toLowerCase();
  let cursor = 0;

  while (cursor < value.length) {
    const start = lowerValue.indexOf('url(', cursor);

    if (start === -1) {
      return false;
    }

    const end = value.indexOf(')', start + 4);

    if (end === -1) {
      return true;
    }

    const rawTarget = value.slice(start + 4, end).trim();
    const target = stripMatchingQuotes(rawTarget);

    if (!target.startsWith('#')) {
      return true;
    }

    cursor = end + 1;
  }

  return false;
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1).trim()
    : value;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];

      if (value !== undefined) {
        results[index] = await map(value, index);
      }
    }
  }

  await Promise.all(
    Array.from({length: Math.min(concurrency, values.length)}, async () => worker()),
  );
  return results;
}

function atlasRectangle(entry: SpriteIndex[string]): TileflowIconCatalogAtlasRectangle {
  return {height: entry.height, width: entry.width, x: entry.x, y: entry.y};
}

function iconSourceFormat(extension: string): TileflowIconCatalogSourceFormat {
  switch (extension) {
    case '.svg':
      return 'svg';
    case '.png':
      return 'png';
    case '.jpg':
    case '.jpeg':
      return 'jpeg';
    case '.webp':
      return 'webp';
    default:
      throw new Error(`Unsupported icon source format: ${extension}`);
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function describeFileSystemError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as {code?: unknown}).code ?? '');

    if (code === 'ENOENT') {
      return fallback;
    }

    if (code === 'EACCES' || code === 'EPERM') {
      return 'Icon source is not readable';
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

function joinUrl(base: string, path: string) {
  const trimmedBase = base.replace(/\/+$/g, '');
  const trimmedPath = path.replace(/^\/+/g, '');

  return trimmedBase ? `${trimmedBase}/${trimmedPath}` : trimmedPath;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export {iconFileExtensions};

async function renderIconInputs(inputs: IconInput[]): Promise<CompiledIcon[]> {
  let renderedOneXPixels = 0;
  return mapWithConcurrency(inputs, tileflowIconPackageLimits.decodeConcurrency, async (icon) => {
    const dimensions = await validateDecodedDimensions(icon);
    const oneXWidth = icon.kind === 'pattern' ? dimensions.width : iconSpriteSize;
    const oneXHeight = icon.kind === 'pattern' ? dimensions.height : iconSpriteSize;
    const maximumOneXDimension = tileflowIconPackageLimits.maxAtlasDimension / 2;
    renderedOneXPixels += oneXWidth * oneXHeight;
    if (
      oneXWidth > maximumOneXDimension ||
      oneXHeight > maximumOneXDimension ||
      renderedOneXPixels > maximumOneXDimension ** 2
    ) {
      throw new Error(
        'Rendered icon inputs exceed the paired sprite capacity before rasterization',
      );
    }
    if (
      icon.kind === 'pattern' &&
      (dimensions.width < 2 ||
        dimensions.width > 512 ||
        (dimensions.width & (dimensions.width - 1)) !== 0)
    ) {
      throw new Error(
        `${icon.fileName} pattern width must be a power of two from 2 through 512 pixels`,
      );
    }
    const oneX = await renderIcon(icon, dimensions, 1);
    const twoX = await renderIcon(icon, dimensions, 2);
    return {
      dimensions,
      input: icon,
      oneX,
      pixelSha256: {
        oneX: await hashTileflowRenderedIconPixels({
          height: oneX.height,
          pixelRatio: 1,
          rgba: oneX.rgba,
          width: oneX.width,
        }),
        twoX: await hashTileflowRenderedIconPixels({
          height: twoX.height,
          pixelRatio: 2,
          rgba: twoX.rgba,
          width: twoX.width,
        }),
      },
      sourceSha256: await sha256Hex(icon.source),
      twoX,
    };
  });
}

/** One declared icon file, including entries a later contributor eventually replaces. */
export type TileflowIconDirectoryEntry = {
  byteLength: number;
  format: TileflowIconCatalogSourceFormat;
  id: string;
  kind: 'icon' | 'pattern';
  /** Authoring-relative display path. Absolute filesystem paths never leave this module. */
  path: string;
};

/** The decoded original behind one effective local winner. */
export type TileflowIconDirectorySourceFile = TileflowIconDirectoryEntry & {
  dimensions: DecodedIconDimensions;
};

export type ReadTileflowIconDirectoryResult = {
  containmentRoot: string;
  entries: TileflowIconDirectoryEntry[];
  iconIds: string[];
  /** Authoring label: a config-relative directory or a safe `npm:<package>/<path>` descriptor. */
  label: string;
  realPath: string;
  render: (ids: readonly string[]) => Promise<
    Array<{
      icon: TileflowRenderedIcon;
      identity: TileflowEffectiveIconSourceIdentity;
      source: TileflowIconDirectorySourceFile;
      sourceBytes: number;
    }>
  >;
  watchPath?: string;
};

/** A bounded local source snapshot used by the explicit shared-composition build port. */
export async function readTileflowIconDirectory(
  source: TileflowIconDirectory,
  options: {
    baseDirectory: string;
    /** Trusted caller-owned diagnostic prefix, such as `maps.main.icons`. */
    configPath?: string;
    cwd: string;
    /** Ordinal of this directory inside the declared contributor sequence. */
    ordinal?: number;
    target: TileflowIconCompilationTarget;
  },
): Promise<ReadTileflowIconDirectoryResult> {
  const configPath = options.configPath ?? 'icons';
  const directory = (
    await resolveTileflowAssetDirectories([source], {
      baseDirectory: options.baseDirectory,
      configPath,
      cwd: options.cwd,
      kind: 'icons',
      ordinalOffset: options.ordinal ?? 0,
      target: options.target,
    })
  )[0];
  if (!directory)
    throw new TileflowIconCompilationError([{path: configPath, message: 'Missing icon directory'}]);
  const issues: TileflowIconCompilationIssue[] = [];
  const inspected = await inspectIconSource(directory, options.target, issues);
  if (!inspected || issues.length) throw new TileflowIconCompilationError(issues);
  if (inspected.icons.length > tileflowIconPackageLimits.maxIconCount)
    throw new TileflowIconCompilationError([
      {path: configPath, message: 'One icon contributor supports at most 256 exports'},
    ]);
  const entries = inspected.icons.map(
    (icon): TileflowIconDirectoryEntry => ({
      byteLength: icon.source.byteLength,
      format: icon.format,
      id: icon.name,
      kind: icon.kind,
      path: icon.displayPath,
    }),
  );
  return {
    containmentRoot: directory.containmentRoot,
    entries,
    iconIds: entries.map((entry) => entry.id),
    label: describeAssetDirectory(directory),
    realPath: directory.realPath,
    ...(directory.watch ? {watchPath: directory.realPath} : {}),
    render: async (ids) => {
      const selected = new Set(ids);
      const inputs = inspected.icons.filter((icon) => selected.has(icon.name));
      if (
        inputs.length !== ids.length ||
        inputs.reduce((sum, icon) => sum + icon.source.byteLength, 0) >
          tileflowIconPackageLimits.maxSourceBytes
      )
        throw new TileflowIconCompilationError([
          {
            path: configPath,
            message: 'Selected icon inputs exceed their source budget or have invalid IDs',
          },
        ]);
      return (await renderIconInputs(inputs)).map((rendered) => ({
        icon: {
          id: rendered.input.name,
          oneX: {
            height: rendered.oneX.height,
            width: rendered.oneX.width,
            rgba: rendered.oneX.rgba,
          },
          twoX: {
            height: rendered.twoX.height,
            width: rendered.twoX.width,
            rgba: rendered.twoX.rgba,
          },
        },
        // Canonical key order keeps the in-memory build manifest byte-identical to its artifact.
        identity: {
          format: rendered.input.format,
          id: rendered.input.name,
          kind: rendered.input.kind,
          sha256: rendered.sourceSha256,
        },
        source: {
          byteLength: rendered.input.source.byteLength,
          dimensions: {...rendered.dimensions},
          format: rendered.input.format,
          id: rendered.input.name,
          kind: rendered.input.kind,
          path: rendered.input.displayPath,
        },
        sourceBytes: rendered.input.source.byteLength,
      }));
    },
  };
}
