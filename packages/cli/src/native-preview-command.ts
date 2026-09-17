import type {TileflowRuntimeManifest} from '@tileflow/core/manifest';
import {
  createTileflowDevRequestHandler,
  type TileflowDevRequestHandler,
  type TileflowDevRequestHandlerOptions,
} from '@tileflow/dev/server';

export const tileflowNativePreviewBasePath = '/native';
export const tileflowNativePreviewProfile = 'native-v1' as const;

export function getTileflowNativePreviewManifestUrl(origin: string): string {
  return `${origin}${tileflowNativePreviewBasePath}/manifest.json`;
}

export type TileflowNativePreviewSelection = Readonly<{mapName: string; themeName: string}>;

/** Validate optional CLI selection against the finalized runtime manifest, without browser preview. */
export function resolveTileflowNativePreviewSelection(
  manifest: TileflowRuntimeManifest,
  options: Readonly<{map?: string; theme?: string}>,
): TileflowNativePreviewSelection {
  const mapNames = Object.keys(manifest.maps).sort();
  const mapName = options.map ?? (mapNames.length === 1 ? mapNames[0] : undefined);
  if (!mapName || !Object.hasOwn(manifest.maps, mapName)) {
    throw new Error(
      options.map
        ? 'The selected map is not present in the native artifact manifest.'
        : 'Select one configured map with --map for native artifact preview.',
    );
  }
  const map = manifest.maps[mapName]!;
  const themeName = options.theme ?? map.defaultTheme;
  if (!Object.hasOwn(map.themes, themeName)) {
    throw new Error('The selected theme is not present in the native artifact manifest.');
  }
  return Object.freeze({mapName, themeName});
}

/**
 * Native preview exposes the existing Tileflow artifact routes only. Metro remains the JavaScript
 * development server; the browser shell, runtime and compiler-inspection sidecars are unavailable.
 */
export function createTileflowNativePreviewRequestHandler(
  options: Omit<TileflowDevRequestHandlerOptions, 'basePath' | 'map' | 'scene' | 'theme'>,
): TileflowDevRequestHandler {
  const delegate = createTileflowDevRequestHandler({
    ...options,
    basePath: tileflowNativePreviewBasePath,
  });
  const handler = async (request: Request): Promise<Response> => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return new Response(JSON.stringify({error: 'Not found'}), {
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        status: 404,
      });
    }
    if (
      pathname === tileflowNativePreviewBasePath ||
      pathname === `${tileflowNativePreviewBasePath}/` ||
      pathname.startsWith(`${tileflowNativePreviewBasePath}/__runtime/`) ||
      pathname.startsWith(`${tileflowNativePreviewBasePath}/__inspection/`)
    ) {
      return new Response(JSON.stringify({error: 'Not found'}), {
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        status: 404,
      });
    }
    return delegate(request);
  };
  return Object.assign(handler, {
    close: delegate.close,
    refresh: delegate.refresh,
  });
}
