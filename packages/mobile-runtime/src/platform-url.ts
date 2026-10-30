/**
 * The runtime's replacement for Core's private URL parser. Core bundles a WHATWG URL Standard
 * parser, with its IDNA tables, for JavaScript engines without a conforming `URL`; WebKit and
 * Chromium implement that standard, so the embedded runtime uses theirs. The runtime build
 * substitutes this module for `native-url-provider` inside Core (scripts/mobile-runtime-build.mjs),
 * and `test/platform-url.test.ts` keeps both projections equal.
 */
export function parseNativeUrl(value: string, base?: string) {
  const url = new URL(value, base);
  return {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    username: url.username,
    password: url.password,
  };
}
