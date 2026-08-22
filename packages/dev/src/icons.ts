import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {basename, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaxesParser} from 'saxes';
import {
  compareCodeUnits,
  hashTileflowIconPackageManifest,
  hashTileflowRenderedIconPixels,
  serializeCanonicalJson,
  sha256Hex,
  tileflowHostedIconIdPattern,
  type TileflowIconPackageFileName,
  tileflowIconPackageLabelSchema,
  tileflowIconPackageLimits,
  type TileflowIconPackageManifest,
  tileflowIconPackageManifestSchema,
  type TileflowIconSet,
  type TileflowIconSetConfig,
  type TileflowProjectConfig,
  tileflowStreetsPoiIconMapping,
} from '@tileflow/core';

export type TileflowBuildAsset = {
  contentType: string;
  fileName: string;
  source: string | Uint8Array;
};

export type PreparedTileflowProject = {
  assets: TileflowBuildAsset[];
  project: TileflowProjectConfig;
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
  label: string;
  mapName: string;
  mapping?: Record<string, string>;
  packageHash: string;
};

export type CompileTileflowIconPackagesResult = {
  bindings: TileflowMapIconPackageBinding[];
  packages: CompiledTileflowIconPackage[];
  watchPaths: string[];
};

export type InspectTileflowIconCatalogsOptions = {
  cwd: string;
  mapNames?: readonly string[];
};

export type TileflowIconCatalogSourceFormat = 'jpeg' | 'png' | 'svg' | 'webp';

export type TileflowIconCatalogMapping = {
  iconId: string;
  semantic: string;
  targetStatus: 'missing' | 'present' | 'unknown';
};

export type TileflowIconCatalogMappedFrom = {
  map: string;
  semantic: string;
};

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
  mappedFrom: TileflowIconCatalogMappedFrom[];
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
  icons: TileflowIconCatalogIcon[];
  insideWorkingTree: boolean;
  sourcePath: string;
};

export type TileflowIconCatalogMap = {
  name: string;
  icons:
    | {
        catalogSourcePath: string;
        kind: 'local';
        label: string;
        mappings: TileflowIconCatalogMapping[];
        packageHash: string;
      }
    | {
        inspectable: false;
        kind: 'external';
        mappings: TileflowIconCatalogMapping[];
      }
    | {
        inspectable: false;
        kind: 'none';
        mappings: TileflowIconCatalogMapping[];
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

type LocalIconRequest = {
  builtIn?: boolean;
  kind: 'local';
  label: string;
  mapName: string;
  mapping?: Record<string, string>;
  source: string;
  sourceDir: string;
};

type ExternalIconRequest = {
  kind: 'external';
  mapName: string;
  mapping?: Record<string, string>;
};

type EmptyIconRequest = {
  kind: 'none';
  mapName: string;
  mapping?: Record<string, string>;
};

type MapIconRequest = EmptyIconRequest | ExternalIconRequest | LocalIconRequest;

type ResolvedIconRequest = LocalIconRequest & {
  realSourceDir: string;
};

type IconInput = {
  fileName: string;
  format: TileflowIconCatalogSourceFormat;
  kind: 'icon' | 'pattern';
  name: string;
  path: string;
  source: Uint8Array;
};

type InspectedIconSource = {
  icons: IconInput[];
  realSourceDir: string;
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
  twoX: Awaited<ReturnType<typeof renderIcon>>;
};

type CompiledIconSource = {
  icons: CompiledIcon[];
  layoutOneX: ReturnType<typeof createSpriteLayout>;
  layoutTwoX: ReturnType<typeof createSpriteLayout>;
  package: CompiledTileflowIconPackage;
};

type CompileIconSourcesResult = {
  compiledBySource: Map<string, CompiledIconSource>;
  mapRequests: MapIconRequest[];
  realCwd: string | null;
  resolvedRequests: ResolvedIconRequest[];
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
const streetsPoiIconSourceDir = fileURLToPath(new URL('../assets/streets-poi', import.meta.url));

export async function compileTileflowIconPackages(
  project: TileflowProjectConfig,
  options: {
    cwd: string;
    target: TileflowIconCompilationTarget;
  },
): Promise<CompileTileflowIconPackagesResult> {
  const result = await compileIconSources(project, options);
  const packagesByHash = new Map<string, CompiledTileflowIconPackage>();

  for (const compiled of result.compiledBySource.values()) {
    packagesByHash.set(compiled.package.contentHash, compiled.package);
  }

  const bindings = result.resolvedRequests.map((request) => {
    const compiled = result.compiledBySource.get(request.realSourceDir);

    if (!compiled) {
      throw new Error(`Missing compiled icon package for map ${request.mapName}`);
    }

    return {
      label: request.label,
      mapName: request.mapName,
      ...(request.mapping ? {mapping: request.mapping} : {}),
      packageHash: compiled.package.contentHash,
    };
  });

  return {
    bindings,
    packages: [...packagesByHash.values()].sort((left, right) =>
      compareCodeUnits(left.contentHash, right.contentHash),
    ),
    watchPaths: [
      ...new Set(
        result.resolvedRequests
          .filter((request) => !request.builtIn)
          .map((request) => request.realSourceDir),
      ),
    ].sort(compareCodeUnits),
  };
}

export async function inspectTileflowIconCatalogs(
  project: TileflowProjectConfig,
  options: InspectTileflowIconCatalogsOptions,
): Promise<TileflowIconCatalogInspection> {
  const result = await compileIconSources(project, {
    cwd: options.cwd,
    mapNames: options.mapNames,
    target: 'local',
  });
  const resolvedByMap = new Map(
    result.resolvedRequests.map((request) => [request.mapName, request]),
  );
  const mappedFromBySource = new Map<string, Map<string, TileflowIconCatalogMappedFrom[]>>();
  const maps: TileflowIconCatalogMap[] = result.mapRequests.map((request) => {
    if (request.kind !== 'local') {
      return {
        name: request.mapName,
        icons: {
          inspectable: false,
          kind: request.kind,
          mappings: createCatalogMappings(request.mapping, 'unknown'),
        },
      };
    }

    const resolved = resolvedByMap.get(request.mapName);

    if (!resolved || !result.realCwd) {
      throw new Error(`Missing resolved icon source for map ${request.mapName}`);
    }

    const compiled = result.compiledBySource.get(resolved.realSourceDir);

    if (!compiled) {
      throw new Error(`Missing compiled icon catalog for map ${request.mapName}`);
    }

    const iconNames = new Set(compiled.package.manifest.iconNames);
    const mappings = createCatalogMappings(request.mapping, (iconId) =>
      iconNames.has(iconId) ? 'present' : 'missing',
    );
    const mappedFromByIcon = mappedFromBySource.get(resolved.realSourceDir) ?? new Map();

    for (const mapping of mappings) {
      if (mapping.targetStatus !== 'present') {
        continue;
      }

      const mappedFrom = mappedFromByIcon.get(mapping.iconId) ?? [];
      mappedFrom.push({map: request.mapName, semantic: mapping.semantic});
      mappedFromByIcon.set(mapping.iconId, mappedFrom);
    }

    mappedFromBySource.set(resolved.realSourceDir, mappedFromByIcon);

    return {
      name: request.mapName,
      icons: {
        catalogSourcePath: relativePortablePath(result.realCwd, resolved.realSourceDir),
        kind: 'local',
        label: request.label,
        mappings,
        packageHash: compiled.package.contentHash,
      },
    };
  });

  if (!result.realCwd) {
    return {catalogs: [], maps};
  }

  const realCwd = result.realCwd;
  const catalogs = [...result.compiledBySource.entries()]
    .map(([realSourceDir, compiled]): TileflowIconCatalog => {
      const sourcePath = relativePortablePath(realCwd, realSourceDir);
      const mappedFromByIcon = mappedFromBySource.get(realSourceDir) ?? new Map();

      return {
        compiledPackage: compiled.package,
        icons: compiled.icons.map((icon, index): TileflowIconCatalogIcon => {
          const manifestIcon = compiled.package.manifest.renderedIcons[index];
          const oneXAtlas = compiled.layoutOneX.index[icon.input.name];
          const twoXAtlas = compiled.layoutTwoX.index[icon.input.name];

          if (!manifestIcon || manifestIcon.name !== icon.input.name || !oneXAtlas || !twoXAtlas) {
            throw new Error(`Missing compiled catalog metadata for icon ${icon.input.name}`);
          }

          return {
            id: icon.input.name,
            mappedFrom: [...(mappedFromByIcon.get(icon.input.name) ?? [])].sort(compareMappedFrom),
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
              path: relativePortablePath(realCwd, icon.input.path),
            },
          };
        }),
        insideWorkingTree: isPathInside(realCwd, realSourceDir),
        sourcePath,
      };
    })
    .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath));

  return {catalogs, maps};
}

async function compileIconSources(
  project: TileflowProjectConfig,
  options: {
    cwd: string;
    mapNames?: readonly string[];
    target: TileflowIconCompilationTarget;
  },
): Promise<CompileIconSourcesResult> {
  const mapRequests = getMapIconRequests(project, options.cwd, options.mapNames);
  const requests = mapRequests.filter(
    (request): request is LocalIconRequest => request.kind === 'local',
  );

  if (requests.length === 0) {
    return {
      compiledBySource: new Map(),
      mapRequests,
      realCwd: null,
      resolvedRequests: [],
    };
  }

  const issues: TileflowIconCompilationIssue[] = [];
  const realCwd = await resolveWorkingDirectory(options.cwd, issues);
  const resolvedRequests: ResolvedIconRequest[] = [];

  for (const request of requests) {
    try {
      const realSourceDir = await realpath(request.sourceDir);

      if (
        options.target === 'hosted' &&
        realCwd &&
        !request.builtIn &&
        !isPathInside(realCwd, realSourceDir)
      ) {
        issues.push({
          message: 'Hosted icon sources must remain inside the selected working tree',
          path: sourcePath(request.mapName),
        });
        continue;
      }

      const sourceStat = await stat(realSourceDir);

      if (!sourceStat.isDirectory()) {
        issues.push({
          message: 'Icon source must be a directory',
          path: sourcePath(request.mapName),
        });
        continue;
      }

      resolvedRequests.push({...request, realSourceDir});
    } catch (error) {
      issues.push({
        message: describeFileSystemError(error, 'Icon source was not found'),
        path: sourcePath(request.mapName),
      });
    }
  }

  const inspectedBySource = new Map<string, InspectedIconSource>();
  const requestsBySource = groupRequestsBySource(resolvedRequests);

  for (const [realSourceDir, sourceRequests] of requestsBySource) {
    const representative = sourceRequests[0];

    if (!representative) {
      continue;
    }

    const inspected = await inspectIconSource(
      representative,
      realSourceDir,
      realCwd,
      options.target,
      issues,
    );

    if (inspected) {
      inspectedBySource.set(realSourceDir, inspected);
    }
  }

  if (issues.length > 0) {
    throw new TileflowIconCompilationError(issues);
  }

  const compiledBySource = new Map<string, CompiledIconSource>();

  for (const [realSourceDir, inspected] of inspectedBySource) {
    const representative = requestsBySource.get(realSourceDir)?.[0];

    if (!representative) {
      continue;
    }

    try {
      compiledBySource.set(realSourceDir, await compileInspectedIconSource(inspected));
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : 'Icon compilation failed',
        path: sourcePath(representative.mapName),
      });
    }
  }

  if (issues.length > 0) {
    throw new TileflowIconCompilationError(issues);
  }

  return {compiledBySource, mapRequests, realCwd, resolvedRequests};
}

export async function prepareTileflowProjectIcons(
  project: TileflowProjectConfig,
  options: {
    assetBaseUrl: string;
    cwd: string;
    defaultSprite?: string;
  },
): Promise<PreparedTileflowProject> {
  const sourceProject = options.defaultSprite
    ? applyDefaultSprite(project, options.cwd, options.defaultSprite)
    : project;
  const nextProject = cloneProject(sourceProject);
  const compiled = await compileTileflowIconPackages(sourceProject, {
    cwd: options.cwd,
    target: 'local',
  });
  const packagesByHash = new Map(
    compiled.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
  );
  const assets: TileflowBuildAsset[] = [];

  for (const binding of compiled.bindings) {
    const mapConfig = nextProject.maps[binding.mapName];
    const iconPackage = packagesByHash.get(binding.packageHash);

    if (!mapConfig || !iconPackage) {
      continue;
    }

    const spriteUrl = joinUrl(options.assetBaseUrl, `icons/${binding.mapName}/sprite`);
    mapConfig.icons = {
      ...(binding.mapping ? {mapping: binding.mapping} : {}),
      sprite: spriteUrl,
    };

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
    project: nextProject,
    watchPaths: compiled.watchPaths,
  };
}

export function getTileflowIconWatchPaths(project: TileflowProjectConfig, cwd: string): string[] {
  return uniqueStrings(
    getLocalIconRequests(project, cwd)
      .filter((request) => !request.builtIn)
      .map((request) => request.sourceDir),
  ).sort(compareCodeUnits);
}

function getLocalIconRequests(project: TileflowProjectConfig, cwd: string): LocalIconRequest[] {
  return getMapIconRequests(project, cwd).filter(
    (request): request is LocalIconRequest => request.kind === 'local',
  );
}

function getMapIconRequests(
  project: TileflowProjectConfig,
  cwd: string,
  mapNames?: readonly string[],
): MapIconRequest[] {
  const selectedNames = (
    mapNames === undefined ? Object.keys(project.maps) : [...new Set(mapNames)]
  ).sort(compareCodeUnits);

  return selectedNames.map((mapName): MapIconRequest => {
    const mapConfig = project.maps[mapName];

    if (!mapConfig) {
      throw new Error(`Unknown Tileflow map: ${mapName}`);
    }

    const iconSet = resolveIconSet(mapConfig.icons, project.icons);

    if (!iconSet?.source && !iconSet?.sprite && usesBuiltInStreetsPoiIcons(mapConfig)) {
      const mapping = sortMapping({...tileflowStreetsPoiIconMapping, ...iconSet?.mapping});

      return {
        builtIn: true,
        kind: 'local',
        label: 'tileflow-streets',
        mapName,
        ...(mapping ? {mapping} : {}),
        source: '@tileflow/dev/assets/streets-poi',
        sourceDir: streetsPoiIconSourceDir,
      };
    }

    const mapping = sortMapping(iconSet?.mapping);

    if (iconSet?.source) {
      return {
        kind: 'local',
        label: resolvePackageLabel(mapConfig.icons, iconSet.source, project.icons, mapName),
        mapName,
        ...(mapping ? {mapping} : {}),
        source: iconSet.source,
        sourceDir: resolve(cwd, iconSet.source),
      };
    }

    return {
      kind: iconSet?.sprite ? 'external' : 'none',
      mapName,
      ...(mapping ? {mapping} : {}),
    };
  });
}

function usesBuiltInStreetsPoiIcons(mapConfig: TileflowProjectConfig['maps'][string]): boolean {
  const poi = mapConfig.modules?.poi;
  return (
    mapConfig.basemap?.type === 'streets' &&
    poi?.enabled !== false &&
    poi?.preset !== 'none' &&
    poi?.icons !== false
  );
}

function resolveIconSet(
  icons: TileflowIconSet | undefined,
  iconSets: TileflowProjectConfig['icons'] | undefined,
  path: string[] = [],
): TileflowIconSetConfig | undefined {
  if (!icons) {
    return undefined;
  }

  if (typeof icons === 'string') {
    const referenced = iconSets?.[icons];

    if (referenced) {
      if (path.includes(icons)) {
        throw new Error(`Circular Tileflow icon set extends: ${[...path, icons].join(' -> ')}`);
      }

      return resolveIconSet(referenced, iconSets, [...path, icons]);
    }

    return isRemoteSpriteReference(icons) ? {sprite: icons} : {source: icons};
  }

  const extended = icons.extends ? resolveIconSet(icons.extends, iconSets, path) : undefined;

  return {
    ...extended,
    ...icons,
    mapping: {
      ...extended?.mapping,
      ...icons.mapping,
    },
  };
}

async function resolveWorkingDirectory(
  cwd: string,
  issues: TileflowIconCompilationIssue[],
): Promise<string | null> {
  try {
    const resolved = await realpath(cwd);

    if (!(await stat(resolved)).isDirectory()) {
      throw new Error('Working tree is not a directory');
    }

    return resolved;
  } catch (error) {
    issues.push({
      message: describeFileSystemError(error, 'Selected working tree was not found'),
      path: 'cwd',
    });
    return null;
  }
}

function groupRequestsBySource(
  requests: ResolvedIconRequest[],
): Map<string, ResolvedIconRequest[]> {
  const result = new Map<string, ResolvedIconRequest[]>();

  for (const request of requests) {
    const existing = result.get(request.realSourceDir) ?? [];
    existing.push(request);
    result.set(request.realSourceDir, existing);
  }

  return result;
}

async function inspectIconSource(
  request: ResolvedIconRequest,
  realSourceDir: string,
  realCwd: string | null,
  target: TileflowIconCompilationTarget,
  issues: TileflowIconCompilationIssue[],
): Promise<InspectedIconSource | null> {
  let entries;

  try {
    entries = await readdir(realSourceDir, {withFileTypes: true});
  } catch (error) {
    issues.push({
      message: describeFileSystemError(error, 'Icon source could not be read'),
      path: sourcePath(request.mapName),
    });
    return null;
  }

  entries.sort((left, right) => compareCodeUnits(left.name, right.name));
  const candidates: Array<{
    fileName: string;
    format: TileflowIconCatalogSourceFormat;
    kind: 'icon' | 'pattern';
    name: string;
    path: string;
    size: number;
  }> = [];
  const names = new Set<string>();
  let aggregateBytes = 0;

  for (const entry of entries) {
    const entryPath = resolve(realSourceDir, entry.name);
    const path = iconPath(request.mapName, entry.name);

    if (entry.isDirectory()) {
      if (target === 'hosted') {
        issues.push({message: 'Nested directories are not supported', path});
      }
      continue;
    }

    let entryStat;
    let realEntryPath = entryPath;

    try {
      if (entry.isSymbolicLink()) {
        if (target === 'local') {
          continue;
        }

        realEntryPath = await realpath(entryPath);

        if (!realCwd || !isPathInside(realCwd, realEntryPath)) {
          issues.push({message: 'Icon symlink escapes the selected working tree', path});
          continue;
        }
      }

      entryStat = await stat(realEntryPath);
    } catch (error) {
      if (target === 'hosted') {
        issues.push({
          message: describeFileSystemError(error, 'Icon entry could not be read'),
          path,
        });
      }
      continue;
    }

    if (!entryStat.isFile()) {
      if (target === 'hosted') {
        issues.push({message: 'Icon entries must be regular files', path});
      }
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

    if (target === 'hosted' && !tileflowHostedIconIdPattern.test(name)) {
      issues.push({
        message: 'Hosted icon IDs must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$',
        path,
      });
    }

    if (entryStat.size > tileflowIconPackageLimits.maxSourceFileBytes) {
      issues.push({
        message: `Icon source exceeds ${tileflowIconPackageLimits.maxSourceFileBytes} bytes`,
        path,
      });
    }

    aggregateBytes += entryStat.size;
    candidates.push({
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
      path: sourcePath(request.mapName),
    });
  }

  if (candidates.length > tileflowIconPackageLimits.maxIconCount) {
    issues.push({
      message: `Icon source contains more than ${tileflowIconPackageLimits.maxIconCount} icons`,
      path: sourcePath(request.mapName),
    });
  }

  if (aggregateBytes > tileflowIconPackageLimits.maxSourceBytes) {
    issues.push({
      message: `Icon source exceeds ${tileflowIconPackageLimits.maxSourceBytes} aggregate bytes`,
      path: sourcePath(request.mapName),
    });
  }

  if (issues.length > 0) {
    return null;
  }

  const icons: IconInput[] = [];

  for (const candidate of candidates) {
    const displayPath = iconPath(request.mapName, candidate.fileName);

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

  if (issues.length > 0) {
    return null;
  }

  return {icons, realSourceDir};
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

function resolvePackageLabel(
  icons: TileflowIconSet | undefined,
  source: string,
  iconSets: TileflowProjectConfig['icons'] | undefined,
  mapName: string,
): string {
  let candidate: string | undefined;

  if (typeof icons === 'string' && iconSets?.[icons]) {
    candidate = icons;
  } else if (icons && typeof icons === 'object' && icons.extends && iconSets?.[icons.extends]) {
    candidate = icons.extends;
  }

  candidate ??= basename(source.replace(/[\\/]+$/u, '')) || mapName || 'Icons';
  const printable = Array.from(candidate.normalize('NFC'))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) ? '' : character;
    })
    .join('')
    .trim();
  const bounded = Array.from(printable || 'Icons')
    .slice(0, 64)
    .join('');

  return tileflowIconPackageLabelSchema.parse(bounded);
}

function sortMapping(
  mapping: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!mapping) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(mapping).sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function createCatalogMappings(
  mapping: Record<string, string> | undefined,
  targetStatus:
    | TileflowIconCatalogMapping['targetStatus']
    | ((iconId: string) => TileflowIconCatalogMapping['targetStatus']),
): TileflowIconCatalogMapping[] {
  return Object.entries(mapping ?? {})
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([semantic, iconId]) => ({
      iconId,
      semantic,
      targetStatus: typeof targetStatus === 'function' ? targetStatus(iconId) : targetStatus,
    }));
}

function compareMappedFrom(
  left: TileflowIconCatalogMappedFrom,
  right: TileflowIconCatalogMappedFrom,
): number {
  return compareCodeUnits(left.map, right.map) || compareCodeUnits(left.semantic, right.semantic);
}

function atlasRectangle(entry: SpriteIndex[string]): TileflowIconCatalogAtlasRectangle {
  return {height: entry.height, width: entry.width, x: entry.x, y: entry.y};
}

function relativePortablePath(root: string, candidate: string): string {
  const pathFromRoot = relative(root, candidate);

  if (pathFromRoot === '') {
    return '.';
  }

  if (isAbsolute(pathFromRoot)) {
    throw new Error('Icon catalog path cannot be represented relative to the working tree');
  }

  return pathFromRoot.split(sep).join('/');
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

function sourcePath(mapName: string): string {
  return `maps.${mapName}.icons.source`;
}

function iconPath(mapName: string, fileName: string): string {
  return `${sourcePath(mapName)}/${fileName}`;
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

function cloneProject(project: TileflowProjectConfig): TileflowProjectConfig {
  return JSON.parse(JSON.stringify(project)) as TileflowProjectConfig;
}

function applyDefaultSprite(
  project: TileflowProjectConfig,
  cwd: string,
  sprite: string,
): TileflowProjectConfig {
  const nextProject = cloneProject(project);

  for (const request of getMapIconRequests(project, cwd)) {
    if (request.kind !== 'local' || !request.builtIn) continue;
    const map = nextProject.maps[request.mapName];
    if (!map) continue;
    map.icons = {
      ...(request.mapping ? {mapping: request.mapping} : {}),
      sprite,
    };
  }

  return nextProject;
}

function isRemoteSpriteReference(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    value.startsWith('data:')
  );
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
