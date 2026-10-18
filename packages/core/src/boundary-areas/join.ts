import {
  isTileflowBoundaryClass,
  tileflowBoundaryClassTiers,
  type TileflowBoundaryClass,
  type TileflowBoundaryClassTier,
} from './schema';

/** A value a choropleth can colour: a number for scales, a string for categories. */
export type TileflowBoundaryValue = number | string;

/** One row of an application's data, keyed by a registry ID or an official code. */
export type TileflowBoundaryRow = Readonly<{
  key: number | string;
  /** `null` leaves the area without a value. */
  value: TileflowBoundaryValue | null;
}>;

/** Keys present on every `boundary_area` polygon, usable without the lookup table. */
export type TileflowBoundaryFeatureKey = 'id' | 'iso_3166_1' | 'ref';

/** Keys a row can carry. Those absent from the polygons need the lookup table. */
export type TileflowBoundaryCode = TileflowBoundaryFeatureKey | 'iso_3166_2' | 'nuts' | 'wikidata';

/** Rows joined to areas by one polygon key. */
export type TileflowBoundaryValues = Readonly<{
  joinBy: TileflowBoundaryFeatureKey;
  rows: readonly TileflowBoundaryRow[];
}>;

/** One unit drawn as one class, as the release's lookup table lists it. */
export type TileflowBoundaryLookupRow = Readonly<{
  admin_level?: number;
  class: TileflowBoundaryClass;
  class_tier?: TileflowBoundaryClassTier;
  id: number;
  iso_3166_1?: string;
  iso_3166_2?: string;
  name?: string;
  name_en?: string;
  nuts?: string;
  ref?: string;
  wikidata?: string;
}>;

export type TileflowBoundaryLookup = Readonly<{
  /** Lookup rows whose code equals `key`, optionally limited to some classes. */
  find: (
    joinBy: TileflowBoundaryCode,
    key: number | string,
    classes?: readonly TileflowBoundaryClass[],
  ) => readonly TileflowBoundaryLookupRow[];
  rows: readonly TileflowBoundaryLookupRow[];
}>;

export type TileflowBoundaryJoinResult = TileflowBoundaryValues &
  Readonly<{
    /** Keys that resolved to more than one unit; their rows are left out. */
    ambiguous: readonly (number | string)[];
    /** Keys that appeared more than once; the last row wins. */
    duplicates: readonly (number | string)[];
    /** Keys that matched no unit. */
    unmatched: readonly (number | string)[];
  }>;

export type JoinBoundaryRowsOptions = Readonly<{
  /** Limit lookup matches to these classes, for codes shared across a unit's classes. */
  classes?: readonly TileflowBoundaryClass[];
  /** The key the rows carry. */
  joinBy: TileflowBoundaryCode;
  /** Required unless the rows already carry the target key. */
  lookup?: TileflowBoundaryLookup;
  /** The feature key to produce: the registry ID (default) or `ref`. */
  to?: 'id' | 'ref';
}>;

/**
 * Re-key rows to the feature key a choropleth or feature-state uses. Keys are normalized:
 * ISO 3166, NUTS and Wikidata codes are trimmed and upper-cased; `ref` is trimmed.
 */
export function joinBoundaryRows(
  rows: readonly TileflowBoundaryRow[],
  options: JoinBoundaryRowsOptions,
): TileflowBoundaryJoinResult {
  const to = options.to ?? 'id';
  if (to !== 'id' && to !== 'ref') throw new Error('joinBoundaryRows "to" must be "id" or "ref".');
  assertCode(options.joinBy);
  const direct = options.joinBy === to;
  if (!direct && !options.lookup) {
    throw new Error(
      `Joining rows by ${options.joinBy} to ${to} requires the Boundaries lookup table.`,
    );
  }
  for (const value of options.classes ?? []) assertClass(value);

  const values = new Map<number | string, TileflowBoundaryValue | null>();
  const seen = new Set<number | string>();
  const duplicates = new Set<number | string>();
  const unmatched: (number | string)[] = [];
  const ambiguous: (number | string)[] = [];

  for (const row of rows) {
    const key = normalizeCode(options.joinBy, row.key);
    if (key === undefined) {
      unmatched.push(row.key);
      continue;
    }
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    if (direct) {
      values.set(key, row.value);
      continue;
    }
    const matches = options.lookup!.find(options.joinBy, key, options.classes);
    if (matches.length === 0) {
      unmatched.push(row.key);
      continue;
    }
    if (new Set(matches.map(({id}) => id)).size > 1) {
      ambiguous.push(row.key);
      continue;
    }
    const targets =
      to === 'id' ? [matches[0]!.id] : matches.flatMap(({ref}) => (ref === undefined ? [] : [ref]));
    if (targets.length === 0) {
      unmatched.push(row.key);
      continue;
    }
    for (const target of targets) values.set(target, row.value);
  }

  return Object.freeze({
    ambiguous: Object.freeze(ambiguous),
    duplicates: Object.freeze([...duplicates]),
    joinBy: to,
    rows: Object.freeze(
      [...values].map(([key, value]) => Object.freeze({key, value})),
    ) as readonly TileflowBoundaryRow[],
    unmatched: Object.freeze(unmatched),
  });
}

/** Index lookup rows by every code they carry. */
export function createBoundaryLookup(
  rows: readonly TileflowBoundaryLookupRow[],
): TileflowBoundaryLookup {
  const indexes = new Map<
    TileflowBoundaryCode,
    Map<number | string, TileflowBoundaryLookupRow[]>
  >();
  const codes: readonly TileflowBoundaryCode[] = [
    'id',
    'ref',
    'iso_3166_1',
    'iso_3166_2',
    'nuts',
    'wikidata',
  ];
  for (const code of codes) indexes.set(code, new Map());
  const frozenRows = Object.freeze(rows.map((row) => Object.freeze({...row})));
  for (const row of frozenRows) {
    if (!Number.isSafeInteger(row.id) || row.id < 0) {
      throw new Error(`Boundaries lookup row has an invalid id: ${String(row.id)}.`);
    }
    assertClass(row.class);
    for (const code of codes) {
      const raw = row[code];
      if (raw === undefined) continue;
      const key = normalizeCode(code, raw);
      if (key === undefined) continue;
      const index = indexes.get(code)!;
      const list = index.get(key);
      if (list) list.push(row);
      else index.set(key, [row]);
    }
  }
  return Object.freeze({
    find(joinBy, key, classes) {
      assertCode(joinBy);
      const normalized = normalizeCode(joinBy, key);
      if (normalized === undefined) return [];
      const matches = indexes.get(joinBy)!.get(normalized) ?? [];
      return classes === undefined ? matches : matches.filter((row) => classes.includes(row.class));
    },
    rows: frozenRows,
  });
}

const numericLookupColumns = new Set(['admin_level', 'id']);
const lookupColumns = new Set([
  'admin_level',
  'class',
  'class_tier',
  'id',
  'iso_3166_1',
  'iso_3166_2',
  'name',
  'name_en',
  'nuts',
  'ref',
  'wikidata',
]);

/**
 * Parse the text of a Boundaries release's `boundaries-lookup.csv` (after decompressing the
 * `.csv.gz`). Columns the join does not use are ignored; empty cells are omitted.
 */
export function parseBoundaryLookupCsv(text: string): TileflowBoundaryLookupRow[] {
  const records = parseCsv(text);
  const header = records.shift();
  if (!header?.includes('id') || !header.includes('class')) {
    throw new Error('Boundaries lookup CSV must start with a header that has id and class.');
  }
  const rows: TileflowBoundaryLookupRow[] = [];
  records.forEach((record, index) => {
    if (record.length === 1 && record[0] === '') return;
    if (record.length !== header.length) {
      throw new Error(
        `Boundaries lookup CSV row ${index + 2} has ${record.length} fields; expected ${header.length}.`,
      );
    }
    const row: Record<string, number | string> = {};
    header.forEach((column, position) => {
      const cell = record[position]!;
      if (cell === '' || !lookupColumns.has(column)) return;
      if (numericLookupColumns.has(column)) {
        const number = Number(cell);
        if (!Number.isSafeInteger(number)) {
          throw new Error(`Boundaries lookup CSV row ${index + 2} has a non-integer ${column}.`);
        }
        row[column] = number;
      } else {
        row[column] = cell;
      }
    });
    if (row.class_tier !== undefined && !isClassTier(row.class_tier)) {
      throw new Error(`Boundaries lookup CSV row ${index + 2} has an unknown class_tier.`);
    }
    rows.push(row as unknown as TileflowBoundaryLookupRow);
  });
  return rows;
}

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Boundaries lookup CSV ends inside a quoted field.');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function normalizeCode(
  code: TileflowBoundaryCode,
  key: number | string,
): number | string | undefined {
  if (code === 'id') {
    const id = typeof key === 'number' ? key : key.trim() === '' ? NaN : Number(key);
    return Number.isSafeInteger(id) && id >= 0 ? id : undefined;
  }
  if (typeof key !== 'string') return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return code === 'ref' ? trimmed : trimmed.toUpperCase();
}

function assertCode(value: unknown): asserts value is TileflowBoundaryCode {
  if (!['id', 'ref', 'iso_3166_1', 'iso_3166_2', 'nuts', 'wikidata'].includes(value as string)) {
    throw new Error(`Unknown Boundaries join key: ${String(value)}.`);
  }
}

function assertClass(value: unknown): asserts value is TileflowBoundaryClass {
  if (!isTileflowBoundaryClass(value)) {
    throw new Error(`Unknown Boundaries class: ${String(value)}.`);
  }
}

function isClassTier(value: unknown): value is TileflowBoundaryClassTier {
  return (tileflowBoundaryClassTiers as readonly unknown[]).includes(value);
}
