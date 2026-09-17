import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseTileflowRuntimeManifest} from '@tileflow/core/manifest';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const validConfig =
  "import {defineMap} from '@tileflow/core';import {streets} from '@tileflow/maps';export default defineMap({id:'main',version:1,extends:streets});\n";

async function fixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-cli-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig);
  return cwd;
}

function run(
  cwd: string,
  args: string[],
): Promise<{code: number | null; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...args], {
      cwd,
      env: {...process.env, TILEFLOW_API_KEY: '', TILEFLOW_API_URL: 'https://api.example.test'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('CLI fixture timed out.'));
    }, 60_000);
    child.stdout.on('data', (value) => {
      stdout += value;
    });
    child.stderr.on('data', (value) => {
      stderr += value;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({code, stdout, stderr});
    });
  });
}

for (const command of ['validate', 'build']) {
  test(`${command} exposes an explicit renderer selector and rejects unknown values safely`, async (t) => {
    const cwd = await fixture(t);
    const help = await run(cwd, [command, '--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--renderer/);
    const failed = await run(cwd, [command, '--renderer', 'tf_live_do_not_print', '--json']);
    assert.equal(failed.code, 1);
    assert.equal(failed.stdout, '');
    const body = JSON.parse(failed.stderr);
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.code, 'NATIVE_RENDERER_UNSUPPORTED');
    assert.equal(body.path, '/renderer');
    assert.equal(body.renderer, 'native');
    assert.doesNotMatch(failed.stderr, /do_not_print/);
  });

  test(`${command} rejects native Hosted before loading config or writing output`, async (t) => {
    const cwd = await fixture(t);
    await writeFile(
      join(cwd, 'tileflow.config.ts'),
      "throw new Error('CONFIG_MUST_NOT_EXECUTE');\n",
    );
    const result = await run(cwd, [
      command,
      '--renderer',
      'native',
      '--target',
      'hosted',
      '--json',
    ]);
    assert.equal(result.code, 1);
    const body = JSON.parse(result.stderr);
    assert.equal(body.code, 'NATIVE_RENDERER_UNSUPPORTED');
    assert.equal(body.path, '/target');
    assert.doesNotMatch(result.stderr, /CONFIG_MUST_NOT_EXECUTE/);
    await assert.rejects(access(join(cwd, 'dist')));
  });
}

test('native validate uses the existing envelope and never creates output', async (t) => {
  const cwd = await fixture(t);
  const result = await run(cwd, [
    'validate',
    '--renderer',
    'native',
    '--target',
    'local',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.renderer, 'native');
  assert.equal(body.profile, 'native-v1');
  assert.equal(body.validation, 'static-artifacts');
  assert.deepEqual(body.maps, ['main']);
  await assert.rejects(access(join(cwd, 'dist')));
});

test('native build writes a separate strict v1 manifest and renderer record', async (t) => {
  const cwd = await fixture(t);
  const result = await run(cwd, ['build', '--renderer', 'native', '--out', 'output', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'BUILD_OK');
  const manifest = JSON.parse(await readFile(join(cwd, 'output/native/manifest.json'), 'utf8'));
  parseTileflowRuntimeManifest(manifest);
  assert.equal(manifest.renderer, undefined);
  const record = JSON.parse(await readFile(join(cwd, 'output/native/native-build.json'), 'utf8'));
  assert.equal(record.validation, 'static-artifacts');
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.preparationVersion, 'native-lowering-v1');
  assert.ok(
    record.transformations.every(
      ({projection}: {projection: string}) => projection === 'globe-to-mercator',
    ),
  );
  assert.equal(manifest.transformations, undefined);
  await assert.rejects(access(join(cwd, 'output/manifest.json')));
});

test('default and explicit web build/validate preserve their original output', async (t) => {
  const cwd = await fixture(t);
  const initial = await run(cwd, ['validate', '--json']);
  const explicit = await run(cwd, ['validate', '--renderer', 'web', '--json']);
  assert.equal(initial.code, 0, initial.stderr);
  assert.equal(explicit.stdout, initial.stdout);
  assert.equal(explicit.stderr, initial.stderr);
  assert.equal(Object.hasOwn(JSON.parse(initial.stdout), 'renderer'), false);
  const implicitBuild = await run(cwd, ['build', '--out', 'implicit']);
  const explicitBuild = await run(cwd, ['build', '--renderer', 'web', '--out', 'explicit']);
  assert.equal(implicitBuild.code, 0, implicitBuild.stderr);
  assert.equal(explicitBuild.code, 0, explicitBuild.stderr);
  async function compare(left: string, right: string): Promise<void> {
    const files = await readdir(left, {withFileTypes: true});
    assert.deepEqual(files.map(({name}) => name).sort(), (await readdir(right)).sort());
    for (const file of files) {
      if (file.isDirectory()) await compare(join(left, file.name), join(right, file.name));
      else
        assert.deepEqual(
          await readFile(join(left, file.name)),
          await readFile(join(right, file.name)),
        );
    }
  }
  await compare(join(cwd, 'implicit'), join(cwd, 'explicit'));
});

test('an incompatible native style fails without creating an output directory', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    validConfig.replace('extends:streets', "extends:streets,terrain:'3d'"),
  );
  const result = await run(cwd, ['build', '--renderer', 'native', '--out', 'output', '--json']);
  assert.equal(result.code, 1);
  const body = JSON.parse(result.stderr);
  assert.equal(body.profile, 'native-v1');
  assert.ok(body.diagnostics.some(({path}: {path: string}) => path.endsWith('/terrain')));
  await assert.rejects(access(join(cwd, 'output')));
});

test('preview advertises the same explicit web/native renderer selector', async (t) => {
  const cwd = await fixture(t);
  const result = await run(cwd, ['preview', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--renderer <renderer>/u);
  assert.match(result.stdout, /web or native/u);
});
