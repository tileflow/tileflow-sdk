import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  deriveTileflowLineBackgroundGlyphs,
  type MapLibreStyle,
  parseTileflowLineBackgroundFontStack,
} from '@tileflow/core';
import type {TileflowBuildStyles} from '@tileflow/core/build';

/**
 * Local glyph serving for line-fitted text backgrounds.
 *
 * A style whose text uses a derived `<stack> lines-v1-…` font stack needs a glyph provider that
 * derives those ranges. Local previews and captures route such a map's glyph URL through
 * `__glyphs/<map>/…`: ordinary stacks pass through from the map's declared provider unchanged, and
 * derived stacks are computed from their source stack's range. Production output keeps the
 * declared provider, which must serve derived stacks itself.
 */

export const tileflowLineBackgroundGlyphRoute = '__glyphs';

/** Map name to the upstream glyph URL template its styles declared. Local only; never serialized. */
export type TileflowLineBackgroundGlyphProviders = Readonly<Record<string, string>>;

export type TileflowLineBackgroundGlyphResponderOptions = {
  /** Project root; ranges are cached under `.tileflow/cache/glyphs/v1`. */
  cwd: string;
  fetch?: typeof globalThis.fetch;
};

export type TileflowLineBackgroundGlyphResponder = (
  upstream: string,
  fontStack: string,
  range: string,
) => Promise<Response>;

const RANGE = /^\d{1,6}-\d{1,6}$/u;
const FONT_STACK = /^[\p{L}\p{N} _.,-]{1,256}$/u;
const MAP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_DERIVED_ENTRIES = 512;
const CACHE_SEGMENTS = ['.tileflow', 'cache', 'glyphs', 'v1'] as const;

/** Whether a compiled style draws text with a derived line-background stack. */
export function usesTileflowLineBackgroundGlyphs(style: MapLibreStyle): boolean {
  return style.layers.some((layer) => {
    const layout = layer.layout as Record<string, unknown> | undefined;
    const font = layout?.['text-font'];
    return (
      Array.isArray(font) &&
      font.length === 1 &&
      typeof font[0] === 'string' &&
      parseTileflowLineBackgroundFontStack(font[0]) !== undefined
    );
  });
}

/**
 * Points maps that use derived stacks at the local glyph route. Only absolute HTTP(S) upstream
 * templates and asset bases are routed; anything else is left unchanged.
 */
export function prepareTileflowLineBackgroundGlyphs(
  styles: TileflowBuildStyles,
  options: {assetBaseUrl?: string},
): {providers: TileflowLineBackgroundGlyphProviders; styles: TileflowBuildStyles} {
  const base = absoluteHttpUrl(options.assetBaseUrl);
  if (!base) return {providers: {}, styles};
  const providers: Record<string, string> = {};
  const output: Record<string, Record<string, MapLibreStyle>> = {};
  for (const [mapName, themes] of Object.entries(styles)) {
    const family = Object.values(themes);
    const upstream = family.find((style) => typeof style.glyphs === 'string')?.glyphs;
    if (
      !MAP_NAME.test(mapName) ||
      !upstream ||
      !absoluteHttpUrl(upstream) ||
      !family.some(usesTileflowLineBackgroundGlyphs) ||
      family.some((style) => style.glyphs !== upstream)
    ) {
      output[mapName] = themes;
      continue;
    }
    providers[mapName] = upstream;
    const glyphs = `${base.replace(/\/+$/u, '')}/${tileflowLineBackgroundGlyphRoute}/${mapName}/{fontstack}/{range}.pbf`;
    output[mapName] = Object.fromEntries(
      Object.entries(themes).map(([themeName, style]) => [themeName, {...style, glyphs}]),
    );
  }
  return {providers, styles: output};
}

/** Parses `/__glyphs/<map>/<fontstack>/<range>.pbf` from a decoded route path. */
export function parseTileflowLineBackgroundGlyphPath(
  path: string,
): {fontStack: string; mapName: string; range: string} | undefined {
  const match = /^\/__glyphs\/([^/]+)\/([^/]+)\/([^/]+)\.pbf$/u.exec(path);
  if (!match) return undefined;
  let fontStack: string;
  try {
    fontStack = decodeURIComponent(match[2]!);
  } catch {
    return undefined;
  }
  if (!MAP_NAME.test(match[1]!) || !FONT_STACK.test(fontStack) || !RANGE.test(match[3]!)) {
    return undefined;
  }
  return {fontStack, mapName: match[1]!, range: match[3]!};
}

/**
 * Serves one glyph range for a declared upstream template. Upstream ranges are cached on disk;
 * derived ranges are recomputed from them and kept in a bounded in-memory cache.
 */
export function createTileflowLineBackgroundGlyphResponder(
  options: TileflowLineBackgroundGlyphResponderOptions,
): TileflowLineBackgroundGlyphResponder {
  const fetchRange = options.fetch ?? globalThis.fetch;
  const derived = new Map<string, Promise<Uint8Array | undefined>>();
  const upstreamRanges = new Map<string, Promise<Uint8Array | undefined>>();

  const readUpstream = (upstream: string, fontStack: string, range: string) => {
    const key = `${upstream}\n${fontStack}\n${range}`;
    let pending = upstreamRanges.get(key);
    if (!pending) {
      pending = loadUpstreamRange(options.cwd, fetchRange, upstream, fontStack, range).finally(() =>
        upstreamRanges.delete(key),
      );
      upstreamRanges.set(key, pending);
    }
    return pending;
  };

  return async (upstream, fontStack, range) => {
    if (!absoluteHttpUrl(upstream) || !FONT_STACK.test(fontStack) || !RANGE.test(range)) {
      return notFound();
    }
    const backed = parseTileflowLineBackgroundFontStack(fontStack);
    if (!backed) {
      // A derived stack cannot be combined with fallbacks; ordinary stacks pass through.
      if (fontStack.split(',').some((stack) => parseTileflowLineBackgroundFontStack(stack))) {
        return notFound();
      }
      return glyphResponse(await readUpstream(upstream, fontStack, range));
    }
    const key = `${upstream}\n${fontStack}\n${range}`;
    let pending = derived.get(key);
    if (!pending) {
      pending = readUpstream(upstream, backed.source, range).then((source) =>
        source ? deriveTileflowLineBackgroundGlyphs(source, backed.metrics) : undefined,
      );
      pending.catch(() => derived.delete(key));
      derived.set(key, pending);
      if (derived.size > MAX_DERIVED_ENTRIES) derived.delete(derived.keys().next().value!);
    }
    return glyphResponse(await pending);
  };
}

async function loadUpstreamRange(
  cwd: string,
  fetchRange: typeof globalThis.fetch,
  upstream: string,
  fontStack: string,
  range: string,
): Promise<Uint8Array | undefined> {
  const directory = await cacheDirectory(cwd, upstream);
  const file = resolve(directory, `${digest(fontStack)}-${range}.pbf`);
  const cached = await readFile(file).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (cached) return new Uint8Array(cached);

  const url = upstream
    .replace('{fontstack}', encodeURIComponent(fontStack))
    .replace('{range}', range);
  const response = await fetchRange(url, {
    credentials: 'omit',
    headers: {Accept: 'application/x-protobuf'},
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return undefined;
  if (response.status !== 200) {
    throw new Error(`Glyph provider responded ${response.status} for ${fontStack} ${range}.`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RANGE_BYTES) throw new Error(`Glyph range ${range} exceeds the size limit.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RANGE_BYTES)
    throw new Error(`Glyph range ${range} exceeds the size limit.`);

  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, {flag: 'wx'});
    await rename(temporary, file);
  } catch {
    // Caching is an optimization; a failed write never changes the served bytes.
    await rm(temporary, {force: true}).catch(() => undefined);
  }
  return bytes;
}

/** Creates `.tileflow/cache/glyphs/v1/<provider>` without following symbolic links. */
async function cacheDirectory(cwd: string, upstream: string): Promise<string> {
  let current = resolve(cwd);
  for (const segment of [...CACHE_SEGMENTS, digest(upstream)]) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Glyph cache path is unsafe: ${current}`);
      }
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
      await mkdir(current).catch((mkdirError: unknown) => {
        if (!hasCode(mkdirError, 'EEXIST')) throw mkdirError;
      });
    }
  }
  return current;
}

function glyphResponse(bytes: Uint8Array | undefined): Response {
  if (!bytes) return notFound();
  // Copy into an ArrayBuffer-backed view, as BodyInit requires.
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/x-protobuf',
    },
    status: 200,
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({error: 'Unknown glyph range.'}), {
    headers: {'Content-Type': 'application/json; charset=utf-8'},
    status: 404,
  });
}

function absoluteHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.replace('{fontstack}', 'stack').replace('{range}', '0-255'));
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
