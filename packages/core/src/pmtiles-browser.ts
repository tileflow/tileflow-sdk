import {Compression, findTile, PMTiles, TileType, zxyToTileId} from 'pmtiles';

export type TileflowPmtilesProtocolHandler = (
  request: Readonly<{type?: string; url: string}>,
  abortController: AbortController,
) => Promise<Readonly<{cacheControl?: string; data: unknown; expires?: string}>>;

export type TileflowPmtilesProtocolRegistry = Readonly<{
  addProtocol: (name: string, handler: TileflowPmtilesProtocolHandler) => void;
}>;

export type TileflowPmtilesProtocolRegistrationOptions = Readonly<{
  maximumDirectoryDepth?: number;
}>;

type ProtocolRequest = Readonly<{type?: string; url: string}>;
type ProtocolResponse = Readonly<{
  cacheControl?: string;
  data: unknown;
  expires?: string;
}>;

const registeredPmtilesProtocols = new WeakSet<TileflowPmtilesProtocolRegistry['addProtocol']>();
const maximumSectionBytes = 16 * 1024 * 1024;
const maximumParserBytes = 32 * 1024 * 1024;
const estimatedEntryBytes = 128;
export const tileflowPmtilesMaximumDirectoryDepth = 32 as const;
export const tileflowPmtilesProtocol = 'tileflow-pmtiles' as const;
const protocolPrefix = `${tileflowPmtilesProtocol}://`;

/** Register only Tileflow's managed PMTiles namespace. Third-party `pmtiles://` remains untouched. */
export function registerTileflowPmtilesProtocol(
  registry: TileflowPmtilesProtocolRegistry,
  options: TileflowPmtilesProtocolRegistrationOptions = {},
): void {
  if (registeredPmtilesProtocols.has(registry.addProtocol)) return;
  const maximumDirectoryDepth = normalizeMaximumDirectoryDepth(options.maximumDirectoryDepth);
  registry.addProtocol(
    tileflowPmtilesProtocol,
    new TileflowPmtilesProtocol(maximumDirectoryDepth).tile,
  );
  registeredPmtilesProtocols.add(registry.addProtocol);
}

class TileflowPmtilesProtocol {
  readonly #archives = new Map<string, TileflowPmtilesArchive>();

  constructor(private readonly maximumDirectoryDepth: number) {}

  readonly tilev4 = async (
    request: ProtocolRequest,
    abortController: AbortController,
  ): Promise<ProtocolResponse> => {
    if (request.type === 'json') {
      const archive = this.#archive(parseArchiveTarget(request.url));
      const header = await archive.getHeader();
      const tileJson = await archive.getTileJson(request.url);
      const data =
        header.tileType === TileType.Mlt && isRecord(tileJson)
          ? {...tileJson, encoding: 'mlt'}
          : tileJson;
      abortController.signal.throwIfAborted();
      return {data};
    }

    const parsed = parseTileTarget(request.url);
    const archive = this.#archive(parsed.archive);
    const header = await archive.getHeader();
    const response = await archive.getZxy(parsed.z, parsed.x, parsed.y, abortController.signal);
    abortController.signal.throwIfAborted();
    if (response) {
      return {
        data: new Uint8Array(response.data),
        ...(response.cacheControl ? {cacheControl: response.cacheControl} : {}),
        ...(response.expires ? {expires: response.expires} : {}),
      };
    }
    return {
      data:
        header.tileType === TileType.Mvt || header.tileType === TileType.Mlt
          ? new Uint8Array()
          : null,
    };
  };

  readonly tile = protocolCompatibility(this.tilev4) as TileflowPmtilesProtocolHandler;

  #archive(target: string): TileflowPmtilesArchive {
    let archive = this.#archives.get(target);
    if (!archive) {
      archive = new TileflowPmtilesArchive(target, this.maximumDirectoryDepth);
      this.#archives.set(target, archive);
    }
    return archive;
  }
}

class TileflowPmtilesArchive extends PMTiles {
  constructor(
    source: string,
    private readonly maximumDirectoryDepth: number,
  ) {
    super(source, undefined, boundedDecompress);
  }

  override async getZxyAttempt(z: number, x: number, y: number, signal?: AbortSignal) {
    const tileId = zxyToTileId(z, x, y);
    const header = await this.cache.getHeader(this.source);
    signal?.throwIfAborted();
    if (z < header.minZoom || z > header.maxZoom) return undefined;
    let offset = header.rootDirectoryOffset;
    let length = header.rootDirectoryLength;
    const ancestors = new Set<string>();
    let entriesRead = 0;

    for (let depth = 0; depth <= this.maximumDirectoryDepth; depth += 1) {
      const key = `${offset}:${length}`;
      if (ancestors.has(key)) throw new Error('Tileflow PMTiles directory cycle is invalid.');
      ancestors.add(key);
      const directory = await this.cache.getDirectory(this.source, offset, length, header);
      signal?.throwIfAborted();
      entriesRead += directory.length;
      if (entriesRead * estimatedEntryBytes > maximumParserBytes) {
        throw new Error('Tileflow PMTiles traversal exceeded its memory budget.');
      }
      const entry = findTile(directory, tileId);
      if (!entry) return undefined;
      if (entry.runLength > 0) {
        assertRelativeRange(entry.offset, entry.length, header.tileDataLength ?? 0);
        const response = await this.source.getBytes(
          header.tileDataOffset + entry.offset,
          entry.length,
          signal,
          header.etag,
        );
        return {
          data: await this.decompress(response.data, header.tileCompression),
          cacheControl: response.cacheControl,
          expires: response.expires,
        };
      }
      assertRelativeRange(entry.offset, entry.length, header.leafDirectoryLength ?? 0);
      offset = header.leafDirectoryOffset + entry.offset;
      length = entry.length;
    }
    throw new Error('Tileflow PMTiles directory depth exceeds its operational limit.');
  }
}

async function boundedDecompress(
  buffer: ArrayBuffer,
  compression: Compression,
): Promise<ArrayBuffer> {
  if (buffer.byteLength > maximumSectionBytes) {
    throw new Error('Tileflow PMTiles section exceeds its operational limit.');
  }
  if (compression === Compression.None) return buffer;
  if (compression !== Compression.Gzip) {
    throw new Error('Tileflow PMTiles compression is unsupported.');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maximumSectionBytes) {
        await reader.cancel();
        throw new Error('Tileflow PMTiles decompression exceeds its operational limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function parseArchiveTarget(url: string): string {
  if (!url.startsWith(protocolPrefix)) throw new Error('Invalid Tileflow PMTiles protocol URL.');
  const target = url.slice(protocolPrefix.length);
  if (!target) throw new Error('Invalid Tileflow PMTiles archive URL.');
  return target;
}

function parseTileTarget(url: string): {archive: string; x: number; y: number; z: number} {
  const target = parseArchiveTarget(url);
  const match = /^(.*)\/(\d+)\/(\d+)\/(\d+)(?:\.[A-Za-z0-9]+)?$/u.exec(target);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    throw new Error('Invalid Tileflow PMTiles tile URL.');
  }
  return {archive: match[1], x: Number(match[3]), y: Number(match[4]), z: Number(match[2])};
}

function assertRelativeRange(offset: number, length: number, sectionLength: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    offset < 0 ||
    offset > sectionLength - length ||
    length > maximumSectionBytes
  ) {
    throw new Error('Tileflow PMTiles directory range is invalid.');
  }
}

function normalizeMaximumDirectoryDepth(value: number | undefined): number {
  const depth = value ?? tileflowPmtilesMaximumDirectoryDepth;
  if (!Number.isInteger(depth) || depth < 1 || depth > 64) {
    throw new Error('Tileflow PMTiles maximumDirectoryDepth must be an integer from 1 to 64.');
  }
  return depth;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function protocolCompatibility(
  handler: (request: ProtocolRequest, controller: AbortController) => Promise<ProtocolResponse>,
) {
  return (
    request: ProtocolRequest,
    controllerOrCallback:
      | AbortController
      | ((error?: Error, data?: unknown, cacheControl?: string, expires?: string) => void),
  ) => {
    if (controllerOrCallback instanceof AbortController) {
      return handler(request, controllerOrCallback);
    }
    const controller = new AbortController();
    void handler(request, controller).then(
      (response) =>
        controllerOrCallback(
          undefined,
          response.data,
          response.cacheControl ?? '',
          response.expires ?? '',
        ),
      (error: unknown) =>
        controllerOrCallback(error instanceof Error ? error : new Error('PMTiles request failed.')),
    );
    return {cancel: () => controller.abort()};
  };
}
