import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const ambientApiKey = `tf_live_inspect_${'x'.repeat(40)}`;
const tile = Buffer.from(
  'GqkBeAIKA3BvaSiAIBIVCAcSCAAAAQECAgMDGAEiBQmAIIAgEhUICBIIAAQBBQIGAwcYASIFCbA7sDsaBG5hbWUaBWNsYXNzGgRyYW5rGgZzZWNyZXQiDgoMQ2VudHJhbCBjYWZlIgYKBGNhZmUiAigDIg8KDURPX05PVF9FWFBPU0UiCQoHT3V0c2lkZSIGCgRzaG9wIgIoCSIQCg5PVVRTSURFX1NFQ1JFVA==',
  'base64',
);

test('prints deterministic bounded feature JSON without credentials or hidden properties', async (t) => {
  const directory = await createDirectoryFixture(t);
  let port = 0;
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/tiles.json')) {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(
        JSON.stringify({
          maxzoom: 0,
          tiles: [`http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.pbf?token=SIGNED_SECRET`],
        }),
      );
      return;
    }
    response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
    response.end(tile);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `if (process.env.TILEFLOW_API_KEY) throw new Error('ambient API key reached config');
export default {maps: {fixture: {
  basemap: {type: 'streets', basemapVersion: 1, variant: 'light'},
  data: {
    type: 'vector-tiles',
    url: 'http://127.0.0.1:${port}/tiles.json?key=PRIVATE',
    attribution: 'Fixture data',
    schema: {type: 'openmaptiles', contractVersion: 1}
  }
}}};
`,
  );
  const arguments_ = [
    'inspect',
    'features',
    '--map',
    'fixture',
    '--center',
    '0,0',
    '--zoom',
    '0',
    '--width',
    '64',
    '--height',
    '64',
    '--layers',
    'poi',
    '--properties',
    'name,class,rank',
    '--json',
  ];
  const first = await runCli(directory, arguments_);
  const second = await runCli(directory, arguments_);

  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  assert.ok(first.stdout.endsWith('\n'));
  const document = JSON.parse(first.stdout) as {
    schemaVersion: number;
    map: string;
    source: {origin: string; tileJsonPath: string; tileOrigins: string[]};
    features: Array<{properties: Record<string, unknown>}>;
  };
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.map, 'fixture');
  assert.equal(document.source.origin, `http://127.0.0.1:${port}`);
  assert.equal(document.source.tileJsonPath, '/tiles.json');
  assert.deepEqual(
    document.features.map((feature) => feature.properties),
    [{class: 'cafe', name: 'Central cafe', rank: 3}],
  );
  assert.doesNotMatch(
    first.stdout,
    /PRIVATE|SIGNED_SECRET|DO_NOT_EXPOSE|OUTSIDE_SECRET|tf_live_inspect/,
  );
});

test('validates command values before config loading', async (t) => {
  const directory = await createDirectoryFixture(t);
  const result = await runCli(directory, [
    'inspect',
    'features',
    '--center',
    'not-a-camera',
    '--zoom',
    '12',
    '--layers',
    'poi',
    '--json',
  ]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--center expects longitude,latitude/);
  assert.doesNotMatch(result.stderr, /Config not found/);
});

async function createDirectoryFixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-feature-inspect-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

function runCli(
  cwd: string,
  arguments_: string[],
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI']) delete environment[variable];
  Object.assign(environment, {
    HOME: cwd,
    NO_COLOR: '1',
    TILEFLOW_API_KEY: ambientApiKey,
    USERPROFILE: cwd,
  });

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
