import {createWriteStream} from 'node:fs';
import {join, resolve} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const schemePattern = /^[a-z][a-z0-9+.-]+:\/\//iu;
const maximumRedirects = 5;
const defaultRetryDelays = [2_000, 5_000];

/**
 * Query strings can hold signed credentials, so a URL only reaches logs and errors through
 * `describeUrl`.
 */
export function describeUrl(url) {
  return `${url.origin}${url.pathname}`;
}

export function parseSource(source, cwd) {
  if (!schemePattern.test(source)) return {kind: 'path', path: resolve(cwd, source)};
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error('source is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `source supports https:// URLs and local paths, not ${url.protocol}// URLs. Download the file in an earlier step and pass its path.`,
    );
  }
  if (url.username || url.password) {
    throw new Error('source must not contain a user name or password.');
  }
  return {kind: 'url', url};
}

/**
 * The name stays the same across runs, whatever a redirect does, because the default layer name
 * comes from it and an unchanged rebuild must produce the same bytes.
 */
export function fileNameFromUrl(url) {
  const segment = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape is left as it is and cleaned below.
  }
  const cleaned = decoded
    .replace(/[^A-Za-z0-9._-]/gu, '_')
    .replace(/^\.+/u, '')
    .slice(-200);
  return cleaned || 'source';
}

export async function downloadSource(url, directory, options = {}) {
  const fetchImplementation = options.fetch ?? fetch;
  const retryDelays = options.retryDelays ?? defaultRetryDelays;
  const path = join(directory, fileNameFromUrl(url));
  for (let attempt = 0; ; attempt += 1) {
    try {
      await downloadOnce(url, path, fetchImplementation);
      return path;
    } catch (error) {
      if (!error.retryable || attempt >= retryDelays.length) {
        throw new Error(`Downloading ${describeUrl(url)} failed: ${error.message}`);
      }
      await new Promise((done) => setTimeout(done, retryDelays[attempt]));
    }
  }
}

async function downloadOnce(url, path, fetchImplementation) {
  const response = await followRedirects(url, fetchImplementation);
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(`the server answered ${response.status}.`, isRetryableStatus(response.status));
  }
  if (!response.body) throw failure('the response is empty.', false);
  const expected = response.headers.has('content-encoding')
    ? undefined
    : parseLength(response.headers.get('content-length'));
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(path));
  } catch (error) {
    throw failure(`the connection failed (${reasonOf(error)}).`, true);
  }
  if (expected !== undefined && received !== expected) {
    throw failure(`received ${received} of ${expected} bytes.`, true);
  }
  if (received === 0) throw failure('the response is empty.', false);
}

async function followRedirects(start, fetchImplementation) {
  let current = start;
  for (let hop = 0; hop <= maximumRedirects; hop += 1) {
    let response;
    try {
      response = await fetchImplementation(current, {redirect: 'manual'});
    } catch (error) {
      throw failure(`the connection failed (${reasonOf(error)}).`, true);
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    current = new URL(location, current);
    if (current.protocol !== 'https:') {
      throw failure('the server redirected to a URL that is not https://.', false);
    }
  }
  throw failure(`the server redirected more than ${maximumRedirects} times.`, false);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseLength(value) {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  return Number(value);
}

function reasonOf(error) {
  return error?.cause?.code ?? error?.code ?? 'network error';
}

function failure(message, retryable) {
  return Object.assign(new Error(message), {retryable});
}
