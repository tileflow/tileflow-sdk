import {closeSync, fstatSync, openSync, readFileSync, readSync} from 'node:fs';
import {TilesetBuildError, yieldToEventLoop} from './errors';
import type {FeatureIngest, GeometryInput} from './ingest';

const chunkBytes = 4 * 1024 * 1024;
const maximumWholeDocumentBytes = 512 * 1024 * 1024;
const quote = 0x22;
const backslash = 0x5c;
const openBrace = 0x7b;
const closeBrace = 0x7d;
const openBracket = 0x5b;
const closeBracket = 0x5d;
const comma = 0x2c;
const colon = 0x3a;

type FeatureLike = Readonly<{
  geometries?: unknown;
  geometry?: GeometryInput | null;
  id?: unknown;
  properties?: Record<string, unknown> | null;
  type?: unknown;
}>;

/**
 * Stream a GeoJSON document without holding it in memory. `onCrs` receives a top-level `crs` member,
 * which can legally appear after `features`, so the caller must refuse a mismatch either way.
 */
export async function readGeojson(
  path: string,
  ingest: FeatureIngest,
  onCrs: (member: unknown) => void,
): Promise<void> {
  let index = 0;
  const scanner = new TopLevelScanner((bytes) => {
    index += 1;
    ingest.location = `feature ${index}`;
    addFeature(parseJson(bytes, ingest.location), ingest);
  }, onCrs);
  await forEachChunk(path, (chunk) => scanner.write(chunk));
  scanner.end();
  if (!scanner.sawFeatures) readSingleObject(path, ingest, onCrs);
}

/** Newline-delimited or RFC 8142 sequences: one Feature or geometry per record. */
export async function readGeojsonSequence(path: string, ingest: FeatureIngest): Promise<void> {
  let line = 0;
  let carried: Buffer[] = [];
  const emit = (bytes: Buffer) => {
    line += 1;
    let start = 0;
    let end = bytes.length;
    while (start < end && isSpaceOrSeparator(bytes[start])) start += 1;
    while (end > start && isSpaceOrSeparator(bytes[end - 1])) end -= 1;
    if (start === end) return;
    ingest.location = `line ${line}`;
    addFeature(parseJson(bytes.subarray(start, end), ingest.location), ingest);
  };
  await forEachChunk(path, (chunk) => {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline < 0) break;
      const piece = chunk.subarray(start, newline);
      if (carried.length > 0) {
        emit(Buffer.concat([...carried, piece]));
        carried = [];
      } else {
        emit(piece);
      }
      start = newline + 1;
    }
    if (start < chunk.length) carried.push(Buffer.from(chunk.subarray(start)));
  });
  if (carried.length > 0) emit(Buffer.concat(carried));
}

function readSingleObject(
  path: string,
  ingest: FeatureIngest,
  onCrs: (member: unknown) => void,
): void {
  const descriptor = openSync(path, 'r');
  const size = fstatSync(descriptor).size;
  closeSync(descriptor);
  if (size > maximumWholeDocumentBytes) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      'Single-object GeoJSON documents are limited to 512 MiB. Use a FeatureCollection or newline-delimited features.',
    );
  }
  ingest.location = 'document';
  const document = parseJson(readFileSync(path), ingest.location);
  if (document.type === 'FeatureCollection') return;
  const crs = (document as {crs?: unknown}).crs;
  if (crs !== undefined) onCrs(crs);
  addFeature(document, ingest);
}

function addFeature(value: FeatureLike, ingest: FeatureIngest): void {
  if (value === null || typeof value !== 'object') {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${ingest.location}: expected a GeoJSON object.`,
    );
  }
  if (value.type === 'Feature') {
    ingest.add(value.geometry, value.properties ?? {}, value.id);
  } else {
    ingest.add(value as GeometryInput, {});
  }
}

function parseJson(bytes: Buffer, location: string): FeatureLike {
  try {
    return JSON.parse(bytes.toString('utf8')) as FeatureLike;
  } catch (error) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${location}: invalid JSON (${error instanceof Error ? error.message : 'parse failure'}). A file with one feature per line needs --format geojsonseq.`,
    );
  }
}

async function forEachChunk(path: string, visit: (chunk: Buffer) => void): Promise<void> {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(chunkBytes);
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, chunkBytes, null);
      if (bytes === 0) return;
      visit(buffer.subarray(0, bytes));
      await yieldToEventLoop();
    }
  } finally {
    closeSync(descriptor);
  }
}

function isSpaceOrSeparator(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a || byte === 0x1e;
}

/**
 * A byte-level state machine over the top-level object. It captures each `features` element and
 * short members, and skips everything else, so memory stays proportional to the largest feature.
 */
class TopLevelScanner {
  sawFeatures = false;
  #depth = 0;
  #inString = false;
  #escaped = false;
  #inFeatures = false;
  #capture: Buffer[] = [];
  #captureStart = -1;
  #key: Buffer[] = [];
  #keyStart = -1;
  #afterColon = false;
  #currentKey = '';
  #crsStart = false;

  constructor(
    private readonly onFeature: (bytes: Buffer) => void,
    private readonly onCrs: (member: unknown) => void,
  ) {}

  write(chunk: Buffer): void {
    let index = 0;
    const length = chunk.length;
    while (index < length) {
      const byte = chunk[index];
      if (this.#inString) {
        if (this.#escaped) {
          this.#escaped = false;
          index += 1;
          continue;
        }
        if (byte === backslash) {
          this.#escaped = true;
          index += 1;
          continue;
        }
        if (byte === quote) {
          this.#inString = false;
          if (this.#keyStart >= 0) {
            this.#key.push(Buffer.from(chunk.subarray(this.#keyStart, index)));
            this.#keyStart = -1;
          }
        }
        index += 1;
        continue;
      }
      switch (byte) {
        case quote:
          this.#inString = true;
          if (this.#depth === 1 && !this.#afterColon) {
            this.#key = [];
            this.#keyStart = index + 1;
            // A key can straddle a chunk boundary; the fragment is saved at the chunk end.
          }
          break;
        case openBrace:
        case openBracket:
          if (this.#depth === 1 && this.#afterColon) {
            if (this.#currentKey === 'features' && byte === openBracket) {
              this.#inFeatures = true;
              this.sawFeatures = true;
              this.#afterColon = false;
              this.#depth += 1;
              break;
            }
            if (this.#currentKey === 'crs' && this.#captureStart < 0) {
              this.#crsStart = true;
              this.#captureStart = index;
            }
          } else if (this.#inFeatures && this.#depth === 2 && this.#captureStart < 0) {
            this.#captureStart = index;
          }
          this.#depth += 1;
          break;
        case closeBrace:
        case closeBracket:
          this.#depth -= 1;
          if (this.#inFeatures) {
            if (this.#depth === 1) {
              this.#inFeatures = false;
            } else if (this.#depth === 2) {
              this.#emitFeature(chunk, index + 1);
            }
          } else if (this.#crsStart && this.#depth === 1) {
            this.#emitCrs(chunk, index + 1);
          }
          break;
        case comma:
          if (this.#depth === 1) this.#afterColon = false;
          break;
        case colon:
          if (this.#depth === 1 && !this.#afterColon) {
            this.#afterColon = true;
            this.#currentKey = Buffer.concat(this.#key).toString('utf8');
          }
          break;
        default:
          break;
      }
      index += 1;
    }
    if (this.#keyStart >= 0) {
      this.#key.push(Buffer.from(chunk.subarray(this.#keyStart)));
      this.#keyStart = 0;
    }
    if (this.#captureStart >= 0) {
      this.#capture.push(Buffer.from(chunk.subarray(this.#captureStart)));
      this.#captureStart = 0;
    }
  }

  end(): void {
    if (this.#depth !== 0 || this.#inString) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_INVALID',
        'input',
        'The GeoJSON document ends before its top-level object closes; the file may be truncated.',
      );
    }
  }

  #take(chunk: Buffer, end: number): Buffer {
    const tail = chunk.subarray(this.#captureStart, end);
    const bytes = this.#capture.length > 0 ? Buffer.concat([...this.#capture, tail]) : tail;
    this.#capture = [];
    this.#captureStart = -1;
    return bytes;
  }

  #emitFeature(chunk: Buffer, end: number): void {
    this.onFeature(this.#take(chunk, end));
  }

  #emitCrs(chunk: Buffer, end: number): void {
    this.#crsStart = false;
    this.onCrs(parseJson(this.#take(chunk, end), 'crs member'));
  }
}
