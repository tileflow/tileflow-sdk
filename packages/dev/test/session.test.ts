import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowDevRequestHandler,
  type TileflowArtifactSession,
  type TileflowArtifactSessionState,
} from '../src/index';
import {createTileflowArtifactSessionWithBuilder} from '../src/session';

test('refreshes transitive JSON imports and preserves last-good artifacts across invalid edits', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#112233');

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#445566"}\n', 'utf8');
  await session.refresh('test token edit');
  assert.equal(session.getState().generation, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  await session.refresh('test invalid edit');
  const invalid = session.getState();
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.generation, 3);
  assert.equal(invalid.lastGoodGeneration, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');
  assert.deepEqual(
    invalid.status === 'invalid'
      ? invalid.diagnostics.map((diagnostic) => Object.keys(diagnostic))
      : [],
    [['code', 'message', 'path', 'phase']],
  );
  if (invalid.status === 'invalid') {
    assert.equal(invalid.diagnostics[0]?.code, 'CONFIG_INVALID');
    assert.equal(invalid.diagnostics[0]?.phase, 'config-validation');
  }

  const handler = createTileflowDevRequestHandler({session});
  const status = await handler(new Request('http://localhost/__status'));
  assert.deepEqual(await status.json(), {
    schemaVersion: 1,
    generation: 3,
    status: 'invalid',
    lastGoodGeneration: 2,
    diagnostics: invalid.status === 'invalid' ? invalid.diagnostics : [],
  });
  const lastGoodStyle = await handler(new Request('http://localhost/styles/main.json'));
  assert.equal(lastGoodStyle.status, 200);
  assert.equal(waterColorFromStyle(await lastGoodStyle.json()), '#445566');

  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  await session.refresh('test recovery');
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().generation, 4);
});

test('watches conservative transitive inputs and emits monotonic building/ready states', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#102030"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const states: TileflowArtifactSessionState[] = [];
  session.subscribe((state) => states.push(state));

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#abcdef"}\n', 'utf8');
  const ready = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation >= 2,
  );
  assert.equal(ready.status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#abcdef');
  assert.deepEqual(
    states.slice(-2).map((state) => state.status),
    ['building', 'ready'],
  );
  assert.ok(
    states.every(
      (state, index) => index === 0 || state.generation >= states[index - 1]!.generation,
    ),
  );
});

test('publishes only the newest overlapping refresh generation', async () => {
  let build = 0;
  const session = await createTileflowArtifactSessionWithBuilder({}, async () => {
    build += 1;
    const current = build;
    if (current === 2) await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    if (current === 3) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    return {
      assets: [],
      manifest: {version: 1, maps: {}, styles: {}},
      project: {maps: {[`generation-${current}`]: {}}},
      styles: {},
      watchPaths: [],
    };
  });

  try {
    await Promise.all([session.refresh('slow'), session.refresh('newest')]);
    const state = session.getState();
    assert.equal(state.status, 'ready');
    assert.equal(state.generation, 3);
    assert.deepEqual(Object.keys(session.getLastGoodArtifacts()?.project.maps ?? {}), [
      'generation-3',
    ]);
  } finally {
    await session.close();
  }
});

test('redacts external absolute paths from watched-build diagnostic messages', async (t) => {
  const cwd = await createFixture(t);
  const external = join(cwd, '..', 'private-fixture', 'secret.json');
  const diagnostics = createTileflowArtifactDiagnostics(
    new Error(`Unable to read ${external}`),
    cwd,
  );

  assert.equal(JSON.stringify(diagnostics).includes(external), false);
  assert.match(diagnostics[0]?.message ?? '', /external path/);

  const windowsDiagnostics = createTileflowArtifactDiagnostics(
    {issues: [{message: 'Unable to read input', path: 'C:\\Users\\alice\\secret.json'}]},
    cwd,
  );
  assert.equal(windowsDiagnostics[0]?.path, '(external)');
});

test('preserves bounded code/phase diagnostics with deterministic URL-safe ordering', async (t) => {
  const cwd = await createFixture(t);
  const issues = Array.from({length: 40}, (_, index) => ({
    message:
      `https://user:secret@example.test/private/${index}?token=hidden ` +
      `Bearer bearer-secret tf_live_${'a'.repeat(32)} sk_live_private ${'x'.repeat(350)}`,
    path: `maps.zeta.layers.${String(39 - index).padStart(2, '0')}`,
  }));
  const diagnostics = createTileflowArtifactDiagnostics(
    Object.assign(new Error('invalid'), {
      code: 'STYLE_INVALID',
      issues,
      phase: 'style-validation',
    }),
    cwd,
  );

  assert.equal(diagnostics.length, 32);
  assert.equal(diagnostics[0]?.path, 'maps.zeta.layers.00');
  assert.equal(diagnostics.at(-1)?.path, 'maps.zeta.layers.31');
  assert.equal(
    diagnostics.every((item) => item.code === 'STYLE_INVALID'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.phase === 'style-validation'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.message.length <= 300),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /user:secret|token=hidden|private\/|bearer-secret|tf_live_|sk_live_private/,
  );
  assert.match(diagnostics[0]?.message ?? '', /https:\/\/example\.test/);
});

test('serves pinned local preview assets and a cancellable session event stream', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const handler = createTileflowDevRequestHandler({session});

  const preview = await (await handler(new Request('http://localhost/'))).text();
  assert.doesNotMatch(preview, /unpkg|fonts\.googleapis|fonts\.gstatic/);
  assert.match(preview, /__runtime\/maplibre-gl\.js/);
  assert.match(preview, /__events/);

  const [javascript, stylesheet] = await Promise.all([
    handler(new Request('http://localhost/__runtime/maplibre-gl.js')),
    handler(new Request('http://localhost/__runtime/maplibre-gl.css')),
  ]);
  assert.match(javascript.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await javascript.text()).length > 1_000_000);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);

  const events = await handler(new Request('http://localhost/__events'));
  const reader = events.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  await reader.cancel();
});

test('watches added, changed, removed, and newly effective local icon directories', async (t) => {
  const cwd = await createFixture(t);
  await mkdir(join(cwd, 'icons-a'));
  await mkdir(join(cwd, 'icons-b'));
  await writeFile(join(cwd, 'icons-a', 'base.svg'), svg('#111111'));
  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#222222'));
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#333333'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-a'));
  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  const initial = assetFingerprint(session);

  await writeFile(join(cwd, 'icons-a', 'added.svg'), svg('#444444'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 2);
  const added = assetFingerprint(session);
  assert.notEqual(added, initial);

  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#555555'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 3);
  const changed = assetFingerprint(session);
  assert.notEqual(changed, added);

  await unlink(join(cwd, 'icons-a', 'pin.svg'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 4);
  assert.notEqual(assetFingerprint(session), changed);

  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-b'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 5);
  const switched = assetFingerprint(session);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const switchedGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#777777'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > switchedGeneration,
  );
  assert.notEqual(assetFingerprint(session), switched);
});

const tokenModule = `import tokens from './tokens.json';\nexport default tokens;\n`;
const validConfig = `import tokens from './tokens.ts';
export default {
  maps: {
    main: {
      renderer: 'generated',
      labels: 'none',
      poi: 'none',
      roads: 'hidden',
      buildings: 'hidden',
      theme: {colors: {water: tokens.water}}
    }
  }
};
`;
const invalidConfig = `export default {maps: {main: {unsupported: true}}};\n`;

async function createFixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dev-session-'));
  return cwd;
}

function waterColor(
  artifacts: ReturnType<TileflowArtifactSession['getLastGoodArtifacts']>,
): unknown {
  return waterColorFromStyle(artifacts?.styles.main);
}

function waterColorFromStyle(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>})
    ?.layers;
  return layers?.find((layer) => layer.id === 'water')?.paint?.['fill-color'];
}

function waitForState(
  session: TileflowArtifactSession,
  predicate: (state: TileflowArtifactSessionState) => boolean,
  timeoutMs = 5_000,
): Promise<TileflowArtifactSessionState> {
  const current = session.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolveState, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for artifact state after ${timeoutMs} ms.`));
    }, timeoutMs);
    const unsubscribe = session.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolveState(state);
    });
  });
}

function iconConfig(source: string): string {
  return `export default {icons: {local: {source: '${source}'}}, maps: {main: {icons: 'local'}}};\n`;
}

function svg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="${color}"/></svg>`;
}

function assetFingerprint(session: TileflowArtifactSession): string {
  const assets = session.getLastGoodArtifacts()?.assets ?? [];
  return assets
    .map((asset) =>
      typeof asset.source === 'string'
        ? asset.source
        : Buffer.from(asset.source).toString('base64'),
    )
    .join('|');
}
