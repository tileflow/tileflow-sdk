/** Private declarations for the pinned low-level parser. No WebIDL URL class is imported. */
declare module 'whatwg-url/lib/url-state-machine.js' {
  export type URLRecord = {
    scheme: string;
    username: string;
    password: string;
    host: string | number | number[] | null;
    port: number | null;
    path: string | string[];
    query: string | null;
    fragment: string | null;
  };
  export function basicURLParse(input: string, options?: {baseURL?: URLRecord}): URLRecord | null;
  export function serializeURL(url: URLRecord): string;
  export function serializeURLOrigin(url: URLRecord): string;
  export function serializeHost(host: Exclude<URLRecord['host'], null>): string;
  export function serializePath(url: URLRecord): string;
}
