import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {serializeTileflowIconsLockfile, tileflowIconsLockfileName} from '@tileflow/core';
import {createTileflowIconSetProject} from '../../../test-support/icon-set-project';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-cli-icon-sets-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  const project = await createTileflowIconSetProject(directory);
  return {directory, project};
}

/** Any network request during a locked build is a defect, so fail loudly instead of answering. */
async function createSentinel(t: TestContext) {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(500, {'Content-Type': 'text/plain'});
    response.end('unexpected request');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {requests: () => requests, url: `http://127.0.0.1:${address.port}`};
}

test('validate accepts two exact shared pins with a later local override', async (t) => {
  const {directory} = await fixture(t);
  const sentinel = await createSentinel(t);

  const result = await runCli(
    directory,
    ['validate', '--json', '--cache-dir', directory, '--offline', '--api-base-url', sentinel.url],
    {},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(sentinel.requests(), 0);
  const document = JSON.parse(result.stdout) as {checks: string[]; ok: boolean};
  assert.equal(document.ok, true);
  assert.ok(document.checks.includes('Locked Icon Set composition'));
});

test('validate fails closed when the lock does not match the declared references', async (t) => {
  const {directory} = await fixture(t);
  await writeFile(
    join(directory, tileflowIconsLockfileName),
    '{"lockfileVersion":1,"sets":{}}\n',
    'utf8',
  );

  const result = await runCli(
    directory,
    ['validate', '--json', '--cache-dir', directory, '--offline'],
    {},
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /lock|install/iu);
});

test('icons list reports pinned contributors and the exact composition receipt', async (t) => {
  const {directory} = await fixture(t);
  const sentinel = await createSentinel(t);

  const result = await runCli(
    directory,
    ['icons', 'list', '--json', '--cache-dir', directory, '--offline'],
    {TILEFLOW_API_URL: sentinel.url},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(sentinel.requests(), 0);
  const document = JSON.parse(result.stdout) as {
    maps: Array<{
      icons: {
        composition: {contributors: Array<{reference?: string; version?: number}>} | null;
        contributors: Array<{kind: string; label: string; version?: number}>;
        finalIds: string[];
        replacements: Array<{id: string; replaced: string; winner: string}>;
        sources: Array<{contributor: number; id: string; kind: string; path?: string}>;
      };
    }>;
    schemaVersion: number;
  };
  assert.equal(document.schemaVersion, 3);
  const icons = document.maps[0]!.icons;
  assert.deepEqual(
    icons.contributors.map(({kind, label}) => [kind, label]),
    [
      ['icon-set', '@acme/brand'],
      ['icon-set', '@acme/transport'],
      ['local', './icons'],
    ],
  );
  assert.equal(icons.contributors[0]!.version, 1);
  assert.equal(icons.contributors[1]!.version, 2);
  assert.deepEqual(icons.finalIds, ['bus', 'hospital', 'shop']);
  assert.deepEqual(icons.replacements, [
    {id: 'hospital', replaced: '@acme/brand', winner: '@acme/transport'},
    {id: 'shop', replaced: '@acme/brand', winner: './icons/shop.svg'},
  ]);
  assert.deepEqual(
    icons.sources.map((source) => [source.id, source.kind, source.contributor]),
    [
      ['bus', 'icon-set', 1],
      ['hospital', 'icon-set', 1],
      ['shop', 'file', 2],
    ],
  );
  assert.equal(
    icons.composition?.contributors.filter((contributor) => contributor.reference).length,
    2,
  );
  // Verified shared cells expose no invented local path.
  assert.equal(
    icons.sources.filter((source) => source.kind === 'icon-set').every((source) => !source.path),
    true,
  );
  assert.equal(result.stdout.includes(directory), false);
});

test('a newer catalog revision changes nothing until an explicit lock command runs', async (t) => {
  const {directory, project} = await fixture(t);
  const baseline = await runCli(
    directory,
    ['icons', 'list', '--json', '--cache-dir', directory, '--offline'],
    {},
  );
  assert.equal(baseline.code, 0, baseline.stderr);

  await project.publishNewerRevision('@acme/transport');
  const unchanged = await runCli(
    directory,
    ['icons', 'list', '--json', '--cache-dir', directory, '--offline'],
    {},
  );
  assert.equal(unchanged.stdout, baseline.stdout);

  const next = await project.publishNewerRevision('@acme/transport');
  await writeFile(
    join(directory, tileflowIconsLockfileName),
    await serializeTileflowIconsLockfile({
      lockfileVersion: 1,
      sets: {'@acme/brand': project.pins['@acme/brand']!, '@acme/transport': next},
    }),
    'utf8',
  );
  const updated = await runCli(
    directory,
    ['icons', 'list', '--json', '--cache-dir', directory, '--offline'],
    {},
  );
  assert.equal(updated.code, 0, updated.stderr);
  assert.notEqual(updated.stdout, baseline.stdout);
});

test('build writes the composed sprite and a schema-version-2 map revision', async (t) => {
  const {directory} = await fixture(t);

  const result = await runCli(
    directory,
    ['build', '--out', 'dist/tileflow', '--cache-dir', directory, '--offline'],
    {},
  );

  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(
    await readFile(join(directory, 'dist/tileflow/build-manifest.json'), 'utf8'),
  ) as {
    maps: Record<
      string,
      {
        mapRevisionSchemaVersion?: number;
        sourceAssets: {iconComposition?: {contributors: unknown[]; packageHash: string}};
      }
    >;
  };
  const entry = manifest.maps.main!;
  assert.equal(entry.mapRevisionSchemaVersion, 2);
  assert.equal(entry.sourceAssets.iconComposition?.contributors.length, 3);
  const sprite = JSON.parse(
    await readFile(join(directory, 'dist/tileflow/icons/main/sprite.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sprite).sort(), ['bus', 'hospital', 'shop']);
});

test('native build preserves the locked Icon Set composition', async (t) => {
  const {directory} = await fixture(t);

  const result = await runCli(
    directory,
    [
      'build',
      '--renderer',
      'native',
      '--out',
      'dist/tileflow',
      '--cache-dir',
      directory,
      '--offline',
      '--json',
    ],
    {},
  );

  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(
    await readFile(join(directory, 'dist/tileflow/native/build-manifest.json'), 'utf8'),
  ) as {
    maps: Record<
      string,
      {
        mapRevisionSchemaVersion?: number;
        sourceAssets: {iconComposition?: {contributors: unknown[]}};
      }
    >;
  };
  const entry = manifest.maps.main!;
  assert.equal(entry.mapRevisionSchemaVersion, 2);
  assert.equal(entry.sourceAssets.iconComposition?.contributors.length, 3);
  const sprite = JSON.parse(
    await readFile(join(directory, 'dist/tileflow/native/icons/main/sprite.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sprite).sort(), ['bus', 'hospital', 'shop']);
});

function runCli(
  cwd: string,
  arguments_: string[],
  overrides: Record<string, string>,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }
  Object.assign(environment, overrides, {HOME: cwd, NO_COLOR: '1', USERPROFILE: cwd});

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stderr, stdout}));
  });
}
