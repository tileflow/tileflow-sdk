import type {TileflowRuntimeStyle} from './runtime';
import {
  createTileflowStyleFamily,
  expandTileflowFamilyTemplate,
  expandTileflowStyleFamily,
  materializeTileflowStyleFamily,
  type TileflowStyleFamily,
  withTileflowFamilyTemplate,
} from './style-family';
import {loadTileflowStyleFamily} from './style-family-loader';
import {prepareTileflowStyleFamilyForRendering} from './style-family-render';
import type {MapLibreStyle} from './types';

/** Resolve document-relative assets without fetching textures, tiles or models ahead of demand. */
export function resolveTileflowStyleResourceUrls(
  style: MapLibreStyle,
  documentUrl: string,
): MapLibreStyle {
  const result = structuredClone(style);
  const absolute = (value: string) =>
    // URL encodes path placeholders. Query values may contain a nested URL whose
    // escaped placeholders must remain opaque to the outer tile substitution.
    new URL(value, documentUrl).href.replace(/^[^?#]+/u, (path) =>
      path.replaceAll(/%7B([^%]+)%7D/giu, '{$1}'),
    );
  const property = (record: Record<string, unknown>, key: string) => {
    if (typeof record[key] === 'string') record[key] = absolute(record[key]);
  };
  property(result, 'glyphs');
  if (typeof result.sprite === 'string') result.sprite = absolute(result.sprite);
  else if (Array.isArray(result.sprite))
    for (const sprite of result.sprite) property(sprite, 'url');
  for (const source of Object.values(result.sources) as Record<string, unknown>[]) {
    property(source, 'url');
    if (source.type === 'geojson') property(source, 'data');
    if (Array.isArray(source.tiles))
      source.tiles = source.tiles.map((value) =>
        typeof value === 'string' ? absolute(value) : value,
      );
    if (Array.isArray(source.urls))
      source.urls = source.urls.map((value) =>
        typeof value === 'string' ? absolute(value) : value,
      );
  }
  const metadata = result.metadata;
  const fonts = metadata?.['tileflow:fontFaces'];
  if (Array.isArray(fonts))
    for (const face of fonts) if (face && typeof face === 'object') property(face, 'source');
  for (const key of ['tileflow:buildings', 'tileflow:vegetation']) {
    const descriptor = metadata?.[key] as {models?: Record<string, unknown>[]} | undefined;
    if (Array.isArray(descriptor?.models))
      for (const model of descriptor.models) property(model, 'url');
  }
  return result;
}

export function resolveTileflowFamilyResourceUrls(
  family: TileflowStyleFamily,
  documentUrl: string,
): TileflowStyleFamily {
  if (family.updates.appearanceOnly)
    return withTileflowFamilyTemplate(
      family,
      resolveTileflowStyleResourceUrls(
        expandTileflowFamilyTemplate(family) as unknown as MapLibreStyle,
        documentUrl,
      ),
    );
  return createTileflowStyleFamily(
    Object.fromEntries(
      Object.entries(expandTileflowStyleFamily(family)).map(([name, style]) => [
        name,
        resolveTileflowStyleResourceUrls(style, documentUrl),
      ]),
    ),
  );
}

/** Prepare the initial appearance before constructing MapLibre; subsequent changes reuse this family. */
export async function loadTileflowRuntimeAppearance(
  style: TileflowRuntimeStyle,
  options: {fetch?: typeof fetch; signal?: AbortSignal} = {},
): Promise<TileflowRuntimeStyle> {
  if (!style.familyUrl || !style.theme || style.family) return style;
  const family = prepareTileflowStyleFamilyForRendering(
    resolveTileflowFamilyResourceUrls(
      await loadTileflowStyleFamily(style.familyUrl, options),
      style.familyUrl,
    ),
  );
  return {...style, family, style: materializeTileflowStyleFamily(family, style.theme)};
}
