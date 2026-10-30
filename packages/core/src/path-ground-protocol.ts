import type {ResolvedTileflowData} from './data';
import type {PathGroundBindings} from './path-ground-geometry';

export const tileflowPathGroundProtocol = 'tileflow-path-ground';
export const tileflowPathGroundSource = 'tileflow-path-ground';
export type PathGroundSource = PathGroundBindings & {
  url?: string;
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
};

export function pathGroundSourceConfig(data: ResolvedTileflowData): PathGroundSource {
  return {
    ...(data.url ? {url: data.url} : {tiles: data.tiles}),
    minzoom: Math.max(12, data.minzoom ?? 0),
    maxzoom: data.maxzoom ?? 15,
    road: data.schema.layers.road,
    landcover: data.schema.layers.landcover,
    landuse: data.schema.layers.landuse,
    class: data.schema.fields.class,
    subclass: data.schema.fields.subclass,
    brunnel: data.schema.fields.brunnel,
  };
}
export function pathGroundProtocolUrl(source: PathGroundSource, tile = false) {
  return `${tileflowPathGroundProtocol}://source/${tile ? '{z}/{x}/{y}.pbf' : 'index.json'}?source=${encodeURIComponent(JSON.stringify(source))}`;
}
export function parsePathGroundRequest(value: string) {
  if (value.length > 16000) throw new Error('Path context URL is too long');
  const url = new URL(value);
  if (
    url.protocol !== `${tileflowPathGroundProtocol}:` ||
    url.hostname !== 'source' ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Invalid path context URL');
  const source: PathGroundSource = JSON.parse(url.searchParams.get('source') ?? 'null');
  if (
    !source ||
    !['road', 'landcover', 'landuse', 'class', 'subclass', 'brunnel'].every(
      (k) => typeof source[k as keyof PathGroundSource] === 'string',
    )
  )
    throw new Error('Invalid path context bindings');
  if (!source.url && !source.tiles?.length) throw new Error('Missing path context source');
  for (const endpoint of [source.url, ...(source.tiles ?? [])].filter((s): s is string => !!s)) {
    const u = new URL(
      endpoint.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'),
    );
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
      throw new Error('Path context requires an HTTP(S) vector source');
  }
  if (url.pathname === '/index.json') return {source};
  const match = /^\/(\d{1,2})\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
  if (!match) throw new Error('Invalid path context tile');
  const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
  if (z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error('Invalid path context coordinates');
  return {source, tile: {z, x, y}};
}
