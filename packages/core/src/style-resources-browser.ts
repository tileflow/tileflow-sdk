import {bindTileflowBrandingSources, rememberTileflowBrandingSources} from './branding';
import {readBoundedTileflowBrowserResource} from './browser-resource';
import type {TileflowRuntimeStyle} from './runtime';
import {
  createTileflowStyleFamily,
  expandTileflowFamilyTemplate,
  expandTileflowStyleFamily,
  materializeTileflowStyleFamily,
  parseTileflowStyleFamily,
  type TileflowStyleFamily,
  withTileflowFamilyTemplate,
} from './style-family';
import {prepareTileflowStyleFamilyForRendering} from './style-family-render';
import type {MapLibreStyle} from './types';

/** Request options understood by both fetch and MapLibre's transformRequest. */
type StyleResourceRequest = {
  url: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  method?: string;
  body?: string;
  cache?: RequestCache;
};

export type TileflowRuntimeStyleLoadOptions = {
  /** The declaring document URL for an inline style; otherwise defaults to document.baseURI. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** Origin of a self-hosted Tileflow API, when different from api.tileflow.dev. */
  apiUrl?: string;
  /** Use the same authentication and URL rewrite rules as the map. */
  transformRequest?: (
    url: string,
    resourceType: 'Style' | 'Source',
  ) => StyleResourceRequest | undefined | Promise<StyleResourceRequest | undefined>;
};

export type TileflowLoadedRuntimeStyle = TileflowRuntimeStyle & {style: MapLibreStyle};

/**
 * Loads a portable style before passing it to MapLibre. Each resource is resolved against the
 * document that declares it, including tiles in HTTP TileJSON documents. Inputs are not mutated.
 * Custom source protocols stay with the map's registered protocol handler.
 */
export async function loadTileflowRuntimeStyle(
  runtime: TileflowRuntimeStyle,
  options: TileflowRuntimeStyleLoadOptions = {},
): Promise<TileflowLoadedRuntimeStyle> {
  options.signal?.throwIfAborted();
  if (runtime.familyUrl && runtime.theme && !runtime.family) {
    const family = await loadTileflowRuntimeStyleFamily(runtime.familyUrl, options);
    runtime = {...runtime, family, style: materializeTileflowStyleFamily(family, runtime.theme)};
  }
  return prepareRuntimeStyle(runtime, options);
}

/** Prepare every family variant once so appearance changes and rebuilds share resolved resources. */
export async function loadTileflowRuntimeStyleFamily(
  url: string,
  options: TileflowRuntimeStyleLoadOptions = {},
): Promise<TileflowStyleFamily> {
  const owner = options.baseUrl ?? globalThis.document?.baseURI;
  const document = await loadDocument(resolveResource(url, owner), 'Style', options);
  const family = parseTileflowStyleFamily(document.value);
  const tileJSON = new Map<string, ReturnType<typeof loadDocument>>();
  const prepare = async (style: MapLibreStyle) =>
    (await prepareRuntimeStyle({style}, {...options, baseUrl: document.url}, tileJSON)).style;
  const resolved = family.updates.appearanceOnly
    ? withTileflowFamilyTemplate(
        family,
        await prepare(expandTileflowFamilyTemplate(family) as unknown as MapLibreStyle),
      )
    : createTileflowStyleFamily(
        Object.fromEntries(
          await Promise.all(
            Object.entries(expandTileflowStyleFamily(family)).map(async ([theme, style]) => [
              theme,
              await prepare(style),
            ]),
          ),
        ),
      );
  return prepareTileflowStyleFamilyForRendering(resolved);
}

async function prepareRuntimeStyle(
  runtime: TileflowRuntimeStyle,
  options: TileflowRuntimeStyleLoadOptions,
  tileJSON = new Map<string, ReturnType<typeof loadDocument>>(),
): Promise<TileflowLoadedRuntimeStyle> {
  options.signal?.throwIfAborted();
  let owner = options.baseUrl ?? globalThis.document?.baseURI;
  let input = runtime.style;
  if (typeof input === 'string') {
    const document = await loadDocument(resolveResource(input, owner), 'Style', options);
    input = document.value as MapLibreStyle;
    owner = document.url;
  }
  if (
    !isRecord(input) ||
    input.version !== 8 ||
    !isRecord(input.sources) ||
    !Array.isArray(input.layers)
  ) {
    throw new TypeError('Tileflow style is not a MapLibre style document.');
  }
  // Only copy resource-bearing branches. GeoJSON, expressions and arbitrary metadata may contain
  // strings resembling URLs, but are application data and must keep their meaning and identity.
  const style = {...input, sources: {...input.sources}} as MapLibreStyle;
  const branding = rememberTileflowBrandingSources(style, {...options, baseUrl: owner});
  const resolve = (value: string) => resolveResource(value, owner);
  if (typeof style.sprite === 'string' && style.sprite) style.sprite = resolve(style.sprite);
  else if (Array.isArray(style.sprite))
    style.sprite = style.sprite.map((sprite) => ({...sprite, url: resolve(sprite.url)}));
  if (style.glyphs) style.glyphs = resolve(style.glyphs);
  if (style['font-faces']) {
    style['font-faces'] = Object.fromEntries(
      Object.entries(style['font-faces']).map(([family, face]) => [
        family,
        typeof face === 'string' ? resolve(face) : {...face, url: resolve(face.url)},
      ]),
    );
  }
  if (style.metadata) {
    style.metadata = {...style.metadata};
    const faces = style.metadata['tileflow:fontFaces'];
    if (Array.isArray(faces))
      style.metadata['tileflow:fontFaces'] = faces.map((face: unknown) =>
        isRecord(face) && typeof face.source === 'string'
          ? {...face, source: resolve(face.source)}
          : face,
      );
    for (const key of ['tileflow:buildings', 'tileflow:vegetation']) {
      const descriptor = style.metadata[key];
      if (!isRecord(descriptor)) continue;
      const resolved = {...descriptor};
      if (Array.isArray(descriptor.models))
        resolved.models = descriptor.models.map((model: unknown) =>
          isRecord(model) && typeof model.url === 'string'
            ? {...model, url: resolve(model.url)}
            : model,
        );
      // Tree models are keyed by id, each level a file URL or text inside the style.
      else if (isRecord(descriptor.models))
        resolved.models = Object.fromEntries(
          Object.entries(descriptor.models).map(([id, model]) => [
            id,
            isRecord(model)
              ? Object.fromEntries(
                  Object.entries(model).map(([level, value]) => [
                    level,
                    isRecord(value) && typeof value.url === 'string'
                      ? {...value, url: resolve(value.url)}
                      : value,
                  ]),
                )
              : model,
          ]),
        );
      if (isRecord(descriptor.landmarks) && typeof descriptor.landmarks.url === 'string')
        resolved.landmarks = {...descriptor.landmarks, url: resolve(descriptor.landmarks.url)};
      style.metadata[key] = resolved;
    }
  }
  await Promise.all(
    Object.entries(style.sources).map(async ([id, original]) => {
      let source = {...original};
      const tiled = ['vector', 'raster', 'raster-dem'].includes(String(source.type));
      if ((tiled || source.type === 'image') && typeof source.url === 'string') {
        source.url = resolve(source.url);
        if (tiled && isHTTP(source.url as string)) {
          const url = source.url as string;
          let pending = tileJSON.get(url);
          if (!pending) {
            pending = loadDocument(url, 'Source', options);
            tileJSON.set(url, pending);
          }
          const document = await pending;
          // A request transform can delegate to a MapLibre protocol; fetch must not intercept it.
          if (document) {
            if (
              !Array.isArray(document.value.tiles) ||
              !document.value.tiles.every((tile) => typeof tile === 'string')
            )
              throw new TypeError('Tileflow TileJSON must declare a tiles array.');
            // Match MapLibre's TileJSON fields; a descriptor must not inject source options such
            // as promoteId or type. vector_layers retains MapLibre's source-layer diagnostics.
            const descriptor = Object.fromEntries(
              [
                'minzoom',
                'maxzoom',
                'attribution',
                'bounds',
                'scheme',
                'tileSize',
                'encoding',
                'vector_layers',
              ]
                .filter((key) => document.value[key] !== undefined)
                .map((key) => [key, document.value[key]]),
            );
            source = {
              ...descriptor,
              ...source,
              tiles: Array.isArray(original.tiles)
                ? original.tiles.map((tile) => (typeof tile === 'string' ? resolve(tile) : tile))
                : document.value.tiles.map((tile: string) => resolveResource(tile, document.url)),
            };
            delete source.url;
          }
        }
      }
      if (tiled && Array.isArray(original.tiles))
        source.tiles = original.tiles.map((tile) =>
          typeof tile === 'string' ? resolve(tile) : tile,
        );
      if (source.type === 'geojson' && typeof source.data === 'string')
        source.data = resolve(source.data);
      if (source.type === 'video' && Array.isArray(source.urls))
        source.urls = source.urls.map((url) => (typeof url === 'string' ? resolve(url) : url));
      style.sources[id] = source;
    }),
  );
  options.signal?.throwIfAborted();
  if (Object.keys(branding).length) bindTileflowBrandingSources(style, branding);
  return {
    ...runtime,
    style,
    ...(runtime.fontFaces
      ? {fontFaces: runtime.fontFaces.map((face) => ({...face, source: resolve(face.source)}))}
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHTTP(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function resolveResource(value: string, owner: string | undefined): string {
  // Preserve absolute URLs byte for byte, including signatures, escapes and custom protocols.
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) return value;
  // URL encodes braces in paths. Protect literal MapLibre tokens, without reviving %7B...%7D.
  const tokens: string[] = [];
  let prefix = 'tileflow-url-token-';
  while (value.includes(prefix) || owner?.includes(prefix)) prefix += '-';
  const protectedValue = value.replace(/\{[^{}]+\}/gu, (token) => {
    tokens.push(token);
    return `${prefix}${tokens.length - 1}-end`;
  });
  let result: string;
  try {
    result = new URL(protectedValue, owner).href;
  } catch {
    throw new TypeError('Relative Tileflow resources require an absolute style URL or baseUrl.');
  }
  tokens.forEach((token, index) => {
    result = result.replaceAll(`${prefix}${index}-end`, token);
  });
  return result;
}

function loadDocument(
  url: string,
  type: 'Style',
  options: TileflowRuntimeStyleLoadOptions,
): Promise<{url: string; value: Record<string, unknown>}>;
function loadDocument(
  url: string,
  type: 'Source',
  options: TileflowRuntimeStyleLoadOptions,
): Promise<{url: string; value: Record<string, unknown>} | undefined>;
async function loadDocument(
  url: string,
  type: 'Style' | 'Source',
  options: TileflowRuntimeStyleLoadOptions,
) {
  options.signal?.throwIfAborted();
  const request = await options.transformRequest?.(url, type);
  options.signal?.throwIfAborted();
  const address = request?.url ?? url;
  if (type === 'Source' && !isHTTP(address)) return undefined;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(address, {
    cache: 'default',
    credentials: 'same-origin',
    redirect: 'error',
    ...request,
    signal: options.signal,
  });
  if (!response.ok)
    throw new Error(
      `Tileflow ${type === 'Style' ? 'style' : 'TileJSON'} failed: ${response.status}`,
    );
  const bytes = await readBoundedTileflowBrowserResource(
    response,
    type === 'Style' ? 16 * 1024 * 1024 : 1024 * 1024,
    `Tileflow ${type}`,
  );
  const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!isRecord(value)) throw new TypeError(`Tileflow ${type} document must be a JSON object.`);
  return {value, url: response.url || address};
}
