import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {SaxesParser} from 'saxes';
import {
  compareCodeUnits,
  hashTileflowIconPackageManifest,
  hashTileflowRenderedIconPixels,
  parseTileflowMap,
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
  mapIconSources: Record<string, readonly TileflowEffectiveIconSourceIdentity[]>;
  project: PreparedTileflowBuildCatalog;
  sourceProject: TileflowSourceCatalog;
  watchPaths: string[];
};

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

export type CompileTileflowIconPackagesResult = {
  bindings: TileflowMapIconPackageBinding[];
  packages: CompiledTileflowIconPackage[];
  sourceIdentities: Record<string, readonly TileflowEffectiveIconSourceIdentity[]>;
  watchPaths: string[];
};

export type InspectTileflowIconCatalogsOptions = {
  baseDirectory?: string;
  cwd: string;
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

export type TileflowIconCatalogIcon = {
  id: string;
  rendered: {
    oneX: TileflowIconCatalogRenderedDensity;
    twoX: TileflowIconCatalogRenderedDensity;
  };
  source: {
    byteLength: number;
    dimensions: {height: number; width: number} | null;
    format: TileflowIconCatalogSourceFormat;
    path: string;
  };
};

export type TileflowIconCatalog = {
  compiledPackage: CompiledTileflowIconPackage;
  directories: string[];
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
        directories: string[];
        iconIds: string[];
        kind: 'directories';
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
  directories: ResolvedTileflowAssetDirectory[];
  mapName: string;
  sequenceKey: string;
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

type CompiledIconSource = {
  icons: CompiledIcon[];
  layoutOneX: ReturnType<typeof createSpriteLayout>;
  layoutTwoX: ReturnType<typeof createSpriteLayout>;
  package: CompiledTileflowIconPackage;
  sourceReplacements: TileflowIconReplacement[];
};

type CompileIconSourcesResult = {
  compiledBySequence: Map<string, CompiledIconSource>;
  mapRequests: MapIconRequest[];
};

type SpriteIndex = Record<
  string,
  {
    height: number;
    pixelRatio: 1 | 2;
    width: number;
    x: number;
    y: number;
  }
>;

const iconFileExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const iconSpriteSize = 24;

export async function compileTileflowIconPackages(
  project: TileflowBuildCatalog,
  options: {
    baseDirectory?: string;
    cwd: string;
    target: TileflowIconCompilationTarget;
  },
): Promise<CompileTileflowIconPackagesResult> {
  const result = await compileIconSources(project, options);
  const packagesByHash = new Map<string, CompiledTileflowIconPackage>();

  for (const compiled of result.compiledBySequence.values()) {
    packagesByHash.set(compiled.package.contentHash, compiled.package);
  }

  const sourceIdentities: Record<string, readonly TileflowEffectiveIconSourceIdentity[]> = {};
  for (const request of result.mapRequests) {
    const compiled = result.compiledBySequence.get(request.sequenceKey);
    sourceIdentities[request.mapName] =
      compiled?.icons.map((icon) => ({
        format: icon.input.format,
        id: icon.input.name,
        kind: icon.input.kind,
        sha256: icon.sourceSha256,
      })) ?? [];
  }

  const bindings = result.mapRequests.flatMap((request): TileflowMapIconPackageBinding[] => {
    if (request.directories.length === 0) return [];
    const compiled = result.compiledBySequence.get(request.sequenceKey);

    if (!compiled) {
      throw new Error(`Missing compiled icon package for map ${request.mapName}`);
    }

    return [
      {
        iconIds: compiled.package.manifest.iconNames,
        label: request.mapName,
        mapName: request.mapName,
        packageHash: compiled.package.contentHash,
      },
    ];
  });

  return {
    bindings,
    packages: [...packagesByHash.values()].sort((left, right) =>
      compareCodeUnits(left.contentHash, right.contentHash),
    ),
    sourceIdentities,
    watchPaths: uniqueStrings(
      result.mapRequests.flatMap((request) =>
        request.directories
          .filter((directory) => directory.watch)
          .map((directory) => directory.realPath),
      ),
    ).sort(compareCodeUnits),
  };
}

export async function inspectTileflowIconCatalogs(
  project: TileflowBuildCatalog,
  options: InspectTileflowIconCatalogsOptions,
): Promise<TileflowIconCatalogInspection> {
  const result = await compileIconSources(project, {
    baseDirectory: options.baseDirectory,
    cwd: options.cwd,
    mapNames: options.mapNames,
    target: 'local',
  });
  const maps: TileflowIconCatalogMap[] = result.mapRequests.map((request) => {
    if (request.directories.length === 0) return {name: request.mapName, icons: {kind: 'none'}};
    const compiled = result.compiledBySequence.get(request.sequenceKey);
    if (!compiled) throw new Error(`Missing compiled icon catalog for map ${request.mapName}`);
    return {
      name: request.mapName,
      icons: {
        directories: request.directories.map(describeAssetDirectory),
        iconIds: [...compiled.package.manifest.iconNames],
        kind: 'directories',
        label: request.mapName,
        packageHash: compiled.package.contentHash,
      },
    };
  });

  const requestBySequence = new Map(
    result.mapRequests
      .filter((request) => request.directories.length > 0)
      .map((request) => [request.sequenceKey, request]),
  );
  const realCwd = await realpath(options.cwd);
  const catalogs = [...result.compiledBySequence.entries()]
    .map(([sequenceKey, compiled]): TileflowIconCatalog => {
      const request = requestBySequence.get(sequenceKey);
      if (!request) throw new Error(`Missing icon directory sequence ${sequenceKey}`);
      return {
        compiledPackage: compiled.package,
        directories: request.directories.map(describeAssetDirectory),
        icons: compiled.icons.map((icon, index): TileflowIconCatalogIcon => {
          const manifestIcon = compiled.package.manifest.renderedIcons[index];
          const oneXAtlas = compiled.layoutOneX.index[icon.input.name];
          const twoXAtlas = compiled.layoutTwoX.index[icon.input.name];

          if (!manifestIcon || manifestIcon.name !== icon.input.name || !oneXAtlas || !twoXAtlas) {
            throw new Error(`Missing compiled catalog metadata for icon ${icon.input.name}`);
          }

          return {
            id: icon.input.name,
            rendered: {
              oneX: {
                atlas: atlasRectangle(oneXAtlas),
                height: icon.oneX.height,
                pixelRatio: 1,
                pixelSha256: manifestIcon.pixelSha256.oneX,
                width: icon.oneX.width,
              },
              twoX: {
                atlas: atlasRectangle(twoXAtlas),
                height: icon.twoX.height,
                pixelRatio: 2,
                pixelSha256: manifestIcon.pixelSha256.twoX,
                width: icon.twoX.width,
              },
            },
            source: {
              byteLength: icon.input.source.byteLength,
              dimensions: {...icon.dimensions},
              format: icon.input.format,
              path: icon.input.displayPath,
            },
          };
        }),
        insideWorkingTree: request.directories.every((directory) =>
          isPathInside(realCwd, directory.realPath),
        ),
        replacements: [...compiled.sourceReplacements],
      };
    })
    .sort((left, right) =>
      compareCodeUnits(left.directories.join('\0'), right.directories.join('\0')),
    );

  return {catalogs, maps};
}

async function compileIconSources(
  project: TileflowBuildCatalog,
  options: {
    baseDirectory?: string;
    cwd: string;
    mapNames?: readonly string[];
    target: TileflowIconCompilationTarget;
  },
): Promise<CompileIconSourcesResult> {
  const mapRequests = await getMapIconRequests(
    project,
    options.cwd,
    options.baseDirectory ?? options.cwd,
    options.target,
    options.mapNames,
  );
  const issues: TileflowIconCompilationIssue[] = [];
  const inspectedBySource = new Map<string, InspectedIconSource>();
  for (const directory of uniqueDirectories(mapRequests)) {
    const inspected = await inspectIconSource(directory, options.target, issues);
    if (inspected) inspectedBySource.set(directory.realPath, inspected);
  }
  if (issues.length > 0) throw new TileflowIconCompilationError(issues);

  const compiledBySequence = new Map<string, CompiledIconSource>();
  for (const request of uniqueSequences(mapRequests)) {
    if (request.directories.length === 0) continue;
    try {
      const composed = composeIconDirectories(request, inspectedBySource);
      compiledBySequence.set(request.sequenceKey, await compileInspectedIconSource(composed));
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : 'Icon compilation failed',
        path: `maps.${request.mapName}.icons`,
      });
    }
  }
  if (issues.length > 0) throw new TileflowIconCompilationError(issues);
  return {compiledBySequence, mapRequests};
}

export async function prepareTileflowCatalogIcons(
  project: TileflowBuildCatalog,
  options: {
    assetBaseUrl: string;
    baseDirectory?: string;
    cwd: string;
  },
): Promise<PreparedTileflowCatalog> {
  const compiled = await compileTileflowIconPackages(project, {
    baseDirectory: options.baseDirectory,
    cwd: options.cwd,
    target: 'local',
  });
  const packagesByHash = new Map(
    compiled.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
  );
  const assets: TileflowBuildAsset[] = [];
  const mapAssets: Record<string, TileflowPreparedMapAssets> = {};
  const mapIconSources: Record<string, readonly TileflowEffectiveIconSourceIdentity[]> = {};

  for (const mapName of Object.keys(project.maps)) mapIconSources[mapName] = [];

  for (const binding of compiled.bindings) {
    const iconPackage = packagesByHash.get(binding.packageHash);
    if (!iconPackage) throw new Error(`Missing compiled icon package for map ${binding.mapName}`);

    const spriteUrl = joinUrl(options.assetBaseUrl, `icons/${binding.mapName}/sprite`);
    mapAssets[binding.mapName] = {icons: {ids: binding.iconIds, sprite: spriteUrl}};
    mapIconSources[binding.mapName] = compiled.sourceIdentities[binding.mapName] ?? [];

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
    mapIconSources,
    project: project as PreparedTileflowBuildCatalog,
    sourceProject: project,
    watchPaths: compiled.watchPaths,
  };
}

export async function getTileflowIconWatchPaths(
  project: TileflowBuildCatalog,
  cwd: string,
  baseDirectory = cwd,
): Promise<string[]> {
  const requests = await getMapIconRequests(project, cwd, baseDirectory, 'local');
  return uniqueStrings(
    requests.flatMap((request) =>
      request.directories
        .filter((directory) => directory.watch)
        .map((directory) => directory.realPath),
    ),
  ).sort(compareCodeUnits);
}

async function getMapIconRequests(
  project: TileflowBuildCatalog,
  cwd: string,
  baseDirectory: string,
  target: TileflowIconCompilationTarget,
  mapNames?: readonly string[],
): Promise<MapIconRequest[]> {
  const selectedNames = (
    mapNames === undefined ? Object.keys(project.maps) : [...new Set(mapNames)]
  ).sort(compareCodeUnits);
  const requests: MapIconRequest[] = [];
  for (const mapName of selectedNames) {
    const mapConfig = project.maps[mapName];
    if (!mapConfig) throw new Error(`Unknown Tileflow map: ${mapName}`);
    const resolvedMap = parseTileflowMap(mapConfig);
    try {
      const directories = await resolveTileflowAssetDirectories(resolvedMap.icons ?? [], {
        baseDirectory,
        configPath: `maps.${mapName}.icons`,
        cwd,
        kind: 'icons',
        target,
      });
      requests.push({
        directories,
        mapName,
        sequenceKey: directories.map((directory) => directory.realPath).join('\0'),
      });
    } catch (error) {
      if (error instanceof TileflowAssetDirectoryError) {
        throw new TileflowIconCompilationError([...error.issues]);
      }
      throw error;
    }
  }
  return requests;
}

function uniqueDirectories(requests: readonly MapIconRequest[]): ResolvedTileflowAssetDirectory[] {
  return [
    ...new Map(
      requests.flatMap((request) =>
        request.directories.map((directory) => [directory.realPath, directory] as const),
      ),
    ).values(),
  ].sort((left, right) => compareCodeUnits(left.realPath, right.realPath));
}

function uniqueSequences(requests: readonly MapIconRequest[]): MapIconRequest[] {
  return [...new Map(requests.map((request) => [request.sequenceKey, request])).values()].sort(
    (left, right) => compareCodeUnits(left.sequenceKey, right.sequenceKey),
  );
}

function composeIconDirectories(
  request: MapIconRequest,
  inspectedBySource: ReadonlyMap<string, InspectedIconSource>,
): InspectedIconSource {
  const iconsById = new Map<string, IconInput>();
  const idsByCaseFold = new Map<string, string>();
  const replacements: TileflowIconReplacement[] = [];
  for (const directory of request.directories) {
    const inspected = inspectedBySource.get(directory.realPath);
    if (!inspected)
      throw new Error(`Missing inspected icon directory ${describeAssetDirectory(directory)}`);
    for (const icon of inspected.icons) {
      const folded = icon.name.toLocaleLowerCase('en-US');
      const existing = idsByCaseFold.get(folded);
      if (existing !== undefined && existing !== icon.name) {
        throw new Error(`Icon ID "${icon.name}" collides case-insensitively with "${existing}".`);
      }
      idsByCaseFold.set(folded, icon.name);
      // Directories are applied left-to-right. A later canonical filename replaces an earlier one.
      const replaced = iconsById.get(icon.name);
      if (replaced) {
        replacements.push({
          id: icon.name,
          replaced: replaced.displayPath,
          winner: icon.displayPath,
        });
      }
      iconsById.set(icon.name, icon);
    }
  }
  const icons = [...iconsById.values()].sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  );
  const aggregateBytes = icons.reduce((total, icon) => total + icon.source.byteLength, 0);
  if (icons.length > tileflowIconPackageLimits.maxIconCount) {
    throw new Error(
      `Composed icon set contains more than ${tileflowIconPackageLimits.maxIconCount} icons`,
    );
  }
  if (aggregateBytes > tileflowIconPackageLimits.maxSourceBytes) {
    throw new Error(
      `Composed icon set exceeds ${tileflowIconPackageLimits.maxSourceBytes} aggregate bytes`,
    );
  }
  return {icons, replacements};
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
    const entryPath = resolve(directory.realPath, entry.name);
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

async function compileInspectedIconSource(
  inspected: InspectedIconSource,
): Promise<CompiledIconSource> {
  const rendered = await mapWithConcurrency(
    inspected.icons,
    tileflowIconPackageLimits.decodeConcurrency,
    async (icon) => {
      const dimensions = await validateDecodedDimensions(icon);
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
    },
  );
  const layoutOneX = createSpriteLayout(
    rendered.map(({input, oneX}) => ({...oneX, name: input.name})),
    1,
  );
  const layoutTwoX = createSpriteLayout(
    rendered.map(({input, twoX}) => ({...twoX, name: input.name})),
    2,
  );
  const [oneXImage, twoXImage] = await Promise.all([
    createSpriteImage(
      rendered.map(({input, oneX}) => ({...oneX, name: input.name})),
      layoutOneX,
    ),
    createSpriteImage(
      rendered.map(({input, twoX}) => ({...twoX, name: input.name})),
      layoutTwoX,
    ),
  ]);
  const oneXJson = new TextEncoder().encode(`${serializeCanonicalJson(layoutOneX.index)}\n`);
  const twoXJson = new TextEncoder().encode(`${serializeCanonicalJson(layoutTwoX.index)}\n`);
  const files: CompiledTileflowIconPackageFile[] = [
    {contentType: 'application/json', fileName: 'sprite.json', source: oneXJson},
    {contentType: 'image/png', fileName: 'sprite.png', source: oneXImage},
    {contentType: 'application/json', fileName: 'sprite@2x.json', source: twoXJson},
    {contentType: 'image/png', fileName: 'sprite@2x.png', source: twoXImage},
  ];
  assertGeneratedFileLimits(files);

  const fileDigests = await Promise.all(files.map((file) => sha256Hex(file.source)));
  const manifest = tileflowIconPackageManifestSchema.parse({
    files: files.map((file, index) => ({
      byteLength: file.source.byteLength,
      contentType: file.contentType,
      name: file.fileName,
      sha256: fileDigests[index],
    })),
    format: 'tileflow-icon-package-v1',
    iconNames: inspected.icons.map((icon) => icon.name),
    renderedIcons: inspected.icons.map((icon, index) => {
      const pixels = rendered[index];

      if (!pixels) {
        throw new Error(`Missing rendered pixels for ${icon.name}`);
      }

      return {name: icon.name, pixelSha256: pixels.pixelSha256};
    }),
    sprites: {
      oneX: {height: layoutOneX.height, pixelRatio: 1, width: layoutOneX.width},
      twoX: {height: layoutTwoX.height, pixelRatio: 2, width: layoutTwoX.width},
    },
  });

  return {
    icons: rendered,
    layoutOneX,
    layoutTwoX,
    package: {
      contentHash: await hashTileflowIconPackageManifest(manifest),
      files,
      manifest,
    },
    sourceReplacements: inspected.replacements ?? [],
  };
}

function createSpriteLayout(
  icons: Array<{height: number; name: string; width: number}>,
  pixelRatio: 1 | 2,
) {
  const columns = Math.ceil(Math.sqrt(icons.length));
  const widest = Math.max(...icons.map((icon) => icon.width));
  const targetWidth = Math.min(tileflowIconPackageLimits.maxAtlasDimension, columns * widest);
  const placements: Array<{left: number; top: number}> = [];
  let left = 0;
  let rowHeight = 0;
  let top = 0;

  for (const icon of icons) {
    if (icon.width > tileflowIconPackageLimits.maxAtlasDimension) {
      throw new Error(
        `Generated sprite exceeds ${tileflowIconPackageLimits.maxAtlasDimension} pixels per dimension`,
      );
    }
    if (left > 0 && left + icon.width > targetWidth) {
      top += rowHeight;
      left = 0;
      rowHeight = 0;
    }
    placements.push({left, top});
    left += icon.width;
    rowHeight = Math.max(rowHeight, icon.height);
  }

  const width = targetWidth;
  const height = top + rowHeight;

  if (
    width > tileflowIconPackageLimits.maxAtlasDimension ||
    height > tileflowIconPackageLimits.maxAtlasDimension
  ) {
    throw new Error(
      `Generated sprite exceeds ${tileflowIconPackageLimits.maxAtlasDimension} pixels per dimension`,
    );
  }

  const index: SpriteIndex = Object.fromEntries(
    icons.map((icon, indexNumber) => {
      const placement = placements[indexNumber]!;

      return [
        icon.name,
        {
          height: icon.height,
          pixelRatio,
          width: icon.width,
          x: placement.left,
          y: placement.top,
        },
      ];
    }),
  );

  return {height, index, width};
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

async function createSpriteImage(
  icons: Array<{height: number; name: string; rgba: Uint8Array; width: number}>,
  layout: ReturnType<typeof createSpriteLayout>,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const atlas = new Uint8Array(layout.width * layout.height * 4);

  for (const icon of icons) {
    const placement = layout.index[icon.name];
    if (!placement || icon.width !== placement.width || icon.height !== placement.height) {
      throw new Error('Rendered icon dimensions do not match the sprite layout');
    }

    const rowBytes = icon.width * 4;

    for (let row = 0; row < icon.height; row += 1) {
      const sourceStart = row * rowBytes;
      const targetStart = ((placement.y + row) * layout.width + placement.x) * 4;
      atlas.set(icon.rgba.subarray(sourceStart, sourceStart + rowBytes), targetStart);
    }
  }

  return sharp(atlas, {
    raw: {
      channels: 4,
      height: layout.height,
      width: layout.width,
    },
  })
    .png({adaptiveFiltering: false, compressionLevel: 9, palette: false})
    .toBuffer();
}

function assertGeneratedFileLimits(files: CompiledTileflowIconPackageFile[]): void {
  let totalBytes = 0;

  for (const file of files) {
    if (file.source.byteLength > tileflowIconPackageLimits.maxGeneratedFileBytes) {
      throw new Error(
        `${file.fileName} exceeds ${tileflowIconPackageLimits.maxGeneratedFileBytes} generated bytes`,
      );
    }

    totalBytes += file.source.byteLength;
  }

  if (totalBytes > tileflowIconPackageLimits.maxGeneratedPackageBytes) {
    throw new Error(
      `Generated package exceeds ${tileflowIconPackageLimits.maxGeneratedPackageBytes} bytes`,
    );
  }
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

async function loadSharp(): Promise<(typeof import('sharp'))['default']> {
  try {
    return (await import('sharp')).default;
  } catch (error) {
    throw new Error(
      'Local icon sprites require the optional "sharp" package. Install sharp or disable local icons.',
      {cause: error},
    );
  }
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
