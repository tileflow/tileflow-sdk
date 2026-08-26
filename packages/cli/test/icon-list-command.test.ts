import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const cliNodeModules = fileURLToPath(new URL('../node_modules', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const ambientApiKey = `tf_live_catalog_${'k'.repeat(40)}`;
const sourceMarker = 'SOURCE_PIXELS_MUST_NOT_REACH_STDOUT';

test('lists deterministic ordered composition, final sources, and later-wins replacements', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-');
  const configPath = join(directory, 'tileflow.config.ts');
  await writeFileEnsured(
    join(directory, 'icons', 'base', 'cafe.svg'),
    `${simpleSvg('#ef4444')}<!-- ${sourceMarker} -->`,
  );
  await writeFileEnsured(join(directory, 'icons', 'base', 'photo.svg'), simpleSvg('#2563eb'));
  await writeFileEnsured(join(directory, 'icons', 'brand', 'bicycle.svg'), simpleSvg('#16a34a'));
  await writeFileEnsured(join(directory, 'icons', 'brand', 'cafe.svg'), simpleSvg('#111827'));
  await writeFile(
    configPath,
    tileflowMapFixture({
      id: 'alpha',
      icons: 'authored',
      setup: `if (process.env.TILEFLOW_API_KEY) {
  throw new Error('ambient Tileflow API key reached executable config');
}`,
      fields: `icons: ['./icons/base', './icons/brand']`,
    }),
  );
  const sentinel = await createHttpSentinel(t);
  const arguments_ = ['icons', 'list', '--json', '--config', configPath];
  const environment = {TILEFLOW_API_KEY: ambientApiKey, TILEFLOW_API_URL: sentinel.url};
  const first = await runCli(directory, arguments_, environment);
  const second = await runCli(directory, arguments_, environment);

  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  assert.ok(first.stdout.endsWith('\n'));
  assert.equal(sentinel.requests(), 0);
  const document = JSON.parse(first.stdout) as IconListDocument;
  assert.deepEqual(Object.keys(document), ['schemaVersion', 'pathBase', 'maps']);
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.pathBase, 'cwd');
  assert.equal(document.maps.length, 1);

  const map = document.maps[0];
  assert.ok(map && map.icons.kind === 'directories');
  assert.equal(map.id, 'alpha');
  assert.deepEqual(Object.keys(map.icons), [
    'kind',
    'directories',
    'finalIds',
    'insideWorkingTree',
    'replacements',
    'packageHash',
    'sources',
  ]);
  assert.deepEqual(map.icons.directories, ['./icons/base', './icons/brand']);
  assert.deepEqual(map.icons.finalIds, ['bicycle', 'cafe', 'photo']);
  assert.equal(map.icons.insideWorkingTree, true);
  assert.match(map.icons.packageHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(map.icons.replacements, [
    {
      id: 'cafe',
      replaced: './icons/base/cafe.svg',
      winner: './icons/brand/cafe.svg',
    },
  ]);
  assert.deepEqual(
    map.icons.sources.map((source) => [source.id, source.format, source.path]),
    [
      ['bicycle', 'svg', './icons/brand/bicycle.svg'],
      ['cafe', 'svg', './icons/brand/cafe.svg'],
      ['photo', 'svg', './icons/base/photo.svg'],
    ],
  );
  assert.ok(map.icons.sources.every((source) => source.byteLength > 0));

  for (const forbidden of [directory, ambientApiKey, sourceMarker, 'data:', 'base64,', '\u001b[']) {
    assert.ok(!first.stdout.includes(forbidden), `stdout contained forbidden value ${forbidden}`);
  }
});

test('filters by exact map id and reports an empty array as no icons', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-filter-');
  const configPath = join(directory, 'tileflow.config.ts');
  await writeFile(
    configPath,
    tileflowMapFixture({id: 'alpha', icons: 'authored', fields: `icons: []`}),
  );

  const selected = await runCli(
    directory,
    ['icons', 'list', '--json', '--map', 'alpha', '--config', configPath],
    {},
  );
  assert.equal(selected.code, 0, selected.stderr);
  assert.deepEqual((JSON.parse(selected.stdout) as IconListDocument).maps, [
    {id: 'alpha', icons: {kind: 'none'}},
  ]);

  const unknown = await runCli(
    directory,
    ['icons', 'list', '--json', '--map', 'missing-map', '--config', configPath],
    {},
  );
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown map "missing-map"/u);
  assert.match(unknown.stderr, /Available maps: alpha/u);
});

test('resolves icon directories relative to a nested config rather than process cwd', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-nested-config-');
  const configDirectory = join(directory, 'configs', 'map');
  await writeFileEnsured(join(configDirectory, 'icons', 'local.svg'), simpleSvg('#2563eb'));
  await writeFileEnsured(join(directory, 'configs', 'shared', 'shared.svg'), simpleSvg('#16a34a'));
  await writeFileEnsured(
    join(configDirectory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'nested',
      icons: 'authored',
      fields: `icons: ['./icons', '../shared']`,
    }),
  );

  const result = await runCli(
    directory,
    ['icons', 'list', '--json', '--config', 'configs/map/tileflow.config.ts'],
    {},
  );
  assert.equal(result.code, 0, result.stderr);
  const map = (JSON.parse(result.stdout) as IconListDocument).maps[0];
  assert.ok(map && map.icons.kind === 'directories');
  assert.deepEqual(map.icons.directories, ['./icons', '../shared']);
  assert.deepEqual(map.icons.finalIds, ['local', 'shared']);
  assert.deepEqual(
    map.icons.sources.map(({id, path}) => [id, path]),
    [
      ['local', './icons/local.svg'],
      ['shared', '../shared/shared.svg'],
    ],
  );
});

test('keeps unsupported human surfaces off stdout', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-usage-');
  const withoutJson = await runCli(directory, ['icons', 'list'], {});
  const preview = await runCli(directory, ['icons', 'preview'], {});

  assert.equal(withoutJson.code, 1);
  assert.equal(withoutJson.stdout, '');
  assert.match(withoutJson.stderr, /requires --json/u);
  assert.equal(preview.code, 1);
  assert.equal(preview.stdout, '');
  assert.match(preview.stderr, /unknown command ['"]preview['"]/iu);
});

test('reports config, directory, and decode failures without partial JSON', async (t) => {
  const missingDirectory = await createDirectoryFixture(t, 'tileflow-icon-list-missing-');
  await writeFile(
    join(missingDirectory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'main',
      icons: 'authored',
      fields: `icons: ['./missing']`,
    }),
  );
  const missing = await runCli(missingDirectory, ['icons', 'list', '--json'], {});
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /Tileflow icon catalog has errors/u);

  const brokenImage = await createDirectoryFixture(t, 'tileflow-icon-list-broken-');
  await writeFileEnsured(join(brokenImage, 'icons', 'broken.png'), 'not a PNG');
  await writeFile(
    join(brokenImage, 'tileflow.config.ts'),
    tileflowMapFixture({id: 'main', icons: 'authored', fields: `icons: ['./icons']`}),
  );
  const broken = await runCli(brokenImage, ['icons', 'list', '--json'], {});
  assert.equal(broken.code, 1);
  assert.equal(broken.stdout, '');
  assert.match(broken.stderr, /Tileflow icon catalog has errors/u);
});

async function createDirectoryFixture(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await symlink(cliNodeModules, join(directory, 'node_modules'), 'dir');
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

async function createHttpSentinel(t: TestContext) {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
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
  return {requests: () => requestCount, url: `http://127.0.0.1:${address.port}`};
}

async function writeFileEnsured(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, contents);
}

function simpleSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}" /></svg>`;
}

function runCli(
  cwd: string,
  arguments_: string[],
  overrides: Record<string, string>,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
  ]) {
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

type IconListDocument = {
  schemaVersion: number;
  pathBase: string;
  maps: Array<{
    id: string;
    icons:
      | {kind: 'none'}
      | {
          kind: 'directories';
          directories: string[];
          finalIds: string[];
          insideWorkingTree: boolean;
          packageHash: string;
          replacements: Array<{id: string; replaced: string; winner: string}>;
          sources: Array<{
            byteLength: number;
            format: string;
            id: string;
            path: string;
          }>;
        };
  }>;
};
