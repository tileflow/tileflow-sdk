import {createHash} from 'node:crypto';
import {lstat, readdir, readFile, realpath, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join} from 'node:path';
import {
  compareCodeUnits,
  getTileflowStyleFontFaces,
  hashTileflowFontBundleManifest,
  type MapLibreStyle,
  parseResolvedTileflowMap,
  type TileflowFontBundleManifest,
  tileflowMapIdSchema,
  type TileflowStyleFontFace,
  tileflowStyleFontFaceLimits,
  tileflowStyleFontFacesMetadataKey,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import type {
  TileflowBuildCatalog,
  TileflowBuildStyles,
  TileflowEffectiveFontSourceIdentity,
} from '@tileflow/core/build';
import {
  type ResolvedTileflowAssetDirectory,
  resolveTileflowAssetDirectories,
  TileflowAssetDirectoryError,
} from './asset-directories';
import type {TileflowBuildAsset} from './icons';
import {isPathWithin} from './path-safety';
import {joinTileflowPublicUrl} from './public-paths';

export type TileflowFontCompilationTarget = 'hosted' | 'local';

export type TileflowFontCompilationIssue = {
  message: string;
  path: string;
};

export class TileflowFontCompilationError extends Error {
  readonly code = 'FONT_INVALID' as const;
  readonly issues: readonly TileflowFontCompilationIssue[];
  readonly phase = 'font-compilation' as const;

  constructor(issues: readonly TileflowFontCompilationIssue[]) {
    const normalized = [...issues].sort(
      (left, right) =>
        compareCodeUnits(left.path, right.path) || compareCodeUnits(left.message, right.message),
    );
    super(
      [
        'Invalid Tileflow font directories',
        ...normalized.map((issue) => `- ${issue.path}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'TileflowFontCompilationError';
    this.issues = normalized;
  }
}

export type PreparedTileflowStyleFonts = {
  assets: TileflowBuildAsset[];
  bundles: Record<string, CompiledTileflowFontBundle>;
  sourceIdentities: Record<string, TileflowEffectiveFontSourceIdentity[]>;
  styles: TileflowBuildStyles;
  watchPaths: string[];
};

export type CompiledTileflowFontBundle = {
  contentHash: string;
  files: TileflowBuildAsset[];
  manifest: TileflowFontBundleManifest;
};

export type PrepareTileflowStyleFontsOptions = {
  assetBaseUrl: string;
  baseDirectory?: string;
  cwd: string;
  target: TileflowFontCompilationTarget;
};

/** Resolve only mutable local font directories so failed builds can still be watched. */
export async function getTileflowFontWatchPaths(
  project: TileflowBuildCatalog,
  cwd: string,
  baseDirectory = cwd,
): Promise<string[]> {
  const watchPaths = new Set<string>();
  const issues: TileflowFontCompilationIssue[] = [];

  for (const mapName of Object.keys(project.maps).sort(compareCodeUnits)) {
    const resolvedMap = project.maps[mapName];
    if (!resolvedMap) continue;
    const fonts = parseResolvedTileflowMap(resolvedMap).fonts;
    if (fonts === undefined) continue;
    try {
      const directories = await resolveTileflowAssetDirectories(fonts, {
        baseDirectory,
        configPath: `maps.${mapName}.fonts`,
        cwd,
        kind: 'fonts',
        target: 'local',
      });
      for (const directory of directories) {
        if (directory.watch) watchPaths.add(directory.realPath);
      }
    } catch (error) {
      if (!(error instanceof TileflowAssetDirectoryError)) throw error;
      issues.push(...error.issues);
    }
  }

  if (issues.length > 0) throw new TileflowFontCompilationError(issues);
  return [...watchPaths].sort(compareCodeUnits);
}

type SupportedFontExtension = '.otf' | '.ttf' | '.woff2';

type FontkitFont = {
  'OS/2'?: {
    fsSelection?: {italic?: boolean; oblique?: boolean};
    usWeightClass?: number;
  };
  fullName?: unknown;
  italicAngle?: unknown;
};

type PreparedFontInput = {
  canonicalName: string;
  directory: ResolvedTileflowAssetDirectory;
  extension: SupportedFontExtension;
  fileName: string;
  fontFace: Omit<TileflowStyleFontFace, 'source'>;
  license: Uint8Array;
  source: Uint8Array;
};

type InspectedFontDirectory = {
  faces: PreparedFontInput[];
};

const localRequire = createRequire(import.meta.url);
const fontkit = localRequire('fontkit') as {create(source: Uint8Array): FontkitFont};

// Keep build acceptance aligned with the browser loader's fail-closed response limit.
const maximumFontFileBytes = 1024 * 1024;
const maximumFontFilesPerDirectory = 64;
const maximumLicenseBytes = 2 * 1024 * 1024;
const supportedExtensions = new Set<SupportedFontExtension>(['.otf', '.ttf', '.woff2']);
const expressionOperators = new Set([
  'at',
  'case',
  'coalesce',
  'concat',
  'format',
  'get',
  'interpolate',
  'let',
  'literal',
  'match',
  'step',
  'to-string',
  'var',
]);

/**
 * Prepare every map's ordered local font provider.
 *
 * OpenType full names are the canonical IDs consumed by `text-font`. Directories are applied from
 * left to right, so a later directory replaces an earlier face only when that exact ID matches.
 */
export async function prepareTileflowStyleFonts(
  project: TileflowBuildCatalog,
  inputStyles: Readonly<Record<string, Readonly<Record<string, MapLibreStyle>>>>,
  options: PrepareTileflowStyleFontsOptions,
): Promise<PreparedTileflowStyleFonts> {
  const projectMapNames = Object.keys(project.maps).sort(compareCodeUnits);
  const styleMapNames = Object.keys(inputStyles).sort(compareCodeUnits);
  const issues: TileflowFontCompilationIssue[] = [];

  for (const mapName of projectMapNames) {
    if (!tileflowMapIdSchema.safeParse(mapName).success) {
      issues.push({message: 'Expected a portable map key', path: `maps.${mapName}`});
    }
  }
  for (const mapName of styleMapNames) {
    if (!tileflowMapIdSchema.safeParse(mapName).success) {
      issues.push({message: 'Expected a portable map key', path: `styles.${mapName}`});
    }
    for (const themeName of Object.keys(inputStyles[mapName]!).sort(compareCodeUnits)) {
      if (!tileflowThemeNameSchema.safeParse(themeName).success) {
        issues.push({
          message: 'Expected a concrete portable theme key; "system" is browser-only',
          path: `styles.${mapName}.${themeName}`,
        });
      }
    }
  }
  if (issues.length > 0) throw new TileflowFontCompilationError(issues);

  const parsedMaps = new Map(
    projectMapNames.map(
      (mapName) => [mapName, parseResolvedTileflowMap(project.maps[mapName]!)] as const,
    ),
  );
  if (
    projectMapNames.length !== styleMapNames.length ||
    projectMapNames.some((mapName, index) => mapName !== styleMapNames[index])
  ) {
    throw new TileflowFontCompilationError([
      {message: 'Expected one compiled theme family for every project map', path: 'styles'},
    ]);
  }

  const assets = new Map<string, TileflowBuildAsset>();
  const bundles: Record<string, CompiledTileflowFontBundle> = {};
  const sourceIdentities: Record<string, TileflowEffectiveFontSourceIdentity[]> = {};
  const styles: TileflowBuildStyles = Object.fromEntries(
    Object.entries(inputStyles).map(([mapName, themes]) => [mapName, {...themes}]),
  );
  const watchPaths = new Set<string>();

  for (const mapName of projectMapNames) {
    const map = parsedMaps.get(mapName);
    const themeStyles = inputStyles[mapName];
    if (!map || !themeStyles) continue;

    const declaredThemeNames = Object.keys(map.themes).sort(compareCodeUnits);
    const compiledThemeNames = Object.keys(themeStyles).sort(compareCodeUnits);
    if (
      declaredThemeNames.length !== compiledThemeNames.length ||
      declaredThemeNames.some((themeName, index) => themeName !== compiledThemeNames[index])
    ) {
      issues.push({
        message: "Compiled styles must exactly match the map's declared themes",
        path: `styles.${mapName}`,
      });
      continue;
    }
    if (map.fonts === undefined) continue;

    const configPath = `maps.${mapName}.fonts`;
    let directories: ResolvedTileflowAssetDirectory[];
    try {
      directories = await resolveTileflowAssetDirectories(map.fonts, {
        baseDirectory: options.baseDirectory,
        configPath,
        cwd: options.cwd,
        kind: 'fonts',
        target: options.target,
      });
    } catch (error) {
      if (!(error instanceof TileflowAssetDirectoryError)) throw error;
      issues.push(...error.issues);
      continue;
    }
    for (const directory of directories) {
      if (directory.watch) watchPaths.add(directory.realPath);
    }

    const selectedFaces = new Map<string, PreparedFontInput>();
    const namesByCaseFold = new Map<string, string>();
    for (const directory of directories) {
      const inspected = await inspectFontDirectory(directory, issues);
      for (const face of inspected.faces) {
        const folded = face.canonicalName.toLowerCase();
        const previousSpelling = namesByCaseFold.get(folded);
        if (previousSpelling && previousSpelling !== face.canonicalName) {
          issues.push({
            message: `Canonical font name differs from already declared "${previousSpelling}" only by case`,
            path: `${directory.configPath}.${face.fileName}`,
          });
          continue;
        }
        namesByCaseFold.set(folded, face.canonicalName);
        selectedFaces.set(face.canonicalName, face);
      }
    }

    const requiredNamesByTheme = new Map<string, Set<string>>();
    const requiredNames = new Set<string>();
    for (const themeName of compiledThemeNames) {
      const style = themeStyles[themeName]!;
      const themeRequiredNames = collectPrimaryTextFonts(style, `${mapName}.${themeName}`, issues);
      requiredNamesByTheme.set(themeName, themeRequiredNames);
      for (const name of themeRequiredNames) requiredNames.add(name);
    }
    const requiredFaces: PreparedFontInput[] = [];
    for (const canonicalName of [...requiredNames].sort(compareCodeUnits)) {
      const face = selectedFaces.get(canonicalName);
      if (face) {
        requiredFaces.push(face);
        continue;
      }
      const caseVariant = namesByCaseFold.get(canonicalName.toLowerCase());
      const available = [...selectedFaces.keys()].sort(compareCodeUnits);
      issues.push({
        message: caseVariant
          ? `Expected exact canonical font name "${caseVariant}"`
          : `No declared font directory provides canonical face "${canonicalName}"${
              available.length > 0 ? `. Available: ${available.join(', ')}` : ''
            }`,
        path: `styles.${mapName}.*.text-font`,
      });
    }

    if (requiredFaces.length > tileflowStyleFontFaceLimits.maximumCount) {
      issues.push({
        message: `At most ${tileflowStyleFontFaceLimits.maximumCount} local font faces may be used by one map`,
        path: `styles.${mapName}.*.text-font`,
      });
      continue;
    }

    const fontFaces: TileflowStyleFontFace[] = [];
    const mapAssets = new Map<string, TileflowBuildAsset>();
    const bundleFaces: TileflowFontBundleManifest['fontFaces'] = [];
    for (const face of requiredFaces) {
      const digest = sha256(face.source);
      const licenseDigest = sha256(face.license);
      const slug = slugifyFontName(face.canonicalName);
      const fileName = `fonts/${slug}-${digest}${face.extension}`;
      const fontAsset = {
        contentType: contentTypeForExtension(face.extension),
        fileName,
        source: face.source,
      } satisfies TileflowBuildAsset;
      const licenseFileName = `fonts/licenses/license-${licenseDigest}.txt`;
      const licenseAsset = {
        contentType: 'text/plain; charset=utf-8',
        fileName: licenseFileName,
        source: face.license,
      } satisfies TileflowBuildAsset;
      addAsset(assets, fontAsset);
      addAsset(assets, licenseAsset);
      addAsset(mapAssets, fontAsset);
      addAsset(mapAssets, licenseAsset);
      fontFaces.push({
        ...face.fontFace,
        source: joinTileflowPublicUrl(options.assetBaseUrl, fileName),
      });
      bundleFaces.push({
        family: face.fontFace.family,
        file: fileName,
        licenseFile: licenseFileName,
        style: face.fontFace.style ?? 'normal',
        weight: face.fontFace.weight ?? '400',
      });
    }

    const sortedBundleFaces = [...bundleFaces].sort((left, right) =>
      compareCodeUnits(fontFaceIdentity(left), fontFaceIdentity(right)),
    );
    const fontFaceByIdentity = new Map(
      fontFaces.map((face) => [fontFaceIdentity(face), face] as const),
    );
    const sourceFaceByFamily = new Map(
      requiredFaces.map((face) => [face.canonicalName, face.fontFace] as const),
    );
    const preparedThemes: Record<string, MapLibreStyle> = {};
    for (const themeName of compiledThemeNames) {
      const style = themeStyles[themeName]!;
      const existingFontFaces = getTileflowStyleFontFaces(style);
      if (existingFontFaces.length > 0) {
        issues.push({
          message: `Compiled styles may not predeclare ${tileflowStyleFontFacesMetadataKey}; the font pipeline owns it`,
          path: `styles.${mapName}.${themeName}.metadata.${tileflowStyleFontFacesMetadataKey}`,
        });
      }
      const themeFontIdentities = new Set(
        [...(requiredNamesByTheme.get(themeName) ?? [])].map((family) => {
          const face = sourceFaceByFamily.get(family);
          return face ? fontFaceIdentity(face) : '';
        }),
      );
      const themeFontFaces = sortedBundleFaces
        .filter((face) => themeFontIdentities.has(fontFaceIdentity(face)))
        .map((face) => fontFaceByIdentity.get(fontFaceIdentity(face))!);
      preparedThemes[themeName] = withFontFaces(style, themeFontFaces);
    }
    styles[mapName] = preparedThemes;
    sourceIdentities[mapName] = sortedBundleFaces.map((face) => ({
      family: face.family,
      sha256: sha256(toBytes(mapAssets.get(face.file)!.source)),
      style: face.style,
      weight: face.weight,
    }));
    if (bundleFaces.length > 0) {
      const files = [...mapAssets.values()].sort((left, right) =>
        compareCodeUnits(left.fileName, right.fileName),
      );
      const manifest: TileflowFontBundleManifest = {
        files: files.map((file) => ({
          byteLength: toBytes(file.source).byteLength,
          contentType:
            file.contentType as TileflowFontBundleManifest['files'][number]['contentType'],
          kind: file.fileName.startsWith('fonts/licenses/') ? 'license' : 'font',
          name: file.fileName,
          sha256: sha256(toBytes(file.source)),
        })) as TileflowFontBundleManifest['files'],
        fontFaces: sortedBundleFaces,
        format: 'tileflow-font-bundle-v1',
      };
      bundles[mapName] = {
        contentHash: await hashTileflowFontBundleManifest(manifest),
        files,
        manifest,
      };
    }
  }

  if (issues.length > 0) throw new TileflowFontCompilationError(issues);
  return {
    assets: [...assets.values()].sort((left, right) =>
      compareCodeUnits(left.fileName, right.fileName),
    ),
    bundles,
    sourceIdentities,
    styles,
    watchPaths: [...watchPaths].sort(compareCodeUnits),
  };
}

/** Replace provisional local/preflight URLs with one exact Hosted bundle base URL. */
export function bindTileflowStyleFontBundle(
  style: MapLibreStyle,
  bundle: CompiledTileflowFontBundle,
  publicBaseUrl: string,
): MapLibreStyle {
  const current = getTileflowStyleFontFaces(style);
  const bundleFaceByIdentity = new Map(
    bundle.manifest.fontFaces.map((face) => [fontFaceIdentity(face), face] as const),
  );
  const resolved = current.map((face) => {
    const wanted = bundleFaceByIdentity.get(fontFaceIdentity(face));
    if (!wanted || !(face.source === wanted.file || face.source.endsWith(`/${wanted.file}`))) {
      return undefined;
    }
    return {
      family: wanted.family,
      source: joinTileflowPublicUrl(publicBaseUrl, wanted.file),
      style: wanted.style,
      weight: wanted.weight,
    } satisfies TileflowStyleFontFace;
  });
  if (resolved.some((face) => face === undefined)) {
    throw new Error('Compiled style font faces do not match their canonical font bundle.');
  }
  return withFontFaces(style, resolved as TileflowStyleFontFace[]);
}

export function replaceTileflowStyleFontSources(
  style: MapLibreStyle,
  replace: (source: string) => string,
): MapLibreStyle {
  const fontFaces = getTileflowStyleFontFaces(style);
  if (fontFaces.length === 0) return style;
  return withFontFaces(
    style,
    fontFaces.map((fontFace) => ({...fontFace, source: replace(fontFace.source)})),
  );
}

async function inspectFontDirectory(
  directory: ResolvedTileflowAssetDirectory,
  issues: TileflowFontCompilationIssue[],
): Promise<InspectedFontDirectory> {
  const entries = (await readdir(directory.realPath, {withFileTypes: true})).sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  );
  const fontEntries = entries.filter((entry) =>
    supportedExtensions.has(extname(entry.name).toLowerCase() as SupportedFontExtension),
  );
  if (fontEntries.length > maximumFontFilesPerDirectory) {
    issues.push({
      message: `At most ${maximumFontFilesPerDirectory} font files are allowed in one directory`,
      path: directory.configPath,
    });
  }

  const licenseEntry = entries.find((entry) => entry.name === 'LICENSE.txt');
  let license: Uint8Array | undefined;
  if (fontEntries.length > 0) {
    if (!licenseEntry?.isFile()) {
      issues.push({
        message: 'Every directory containing fonts must include the regular file LICENSE.txt',
        path: `${directory.configPath}.LICENSE.txt`,
      });
    } else {
      license = await readContainedFile(directory, licenseEntry.name, maximumLicenseBytes, issues);
      if (license && !isValidLicense(license)) {
        issues.push({
          message: 'LICENSE.txt must be non-empty UTF-8 text without NUL bytes',
          path: `${directory.configPath}.LICENSE.txt`,
        });
        license = undefined;
      }
    }
  }

  const faces: PreparedFontInput[] = [];
  const namesInDirectory = new Set<string>();
  for (const entry of fontEntries.slice(0, maximumFontFilesPerDirectory)) {
    const path = `${directory.configPath}.${entry.name}`;
    const extension = extname(entry.name);
    if (!supportedExtensions.has(extension as SupportedFontExtension)) {
      issues.push({message: 'Font file extensions must be lowercase', path});
      continue;
    }
    if (!entry.isFile()) {
      issues.push({message: 'Font inputs must be regular files', path});
      continue;
    }
    const source = await readContainedFile(directory, entry.name, maximumFontFileBytes, issues);
    if (!source || !license) continue;
    try {
      assertFontSignature(source, extension as SupportedFontExtension);
      const metadata = readFontMetadata(source);
      if (namesInDirectory.has(metadata.canonicalName)) {
        issues.push({
          message: `Directory declares canonical face "${metadata.canonicalName}" more than once`,
          path,
        });
        continue;
      }
      namesInDirectory.add(metadata.canonicalName);
      faces.push({
        ...metadata,
        directory,
        extension: extension as SupportedFontExtension,
        fileName: entry.name,
        license,
        source,
      });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : 'Font metadata could not be read',
        path,
      });
    }
  }
  return {faces};
}

async function readContainedFile(
  directory: ResolvedTileflowAssetDirectory,
  fileName: string,
  maximumBytes: number,
  issues: TileflowFontCompilationIssue[],
): Promise<Uint8Array | undefined> {
  const configuredPath = join(directory.realPath, fileName);
  const issuePath = `${directory.configPath}.${fileName}`;
  try {
    if (!(await lstat(configuredPath)).isFile()) throw new Error('Asset must be a regular file');
    const realPath = await realpath(configuredPath);
    if (!isPathWithin(directory.realPath, realPath)) {
      throw new Error('Asset file escapes its declared directory');
    }
    const metadata = await stat(realPath);
    if (metadata.size === 0) throw new Error('Asset file may not be empty');
    if (metadata.size > maximumBytes) {
      throw new Error(`Asset file exceeds the ${maximumBytes}-byte limit`);
    }
    return await readFile(realPath);
  } catch (error) {
    issues.push({
      message: error instanceof Error ? error.message : 'Asset file could not be read',
      path: issuePath,
    });
    return undefined;
  }
}

function readFontMetadata(
  source: Uint8Array,
): Pick<PreparedFontInput, 'canonicalName' | 'fontFace'> {
  let font: FontkitFont;
  try {
    font = fontkit.create(source);
  } catch (error) {
    throw new Error(
      `Unable to parse OpenType font${error instanceof Error && error.message ? `: ${error.message}` : ''}`,
    );
  }
  if (!font || typeof font !== 'object') throw new Error('Expected one OpenType font face');

  const canonicalName = normalizeCanonicalFontName(font.fullName);
  if (!canonicalName) {
    throw new Error('OpenType fullName must be a canonical name of 1 to 100 characters');
  }
  const os2 = font['OS/2'];
  const rawWeight = os2?.usWeightClass;
  if (
    !Number.isInteger(rawWeight) ||
    rawWeight! < 100 ||
    rawWeight! > 900 ||
    rawWeight! % 100 !== 0
  ) {
    throw new Error('OpenType OS/2.usWeightClass must be one of 100, 200, ..., 900');
  }

  const italicAngle = font.italicAngle;
  if (
    italicAngle !== undefined &&
    (typeof italicAngle !== 'number' || !Number.isFinite(italicAngle))
  ) {
    throw new Error('OpenType italicAngle is invalid');
  }
  const style: NonNullable<TileflowStyleFontFace['style']> = os2?.fsSelection?.oblique
    ? 'oblique'
    : os2?.fsSelection?.italic || (typeof italicAngle === 'number' && italicAngle !== 0)
      ? 'italic'
      : 'normal';
  const weight = String(rawWeight) as NonNullable<TileflowStyleFontFace['weight']>;

  return {canonicalName, fontFace: {family: canonicalName, style, weight}};
}

function normalizeCanonicalFontName(input: unknown): string | undefined {
  if (typeof input !== 'string' || input !== input.trim()) return undefined;
  const value = input.normalize('NFC');
  if (!value || value.length > 100 || /[\p{Cc}\\]/u.test(value)) return undefined;
  return value;
}

function collectPrimaryTextFonts(
  style: MapLibreStyle,
  mapName: string,
  issues: TileflowFontCompilationIssue[],
): Set<string> {
  const result = new Set<string>();
  for (const [index, layer] of style.layers.entries()) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    const layout = layer.layout;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) continue;
    const textFont = (layout as Record<string, unknown>)['text-font'];
    if (textFont === undefined) continue;
    const layerId = typeof layer.id === 'string' ? layer.id : String(index);
    const primary = readStaticPrimaryFont(textFont);
    if (primary === undefined) {
      issues.push({
        message: 'Local font providers require a static non-empty text-font stack',
        path: `styles.${mapName}.layers.${layerId}.layout.text-font`,
      });
      continue;
    }
    const canonical = normalizeCanonicalFontName(primary);
    if (!canonical) {
      issues.push({
        message: 'Primary text-font must be a canonical name of 1 to 100 characters',
        path: `styles.${mapName}.layers.${layerId}.layout.text-font.0`,
      });
      continue;
    }
    result.add(canonical);
  }
  return result;
}

function readStaticPrimaryFont(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length === 2 && value[0] === 'literal') return readStaticPrimaryFont(value[1]);
  if (
    value.every((entry) => typeof entry === 'string') &&
    !expressionOperators.has(value[0] as string)
  ) {
    return value[0] as string;
  }
  return undefined;
}

function withFontFaces(style: MapLibreStyle, fontFaces: TileflowStyleFontFace[]): MapLibreStyle {
  const metadata = {...style.metadata};
  if (fontFaces.length === 0) delete metadata[tileflowStyleFontFacesMetadataKey];
  else metadata[tileflowStyleFontFacesMetadataKey] = fontFaces;
  return {...style, metadata};
}

function addAsset(assets: Map<string, TileflowBuildAsset>, asset: TileflowBuildAsset): void {
  const previous = assets.get(asset.fileName);
  if (!previous) {
    assets.set(asset.fileName, asset);
    return;
  }
  if (
    previous.contentType !== asset.contentType ||
    !equalBytes(toBytes(previous.source), toBytes(asset.source))
  ) {
    throw new Error(`Conflicting generated font asset: ${asset.fileName}`);
  }
}

function assertFontSignature(source: Uint8Array, extension: SupportedFontExtension): void {
  if (source.byteLength < 4) throw new Error('Font file is too small');
  const signature = String.fromCharCode(source[0]!, source[1]!, source[2]!, source[3]!);
  const trueType = source[0] === 0 && source[1] === 1 && source[2] === 0 && source[3] === 0;
  const supported =
    extension === '.woff2'
      ? signature === 'wOF2'
      : extension === '.otf'
        ? signature === 'OTTO'
        : trueType || signature === 'true';
  if (!supported) throw new Error(`File bytes do not match the ${extension} format`);
}

function isValidLicense(source: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(source);
    return text.trim().length > 0 && !text.includes('\0');
  } catch {
    return false;
  }
}

function contentTypeForExtension(extension: SupportedFontExtension): string {
  if (extension === '.otf') return 'font/otf';
  if (extension === '.ttf') return 'font/ttf';
  return 'font/woff2';
}

function slugifyFontName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'font';
}

function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function toBytes(source: string | Uint8Array): Uint8Array {
  return typeof source === 'string' ? new TextEncoder().encode(source) : source;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function fontFaceIdentity(face: {family: string; style?: string; weight?: string}): string {
  return `${face.family}\0${face.style ?? 'normal'}\0${face.weight ?? '400'}`;
}
