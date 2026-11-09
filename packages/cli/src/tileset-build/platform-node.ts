import {createHash} from 'node:crypto';
import {closeSync, openSync, readSync, unlinkSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {gzip} from 'node:zlib';
import type {TilesetFile, TilesetPlatform} from './platform';

class NodeFile implements TilesetFile {
  readonly #descriptor: number;

  constructor(private readonly path: string) {
    this.#descriptor = openSync(path, 'w+');
  }

  close(): void {
    closeSync(this.#descriptor);
  }

  discard(): void {
    closeSync(this.#descriptor);
    unlinkSync(this.path);
  }

  read(target: Uint8Array, position: number): number {
    return readSync(this.#descriptor, target, 0, target.length, position);
  }

  write(source: Uint8Array, position: number): void {
    let written = 0;
    while (written < source.length) {
      written += writeSync(
        this.#descriptor,
        source,
        written,
        source.length - written,
        position + written,
      );
    }
  }
}

/** Temporary files under `directory`, gzip on the thread pool, and the event loop for yielding. */
export function nodeTilesetPlatform(directory: string): TilesetPlatform {
  return {
    digest: (bytes) => createHash('sha1').update(bytes).digest('base64'),
    gzip: (bytes) =>
      new Promise((resolve, reject) => {
        gzip(bytes, (error, result) => (error ? reject(error) : resolve(result)));
      }),
    storage: {create: (name) => new NodeFile(join(directory, name))},
    yield: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
