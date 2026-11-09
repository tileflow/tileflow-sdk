import {TilesetBuildError} from './errors';
import type {FeatureIngest, GeometryInput} from './ingest';
import {concatBytes} from './platform';

const quote = 0x22;
const backslash = 0x5c;
const openBrace = 0x7b;
const closeBrace = 0x7d;
const openBracket = 0x5b;
const closeBracket = 0x5d;
const comma = 0x2c;
const colon = 0x3a;
// Keep a byte order mark in the text, so that JSON.parse refuses it as it always has.
const utf8 = new TextDecoder('utf-8', {ignoreBOM: true});

type FeatureLike = Readonly<{
  geometries?: unknown;
  geometry?: GeometryInput | null;
  id?: unknown;
  properties?: Record<string, unknown> | null;
  type?: unknown;
}>;

/**
 * Feed a GeoJSON document chunk by chunk without holding it in memory. `onCrs` receives a top-level
 * `crs` member, which can legally appear after `features`, so the caller must refuse a mismatch.
 */
export class GeojsonFeatureReader {
  #index = 0;
  readonly #scanner: TopLevelScanner;

  constructor(ingest: FeatureIngest, onCrs: (member: unknown) => void) {
    this.#scanner = new TopLevelScanner((bytes) => {
      this.#index += 1;
      ingest.location = `feature ${this.#index}`;
      addFeature(parseJson(bytes, ingest.location), ingest);
    }, onCrs);
  }

  get sawFeatures(): boolean {
    return this.#scanner.sawFeatures;
  }

  write(chunk: Uint8Array): void {
    this.#scanner.write(chunk);
  }

  end(): void {
    this.#scanner.end();
  }
}

export function addFeature(value: FeatureLike, ingest: FeatureIngest): void {
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

export function parseJson(bytes: Uint8Array, location: string): FeatureLike {
  try {
    return JSON.parse(utf8.decode(bytes)) as FeatureLike;
  } catch (error) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `${location}: invalid JSON (${error instanceof Error ? error.message : 'parse failure'}). A file with one feature per line needs --format geojsonseq.`,
    );
  }
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
  #capture: Uint8Array[] = [];
  #captureStart = -1;
  #key: Uint8Array[] = [];
  #keyStart = -1;
  #afterColon = false;
  #currentKey = '';
  #crsStart = false;

  constructor(
    private readonly onFeature: (bytes: Uint8Array) => void,
    private readonly onCrs: (member: unknown) => void,
  ) {}

  write(chunk: Uint8Array): void {
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
            this.#key.push(new Uint8Array(chunk.subarray(this.#keyStart, index)));
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
            this.#currentKey = utf8.decode(concatBytes(this.#key));
          }
          break;
        default:
          break;
      }
      index += 1;
    }
    if (this.#keyStart >= 0) {
      this.#key.push(new Uint8Array(chunk.subarray(this.#keyStart)));
      this.#keyStart = 0;
    }
    if (this.#captureStart >= 0) {
      this.#capture.push(new Uint8Array(chunk.subarray(this.#captureStart)));
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

  #take(chunk: Uint8Array, end: number): Uint8Array {
    const tail = chunk.subarray(this.#captureStart, end);
    const bytes = this.#capture.length > 0 ? concatBytes([...this.#capture, tail]) : tail;
    this.#capture = [];
    this.#captureStart = -1;
    return bytes;
  }

  #emitFeature(chunk: Uint8Array, end: number): void {
    this.onFeature(this.#take(chunk, end));
  }

  #emitCrs(chunk: Uint8Array, end: number): void {
    this.#crsStart = false;
    this.onCrs(parseJson(this.#take(chunk, end), 'crs member'));
  }
}
