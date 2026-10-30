import type {TileflowRuntimeStyle} from '@tileflow/core/runtime';
import {ProtocolError} from './protocol';

type Style = Exclude<TileflowRuntimeStyle['style'], string>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const customProtocol = /^(?:tileflow-pmtiles|tileflow-contour):\/\//u;

/** Resolve against the original document, never the opaque native transport address. */
export function absoluteResource(value: string, document: string): string {
  if (customProtocol.test(value)) return value;
  const url = new URL(value, document);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ProtocolError('resourceFailed', 'A map resource has an invalid address.');
  }
  // MapLibre expands templates after document loading. URL serialization encodes their braces.
  return url.href.replaceAll(
    /%7B(z|x|y|ratio|quadkey|bbox-epsg-3857|fontstack|range)%7D/giu,
    '{$1}',
  );
}

/** Load a bounded style graph once per generation. TileJSON is expanded natively before MapLibre
 * sees it, so nested relative tile addresses retain the TileJSON document's base. */
export function createStyleResourceLoader(fetchResource: typeof fetch, signal: AbortSignal) {
  const styles = new Map<string, Promise<Style>>();
  const tilejson = new Map<string, Promise<RecordValue>>();
  const read = async (url: string): Promise<RecordValue> => {
    const response = await fetchResource(url, {signal});
    if (!response.ok)
      throw new ProtocolError('resourceFailed', 'A map document could not be loaded.');
    const value: unknown = await response.json();
    if (!record(value))
      throw new ProtocolError('resourceFailed', 'A map document is not an object.');
    return value;
  };
  const loadTilejson = (url: string) => {
    let pending = tilejson.get(url);
    if (!pending) {
      if (tilejson.size >= 128)
        throw new ProtocolError('resourceFailed', 'The map has too many source documents.');
      pending = read(url).catch((error: unknown) => {
        tilejson.delete(url);
        throw error;
      });
      tilejson.set(url, pending);
    }
    return pending;
  };
  const loadDocument = async (url: string): Promise<Style> => {
    const style = structuredClone(await read(url));
    if (
      style.version !== 8 ||
      !record(style.sources) ||
      !Array.isArray(style.layers) ||
      Object.keys(style.sources).length > 64 ||
      Object.keys(style.sources).some((id) => id.startsWith('__tileflow_app_')) ||
      style.layers.some(
        (layer: unknown) => record(layer) && String(layer.id).startsWith('__tileflow_app_'),
      )
    ) {
      throw new ProtocolError(
        'resourceFailed',
        'The map style does not satisfy the mobile limits.',
      );
    }
    if (typeof style.glyphs === 'string') style.glyphs = absoluteResource(style.glyphs, url);
    if (typeof style.sprite === 'string') style.sprite = absoluteResource(style.sprite, url);
    else if (Array.isArray(style.sprite)) {
      style.sprite = style.sprite.map((sprite: unknown) => {
        if (!record(sprite) || typeof sprite.url !== 'string')
          throw new ProtocolError('resourceFailed', 'Invalid sprite resource.');
        return {...sprite, url: absoluteResource(sprite.url, url)};
      });
    }
    const metadata = style.metadata;
    if (record(metadata) && Array.isArray(metadata['tileflow:fontFaces'])) {
      metadata['tileflow:fontFaces'] = metadata['tileflow:fontFaces'].map((face: unknown) => {
        if (!record(face) || typeof face.source !== 'string')
          throw new ProtocolError('resourceFailed', 'Invalid font resource.');
        return {...face, source: absoluteResource(face.source, url)};
      });
    }
    // Bound parallelism even when a style contains many sources.
    const entries = Object.values(style.sources);
    for (let offset = 0; offset < entries.length; offset += 8) {
      await Promise.all(
        entries.slice(offset, offset + 8).map(async (source: unknown) => {
          if (!record(source)) throw new ProtocolError('resourceFailed', 'Invalid map source.');
          let base = url;
          if (typeof source.url === 'string') {
            source.url = absoluteResource(source.url, url);
            if (
              ['vector', 'raster', 'raster-dem'].includes(String(source.type)) &&
              !customProtocol.test(String(source.url))
            ) {
              const descriptorUrl = String(source.url);
              const descriptor = await loadTilejson(descriptorUrl);
              if (source.tiles === undefined) base = descriptorUrl;
              for (const key of [
                'tiles',
                'bounds',
                'minzoom',
                'maxzoom',
                'scheme',
                'attribution',
                'encoding',
              ]) {
                if (source[key] === undefined && descriptor[key] !== undefined)
                  source[key] = structuredClone(descriptor[key]);
              }
              if (!Array.isArray(source.tiles) || source.tiles.length === 0) {
                throw new ProtocolError('resourceFailed', 'A source document has no tiles.');
              }
              delete source.url;
            }
          }
          if (Array.isArray(source.tiles)) {
            if (source.tiles.length > 16)
              throw new ProtocolError('resourceFailed', 'A source has too many tile templates.');
            source.tiles = source.tiles.map((tile: unknown) => {
              if (typeof tile !== 'string')
                throw new ProtocolError('resourceFailed', 'Invalid tile template.');
              return absoluteResource(tile, base);
            });
          }
          if (source.type === 'geojson' && typeof source.data === 'string')
            source.data = absoluteResource(source.data, url);
          if (source.type === 'image' && typeof source.url === 'string')
            source.url = absoluteResource(source.url, url);
          if (source.type === 'video')
            throw new ProtocolError('resourceFailed', 'Video sources are not supported.');
        }),
      );
    }
    return style as Style;
  };
  const load = (url: string): Promise<Style> => {
    let pending = styles.get(url);
    if (!pending) {
      if (styles.size >= 64)
        throw new ProtocolError('resourceFailed', 'The map has too many styles.');
      pending = loadDocument(url).catch((error: unknown) => {
        styles.delete(url);
        throw error;
      });
      styles.set(url, pending);
    }
    return pending;
  };
  return {
    load,
    async prepare(style: TileflowRuntimeStyle): Promise<TileflowRuntimeStyle> {
      return typeof style.style === 'string' ? {...style, style: await load(style.style)} : style;
    },
  };
}
