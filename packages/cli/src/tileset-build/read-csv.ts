import {closeSync, openSync, readSync} from 'node:fs';
import {TilesetBuildError, yieldToEventLoop} from './errors';
import type {FeatureIngest} from './ingest';

const chunkBytes = 4 * 1024 * 1024;
const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
const longitudeNames = new Set(['lon', 'lng', 'long', 'longitude', 'x_lon', 'lon_x']);
const latitudeNames = new Set(['lat', 'latitude', 'y_lat', 'lat_y']);

export type CsvOptions = Readonly<{
  latColumn?: string;
  lonColumn?: string;
}>;

type ColumnType = 'boolean' | 'number' | 'string' | null;

export async function readCsv(
  path: string,
  ingest: FeatureIngest,
  options: CsvOptions,
): Promise<void> {
  const delimiter = detectCsvDelimiter(path);
  // A first pass types columns as a whole: "01234" in one row must not make the rest numeric.
  let header: string[] | null = null;
  let types: ColumnType[] = [];
  await forEachCsvRow(path, delimiter, (row, line) => {
    if (!header) {
      header = row;
      types = row.map(() => null);
      return;
    }
    if (row.length === 1 && row[0] === '') return;
    if (row.length !== header.length) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_INVALID',
        'input',
        `row ${line}: expected ${header.length} columns but found ${row.length}. Check quoting and the delimiter.`,
      );
    }
    for (let index = 0; index < row.length; index += 1) {
      types[index] = mergeType(types[index], row[index]);
    }
  });
  if (!header) {
    throw new TilesetBuildError('TF_TILESET_BUILD_EMPTY', 'input', 'The CSV file is empty.');
  }
  const columns: string[] = header;
  const longitude = coordinateColumn(columns, options.lonColumn, longitudeNames, 'longitude');
  const latitude = coordinateColumn(columns, options.latColumn, latitudeNames, 'latitude');

  let isHeader = true;
  await forEachCsvRow(path, delimiter, (row, line) => {
    if (isHeader) {
      isHeader = false;
      return;
    }
    if (row.length === 1 && row[0] === '') return;
    ingest.location = `row ${line}`;
    const rawX = row[longitude].trim();
    const rawY = row[latitude].trim();
    if (rawX === '' && rawY === '') {
      ingest.skipEmpty();
      return;
    }
    const x = Number(rawX);
    const y = Number(rawY);
    if (rawX === '' || rawY === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_INVALID',
        'input',
        `row ${line}: coordinates "${rawX}", "${rawY}" are not numbers. Decimal commas are not supported.`,
      );
    }
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < row.length; index += 1) {
      if (index === longitude || index === latitude) continue;
      const value = typedValue(row[index], types[index]);
      if (value !== null) properties[columns[index]] = value;
    }
    ingest.add({coordinates: [x, y], type: 'Point'}, properties);
  });
}

/** Whether a CRS can be assumed: standard names say lon/lat, anything else says nothing. */
export async function csvColumnsNameCoordinates(
  path: string,
  options: CsvOptions,
): Promise<boolean> {
  if (options.lonColumn || options.latColumn) return true;
  let names: string[] = [];
  await forEachCsvRow(path, detectCsvDelimiter(path), (row) => {
    names = row;
    return 'stop';
  });
  const normalized = names.map(normalizeName);
  return (
    normalized.some((name) => longitudeNames.has(name)) &&
    normalized.some((name) => latitudeNames.has(name))
  );
}

export async function csvColumnNames(path: string): Promise<string[]> {
  let names: string[] = [];
  await forEachRow(path, detectDelimiter(path), (row) => {
    names = row;
    return 'stop';
  });
  return names;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function coordinateColumn(
  header: readonly string[],
  requested: string | undefined,
  names: ReadonlySet<string>,
  label: string,
): number {
  if (requested !== undefined) {
    const index = header.indexOf(requested);
    if (index < 0) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_CSV_COLUMNS',
        'input.columns',
        `Column "${requested}" does not exist. Available columns: ${header.join(', ')}.`,
      );
    }
    return index;
  }
  const matches = header.flatMap((name, index) => (names.has(normalizeName(name)) ? [index] : []));
  if (matches.length === 1) return matches[0];
  throw new TilesetBuildError(
    'TF_TILESET_BUILD_CSV_COLUMNS',
    'input.columns',
    matches.length > 1
      ? `Several columns could hold the ${label}: ${matches.map((index) => header[index]).join(', ')}. Pick one with --${label === 'longitude' ? 'lon' : 'lat'}-column.`
      : `No ${label} column found among: ${header.join(', ')}. Name it with --${label === 'longitude' ? 'lon' : 'lat'}-column. Columns such as x and y are never assumed to be WGS84.`,
  );
}

function mergeType(current: ColumnType, value: string): ColumnType {
  if (value === '') return current;
  const type = valueType(value);
  if (current === null || current === type) return type;
  return 'string';
}

function valueType(value: string): Exclude<ColumnType, null> {
  if (value === 'true' || value === 'false') return 'boolean';
  if (numberPattern.test(value) && Number.isFinite(Number(value))) {
    // Identifiers longer than a double can carry must stay intact.
    return value.includes('.') ||
      value.includes('e') ||
      value.includes('E') ||
      Number.isSafeInteger(Number(value))
      ? 'number'
      : 'string';
  }
  return 'string';
}

function typedValue(value: string, type: ColumnType): boolean | number | string | null {
  if (value === '') return null;
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}

export function detectCsvDelimiter(path: string): string {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(65_536);
  const counts = new Map([',', ';', '\t', '|'].map((delimiter) => [delimiter, 0]));
  let quoted = false;
  try {
    let done = false;
    while (!done) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      for (const byte of buffer.subarray(0, bytes)) {
        const character = String.fromCharCode(byte);
        if (character === '"') quoted = !quoted;
        else if (!quoted) {
          if (character === '\n' || character === '\r') {
            done = true;
            break;
          }
          const count = counts.get(character);
          if (count !== undefined) counts.set(character, count + 1);
        }
      }
    }
  } finally {
    closeSync(descriptor);
  }
  let best = ',';
  let bestCount = 0;
  for (const [candidate, count] of counts) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 parsing with quoted delimiters and newlines, streamed in chunks. */
export async function forEachCsvRow(
  path: string,
  delimiter: string,
  visit: (row: string[], line: number) => 'stop' | void,
): Promise<void> {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(chunkBytes);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quotePending = false;
  let line = 1;
  let rowLine = 1;
  let first = true;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  let stopped = false;
  const endRow = () => {
    endCell();
    if (visit(row, rowLine) === 'stop') stopped = true;
    row = [];
  };
  const decode = (bytes?: Buffer) => {
    try {
      return bytes ? decoder.decode(bytes, {stream: true}) : decoder.decode();
    } catch {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_INVALID',
        'input',
        `Near row ${line}: the CSV file is not valid UTF-8. Re-encode it as UTF-8 first.`,
      );
    }
  };
  const consume = (text: string) => {
    let start = 0;
    let index = 0;
    const length = text.length;
    while (index < length && !stopped) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          cell += text.slice(start, index);
          quoted = false;
          quotePending = true;
          start = index + 1;
        } else if (character === '\n') {
          line += 1;
        }
        index += 1;
        continue;
      }
      if (quotePending) {
        quotePending = false;
        if (character === '"') {
          cell += '"';
          quoted = true;
          start = index + 1;
          index += 1;
          continue;
        }
      }
      if (character === '"' && start === index && cell === '') {
        quoted = true;
        start = index + 1;
      } else if (character === delimiter) {
        cell += text.slice(start, index);
        endCell();
        start = index + 1;
      } else if (character === '\n') {
        cell += text.slice(start, index);
        if (cell.endsWith('\r')) cell = cell.slice(0, -1);
        endRow();
        line += 1;
        rowLine = line;
        start = index + 1;
      }
      index += 1;
    }
    cell += text.slice(start, length);
  };

  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, chunkBytes, null);
      if (bytes === 0) break;
      let text = decode(buffer.subarray(0, bytes));
      if (first) {
        first = false;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      consume(text);
      if (stopped) return;
      await yieldToEventLoop();
    }
    consume(decode());
    if (quoted) {
      throw new TilesetBuildError(
        'TF_TILESET_BUILD_INPUT_INVALID',
        'input',
        `row ${rowLine}: a quoted value never closes.`,
      );
    }
    if (cell !== '' || row.length > 0) {
      if (cell.endsWith('\r')) cell = cell.slice(0, -1);
      endRow();
    }
  } finally {
    closeSync(descriptor);
  }
}
