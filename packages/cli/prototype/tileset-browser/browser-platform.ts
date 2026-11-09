import type {TilesetFile, TilesetPlatform} from '../../src/tileset-build/platform';

type SyncHandle = FileSystemSyncAccessHandle;

/** Live spool files stay bounded because the tiler walks depth first: four per zoom, plus margin. */
const spoolSlots = 96;
const archiveName = 'archive.pmtiles';

export type BrowserStorageReport = {
  peakBytes: number;
  readMs: number;
  reads: number;
  slotsInUseAtPeak: number;
  writeMs: number;
  writes: number;
};

/**
 * OPFS can only open a file asynchronously, but the tiler spills to disk from a synchronous call.
 * So a pool of files is opened up front, and "creating" a spool file takes one from the pool.
 */
export class OpfsStorage {
  readonly #free: SyncHandle[] = [];
  readonly #all: SyncHandle[] = [];
  #archive: SyncHandle | null = null;
  #liveBytes = 0;
  #peakBytes = 0;
  #inUse = 0;
  #inUseAtPeak = 0;
  #readMs = 0;
  #reads = 0;
  #writeMs = 0;
  #writes = 0;

  private constructor(readonly directory: FileSystemDirectoryHandle) {}

  static async open(name: string): Promise<OpfsStorage> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(name, {create: true});
    const storage = new OpfsStorage(directory);
    for (let slot = 0; slot < spoolSlots; slot += 1) {
      const file = await directory.getFileHandle(`slot-${slot}`, {create: true});
      const handle = await file.createSyncAccessHandle();
      handle.truncate(0);
      storage.#free.push(handle);
      storage.#all.push(handle);
    }
    const archive = await directory.getFileHandle(archiveName, {create: true});
    storage.#archive = await archive.createSyncAccessHandle();
    storage.#archive.truncate(0);
    return storage;
  }

  create(name: string): TilesetFile {
    const isArchive = name === archiveName;
    const handle = isArchive ? this.#archive : this.#free.pop();
    if (!handle) throw new Error(`No free OPFS slot for ${name}; ${spoolSlots} files are in use.`);
    this.#inUse += 1;
    let size = 0;
    const write = (source: Uint8Array, position: number) => {
      const started = performance.now();
      let written = 0;
      while (written < source.length) {
        written += handle.write(source.subarray(written), {at: position + written});
      }
      this.#writeMs += performance.now() - started;
      this.#writes += 1;
      const end = position + source.length;
      if (end > size) {
        this.#liveBytes += end - size;
        size = end;
        if (this.#liveBytes > this.#peakBytes) {
          this.#peakBytes = this.#liveBytes;
          this.#inUseAtPeak = this.#inUse;
        }
      }
    };
    return {
      close: () => {
        handle.flush();
        handle.close();
        this.#archive = null;
      },
      discard: () => {
        handle.truncate(0);
        this.#liveBytes -= size;
        this.#inUse -= 1;
        this.#free.push(handle);
      },
      read: (target, position) => {
        const started = performance.now();
        const bytes = handle.read(target, {at: position});
        this.#readMs += performance.now() - started;
        this.#reads += 1;
        return bytes;
      },
      write,
    };
  }

  report(): BrowserStorageReport {
    return {
      peakBytes: this.#peakBytes,
      readMs: Math.round(this.#readMs),
      reads: this.#reads,
      slotsInUseAtPeak: this.#inUseAtPeak,
      writeMs: Math.round(this.#writeMs),
      writes: this.#writes,
    };
  }

  /** Close every handle so the files can be read or removed. */
  close(): void {
    for (const handle of this.#all) handle.close();
    this.#all.length = 0;
    this.#free.length = 0;
    this.#archive?.close();
    this.#archive = null;
  }
}

export async function gzipWithCompressionStream(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    joined.set(chunk, cursor);
    cursor += chunk.length;
  }
  return joined;
}

type Waiting = {reject: (error: Error) => void; resolve: (bytes: Uint8Array) => void};

/** Compress on extra workers, since CompressionStream does its work on the calling thread. */
export class GzipPool {
  readonly #workers: Worker[] = [];
  readonly #waiting = new Map<number, Waiting>();
  readonly #loads: number[] = [];
  #next = 0;

  constructor(count: number, url: string) {
    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(url);
      worker.onmessage = ({
        data,
      }: MessageEvent<{failure?: string; id: number; output: Uint8Array}>) => {
        this.#loads[index] -= 1;
        const waiting = this.#waiting.get(data.id) as Waiting;
        this.#waiting.delete(data.id);
        if (data.failure) waiting.reject(new Error(data.failure));
        else waiting.resolve(data.output);
      };
      worker.onerror = (event) => {
        for (const waiting of this.#waiting.values()) waiting.reject(new Error(event.message));
      };
      this.#workers.push(worker);
      this.#loads.push(0);
    }
  }

  gzip(input: Uint8Array): Promise<Uint8Array> {
    this.#next += 1;
    const id = this.#next;
    let index = 0;
    for (let candidate = 1; candidate < this.#workers.length; candidate += 1) {
      if (this.#loads[candidate] < this.#loads[index]) index = candidate;
    }
    this.#loads[index] += 1;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, {reject, resolve});
      this.#workers[index].postMessage({id, input});
    });
  }

  terminate(): void {
    for (const worker of this.#workers) worker.terminate();
  }
}

/** `setTimeout` is clamped to 4 ms when nested, so yield through a message port instead. */
function messagePortYield(): () => Promise<void> {
  const channel = new MessageChannel();
  const queue: Array<() => void> = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return () =>
    new Promise((resolve) => {
      queue.push(resolve);
      channel.port2.postMessage(0);
    });
}

/** SHA-1 of bytes, as the raw 20 bytes in a string. Dedup needs a synchronous digest. */
export function sha1Identity(bytes: Uint8Array): string {
  const paddedLength = ((bytes.length + 8) >> 6) * 64 + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bytes.length * 8);
  view.setUint32(paddedLength - 8, Math.floor(bytes.length / 2 ** 29));
  const schedule = new Int32Array(80);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  for (let block = 0; block < paddedLength; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getInt32(block + index * 4);
    }
    for (let index = 16; index < 80; index += 1) {
      const mixed =
        schedule[index - 3] ^ schedule[index - 8] ^ schedule[index - 14] ^ schedule[index - 16];
      schedule[index] = (mixed << 1) | (mixed >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temporary = (((a << 5) | (a >>> 27)) + f + e + k + schedule[index]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temporary;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return String.fromCharCode(
    h0 & 0xffff,
    h0 >>> 16,
    h1 & 0xffff,
    h1 >>> 16,
    h2 & 0xffff,
    h2 >>> 16,
    h3 & 0xffff,
    h3 >>> 16,
    h4 & 0xffff,
    h4 >>> 16,
  );
}

export function browserPlatform(storage: OpfsStorage, gzipPool: GzipPool | null): TilesetPlatform {
  return {
    digest: sha1Identity,
    gzip: gzipPool ? (bytes) => gzipPool.gzip(bytes) : (bytes) => gzipWithCompressionStream(bytes),
    storage,
    yield: messagePortYield(),
  };
}
