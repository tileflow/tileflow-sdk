import {
  isSafeTileflowDemUrlTemplate,
  parseTileflowContourProtocolRequest,
  tileflowContourProtocol,
  type TileflowContourProtocolConfig,
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

export type TileflowContourProtocolRegistrationOptions = {
  /** Test/integration override; the default lazily initializes the pinned, bundled module. */
  loadMaplibreContour?: () => Promise<unknown>;
  /** Route the nested DEM template through an application-owned transport, preserving XYZ slots. */
  transformDemUrl?: (url: string) => string;
  /** Route a `demTileJson` document request through an application-owned transport. */
  transformTileJsonUrl?: (url: string) => string;
  /** Fetch used for `demTileJson` documents. Defaults to the global fetch. */
  fetch?: (url: string) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;
};

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
  const fetchDocument = options.fetch ?? ((url: string) => globalThis.fetch(url));
  let library: Promise<MaplibreContourLibrary> | undefined;
  const sources = new Map<string, Promise<MaplibreContourSource>>();

  return async (request, abortController) => {
    if (abortController.signal.aborted) throw new Error('Tileflow contour request aborted.');
    const {config, x, y, z} = parseTileflowContourProtocolRequest(request.url);
    const sourceKey = JSON.stringify([
      config.demUrl ?? null,
      config.demTileJson ?? null,
      config.encoding,
      config.demMaxzoom,
    ]);
    let source = sources.get(sourceKey);
    if (!source) {
      if (sources.size >= 16) sources.delete(sources.keys().next().value as string);
      library ??= loadModule().then(resolveMaplibreContourLibrary);
      source = Promise.all([
        library,
        resolveContourDem(config, (url) => fetchDocument(transformTileJsonUrl(url))),
      ]).then(
        ([module, dem]) =>
          new module.DemSource({
            encoding: config.encoding,
            maxzoom: dem.maxzoom,
            url: transformDemUrl(dem.url),
            // Upstream workers use a generated `blob:` URL. The main-thread manager keeps the
            // protocol usable in strict-CSP applications and deterministic local captures.
            worker: false,
          }),
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

type ResolvedContourDem = {maxzoom: number; url: string};

/**
 * A `demTileJson` reads its first tile template once per source. The document must agree with the
 * declared encoding; its `maxzoom`, when lower than the declared DEM zoom, caps the requests.
 */
async function resolveContourDem(
  config: TileflowContourProtocolConfig,
  fetchDocument: NonNullable<TileflowContourProtocolRegistrationOptions['fetch']>,
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
