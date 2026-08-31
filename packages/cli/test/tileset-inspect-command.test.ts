import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const vectorTile = Buffer.from(
  'GqkBeAIKA3BvaSiAIBIVCAcSCAAAAQECAgMDGAEiBQmAIIAgEhUICBIIAAQBBQIGAwcYASIFCbA7sDsaBG5hbWUaBWNsYXNzGgRyYW5rGgZzZWNyZXQiDgoMQ2VudHJhbCBjYWZlIgYKBGNhZmUiAigDIg8KDURPX05PVF9FWFBPU0UiCQoHT3V0c2lkZSIGCgRzaG9wIgIoCSIQCg5PVVRTSURFX1NFQ1JFVA==',
  'base64',
);

test('tileset inspect emits one stable agent-facing JSON document without account state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-command-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  const archivePath = join(directory, 'stores.pmtiles');
  await writeFile(
    archivePath,
    createPmtiles({
      attribution: 'Store data © Example',
      vector_layers: [
        {
          fields: {category: 'String', id: 'String'},
          id: 'store-locations',
          maxzoom: 14,
          minzoom: 0,
        },
      ],
    }),
  );

  const first = await runCli(directory, [
    'tileset',
    'inspect',
    './stores.pmtiles',
    '--no-sample',
    '--json',
  ]);
  const second = await runCli(directory, [
    'tileset',
    'inspect',
    './stores.pmtiles',
    '--no-sample',
    '--json',
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  const document = JSON.parse(first.stdout) as Record<string, unknown>;
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual((document.contract as {sourceLayers: unknown}).sourceLayers, [
    {
      fieldsDeclared: true,
      fields: [
        {name: 'category', type: 'String'},
        {name: 'id', type: 'String'},
      ],
      id: 'store-locations',
      maxzoom: 14,
      minzoom: 0,
    },
  ]);
  assert.equal((document.contract as {sourceLayersDeclared: unknown}).sourceLayersDeclared, true);
  assert.equal(document.observation, undefined);
  assert.doesNotMatch(first.stdout, /tileflow-tileset-inspect-command|\/private\/|\\Users\\/u);
});

test('tileset inspect emits values only for explicitly selected fields', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-values-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  await writeFile(
    join(directory, 'stores.pmtiles'),
    createPmtiles(
      {
        vector_layers: [{fields: {class: 'String', rank: 'Number', secret: 'String'}, id: 'poi'}],
      },
      vectorTile,
    ),
  );

  const result = await runCli(directory, [
    'tileset',
    'inspect',
    './stores.pmtiles',
    '--include-values',
    'class',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout) as {
    observation: {
      includedValueFields: string[];
      sourceLayers: Array<{fields: Array<Record<string, unknown>>}>;
    };
    schemaVersion: number;
  };
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(document.observation.includedValueFields, ['class']);
  const fields = document.observation.sourceLayers[0]?.fields ?? [];
  assert.deepEqual(fields.find(({name}) => name === 'class')?.observedValues, [
    {count: 1, value: 'cafe'},
    {count: 1, value: 'shop'},
  ]);
  assert.equal(fields.find(({name}) => name === 'secret')?.observedValues, undefined);
  assert.doesNotMatch(result.stdout, /DO_NOT_EXPOSE|OUTSIDE_SECRET/u);

  const humanOutput = await runCli(directory, [
    'tileset',
    'inspect',
    './stores.pmtiles',
    '--include-values',
    'class',
  ]);
  assert.equal(humanOutput.code, 1);
  assert.equal(humanOutput.stdout, '');
  assert.match(humanOutput.stderr, /--include-values requires --json/u);
});

test('tileset inspect failures do not expose absolute local paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-missing-'));
  const result = await runCli(directory, ['tileset', 'inspect', './missing.pmtiles', '--json']);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(directory.replaceAll('\\', '\\\\'), 'u'));
  assert.equal((JSON.parse(result.stderr) as {schemaVersion: number}).schemaVersion, 1);
});

function runCli(
  cwd: string,
  arguments_: string[],
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: cwd,
    NO_COLOR: '1',
    USERPROFILE: cwd,
  };
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({code, stderr, stdout}));
  });
}

function createPmtiles(metadata: Record<string, unknown>, tile: Uint8Array = new Uint8Array([0])) {
  const headerLength = 127;
  const directory = new Uint8Array([1, 0, 1, ...encodeVarint(tile.byteLength), 1]);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(
    headerLength + directory.byteLength + metadataBytes.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadataBytes.byteLength;
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, directory.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadataBytes.byteLength);
  setUint64(view, 40, tileOffset);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, 1);
  setUint64(view, 80, 1);
  setUint64(view, 88, 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, 0);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  bytes.set(directory, rootOffset);
  bytes.set(metadataBytes, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let remainder = value;
  while (remainder >= 128) {
    bytes.push((remainder & 0x7f) | 0x80);
    remainder = Math.floor(remainder / 128);
  }
  bytes.push(remainder);
  return bytes;
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}
