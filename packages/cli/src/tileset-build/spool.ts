import {closeSync, openSync, readSync, unlinkSync, writeSync} from 'node:fs';
import {join} from 'node:path';

/*
 * Features move through the tile pyramid as flat int32 records:
 *   header | part sizes | x,y world coordinates | properties (padded to a word)
 * World coordinates span 0..2^31 across Web Mercator, about 2 cm per unit at the equator.
 */
export const field = {
  words: 0,
  type: 1,
  minX: 2,
  minY: 3,
  maxX: 4,
  maxY: 5,
  parts: 6,
  points: 7,
  propertyBytes: 8,
  idLow: 9,
  idHigh: 10,
} as const;
export const headerWords = 11;
export const worldSize = 2 ** 31;

export const geometryType = {line: 2, point: 1, polygon: 3} as const;

const memoryLimitWords = (4 * 1024 * 1024) / 4;
const fileBufferWords = (1024 * 1024) / 4;
const readChunkWords = (16 * 1024 * 1024) / 4;

export class SpoolDirectory {
  #next = 0;
  constructor(readonly path: string) {}
  nextFile(): string {
    return join(this.path, `spool-${(this.#next += 1)}`);
  }
}

/** Sequential record storage that stays in memory until it outgrows a small budget. */
export class FeatureSpool {
  words = new Int32Array(1024);
  length = 0;
  count = 0;
  #descriptor: number | null = null;
  #path: string | null = null;

  constructor(private readonly directory: SpoolDirectory) {}

  /** Return the offset of `size` writable words in `this.words`. */
  reserve(size: number): number {
    if (this.length + size > this.words.length) this.#makeRoom(size);
    const offset = this.length;
    this.length += size;
    this.count += 1;
    return offset;
  }

  append(source: Int32Array, offset: number, size: number): void {
    const target = this.reserve(size);
    this.words.set(source.subarray(offset, offset + size), target);
  }

  /** Visit each record; `words` is only valid during the callback. */
  forEach(visit: (words: Int32Array, offset: number) => void): void {
    if (this.#path === null) {
      visitRecords(this.words, this.length, visit);
      return;
    }
    this.#flush();
    if (this.#descriptor !== null) {
      closeSync(this.#descriptor);
      this.#descriptor = null;
    }
    const descriptor = openSync(this.#path, 'r');
    try {
      let chunk = new Int32Array(readChunkWords);
      let carried = 0;
      for (;;) {
        const bytes = readSync(
          descriptor,
          new Uint8Array(chunk.buffer),
          carried * 4,
          (chunk.length - carried) * 4,
          null,
        );
        const available = carried + bytes / 4;
        const consumed = visitRecords(chunk, available, visit);
        carried = available - consumed;
        if (bytes === 0) break;
        chunk.copyWithin(0, consumed, available);
        // One record can exceed the chunk: a polygon with millions of vertices.
        if (carried > 0 && chunk[field.words] > chunk.length) {
          const larger = new Int32Array(chunk[field.words] * 2);
          larger.set(chunk.subarray(0, carried));
          chunk = larger;
        }
      }
    } finally {
      closeSync(descriptor);
    }
  }

  dispose(): void {
    if (this.#descriptor !== null) closeSync(this.#descriptor);
    if (this.#path !== null) unlinkSync(this.#path);
    this.#descriptor = null;
    this.#path = null;
    this.words = new Int32Array(0);
    this.length = 0;
  }

  #makeRoom(size: number): void {
    if (this.#path === null && this.length + size > memoryLimitWords) {
      this.#path = this.directory.nextFile();
      this.#descriptor = openSync(this.#path, 'w');
    }
    if (this.#path !== null) {
      this.#flush();
      if (size <= fileBufferWords && this.words.length >= fileBufferWords) return;
    }
    const needed = this.length + size;
    const capacity = Math.max(needed, Math.min(this.words.length * 2, memoryLimitWords));
    const grown = new Int32Array(this.#path === null ? capacity : Math.max(size, fileBufferWords));
    grown.set(this.words.subarray(0, this.length));
    this.words = grown;
  }

  #flush(): void {
    if (this.length === 0 || this.#descriptor === null) return;
    const bytes = new Uint8Array(this.words.buffer, 0, this.length * 4);
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(this.#descriptor, bytes, written, bytes.length - written);
    }
    this.length = 0;
  }
}

function visitRecords(
  words: Int32Array,
  available: number,
  visit: (words: Int32Array, offset: number) => void,
): number {
  let offset = 0;
  while (offset < available) {
    const size = words[offset + field.words];
    if (offset + size > available) break;
    visit(words, offset);
    offset += size;
  }
  return offset;
}
