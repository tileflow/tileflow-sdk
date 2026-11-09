import {closeSync, existsSync, openSync, readdirSync, readFileSync, readSync} from 'node:fs';
import {basename, dirname, extname, join} from 'node:path';
import type {CrsStatement} from './crs';
import {TilesetBuildError, yieldToEventLoop} from './errors';
import type {FeatureIngest} from './ingest';

const shapeHeaderBytes = 100;
const dbfFieldBytes = 32;

/** The sidecar matching `.prj`, tolerating the upper-case extensions older tools write. */
function sidecar(path: string, extension: string): string | null {
  const stem = basename(path, extname(path));
  const directory = dirname(path);
  for (const candidate of [extension, extension.toUpperCase()]) {
    const direct = join(directory, `${stem}${candidate}`);
    if (existsSync(direct)) return direct;
  }
  const lower = `${stem}${extension}`.toLowerCase();
  const match = readdirSync(directory).find((entry) => entry.toLowerCase() === lower);
  return match ? join(directory, match) : null;
}

export function shapefileCrsStatement(path: string): CrsStatement {
  const prj = sidecar(path, '.prj');
  const label = `${basename(path)}${prj ? ' (.prj)' : ' (no .prj file)'}`;
  return {
    authority: 'declared',
    definition: prj ? readFileSync(prj, 'utf8').trim() || null : null,
    label,
  };
}

export async function readShapefile(path: string, ingest: FeatureIngest): Promise<void> {
  const shp = openSync(path, 'r');
  let table: ReturnType<typeof openDbf> | null = null;
  try {
    const dbfPath = sidecar(path, '.dbf');
    if (dbfPath) table = openDbf(dbfPath, sidecar(path, '.cpg'));
    else ingest.warn('No .dbf file was found, so features have no attributes.');
    const header = Buffer.allocUnsafe(shapeHeaderBytes);
    if (
      readSync(shp, header, 0, shapeHeaderBytes, 0) !== shapeHeaderBytes ||
      header.readInt32BE(0) !== 9994
    ) {
      throw invalid('file is not a Shapefile (.shp header is wrong).');
    }
    const fileBytes = header.readInt32BE(24) * 2;
    const shapeType = header.readInt32LE(32);
    if (![0, 1, 3, 5, 8, 11, 13, 15, 18, 21, 23, 25, 28].includes(shapeType)) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
        'input',
        `Shapefile geometry type ${shapeType} is not supported; MultiPatch has no vector tile equivalent.`,
      );
    }
    if (shapeType >= 11) ingest.warn('Z and M values in the Shapefile were ignored.');

    const stream = new SequentialReader(shp, shapeHeaderBytes);
    let index = 0;
    while (stream.position < fileBytes) {
      index += 1;
      if (index % 8192 === 0) await yieldToEventLoop();
      ingest.location = `record ${index}`;
      const recordHeader = stream.read(8);
      if (!recordHeader) throw invalid(`record ${index}: the .shp file ends early.`);
      const bytes = recordHeader.readInt32BE(4) * 2;
      const content = stream.read(bytes);
      if (!content) throw invalid(`record ${index}: the .shp file ends early.`);
      const row = table?.next();
      if (row === null) continue; // Deleted in the .dbf.
      ingest.add(decodeShape(content, index), row ?? {});
    }
    if (table && table.remainingRows > 0) {
      ingest.warn(
        `The .dbf has ${table.remainingRows} extra attribute ${table.remainingRows === 1 ? 'row' : 'rows'} after the last Shapefile record.`,
      );
    }
  } finally {
    closeSync(shp);
    table?.close();
  }
}

function invalid(message: string): TilesetBuildError {
  return new TilesetBuildError('TF_TILESET_BUILD_INPUT_INVALID', 'input', message);
}

function decodeShape(content: Buffer, index: number) {
  const type = content.readInt32LE(0);
  switch (type) {
    case 0:
      return null;
    case 1:
    case 11:
    case 21:
      return {
        coordinates: [content.readDoubleLE(4), content.readDoubleLE(12)],
        type: 'Point',
      };
    case 8:
    case 18:
    case 28: {
      const count = content.readInt32LE(36);
      return {coordinates: readPoints(content, 40, count), type: 'MultiPoint'};
    }
    case 3:
    case 13:
    case 23:
      return {coordinates: readParts(content), type: 'MultiLineString'};
    case 5:
    case 15:
    case 25:
      return {coordinates: assemblePolygons(readParts(content)), type: 'MultiPolygon'};
    default:
      throw invalid(`record ${index}: unsupported shape type ${type}.`);
  }
}

function readPoints(content: Buffer, offset: number, count: number): number[][] {
  const points: number[][] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    points[index] = [
      content.readDoubleLE(offset + index * 16),
      content.readDoubleLE(offset + index * 16 + 8),
    ];
  }
  return points;
}

function readParts(content: Buffer): number[][][] {
  const partCount = content.readInt32LE(36);
  const pointCount = content.readInt32LE(40);
  const pointsOffset = 44 + partCount * 4;
  const parts: number[][][] = [];
  for (let part = 0; part < partCount; part += 1) {
    const start = content.readInt32LE(44 + part * 4);
    const end = part + 1 < partCount ? content.readInt32LE(44 + (part + 1) * 4) : pointCount;
    parts.push(readPoints(content, pointsOffset + start * 16, end - start));
  }
  return parts;
}

type Ring = Readonly<{
  area: number;
  bounds: readonly [number, number, number, number];
  points: number[][];
}>;

/** Shapefile rings are flat; clockwise ones are exteriors, and holes belong to the tightest one. */
function assemblePolygons(rings: number[][][]): number[][][][] {
  const exteriors: Ring[] = [];
  const holes: Ring[] = [];
  for (const points of rings) {
    if (points.length === 0) continue;
    const ring = describeRing(points);
    (ring.area <= 0 ? exteriors : holes).push(ring);
  }
  if (exteriors.length === 1 && holes.length === 0) return [[exteriors[0].points]];
  const polygons = exteriors.map((ring) => ({ring, rings: [ring.points]}));
  for (const hole of holes) {
    let owner: (typeof polygons)[number] | null = null;
    for (const polygon of polygons) {
      if (!boundsContain(polygon.ring.bounds, hole.bounds)) continue;
      if (!pointInRing(hole.points[0], polygon.ring.points)) continue;
      if (!owner || Math.abs(polygon.ring.area) < Math.abs(owner.ring.area)) owner = polygon;
    }
    if (owner) owner.rings.push(hole.points);
    else polygons.push({ring: hole, rings: [hole.points]}); // Same as GDAL: an orphan stands alone.
  }
  return polygons.map((polygon) => polygon.rings);
}

function describeRing(points: number[][]): Ring {
  let area = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let previous = points[points.length - 1];
  for (const point of points) {
    area += previous[0] * point[1] - point[0] * previous[1];
    previous = point;
    if (point[0] < minX) minX = point[0];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[1] > maxY) maxY = point[1];
  }
  return {area, bounds: [minX, minY, maxX, maxY], points};
}

function boundsContain(
  outer: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}

function pointInRing(point: number[], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[previous];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

class SequentialReader {
  #buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  #start = 0;
  #end = 0;
  position: number;

  constructor(
    private readonly descriptor: number,
    position: number,
  ) {
    this.position = position;
  }

  read(size: number): Buffer | null {
    if (this.#end - this.#start < size) {
      const available = this.#end - this.#start;
      const target = size > this.#buffer.length ? Buffer.allocUnsafe(size * 2) : this.#buffer;
      this.#buffer.copy(target, 0, this.#start, this.#end);
      this.#buffer = target;
      this.#start = 0;
      this.#end = available;
      const bytes = readSync(
        this.descriptor,
        this.#buffer,
        this.#end,
        this.#buffer.length - this.#end,
        this.position + available,
      );
      this.#end += bytes;
      if (this.#end < size) return null;
    }
    const view = this.#buffer.subarray(this.#start, this.#start + size);
    this.#start += size;
    this.position += size;
    return view;
  }
}

type DbfField = Readonly<{length: number; name: string; offset: number; type: string}>;

function openDbf(path: string, cpgPath: string | null) {
  const descriptor = openSync(path, 'r');
  try {
    return readDbfTable(descriptor, cpgPath);
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readDbfTable(descriptor: number, cpgPath: string | null) {
  const header = Buffer.alloc(32);
  if (readSync(descriptor, header, 0, header.length, 0) !== header.length) {
    throw invalid('record 1: the .dbf header is incomplete.');
  }
  const records = header.readUInt32LE(4);
  const headerBytes = header.readUInt16LE(8);
  const recordBytes = header.readUInt16LE(10);
  if (headerBytes < 33 || recordBytes < 1)
    throw invalid('record 1: the .dbf row layout is invalid.');
  const descriptors = Buffer.allocUnsafe(headerBytes - 32);
  if (readSync(descriptor, descriptors, 0, descriptors.length, 32) !== descriptors.length) {
    throw invalid('record 1: the .dbf field descriptors are incomplete.');
  }
  const encoding = cpgPath ? readFileSync(cpgPath, 'utf8').trim() : 'utf-8';
  const decoder = createDecoder(encoding);
  const fields: DbfField[] = [];
  let offset = 1;
  for (let cursor = 0; cursor + dbfFieldBytes <= descriptors.length; cursor += dbfFieldBytes) {
    if (descriptors[cursor] === 0x0d) break;
    const raw = descriptors.subarray(cursor, cursor + 11);
    const end = raw.indexOf(0);
    const length = descriptors[cursor + 16];
    fields.push({
      length,
      name: decoder.decode(raw.subarray(0, end < 0 ? 11 : end)),
      offset,
      type: String.fromCharCode(descriptors[cursor + 11]),
    });
    offset += length;
  }
  const stream = new SequentialReader(descriptor, headerBytes);
  let index = 0;
  return {
    close: () => closeSync(descriptor),
    get remainingRows() {
      return records - index;
    },
    /** One row of attributes, `null` for a deleted row. */
    next(): Record<string, unknown> | null {
      if (index >= records) throw invalid(`record ${index + 1}: the .dbf has no matching row.`);
      index += 1;
      const row = stream.read(recordBytes);
      if (!row || row[0] === 0x1a) throw invalid(`record ${index}: the .dbf row is incomplete.`);
      if (row[0] === 0x2a) return null;
      const properties: Record<string, unknown> = {};
      for (const item of fields) {
        const value = dbfValue(row, item, decoder);
        if (value !== null) properties[item.name] = value;
      }
      return properties;
    },
  };
}

function createDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(/^\d+$/u.test(encoding) ? `windows-${encoding}` : encoding);
  } catch {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_INVALID',
      'input',
      `The .cpg file names an unknown text encoding: ${encoding}.`,
    );
  }
}

function dbfValue(
  row: Buffer,
  item: DbfField,
  decoder: TextDecoder,
): boolean | number | string | null {
  const bytes = row.subarray(item.offset, item.offset + item.length);
  switch (item.type) {
    case 'N':
    case 'F': {
      const text = bytes.toString('latin1').trim();
      const value = Number(text);
      return text === '' || !Number.isFinite(value) ? null : value;
    }
    case 'L': {
      const flag = String.fromCharCode(bytes[0]).toUpperCase();
      if ('YT'.includes(flag)) return true;
      if ('NF'.includes(flag)) return false;
      return null;
    }
    case 'D': {
      const text = bytes.toString('latin1').trim();
      return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : null;
    }
    case 'C': {
      const text = decoder.decode(bytes).trim();
      return text === '' ? null : text;
    }
    default:
      return null;
  }
}
