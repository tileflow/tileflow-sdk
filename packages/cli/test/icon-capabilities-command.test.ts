import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  isTileflowArtifactInputPath,
} from '@tileflow/dev/artifacts';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url));

test('validate, build and development reject the same mixed composition and recover explicitly', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-admission-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await mkdir(join(cwd, 'icons'));
  await writeFile(
    join(cwd, 'icons/health.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="red" d="M6 6H18V18H6Z"/></svg>',
  );
  const sidecar = join(cwd, 'icons/tileflow.icons.json');
  const config = (bounded: boolean) =>
    tileflowMapFixture({
      id: 'main',
      data: 'fixture',
      icons: 'authored',
      imports: "import {fixed, poi} from '@tileflow/core';",
      fields: `icons: [...streets.icons, './icons'], modules: {poi: poi({categories: ['medical'], placement: {coupleIconAndLabel: true}${bounded ? ", styles: {medical: {icon: {image: fixed('health', {reason: 'Chosen hospital icon'})}}}" : ''}})}`,
    });
  await writeFile(join(cwd, 'tileflow.config.ts'), config(false));
  const session = await createTileflowArtifactSession({cwd, watch: true});
  t.after(() => session.close());
  async function waitForStatus(status: 'ready' | 'invalid') {
    const deadline = Date.now() + 30_000;
    while (session.getState().status !== status) {
      if (Date.now() > deadline)
        throw new Error(
          `Timed out waiting for watched ${status} generation: ${JSON.stringify({status: session.getState().status, generation: session.getState().generation})}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const previous = session.getLastGoodArtifacts();
  assert.ok(previous);
  assert.ok(
    isTileflowArtifactInputPath(
      (previous as unknown as {inputs: {files: string[]; directories: string[]}}).inputs,
      sidecar,
    ),
  );

  await writeFile(
    sidecar,
    JSON.stringify({
      schemaVersion: 1,
      icons: {health: {representation: 'sdf', defaults: {color: '#c43d35'}}},
    }),
  );
  await waitForStatus('invalid');
  const invalid = session.getState();
  assert.equal(invalid.status, 'invalid');
  assert.match(JSON.stringify(invalid), /TF_ICON_REPRESENTATION_MIXED/);
  assert.equal(session.getLastGoodArtifacts(), previous);
  await assert.rejects(createTileflowBuildArtifacts({cwd}), {code: 'TF_ICON_REPRESENTATION_MIXED'});

  for (const command of ['validate', 'build']) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        cli,
        command,
        ...(command === 'validate' ? ['--json'] : []),
      ],
      {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: {...process.env, TILEFLOW_API_KEY: '', TILEFLOW_API_URL: '', NO_COLOR: '1'},
      },
    );
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(
      result.stderr + result.stdout,
      command === 'validate' ? /TF_ICON_REPRESENTATION_MIXED/ : /SDF.*RGBA/,
    );
  }

  await writeFile(join(cwd, 'tileflow.config.ts'), config(true));
  await waitForStatus('ready');
  assert.equal(session.getState().status, 'ready');
  assert.notEqual(session.getLastGoodArtifacts(), previous);
  const style = session.getLastGoodArtifacts()!.styles.main!.light!;
  const layer = style.layers.find((layer) => layer.id === 'tileflow-poi-medical');
  assert.equal((layer?.paint as Record<string, unknown>)['icon-color'], '#c43d35');
});
