/**
 * Locate provenance in the canonical Hosted request without decoding its style documents.
 * Return original JSON slices so the server can hash a large request without copying it.
 * Byte ranges outside the recognized paths always contribute to the identity.
 */
export function hostedPublicationContentParts(
  bytes: Uint8Array,
  acceptProvenance: (path: string, bytes: Uint8Array) => boolean,
): Uint8Array[] {
  const targets = new Set([
    'source',
    'artifact/buildManifest/provenance',
    'artifact/renderers/web/buildManifest/provenance',
    'artifact/renderers/native/buildManifest/provenance',
    'artifact/renderers/native/buildRecord/buildManifestSha256',
  ]);
  const parents = new Set(
    [...targets].flatMap((path) => {
      const components = path.split('/');
      return components.map((_, index) => components.slice(0, index).join('/'));
    }),
  );
  const decode = new TextDecoder('utf-8', {fatal: true});
  const result: Uint8Array[] = [];
  let cursor = 0;
  let kept = 0;

  function string() {
    const start = cursor++;
    while (cursor < bytes.length) {
      const byte = bytes[cursor++];
      if (byte === 92) cursor += 1;
      else if (byte === 34) return bytes.subarray(start, cursor);
    }
    throw new Error();
  }

  function value(path: string) {
    if (bytes[cursor] === 123 && parents.has(path)) {
      cursor++;
      while (bytes[cursor] === 34) {
        const key = decode.decode(string());
        if (bytes[cursor++] !== 58) throw new Error();
        const start = cursor;
        const name = key.slice(1, -1);
        const child = name.includes('/') ? '!' : (path ? `${path}/` : '') + name;
        value(child);
        if (targets.has(child) && cursor - start <= 16 * 1024) {
          const provenance = bytes.subarray(start, cursor);
          if (acceptProvenance(child, provenance)) {
            result.push(bytes.subarray(kept, start));
            kept = cursor;
          }
        }
        if (bytes[cursor] !== 44) break;
        cursor++;
      }
      if (bytes[cursor++] !== 125) throw new Error();
    } else if (bytes[cursor] === 123 || bytes[cursor] === 91) {
      let depth = 0;
      do {
        if (bytes[cursor] === 34) string();
        else {
          const byte = bytes[cursor++];
          if (byte === 123 || byte === 91) depth++;
          if (byte === 125 || byte === 93) depth--;
        }
      } while (depth > 0 && cursor < bytes.length);
      if (depth !== 0) throw new Error();
    } else if (bytes[cursor] === 34) string();
    else {
      const start = cursor;
      while (cursor < bytes.length && ![44, 93, 125].includes(bytes[cursor]!)) cursor++;
      if (cursor === start) throw new Error();
    }
  }

  try {
    value('');
    if (cursor !== bytes.length) return [bytes];
    if (kept) result.push(bytes.subarray(kept));
    return kept ? result : [bytes];
  } catch {
    return [bytes];
  }
}

export async function hashHostedPublicationContent(parts: readonly Uint8Array[]): Promise<string> {
  const digest = async (bytes: Uint8Array) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  return digest(
    new TextEncoder().encode(
      JSON.stringify(['tileflow-hosted-content-v1', ...(await Promise.all(parts.map(digest)))]),
    ),
  );
}
