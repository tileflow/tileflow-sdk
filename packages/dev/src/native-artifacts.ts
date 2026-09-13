import {createHash} from 'node:crypto';
import {
  getTileflowStyleFontFaces,
  type MapLibreStyle,
  tileflowStyleFontFacesMetadataKey,
  tileflowIconIdPattern,
  tileflowIconPackageLimits,
} from '@tileflow/core';
import type {TileflowBuildCatalog, TileflowBuildStyles} from '@tileflow/core/build';
import {
  createTileflowNativeDiagnostic,
  TileflowNativeCompatibilityError,
  type TileflowNativeDiagnostic,
  tileflowNativeProfileLimits,
  validateTileflowNativeStyle,
} from '@tileflow/core/native-profile';
import type {TileflowBuildAsset} from './icons';

/** No delivery URL is inferred: this non-routable base is used only to check relative URL syntax. */
function documentUrl(map: string, theme: string): string {
  return `https://artifacts.invalid/native/styles/${map}/${theme}.json`;
}

function withContext(issue: TileflowNativeDiagnostic, map: string, theme: string): TileflowNativeDiagnostic {
  const prefix = `/maps/${map}/themes/${theme}/style`;
  return {...issue, path: prefix.length + issue.path.length <= 300 ? prefix + issue.path : prefix};
}

/** Reject browser protocols before local PMTiles snapshotting and before any output writes. */
export function assertTileflowNativeCompiledStyles(project: TileflowBuildCatalog, styles: TileflowBuildStyles): void {
  const issues: TileflowNativeDiagnostic[] = [];
  for (const mapName of Object.keys(project.maps).sort()) {
    for (const theme of Object.keys(styles[mapName] ?? {}).sort()) {
      issues.push(...validateTileflowNativeStyle(styles[mapName]![theme], {
        documentUrl: documentUrl(mapName, theme), deferFontClosure: true,
      }).map((issue) => withContext(issue, mapName, theme)));
    }
  }
  if (issues.length) throw new TileflowNativeCompatibilityError(issues);
}

/** Representation-only projection after the shared icon/font/semantic compilation pipeline. */
export function prepareTileflowNativeStyles(
  input: TileflowBuildStyles,
  assets: readonly TileflowBuildAsset[],
): TileflowBuildStyles {
  const issues: TileflowNativeDiagnostic[] = [];
  const result: TileflowBuildStyles = {};
  for (const map of Object.keys(input).sort()) {
    result[map] = {};
    if (!validNativeSprites(map, assets)) {
      issues.push({
        ...createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', `/maps/${map}/icons`),
        suggestion: 'Rebuild the icon sources into a complete, bounded 1x/2x sprite pair.',
      });
    }
    for (const theme of Object.keys(input[map]!).sort()) {
      const original = input[map]![theme]!;
      const preflight = validateTileflowNativeStyle(original, {
        documentUrl: documentUrl(map, theme), deferFontClosure: true,
      });
      if (preflight.length) {
        issues.push(...preflight.map((issue) => withContext(issue, map, theme)));
        continue;
      }
      const metadata = {...original.metadata};
      const faces = getTileflowStyleFontFaces(original);
      const nativeFaces: Record<string, string> = {};
      for (const face of faces) {
        const asset = assets.find((item) => item.fileName.startsWith('fonts/') &&
          (face.source === item.fileName || face.source.endsWith(`/${item.fileName}`)));
        if (!asset || !isNativeFontAsset(asset)) {
          issues.push(withContext(createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'), map, theme));
          continue;
        }
        if (Object.hasOwn(nativeFaces, face.family)) {
          issues.push(withContext(createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'), map, theme));
          continue;
        }
        Object.defineProperty(nativeFaces, face.family, {value: face.source, enumerable: true});
      }
      delete metadata[tileflowStyleFontFacesMetadataKey];
      // Native's fixed Mercator projection has no GL JS projection controller to configure.
      const {projection: _projection, ...rest} = original as MapLibreStyle & {projection?: unknown};
      const style = {
        ...rest, metadata,
        ...(faces.length ? {'font-faces': nativeFaces} : {}),
      } as MapLibreStyle;
      issues.push(...validateTileflowNativeStyle(style, {
        documentUrl: documentUrl(map, theme),
      }).map((issue) => withContext(issue, map, theme)));
      result[map]![theme] = style;
    }
  }
  if (issues.length) throw new TileflowNativeCompatibilityError(issues);
  return result;
}

function isNativeFontAsset(asset: TileflowBuildAsset): boolean {
  const bytes = typeof asset.source === 'string' ? Buffer.from(asset.source) : asset.source;
  if (bytes.byteLength < 12 || bytes.byteLength > tileflowNativeProfileLimits.maximumFontBytes) return false;
  const signature = Buffer.from(bytes.subarray(0, 4)).toString('hex');
  if (!/\.(?:ttf|otf)$/u.test(asset.fileName) || !['00010000', '4f54544f'].includes(signature)) return false;
  const expectedHash = /-([a-f0-9]{64})\.(?:ttf|otf)$/u.exec(asset.fileName)?.[1];
  return expectedHash === createHash('sha256').update(bytes).digest('hex');
}

/** Recheck the final generation URLs after content-addressed paths have been inserted. */
export function assertTileflowNativeGeneratedStyle(style: MapLibreStyle, map: string, theme: string): void {
  const issues = validateTileflowNativeStyle(style, {documentUrl: documentUrl(map, theme)});
  if (issues.length) {
    throw new TileflowNativeCompatibilityError(issues.map((issue) => withContext(issue, map, theme)));
  }
}

/** Retarget only owned native font sources when the common generation writer adds its prefix. */
export function replaceTileflowNativeFontSources(style: MapLibreStyle, replace: (source: string) => string): MapLibreStyle {
  const faces = (style as MapLibreStyle & {'font-faces'?: Record<string, string>})['font-faces'];
  if (!faces) return style;
  return {...style, 'font-faces': Object.fromEntries(Object.entries(faces).map(([name, source]) => [name, replace(source)]))} as MapLibreStyle;
}

/** The shared compiler owns pixels; verify the generated density pair using its existing limits. */
function validNativeSprites(map: string, assets: readonly TileflowBuildAsset[]): boolean {
  const prefix = `icons/${map}/`;
  const files = assets.filter((asset) => asset.fileName.startsWith(prefix));
  if (!files.length) return true;
  try {
    if (files.length !== 4) return false;
    let totalBytes = 0;
    const indexes: string[][] = [];
    for (const ratio of [1, 2] as const) {
      const suffix = ratio === 1 ? '' : '@2x';
      const image = files.find((asset) => asset.fileName === `${prefix}sprite${suffix}.png`);
      const index = files.find((asset) => asset.fileName === `${prefix}sprite${suffix}.json`);
      if (!image || !index) return false;
      const imageBytes = Buffer.from(typeof image.source === 'string' ? new TextEncoder().encode(image.source) : image.source);
      const indexBytes = Buffer.from(typeof index.source === 'string' ? new TextEncoder().encode(index.source) : index.source);
      for (const bytes of [imageBytes, indexBytes]) {
        if (bytes.length > tileflowIconPackageLimits.maxGeneratedFileBytes) return false;
        totalBytes += bytes.length;
      }
      if (imageBytes.length < 33 || imageBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        imageBytes.toString('ascii', 12, 16) !== 'IHDR') return false;
      const width = imageBytes.readUInt32BE(16);
      const height = imageBytes.readUInt32BE(20);
      if (!width || !height || width > tileflowIconPackageLimits.maxAtlasDimension ||
        height > tileflowIconPackageLimits.maxAtlasDimension) return false;
      const data = JSON.parse(indexBytes.toString('utf8')) as Record<string, Record<string, unknown>>;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      const names = Object.keys(data).sort();
      if (!names.length || names.length > tileflowIconPackageLimits.maxIconCount) return false;
      indexes.push(names);
      for (const name of names) {
        if (!tileflowIconIdPattern.test(name)) return false;
        const entry = data[name];
        if (!entry || entry.pixelRatio !== ratio) return false;
        const {x, y, width: w, height: h} = entry;
        if (![x, y, w, h].every((value) => typeof value === 'number' && Number.isSafeInteger(value))) return false;
        if ((x as number) < 0 || (y as number) < 0 || (w as number) <= 0 || (h as number) <= 0 ||
          (x as number) + (w as number) > width || (y as number) + (h as number) > height) return false;
      }
    }
    return totalBytes <= tileflowIconPackageLimits.maxGeneratedPackageBytes &&
      JSON.stringify(indexes[0]) === JSON.stringify(indexes[1]);
  } catch {
    return false;
  }
}
