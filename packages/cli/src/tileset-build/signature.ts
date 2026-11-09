import {closeSync, openSync, readSync} from 'node:fs';
import {TilesetBuildError} from './errors';
import type {TilesetBuildFormat} from './recipe';

const probeBytes = 64 * 1024;
const sqliteHeader = Buffer.from('SQLite format 3\0', 'latin1');
const shapefileFileCode = 9994;
const utf8Bom = [0xef, 0xbb, 0xbf];
const recordSeparator = 0x1e;

const formatNames: Record<TilesetBuildFormat, string> = {
  csv: 'CSV',
  geojson: 'GeoJSON',
  geojsonseq: 'newline-delimited GeoJSON',
  geopackage: 'GeoPackage',
  gpx: 'GPX',
  kml: 'KML',
  shapefile: 'a Shapefile',
};

/** The first character of a text format, past a byte-order mark and any white space. */
function firstCharacter(bytes: Buffer): number | undefined {
  let index = utf8Bom.every((byte, position) => bytes[position] === byte) ? 3 : 0;
  while (index < bytes.length && isWhitespace(bytes[index])) index += 1;
  return bytes[index];
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === recordSeparator
  );
}

function matches(bytes: Buffer, format: TilesetBuildFormat): boolean {
  switch (format) {
    case 'csv':
      return !bytes.includes(0);
    case 'geojson':
    case 'geojsonseq':
      return firstCharacter(bytes) === 0x7b;
    case 'geopackage':
      return bytes.subarray(0, sqliteHeader.length).equals(sqliteHeader);
    case 'gpx':
    case 'kml':
      return firstCharacter(bytes) === 0x3c || hasUtf16Bom(bytes);
    case 'shapefile':
      return bytes.length >= 4 && bytes.readInt32BE(0) === shapefileFileCode;
  }
}

/** XML may declare UTF-16, and the reader handles it, so the first character is not `<` here. */
function hasUtf16Bom(bytes: Buffer): boolean {
  return (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
}

function isZipHeader(bytes: Buffer): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && [3, 5].includes(bytes[2]);
}

/**
 * Parsers are chosen from the extension, which an uploaded file can fake. Checking the first bytes
 * turns that into a clear error instead of whatever the wrong parser happens to report.
 */
export function checkInputSignature(
  path: string,
  format: TilesetBuildFormat,
  container: 'kmz' | 'zip' | null,
): void {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(probeBytes);
    const bytes = buffer.subarray(0, readSync(descriptor, buffer, 0, probeBytes, 0));
    if (bytes.length === 0) return; // Each reader reports an empty file in its own terms.
    if (container ? isZipHeader(bytes) : matches(bytes, format)) return;
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `The file does not look like ${container ? `a ${container.toUpperCase()} archive` : formatNames[format]}. Check the file, or pass --format if its extension is misleading.`,
    );
  } finally {
    closeSync(descriptor);
  }
}
