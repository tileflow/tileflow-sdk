import {
  basicURLParse,
  serializeHost,
  serializePath,
  serializeURL,
  serializeURLOrigin,
} from 'whatwg-url/lib/url-state-machine.js';
import type {NativeParsedUrl} from './native-url-policy';

/** Read-only projection of the complete parser record; not another URL parsing algorithm. */
export function parseNativeUrl(value: string, base?: string): NativeParsedUrl {
  const baseURL = base === undefined ? undefined : basicURLParse(base);
  if (baseURL === null) throw new TypeError('Invalid native URL.');
  const parsed = basicURLParse(value, baseURL === undefined ? undefined : {baseURL});
  if (parsed === null) throw new TypeError('Invalid native URL.');
  return {
    href: serializeURL(parsed),
    origin: serializeURLOrigin(parsed),
    protocol: `${parsed.scheme}:`,
    hostname: parsed.host === null ? '' : serializeHost(parsed.host),
    pathname: serializePath(parsed),
    search: parsed.query ? `?${parsed.query}` : '',
    hash: parsed.fragment ? `#${parsed.fragment}` : '',
    username: parsed.username,
    password: parsed.password,
  };
}
