/** Branding follows catalog delivery, independently of the software and data copyrights. */
export type TileflowBrandingSource = Readonly<{apiUrl: string; mapId?: string}>;
export type TileflowBrandingPolicy = Readonly<{
  mapId: string;
  catalogLogoRequired: boolean;
  revision: string;
  validForMs: number;
}>;

const catalog = new Set([
  'world',
  'world-detail',
  'world,world-detail',
  'terrain',
  'boundaries',
  'bathymetry',
  'bathymetry-dem',
  'nautical',
]);
const mapPattern = /^map_[A-Za-z0-9_-]{16}$/u;
const metadataKey = 'tileflow:brandingSources';

type Style = {sources?: unknown; layers?: unknown; terrain?: unknown; metadata?: unknown};
type RememberedSource = {binding: string; deliveries: TileflowBrandingSource[]};
type UrlParser = (
  value: string,
  base?: string,
) => {
  origin: string;
  protocol: string;
  hostname: string;
  pathname: string;
  search: string;
};
const browserUrl: UrlParser = (value, base) => new URL(value, base);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resourceUrls(source: Record<string, unknown>): string[] {
  return [source.url, ...(Array.isArray(source.tiles) ? source.tiles : [])].filter(
    (url): url is string => typeof url === 'string',
  );
}

function queryValue(search: string, name: string): string | null {
  const decode = (part: string) => decodeURIComponent(part.replace(/\+/gu, ' '));
  for (const part of search.slice(1).split('&')) {
    const separator = part.indexOf('=');
    if (decode(separator === -1 ? part : part.slice(0, separator)) === name)
      return separator === -1 ? '' : decode(part.slice(separator + 1));
  }
  return null;
}

/** Recognize catalog routes on the configured API, never a source name or its schema. */
export function tileflowBrandingSource(
  value: string,
  options: {baseUrl?: string; apiUrl?: string} = {},
  parseUrl: UrlParser = browserUrl,
): TileflowBrandingSource | undefined {
  let url: ReturnType<UrlParser>;
  try {
    url = parseUrl(value, options.baseUrl);
    // The contour renderer loads its declared DEM even without a separate terrain layer.
    if (url.protocol === 'tileflow-contour:' && url.hostname === 'tiles') {
      const dem = queryValue(url.search, 'demTileJson') ?? queryValue(url.search, 'demUrl');
      if (!dem || !/^https?:\/\//u.test(dem)) return undefined;
      url = parseUrl(dem);
    }
  } catch {
    return undefined;
  }
  const apiOrigin = parseUrl(options.apiUrl ?? 'https://api.tileflow.dev').origin;
  // Official tiles may also come from Tileflow's tile host or, for World and Terrain without a
  // Map, its public catalog edge, as a style that carries World's TileJSON names them.
  const officialTiles =
    apiOrigin === 'https://api.tileflow.dev' &&
    (url.origin === 'https://tiles.tileflow.dev' || url.origin === 'https://world.tileflow.dev');
  if ((!officialTiles && url.origin !== apiOrigin) || !['http:', 'https:'].includes(url.protocol))
    return undefined;
  const match = /^\/(?:v1\/)?tiles\/([^/]+)(?:\/|$)/u.exec(url.pathname);
  if (!match || !catalog.has(match[1]!)) return undefined;
  // Native shares its private URL parser and does not need ambient URLSearchParams.
  const mapId = queryValue(url.search, 'map');
  if (mapId !== null && !mapPattern.test(mapId))
    throw new TypeError('Invalid Tileflow branding Map ID.');
  return {apiUrl: apiOrigin, ...(mapId ? {mapId} : {})};
}

/** Preserve source identity before a loader expands TileJSON or rewrites resource URLs. */
export function rememberTileflowBrandingSources(
  style: Style,
  options: {baseUrl?: string; apiUrl?: string; mapId?: string} = {},
  parseUrl: UrlParser = browserUrl,
): Record<string, RememberedSource> {
  if (!record(style.sources)) return {};
  const remembered: Record<string, RememberedSource> = {};
  for (const [id, source] of Object.entries(style.sources)) {
    if (!record(source)) continue;
    const deliveries = resourceUrls(source)
      .map((url) => tileflowBrandingSource(url, options, parseUrl))
      .filter((value): value is TileflowBrandingSource => !!value);
    if (options.mapId && mapPattern.test(options.mapId))
      deliveries.splice(
        0,
        deliveries.length,
        ...deliveries.map((delivery) => ({...delivery, mapId: options.mapId})),
      );
    if (deliveries.length)
      remembered[id] = {binding: JSON.stringify(resourceUrls(source)), deliveries};
  }
  return remembered;
}

/** Bind retained provenance to the expanded source, so replacing that source invalidates it. */
export function bindTileflowBrandingSources(
  style: Style,
  sources: Record<string, RememberedSource>,
): void {
  if (!record(style.sources)) return;
  for (const [id, entry] of Object.entries(sources)) {
    const source = style.sources[id];
    if (record(source)) entry.binding = JSON.stringify(resourceUrls(source));
  }
  style.metadata = {...(record(style.metadata) ? style.metadata : {}), [metadataKey]: sources};
}

/** Only sources referenced by the current composition count, including terrain. */
export function readTileflowBrandingSources(
  style: Style,
  options: {baseUrl?: string; apiUrl?: string} = {},
  parseUrl: UrlParser = browserUrl,
): readonly TileflowBrandingSource[] {
  if (!record(style.sources)) return [];
  const used = new Set<string>();
  if (Array.isArray(style.layers))
    for (const layer of style.layers) {
      if (
        record(layer) &&
        typeof layer.source === 'string' &&
        !(record(layer.layout) && layer.layout.visibility === 'none')
      )
        used.add(layer.source);
    }
  if (record(style.terrain) && typeof style.terrain.source === 'string')
    used.add(style.terrain.source);
  const saved =
    record(style.metadata) && record(style.metadata[metadataKey])
      ? style.metadata[metadataKey]
      : {};
  const deliveries = new Map<string, TileflowBrandingSource>();
  for (const id of used) {
    const source = style.sources[id];
    if (!record(source)) continue;
    const urls = resourceUrls(source);
    let found = urls
      .map((url) => tileflowBrandingSource(url, options, parseUrl))
      .filter((value): value is TileflowBrandingSource => !!value);
    const previous = saved[id];
    if (
      record(previous) &&
      previous.binding === JSON.stringify(urls) &&
      Array.isArray(previous.deliveries)
    ) {
      found = previous.deliveries.filter(
        (value): value is TileflowBrandingSource =>
          record(value) &&
          typeof value.apiUrl === 'string' &&
          value.apiUrl === parseUrl(options.apiUrl ?? 'https://api.tileflow.dev').origin &&
          (value.mapId === undefined ||
            (typeof value.mapId === 'string' && mapPattern.test(value.mapId))),
      );
    }
    for (const delivery of found)
      deliveries.set(`${delivery.apiUrl}/${delivery.mapId ?? ''}`, delivery);
  }
  return [...deliveries.values()];
}

export function parseTileflowBrandingPolicy(value: unknown, mapId: string): TileflowBrandingPolicy {
  if (
    !record(value) ||
    value.mapId !== mapId ||
    typeof value.catalogLogoRequired !== 'boolean' ||
    typeof value.revision !== 'string' ||
    !/^[0-9]{1,32}$/u.test(value.revision) ||
    typeof value.validForMs !== 'number' ||
    !Number.isFinite(value.validForMs) ||
    value.validForMs <= 0 ||
    value.validForMs > 900_000
  ) {
    throw new TypeError('Invalid Tileflow branding policy.');
  }
  return {
    mapId,
    catalogLogoRequired: value.catalogLogoRequired,
    revision: value.revision,
    validForMs: value.validForMs,
  };
}
