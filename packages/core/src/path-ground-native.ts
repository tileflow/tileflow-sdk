import {parsePathGroundRequest, tileflowPathGroundSource} from './path-ground-protocol';
import type {MapLibreStyle} from './types';

/** Native keeps the complete ground stroke; its renderer cannot derive clipped vector tiles. */
export function prepareTileflowNativePathGround(style: MapLibreStyle): MapLibreStyle {
  const derived = style.sources[tileflowPathGroundSource];
  if (
    derived?.type !== 'vector' ||
    typeof derived.url !== 'string' ||
    !derived.url.startsWith('tileflow-path-ground:')
  )
    return style;
  let source;
  try {
    const parsed = parsePathGroundRequest(derived.url);
    if (parsed.tile) return style;
    source = parsed.source;
  } catch {
    // Leave malformed/foreign protocols to the strict native source validator.
    return style;
  }
  const overlays = style.layers.filter(
    (layer) => 'source' in layer && layer.source === tileflowPathGroundSource,
  );
  if (!overlays.length || overlays.some((layer) => layer.type !== 'line')) return style;
  return {
    ...style,
    sources: {
      ...style.sources,
      [tileflowPathGroundSource]: {
        type: 'vector',
        ...(source.url ? {url: source.url} : {tiles: source.tiles}),
        ...(source.minzoom === undefined ? {} : {minzoom: source.minzoom}),
        ...(source.maxzoom === undefined ? {} : {maxzoom: source.maxzoom}),
      },
    },
    // Keep indices and metadata references stable while the complete ground paths remain visible.
    layers: style.layers.map((layer) =>
      layer.type === 'line' && layer.source === tileflowPathGroundSource
        ? {...layer, paint: {...(layer.paint as Record<string, unknown>), 'line-opacity': 0}}
        : layer,
    ),
  };
}
