import {deriveTileflowGreenPaths} from './path-ground-geometry';
import {
  parsePathGroundRequest,
  pathGroundProtocolUrl,
  type PathGroundSource,
  tileflowPathGroundProtocol,
} from './path-ground-protocol';

type Handler = (
  request: {url: string},
  abort: AbortController,
) => Promise<{data: ArrayBuffer | Record<string, unknown>}>;
export type TileflowPathGroundRegistry = {addProtocol(name: string, handler: Handler): void};
const registered = new WeakSet<TileflowPathGroundRegistry['addProtocol']>();
type TileJson = {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
  scheme?: string;
};

/** Register the SDK-owned derived-path protocol before creating a MapLibre map. */
export function registerTileflowPathGroundProtocol(
  registry: TileflowPathGroundRegistry,
  options: {transformUrl?: (url: string) => string; fetch?: typeof fetch} = {},
) {
  if (registered.has(registry.addProtocol)) return;
  const request = options.fetch ?? globalThis.fetch;
  const transform = options.transformUrl ?? ((url: string) => url);
  const descriptions = new Map<string, TileJson>();
  const tiles = new Map<string, Uint8Array>();
  let cacheBytes = 0;
  async function description(source: PathGroundSource, signal: AbortSignal): Promise<TileJson> {
    if (!source.url)
      return {tiles: source.tiles!, minzoom: source.minzoom, maxzoom: source.maxzoom};
    const previous = descriptions.get(source.url);
    if (previous) return previous;
    const response = await request(transform(source.url), {signal});
    if (!response.ok) throw new Error(`Path context TileJSON: HTTP ${response.status}`);
    const json = (await response.json()) as TileJson;
    if (
      !Array.isArray(json.tiles) ||
      !json.tiles.length ||
      json.tiles.some((url) => typeof url !== 'string')
    )
      throw new Error('Path context TileJSON has no tile templates');
    const result = {
      ...json,
      tiles: json.tiles.map((url) =>
        new URL(url, source.url).href.replaceAll('%7B', '{').replaceAll('%7D', '}'),
      ),
    };
    if (descriptions.size >= 16) descriptions.delete(descriptions.keys().next().value!);
    descriptions.set(source.url, result);
    return result;
  }
  registry.addProtocol(tileflowPathGroundProtocol, async (input, abort) => {
    const {source, tile} = parsePathGroundRequest(input.url);
    const signal = abort.signal;
    signal.throwIfAborted();
    const json = await description(source, signal);
    if (!tile)
      return {
        data: {
          tiles: [pathGroundProtocolUrl(source, true)],
          minzoom: Math.max(12, json.minzoom ?? 0),
          maxzoom: json.maxzoom ?? source.maxzoom ?? 15,
          ...(json.attribution ? {attribution: json.attribution} : {}),
        },
      };
    const cached = tiles.get(input.url);
    if (cached) return {data: cached.slice().buffer};
    const y = json.scheme === 'tms' ? 2 ** tile.z - 1 - tile.y : tile.y;
    const url = json.tiles[0]!.replaceAll('{z}', String(tile.z))
      .replaceAll('{x}', String(tile.x))
      .replaceAll('{y}', String(y));
    if (!/^https?:\/\//.test(url))
      throw new Error('Path context requires an HTTP(S) tile template');
    const response = await request(transform(url), {signal});
    if (!response.ok) throw new Error(`Path context tile: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Path context tile exceeds 16 MiB');
    signal.throwIfAborted();
    const result = deriveTileflowGreenPaths(bytes, source);
    while (tiles.size && (tiles.size >= 64 || cacheBytes + result.byteLength > 16 * 1024 * 1024)) {
      const key = tiles.keys().next().value!;
      cacheBytes -= tiles.get(key)!.byteLength;
      tiles.delete(key);
    }
    tiles.set(input.url, result);
    cacheBytes += result.byteLength;
    return {data: result.slice().buffer};
  });
  registered.add(registry.addProtocol);
}
