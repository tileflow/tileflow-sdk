import {createHash, randomUUID} from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  linkSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import {type GeocodingForwardResponse, geocodingLimits} from '@tileflow/search';
import {detectCsvDelimiter, forEachCsvRow} from './tileset-build/read-csv';

type Stage = 'pending' | 'active' | 'matched' | 'unmatched';
const applicationId = 0x54464731; // TFG1

export function openGeocodingCheckpoint(output: string) {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as
    typeof import('node:sqlite') | undefined;
  if (!sqlite) throw new Error('CSV geocoding requires Node.js 22.13 or later with node:sqlite.');
  const path = output + '.geocode.sqlite';
  let created = false;
  try {
    closeSync(openSync(path, 'wx', 0o600));
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!lstatSync(path).isFile()) throw new Error('The checkpoint must be a regular file.');
  }

  const db = new sqlite.DatabaseSync(path);
  try {
    // The OS releases this exclusive lock on exit. Row completions still commit independently.
    db.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE');
    const id = db.prepare('PRAGMA application_id').get()?.application_id;
    if (created || (id === 0 && lstatSync(path).size === 0)) {
      db.exec(`
        PRAGMA application_id = ${applicationId};
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE jobs (
          address TEXT PRIMARY KEY, stage TEXT NOT NULL DEFAULT 'pending',
          position TEXT, attribution TEXT, units INTEGER
        );
        CREATE INDEX jobs_by_stage ON jobs(stage);
        CREATE TABLE records (line INTEGER PRIMARY KEY, properties TEXT NOT NULL, address TEXT, issue TEXT);
      `);
    } else if (id !== applicationId) {
      throw new Error('The checkpoint belongs to another file or format.');
    }
    db.exec('COMMIT');
    return {
      jobs: geocodingJobs(db),
      async prepare(input: string, columns: string[], apiUrl: string, apiKey: string) {
        checkGeocodingOutputPaths(db, output);
        await prepareGeocodingRows(db, input, columns, apiUrl, apiKey);
      },
      count: (stage: Stage) => countGeocodingJobs(db, stage),
      acceptEstimate(retryUnconfirmed: boolean) {
        if (retryUnconfirmed) db.exec("UPDATE jobs SET stage = 'pending' WHERE stage = 'active'");
        db.exec('COMMIT');
      },
      exportRows: () => exportGeocodingRows(db, output),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    if ((error as {errcode?: number}).errcode === 5)
      throw new Error('Another geocode process is using this output.');
    throw error;
  }
}

async function prepareGeocodingRows(
  db: DatabaseSync,
  input: string,
  columns: string[],
  apiUrl: string,
  apiKey: string,
) {
  const saved = db.prepare("SELECT value FROM metadata WHERE key = 'input'").get()?.value;
  const digest = createHash('sha256');
  // Bind to the credential without storing its value in the checkpoint.
  digest.update(
    JSON.stringify([
      columns,
      new URL(apiUrl).href,
      createHash('sha256').update(apiKey).digest('hex'),
    ]),
  );
  const addJob = db.prepare('INSERT OR IGNORE INTO jobs (address) VALUES (?)');
  const addRecord = db.prepare('INSERT INTO records VALUES (?,?,?,?)');
  let header: string[] | undefined;
  let indexes: number[] = [];
  db.exec('BEGIN');
  try {
    await forEachCsvRow(input, detectCsvDelimiter(input), (cells, line) => {
      digest.update(JSON.stringify([line, cells]) + '\n');
      if (!header) {
        if (cells.some((name) => !name.trim()) || new Set(cells).size !== cells.length)
          throw new Error('CSV headers must be nonempty and unique.');
        header = cells;
        indexes = columns.map((name) => {
          const index = cells.indexOf(name);
          if (index < 0) throw new Error(`Address column "${name}" is missing.`);
          return index;
        });
        return;
      }
      if (cells.length === 1 && cells[0] === '' && header.length !== 1) return;
      if (header.length !== cells.length)
        throw new Error(`CSV row ${line} has the wrong number of columns.`);
      if (saved !== undefined) return;
      const address = indexes
        .map((index) => cells[index]!.trim().replace(/\s+/gu, ' '))
        .filter(Boolean)
        .join(', ');
      const issue = !address
        ? 'empty_address'
        : address.length > geocodingLimits.maximumQueryCharacters || /\p{Cc}/u.test(address)
          ? 'invalid_address'
          : null;
      if (!issue) addJob.run(address);
      const properties = Object.fromEntries(header.map((key, index) => [key, cells[index]]));
      addRecord.run(line, JSON.stringify(properties), issue ? null : address, issue);
    });
    if (!header) throw new Error('The CSV is empty.');
    const signature = digest.digest('hex');
    if (saved === undefined) db.prepare("INSERT INTO metadata VALUES ('input', ?)").run(signature);
    else if (signature !== saved)
      throw new Error(
        'CSV, address columns, endpoint or credential changed. Choose a new output path.',
      );
    // The caller commits after confirmation. Closing on cancellation discards the staged rows.
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function countGeocodingJobs(db: DatabaseSync, stage: Stage): number {
  return Number(db.prepare('SELECT count(*) AS count FROM jobs WHERE stage = ?').get(stage)?.count);
}

function geocodingJobs(db: DatabaseSync) {
  const pending = db.prepare(
    "SELECT address FROM jobs WHERE stage = 'pending' ORDER BY rowid LIMIT 1",
  );
  const update = db.prepare('UPDATE jobs SET stage = ? WHERE address = ?');
  const finish = db.prepare(
    'UPDATE jobs SET stage = ?, position = ?, attribution = ?, units = ? WHERE address = ?',
  );
  return {
    claim() {
      const address = pending.get()?.address as string | undefined;
      if (address !== undefined) update.run('active', address);
      return address;
    },
    release(address: string) {
      update.run('pending', address);
    },
    complete(address: string, response: GeocodingForwardResponse) {
      const position = response.results[0]?.position;
      finish.run(
        position ? 'matched' : 'unmatched',
        position ? JSON.stringify(position) : null,
        JSON.stringify(response.attribution),
        response.usage.units,
        address,
      );
    },
  };
}

function checkGeocodingOutputPaths(db: DatabaseSync, output: string) {
  const publishing = db.prepare("SELECT 1 FROM metadata WHERE key = 'publishing'").get();
  for (const path of [output, output + '.unmatched.csv']) {
    const entry = lstatSync(path, {throwIfNoEntry: false});
    if (entry && (!publishing || !entry.isFile()))
      throw new Error(`Output already exists: ${path}. Choose a new output path.`);
  }
}

async function exportGeocodingRows(db: DatabaseSync, output: string) {
  const entries = new Map<string, {text: string; url?: string}>();
  for (const row of db
    .prepare(
      'SELECT DISTINCT attribution FROM jobs WHERE attribution IS NOT NULL ORDER BY attribution',
    )
    .iterate()) {
    for (const entry of JSON.parse(String(row.attribution)))
      entries.set(JSON.stringify(entry), entry);
  }

  const attribution = [...entries.values()];
  const tmp = output + '.' + randomUUID() + '.tmp';
  const report = output + '.unmatched.csv';
  const tmpReport = tmp + '.csv';
  let matched = 0;
  let unmatched = 0;
  try {
    const features = openSync(tmp, 'wx', 0o600);
    try {
      const misses = openSync(tmpReport, 'wx', 0o600);
      try {
        writeFileSync(
          features,
          `{"type":"FeatureCollection","attribution":${JSON.stringify(attribution)},"features":[`,
        );
        writeFileSync(misses, 'row,reason\n');
        for (const row of db
          .prepare(
            `SELECT r.line, r.properties, r.issue, j.position, j.stage
          FROM records r LEFT JOIN jobs j ON j.address = r.address ORDER BY r.line`,
          )
          .iterate()) {
          if (row.position === null) {
            if (!row.issue && row.stage !== 'unmatched')
              throw new Error('A row still requires geocoding.');
            writeFileSync(misses, `${row.line},${row.issue ?? 'no_match'}\n`);
            unmatched++;
          } else {
            const feature = {
              type: 'Feature',
              id: row.line,
              geometry: {type: 'Point', coordinates: JSON.parse(String(row.position))},
              properties: JSON.parse(String(row.properties)),
            };
            writeFileSync(features, (matched ? ',\n' : '') + JSON.stringify(feature));
            matched++;
          }
        }
        writeFileSync(features, ']}\n');
      } finally {
        closeSync(misses);
      }
    } finally {
      closeSync(features);
    }

    db.prepare("INSERT OR IGNORE INTO metadata VALUES ('publishing', '1')").run();
    await installOutput(tmpReport, report);
    await installOutput(tmp, output);
    const recordedUnits = db
      .prepare('SELECT CAST(coalesce(sum(units), 0) AS TEXT) AS total FROM jobs')
      .get()!.total;
    return {matched, unmatched, attribution, recordedUnits};
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
    if (existsSync(tmpReport)) unlinkSync(tmpReport);
  }
}

// An interrupted export can be completed again without replacing a user's edited file.
async function installOutput(source: string, target: string) {
  try {
    linkSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!lstatSync(target).isFile() || (await fileDigest(source)) !== (await fileDigest(target)))
      throw new Error(`Output differs from the checkpoint: ${target}. Move it before resuming.`);
  }
}

async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
