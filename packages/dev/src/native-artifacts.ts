import {
  convertFilter,
  type FilterSpecification,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import {createHash} from 'node:crypto';
import {
  getTileflowStyleFontFaces,
  type MapLibreStyle,
  serializeCanonicalJson,
  tileflowIconIdPattern,
  tileflowIconPackageLimits,
  tileflowStyleFontFacesMetadataKey,
} from '@tileflow/core';
import {isOfficialFontFile} from '@tileflow/core/build';
import type {TileflowBuildCatalog, TileflowBuildStyles} from '@tileflow/core/build';
import {
  createTileflowNativeDiagnostic,
  type TileflowNativeBuildRecord,
  TileflowNativeCompatibilityError,
  type TileflowNativeDiagnostic,
  tileflowNativeProfileLimits,
  validateTileflowNativePreparedStyle,
  validateTileflowNativeStyle,
} from '@tileflow/core/native-profile';
import {replaceFontLicenseSources} from './font-fallback';
import {tileflowIconAttributionDirectory} from './icon-attribution';
import type {TileflowBuildAsset} from './icons';
import {
  degradeTileflowNativeStyle,
  NativeDegradationError,
  type NativeDegradedStyle,
} from './native-degradations';
import {tileflowNativeFontUnicodeRanges} from './native-font-ranges';
import {rebindNativeLayerReferences} from './native-layer-references';
import {lowerNativeStyleRepresentation, NativeLoweringError} from './native-lowering';

type TileflowNativeStyleTransformation = TileflowNativeBuildRecord['transformations'][number];

/** Omitting the origin keeps every absolute HTTP resource outside the native-v1 profile. */
export type TileflowNativeArtifactUrlPolicy = Readonly<{
  /** The exact HTTP origin serving a local native preview; it is never inferred. */
  developmentOrigin?: string;
  apiBaseUrl?: string;
}>;

/** No delivery URL is inferred: this non-routable base is used only to check relative URL syntax. */
function documentUrl(map: string, theme: string): string {
  return `https://artifacts.invalid/native/styles/${map}/${theme}.json`;
}

function urlOptions(map: string, theme: string, policy: TileflowNativeArtifactUrlPolicy) {
  return {
    documentUrl: documentUrl(map, theme),
    ...(policy.developmentOrigin === undefined
      ? {}
      : {developmentOrigin: policy.developmentOrigin}),
  };
}

function withContext(
  issue: TileflowNativeDiagnostic,
  map: string,
  theme: string,
): TileflowNativeDiagnostic {
  const prefix = `/maps/${map}/themes/${theme}/style`;
  return {...issue, path: prefix.length + issue.path.length <= 300 ? prefix + issue.path : prefix};
}

/**
 * Lower only the native representation; shared compilation and authored map identity stay intact.
 * What native maps cannot draw is left out or replaced and recorded first (see
 * `degradeTileflowNativeStyle`); every other unsupported value still fails. Local artifacts and
 * Hosted publication both receive styles whose layer references are rebound.
 */
export function lowerTileflowNativeCompiledStyles(
  input: TileflowBuildStyles,
  policy: TileflowNativeArtifactUrlPolicy = {},
): {
  styles: TileflowBuildStyles;
  transformations: TileflowNativeStyleTransformation[];
} {
  const styles: TileflowBuildStyles = {};
  const transformations: TileflowNativeStyleTransformation[] = [];
  for (const map of Object.keys(input).sort()) {
    styles[map] = {};
    for (const theme of Object.keys(input[map]!).sort()) {
      const web = input[map]![theme]!;
      let degraded: NativeDegradedStyle | undefined;
      // Diagnostics name the web style's layers, not the degraded style's positions.
      const context = (issue: TileflowNativeDiagnostic) =>
        withContext(webLayerPath(issue, degraded), map, theme);
      try {
        degraded = degradeTileflowNativeStyle(web);
        const original = degraded.style;
        const options = {...urlOptions(map, theme, policy), deferFontClosure: true};
        const pending = validateTileflowNativeStyle(original, options);
        // Only these representation-level diagnostics may be deferred. Bounds, source protocols,
        // other style properties and the final native validation are never bypassed.
        const blockers = pending.filter(
          (issue) =>
            issue.code !== 'NATIVE_UNSUPPORTED_STYLE' ||
            !(
              issue.path === '/projection' ||
              issue.path === '/sky' ||
              /^\/layers\/\d+\/(?:layout\/line-cap|paint\/line-dasharray)(?:\/|$)/u.test(
                issue.path,
              ) ||
              /^\/layers\/\d+\/layout\/(?:icon|text)-overlap$/u.test(issue.path)
            ),
        );
        if (blockers.length) throw new TileflowNativeCompatibilityError(blockers.map(context));
        const syntax = validateStyleMin(JSON.parse(serializeCanonicalJson(original)));
        if (syntax.length)
          throw new TileflowNativeCompatibilityError(
            syntax.map((issue) => {
              const match =
                /^layers\[(\d+)\]\.(layout\.line-cap|paint\.line-dasharray)(?=[:.[]|$)/u.exec(
                  issue.message,
                );
              const path = match
                ? `/layers/${match[1]}/${match[2]!.replace('.', '/')}`
                : issue.message.startsWith('projection')
                  ? '/projection'
                  : '';
              return context(createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', path));
            }),
          );
        const lowered = lowerNativeStyleRepresentation(original, (filter) =>
          convertFilter(structuredClone(filter) as FilterSpecification),
        );
        // Expanded line layers shift every later index, so POI priorities and overlay anchors
        // must name the physical layers before validation, hashing or any artifact consumer.
        const style = rebindNativeLayerReferences(
          original,
          lowered.style as unknown as MapLibreStyle,
          lowered.layers,
        );
        if (!style)
          throw new TileflowNativeCompatibilityError([
            withContext(
              {
                ...createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', '/metadata'),
                message:
                  'Tileflow POI interaction or overlay placement metadata does not match the compiled layers.',
                suggestion:
                  'Rebuild with the Tileflow compiler; native lowering only rebinds POI priorities and overlay anchors that match the compiled layer order.',
              },
              map,
              theme,
            ),
          ]);
        const issues = validateTileflowNativePreparedStyle(style, options);
        if (issues.length) throw new TileflowNativeCompatibilityError(issues.map(context));
        styles[map]![theme] = style;
        // Spans name web input layers and native output layers.
        const inputIndexes = degraded.inputIndexes;
        const added = (before: number) =>
          lowered.layers
            .filter((span) => span.inputLayer < before)
            .reduce((total, span) => total + span.outputCount - 1, 0);
        transformations.push({
          map,
          theme,
          inputStyleSha256: createHash('sha256').update(serializeCanonicalJson(web)).digest('hex'),
          loweredStyleSha256: createHash('sha256')
            .update(serializeCanonicalJson(style))
            .digest('hex'),
          inputLayers: web.layers.length,
          outputLayers: lowered.outputLayers,
          projection: lowered.projection,
          ...(lowered.sky ? {sky: lowered.sky} : {}),
          removedLayers: degraded.removedLayers,
          insertedLayers: inputIndexes.flatMap((index, position) =>
            index < 0 ? [position + added(position)] : [],
          ),
          layers: lowered.layers.map((span) => ({
            ...span,
            inputLayer: inputIndexes[span.inputLayer]!,
          })),
          symbolOverlap: lowered.symbolOverlap.map((entry) => ({
            ...entry,
            inputLayer: inputIndexes[entry.inputLayer]!,
          })),
          degradations: degraded.degradations.map((record) => record.id),
        });
      } catch (error) {
        if (error instanceof NativeDegradationError)
          throw new TileflowNativeCompatibilityError([
            withContext(
              {
                ...createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', error.path),
                message: error.message,
                suggestion:
                  'Keep POI layers on sources native maps can draw, or select web for this map.',
              },
              map,
              theme,
            ),
          ]);
        if (!(error instanceof NativeLoweringError)) throw error;
        throw new TileflowNativeCompatibilityError([
          context({
            ...createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', error.path),
            message: error.message,
            suggestion:
              error.reason === 'budget'
                ? 'Reduce the decision expansion or style size; native lowering never raises its resource limits automatically.'
                : error.path === '/projection'
                  ? 'Use a fixed globe or Mercator projection for native-v1; adaptive projections are not supported.'
                  : 'Use finite case/match/step decisions with constant leaves and supported scalar predicates, or select web.',
          }),
        ]);
      }
    }
  }
  return {styles, transformations};
}

/** A diagnostic on a degraded style's layer, pointed at the same layer of the web style. */
function webLayerPath(
  issue: TileflowNativeDiagnostic,
  degraded: NativeDegradedStyle | undefined,
): TileflowNativeDiagnostic {
  const match = /^\/layers\/(\d+)(?=\/|$)/u.exec(issue.path);
  const index = match && degraded ? degraded.inputIndexes[Number(match[1])] : undefined;
  if (!match || index === undefined || index < 0) return issue;
  return {...issue, path: `/layers/${index}${issue.path.slice(match[0].length)}`};
}

/** Check lowered compiler output before local snapshots. Raw inputs are gated before lowering. */
export function assertTileflowNativeCompiledStyles(
  project: TileflowBuildCatalog,
  styles: TileflowBuildStyles,
  policy: TileflowNativeArtifactUrlPolicy = {},
): void {
  const issues: TileflowNativeDiagnostic[] = [];
  for (const mapName of Object.keys(project.maps).sort()) {
    for (const theme of Object.keys(styles[mapName] ?? {}).sort()) {
      issues.push(
        ...validateTileflowNativePreparedStyle(styles[mapName]![theme], {
          ...urlOptions(mapName, theme, policy),
          deferFontClosure: true,
        }).map((issue) => withContext(issue, mapName, theme)),
      );
    }
  }
  if (issues.length) throw new TileflowNativeCompatibilityError(issues);
}

/** Representation-only projection after the shared icon/font/semantic compilation pipeline. */
export function prepareTileflowNativeStyles(
  input: TileflowBuildStyles,
  assets: readonly TileflowBuildAsset[],
  policy: TileflowNativeArtifactUrlPolicy = {},
): TileflowBuildStyles {
  const issues: TileflowNativeDiagnostic[] = [];
  const result: TileflowBuildStyles = {};
  const fontRanges = new Map<string, string[]>();
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
      const preflight = validateTileflowNativePreparedStyle(original, {
        ...urlOptions(map, theme, policy),
        deferFontClosure: true,
      });
      if (preflight.length) {
        issues.push(...preflight.map((issue) => withContext(issue, map, theme)));
        continue;
      }
      const metadata = {...original.metadata};
      const faces = getTileflowStyleFontFaces(original);
      const nativeFaces: Record<string, TileflowNativeFontFile[]> = {};
      for (const face of faces) {
        const asset = assets.find(
          (item) =>
            item.fileName.startsWith('fonts/') &&
            (face.source === item.fileName || face.source.endsWith(`/${item.fileName}`)),
        );
        if (!asset || !isNativeFontAsset(asset)) {
          issues.push(
            withContext(
              createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'),
              map,
              theme,
            ),
          );
          continue;
        }
        if (Object.hasOwn(nativeFaces, face.family)) {
          issues.push(
            withContext(
              createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'),
              map,
              theme,
            ),
          );
          continue;
        }
        // Each face claims only the characters its file draws, so MapLibre Native moves on to the
        // next font of a `text-font` list for the rest instead of drawing nothing.
        let ranges: string[];
        try {
          // Asset names are content-addressed, so every theme reuses one file's ranges.
          ranges =
            fontRanges.get(asset.fileName) ?? tileflowNativeFontUnicodeRanges(fontBytes(asset));
          fontRanges.set(asset.fileName, ranges);
        } catch {
          issues.push(
            withContext(
              createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'),
              map,
              theme,
            ),
          );
          continue;
        }
        Object.defineProperty(nativeFaces, face.family, {
          value: [{url: face.source, 'unicode-range': ranges}],
          enumerable: true,
        });
      }
      let preparedFaces = nativeFaces;
      if (metadata['tileflow:fontFallback'] === 1 && original['font-faces']) {
        const verifiedFiles = new Map(
          Object.values(nativeFaces)
            .flat()
            .map((file) => [file.url, file]),
        );
        preparedFaces = {};
        for (const [name, files] of Object.entries(original['font-faces'])) {
          if (
            !Array.isArray(files) ||
            files.some(
              (file) =>
                !verifiedFiles.has(file.url) && !isOfficialFontFile(file, policy.apiBaseUrl),
            )
          ) {
            issues.push(
              withContext(
                createTileflowNativeDiagnostic('NATIVE_FONT_UNAVAILABLE', '/font-faces'),
                map,
                theme,
              ),
            );
            continue;
          }
          preparedFaces[name] = files.map((file) => ({...(verifiedFiles.get(file.url) ?? file)}));
        }
      }
      delete metadata[tileflowStyleFontFacesMetadataKey];
      // Web bindings address pre-lowering physical layers; Native does not expose this controller.
      delete metadata['tileflow:colors'];
      // Native's fixed Mercator projection has no GL JS projection controller to configure.
      const {projection: _projection, ...rest} = original as MapLibreStyle & {projection?: unknown};
      const style = {
        ...rest,
        metadata,
        ...(faces.length ? {'font-faces': preparedFaces} : {}),
      } as MapLibreStyle;
      issues.push(
        ...validateTileflowNativePreparedStyle(style, urlOptions(map, theme, policy)).map((issue) =>
          withContext(issue, map, theme),
        ),
      );
      result[map]![theme] = style;
    }
  }
  if (issues.length) throw new TileflowNativeCompatibilityError(issues);
  return result;
}

/** One font file of a native `font-faces` entry. */
export type TileflowNativeFontFile = {url: string; 'unicode-range'?: string[]};

function fontBytes(asset: TileflowBuildAsset): Uint8Array {
  return typeof asset.source === 'string' ? Buffer.from(asset.source) : asset.source;
}

function isNativeFontAsset(asset: TileflowBuildAsset): boolean {
  const bytes = fontBytes(asset);
  if (bytes.byteLength < 12 || bytes.byteLength > tileflowNativeProfileLimits.maximumFontBytes)
    return false;
  const signature = Buffer.from(bytes.subarray(0, 4)).toString('hex');
  if (!/\.(?:ttf|otf)$/u.test(asset.fileName) || !['00010000', '4f54544f'].includes(signature))
    return false;
  const expectedHash = /-([a-f0-9]{64})\.(?:ttf|otf)$/u.exec(asset.fileName)?.[1];
  return expectedHash === createHash('sha256').update(bytes).digest('hex');
}

/** Recheck the final generation URLs after content-addressed paths have been inserted. */
export function assertTileflowNativeGeneratedStyle(
  style: MapLibreStyle,
  map: string,
  theme: string,
  policy: TileflowNativeArtifactUrlPolicy = {},
): void {
  const issues = validateTileflowNativePreparedStyle(style, urlOptions(map, theme, policy));
  if (issues.length) {
    throw new TileflowNativeCompatibilityError(
      issues.map((issue) => withContext(issue, map, theme)),
    );
  }
}

/** Retarget only owned native font sources when the common generation writer adds its prefix. */
export function replaceTileflowNativeFontSources(
  style: MapLibreStyle,
  replace: (source: string) => string,
): MapLibreStyle {
  const faces = (
    style as MapLibreStyle & {'font-faces'?: Record<string, string | TileflowNativeFontFile[]>}
  )['font-faces'];
  if (!faces) return style;
  return {
    ...replaceFontLicenseSources(style, replace),
    'font-faces': Object.fromEntries(
      Object.entries(faces).map(([name, files]) => [
        name,
        typeof files === 'string'
          ? replace(files)
          : files.map((file) => ({...file, url: replace(file.url)})),
      ]),
    ),
  } as MapLibreStyle;
}

/** The shared compiler owns pixels; verify the generated density pair using its existing limits. */
function validNativeSprites(map: string, assets: readonly TileflowBuildAsset[]): boolean {
  const prefix = `icons/${map}/`;
  // Required icon credits travel beside the sprite but are not part of the density pair.
  const files = assets.filter(
    (asset) =>
      asset.fileName.startsWith(prefix) &&
      !asset.fileName.startsWith(`${prefix}${tileflowIconAttributionDirectory}/`),
  );
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
      const imageBytes = Buffer.from(
        typeof image.source === 'string' ? new TextEncoder().encode(image.source) : image.source,
      );
      const indexBytes = Buffer.from(
        typeof index.source === 'string' ? new TextEncoder().encode(index.source) : index.source,
      );
      for (const bytes of [imageBytes, indexBytes]) {
        if (bytes.length > tileflowIconPackageLimits.maxGeneratedFileBytes) return false;
        totalBytes += bytes.length;
      }
      if (
        imageBytes.length < 33 ||
        imageBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        imageBytes.toString('ascii', 12, 16) !== 'IHDR'
      )
        return false;
      const width = imageBytes.readUInt32BE(16);
      const height = imageBytes.readUInt32BE(20);
      if (
        !width ||
        !height ||
        width > tileflowIconPackageLimits.maxAtlasDimension ||
        height > tileflowIconPackageLimits.maxAtlasDimension
      )
        return false;
      const data = JSON.parse(indexBytes.toString('utf8')) as Record<
        string,
        Record<string, unknown>
      >;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      const names = Object.keys(data).sort();
      if (!names.length || names.length > tileflowIconPackageLimits.maxIconCount) return false;
      indexes.push(names);
      for (const name of names) {
        if (!tileflowIconIdPattern.test(name)) return false;
        const entry = data[name];
        if (!entry || entry.pixelRatio !== ratio) return false;
        const {x, y, width: w, height: h} = entry;
        if (
          ![x, y, w, h].every((value) => typeof value === 'number' && Number.isSafeInteger(value))
        )
          return false;
        if (
          (x as number) < 0 ||
          (y as number) < 0 ||
          (w as number) <= 0 ||
          (h as number) <= 0 ||
          (x as number) + (w as number) > width ||
          (y as number) + (h as number) > height
        )
          return false;
      }
    }
    return (
      totalBytes <= tileflowIconPackageLimits.maxGeneratedPackageBytes &&
      JSON.stringify(indexes[0]) === JSON.stringify(indexes[1])
    );
  } catch {
    return false;
  }
}
