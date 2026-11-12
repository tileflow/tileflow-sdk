import {defaultTileflowApiUrl} from '@tileflow/dev/config';
import type {TileflowIconResolutionOptions} from '@tileflow/dev/icons';
import {normalizeApiOrigin} from './account-session';

/** Only caller-selected API origins may extend the default icon delivery allowlist. */
export function resolveIconOptions(
  options: {
    apiBaseUrl?: string;
    apiUrl?: string;
    cacheDir?: string;
    offline?: boolean;
  } = {},
): TileflowIconResolutionOptions | undefined {
  // Asset base URLs may contain a path; control-plane API URLs remain strict origins.
  const base =
    options.apiUrl === undefined && options.apiBaseUrl ? new URL(options.apiBaseUrl) : undefined;
  if (base) base.pathname = '/';
  const selected = options.apiUrl ?? base?.href ?? (process.env.TILEFLOW_API_URL || undefined);
  const origin = selected === undefined ? undefined : normalizeApiOrigin(selected);
  const icons: TileflowIconResolutionOptions = {
    ...(options.cacheDir ? {cacheRoot: options.cacheDir} : {}),
    ...(options.offline ? {offline: true} : {}),
    ...(origin && origin !== defaultTileflowApiUrl
      ? {deliveryOrigins: [defaultTileflowApiUrl, origin]}
      : {}),
  };
  return Object.keys(icons).length > 0 ? icons : undefined;
}
