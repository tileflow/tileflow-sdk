/**
 * What the tiling core needs from its host. Files are synchronous because the tiler reads and writes
 * them from inside tight loops; compression is asynchronous because it can leave the thread.
 */
export type TilesetFile = {
  /** Release the handle and keep the contents. */
  close(): void;
  /** Release the handle and delete the contents. */
  discard(): void;
  /** Fill `target` from `position` and return the number of bytes read; 0 at the end. */
  read(target: Uint8Array, position: number): number;
  /** Write every byte of `source` at `position`. */
  write(source: Uint8Array, position: number): void;
};

export type TilesetStorage = {
  /** Create an empty readable and writable file. The name is unique within the build. */
  create(name: string): TilesetFile;
};

export type TilesetPlatform = Readonly<{
  /** A collision-resistant identity for bytes. Only equality matters. */
  digest(bytes: Uint8Array): string;
  gzip(bytes: Uint8Array): Promise<Uint8Array>;
  storage: TilesetStorage;
  /** Let queued work run. Called every few hundred tiles. */
  yield(): Promise<void>;
}>;

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    joined.set(chunk, cursor);
    cursor += chunk.length;
  }
  return joined;
}

/** The bytes `value` takes as UTF-8, counting a lone surrogate as its 3-byte replacement. */
export function utf8ByteLength(value: string): number {
  let bytes = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) continue;
    if (unit < 0x800) {
      bytes += 1;
    } else {
      bytes += 2;
      if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      }
    }
  }
  return bytes;
}
