import {createHash} from 'node:crypto';
import type {MapLibreStyle, TileflowFontFallback} from '@tileflow/core';
import {
  officialFontFiles,
  tileflowFontFallbackMetadataKey,
  tileflowOfficialFontAssetSet,
} from '@tileflow/core/build';

export type FallbackFontFile = {family: string; source: string; sha256: string; ranges: string[]};

/** Only actual text-font slots are visited; expressions and application data keep their meaning. */
export function mapFontStacks(
  style: MapLibreStyle,
  convert: (fonts: string[]) => string[],
): MapLibreStyle {
  const fonts = (value: unknown) => {
    const literal = Array.isArray(value) && value[0] === 'literal';
    const stack = literal ? value[1] : value;
    if (!Array.isArray(stack) || !stack.length || !stack.every((name) => typeof name === 'string'))
      throw new TypeError('Font fallback requires static text-font arrays.');
    const mapped = convert(stack);
    return literal ? ['literal', mapped] : mapped;
  };
  const text = (value: unknown): unknown => {
    if (!Array.isArray(value) || value[0] === 'literal') return value;
    return value.map((entry, index) => {
      if (
        value[0] === 'format' &&
        index > 0 &&
        index % 2 === 0 &&
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
      ) {
        return 'text-font' in entry ? {...entry, 'text-font': fonts(entry['text-font'])} : entry;
      }
      return text(entry);
    });
  };
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const layout = layer.layout as Record<string, unknown> | undefined;
      if (!layout) return layer;
      return {
        ...layer,
        layout: {
          ...layout,
          ...(layout['text-font'] === undefined ? {} : {'text-font': fonts(layout['text-font'])}),
          ...(layout['text-field'] === undefined ? {} : {'text-field': text(layout['text-field'])}),
        },
      };
    }),
  };
}

export function prepareFontFallback(
  style: MapLibreStyle,
  fallback: TileflowFontFallback,
  files: readonly FallbackFontFile[],
  apiBaseUrl?: string,
): MapLibreStyle {
  const byName = new Map(files.map((file) => [file.family, file]));
  const official = new Set(
    tileflowOfficialFontAssetSet.manifest.fontFaces.map((face) => face.name),
  );
  const usedOfficial = new Set<string>();
  const faces: Record<string, {url: string; 'unicode-range': string[]}[]> = {};
  const prepared = mapFontStacks(style, (stack) => {
    const local: FallbackFontFile[] = [];
    const upstream: string[] = [];
    for (const name of stack) {
      const file = byName.get(name);
      if (file) {
        if (upstream.length)
          throw new TypeError('Local fonts must precede official fonts in a fallback stack.');
        local.push(file);
      } else if (official.has(name)) upstream.push(name);
      else throw new TypeError(`No local or declared official font provides "${name}".`);
    }
    const backup = [...new Set([...upstream, ...fallback.fontStack])];
    for (const name of backup) usedOfficial.add(name);
    if (local.length > 8)
      throw new RangeError('A mixed stack accepts at most eight local font files.');
    const identity = createHash('sha256')
      .update(
        JSON.stringify([
          local.map(({family, sha256}) => [family, sha256]),
          fallback.assetSetSha256,
          backup,
        ]),
      )
      .digest('hex');
    const alias = `Tileflow fallback ${identity}`;
    faces[alias] = [
      ...local.map(({source, ranges}) => ({url: source, 'unicode-range': ranges})),
      ...officialFontFiles({...fallback, fontStack: backup}, apiBaseUrl),
    ];
    return [alias];
  });
  // Keep declared names usable by runtime label/overlay operations as well as compiled stacks.
  const namedFaces = new Map(
    files.map((file) => [file.family, [{url: file.source, 'unicode-range': file.ranges}]]),
  );
  for (const name of usedOfficial)
    namedFaces.set(name, [
      ...(namedFaces.get(name) ?? []),
      ...officialFontFiles({...fallback, fontStack: [name]}, apiBaseUrl),
    ]);
  const allFaces = Object.fromEntries([...namedFaces, ...Object.entries(faces)]);
  const usedUrls = new Set(
    Object.values(allFaces).flatMap((files) => files.map((file) => file.url)),
  );
  const officialBase = new URL('../', officialFontFiles(fallback, apiBaseUrl)[0]!.url);
  const {glyphs: _glyphs, ...rest} = prepared;
  return {
    ...rest,
    ...(Object.keys(allFaces).length ? {'font-faces': allFaces} : {}),
    metadata: {
      ...prepared.metadata,
      [tileflowFontFallbackMetadataKey]: 1,
      'tileflow:fontLicenses': [
        ...((prepared.metadata?.['tileflow:fontLicenses'] as string[] | undefined) ?? []),
        ...new Set(
          tileflowOfficialFontAssetSet.manifest.fontFaces.flatMap((face) =>
            face.files
              .filter((file) => usedUrls.has(new URL(file.path, officialBase).href))
              .map((file) => new URL(file.licensePath, officialBase).href),
          ),
        ),
      ],
    },
  };
}

/** Apply the artifact writer's local/shared policy to declared license URLs as well. */
export function replaceFontLicenseSources(
  style: MapLibreStyle,
  replace: (source: string) => string,
): MapLibreStyle {
  const licenses = style.metadata?.['tileflow:fontLicenses'];
  if (!Array.isArray(licenses)) return style;
  return {
    ...style,
    metadata: {
      ...style.metadata,
      'tileflow:fontLicenses': licenses.map((url) =>
        typeof url === 'string' ? replace(url) : url,
      ),
    },
  };
}
