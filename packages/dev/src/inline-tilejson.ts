import type {MapLibreStyle} from '@tileflow/core';

/** The TileJSON fields a published source carries in place of its `url`. */
const inlinedFields = ['tiles', 'minzoom', 'maxzoom', 'bounds', 'scheme'] as const;
const worldTileJsonPaths = new Set([
  '/tiles/world/tiles.json',
  '/tiles/world-detail/tiles.json',
  '/tiles/world,world-detail/tiles.json',
]);
const sha256Pattern = /^[0-9a-f]{64}$/u;
const maxTileJsonBytes = 1024 * 1024;

export class TileflowTileJsonInlineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TileflowTileJsonInlineError';
  }
}

/**
 * The exact World release a source's TileJSON URL selects, or undefined when the URL is not an
 * anonymous exact-release World TileJSON: `current`, a Map's or a renderer's selector can change
 * what it answers, so only an exact release is fixed enough to publish inside a style.
 */
export function exactWorldTileJsonSelector(
  value: unknown,
): Readonly<{releaseId: string; descriptorSha256: string}> | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined;
  if (!worldTileJsonPaths.has(url.pathname)) return undefined;
  const keys = [...url.searchParams.keys()].sort();
  if (keys.join(',') !== 'worldDescriptorSha256,worldReleaseId') return undefined;
  const releaseId = url.searchParams.get('worldReleaseId')!;
  const descriptorSha256 = url.searchParams.get('worldDescriptorSha256')!;
  if (!/^world-v1-[0-9a-f-]{36}$/u.test(releaseId) || !sha256Pattern.test(descriptorSha256))
    return undefined;
  return {releaseId, descriptorSha256};
}

/**
 * Writes the TileJSON of every source that selects an exact World release into the styles: the
 * source keeps its own attribution and takes `tiles`, `minzoom`, `maxzoom`, `bounds` and `scheme`
 * in place of `url`, so a map requests its first tiles with no TileJSON round trip after the style.
 * An exact release never changes what its TileJSON answers. Each URL is read once; a document that
 * is unreadable, for another release or without tile templates fails the build. Inputs are not
 * mutated.
 */
export async function inlineTileflowExactTileJson<T extends Record<string, MapLibreStyle>>(
  styles: Readonly<Record<string, T>>,
  options: {fetch?: typeof globalThis.fetch} = {},
): Promise<Record<string, T>> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const documents = new Map<string, Promise<Record<string, unknown>>>();
  const read = (url: string, selector: {releaseId: string; descriptorSha256: string}) => {
    let pending = documents.get(url);
    if (!pending) {
      pending = readExactTileJson(fetcher, url, selector);
      documents.set(url, pending);
    }
    return pending;
  };
  const result: Record<string, T> = {};
  for (const [mapName, themes] of Object.entries(styles)) {
    const inlined: Record<string, MapLibreStyle> = {};
    for (const [theme, style] of Object.entries(themes)) {
      const sources: MapLibreStyle['sources'] = {};
      for (const [id, source] of Object.entries(style.sources)) {
        const selector =
          source.type === 'vector' ? exactWorldTileJsonSelector(source.url) : undefined;
        if (!selector) {
          sources[id] = source;
          continue;
        }
        const tileJson = await read(source.url as string, selector);
        const {url: _url, ...rest} = source as Record<string, unknown>;
        sources[id] = {
          ...Object.fromEntries(
            inlinedFields
              .filter((field) => tileJson[field] !== undefined)
              .map((field) => [field, tileJson[field]]),
          ),
          ...rest,
          ...(rest.attribution === undefined && typeof tileJson.attribution === 'string'
            ? {attribution: tileJson.attribution}
            : {}),
          tiles: tileJson.tiles,
        } as MapLibreStyle['sources'][string];
      }
      inlined[theme] = {...style, sources};
    }
    result[mapName] = inlined as T;
  }
  return result;
}

async function readExactTileJson(
  fetcher: typeof globalThis.fetch,
  url: string,
  selector: {releaseId: string; descriptorSha256: string},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {redirect: 'error'});
  } catch (cause) {
    throw new TileflowTileJsonInlineError(`Cannot read the TileJSON of ${url}.`, {cause});
  }
  if (!response.ok)
    throw new TileflowTileJsonInlineError(`The TileJSON of ${url} answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxTileJsonBytes)
    throw new TileflowTileJsonInlineError(`The TileJSON of ${url} is larger than 1 MiB.`);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch (cause) {
    throw new TileflowTileJsonInlineError(`The TileJSON of ${url} is not JSON.`, {cause});
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TileflowTileJsonInlineError(`The TileJSON of ${url} is not an object.`);
  const document = value as Record<string, unknown>;
  const world = (document.tileflow as {world?: Record<string, unknown>} | undefined)?.world;
  if (
    world?.releaseId !== selector.releaseId ||
    world.descriptorSha256 !== selector.descriptorSha256
  )
    throw new TileflowTileJsonInlineError(
      `The TileJSON of ${url} describes another World release.`,
    );
  const tiles = document.tiles;
  if (
    !Array.isArray(tiles) ||
    tiles.length === 0 ||
    !tiles.every(
      (tile) =>
        typeof tile === 'string' &&
        /^https:\/\//u.test(tile) &&
        ['{z}', '{x}', '{y}'].every((token) => tile.includes(token)),
    )
  )
    throw new TileflowTileJsonInlineError(`The TileJSON of ${url} has no HTTPS tile templates.`);
  for (const zoom of ['minzoom', 'maxzoom'] as const)
    if (
      document[zoom] !== undefined &&
      !(Number.isInteger(document[zoom]) && (document[zoom] as number) >= 0)
    )
      throw new TileflowTileJsonInlineError(`The TileJSON of ${url} has an invalid ${zoom}.`);
  return document;
}
