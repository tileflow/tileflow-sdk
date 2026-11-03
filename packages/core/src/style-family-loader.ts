import {
  parseTileflowStyleFamily,
  type TileflowStyleFamily,
  tileflowStyleFamilyLimits,
} from './style-family';

/** Read a shared family with a strict streaming bound; caller owns cache and request lifetime. */
export async function loadTileflowStyleFamily(
  url: string,
  options: {fetch?: typeof fetch; signal?: AbortSignal} = {},
): Promise<TileflowStyleFamily> {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await request(url, {credentials: 'same-origin', signal: options.signal});
  if (!response.ok) throw new Error(`Tileflow style family request failed: ${response.status}`);
  const maximum = tileflowStyleFamilyLimits.documentBytes;
  const length = response.headers.get('content-length');
  if (length && Number(length) > maximum) {
    await response.body?.cancel();
    throw new TypeError('Tileflow style family is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Tileflow style family response has no body.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new TypeError('Tileflow style family is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return parseTileflowStyleFamily(
    JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)),
  );
}
