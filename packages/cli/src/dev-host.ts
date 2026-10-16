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
