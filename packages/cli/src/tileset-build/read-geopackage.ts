import {statSync} from 'node:fs';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {type CrsStatement, type GeopackageSrs, statementFromGeopackageSrs} from './crs';
import {
  featureTooLarge,
  listChoices,
  maximumFeaturePositions,
  TilesetBuildError,
  yieldToEventLoop,
} from './errors';
import type {FeatureIngest, GeometryInput} from './ingest';

type SqliteModule = typeof import('node:sqlite');
type LayerRow = Readonly<{geometryColumn: string; name: string; srsId: number}>;
type ColumnRow = Readonly<{hidden: number; name: string; pk: number; type: string}>;
type Column = Readonly<{boolean: boolean; name: string}>;

const requiredTables = ['gpkg_contents', 'gpkg_geometry_columns', 'gpkg_spatial_ref_sys'];
const maximumLayers = 65_536;
const maximumGeometryDepth = 16;
const yieldEveryRows = 8192;
const yieldEveryBytes = 64 * 1024 * 1024;

/** One feature table of a GeoPackage, chosen and open for reading. */
export class GeoPackageLayer {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly layer: LayerRow,
    readonly crsStatement: CrsStatement,
  ) {}

  static open(path: string, requested: string | undefined): GeoPackageLayer {
    const database = openDatabase(loadSqlite(), path);
    try {
      return guarded(() => {
        // The file is untrusted: no view, trigger or virtual table in it may run with our trust.
        database.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
        const tables = plainTables(database);
        requireGeoPackage(tables);
        const layer = chooseLayer(listLayers(database, tables), requested);
        return new GeoPackageLayer(
          database,
          layer,
          statementFromGeopackageSrs(layer.name, readSrs(database, layer.srsId)),
        );
      });
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  /** `trustRowSrs` is false when --source-crs overrides what the rows say about themselves. */
  async read(ingest: FeatureIngest, trustRowSrs: boolean): Promise<void> {
    const {database, layer} = this;
    await guardedAsync(async () => {
      const columns = database
        .prepare('SELECT name, type, pk, hidden FROM pragma_table_xinfo(?)')
        .all(layer.name) as unknown as ColumnRow[];
      const stored = columns.filter((column) => column.hidden === 0);
      if (!stored.some((column) => column.name === layer.geometryColumn)) {
        throw invalid(`layer "${layer.name}" has no column "${layer.geometryColumn}".`);
      }
      if (stored.length !== columns.length) {
        ingest.warn('Generated columns in the GeoPackage were ignored.');
      }
      const primary = stored.filter((column) => column.pk > 0);
      const idColumn = primary.length === 1 ? primary[0].name : null;
      const attributes: Column[] = [];
      for (const column of stored) {
        if (column.name === layer.geometryColumn || column.name === idColumn) continue;
        if (/^blob/iu.test(column.type)) {
          ingest.warn(blobWarning);
          continue;
        }
        attributes.push({boolean: /^bool/iu.test(column.type), name: column.name});
      }
      const selected = [
        layer.geometryColumn,
        ...(idColumn === null ? [] : [idColumn]),
        ...attributes.map((column) => column.name),
      ];
      // NOT INDEXED fixes rowid order, which is what keeps repeat builds byte-identical.
      const statement = database.prepare(
        `SELECT ${selected.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(layer.name)} NOT INDEXED`,
      );
      statement.setReadBigInts(true);
      await readRows(statement, {
        attributes,
        expectedSrs: trustRowSrs ? layer.srsId : null,
        geometryColumn: layer.geometryColumn,
        idColumn,
        ingest,
        layerName: layer.name,
      });
    });
  }
}

const blobWarning =
  'Binary (BLOB) attributes in the GeoPackage have no vector tile equivalent and were skipped.';

async function readRows(
  statement: StatementSync,
  plan: Readonly<{
    attributes: readonly Column[];
    expectedSrs: number | null;
    geometryColumn: string;
    idColumn: string | null;
    ingest: FeatureIngest;
    layerName: string;
  }>,
): Promise<void> {
  const {attributes, expectedSrs, geometryColumn, idColumn, ingest} = plan;
  let index = 0;
  let pendingBytes = 0;
  for (const row of statement.iterate() as IterableIterator<Record<string, unknown>>) {
    index += 1;
    ingest.location = `row ${index}`;
    const value = row[geometryColumn];
    if (value !== null && !(value instanceof Uint8Array)) {
      throw invalid(`${ingest.location}: the geometry is not a GeoPackage binary value.`);
    }
    const blob = value as Uint8Array | null;
    pendingBytes += blob?.length ?? 0;
    if (index % yieldEveryRows === 0 || pendingBytes >= yieldEveryBytes) {
      pendingBytes = 0;
      await yieldToEventLoop();
    }
    const decoded = blob === null ? null : decodeGeometry(blob, ingest.location);
    if (decoded?.geometry && expectedSrs !== null && decoded.srsId !== expectedSrs) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_CRS_MIXED',
        'crs',
        `${ingest.location}: the geometry uses srs_id ${decoded.srsId}, but layer "${plan.layerName}" declares ${expectedSrs}. Pass --source-crs if every row really shares one CRS.`,
      );
    }
    if (decoded?.extraDimensions) ingest.warn('Z and M values in the GeoPackage were ignored.');
    const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const column of attributes) {
      const value = row[column.name];
      if (value instanceof Uint8Array) {
        ingest.warn(blobWarning);
        continue;
      }
      properties[column.name] = attributeValue(value, column.boolean);
    }
    ingest.add(
      decoded?.geometry ?? null,
      properties,
      idColumn === null ? undefined : idValue(row[idColumn]),
    );
  }
}

function attributeValue(value: unknown, boolean: boolean): unknown {
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return value.toString();
    return boolean && (number === 0 || number === 1) ? number === 1 : number;
  }
  // SQLite can store infinities, which a vector tile value has no use for.
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

function idValue(value: unknown): unknown {
  if (typeof value !== 'bigint') return value;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value.toString();
}

function loadSqlite(): SqliteModule {
  // Reached only for GeoPackage input, and through a lookup rather than an import, so that every
  // other format keeps working on a Node.js without the module. Its experimental warning would
  // otherwise reach the stderr of `--json` runs; only that one warning is filtered.
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite is an experimental feature')) return;
    (emitWarning as (...values: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const sqlite = process.getBuiltinModule?.('node:sqlite') as SqliteModule | undefined;
    if (typeof sqlite?.StatementSync?.prototype?.iterate === 'function') return sqlite;
  } finally {
    process.emitWarning = emitWarning;
  }
  throw new TilesetBuildError(
    'TF_TILESET_BUILD_RUNTIME_UNSUPPORTED',
    'input',
    `Reading a GeoPackage needs Node.js 22.13 or later; this is ${process.version}. Upgrade Node.js, or convert the data to GeoJSON first.`,
  );
}

/**
 * `immutable` means no locks and no `-wal` or `-shm` files beside the input. It would also ignore
 * work a writer left unfinished: edits pending in a write-ahead log, which an ordinary read-only open
 * includes, and a hot rollback journal, which it refuses instead of reading half a transaction.
 */
function openDatabase(sqlite: SqliteModule, path: string): DatabaseSync {
  const unfinished = (suffix: string) =>
    (statSync(`${path}${suffix}`, {throwIfNoEntry: false})?.size ?? 0) > 0;
  if (!unfinished('-wal') && !unfinished('-journal')) {
    try {
      return new sqlite.DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, {readOnly: true});
    } catch {
      // Early Node.js 22 releases do not open SQLite URIs; the plain path below still reads.
    }
  }
  return guarded(() => new sqlite.DatabaseSync(path, {readOnly: true}));
}

function plainTables(database: DatabaseSync): ReadonlySet<string> {
  const rows = database
    .prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table'")
    .all() as unknown as {name: string}[];
  return new Set(rows.map((row) => row.name.toLowerCase()));
}

function requireGeoPackage(tables: ReadonlySet<string>): void {
  // Checked by kind: one of these defined as a view could run arbitrary SQL for every read.
  const missing = requiredTables.filter((name) => !tables.has(name));
  if (missing.length > 0) {
    throw invalid(`the file is not a GeoPackage: it has no ${missing.join(', ')} table.`);
  }
}

/** Joined here rather than in SQL, where a hostile file with many rows makes the join quadratic. */
function listLayers(database: DatabaseSync, tables: ReadonlySet<string>): LayerRow[] {
  const read = <T>(query: string): T[] => {
    const rows = database.prepare(`${query} LIMIT ${maximumLayers + 1}`).all() as unknown as T[];
    if (rows.length > maximumLayers) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_LIMIT',
        'input',
        `The GeoPackage lists more than ${maximumLayers} tables.`,
      );
    }
    return rows;
  };
  const columns = new Map(
    read<LayerRow>(
      'SELECT table_name AS name, column_name AS geometryColumn, srs_id AS srsId FROM gpkg_geometry_columns',
    ).map((row) => [row.name.toLowerCase(), row]),
  );
  const layers: LayerRow[] = [];
  for (const {name} of read<{name: string}>(
    "SELECT table_name AS name FROM gpkg_contents WHERE data_type = 'features'",
  )) {
    const key = name.toLowerCase();
    const column = columns.get(key);
    if (column && tables.has(key)) layers.push({...column, name});
  }
  return layers.sort((left, right) => (left.name < right.name ? -1 : 1));
}

function chooseLayer(layers: readonly LayerRow[], requested: string | undefined): LayerRow {
  const names = layers.map((layer) => layer.name);
  if (layers.length === 0) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_LAYER_INVALID',
      'inputLayer',
      'The GeoPackage has no feature tables. Tile matrices, attribute tables and SQL views are not read.',
    );
  }
  if (requested !== undefined) {
    const match = layers.find((layer) => layer.name === requested);
    if (match) return match;
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_LAYER_INVALID',
      'inputLayer',
      `The GeoPackage has no feature table named "${requested}". It has: ${listChoices(names)}.`,
    );
  }
  if (layers.length > 1) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_INPUT_LAYER_INVALID',
      'inputLayer',
      `The GeoPackage has ${names.length} feature tables. Choose one with --input-layer: ${listChoices(names)}.`,
    );
  }
  return layers[0];
}

function readSrs(database: DatabaseSync, srsId: number): GeopackageSrs | undefined {
  const hasWkt2 = database
    .prepare(
      "SELECT 1 FROM pragma_table_xinfo('gpkg_spatial_ref_sys') WHERE name = 'definition_12_063'",
    )
    .get();
  const row = database
    .prepare(
      `SELECT srs_id AS srsId, organization, organization_coordsys_id AS organizationCode,
              definition${hasWkt2 ? ', definition_12_063 AS definition12063' : ''}
       FROM gpkg_spatial_ref_sys WHERE srs_id = ?`,
    )
    .get(srsId) as
    | Readonly<{
        definition: string | null;
        definition12063?: string | null;
        organization: string | null;
        organizationCode: number | null;
        srsId: number;
      }>
    | undefined;
  return row ? {...row, definition12063: row.definition12063 ?? null} : undefined;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function invalid(detail: string): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_INVALID',
    'input',
    `The GeoPackage could not be read: ${detail}`,
  );
}

function unreadable(error: unknown): unknown {
  if (error instanceof TilesetBuildError) return error;
  return invalid(`${error instanceof Error ? error.message : 'unknown error'}.`);
}

function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw unreadable(error);
  }
}

async function guardedAsync(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw unreadable(error);
  }
}

type DecodedGeometry = Readonly<{
  extraDimensions: boolean;
  geometry: GeometryInput | null;
  srsId: number;
}>;

/** GeoPackageBinary: a `GP` header with the srs_id and an optional envelope, then ISO WKB. */
function decodeGeometry(blob: Uint8Array, location: string): DecodedGeometry {
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (bytes.length < 8 || bytes[0] !== 0x47 || bytes[1] !== 0x50) {
    throw invalid(`${location}: the geometry has no GeoPackage binary header.`);
  }
  const flags = bytes[3];
  if ((flags & 0x20) !== 0) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
      'input',
      `${location}: the geometry uses the extended GeoPackage binary encoding, which is not supported.`,
    );
  }
  const envelopeKind = (flags >> 1) & 0x07;
  if (envelopeKind > 4) throw invalid(`${location}: the geometry header is malformed.`);
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeKind];
  const srsId = (flags & 0x01) === 1 ? bytes.readInt32LE(4) : bytes.readInt32BE(4);
  if ((flags & 0x10) !== 0) return {extraDimensions: false, geometry: null, srsId};
  const reader = new WkbReader(bytes, 8 + envelopeBytes, location);
  const geometry = reader.geometry(0);
  return {extraDimensions: reader.extraDimensions, geometry, srsId};
}

class WkbReader {
  extraDimensions = false;
  #positions = 0;

  constructor(
    private readonly bytes: Buffer,
    private offset: number,
    private readonly location: string,
  ) {}

  geometry(depth: number, expected?: number): GeometryInput | null {
    if (depth > maximumGeometryDepth) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_LIMIT',
        'input',
        `${this.location}: geometries nest more than ${maximumGeometryDepth} levels deep.`,
      );
    }
    this.#need(5);
    const littleEndian = this.bytes[this.offset] === 1;
    const code = littleEndian
      ? this.bytes.readUInt32LE(this.offset + 1)
      : this.bytes.readUInt32BE(this.offset + 1);
    this.offset += 5;
    const base = code % 1000;
    const dimensionCode = Math.floor(code / 1000);
    if (dimensionCode > 3) throw this.#malformed(`unknown geometry code ${code}`);
    if (expected !== undefined && base !== expected) {
      throw this.#malformed(`a multi-geometry holds geometry code ${code}`);
    }
    const size = dimensionCode === 0 ? 2 : dimensionCode === 3 ? 4 : 3;
    if (size > 2) this.extraDimensions = true;
    const read = {littleEndian, size};
    switch (base) {
      case 1: {
        const position = this.#position(read);
        // ISO WKB spells an empty point as NaN coordinates.
        return Number.isNaN(position[0]) ? null : {coordinates: position, type: 'Point'};
      }
      case 2:
        return {coordinates: this.#line(read), type: 'LineString'};
      case 3:
        return {coordinates: this.#rings(read), type: 'Polygon'};
      case 4:
        return {
          coordinates: this.#children(read, depth, 1).map((child) => child.coordinates),
          type: 'MultiPoint',
        };
      case 5:
        return {
          coordinates: this.#children(read, depth, 2).map((child) => child.coordinates),
          type: 'MultiLineString',
        };
      case 6:
        return {
          coordinates: this.#children(read, depth, 3).map((child) => child.coordinates),
          type: 'MultiPolygon',
        };
      case 7:
        return {geometries: this.#children(read, depth), type: 'GeometryCollection'};
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
        throw new TilesetBuildError(
          'TF_TILESET_BUILD_FORMAT_UNSUPPORTED',
          'input',
          `${this.location}: curved and surface geometries are not supported. Convert them to lines and polygons first.`,
        );
      default:
        throw this.#malformed(`unknown geometry code ${code}`);
    }
  }

  #children(
    read: Readonly<{littleEndian: boolean; size: number}>,
    depth: number,
    expected?: number,
  ): GeometryInput[] {
    // Every member takes at least its 5-byte header, which bounds the count by the bytes left.
    const count = this.#count(read, 5);
    const children: GeometryInput[] = [];
    for (let index = 0; index < count; index += 1) {
      this.#spendPosition();
      const child = this.geometry(depth + 1, expected);
      if (child) children.push(child);
    }
    return children;
  }

  #rings(read: Readonly<{littleEndian: boolean; size: number}>): number[][][] {
    const count = this.#count(read, 4);
    const rings: number[][][] = [];
    for (let index = 0; index < count; index += 1) {
      this.#spendPosition();
      rings.push(this.#line(read));
    }
    return rings;
  }

  #line(read: Readonly<{littleEndian: boolean; size: number}>): number[][] {
    const count = this.#count(read, read.size * 8);
    const positions: number[][] = [];
    for (let index = 0; index < count; index += 1) positions.push(this.#position(read));
    return positions;
  }

  #position(read: Readonly<{littleEndian: boolean; size: number}>): number[] {
    this.#spendPosition();
    this.#need(read.size * 8);
    const {bytes, offset} = this;
    this.offset += read.size * 8;
    return read.littleEndian
      ? [bytes.readDoubleLE(offset), bytes.readDoubleLE(offset + 8)]
      : [bytes.readDoubleBE(offset), bytes.readDoubleBE(offset + 8)];
  }

  /** Positions and parts count alike: an empty part costs memory too. */
  #spendPosition(): void {
    this.#positions += 1;
    if (this.#positions > maximumFeaturePositions) throw featureTooLarge(this.location);
  }

  #count(read: Readonly<{littleEndian: boolean}>, itemBytes: number): number {
    this.#need(4);
    const count = read.littleEndian
      ? this.bytes.readUInt32LE(this.offset)
      : this.bytes.readUInt32BE(this.offset);
    this.offset += 4;
    this.#need(count * itemBytes);
    return count;
  }

  #need(size: number): void {
    if (this.offset + size > this.bytes.length) throw this.#malformed('the geometry ends early');
  }

  #malformed(reason: string): TilesetBuildError {
    return invalid(`${this.location}: ${reason}.`);
  }
}
