import type {TileflowNativeManifestOperation} from '@tileflow/core/native';

export const nativePreparationLimits = Object.freeze({
  styleBytes: 8_388_608,
  tileJsonBytes: 1_048_576,
  depth: 64,
  nodes: 540_000,
  sources: 128,
  layers: 4096,
  fontFaces: 16,
  documents: 32,
  totalBytes: 16_777_216,
});

export class NativePreparationError extends Error {
  readonly code = 'NATIVE_PREPARATION_INVALID';
  constructor() {
    super('Native style preparation failed.');
    this.name = 'NativePreparationError';
  }
}

function decode(bytes: Uint8Array): string {
  const pieces: string[] = [];
  let text = '';
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++];
    let code: number;
    let count: number;
    let minimum: number;
    if (first <= 0x7f) {
      code = first;
      count = 0;
      minimum = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      code = first & 31;
      count = 1;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 15;
      count = 2;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 7;
      count = 3;
      minimum = 0x10000;
    } else throw new NativePreparationError();
    if (index + count > bytes.length) throw new NativePreparationError();
    for (let part = 0; part < count; part++) {
      const next = bytes[index++];
      if ((next & 0xc0) !== 0x80) throw new NativePreparationError();
      code = code * 64 + (next & 63);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      throw new NativePreparationError();
    text += String.fromCodePoint(code);
    if (text.length >= 4096) {
      pieces.push(text);
      text = '';
    }
  }
  pieces.push(text);
  return pieces.join('').replace(/^\uFEFF/u, '');
}

function depthBeforeParse(text: string): void {
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > nativePreparationLimits.depth) throw new NativePreparationError();
    } else if (character === '}' || character === ']') depth--;
  }
}

export function nativeJsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new NativePreparationError();
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > nativePreparationLimits.styleBytes) throw new NativePreparationError();
  }
  return bytes;
}

/** Prepared artifact budget, not authoring validation or a compiler import. */
export function freezeNativePreparedJson(value: unknown): Readonly<Record<string, unknown>> {
  let nodes = 0;
  const parents = new Set<object>();
  const visit = (input: unknown, depth: number): void => {
    if (++nodes > nativePreparationLimits.nodes || depth > nativePreparationLimits.depth)
      throw new NativePreparationError();
    if (input === null || typeof input === 'boolean') return;
    if (typeof input === 'number' && Number.isFinite(input)) return;
    if (typeof input === 'string') return;
    if (!input || typeof input !== 'object' || parents.has(input))
      throw new NativePreparationError();
    const array = Array.isArray(input);
    if (
      !array &&
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    )
      throw new NativePreparationError();
    const keys = Reflect.ownKeys(input);
    if (
      array &&
      (input.length > nativePreparationLimits.nodes || Object.keys(input).length !== input.length)
    )
      throw new NativePreparationError();
    parents.add(input);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key === '__proto__' || key === 'toJSON')
        throw new NativePreparationError();
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property || !property.enumerable || !('value' in property))
        throw new NativePreparationError();
      visit(key, depth + 1);
      visit(property.value, depth + 1);
    }
    parents.delete(input);
    Object.freeze(input);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NativePreparationError();
  visit(value, 0);
  nativeJsonBytes(value);
  return value as Readonly<Record<string, unknown>>;
}

export async function readNativeStyleDocument(
  operation: TileflowNativeManifestOperation,
  maximumBytes: number,
  current: () => boolean,
): Promise<Readonly<{url: string; value: Readonly<Record<string, unknown>>; bytes: number}>> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (
      !current() ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > nativePreparationLimits.styleBytes
    )
      throw new NativePreparationError();
    const response = await operation.response;
    if (!current() || response.status !== 200) throw new NativePreparationError();
    for (;;) {
      const bound = Math.min(65536, maximumBytes - length + 1);
      const next = await response.reader.read(bound);
      if (!current()) throw new NativePreparationError();
      if (next.done === true) break;
      if (
        next.done !== false ||
        !(next.value instanceof Uint8Array) ||
        !next.value.length ||
        next.value.length > bound
      )
        throw new NativePreparationError();
      length += next.value.length;
      if (length > maximumBytes) throw new NativePreparationError();
      chunks.push(next.value.slice());
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
      chunk.fill(0);
    }
    chunks.length = 0;
    let text: string;
    try {
      text = decode(bytes);
    } finally {
      bytes.fill(0);
    }
    depthBeforeParse(text);
    const value = freezeNativePreparedJson(JSON.parse(text));
    if (!current()) throw new NativePreparationError();
    return Object.freeze({url: response.url, value, bytes: length});
  } catch {
    try {
      void Promise.resolve(operation.cancel()).catch(() => undefined);
    } catch {
      /* Caller retains retry ownership. */
    }
    throw new NativePreparationError();
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}
