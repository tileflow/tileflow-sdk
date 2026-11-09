import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {getCliVersion} from '../src/cli-version';
import {buildTileset} from '../src/tileset-build/build';
import {GeojsonFeatureReader} from '../src/tileset-build/geojson-stream';
import {FeatureIngest} from '../src/tileset-build/ingest';
import type {TilesetFile, TilesetPlatform, TilesetStorage} from '../src/tileset-build/platform';
import {utf8ByteLength} from '../src/tileset-build/platform';
import {nodeTilesetPlatform} from '../src/tileset-build/platform-node';
import {FeatureSpool, SpoolDirectory} from '../src/tileset-build/spool';
import {tileFeatures} from '../src/tileset-build/tileset-core';

const coreSources = [
  'clip',
  'geojson-stream',
  'ingest',
  'mvt',
  'platform',
  'pmtiles-writer',
  'spool',
  'tiler',
  'tileset-core',
  'zoom',
];

/**
 * The digest of these fixtures as produced before the core was separated from Node. It covers the
 * decoded tiles, addressing and metadata, so it holds across zlib builds and platforms.
 */
const fixtureFingerprints = {
  points: 'eb8d69b5f28ad217246f35a521ebea92c87e36dd5edf9559a526c0eae5721046',
  polygons: '479600d5089081a10876b61bf3f717356f154ee015c9aa483f62b6f2a558a530',
};

class MemoryFile implements TilesetFile {
  bytes = new Uint8Array(1024);
  size = 0;
  closed = false;

  constructor(private readonly onDiscard: () => void) {}

  close(): void {
    this.closed = true;
  }

  discard(): void {
    this.closed = true;
    this.bytes = new Uint8Array(0);
    this.size = 0;
    this.onDiscard();
  }

  read(target: Uint8Array, position: number): number {
    const available = Math.max(0, Math.min(target.length, this.size - position));
    target.set(this.bytes.subarray(position, position + available));
    return available;
  }

  write(source: Uint8Array, position: number): void {
    const end = position + source.length;
    if (end > this.bytes.length) {
      const grown = new Uint8Array(Math.max(end, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.size));
      this.bytes = grown;
    }
    this.bytes.set(source, position);
    this.size = Math.max(this.size, end);
  }
}

class MemoryStorage implements TilesetStorage {
  readonly files = new Map<string, MemoryFile>();
  spoolFilesCreated = 0;

  create(name: string): TilesetFile {
    if (name.startsWith('spool-')) this.spoolFilesCreated += 1;
    const file = new MemoryFile(() => this.files.delete(name));
    this.files.set(name, file);
    return file;
  }
}

function fixture(kind: 'points' | 'polygons', count: number): string {
  let state = kind === 'points' ? 1 : 2;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const features = Array.from({length: count}, (_, index) => {
    const lon = -10 + random() * 30;
    const lat = 35 + random() * 25;
    const properties = {
      category: ['ñandú', 'école', '市场', 'plain'][index % 4],
      name: `Feature ${index} \u{1f5fa}`,
      score: Math.round(random() * 1000) / 10,
    };
    if (kind === 'points') {
      return {geometry: {coordinates: [lon, lat], type: 'Point'}, properties, type: 'Feature'};
    }
    const ring = Array.from({length: 24}, (__, vertex) => {
      const angle = (vertex / 24) * 2 * Math.PI;
      return [lon + Math.cos(angle) * 0.02, lat + Math.sin(angle) * 0.02];
    });
    ring.push(ring[0]);
    return {geometry: {coordinates: [ring], type: 'Polygon'}, properties, type: 'Feature'};
  });
  return JSON.stringify({features, type: 'FeatureCollection'});
}

function readDirectory(bytes: Uint8Array) {
  const data = gunzipSync(bytes);
  let cursor = 0;
  const varint = () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = data[cursor];
      cursor += 1;
      value += (byte & 0x7f) * shift;
      if (byte < 0x80) return value;
      shift *= 128;
    }
  };
  const count = varint();
  const entries = Array.from({length: count}, () => ({
    length: 0,
    offset: 0,
    runLength: 0,
    tileId: 0,
  }));
  let tileId = 0;
  for (const entry of entries) entry.tileId = tileId += varint();
  for (const entry of entries) entry.runLength = varint();
  for (const entry of entries) entry.length = varint();
  entries.forEach((entry, index) => {
    const stored = varint();
    entry.offset =
      stored === 0 ? entries[index - 1].offset + entries[index - 1].length : stored - 1;
  });
  return entries;
}

/** A digest of what an archive means, independent of how each block happened to be compressed. */
function archiveFingerprint(archive: Uint8Array): string {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const bigint = (position: number) => Number(view.getBigUint64(position, true));
  const hash = createHash('sha256');
  hash.update(archive.subarray(96, 127));
  hash.update(gunzipSync(archive.subarray(bigint(24), bigint(24) + bigint(32))));
  const tileData = bigint(56);
  const leafDirectory = bigint(40);
  const visit = (entries: ReturnType<typeof readDirectory>) => {
    for (const entry of entries) {
      if (entry.runLength === 0) {
        const start = leafDirectory + entry.offset;
        visit(readDirectory(archive.subarray(start, start + entry.length)));
        continue;
      }
      hash.update(`${entry.tileId}/${entry.runLength}:`);
      const start = tileData + entry.offset;
      hash.update(gunzipSync(archive.subarray(start, start + entry.length)));
    }
  };
  visit(readDirectory(archive.subarray(bigint(8), bigint(8) + bigint(16))));
  return hash.digest('hex');
}

async function buildInMemory(
  document: string,
  layer: string,
): Promise<{archive: Uint8Array; storage: MemoryStorage}> {
  const storage = new MemoryStorage();
  const node = nodeTilesetPlatform('/unused');
  const platform: TilesetPlatform = {...node, storage};
  const directory = new SpoolDirectory(storage);
  const spool = new FeatureSpool(directory);
  const ingest = new FeatureIngest(spool, {exclude: null, include: null}, null);
  const reader = new GeojsonFeatureReader(ingest, () => undefined);
  const bytes = new TextEncoder().encode(document);
  // A short chunk size makes features and multibyte text straddle chunk boundaries.
  for (let position = 0; position < bytes.length; position += 65_531) {
    reader.write(bytes.subarray(position, position + 65_531));
  }
  reader.end();
  await tileFeatures({
    archiveName: 'archive.pmtiles',
    directory,
    generatorVersion: getCliVersion(),
    ingest,
    layer,
    minzoom: 0,
    platform,
    spool,
  });
  const file = storage.files.get('archive.pmtiles') as MemoryFile;
  return {archive: file.bytes.slice(0, file.size), storage};
}

async function buildWithCli(document: string, layer: string): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-core-'));
  try {
    const input = join(directory, `${layer}.geojson`);
    const output = join(directory, `${layer}.pmtiles`);
    await writeFile(input, document);
    await buildTileset({input, layer, output});
    return await readFile(output);
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
}

for (const [kind, count] of [
  ['points', 80_000],
  ['polygons', 16000],
] as const) {
  test(`the separated core and the CLI write the same ${kind} archive`, async () => {
    const document = fixture(kind, count);
    const {archive, storage} = await buildInMemory(document, kind);
    assert.ok(storage.spoolFilesCreated > 0, 'the fixture must be large enough to spill');
    assert.equal(
      [...storage.files.keys()].join(),
      'archive.pmtiles',
      'every temporary file is discarded',
    );
    const fromCli = await buildWithCli(document, kind);
    assert.equal(Buffer.compare(archive, fromCli), 0);
    assert.equal(archiveFingerprint(archive), fixtureFingerprints[kind]);
  });
}

test('utf8ByteLength agrees with Node on every kind of string', () => {
  const samples = ['', 'plain', 'ñandú', '市场', '\u{1f5fa}', 'a\ud83d', '\ude00b', '\ud83d😀'];
  for (const sample of samples) {
    assert.equal(utf8ByteLength(sample), Buffer.byteLength(sample), JSON.stringify(sample));
  }
});

test('the separated core uses no Node API', async () => {
  for (const name of coreSources) {
    const source = await readFile(
      new URL(`../src/tileset-build/${name}.ts`, import.meta.url),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');
    assert.doesNotMatch(code, /from 'node:|\bBuffer\b|\bsetImmediate\b|\bprocess\./u, name);
  }
});
