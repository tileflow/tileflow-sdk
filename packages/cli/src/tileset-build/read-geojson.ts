import {closeSync, fstatSync, openSync, readFileSync, readSync} from 'node:fs';
import {TilesetBuildError, yieldToEventLoop} from './errors';
import {addFeature, GeojsonFeatureReader, parseJson} from './geojson-stream';
import type {FeatureIngest} from './ingest';

const chunkBytes = 4 * 1024 * 1024;
const maximumWholeDocumentBytes = 512 * 1024 * 1024;
/**
 * Stream a GeoJSON document without holding it in memory. `onCrs` receives a top-level `crs` member,
 * which can legally appear after `features`, so the caller must refuse a mismatch either way.
 */
export async function readGeojson(
  path: string,
  ingest: FeatureIngest,
  onCrs: (member: unknown) => void,
): Promise<void> {
  const reader = new GeojsonFeatureReader(ingest, onCrs);
  await forEachChunk(path, (chunk) => reader.write(chunk));
  reader.end();
  if (!reader.sawFeatures) readSingleObject(path, ingest, onCrs);
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
