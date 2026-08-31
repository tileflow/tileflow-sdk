import {VectorTile} from '@mapbox/vector-tile';
import {open, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzip} from 'node:zlib';
import {PbfReader} from 'pbf';
import {
  bytesToHeader,
  Compression,
  type DecompressFunc,
  findTile,
  type Header,
  PMTiles,
  ResolvedValueCache,
  type Source,
  TileType,
  zxyToTileId,
} from 'pmtiles';
import {compareCodeUnits} from '@tileflow/core';

const inspectionLimits = Object.freeze({
  maxBytes: 24_000_000,
  maxDistinctValuesPerField: 256,
  maxFeatures: 20_000,
  maxIncludedValueFields: 32,
  maxTiles: 8,
  maxValueLength: 256,
  maxValuesPerField: 16,
});
const maxArchiveBytes = 8_000_000_000;
const maximumDecodedBytes = 4 * 1024 * 1024 * 1024;
const minimumDecodedBytes = 64 * 1024 * 1024;
const maxDecompressedSectionBytes = 16 * 1024 * 1024;
const defaultMaximumDirectoryDepth = 32;
const maxDirectoryEntries = 16_777_216;
const maxParserMemoryBytes = 32 * 1024 * 1024;
const estimatedRangeMemoryBytes = 128;
const maxMetadataLayers = 256;
const maxMetadataFields = 512;
const maxTileBytes = 6_000_000;
const fieldNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

type TileCoordinate = Readonly<{x: number; y: number; z: number}>;
type FieldType = 'Boolean' | 'Number' | 'String';
type FieldValue = boolean | number | string;

export type TileflowTilesetInspectionWarning = Readonly<{
  code: string;
  message: string;
  path: string;
}>;

export type TileflowTilesetInspectionV1 = Readonly<{
  schemaVersion: 1;
  contract: Readonly<{
    authority: 'pmtiles-header-and-tilejson-v1';
    attribution?: string;
    bounds: readonly [number, number, number, number];
    center: readonly [number, number, number];
    counts: Readonly<{
      addressedTiles: number;
      declaredTileContents: number | null;
      tileEntries: number;
    }>;
    maxzoom: number;
    minzoom: number;
    sourceLayersDeclared: boolean;
    sourceLayers: readonly Readonly<{
      fieldsDeclared: boolean;
      fields: readonly Readonly<{name: string; type?: FieldType}>[];
      id: string;
      maxzoom?: number;
      minzoom?: number;
    }>[];
    tileType: 'avif' | 'jpeg' | 'mlt' | 'mvt' | 'png' | 'webp';
  }>;
  observation?: Readonly<{
    authority: 'bounded-mvt-sample-v1';
    featuresRead: number;
    includedValueFields: readonly string[];
    limits: typeof inspectionLimits;
    sourceLayers: readonly Readonly<{
      featuresRead: number;
      fields: readonly Readonly<{
        distinctValuesObserved: number;
        distinctValuesTruncated: boolean;
        featuresMissing: number;
        featuresPresent: number;
        name: string;
        numericRange?: Readonly<{max: number; min: number}>;
        observedValues?: readonly Readonly<{count: number; value: FieldValue}>[];
        observedValuesTruncated?: boolean;
        types: readonly FieldType[];
      }>[];
      geometryTypes: readonly string[];
      id: string;
    }>[];
    tiles: readonly TileCoordinate[];
    tilesRead: number;
    truncated: boolean;
  }>;
  warnings: readonly TileflowTilesetInspectionWarning[];
}>;

export type TileflowLocalTilesetInspection = Readonly<{
  contract: Pick<
    TileflowTilesetInspectionV1['contract'],
    'sourceLayers' | 'sourceLayersDeclared' | 'tileType'
  >;
  warnings: readonly TileflowTilesetInspectionWarning[];
}>;

export async function inspectTileflowPmtilesForLocalUse(
  archivePath: string,
): Promise<TileflowLocalTilesetInspection> {
  const path = resolve(archivePath);
  const archiveStat = await stat(path).catch(() => null);
  if (
    !archiveStat ||
    !archiveStat.isFile() ||
    archiveStat.size < 127 ||
    archiveStat.size > maxArchiveBytes
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Expected one bounded PMTiles file.',
    );
  }

  const handle = await open(path, 'r').catch(() => null);
  if (!handle) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Expected one readable PMTiles file.',
    );
  }

  try {
    const budget = new InspectionBudget(archiveStat.size);
    const source = new NodeFilePmtilesSource(path, handle, archiveStat.size, budget);
    const header = await readValidatedHeader(source, archiveStat.size);
    const root = await source.getBytes(header.rootDirectoryOffset, header.rootDirectoryLength);
    if (root.data.byteLength !== header.rootDirectoryLength) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Short PMTiles root directory.',
      );
    }
    await createDirectoryDecompressor(budget)(root.data, header.internalCompression);
    const metadata = await readMetadata(source, header, budget);
    const sourceLayerMetadata = normalizeSourceLayers(metadata);
    const warnings: TileflowTilesetInspectionWarning[] = [];
    if (
      (header.tileType === TileType.Mlt || header.tileType === TileType.Mvt) &&
      !sourceLayerMetadata.declared
    ) {
      warnings.push({
        code: 'TF_TILESET_SOURCE_LAYERS_UNDECLARED',
        message:
          'PMTiles metadata does not declare vector_layers; source-layer compatibility cannot be proven.',
        path: 'contract.sourceLayers',
      });
    }

    return Object.freeze({
      contract: Object.freeze({
        sourceLayers: sourceLayerMetadata.layers,
        sourceLayersDeclared: sourceLayerMetadata.declared,
        tileType: tileTypeName(header.tileType),
      }),
      warnings: Object.freeze(warnings),
    });
  } finally {
    await handle.close();
  }
}

export async function inspectTileflowPmtiles(
  archivePath: string,
  options: {
    includeValues?: readonly string[];
    maximumDirectoryDepth?: number;
    sample?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<TileflowTilesetInspectionV1> {
  const includedValueFields = normalizeIncludedValueFields(options.includeValues);
  const maximumDirectoryDepth = normalizeMaximumDirectoryDepth(options.maximumDirectoryDepth);
  if (options.sample === false && includedValueFields.length > 0) {
    throw inspectionError(
      'TF_TILESET_INSPECTION_OPTIONS_INVALID',
      'includeValues',
      'Value inspection requires bounded MVT sampling.',
    );
  }
  const path = resolve(archivePath);
  const archiveStat = await stat(path).catch(() => null);
  if (
    !archiveStat ||
    !archiveStat.isFile() ||
    archiveStat.size < 127 ||
    archiveStat.size > maxArchiveBytes
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Expected one bounded PMTiles file.',
    );
  }

  const handle = await open(path, 'r').catch(() => null);
  if (!handle) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Expected one readable PMTiles file.',
    );
  }
  try {
    const budget = new InspectionBudget(archiveStat.size);
    const source = new NodeFilePmtilesSource(path, handle, archiveStat.size, budget);
    const header = await readValidatedHeader(source, archiveStat.size);
    const counts = await validatePmtilesDirectoryTree(
      source,
      header,
      budget,
      maximumDirectoryDepth,
      options.signal,
    );
    const metadata = await readMetadata(source, header, budget);
    const sourceLayerMetadata = normalizeSourceLayers(metadata);
    const warnings: TileflowTilesetInspectionWarning[] = [];
    if (
      (header.tileType === TileType.Mlt || header.tileType === TileType.Mvt) &&
      !sourceLayerMetadata.declared
    ) {
      warnings.push({
        code: 'TF_TILESET_SOURCE_LAYERS_UNDECLARED',
        message:
          'PMTiles metadata does not declare vector_layers; source-layer compatibility cannot be proven.',
        path: 'contract.sourceLayers',
      });
    }

    const contract = Object.freeze({
      authority: 'pmtiles-header-and-tilejson-v1' as const,
      ...metadataAttribution(metadata),
      bounds: Object.freeze([
        normalizeCoordinate(header.minLon),
        normalizeCoordinate(header.minLat),
        normalizeCoordinate(header.maxLon),
        normalizeCoordinate(header.maxLat),
      ]) as readonly [number, number, number, number],
      center: Object.freeze([
        normalizeCoordinate(header.centerLon),
        normalizeCoordinate(header.centerLat),
        header.centerZoom,
      ]) as readonly [number, number, number],
      counts: Object.freeze({
        addressedTiles: counts.addressedTiles,
        declaredTileContents: header.numTileContents === 0 ? null : header.numTileContents,
        tileEntries: counts.tileEntries,
      }),
      maxzoom: header.maxZoom,
      minzoom: header.minZoom,
      sourceLayersDeclared: sourceLayerMetadata.declared,
      sourceLayers: sourceLayerMetadata.layers,
      tileType: tileTypeName(header.tileType),
    });

    const observation =
      options.sample === false || header.tileType !== TileType.Mvt
        ? undefined
        : await inspectMvtSample(
            new DeepPmtiles(
              source,
              new ResolvedValueCache(100, true, createDirectoryDecompressor(budget)),
              createSectionDecompressor(budget),
              maximumDirectoryDepth,
            ),
            header,
            includedValueFields,
            options.signal,
          );
    return Object.freeze({
      schemaVersion: 1 as const,
      contract,
      ...(observation ? {observation} : {}),
      warnings: Object.freeze(warnings),
    });
  } finally {
    await handle.close();
  }
}

class NodeFilePmtilesSource implements Source {
  constructor(
    private readonly path: string,
    private readonly handle: Awaited<ReturnType<typeof open>>,
    private readonly size: number,
    private readonly budget: InspectionBudget,
  ) {}

  getKey() {
    return this.path;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > maxDecompressedSectionBytes ||
      offset >= this.size
    ) {
      throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Invalid PMTiles byte range.');
    }
    const available = Math.min(length, this.size - offset);
    this.budget.consumeRead(available);
    const bytes = new Uint8Array(available);
    let read = 0;
    while (read < available) {
      const result = await this.handle.read(bytes, read, available - read, offset + read);
      if (result.bytesRead === 0) {
        throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Short PMTiles byte range.');
      }
      read += result.bytesRead;
    }
    return {data: bytes.buffer};
  }
}

async function readValidatedHeader(
  source: NodeFilePmtilesSource,
  archiveLength: number,
): Promise<Header> {
  try {
    const response = await source.getBytes(0, 127);
    if (response.data.byteLength !== 127) throw new Error('Short PMTiles header.');
    if (new DataView(response.data).getUint16(0, true) !== 0x4d50) {
      throw new Error('Wrong PMTiles magic number.');
    }
    const header = bytesToHeader(response.data);
    validatePmtilesHeader(header, archiveLength);
    return header;
  } catch (error) {
    throw asInspectionError(
      error,
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles header or directory is invalid.',
    );
  }
}

async function readMetadata(
  source: NodeFilePmtilesSource,
  header: Header,
  budget: InspectionBudget,
): Promise<unknown> {
  try {
    const response = await source.getBytes(header.jsonMetadataOffset, header.jsonMetadataLength);
    if (response.data.byteLength !== header.jsonMetadataLength) {
      throw new Error('Short PMTiles metadata section.');
    }
    const decompressed = await createSectionDecompressor(budget)(
      response.data,
      header.internalCompression,
    );
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(decompressed));
  } catch (error) {
    throw asInspectionError(
      error,
      'TF_TILESET_METADATA_INVALID',
      'contract',
      'PMTiles metadata is invalid.',
    );
  }
}

function createSectionDecompressor(budget: InspectionBudget): DecompressFunc {
  return async (buffer, compression) => {
    if (compression === Compression.None) {
      if (buffer.byteLength > maxDecompressedSectionBytes) {
        throw inspectionError(
          'TF_TILESET_ARCHIVE_INVALID',
          'archive',
          'PMTiles section exceeds the inspection limit.',
        );
      }
      budget.consumeDecoded(buffer.byteLength);
      return buffer;
    }
    if (compression !== Compression.Gzip) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles compression is unsupported.',
      );
    }

    const remaining = budget.remainingDecoded();
    if (remaining < 1) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles decompression exceeded its operational budget.',
      );
    }
    const output = await new Promise<Buffer>((resolveOutput, rejectOutput) => {
      gunzip(
        new Uint8Array(buffer),
        {maxOutputLength: Math.min(maxDecompressedSectionBytes, remaining)},
        (error, result) => (error ? rejectOutput(error) : resolveOutput(result)),
      );
    }).catch((error) => {
      throw asInspectionError(
        error,
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Compressed PMTiles section is invalid or too large.',
      );
    });
    budget.consumeDecoded(output.byteLength);
    return output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer;
  };
}

function createDirectoryDecompressor(budget: InspectionBudget): DecompressFunc {
  return async (buffer, compression) => {
    const output = await createSectionDecompressor(budget)(buffer, compression);
    validateSerializedDirectory(new Uint8Array(output));
    return output;
  };
}

type ParsedDirectoryEntry = Readonly<{
  length: number;
  offset: number;
  runLength: number;
  tileId: number;
}>;

function validateSerializedDirectory(bytes: Uint8Array): ParsedDirectoryEntry[] {
  const position = {offset: 0};
  const entryCount = readDirectoryVarint(bytes, position);
  if (
    entryCount < 1 ||
    entryCount > maxDirectoryEntries ||
    entryCount > Math.floor((bytes.byteLength - position.offset) / 4)
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Invalid PMTiles directory entry count.',
    );
  }
  if (entryCount * estimatedRangeMemoryBytes > maxParserMemoryBytes) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles directory exceeds the parser memory budget.',
    );
  }

  const tileIds: number[] = [];
  let lastTileId = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const delta = readDirectoryVarint(bytes, position);
    if (index > 0 && delta === 0) {
      throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'PMTiles TileIDs repeat.');
    }
    const tileId = lastTileId + delta;
    if (!Number.isSafeInteger(tileId)) {
      throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'PMTiles TileID overflow.');
    }
    tileIds.push(tileId);
    lastTileId = tileId;
  }
  const runLengths = Array.from({length: entryCount}, () => readDirectoryVarint(bytes, position));
  const lengths = Array.from({length: entryCount}, () => readDirectoryVarint(bytes, position));
  const entries: ParsedDirectoryEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const encodedOffset = readDirectoryVarint(bytes, position);
    const length = lengths[index]!;
    if (length < 1 || (index === 0 && encodedOffset === 0)) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Invalid PMTiles directory range.',
      );
    }
    const offset =
      encodedOffset === 0
        ? entries[index - 1]!.offset + entries[index - 1]!.length
        : encodedOffset - 1;
    const runLength = runLengths[index]!;
    const tileId = tileIds[index]!;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(tileId + Math.max(0, runLength - 1))
    ) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Invalid PMTiles directory range.',
      );
    }
    entries.push({length, offset, runLength, tileId});
  }
  if (position.offset !== bytes.byteLength) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'Invalid trailing PMTiles directory data.',
    );
  }
  return entries;
}

class InspectionBudget {
  readonly #limit: number;
  #decoded = 0;
  #read = 0;

  constructor(archiveBytes: number) {
    this.#limit = Math.min(maximumDecodedBytes, Math.max(minimumDecodedBytes, archiveBytes));
  }

  consumeDecoded(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#decoded + bytes > this.#limit) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles decompression exceeded its operational budget.',
      );
    }
    this.#decoded += bytes;
  }

  consumeRead(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#read + bytes > this.#limit) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles reads exceeded their operational budget.',
      );
    }
    this.#read += bytes;
  }

  remainingDecoded(): number {
    return Math.max(0, this.#limit - this.#decoded);
  }
}

type PendingDirectory = Readonly<{
  kind: 'directory';
  depth: number;
  key: string;
  length: number;
  maximumTileId: number;
  minimumTileId: number;
  offset: number;
  parent?: PendingDirectory;
}>;

type PendingClusteredContent = Readonly<{
  kind: 'clustered-content';
  length: number;
  offset: number;
}>;

async function validatePmtilesDirectoryTree(
  source: NodeFilePmtilesSource,
  header: Header,
  budget: InspectionBudget,
  maximumDirectoryDepth: number,
  signal?: AbortSignal,
): Promise<{addressedTiles: number; tileEntries: number}> {
  const pending: Array<PendingClusteredContent | PendingDirectory> = [
    {
      depth: 0,
      key: `${header.rootDirectoryOffset}:${header.rootDirectoryLength}`,
      kind: 'directory',
      length: header.rootDirectoryLength,
      maximumTileId: maximumTileIdForZoom(header.maxZoom),
      minimumTileId: 0,
      offset: header.rootDirectoryOffset,
    },
  ];
  const countedDirectories = new Set<string>();
  const processedContexts = new Set<string>();
  const clusteredContents = new Set<string>();
  const decompressDirectory = createSectionDecompressor(budget);
  let clusteredEnd: number | null = null;
  let addressedTiles = 0;
  let totalEntries = 0;
  let tileEntries = 0;

  while (pending.length > 0) {
    signal?.throwIfAborted();
    const item = pending.pop()!;
    if (item.kind === 'clustered-content') {
      const key = `${item.offset}:${item.length}`;
      if (clusteredContents.has(key)) continue;
      if (clusteredEnd === null ? item.offset !== 0 : item.offset !== clusteredEnd) {
        throw inspectionError(
          'TF_TILESET_ARCHIVE_INVALID',
          'archive',
          'PMTiles clustered contents are not contiguous in TileID order.',
        );
      }
      clusteredContents.add(key);
      clusteredEnd = item.offset + item.length;
      assertParserMemory(
        processedContexts.size + countedDirectories.size + clusteredContents.size + pending.length,
      );
      continue;
    }
    const current = item;
    if (
      current.depth > maximumDirectoryDepth ||
      hasDirectoryAncestor(current.parent, current.key)
    ) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles directory depth or cycle is invalid.',
      );
    }
    const contextKey = `${current.key}:${current.minimumTileId}:${current.maximumTileId}`;
    if (processedContexts.has(contextKey)) continue;
    processedContexts.add(contextKey);
    const firstPhysicalVisit = !countedDirectories.has(current.key);
    countedDirectories.add(current.key);
    assertParserMemory(
      processedContexts.size + countedDirectories.size + clusteredContents.size + pending.length,
    );

    const response = await source.getBytes(current.offset, current.length, signal);
    if (response.data.byteLength !== current.length) {
      throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Short PMTiles directory.');
    }
    const decoded = await decompressDirectory(response.data, header.internalCompression);
    const entries = validateSerializedDirectory(new Uint8Array(decoded));
    if (current.depth > 0 && entries[0]?.tileId !== current.minimumTileId) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles child directory does not begin at its parent TileID.',
      );
    }
    if (firstPhysicalVisit) totalEntries += entries.length;
    if (!Number.isSafeInteger(totalEntries) || totalEntries > maxDirectoryEntries) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles directories exceed the entry budget.',
      );
    }

    const nextItems: Array<PendingClusteredContent | PendingDirectory> = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const nextTileId = entries[index + 1]?.tileId;
      if (
        entry.tileId < current.minimumTileId ||
        entry.tileId > current.maximumTileId ||
        (nextTileId !== undefined && nextTileId > current.maximumTileId + 1)
      ) {
        throw inspectionError(
          'TF_TILESET_ARCHIVE_INVALID',
          'archive',
          'PMTiles directory TileID lies outside its parent interval.',
        );
      }
      if (entry.runLength === 0) {
        checkedRelativeRange(entry.offset, entry.length, header.leafDirectoryLength ?? 0);
        const offset = header.leafDirectoryOffset + entry.offset;
        const key = `${offset}:${entry.length}`;
        if (hasDirectoryAncestor(current, key)) {
          throw inspectionError(
            'TF_TILESET_ARCHIVE_INVALID',
            'archive',
            'PMTiles directory cycle is invalid.',
          );
        }
        nextItems.push({
          depth: current.depth + 1,
          key,
          kind: 'directory',
          length: entry.length,
          maximumTileId: nextTileId === undefined ? current.maximumTileId : nextTileId - 1,
          minimumTileId: entry.tileId,
          offset,
          parent: current,
        });
        continue;
      }

      checkedRelativeRange(entry.offset, entry.length, header.tileDataLength ?? 0);
      const runEnd = entry.tileId + entry.runLength - 1;
      if (
        !Number.isSafeInteger(runEnd) ||
        runEnd > current.maximumTileId ||
        (nextTileId !== undefined && runEnd >= nextTileId)
      ) {
        throw inspectionError(
          'TF_TILESET_ARCHIVE_INVALID',
          'archive',
          'PMTiles tile run overlaps or escapes its directory interval.',
        );
      }
      if (entry.length > maxDecompressedSectionBytes) {
        throw inspectionError(
          'TF_TILESET_ARCHIVE_INVALID',
          'archive',
          'PMTiles tile range exceeds the delivery budget.',
        );
      }
      if (firstPhysicalVisit) {
        addressedTiles += entry.runLength;
        tileEntries += 1;
        if (header.clustered) {
          nextItems.push({
            kind: 'clustered-content',
            length: entry.length,
            offset: entry.offset,
          });
        }
      }
      if (!Number.isSafeInteger(addressedTiles) || !Number.isSafeInteger(tileEntries)) {
        throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'PMTiles counts overflow.');
      }
    }
    for (let index = nextItems.length - 1; index >= 0; index -= 1) {
      pending.push(nextItems[index]!);
    }
    assertParserMemory(
      processedContexts.size + countedDirectories.size + clusteredContents.size + pending.length,
    );
  }

  if (
    (header.numAddressedTiles !== 0 && addressedTiles !== header.numAddressedTiles) ||
    (header.numTileEntries !== 0 && tileEntries !== header.numTileEntries)
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles header counters do not match its directory tree.',
    );
  }
  return {addressedTiles, tileEntries};
}

function maximumTileIdForZoom(maxZoom: number): number {
  const value = (4 ** (maxZoom + 1) - 1) / 3 - 1;
  if (!Number.isSafeInteger(value)) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles TileID range is unsafe.',
    );
  }
  return value;
}

function checkedRelativeRange(offset: number, length: number, sectionLength: number): void {
  if (
    !Number.isSafeInteger(sectionLength) ||
    sectionLength < 0 ||
    offset < 0 ||
    length < 1 ||
    offset > sectionLength - length
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles directory range lies outside its section.',
    );
  }
}

function hasDirectoryAncestor(candidate: PendingDirectory | undefined, key: string): boolean {
  for (let current = candidate; current; current = current.parent) {
    if (current.key === key) return true;
  }
  return false;
}

function assertParserMemory(rangeCount: number): void {
  if (rangeCount * estimatedRangeMemoryBytes > maxParserMemoryBytes) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles traversal exceeded its parser memory budget.',
    );
  }
}

class DeepPmtiles extends PMTiles {
  readonly #maximumDirectoryDepth: number;

  constructor(
    source: Source,
    cache: ResolvedValueCache,
    decompress: DecompressFunc,
    maximumDirectoryDepth: number,
  ) {
    super(source, cache, decompress);
    this.#maximumDirectoryDepth = maximumDirectoryDepth;
  }

  override async getZxyAttempt(z: number, x: number, y: number, signal?: AbortSignal) {
    const tileId = zxyToTileId(z, x, y);
    const header = await this.cache.getHeader(this.source);
    signal?.throwIfAborted();
    if (z < header.minZoom || z > header.maxZoom) return undefined;
    let offset = header.rootDirectoryOffset;
    let length = header.rootDirectoryLength;
    const ancestors = new Set<string>();

    for (let depth = 0; depth <= this.#maximumDirectoryDepth; depth += 1) {
      const key = `${offset}:${length}`;
      if (ancestors.has(key)) throw new Error('PMTiles directory cycle is invalid.');
      ancestors.add(key);
      const directory = await this.cache.getDirectory(this.source, offset, length, header, signal);
      const entry = findTile(directory, tileId);
      if (!entry) return undefined;
      if (entry.runLength > 0) {
        checkedRelativeRange(entry.offset, entry.length, header.tileDataLength ?? 0);
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
      checkedRelativeRange(entry.offset, entry.length, header.leafDirectoryLength ?? 0);
      offset = header.leafDirectoryOffset + entry.offset;
      length = entry.length;
    }
    throw new Error('PMTiles directory depth exceeds the operational limit.');
  }
}

function normalizeMaximumDirectoryDepth(value: number | undefined): number {
  const depth = value ?? defaultMaximumDirectoryDepth;
  if (!Number.isInteger(depth) || depth < 1 || depth > 64) {
    throw inspectionError(
      'TF_TILESET_INSPECTION_OPTIONS_INVALID',
      'maximumDirectoryDepth',
      'PMTiles maximumDirectoryDepth must be an integer from 1 to 64.',
    );
  }
  return depth;
}

function readDirectoryVarint(bytes: Uint8Array, position: {offset: number}): number {
  let result = 0;
  let multiplier = 1;
  for (let index = 0; index < 10; index += 1) {
    const byte = bytes[position.offset];
    if (byte === undefined) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'Unexpected end of PMTiles directory.',
      );
    }
    position.offset += 1;
    result += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(result)) {
      throw inspectionError(
        'TF_TILESET_ARCHIVE_INVALID',
        'archive',
        'PMTiles directory integer is too large.',
      );
    }
    if (byte < 0x80) return result;
    multiplier *= 128;
  }
  throw inspectionError(
    'TF_TILESET_ARCHIVE_INVALID',
    'archive',
    'PMTiles directory varint is too long.',
  );
}

function validatePmtilesHeader(header: Header, archiveLength: number): void {
  if (
    header.specVersion !== 3 ||
    !isSupportedCompression(header.internalCompression) ||
    !isSupportedCompression(header.tileCompression) ||
    header.tileType === TileType.Unknown ||
    !isSafeCount(header.numAddressedTiles) ||
    !isSafeCount(header.numTileEntries) ||
    !isSafeCount(header.numTileContents)
  ) {
    throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Invalid PMTiles header.');
  }
  if (
    !Number.isInteger(header.minZoom) ||
    !Number.isInteger(header.maxZoom) ||
    header.minZoom < 0 ||
    header.maxZoom < header.minZoom ||
    header.maxZoom > 26 ||
    !Number.isInteger(header.centerZoom) ||
    header.centerZoom < header.minZoom ||
    header.centerZoom > header.maxZoom
  ) {
    throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Invalid PMTiles zoom range.');
  }
  if (
    !isCoordinate(header.minLon, -180, 180) ||
    !isCoordinate(header.maxLon, -180, 180) ||
    !isCoordinate(header.centerLon, -180, 180) ||
    !isCoordinate(header.minLat, -90, 90) ||
    !isCoordinate(header.maxLat, -90, 90) ||
    !isCoordinate(header.centerLat, -90, 90) ||
    header.minLon > header.maxLon ||
    header.minLat > header.maxLat
  ) {
    throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Invalid PMTiles bounds.');
  }

  const rootEnd = checkedRangeEnd(
    header.rootDirectoryOffset,
    header.rootDirectoryLength,
    archiveLength,
  );
  const metadataEnd = checkedRangeEnd(
    header.jsonMetadataOffset,
    header.jsonMetadataLength,
    archiveLength,
  );
  const leafEnd = checkedRangeEnd(
    header.leafDirectoryOffset,
    header.leafDirectoryLength ?? 0,
    archiveLength,
  );
  const tileEnd = checkedRangeEnd(header.tileDataOffset, header.tileDataLength ?? 0, archiveLength);
  if (header.rootDirectoryOffset < 127 || rootEnd > Math.min(16_384, archiveLength)) {
    throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'Invalid PMTiles layout.');
  }
  const ranges = [
    {end: 127, start: 0},
    {end: rootEnd, start: header.rootDirectoryOffset},
    {end: metadataEnd, start: header.jsonMetadataOffset},
    {end: leafEnd, start: header.leafDirectoryOffset},
    {end: tileEnd, start: header.tileDataOffset},
  ]
    .filter(({end, start}) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw inspectionError('TF_TILESET_ARCHIVE_INVALID', 'archive', 'PMTiles sections overlap.');
    }
  }
}

function checkedRangeEnd(offset: number, length: number, archiveLength: number): number {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > archiveLength - length
  ) {
    throw inspectionError(
      'TF_TILESET_ARCHIVE_INVALID',
      'archive',
      'PMTiles section lies outside the archive.',
    );
  }
  return offset + length;
}

function isSafeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCoordinate(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isSupportedCompression(value: Compression): boolean {
  return value === Compression.None || value === Compression.Gzip;
}

function normalizeSourceLayers(metadata: unknown): Readonly<{
  declared: boolean;
  layers: TileflowTilesetInspectionV1['contract']['sourceLayers'];
}> {
  const record = asRecord(metadata);
  let raw = record?.vector_layers;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw inspectionError(
        'TF_TILESET_METADATA_INVALID',
        'contract.sourceLayers',
        'PMTiles vector_layers metadata is invalid JSON.',
      );
    }
  }
  if (raw === undefined) return Object.freeze({declared: false, layers: Object.freeze([])});
  if (!Array.isArray(raw) || raw.length > maxMetadataLayers) {
    throw inspectionError(
      'TF_TILESET_METADATA_INVALID',
      'contract.sourceLayers',
      `PMTiles vector_layers must contain at most ${maxMetadataLayers} layers.`,
    );
  }

  const seen = new Set<string>();
  return Object.freeze({
    declared: true,
    layers: Object.freeze(
      raw
        .map((candidate, index) => {
          const layer = asRecord(candidate);
          if (!layer) {
            throw inspectionError(
              'TF_TILESET_METADATA_INVALID',
              `contract.sourceLayers.${index}`,
              'PMTiles source-layer metadata must be an object.',
            );
          }
          const id = layer.id;
          if (typeof id !== 'string' || !fieldNamePattern.test(id)) {
            throw inspectionError(
              'TF_TILESET_METADATA_INVALID',
              `contract.sourceLayers.${index}.id`,
              'PMTiles source-layer ID is invalid.',
            );
          }
          if (seen.has(id)) {
            throw inspectionError(
              'TF_TILESET_METADATA_INVALID',
              `contract.sourceLayers.${index}.id`,
              `Duplicate PMTiles source-layer ID: ${id}.`,
            );
          }
          seen.add(id);
          const fieldMetadata = normalizeMetadataFields(layer.fields, index);
          const minzoom = optionalZoom(layer.minzoom, `contract.sourceLayers.${index}.minzoom`);
          const maxzoom = optionalZoom(layer.maxzoom, `contract.sourceLayers.${index}.maxzoom`);
          if (minzoom !== undefined && maxzoom !== undefined && minzoom > maxzoom) {
            throw inspectionError(
              'TF_TILESET_METADATA_INVALID',
              `contract.sourceLayers.${index}.maxzoom`,
              'PMTiles source-layer minzoom exceeds maxzoom.',
            );
          }
          return Object.freeze({
            fields: fieldMetadata.fields,
            fieldsDeclared: fieldMetadata.declared,
            id,
            ...(maxzoom === undefined ? {} : {maxzoom}),
            ...(minzoom === undefined ? {} : {minzoom}),
          });
        })
        .sort((left, right) => compareCodeUnits(left.id, right.id)),
    ),
  });
}

function normalizeMetadataFields(
  value: unknown,
  layerIndex: number,
): Readonly<{
  declared: boolean;
  fields: readonly Readonly<{name: string; type?: FieldType}>[];
}> {
  if (value === undefined) return Object.freeze({declared: false, fields: Object.freeze([])});
  const fields = asRecord(value);
  if (!fields || Object.keys(fields).length > maxMetadataFields) {
    throw inspectionError(
      'TF_TILESET_METADATA_INVALID',
      `contract.sourceLayers.${layerIndex}.fields`,
      `PMTiles source-layer fields must contain at most ${maxMetadataFields} entries.`,
    );
  }
  return Object.freeze({
    declared: true,
    fields: Object.freeze(
      Object.entries(fields)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([name, type], fieldIndex) => {
          if (!fieldNamePattern.test(name)) {
            throw inspectionError(
              'TF_TILESET_METADATA_INVALID',
              `contract.sourceLayers.${layerIndex}.fields.${fieldIndex}`,
              `Invalid PMTiles field name: ${name}.`,
            );
          }
          const normalized = normalizeFieldType(type);
          return Object.freeze({name, ...(normalized ? {type: normalized} : {})});
        }),
    ),
  });
}

async function inspectMvtSample(
  archive: PMTiles,
  header: Header,
  includedValueFields: readonly string[],
  signal?: AbortSignal,
): Promise<NonNullable<TileflowTilesetInspectionV1['observation']>> {
  const coordinates = sampleCoordinates(header).slice(0, inspectionLimits.maxTiles);
  const includedValueFieldSet = new Set(includedValueFields);
  const layers = new Map<
    string,
    {
      featuresRead: number;
      fields: Map<
        string,
        {
          distinctValues: Map<string, {count: number; value?: FieldValue}>;
          distinctValuesTruncated: boolean;
          featuresPresent: number;
          numericMax?: number;
          numericMin?: number;
          outputValuesTruncated: boolean;
          types: Set<FieldType>;
        }
      >;
      geometryTypes: Set<string>;
    }
  >();
  const tiles: TileCoordinate[] = [];
  let totalBytes = 0;
  let featuresRead = 0;
  let truncated = false;

  for (const coordinate of coordinates) {
    signal?.throwIfAborted();
    const response = await archive.getZxy(coordinate.z, coordinate.x, coordinate.y, signal);
    if (!response) continue;
    if (response.data.byteLength > maxTileBytes) {
      throw inspectionError(
        'TF_TILESET_SAMPLE_LIMIT_EXCEEDED',
        'observation.limits.maxBytes',
        `A sampled vector tile exceeds ${maxTileBytes} bytes.`,
      );
    }
    totalBytes += response.data.byteLength;
    if (totalBytes > inspectionLimits.maxBytes) {
      truncated = true;
      break;
    }
    tiles.push(coordinate);
    const reader = new PbfReader(response.data) as unknown as ConstructorParameters<
      typeof VectorTile
    >[0];
    const tile = new VectorTile(reader);
    for (const layerId of Object.keys(tile.layers).sort(compareCodeUnits)) {
      const vectorLayer = tile.layers[layerId]!;
      const observed = layers.get(layerId) ?? {
        featuresRead: 0,
        fields: new Map(),
        geometryTypes: new Set<string>(),
      };
      layers.set(layerId, observed);
      for (let index = 0; index < vectorLayer.length; index += 1) {
        if (featuresRead >= inspectionLimits.maxFeatures) {
          truncated = true;
          break;
        }
        const feature = vectorLayer.feature(index);
        featuresRead += 1;
        observed.featuresRead += 1;
        observed.geometryTypes.add(geometryType(feature.type));
        for (const [name, value] of Object.entries(feature.properties)) {
          const type = observedType(value);
          if (!type) continue;
          const observedValue = value as FieldValue;
          const field = observed.fields.get(name) ?? {
            distinctValues: new Map(),
            distinctValuesTruncated: false,
            featuresPresent: 0,
            outputValuesTruncated: false,
            types: new Set<FieldType>(),
          };
          field.featuresPresent += 1;
          field.types.add(type);
          if (typeof observedValue === 'number') {
            field.numericMin = Math.min(field.numericMin ?? observedValue, observedValue);
            field.numericMax = Math.max(field.numericMax ?? observedValue, observedValue);
          }
          const key = observedValueKey(observedValue);
          const distinct = field.distinctValues.get(key);
          if (distinct) {
            distinct.count += 1;
          } else if (field.distinctValues.size < inspectionLimits.maxDistinctValuesPerField) {
            const includeValue = includedValueFieldSet.has(name);
            const outputSafe =
              typeof observedValue !== 'string' ||
              observedValue.length <= inspectionLimits.maxValueLength;
            field.distinctValues.set(key, {
              count: 1,
              ...(includeValue && outputSafe ? {value: observedValue} : {}),
            });
            if (includeValue && !outputSafe) field.outputValuesTruncated = true;
          } else {
            field.distinctValuesTruncated = true;
            if (includedValueFieldSet.has(name)) field.outputValuesTruncated = true;
          }
          observed.fields.set(name, field);
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  return Object.freeze({
    authority: 'bounded-mvt-sample-v1' as const,
    featuresRead,
    includedValueFields,
    limits: inspectionLimits,
    sourceLayers: Object.freeze(
      [...layers.entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([id, layer]) =>
          Object.freeze({
            featuresRead: layer.featuresRead,
            fields: Object.freeze(
              [...layer.fields.entries()]
                .sort(([left], [right]) => compareCodeUnits(left, right))
                .map(([name, field]) => {
                  const values = [...field.distinctValues.entries()]
                    .flatMap(([key, value]) =>
                      value.value === undefined
                        ? []
                        : [{key, count: value.count, value: value.value}],
                    )
                    .sort(
                      (left, right) =>
                        right.count - left.count || compareCodeUnits(left.key, right.key),
                    );
                  const includeValues = includedValueFieldSet.has(name);
                  return Object.freeze({
                    distinctValuesObserved: field.distinctValues.size,
                    distinctValuesTruncated: field.distinctValuesTruncated,
                    featuresMissing: layer.featuresRead - field.featuresPresent,
                    featuresPresent: field.featuresPresent,
                    name,
                    ...(field.numericMin === undefined || field.numericMax === undefined
                      ? {}
                      : {
                          numericRange: Object.freeze({
                            max: field.numericMax,
                            min: field.numericMin,
                          }),
                        }),
                    ...(includeValues
                      ? {
                          observedValues: Object.freeze(
                            values
                              .slice(0, inspectionLimits.maxValuesPerField)
                              .map(({count, value}) => Object.freeze({count, value})),
                          ),
                          observedValuesTruncated:
                            field.outputValuesTruncated ||
                            field.distinctValuesTruncated ||
                            values.length > inspectionLimits.maxValuesPerField,
                        }
                      : {}),
                    types: Object.freeze([...field.types].sort(compareCodeUnits)),
                  });
                }),
            ),
            geometryTypes: Object.freeze([...layer.geometryTypes].sort(compareCodeUnits)),
            id,
          }),
        ),
    ),
    tiles: Object.freeze(tiles),
    tilesRead: tiles.length,
    truncated,
  });
}

function sampleCoordinates(header: Header): TileCoordinate[] {
  const zooms = [...new Set([header.minZoom, header.centerZoom, header.maxZoom])].sort(
    (left, right) => left - right,
  );
  const points: Array<readonly [number, number]> = [
    [header.centerLon, header.centerLat],
    [(header.minLon + header.maxLon) / 2, (header.minLat + header.maxLat) / 2],
    [header.minLon, header.minLat],
    [header.minLon, header.maxLat],
    [header.maxLon, header.minLat],
    [header.maxLon, header.maxLat],
  ];
  const coordinates = new Map<string, TileCoordinate>();
  for (const zoom of zooms) {
    for (const point of points) {
      const coordinate = lonLatToTile(point[0], point[1], zoom);
      coordinates.set(`${coordinate.z}/${coordinate.x}/${coordinate.y}`, coordinate);
    }
  }
  return [...coordinates.values()].sort(
    (left, right) => left.z - right.z || left.y - right.y || left.x - right.x,
  );
}

function normalizeIncludedValueFields(value: readonly string[] | undefined): readonly string[] {
  const fields = [...new Set(value ?? [])].sort(compareCodeUnits);
  if (fields.length > inspectionLimits.maxIncludedValueFields) {
    throw inspectionError(
      'TF_TILESET_INSPECTION_OPTIONS_INVALID',
      'includeValues',
      `Expected at most ${inspectionLimits.maxIncludedValueFields} value fields.`,
    );
  }
  for (const [index, field] of fields.entries()) {
    if (typeof field !== 'string' || !fieldNamePattern.test(field)) {
      throw inspectionError(
        'TF_TILESET_INSPECTION_OPTIONS_INVALID',
        `includeValues.${index}`,
        'Value fields must use portable PMTiles field names.',
      );
    }
  }
  return Object.freeze(fields);
}

function observedValueKey(value: FieldValue): string {
  if (typeof value === 'boolean') return `boolean:${value ? '1' : '0'}`;
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '0' : String(value)}`;
  return `string:${value}`;
}

function lonLatToTile(longitude: number, latitude: number, z: number): TileCoordinate {
  const count = 2 ** z;
  const x = Math.max(0, Math.min(count - 1, Math.floor(((longitude + 180) / 360) * count)));
  const boundedLatitude = Math.max(-85.0511287798066, Math.min(85.0511287798066, latitude));
  const radians = (boundedLatitude * Math.PI) / 180;
  const y = Math.max(
    0,
    Math.min(
      count - 1,
      Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * count),
    ),
  );
  return Object.freeze({x, y, z});
}

function metadataAttribution(metadata: unknown): {attribution?: string} {
  const attribution = asRecord(metadata)?.attribution;
  return typeof attribution === 'string' && attribution.trim()
    ? {attribution: attribution.trim().slice(0, 4_096)}
    : {};
}

function optionalZoom(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 30) {
    throw inspectionError(
      'TF_TILESET_METADATA_INVALID',
      path,
      'Expected an integer zoom from 0 to 30.',
    );
  }
  return value as number;
}

function normalizeFieldType(value: unknown): FieldType | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'boolean' || normalized === 'bool') return 'Boolean';
  if (['number', 'float', 'double', 'integer', 'int', 'uint'].includes(normalized)) return 'Number';
  if (normalized === 'string' || normalized === 'text') return 'String';
  return undefined;
}

function observedType(value: unknown): FieldType | undefined {
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'number' && Number.isFinite(value)) return 'Number';
  if (typeof value === 'string') return 'String';
  return undefined;
}

function geometryType(value: number): string {
  if (value === 1) return 'Point';
  if (value === 2) return 'LineString';
  if (value === 3) return 'Polygon';
  return 'Unknown';
}

function tileTypeName(value: TileType): TileflowTilesetInspectionV1['contract']['tileType'] {
  if (value === TileType.Mvt) return 'mvt';
  if (value === TileType.Mlt) return 'mlt';
  if (value === TileType.Png) return 'png';
  if (value === TileType.Jpeg) return 'jpeg';
  if (value === TileType.Webp) return 'webp';
  if (value === TileType.Avif) return 'avif';
  throw inspectionError(
    'TF_TILESET_TILE_TYPE_UNSUPPORTED',
    'contract.tileType',
    'Unsupported PMTiles tile type.',
  );
}

function normalizeCoordinate(value: number): number {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function inspectionError(code: string, path: string, message: string): Error {
  return Object.assign(new Error(message), {code, path, phase: 'tileset-inspection'});
}

function asInspectionError(error: unknown, code: string, path: string, message: string): unknown {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return error;
  }
  const record = asRecord(error);
  return typeof record?.code === 'string' ? error : inspectionError(code, path, message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
