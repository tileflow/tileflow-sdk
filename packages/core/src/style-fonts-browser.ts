/** Style font loading for Tileflow maps. Internal to Tileflow's map packages. */
import {readBoundedTileflowBrowserResource} from './browser-resource';
import {getTileflowStyleFontFaces, type TileflowStyleFontFace} from './runtime';
import type {MapLibreStyle} from './types';

export type TileflowStyleFontLoadOptions = {
  /** Already resolved manifest metadata. An explicit empty array avoids fetching the style. */
  fontFaces?: readonly TileflowStyleFontFace[];
  fetch?: typeof globalThis.fetch;
};

const maximumTileflowFontBytes = 1024 * 1024;
const maximumTileflowFontStyleBytes = 4 * 1024 * 1024;
const loadedTileflowFontFaces = new Map<string, Promise<void>>();

/** Loads content-addressed style font faces before MapLibre starts shaping labels. */
export async function loadTileflowStyleFonts(
  style: MapLibreStyle | string,
  options: TileflowStyleFontLoadOptions = {},
): Promise<void> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const styleUrl = typeof style === 'string' ? resolveTileflowBrowserResourceUrl(style) : undefined;
  const fontFaces =
    options.fontFaces === undefined
      ? typeof style === 'string'
        ? await fetchTileflowStyleFontFaces(styleUrl!, fetcher)
        : getTileflowStyleFontFaces(style)
      : getTileflowStyleFontFaces({
          metadata: {'tileflow:fontFaces': [...options.fontFaces]},
        });

  if (fontFaces.length === 0) return;

  const browser = globalThis as typeof globalThis & {
    FontFace?: new (
      family: string,
      source: ArrayBuffer,
      descriptors?: {style?: string; weight?: string},
    ) => {load(): Promise<unknown>};
    document?: {baseURI?: string; fonts?: {add(face: unknown): unknown}};
  };
  const FontFaceConstructor = browser.FontFace;
  const fontSet = browser.document?.fonts;
  if (!FontFaceConstructor || !fontSet) {
    throw new Error('Tileflow web fonts require the browser FontFace API.');
  }

  await Promise.all(
    fontFaces.map(async (definition) => {
      const source = resolveTileflowBrowserResourceUrl(definition.source, styleUrl);
      const key = `${definition.family}\0${source}\0${definition.style ?? ''}\0${definition.weight ?? ''}`;
      let loaded = loadedTileflowFontFaces.get(key);
      if (!loaded) {
        loaded = loadTileflowFontFace(
          definition,
          source,
          fetcher,
          FontFaceConstructor,
          fontSet,
        ).catch((error: unknown) => {
          loadedTileflowFontFaces.delete(key);
          throw error;
        });
        loadedTileflowFontFaces.set(key, loaded);
      }
      await loaded;
    }),
  );
}

async function fetchTileflowStyleFontFaces(
  styleUrl: string,
  fetcher: typeof globalThis.fetch,
): Promise<TileflowStyleFontFace[]> {
  const response = await fetcher(styleUrl, {
    cache: 'default',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Tileflow style font metadata failed: ${response.status}`);
  const source = await readBoundedTileflowBrowserResource(
    response,
    maximumTileflowFontStyleBytes,
    'Tileflow style font metadata',
  );
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(source));
  } catch {
    throw new Error('Tileflow style font metadata is not valid JSON.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tileflow style font metadata is invalid.');
  }
  return getTileflowStyleFontFaces(input as Pick<MapLibreStyle, 'metadata'>);
}

async function loadTileflowFontFace(
  definition: TileflowStyleFontFace,
  source: string,
  fetcher: typeof globalThis.fetch,
  FontFaceConstructor: new (
    family: string,
    source: ArrayBuffer,
    descriptors?: {style?: string; weight?: string},
  ) => {load(): Promise<unknown>},
  fontSet: {add(face: unknown): unknown},
): Promise<void> {
  const response = await fetcher(source, {
    cache: 'force-cache',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Tileflow font failed: ${response.status}`);
  const bytes = await readBoundedTileflowBrowserResource(
    response,
    maximumTileflowFontBytes,
    'Tileflow font',
  );
  const fontFace = new FontFaceConstructor(definition.family, bytes.buffer as ArrayBuffer, {
    ...(definition.style ? {style: definition.style} : {}),
    ...(definition.weight ? {weight: definition.weight} : {}),
  });
  await fontFace.load();
  fontSet.add(fontFace);
}

function resolveTileflowBrowserResourceUrl(value: string, baseUrl?: string): string {
  const browser = globalThis as typeof globalThis & {document?: {baseURI?: string}};
  const base = baseUrl ?? browser.document?.baseURI ?? 'http://localhost/';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new TypeError('Tileflow font resource URL is invalid.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError('Tileflow font resource URL is invalid.');
  }
  return url.toString();
}
