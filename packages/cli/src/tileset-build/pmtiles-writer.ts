import {zxyToTileId} from 'pmtiles';
import {TilesetBuildError} from './errors';
import {concatBytes, type TilesetFile, type TilesetPlatform} from './platform';

const headerBytes = 127;
const rootLimitBytes = 16_384 - headerBytes;
const maximumEntries = 16_000_000;
/**
 * Hosted validation may still hold about 128 bytes per distinct tile range of a clustered archive
 * within a 32 MiB budget, which rejects it at 262,144 ranges. Past this margin the tiles keep their
 * TileID layout and the archive is flagged unclustered, which every validator accepts.
 */
const maximumClusteredContents = 200_000;
const deduplicatedTileBytes = 4096;
const maximumKnownContents = 2_000_000;
const concurrentCompression = 8;

export type ArchiveSummary = Readonly<{
  addressedTiles: number;
  byteCount: number;
  tileContents: number;
  tileEntries: number;
}>;

export type ArchiveHeaderFields = Readonly<{
  bounds: readonly [number, number, number, number];
  center: readonly [number, number, number];
  maxzoom: number;
  minzoom: number;
}>;

type Entry = {
  content: number;
  length: number;
  offset: number;
  runLength: number;
  tileId: number;
};

/** Collects compressed tiles in any order and lays them out in TileID order at the end. */
export class TileArchiveWriter {
  #data: TilesetFile | null;
  #dataOffset = 0;
  #contentOffsets: number[] = [];
  #contentLengths: number[] = [];
  #tileIds = new Float64Array(1024);
  #runLengths = new Float64Array(1024);
  #contents = new Int32Array(1024);
  #entryCount = 0;
  #addressed = 0;
  readonly #known = new Map<string, number>();
  readonly #pending = new Set<Promise<void>>();
  #failure: unknown = null;

  constructor(private readonly platform: TilesetPlatform) {
    this.#data = platform.storage.create('tiles.bin');
  }

  get tileCount(): number {
    return this.#entryCount;
  }

  /** Register tile bytes and return a content reference other tiles may share. */
  async addTile(z: number, x: number, y: number, tile: Uint8Array): Promise<number> {
    let content = -1;
    let identity: string | null = null;
    if (tile.length <= deduplicatedTileBytes) {
      identity = this.platform.digest(tile);
      content = this.#known.get(identity) ?? -1;
    }
    if (content < 0) {
      content = this.#contentOffsets.length;
      this.#contentOffsets.push(-1);
      this.#contentLengths.push(0);
      if (identity !== null && this.#known.size < maximumKnownContents) {
        this.#known.set(identity, content);
      }
      await this.#compress(content, tile);
    }
    this.#addEntry(zxyToTileId(z, x, y), 1, content);
    return content;
  }

  /** Point a whole z/x/y subtree level at one content; Hilbert ordering keeps it contiguous. */
  addSubtreeLevel(z: number, x: number, y: number, depth: number, content: number): void {
    const levelStart = (4 ** (z + depth) - 1) / 3;
    const span = 4 ** depth;
    const sample = zxyToTileId(z + depth, x * 2 ** depth, y * 2 ** depth) - levelStart;
    this.#addEntry(levelStart + Math.floor(sample / span) * span, span, content);
  }

  /** Wait for compression, then write the finished archive. Tile contents are copied in order. */
  async finish(
    archiveName: string,
    fields: ArchiveHeaderFields,
    metadata: string,
  ): Promise<ArchiveSummary> {
    await Promise.all(this.#pending);
    if (this.#failure) throw this.#failure;
    const input = this.#data as TilesetFile;
    this.#data = null;

    const entries = this.#sortedEntries();
    const output = this.platform.storage.create(archiveName);
    try {
      return await this.#layOut(entries, input, output, fields, metadata);
    } finally {
      output.close();
      input.discard();
    }
  }

  close(): void {
    this.#data?.discard();
    this.#data = null;
  }

  #addEntry(tileId: number, runLength: number, content: number): void {
    if (this.#entryCount === maximumEntries) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_TOO_MANY_TILES',
        'zoom',
        `The archive would exceed ${maximumEntries} tile entries. Lower --maxzoom.`,
      );
    }
    if (this.#entryCount === this.#tileIds.length) {
      const size = this.#entryCount * 2;
      const tileIds = new Float64Array(size);
      const runLengths = new Float64Array(size);
      const contents = new Int32Array(size);
      tileIds.set(this.#tileIds);
      runLengths.set(this.#runLengths);
      contents.set(this.#contents);
      this.#tileIds = tileIds;
      this.#runLengths = runLengths;
      this.#contents = contents;
    }
    this.#tileIds[this.#entryCount] = tileId;
    this.#runLengths[this.#entryCount] = runLength;
    this.#contents[this.#entryCount] = content;
    this.#entryCount += 1;
    this.#addressed += runLength;
  }

  /** Tile compression runs on the thread pool; results land in completion order, which is fine. */
  async #compress(content: number, tile: Uint8Array): Promise<void> {
    while (this.#pending.size >= concurrentCompression) await Promise.race(this.#pending);
    if (this.#failure) throw this.#failure;
    const task: Promise<void> = this.platform
      .gzip(tile)
      .then((compressed) => {
        if (this.#data === null) return; // The build failed while this tile was compressing.
        this.#data.write(compressed, this.#dataOffset);
        this.#contentOffsets[content] = this.#dataOffset;
        this.#contentLengths[content] = compressed.length;
        this.#dataOffset += compressed.length;
      })
      .catch((error: unknown) => {
        this.#failure = error;
      })
      .finally(() => {
        this.#pending.delete(task);
      });
    this.#pending.add(task);
  }

  #sortedEntries(): Uint32Array {
    const order = new Uint32Array(this.#entryCount);
    for (let index = 0; index < order.length; index += 1) order[index] = index;
    const tileIds = this.#tileIds;
    return order.sort((left, right) => tileIds[left] - tileIds[right]);
  }

  async #layOut(
    order: Uint32Array,
    input: TilesetFile,
    output: TilesetFile,
    fields: ArchiveHeaderFields,
    metadata: string,
  ): Promise<ArchiveSummary> {
    // A first pass assigns final offsets: each content lands where its first tile needs it.
    const finalOffsets = new Float64Array(this.#contentOffsets.length).fill(-1);
    const contentOrder: number[] = [];
    let tileDataLength = 0;
    const entries: Entry[] = [];
    for (const index of order) {
      const content = this.#contents[index];
      const tileId = this.#tileIds[index];
      const runLength = this.#runLengths[index];
      const previous = entries.at(-1);
      if (
        previous &&
        previous.content === content &&
        previous.tileId + previous.runLength === tileId
      ) {
        previous.runLength += runLength;
        continue;
      }
      if (finalOffsets[content] < 0) {
        finalOffsets[content] = tileDataLength;
        contentOrder.push(content);
        tileDataLength += this.#contentLengths[content];
      }
      entries.push({
        content,
        length: this.#contentLengths[content],
        offset: finalOffsets[content],
        runLength,
        tileId,
      });
    }

    const {leaves, root} = await this.#buildDirectories(entries);
    const metadataBytes = await this.platform.gzip(new TextEncoder().encode(metadata));
    const rootOffset = headerBytes;
    const metadataOffset = rootOffset + root.length;
    const leafOffset = metadataOffset + metadataBytes.length;
    const dataOffset = leafOffset + leaves.length;
    const clustered = contentOrder.length <= maximumClusteredContents;
    const header = new Uint8Array(headerBytes);
    const view = new DataView(header.buffer);
    header.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]); // "PMTiles"
    header[7] = 3;
    const writeOffsets: Array<[number, number]> = [
      [8, rootOffset],
      [16, root.length],
      [24, metadataOffset],
      [32, metadataBytes.length],
      [40, leafOffset],
      [48, leaves.length],
      [56, dataOffset],
      [64, tileDataLength],
      [72, this.#addressed],
      [80, entries.length],
      [88, contentOrder.length],
    ];
    for (const [position, value] of writeOffsets) view.setBigUint64(position, BigInt(value), true);
    header[96] = clustered ? 1 : 0;
    header[97] = 2; // Gzip directories and metadata.
    header[98] = 2; // Gzip tiles.
    header[99] = 1; // Mapbox Vector Tile.
    header[100] = fields.minzoom;
    header[101] = fields.maxzoom;
    view.setInt32(102, Math.round(fields.bounds[0] * 1e7), true);
    view.setInt32(106, Math.round(fields.bounds[1] * 1e7), true);
    view.setInt32(110, Math.round(fields.bounds[2] * 1e7), true);
    view.setInt32(114, Math.round(fields.bounds[3] * 1e7), true);
    header[118] = fields.center[2];
    view.setInt32(119, Math.round(fields.center[0] * 1e7), true);
    view.setInt32(123, Math.round(fields.center[1] * 1e7), true);

    let cursor = 0;
    for (const section of [header, root, metadataBytes, leaves]) {
      output.write(section, cursor);
      cursor += section.length;
    }
    let buffer = new Uint8Array(1024 * 1024);
    for (const content of contentOrder) {
      const length = this.#contentLengths[content];
      if (length > buffer.length) buffer = new Uint8Array(length);
      const tile = buffer.subarray(0, length);
      input.read(tile, this.#contentOffsets[content]);
      output.write(tile, cursor);
      cursor += length;
    }
    return {
      addressedTiles: this.#addressed,
      byteCount: dataOffset + tileDataLength,
      tileContents: contentOrder.length,
      tileEntries: entries.length,
    };
  }

  /** Root directory first; when it will not fit, spill to one level of leaf directories. */
  async #buildDirectories(
    entries: readonly Entry[],
  ): Promise<{leaves: Uint8Array; root: Uint8Array}> {
    const root = await this.#serializeDirectory(entries);
    if (root.length <= rootLimitBytes) return {leaves: new Uint8Array(0), root};
    for (let leafSize = 4096; ; leafSize = Math.ceil(leafSize * 1.2)) {
      const rootEntries: Entry[] = [];
      const leaves: Uint8Array[] = [];
      let offset = 0;
      for (let start = 0; start < entries.length; start += leafSize) {
        const leaf = await this.#serializeDirectory(entries.slice(start, start + leafSize));
        rootEntries.push({
          content: -1,
          length: leaf.length,
          offset,
          runLength: 0,
          tileId: entries[start].tileId,
        });
        leaves.push(leaf);
        offset += leaf.length;
      }
      const serialized = await this.#serializeDirectory(rootEntries);
      if (serialized.length <= rootLimitBytes) {
        return {leaves: concatBytes(leaves), root: serialized};
      }
    }
  }

  #serializeDirectory(entries: readonly Entry[]): Promise<Uint8Array> {
    const bytes = new Uint8Array(10 + entries.length * 40);
    let cursor = 0;
    const varint = (value: number) => {
      while (value >= 0x80) {
        bytes[cursor] = (value % 0x80) | 0x80;
        cursor += 1;
        value = Math.floor(value / 0x80);
      }
      bytes[cursor] = value;
      cursor += 1;
    };
    varint(entries.length);
    let lastId = 0;
    for (const entry of entries) {
      varint(entry.tileId - lastId);
      lastId = entry.tileId;
    }
    for (const entry of entries) varint(entry.runLength);
    for (const entry of entries) varint(entry.length);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const previous = entries[index - 1];
      const contiguous = previous && entry.offset === previous.offset + previous.length;
      varint(contiguous ? 0 : entry.offset + 1);
    }
    return this.platform.gzip(bytes.subarray(0, cursor));
  }
}
