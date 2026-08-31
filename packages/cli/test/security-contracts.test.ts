import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {withTileflowConfigSecretsHidden} from '../src/config-execution';
import {defaultTileflowDevHost, parseTileflowDevHost, tileflowDevOrigin} from '../src/dev-host';
import {inspectTileflowHostedCompatibility} from '../src/hosted-preflight';
import {
  hostedMapStatusSchema,
  hostedStyleDeploymentResponseSchema,
  readHostedJson,
} from '../src/hosted-response';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

test('config secret scope hides env and both API-key argv forms, then restores exactly', async () => {
  const originalArgv = [...process.argv];
  const hadApiKey = Object.hasOwn(process.env, 'TILEFLOW_API_KEY');
  const originalApiKey = process.env.TILEFLOW_API_KEY;

  try {
    process.env.TILEFLOW_API_KEY = 'ambient-secret';
    process.argv.splice(
      0,
      process.argv.length,
      '/node',
      '/tileflow',
      'deploy',
      '--api-key',
      'argument-secret',
      '--api-key=equals-secret',
      '--config',
      'tileflow.config.ts',
    );
    const before = [...process.argv];

    await withTileflowConfigSecretsHidden(async () => {
      assert.equal(process.env.TILEFLOW_API_KEY, undefined);
      assert.deepEqual(process.argv, [
        '/node',
        '/tileflow',
        'deploy',
        '--config',
        'tileflow.config.ts',
      ]);
      process.env.TILEFLOW_API_KEY = 'config-attempt';
      process.argv.push('config-attempt');
    });

    assert.equal(process.env.TILEFLOW_API_KEY, 'ambient-secret');
    assert.deepEqual(process.argv, before);

    await assert.rejects(
      () =>
        withTileflowConfigSecretsHidden(() => {
          throw new Error('expected failure');
        }),
      /expected failure/,
    );
    assert.equal(process.env.TILEFLOW_API_KEY, 'ambient-secret');
    assert.deepEqual(process.argv, before);
  } finally {
    process.argv.splice(0, process.argv.length, ...originalArgv);
    if (hadApiKey) process.env.TILEFLOW_API_KEY = originalApiKey;
    else delete process.env.TILEFLOW_API_KEY;
  }
});

test('dev host defaults to IPv4 loopback and accepts only explicit host literals', () => {
  assert.equal(defaultTileflowDevHost, '127.0.0.1');
  assert.equal(parseTileflowDevHost('127.0.0.1'), '127.0.0.1');
  assert.equal(parseTileflowDevHost('0.0.0.0'), '0.0.0.0');
  assert.equal(parseTileflowDevHost('::1'), '::1');
  assert.equal(parseTileflowDevHost('localhost'), 'localhost');
  assert.equal(parseTileflowDevHost('https://example.test'), null);
  assert.equal(parseTileflowDevHost('example.test'), null);
  assert.equal(parseTileflowDevHost(' 127.0.0.1'), null);
  assert.equal(tileflowDevOrigin('::1', 3333), 'http://[::1]:3333');
});

test('one hosted preflight rejects external data for validation and deploy callers', () => {
  const project = {
    maps: {
      main: {
        id: 'main',
        version: 1,
      },
    },
  } as const;
  const compatible = {
    version: 8 as const,
    sources: {},
    layers: [],
    metadata: {'tileflow:data': {kind: 'tileflow-world'}},
  };
  const external = {
    version: 8 as const,
    sources: {},
    layers: [],
    metadata: {'tileflow:data': {kind: 'vector-tiles'}},
  };

  assert.deepEqual(inspectTileflowHostedCompatibility(project, {main: {light: compatible}}), []);
  assert.deepEqual(inspectTileflowHostedCompatibility(project, {main: {light: external}}), [
    {
      map: 'main',
      message:
        'Hosted deploy supports only Tileflow World data. Map main theme light uses an external vector dataset; keep it local or switch to tileflowWorld().',
      path: 'maps.main.themes.light.data',
    },
  ]);
});

test('hosted success responses validate exact atomic theme families and bounded bodies', async () => {
  const deployment = await readHostedJson(
    new Response(
      JSON.stringify({
        changed: true,
        mapId: 'map_AbCdEfGhIjKlMnOp',
        themes: {
          dark: {
            styleId: 'sty_test_dark',
            styleUrl: 'https://api.example.test/maps/map_AbCdEfGhIjKlMnOp/dark.json',
          },
          light: {
            styleId: 'sty_test_light',
            styleUrl: 'https://api.example.test/maps/map_AbCdEfGhIjKlMnOp/light.json',
          },
        },
        version: 2,
      }),
      {headers: {'Content-Type': 'application/json'}},
    ),
    hostedStyleDeploymentResponseSchema,
    'Deploy response',
  );
  assert.equal(deployment.mapId, 'map_AbCdEfGhIjKlMnOp');
  assert.deepEqual(Object.keys(deployment.themes), ['dark', 'light']);

  await assert.rejects(
    () =>
      readHostedJson(
        new Response(
          JSON.stringify({
            ...deployment,
            additive: true,
          }),
        ),
        hostedStyleDeploymentResponseSchema,
        'Deploy response',
      ),
    /invalid response/,
  );

  const status = await readHostedJson(
    new Response(
      JSON.stringify({
        mapId: 'map_AbCdEfGhIjKlMnOp',
        unvalidated: 'must be stripped',
        styles: [
          {
            environment: 'production',
            key: 'production',
            mapId: 'map_test',
            size: 123,
            uploaded: '2026-08-21T00:00:00Z',
            unvalidated: 'must also be stripped',
          },
        ],
      }),
    ),
    hostedMapStatusSchema,
    'Status response',
  );
  assert.equal(Object.hasOwn(status, 'unvalidated'), false);
  assert.equal(Object.hasOwn(status.styles[0]!, 'unvalidated'), false);

  await assert.rejects(
    () =>
      readHostedJson(
        new Response(
          JSON.stringify({
            mapId: 'map_test',
            themes: {light: {styleUrl: 'javascript:alert(1)'}},
          }),
        ),
        hostedStyleDeploymentResponseSchema,
        'Deploy response',
      ),
    /invalid response/,
  );
  assert.equal(
    hostedMapStatusSchema.safeParse({mapId: 'map_AbCdEfGhIjKlMnOp', styles: 'not-an-array'})
      .success,
    false,
  );

  let cancelled = false;
  const oversized = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
      },
    }),
  );
  assert.equal(oversized.headers.has('content-length'), false);
  await assert.rejects(
    () => readHostedJson(oversized, hostedStyleDeploymentResponseSchema, 'Deploy response'),
    /safe size limit/,
  );
  assert.equal(cancelled, true);
});

test('published package is CLI-only instead of executing a binary as an importable API', async () => {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;

  assert.deepEqual(packageJson.bin, {tileflow: './dist/index.js'});
  assert.equal(Object.hasOwn(packageJson, 'main'), false);
  assert.equal(Object.hasOwn(packageJson, 'types'), false);
  assert.equal(Object.hasOwn(packageJson, 'exports'), false);
  assert.deepEqual(packageJson.engines, {node: '>=22'});
});

test('validate and build hide ambient API keys from executable config', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-config-secrets-'));
  await linkWorkspacePackages(directory);
  t.after(() => rm(directory, {force: true, recursive: true}));
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'main',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `const command = process.argv.includes('build') ? 'build' : 'validate';
writeFileSync(command + '.observed.json', JSON.stringify({
  apiKey: process.env.TILEFLOW_API_KEY ?? null,
  argv: process.argv
}));`,
    }),
  );
  const secret = `tf_live_${'9'.repeat(48)}`;

  for (const arguments_ of [['validate'], ['build', '--out', 'built']]) {
    const result = await runCli(directory, arguments_, {TILEFLOW_API_KEY: secret});
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
  }

  for (const command of ['validate', 'build']) {
    const observed = JSON.parse(
      await readFile(join(directory, `${command}.observed.json`), 'utf8'),
    ) as {apiKey: string | null; argv: string[]};
    assert.equal(observed.apiKey, null);
    assert.equal(
      observed.argv.some((argument) => argument.includes(secret)),
      false,
    );
  }
});

test('build rejects a local PMTiles source before creating output', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-build-local-tileset-'));
  await linkWorkspacePackages(directory);
  t.after(() => rm(directory, {force: true, recursive: true}));
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  const result = await runCli(directory, ['build', '--out', 'dist/tileflow'], {});

  assert.notEqual(result.code, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Production builds cannot publish local PMTiles sources/u,
  );
  await assert.rejects(stat(join(directory, 'dist')), {code: 'ENOENT'});
});

function runCli(
  cwd: string,
  arguments_: string[],
  overrides: NodeJS.ProcessEnv,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  delete environment.TILEFLOW_API_KEY;
  Object.assign(environment, overrides, {NO_COLOR: '1'});

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
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({code, stderr, stdout}));
  });
}
