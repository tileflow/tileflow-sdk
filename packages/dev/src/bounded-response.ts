/** Reads a response without ever buffering more than the declared bound. */
export async function readBoundedTileflowResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('invalid response byte limit');
  }
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
    await response.body?.cancel('response exceeds byte limit');
    throw new Error('response exceeds byte limit');
  }
  if (!response.body) throw new Error('response body is unavailable');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (byteLength + value.byteLength > maximumBytes) {
        await reader.cancel('response exceeds byte limit');
        throw new Error('response exceeds byte limit');
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Reads and strictly decodes a bounded UTF-8 JSON response. */
export async function readBoundedTileflowJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedTileflowResponse(response, maximumBytes);
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
