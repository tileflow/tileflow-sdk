import {
  isSafeTileflowContourRequestUrl,
  isSafeTileflowDemUrlTemplate,
  parseTileflowContourProtocolRequest,
  tileflowContourProtocol,
  type TileflowContourProtocolConfig,
  tileflowContourScopeParameter,
  tileflowContourSourceLayer,
  type TileflowContourThresholds,
} from './terrain/contour-protocol';

export const tileflowMaplibreContourVersion = '0.1.0' as const;

export type TileflowContourProtocolRequest = Readonly<{url: string}>;
export type TileflowContourProtocolResponse = Readonly<{
  cacheControl?: string | null;
  data: ArrayBuffer;
  expires?: Date | string | null;
}>;
export type TileflowContourProtocolHandler = (
  request: TileflowContourProtocolRequest,
  abortController: AbortController,
) => Promise<TileflowContourProtocolResponse>;
export type TileflowContourProtocolRegistry = {
  addProtocol: (name: string, handler: TileflowContourProtocolHandler) => void;
};

export type TileflowContourFetchInit = Readonly<{
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  signal?: AbortSignal;
}>;
export type TileflowContourFetchResponse = Pick<
  Response,
  'blob' | 'headers' | 'json' | 'ok' | 'status'
>;
export type TileflowContourFetch = (
  url: string,
  init?: TileflowContourFetchInit,
) => Promise<TileflowContourFetchResponse>;

export type TileflowContourProtocolRegistrationOptions = {
  /** Test/integration override; the default lazily initializes the pinned, bundled module. */
  loadMaplibreContour?: () => Promise<unknown>;
  /** Route the nested DEM template through an application-owned transport, preserving XYZ slots. */
  transformDemUrl?: (url: string) => string;
  /** Route a `demTileJson` document request through an application-owned transport. */
  transformTileJsonUrl?: (url: string) => string;
  /**
   * Fetch used for `demTileJson` documents and for the DEM tiles of a request scope. Defaults to
   * the global fetch.
   */
  fetch?: TileflowContourFetch;
};

/** Resource kinds of the nested requests, named as MapLibre names a `raster-dem` source's. */
export type TileflowContourRequestResourceType = 'Source' | 'Tile';
export type TileflowContourRequestParameters = Readonly<{
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  url: string;
}>;
export type TileflowContourRequestTransform = (
  url: string,
  resourceType: TileflowContourRequestResourceType,
) =>
  | PromiseLike<TileflowContourRequestParameters | undefined>
  | TileflowContourRequestParameters
  | undefined;

/**
 * One map's view of the shared contour protocol. MapLibre registers a protocol once per page, but
 * request transforms (and the Hosted session they carry) belong to each map: the scope routes the
 * DEM TileJSON and every DEM tile that one map's contours read through that map's transform.
 */
export type TileflowContourRequestScope = Readonly<{
  dispose(): void;
  /** Binds a contour tile URL to this scope. Any other URL is returned unchanged. */
  rewriteUrl(url: string): string;
}>;

const contourRequestScopes = new Map<string, TileflowContourRequestTransform>();
let contourScopeSequence = 0;

/**
 * Creates the request scope of one map. Apply {@link TileflowContourRequestScope.rewriteUrl} in
 * that map's `transformRequest`; dispose it when the map is removed.
 */
export function createTileflowContourRequestScope(input: {
  transformRequest: TileflowContourRequestTransform;
}): TileflowContourRequestScope {
  const scope = createContourScopeId();
  contourRequestScopes.set(scope, input.transformRequest);
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      contourRequestScopes.delete(scope);
    },
    rewriteUrl(url: string) {
      if (disposed || !url.startsWith(`${tileflowContourProtocol}://`)) return url;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return url;
      }
      if (parsed.searchParams.has(tileflowContourScopeParameter)) return url;
      return `${url}${url.includes('?') ? '&' : '?'}${tileflowContourScopeParameter}=${scope}`;
    },
  });
}

function createContourScopeId(): string {
  contourScopeSequence += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `contour_${crypto.randomUUID().replaceAll('-', '_')}`;
  }
  return `contour_${Date.now().toString(36)}_${contourScopeSequence.toString(36)}`;
}

type MaplibreContourGetTile = (
  url: string,
  abortController: AbortController,
) => Promise<{cacheControl?: string; data: Blob; expires?: string}>;

type MaplibreContourSource = {
  contourProtocolUrl(options: {
    contourLayer: string;
    elevationKey: string;
    levelKey: string;
    multiplier: number;
    overzoom: number;
    thresholds: Record<number, [number, number]>;
  }): string;
  contourProtocolV4(
    request: TileflowContourProtocolRequest,
    abortController: AbortController,
  ): Promise<TileflowContourProtocolResponse>;
  /** Main-thread DEM manager of maplibre-contour 0.1.1; its tile loader is replaceable. */
  manager?: {getTile?: MaplibreContourGetTile};
};

type MaplibreContourLibrary = {
  DemSource: new (options: {
    encoding: 'mapbox' | 'terrarium';
    maxzoom: number;
    url: string;
    worker: boolean;
  }) => MaplibreContourSource;
};

const registeredContourProtocols = new WeakSet<TileflowContourProtocolRegistry['addProtocol']>();

/** Registers the one self-contained protocol emitted by every compiled contour source. */
export function registerTileflowContourProtocol(
  registry: TileflowContourProtocolRegistry,
  options: TileflowContourProtocolRegistrationOptions = {},
): void {
  if (registeredContourProtocols.has(registry.addProtocol)) return;
  const handler = createTileflowContourProtocolHandler(
    options.loadMaplibreContour ?? loadPinnedMaplibreContour,
    options,
  );
  registry.addProtocol(tileflowContourProtocol, handler);
  registeredContourProtocols.add(registry.addProtocol);
}

function createTileflowContourProtocolHandler(
  loadModule: () => Promise<unknown>,
  options: TileflowContourProtocolRegistrationOptions,
): TileflowContourProtocolHandler {
  const transformDemUrl = options.transformDemUrl ?? ((url: string) => url);
  const transformTileJsonUrl = options.transformTileJsonUrl ?? ((url: string) => url);
  const fetchResource: TileflowContourFetch =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  let library: Promise<MaplibreContourLibrary> | undefined;
  const sources = new Map<string, Promise<MaplibreContourSource>>();

  return async (request, abortController) => {
    if (abortController.signal.aborted) throw new Error('Tileflow contour request aborted.');
    const {config, scope, x, y, z} = parseTileflowContourProtocolRequest(request.url);
    const transform = scope === undefined ? undefined : contourRequestScopes.get(scope);
    if (scope !== undefined && !transform) {
      throw new Error('Tileflow contour request scope is no longer registered.');
    }
    // A scoped source belongs to one map: its DEM requests carry that map's session.
    const sourceKey = JSON.stringify([
      scope ?? null,
      config.demUrl ?? null,
      config.demTileJson ?? null,
      config.encoding,
      config.demMaxzoom,
    ]);
    let source = sources.get(sourceKey);
    if (!source) {
      if (sources.size >= 16) sources.delete(sources.keys().next().value as string);
      library ??= loadModule().then(resolveMaplibreContourLibrary);
      const loadDocument = async (url: string) => {
        const resolved = transform ? await resolveScopedRequest(transform, url, 'Source') : {url};
        return fetchResource(transformTileJsonUrl(resolved.url), requestInit(resolved));
      };
      source = Promise.all([library, resolveContourDem(config, loadDocument)]).then(
        ([module, dem]) => {
          const contourSource = new module.DemSource({
            encoding: config.encoding,
            maxzoom: dem.maxzoom,
            // A scope resolves each concrete tile URL when it is fetched, so the template stays
            // free of session parameters and rotating grants never invalidate the tile cache.
            url: transform ? dem.url : transformDemUrl(dem.url),
            // Upstream workers use a generated `blob:` URL. The main-thread manager keeps the
            // protocol usable in strict-CSP applications and deterministic local captures.
            worker: false,
          });
          if (transform) {
            installScopedDemTileLoader(contourSource, (url, controller) =>
              fetchScopedDemTile(transform, url, controller, transformDemUrl, fetchResource),
            );
          }
          return contourSource;
        },
      );
      source = source.catch((error: unknown) => {
        sources.delete(sourceKey);
        library = undefined;
        throw error;
      });
      sources.set(sourceKey, source);
    }

    const contourSource = await source;
    if (abortController.signal.aborted) throw new Error('Tileflow contour request aborted.');
    const contourUrl = contourSource
      .contourProtocolUrl({
        contourLayer: tileflowContourSourceLayer,
        elevationKey: 'ele',
        levelKey: 'level',
        multiplier: config.multiplier,
        overzoom: config.overzoom,
        thresholds: mutableThresholds(config.thresholds),
      })
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    return contourSource.contourProtocolV4({url: contourUrl}, abortController);
  };
}

function installScopedDemTileLoader(
  source: MaplibreContourSource,
  getTile: MaplibreContourGetTile,
): void {
  if (!source.manager || typeof source.manager.getTile !== 'function') {
    throw new Error('maplibre-contour 0.1.1 did not expose its DEM tile loader.');
  }
  source.manager.getTile = getTile;
}

async function fetchScopedDemTile(
  transform: TileflowContourRequestTransform,
  url: string,
  abortController: AbortController,
  transformDemUrl: (url: string) => string,
  fetchResource: TileflowContourFetch,
): Promise<{cacheControl?: string; data: Blob; expires?: string}> {
  const resolved = await resolveScopedRequest(transform, url, 'Tile');
  const response = await fetchResource(transformDemUrl(resolved.url), {
    ...requestInit(resolved),
    signal: abortController.signal,
  });
  if (!response.ok) {
    throw new Error(`Tileflow contour DEM tile request failed with HTTP ${response.status}.`);
  }
  return {
    data: await response.blob(),
    cacheControl: response.headers.get('cache-control') ?? undefined,
    expires: response.headers.get('expires') ?? undefined,
  };
}

/** Runs one nested request through the map's transform, as MapLibre does for its own sources. */
async function resolveScopedRequest(
  transform: TileflowContourRequestTransform,
  url: string,
  resourceType: TileflowContourRequestResourceType,
): Promise<TileflowContourRequestParameters> {
  const resolved = (await transform(url, resourceType)) ?? {url};
  if (!isSafeTileflowContourRequestUrl(resolved.url)) {
    throw new Error('Tileflow contour request transform must return a safe HTTP(S) URL.');
  }
  return resolved;
}

function requestInit(request: TileflowContourRequestParameters): TileflowContourFetchInit {
  return {
    ...(request.credentials === undefined ? {} : {credentials: request.credentials}),
    ...(request.headers === undefined ? {} : {headers: request.headers}),
  };
}

type ResolvedContourDem = {maxzoom: number; url: string};

/**
 * A `demTileJson` reads its first tile template once per source. The document must agree with the
 * declared encoding; its `maxzoom`, when lower than the declared DEM zoom, caps the requests.
 */
async function resolveContourDem(
  config: TileflowContourProtocolConfig,
  fetchDocument: (url: string) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>,
): Promise<ResolvedContourDem> {
  if (config.demTileJson === undefined) return {maxzoom: config.demMaxzoom, url: config.demUrl};
  const response = await fetchDocument(config.demTileJson);
  if (!response.ok) {
    throw new Error(`Tileflow contour DEM TileJSON request failed with HTTP ${response.status}.`);
  }
  const document = (await response.json()) as unknown;
  const record =
    document && typeof document === 'object' && !Array.isArray(document)
      ? (document as {encoding?: unknown; maxzoom?: unknown; tiles?: unknown})
      : {};
  const template = Array.isArray(record.tiles) ? record.tiles[0] : undefined;
  if (typeof template !== 'string' || !isSafeTileflowDemUrlTemplate(template)) {
    throw new Error('Tileflow contour DEM TileJSON must list a safe HTTP(S) tile template.');
  }
  if (record.encoding !== undefined && record.encoding !== config.encoding) {
    throw new Error(
      `Tileflow contour DEM TileJSON encoding ${String(record.encoding)} differs from ${config.encoding}.`,
    );
  }
  const documentMaxzoom =
    typeof record.maxzoom === 'number' && Number.isInteger(record.maxzoom) && record.maxzoom >= 0
      ? record.maxzoom
      : config.demMaxzoom;
  return {maxzoom: Math.min(config.demMaxzoom, documentMaxzoom), url: template};
}

async function loadPinnedMaplibreContour(): Promise<unknown> {
  return import('maplibre-contour');
}

function resolveMaplibreContourLibrary(module: unknown): MaplibreContourLibrary {
  if (!module || typeof module !== 'object') {
    throw new Error('maplibre-contour 0.1.1 did not expose its browser module.');
  }
  const library = (module as {default?: unknown}).default;
  if (
    !library ||
    typeof library !== 'object' ||
    typeof (library as {DemSource?: unknown}).DemSource !== 'function'
  ) {
    throw new Error('maplibre-contour 0.1.1 did not expose DemSource.');
  }
  return library as MaplibreContourLibrary;
}

function mutableThresholds(
  thresholds: TileflowContourThresholds,
): Record<number, [number, number]> {
  return Object.fromEntries(
    Object.entries(thresholds).map(([zoom, [minor, index]]) => [Number(zoom), [minor, index]]),
  );
}
