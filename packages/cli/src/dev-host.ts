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
