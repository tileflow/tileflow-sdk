/** Shared bounded response reader for style documents and browser font resources. */
export async function readBoundedTileflowBrowserResource(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeds the maximum response size.`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds the maximum response size.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
