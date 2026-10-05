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
  type TileflowArtifactSession,
  type TileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url));

test('the mixed-icon fixture waits for initial watched artifacts', async () => {
  const artifacts: TileflowBuildArtifacts = {
    assets: [],
    buildManifest: {schemaVersion: 1, maps: {}},
    manifest: {version: 1, maps: {}},
    project: {maps: {}},
    styles: {},
    watchPaths: [],
  };
  let ready = false;
  const session: Pick<TileflowArtifactSession, 'getState' | 'getLastGoodArtifacts'> = {
    getState: () =>
      ready
        ? {status: 'ready', generation: 2, lastGoodGeneration: 2, artifacts}
        : {status: 'building', generation: 2},
    getLastGoodArtifacts: () => (ready ? artifacts : undefined),
  };
  const initial = getInitialArtifacts(session);
  queueMicrotask(() => {
    ready = true;
  });

  assert.equal(await initial, artifacts);
});

test('the mixed-icon fixture awaits watcher shutdown before removing files', async () => {
  const hooks: Array<() => void | Promise<void>> = [];
  const calls: string[] = [];
  let releaseClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let isClosed = false;

  registerFixtureCleanup(
    {after: (hook) => hooks.push(hook)},
    'fixture',
    () => ({
      close: async () => {
        calls.push('close');
        await closed;
        isClosed = true;
      },
    }),
    async () => {
      calls.push('remove');
      assert.equal(isClosed, true, 'Removing files while the watcher is active');
    },
  );
  const cleanup = (async () => {
    for (const hook of hooks) await hook();
  })();
  const outcome = cleanup.then(
    () => undefined,
    (error: unknown) => error,
  );

  try {
    assert.deepEqual(calls, ['close']);
  } finally {
    releaseClose();
    await outcome;
  }

  assert.equal(await outcome, undefined);
  assert.deepEqual(calls, ['close', 'remove']);
});

test('the mixed-icon fixture preserves removal errors after closing the watcher', async () => {
  const hooks: Array<() => void | Promise<void>> = [];
  const failure = new Error('Cannot remove fixture');
  let closed = false;

  registerFixtureCleanup(
    {after: (hook) => hooks.push(hook)},
    'fixture',
    () => ({
      close: async () => {
        closed = true;
      },
    }),
    async () => {
      throw failure;
    },
  );

  await assert.rejects(
    async () => {
      for (const hook of hooks) await hook();
    },
    (error) => error === failure,
  );
  assert.equal(closed, true);
});

test('validate, build and development reject the same mixed composition and recover explicitly', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-admission-'));
  let session: TileflowArtifactSession | undefined = undefined;
  registerFixtureCleanup(t, cwd, () => session);
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
  session = await createTileflowArtifactSession({cwd, watch: true});
  const previous = await getInitialArtifacts(session);
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
  await waitForStatus(session, 'invalid');
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
  await waitForStatus(session, 'ready');
  assert.equal(session.getState().status, 'ready');
  assert.notEqual(session.getLastGoodArtifacts(), previous);
  const style = session.getLastGoodArtifacts()!.styles.main!.light!;
  const layer = style.layers.find((layer) => layer.id === 'tileflow-poi-medical');
  assert.equal((layer?.paint as Record<string, unknown>)['icon-color'], '#c43d35');
});

function registerFixtureCleanup(
  context: {after: (hook: () => void | Promise<void>) => void},
  cwd: string,
  getSession: () => Pick<TileflowArtifactSession, 'close'> | undefined,
  remove: typeof rm = rm,
) {
  context.after(async () => {
    try {
      await getSession()?.close();
    } finally {
      await remove(cwd, {recursive: true, force: true});
    }
  });
}

async function getInitialArtifacts(
  session: Pick<TileflowArtifactSession, 'getState' | 'getLastGoodArtifacts'>,
) {
  await waitForStatus(session, 'ready');

  const artifacts = session.getLastGoodArtifacts();
  assert.ok(artifacts, JSON.stringify(session.getState()));
  return artifacts;
}

async function waitForStatus(
  session: Pick<TileflowArtifactSession, 'getState'>,
  status: 'ready' | 'invalid',
) {
  const deadline = Date.now() + 30_000;
  while (session.getState().status !== status) {
    if (Date.now() > deadline)
      throw new Error(
        `Timed out waiting for watched ${status} generation: ${JSON.stringify({status: session.getState().status, generation: session.getState().generation})}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
