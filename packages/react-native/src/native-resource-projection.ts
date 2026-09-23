import {resolveTileflowNativeResourceUrl} from '@tileflow/core/native';
import type {NativeAdmissionResource} from './native-admission-contract';
import {
  hasReservedNativeContext,
  nativeResourceOrigin,
  nativeVersionedStyleMatchesMap,
  normalizeNativeResources,
} from './native-admission-url';
import {
  freezeNativePreparedJson,
  NativePreparationError,
  nativePreparationLimits,
} from './native-style-document';
import type {HostedNativeResourcePolicy, NativeSessionResourceScope} from './session-controller';

type Json = Record<string, unknown>;
type Document = Readonly<{url: string; value: Readonly<Json>; bytes: number}>;
type Ports = Readonly<{
  styleUrl: string;
  policy: HostedNativeResourcePolicy | null;
  fontFaces?: readonly Record<string, unknown>[];
  current(): boolean;
  accept(resources: readonly NativeAdmissionResource[]): Promise<unknown>;
  discriminate(url: string): string;
  read(
    url: string,
    maximumBytes: number,
    resource: NativeAdmissionResource | null,
  ): Promise<Document>;
}>;
type FontMetadata = Readonly<{
  id?: string;
  family: string;
  url: string;
  format: 'otf' | 'ttf';
  style: 'italic' | 'normal' | 'oblique';
  weight: string;
}>;
const invalid = () => new NativePreparationError();
const record = (value: unknown): value is Json =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const roots = new Set([
  'version',
  'name',
  'metadata',
  'center',
  'zoom',
  'bearing',
  'pitch',
  'sources',
  'layers',
  'sprite',
  'glyphs',
  'font-faces',
  'light',
  'transition',
  'projection',
]);
const tileKinds = new Set(['vector', 'raster', 'raster-dem']);
const fontStyles = new Set(['italic', 'normal', 'oblique']);
const fontWeights = new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900']);

function resolve(value: unknown, documentUrl: string, template?: 'tile' | 'glyphs'): string {
  if (typeof value !== 'string') throw invalid();
  const result = resolveTileflowNativeResourceUrl(value, {documentUrl, template});
  if (
    hasReservedNativeContext(result) ||
    /tf_native_|tf_public_/iu.test(decodeURIComponent(result))
  )
    throw invalid();
  return result;
}

function owned(
  url: string,
  scope: NativeSessionResourceScope,
  policy: HostedNativeResourcePolicy | null,
): NativeAdmissionResource | null {
  if (!policy || !policy.resourceOrigins.includes(nativeResourceOrigin(url))) return null;
  if (!policy.resourceScopes.includes(scope)) throw invalid();
  const path = url.slice(nativeResourceOrigin(url).length).split('?', 1)[0];
  let tilesetId: string | undefined;
  const base = /^\/base\/[0-9a-f]{64}\/(.+)$/u.exec(path)?.[1];
  if (scope === 'style') {
    const prefix = `/maps/${policy.mapId}/`;
    const legacy =
      path.startsWith(prefix) && /^[a-z0-9][a-z0-9-]{0,63}\.json$/u.test(path.slice(prefix.length));
    if (!legacy && !nativeVersionedStyleMatchesMap(url, policy.mapId)) throw invalid();
  } else if (scope === 'tilejson' || scope === 'tile') {
    const match = /^\/(?:v1\/)?tiles\/([A-Za-z0-9._:-]{1,255})\/(.+)$/u.exec(path);
    if (!match || !policy.tilesetIds.includes(match[1])) throw invalid();
    tilesetId = match[1];
    if (
      scope === 'tilejson'
        ? match[2] !== 'tiles.json'
        : !/\.(?:pbf|mvt|png|jpe?g|webp)$/u.test(match[2])
    )
      throw invalid();
  } else if (scope === 'sprite') {
    if (
      !/^\/sprites\/[A-Za-z0-9._-]{1,255}\/sprite(?:@2x)?\.(?:json|png)$/u.test(path) &&
      !(base && /^sprites\/[A-Za-z0-9._/-]+(?:@2x)?\.(?:json|png)$/u.test(base))
    )
      throw invalid();
  } else if (scope === 'glyph') {
    if (
      !/^\/fonts\/\{fontstack\}\/\{range\}\.pbf$/u.test(path) &&
      !(base && /^glyphs\/\{fontstack\}\/\{range\}\.pbf$/u.test(base))
    )
      throw invalid();
  } else if (scope === 'font') {
    if (
      !/^\/fonts\/[A-Za-z0-9._/-]+\.(?:ttf|otf)$/iu.test(path) &&
      !(base && /^fonts\/[A-Za-z0-9._/-]+\.(?:ttf|otf)$/iu.test(base))
    )
      throw invalid();
  } else throw invalid();
  return {url, scope, ...(tilesetId === undefined ? {} : {tilesetId})};
}

function fontStacks(layers: unknown[]): readonly string[] {
  const stacks = new Set<string>();
  const collect = (value: unknown): void => {
    if (!Array.isArray(value) || value.length === 0) throw invalid();
    if (value[0] === 'literal') {
      if (value.length !== 2) throw invalid();
      collect(value[1]);
      return;
    }
    if (value[0] === 'case') {
      if (value.length < 4 || value.length % 2 !== 0) throw invalid();
      for (let index = 2; index < value.length - 1; index += 2) collect(value[index]);
      collect(value[value.length - 1]);
      return;
    }
    if (value[0] === 'match') {
      if (value.length < 5 || value.length % 2 !== 1) throw invalid();
      for (let index = 3; index < value.length - 1; index += 2) collect(value[index]);
      collect(value[value.length - 1]);
      return;
    }
    if (value[0] === 'step') {
      for (let index = 2; index < value.length; index += 2) collect(value[index]);
      return;
    }
    if (value[0] === 'coalesce') {
      for (const candidate of value.slice(1)) collect(candidate);
      return;
    }
    if (
      ['get', 'var', 'let', 'at', 'array', 'concat', 'slice', 'to-string'].includes(
        String(value[0]),
      )
    )
      throw invalid();
    if (
      value.some(
        (part) =>
          typeof part !== 'string' || !part.length || part !== part.trim() || part.includes(','),
      )
    )
      throw invalid();
    stacks.add(value.join(','));
    if (stacks.size > nativePreparationLimits.fontFaces) throw invalid();
  };
  const inline = (value: unknown): void => {
    if (!Array.isArray(value) || value[0] === 'literal') return;
    for (const item of value) {
      if (record(item) && item['text-font'] !== undefined) collect(item['text-font']);
      else if (Array.isArray(item)) inline(item);
    }
  };
  for (const layer of layers) {
    if (!record(layer) || !record(layer.layout) || layer.layout['text-field'] === undefined)
      continue;
    collect(layer.layout['text-font']);
    inline(layer.layout['text-field']);
  }
  return Object.freeze([...stacks].sort());
}

function suffix(url: string, extension: string): string {
  const query = url.indexOf('?');
  return query < 0 ? `${url}${extension}` : `${url.slice(0, query)}${extension}${url.slice(query)}`;
}

function fontFormat(url: string): 'otf' | 'ttf' {
  const pathname = url.split('?', 1)[0].toLowerCase();
  if (pathname.endsWith('.ttf')) return 'ttf';
  if (pathname.endsWith('.otf')) return 'otf';
  throw invalid();
}

function fontMetadata(
  input: readonly Record<string, unknown>[] | undefined,
): readonly FontMetadata[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > nativePreparationLimits.fontFaces) throw invalid();
  const result: FontMetadata[] = [];
  for (const value of input) {
    if (!record(value)) throw invalid();
    const keys = Reflect.ownKeys(value);
    if (
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['id', 'family', 'url', 'source', 'format', 'style', 'weight'].includes(key),
      ) ||
      keys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !('value' in descriptor);
      })
    )
      throw invalid();
    if ((value.url === undefined) === (value.source === undefined)) throw invalid();
    const rawUrl = value.url ?? value.source;
    if (
      typeof rawUrl !== 'string' ||
      typeof value.family !== 'string' ||
      value.family.length === 0 ||
      value.family.length > 256 ||
      value.family !== value.family.trim() ||
      (value.id !== undefined &&
        (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 256))
    )
      throw invalid();
    const url = resolve(rawUrl, rawUrl);
    const format = fontFormat(url);
    if (value.format !== undefined && value.format !== format) throw invalid();
    const style = value.style ?? 'normal';
    const weight = value.weight ?? '400';
    if (!fontStyles.has(String(style)) || !fontWeights.has(String(weight))) throw invalid();
    result.push(
      Object.freeze({
        ...(value.id === undefined ? {} : {id: value.id as string}),
        family: value.family,
        url,
        format,
        style: style as FontMetadata['style'],
        weight: String(weight),
      }),
    );
  }
  return Object.freeze(result);
}

function validateFontFaces(
  faces: Json,
  documentUrl: string,
  metadata: readonly FontMetadata[],
  add: (resource: NativeAdmissionResource | null) => void,
  rewrites: Array<() => void>,
  policy: HostedNativeResourcePolicy | null,
  discriminate: (url: string) => string,
): void {
  if (Object.keys(faces).length > nativePreparationLimits.fontFaces) throw invalid();
  let count = 0;
  const matched = new Set<FontMetadata>();
  for (const name of Object.keys(faces).sort()) {
    if (name.length === 0 || name.length > 256 || name !== name.trim()) throw invalid();
    const definitions = faces[name];
    if (!Array.isArray(definitions) || definitions.length === 0) throw invalid();
    const rewritten: Json[] = [];
    for (const definition of definitions) {
      if (++count > nativePreparationLimits.fontFaces || !record(definition)) throw invalid();
      const keys = Object.keys(definition).sort();
      if (
        keys.length !== 4 ||
        !['font-family', 'font-style', 'font-weight', 'url'].every((key) => keys.includes(key))
      )
        throw invalid();
      if (
        typeof definition['font-family'] !== 'string' ||
        !fontStyles.has(String(definition['font-style'])) ||
        typeof definition['font-weight'] !== 'number' ||
        !Number.isInteger(definition['font-weight']) ||
        !fontWeights.has(String(definition['font-weight']))
      )
        throw invalid();
      const url = resolve(definition.url, documentUrl);
      const format = fontFormat(url);
      const expected = metadata.filter(
        (item) =>
          (item.id === undefined || item.id === name) &&
          item.url === url &&
          item.format === format &&
          item.family === definition['font-family'] &&
          item.style === definition['font-style'] &&
          item.weight === String(definition['font-weight']),
      );
      if (metadata.length > 0 && expected.length !== 1) throw invalid();
      if (expected[0]) matched.add(expected[0]);
      const resource = owned(url, 'font', policy);
      add(resource);
      rewritten.push({...definition, url: resource ? discriminate(url) : url});
    }
    rewrites.push(() => {
      faces[name] = rewritten;
    });
  }
  if (metadata.length > 0 && matched.size !== metadata.length) throw invalid();
}

/** One style and one TileJSON edge per source; no recursive document discovery. */
export async function projectNativeResources(ports: Ports) {
  const resources = new Map<string, NativeAdmissionResource>();
  const documents = new Map<string, Promise<Document>>();
  let totalBytes = 0;
  const current = () => {
    if (!ports.current()) throw invalid();
  };
  const add = (resource: NativeAdmissionResource | null): void => {
    if (!resource) return;
    const entry = normalizeNativeResources([resource])[0];
    const previous = resources.get(entry.url);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw invalid();
    resources.set(entry.url, entry);
    if (resources.size > 128) throw invalid();
  };
  const accept = async () => {
    current();
    if (resources.size) await ports.accept(Object.freeze([...resources.values()]));
    current();
  };
  const read = async (url: string, scope: 'style' | 'tilejson'): Promise<Document> => {
    const existing = documents.get(url);
    if (existing) return existing;
    if (documents.size >= nativePreparationLimits.documents) throw invalid();
    const resource = owned(url, scope, ports.policy);
    add(resource);
    const result = Promise.resolve().then(async () => {
      await accept();
      const document = await ports.read(
        url,
        scope === 'style'
          ? nativePreparationLimits.styleBytes
          : nativePreparationLimits.tileJsonBytes,
        resource,
      );
      current();
      if (
        resolve(document.url, url) !== document.url ||
        nativeResourceOrigin(document.url) !== nativeResourceOrigin(url)
      )
        throw invalid();
      if (resource && document.url !== url) throw invalid();
      totalBytes += document.bytes;
      if (
        !Number.isSafeInteger(document.bytes) ||
        document.bytes < 0 ||
        totalBytes > nativePreparationLimits.totalBytes
      )
        throw invalid();
      return document;
    });
    documents.set(url, result);
    return result;
  };
  try {
    current();
    const metadata = fontMetadata(ports.fontFaces);
    const styleUrl = resolve(ports.styleUrl, ports.styleUrl);
    const document = await read(styleUrl, 'style');
    const style = JSON.parse(JSON.stringify(document.value)) as Json;
    if (
      style.version !== 8 ||
      !record(style.sources) ||
      !Array.isArray(style.layers) ||
      Object.keys(style).some((key) => !roots.has(key)) ||
      Object.keys(style.sources).length > nativePreparationLimits.sources ||
      style.layers.length > nativePreparationLimits.layers
    )
      throw invalid();
    const rewrites: Array<() => void> = [];
    for (const sourceId of Object.keys(style.sources).sort()) {
      const source = style.sources[sourceId];
      if (!record(source) || typeof source.type !== 'string') throw invalid();
      if (tileKinds.has(source.type)) {
        let declaringUrl = document.url;
        if (source.url !== undefined) {
          if (source.tiles !== undefined) throw invalid();
          const url = resolve(source.url, document.url);
          const tileJson = await read(url, 'tilejson');
          if (tileJson.value.url !== undefined || !Array.isArray(tileJson.value.tiles))
            throw invalid();
          declaringUrl = tileJson.url;
          delete source.url;
          for (const key of ['tiles', 'bounds', 'minzoom', 'maxzoom', 'scheme', 'attribution']) {
            if (source[key] === undefined && tileJson.value[key] !== undefined)
              source[key] = JSON.parse(JSON.stringify(tileJson.value[key]));
          }
        }
        if (!Array.isArray(source.tiles) || source.tiles.length < 1 || source.tiles.length > 16)
          throw invalid();
        const tiles = source.tiles.map((entry: unknown) => {
          const url = resolve(entry, declaringUrl, 'tile');
          const resource = owned(url, 'tile', ports.policy);
          add(
            resource
              ? {...resource, ...(url.includes('{') ? {template: 'tile' as const} : {})}
              : null,
          );
          return {url, protected: resource !== null};
        });
        rewrites.push(() => {
          source.tiles = tiles.map((tile) =>
            tile.protected ? ports.discriminate(tile.url) : tile.url,
          );
        });
      } else if (source.type === 'geojson') {
        if (typeof source.data === 'string') {
          const url = resolve(source.data, document.url);
          if (ports.policy?.resourceOrigins.includes(nativeResourceOrigin(url))) throw invalid();
          source.data = url;
        } else if (!record(source.data)) throw invalid();
      } else if (source.type === 'image') {
        const url = resolve(source.url, document.url);
        if (ports.policy?.resourceOrigins.includes(nativeResourceOrigin(url))) throw invalid();
        source.url = url;
      } else throw invalid();
    }
    if (style.sprite !== undefined) {
      const base = resolve(style.sprite, document.url);
      let protectedSprite = false;
      for (const extension of ['.json', '.png', '@2x.json', '@2x.png']) {
        const resource = owned(suffix(base, extension), 'sprite', ports.policy);
        add(resource);
        protectedSprite ||= resource !== null;
      }
      rewrites.push(() => {
        style.sprite = protectedSprite ? ports.discriminate(base) : base;
      });
    }
    const stacks = fontStacks(style.layers);
    if (style.glyphs !== undefined) {
      const url = resolve(style.glyphs, document.url, 'glyphs');
      const resource = owned(url, 'glyph', ports.policy);
      if (resource) {
        if (!stacks.length) throw invalid();
        add({...resource, template: 'glyphs', fontStacks: stacks});
      }
      rewrites.push(() => {
        style.glyphs = resource ? ports.discriminate(url) : url;
      });
    }
    const faces = style['font-faces'];
    if (faces !== undefined) {
      if (!record(faces)) throw invalid();
      validateFontFaces(
        faces,
        document.url,
        metadata,
        add,
        rewrites,
        ports.policy,
        ports.discriminate,
      );
    } else if (metadata.length) throw invalid();
    if (
      stacks.length &&
      style.glyphs === undefined &&
      (!record(faces) ||
        stacks.some((stack) => stack.split(',').some((name) => !Object.hasOwn(faces, name))))
    )
      throw invalid();
    await accept();
    for (const rewrite of rewrites) rewrite();
    current();
    return Object.freeze({
      style: freezeNativePreparedJson(style),
      resources: Object.freeze([...resources.values()]),
    });
  } catch {
    throw invalid();
  }
}
