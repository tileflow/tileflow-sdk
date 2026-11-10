import {isIP} from 'node:net';

export const defaultTileflowDevHost = '127.0.0.1';

/** Accept only an IP literal or localhost, never a URL, path, or shell-shaped value. */
export function parseTileflowDevHost(value: string): string | null {
  if (value !== value.trim() || value.length === 0 || value.length > 253) return null;
  return value === 'localhost' || isIP(value) !== 0 ? value : null;
}

export function tileflowDevOrigin(host: string, port: number): string {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Refuse a request addressed to any DNS name other than localhost.
 *
 * A web page can rebind its own DNS name to this machine and then read the preview as same-origin
 * content: map styles, local tilesets, sprites and inspection data. Its requests still carry that
 * name in `Host`, while every legitimate address of a development server is an IP literal or
 * localhost, including the LAN address used with `--host 0.0.0.0`.
 */
export function rejectTileflowDevRebinding(request: Request): Response | undefined {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    hostname = '';
  }
  const literal =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (hostname === 'localhost' || isIP(literal) !== 0) return;
  return new Response('Use the Tileflow preview from its local address.\n', {
    status: 421,
    headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'},
  });
}

/** Load the shell and its workbench API from the same configured loopback origin. */
export function redirectTileflowDevNavigation(
  request: Request,
  origin: string,
): Response | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const url = new URL(request.url);
  const canonical = new URL(origin);
  if (
    url.pathname !== '/' ||
    url.origin === canonical.origin ||
    !loopbackHosts.has(url.hostname) ||
    !loopbackHosts.has(canonical.hostname) ||
    url.protocol !== canonical.protocol ||
    url.port !== canonical.port
  )
    return;

  canonical.search = url.search;
  return new Response(null, {
    status: 307,
    headers: {location: canonical.href, 'cache-control': 'no-store'},
  });
}
