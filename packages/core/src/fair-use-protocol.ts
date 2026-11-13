/** Protocol of catalog tile requests rewritten by the fair-use request bridge. */
export const tileflowCatalogBridgeProtocol = 'tileflow-world';

/**
 * The catalog tile URL a bridge request wraps, for consumers that fetch outside MapLibre (contour
 * DEM tiles). Any other URL is returned unchanged.
 */
export function unwrapTileflowCatalogBridgeUrl(url: string): string {
  if (!url.startsWith(`${tileflowCatalogBridgeProtocol}://request/`)) return url;
  try {
    return new URL(url).searchParams.get('url') ?? url;
  } catch {
    return url;
  }
}
