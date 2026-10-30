import {FSWatcher} from 'chokidar';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {
  defaultTileflowRuntimeView,
  defineMap,
  parseTileflowMap,
  TileflowMapResolutionError,
} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import type {TileflowBuildArtifacts} from '../src/artifacts';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  type TileflowArtifactSession,
  type TileflowArtifactSessionState,
} from '../src/artifacts';
import {resolveTileflowPreview} from '../src/preview';
import {createTileflowDevRequestHandler} from '../src/server';
import {createTileflowArtifactSessionWithBuilder} from '../src/session';
import {fixtureThemeFields} from './theme-fixture';

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
    assert.match(invalid.diagnostics[0]?.message ?? '', /unrecognized key "unsupported"/);
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
  const lastGoodPreview = await (await handler(new Request('http://localhost/'))).text();
  assert.match(lastGoodPreview, /const isSemanticPreview = true/);
  assert.match(lastGoodPreview, /const previewFontFaces = \[/);
  const lastGoodStyle = await handler(new Request('http://localhost/styles/main/light.json'));
  assert.equal(lastGoodStyle.status, 200);
  assert.equal(waterColorFromStyle(await lastGoodStyle.json()), '#445566');
  const compactStyle = await (
    await handler(new Request('http://localhost/styles/main/light.json'))
  ).text();
  assert.equal(compactStyle, `${JSON.stringify(JSON.parse(compactStyle))}\n`);
  const unknownTheme = await handler(new Request('http://localhost/styles/main/not-declared.json'));
  assert.equal(unknownTheme.status, 404);
  assert.deepEqual(await unknownTheme.json(), {error: 'Unknown map theme style.'});

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

test('watches an immediately created sidecar through an aliased working directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-watch-alias-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (let attempt = 0; attempt < 12; attempt++) {
    const project = join(root, `real-${attempt}`, 'project');
    await mkdir(join(project, 'icons'), {recursive: true});
    if (attempt >= 6) {
      await writeFile(join(project, 'tileflow.config.ts'), 'export default {};');
    }
    const alias = join(root, `alias-${attempt}`);
    await symlink(join(root, `real-${attempt}`), alias, 'dir');
    const watched = await realpath(join(project, 'icons'));
    const sidecar = join(watched, 'tileflow.icons.json');
    const session = await createTileflowArtifactSessionWithBuilder(
      {cwd: join(alias, 'project'), watch: true, debounceMs: 0},
      sidecarBuilder(watched),
    );
    try {
      assert.equal(session.getState().status, 'ready');
      // Edit before any newly added watcher can finish its initial scan.
      writeFileSync(sidecar, '{}');
      await assert.doesNotReject(
        waitForState(session, (state) => state.status === 'invalid', 5_000),
        `Metadata creation was missed on attempt ${attempt}.`,
      );

      await unlink(sidecar);
      await assert.doesNotReject(
        waitForState(session, (state) => state.status === 'ready', 5_000),
        `Metadata removal was missed on attempt ${attempt}.`,
      );
    } finally {
      await session.close();
    }
  }
});

test('keeps future output directories ignored through an aliased working directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-watch-ignored-alias-'));
  const project = join(root, 'project');
  const alias = join(root, 'alias');
  await mkdir(project);
  await symlink(project, alias, 'dir');

  const ignored = join(alias, 'generated', 'nested');
  const session = await createTileflowArtifactSessionWithBuilder(
    {cwd: alias, ignoredPaths: [ignored], watch: true, debounceMs: 0},
    async ({cwd}) => {
      assert.equal(cwd, alias);
      return {
        assets: [],
        buildManifest: {maps: {}, schemaVersion: 1},
        manifest: {version: 1, maps: {}},
        project: {maps: {}},
        styles: {},
        watchPaths: [],
      } as never;
    },
  );
  t.after(async () => {
    await session.close();
    await rm(root, {recursive: true, force: true});
  });

  await mkdir(ignored, {recursive: true});
  await writeFile(join(ignored, 'output.json'), '{}');
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, 1);

  await writeFile(join(alias, 'tileflow.config.ts'), 'export default {changed: true};');
  await waitForState(session, (state) => state.status === 'ready' && state.generation === 2);

  await rm(ignored, {recursive: true});
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, 2);
});

test('reconciles one missed startup creation and keeps subsequent notifications', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-watch-startup-'));
  const icons = join(cwd, 'icons');
  const sidecar = join(icons, 'tileflow.icons.json');
  await mkdir(icons);
  await writeFile(join(cwd, 'tileflow.config.ts'), 'export default {};');

  const emit = FSWatcher.prototype.emit;
  const notifications = t.mock.method(
    FSWatcher.prototype,
    'emit',
    function (this: FSWatcher, event: string, ...args: unknown[]) {
      if (event === 'raw' || event === 'all') return false;
      return Reflect.apply(emit, this, [event, ...args]) as boolean;
    },
  );

  const session = await createTileflowArtifactSessionWithBuilder(
    {cwd, watch: true, debounceMs: 0},
    sidecarBuilder(icons),
  );
  t.after(async () => {
    await session.close();
    await rm(cwd, {recursive: true, force: true});
  });

  await writeFile(sidecar, '{}');
  const invalid = await waitForState(session, (state) => state.status === 'invalid', 5_000);

  await unlink(sidecar);
  const watcher = notifications.mock.calls.find((call) => call.arguments[0] === 'ready')?.this;
  assert.ok(watcher instanceof FSWatcher);
  // Deliver one notification without racing native duplicates against the no-polling assertion.
  Reflect.apply(emit, watcher, ['all', 'unlink', sidecar]);
  const ready = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > invalid.generation,
    5_000,
  );

  await writeFile(sidecar, '{}');
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  assert.equal(session.getState().generation, ready.generation);
  assert.equal(session.getState().status, 'ready');
});

test('recovers when metadata disappears before its add notification settles', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-watch-settling-'));
  const icons = join(cwd, 'icons');
  const config = join(cwd, 'tileflow.config.ts');
  const sidecar = join(icons, 'tileflow.icons.json');
  await mkdir(icons);
  await writeFile(config, 'export default {};');

  const session = await createTileflowArtifactSessionWithBuilder(
    {cwd, watch: true, debounceMs: 0},
    sidecarBuilder(icons),
  );
  t.after(async () => {
    await session.close();
    await rm(cwd, {recursive: true, force: true});
  });

  await writeFile(config, 'export default {updated: true};');
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 2, 5_000);
  await writeFile(sidecar, '{}');
  await session.refresh('metadata read before watcher stabilization');
  const invalid = await waitForState(session, (state) => state.status === 'invalid', 5_000);
  assert.equal(invalid.status, 'invalid');

  await unlink(sidecar);
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > invalid.generation,
    5_000,
  );
});

test('recovers deleted metadata from a raw notification through an alias', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-watch-raw-alias-'));
  const project = join(root, 'project');
  const alias = join(root, 'alias');
  await mkdir(join(project, 'icons'), {recursive: true});
  await symlink(project, alias, 'dir');
  const icons = await realpath(join(project, 'icons'));
  const sidecar = join(icons, 'tileflow.icons.json');
  const config = join(alias, 'tileflow.config.ts');
  await writeFile(config, 'export default {};');

  const emit = FSWatcher.prototype.emit;
  const notifications = t.mock.method(
    FSWatcher.prototype,
    'emit',
    function (this: FSWatcher, event: string, ...args: unknown[]) {
      if (event === 'raw') return false;
      if (
        event === 'all' &&
        (typeof args[1] !== 'string' || basename(args[1]) !== 'tileflow.config.ts')
      ) {
        return false;
      }

      return Reflect.apply(emit, this, [event, ...args]) as boolean;
    },
  );
  const session = await createTileflowArtifactSessionWithBuilder(
    {cwd: alias, watch: true, debounceMs: 0},
    sidecarBuilder(icons),
  );
  t.after(async () => {
    await session.close();
    await rm(root, {recursive: true, force: true});
  });

  // Settle startup before isolating the metadata notification.
  await writeFile(config, 'export default {updated: true};');
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 2, 5_000);
  writeFileSync(sidecar, '{}');
  await session.refresh('metadata read without a stabilized add event');
  const invalid = await waitForState(session, (state) => state.status === 'invalid', 5_000);

  await unlink(sidecar);
  const watcher = notifications.mock.calls.find((call) => call.arguments[0] === 'ready')?.this;
  assert.ok(watcher instanceof FSWatcher);
  Reflect.apply(emit, watcher, [
    'raw',
    'rename',
    'tileflow.icons.json',
    {
      watchedPath: join(alias, 'icons'),
    },
  ]);
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > invalid.generation,
    5_000,
  );
});

test('publishes only the newest overlapping refresh generation', async () => {
  let build = 0;
  const session = await createTileflowArtifactSessionWithBuilder({}, async () => {
    build += 1;
    const current = build;
    const mapId = `generation-${current}`;
    if (current === 2) await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    if (current === 3) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    return {
      assets: [],
      manifest: {version: 1, maps: {}},
      project: {
        maps: {
          [mapId]: defineMap({
            id: mapId,
            version: 1,
            ...fixtureThemeFields,
          }),
        },
      },
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

test('retires a replaced generation after its last operation releases it', async () => {
  let build = 0;
  const disposed: number[] = [];
  const session = await createTileflowArtifactSessionWithBuilder({}, async () => {
    const generation = ++build;
    return {
      assets: [],
      buildManifest: {maps: {}, schemaVersion: 1},
      dispose: async () => {
        disposed.push(generation);
      },
      manifest: {version: 1, maps: {}},
      project: {maps: {}},
      styles: {},
      watchPaths: [],
    } as never;
  });
  const first = session.acquireArtifacts(1);
  assert.ok(first);

  await session.refresh('replacement');

  assert.deepEqual(disposed, []);
  assert.equal(session.acquireArtifacts(1), undefined);
  const second = session.acquireArtifacts(2);
  assert.ok(second);

  await first.release();
  assert.deepEqual(disposed, [1]);

  const close = session.close();
  let concurrentCloseFinished = false;
  const concurrentClose = session.close().then(() => {
    concurrentCloseFinished = true;
  });
  await Promise.resolve();
  assert.deepEqual(disposed, [1]);
  assert.equal(concurrentCloseFinished, false);
  await second.release();
  await Promise.all([close, concurrentClose]);
  assert.deepEqual(disposed, [1, 2]);
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

test('preserves semantic resolution pointers without exposing filesystem paths', async (t) => {
  const cwd = await createFixture(t);
  const resolutionDiagnostics = createTileflowArtifactDiagnostics(
    new TileflowMapResolutionError(
      'TILEFLOW_MODULE_ENABLED_RESERVED',
      'fixture',
      '/modules/water/enabled',
      'enabled is compiler-owned state; use disable() to suppress a complete semantic domain.',
    ),
    cwd,
  );

  assert.deepEqual(resolutionDiagnostics, [
    {
      code: 'TILEFLOW_MODULE_ENABLED_RESERVED',
      message:
        'Invalid Tileflow map "fixture": enabled is compiler-owned state; use disable() to suppress a complete semantic domain.',
      path: '/modules/water/enabled',
    },
  ]);

  const external = join(cwd, '..', 'private-fixture', 'secret.json');
  const filesystemDiagnostics = createTileflowArtifactDiagnostics(
    Object.assign(new Error(`Unable to read ${external}`), {path: external}),
    cwd,
  );
  assert.equal(filesystemDiagnostics[0]?.path, '(external)');
  assert.equal(JSON.stringify(filesystemDiagnostics).includes(external), false);
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

  const manifestResponse = await handler(new Request('http://localhost/manifest.json'));
  assert.equal(manifestResponse.status, 200);
  const manifest = (await manifestResponse.json()) as {
    maps: {main: {themes: {light: {styleUrl: string}}}};
  };
  const buildManifestResponse = await handler(new Request('http://localhost/build-manifest.json'));
  assert.equal(buildManifestResponse.status, 200);
  assert.match(
    ((await buildManifestResponse.json()) as {maps: {main: {mapRevisionSha256: string}}}).maps.main
      .mapRevisionSha256,
    /^[a-f0-9]{64}$/u,
  );
  const immutableStyleResponse = await handler(
    new Request(new URL(manifest.maps.main.themes.light.styleUrl, 'http://localhost')),
  );
  assert.equal(immutableStyleResponse.status, 200);
  assert.match(immutableStyleResponse.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(((await immutableStyleResponse.json()) as {version?: number}).version, 8);

  const preview = await (await handler(new Request('http://localhost/'))).text();
  assert.doesNotMatch(preview, /unpkg|fonts\.googleapis|fonts\.gstatic/);
  assert.match(preview, /__runtime\/maplibre-gl\.mjs/);
  assert.match(preview, /__runtime\/maplibre-gl-worker\.mjs/);
  assert.doesNotMatch(preview, /__runtime\/maplibre-gl\.js/);
  assert.match(preview, /__runtime\/tileflow-browser\.js/);
  assert.match(preview, /import \{loadTileflowStyleFonts\}/);
  assert.match(
    preview,
    /await loadTileflowStyleFonts\(styleUrl, \{fontFaces: previewFontFaces\}\)/,
  );
  assert.doesNotMatch(preview, /Oxanium|__runtime\/fonts\//);
  assert.match(preview, /__runtime\/three\.module\.js/);
  assert.doesNotMatch(preview, /^\s*import \* as THREE/m);
  assert.match(preview, /function loadThreeCoreRuntime\(\)/);
  assert.match(preview, /function loadBuildingWireframeRuntime\(\)/);
  assert.match(preview, /three-addons\/lines\/LineMaterial\.js/);
  assert.match(preview, /three-addons\/lines\/LineSegments2\.js/);
  assert.match(preview, /three-addons\/lines\/LineSegmentsGeometry\.js/);
  assert.match(preview, /function createBuildingWireframeLayer\(map, styleLayer\)/);
  assert.match(preview, /function addBuildingWireframeLayerIfConfigured\(map, styleLayers\)/);
  assert.match(preview, /const maximumBuildings = 10000/);
  assert.match(preview, /const maximumSegments = 300000/);
  assert.match(preview, /function geometryPolygons\(candidate\)/);
  assert.match(preview, /function ringIntersectsViewport\(ring, viewportWidth, viewportHeight\)/);
  assert.match(
    preview,
    /const viewportWidth = canvas\.clientWidth \|\| canvas\.width;[\s\S]*?let features;\s+try \{/,
  );
  assert.match(preview, /for \(const rings of polygons\)/);
  assert.match(preview, /buildingWireframeMetrics\.truncated = truncated/);
  assert.match(preview, /appendSegment\(positions, lower\[index\], lower\[next\]\)/);
  assert.match(preview, /appendSegment\(positions, upper\[index\], upper\[next\]\)/);
  assert.match(preview, /appendSegment\(positions, lower\[index\], upper\[index\]\)/);
  assert.match(preview, /geometrySignature !== lastGeometrySignature \|\| !geometry/);
  assert.match(preview, /event\.isSourceLoaded !== true/);
  assert.equal(preview.match(/depthTest: false/g)?.length, 2);
  assert.match(preview, /const needsBuildingWireframe =/);
  assert.match(
    preview,
    /map\.addLayer\(createBuildingWireframeLayer\(map, styleLayer\), layerAboveBuildings\)/,
  );
  assert.match(preview, /tileflow:visible-layer-groups/);
  assert.match(preview, /threeDimensionalToggle === "building"[\s\S]*?threeDimensionalEnabled/);
  assert.match(preview, /map\.queryRenderedFeatures\(/);
  assert.match(preview, /\{layers: \[styleLayer\.id\]\}/);
  assert.doesNotMatch(preview, /querySourceFeatures\(sourceId, \{sourceLayer\}\)/);
  assert.doesNotMatch(preview, /map\.project\(\[lng, lat\]\)/);
  assert.doesNotMatch(preview, /options\.modelViewProjectionMatrix/);
  assert.doesNotMatch(preview, /function queueRefreshWhenIdle\(\)/);
  assert.match(preview, /emptyRefreshAttempts < 12/);
  assert.match(preview, /queueRefresh\(\);/);
  assert.doesNotMatch(preview, /map\.on\("move", handleMove\)/);
  assert.match(preview, /map\.on\("sourcedata", handleSourceData\)/);
  assert.match(preview, /map\.setProjection\(\{type: "mercator"\}\)/);
  assert.match(preview, /attachTileflowAtmosphere\(map\)/);
  assert.doesNotMatch(preview, /function updateGlobeBackdrop/);
  assert.match(preview, /class ThreeDimensionalControl/);
  // TREES and 3D mount Core's renderers, as an application does, from the style's description.
  assert.match(preview, /createTileflowMap3D\(\{map, controller: coreSceneThemes\(map\)/);
  assert.match(preview, /metadata\["tileflow:vegetation-display"\]/);
  assert.doesNotMatch(preview, /treeRenderer/);
  assert.match(preview, /class TreeControl/);
  assert.match(preview, /setEnabled\(enabled\)/);
  assert.match(preview, /this\.setEnabled\(!this\.enabled\)/);
  assert.match(preview, /this\.enabled \? "3D ON" : "3D OFF"/);
  assert.match(preview, /this\.enabled \? "TREES ON" : "TREES OFF"/);
  assert.match(preview, /readToggleFromUrl\("buildings3d", true\)/);
  assert.match(preview, /readToggleFromUrl\("trees3d", true\)/);
  assert.match(preview, /map\.fire\("tileflow:trees-toggle"/);
  assert.match(preview, /treeControl = new TreeControl\(\)/);
  assert.match(preview, /map\.addControl\(treeControl, "top-right"\)/);
  assert.doesNotMatch(preview, /this\.map\.easeTo/);
  assert.doesNotMatch(preview, /map\.on\("pitch", this\.update\)/);
  assert.match(preview, /toggle !== "building" && toggle !== "landmark"/);
  assert.match(preview, /setLayoutProperty\(layer\.id, "visibility", visibility\)/);
  assert.match(preview, /const isSemanticPreview = true/);
  assert.match(preview, /__events/);
  assert.match(preview, /new URL\(location\.href\)\.searchParams/);
  assert.match(preview, /delete resolved\.bounds/);
  assert.match(preview, /history\.replaceState\(history\.state, "", url\.href\)/);
  assert.match(preview, /map\.on\("moveend", \(\) => writeCameraToUrl\(map\)\)/);
  assert.match(preview, /map\.on\("styledata", ensureThreeDimensionalLayers\)/);
  assert.match(preview, /map\.on\("zoomend", ensureThreeDimensionalLayers\)/);
  assert.match(preview, /tileflow:set-map-state/);
  assert.match(preview, /const previewLayerGroupIds = \[/);
  assert.match(preview, /function previewLayerGroups\(layer\)/);
  assert.match(preview, /const isLanduseLayer = \[/);
  assert.match(preview, /!isLanduseLayer &&[\s\S]*?groups\.push\("pois"\)/);
  assert.match(preview, /function applyVisibleLayerGroups\(map\)/);
  assert.match(preview, /dataset\.visibleLayerGroups/);
  assert.match(preview, /globalThis\.__tileflowPreviewMap = map/);
  assert.match(preview, /setVisibleLayerGroups\(map, nextVisibleLayerGroups\)/);
  assert.match(preview, /event\.source !== window\.parent/);
  assert.match(preview, /event\.origin !== location\.origin/);
  assert.match(preview, /map\.jumpTo\(\{/);
  assert.match(preview, /function styleLayerZoomRange\(layer\)/);
  assert.match(preview, /return zoom >= minzoom && zoom < maxzoom/);
  assert.match(preview, /credentials: "include"/);
  assert.doesNotMatch(preview, /material\.roughness = 0\.82/);
  assert.doesNotMatch(preview, /material\.metalness = Math\.min/);
  assert.doesNotMatch(preview, /material\.emissive\.setRGB/);
  assert.doesNotMatch(preview, /canvasContextAttributes: \{antialias: true\}/);
  assert.doesNotMatch(preview, /antialias: true/);
  assert.match(preview, /previewSearchParameters\.get\("mapBenchmark"\) === "1"/);
  assert.match(preview, /previewSearchParameters\.get\("mapSweep"\) === "1"/);
  assert.match(preview, /previewSearchParameters\.get\("mapCompare"\) === "1"/);
  assert.match(preview, /previewSearchParameters\.get\("mapWorkers"\)/);
  assert.match(preview, /mapWorkerCountOverride \?\?/);
  assert.match(preview, /mapBenchmarkCenter \? \{center: mapBenchmarkCenter\} : \{\}/);
  assert.match(
    preview,
    /globalThis\.__tileflowMapBenchmark = \{compareRemote, metrics, settleZoom\}/,
  );
  assert.match(preview, /collectResourceTiming: mapBenchmarkEnabled/);
  assert.match(preview, /function inspectRenderBuckets\(\)/);
  assert.match(preview, /resourceEncodedBytes/);
  assert.match(preview, /async function compareRemote\(options = \{\}\)/);
  assert.match(preview, /dataset\.tileflowMapCompareStatus = "complete"/);
  assert.match(preview, /dataset\.tileflowMapSweepStatus = "complete"/);
  assert.match(preview, /Array\.from\(\{length: 23\}, \(_, zoom\) => zoom\)/);
  assert.match(preview, /boundary - 0\.01, boundary, boundary \+ 0\.01/);
  assert.match(preview, /if \(result\.timedOut\)/);
  assert.match(preview, /if \(result\.errors\.length > 0\)/);
  assert.match(preview, /dataset\.tileflowMapSweepStatus = "failed"/);
  assert.match(preview, /installMapBenchmark\(map\)/);
  assert.match(preview, /maplibregl\.setWorkerCount\?\.\(mapWorkerCount\)/);
  assert.match(preview, /const mapWorkerCount = mapWorkerCountOverride \?\? 1/);

  const [
    mapLibreMain,
    mapLibreWorker,
    stylesheet,
    three,
    threeCore,
    lineMaterial,
    lineSegments,
    lineSegmentsGeometry,
    tileflowBrowser,
  ] = await Promise.all([
    handler(new Request('http://localhost/__runtime/maplibre-gl.mjs')),
    handler(new Request('http://localhost/__runtime/maplibre-gl-worker.mjs')),
    handler(new Request('http://localhost/__runtime/maplibre-gl.css')),
    handler(new Request('http://localhost/__runtime/three.module.js')),
    handler(new Request('http://localhost/__runtime/three.core.min.js')),
    handler(new Request('http://localhost/__runtime/three-addons/lines/LineMaterial.js')),
    handler(new Request('http://localhost/__runtime/three-addons/lines/LineSegments2.js')),
    handler(new Request('http://localhost/__runtime/three-addons/lines/LineSegmentsGeometry.js')),
    handler(new Request('http://localhost/__runtime/tileflow-browser.js')),
  ]);
  assert.match(mapLibreMain.headers.get('content-type') ?? '', /javascript/);
  const mainSource = await mapLibreMain.text();
  assert.match(mainSource, /maplibre-gl-worker\.mjs/u);
  assert.ok(mainSource.length > 100_000);
  assert.match(mapLibreWorker.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await mapLibreWorker.text()).length > 1_000);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);
  assert.match(three.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await three.text()).length > 300_000);
  assert.match(threeCore.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await threeCore.text()).length > 100_000);
  assert.match(tileflowBrowser.headers.get('content-type') ?? '', /javascript/);
  assert.match(await tileflowBrowser.text(), /loadTileflowStyleFonts/);
  assert.match(lineMaterial.headers.get('content-type') ?? '', /javascript/);
  assert.match(await lineMaterial.text(), /class LineMaterial/);
  assert.match(lineSegments.headers.get('content-type') ?? '', /javascript/);
  assert.match(await lineSegments.text(), /class LineSegments2/);
  assert.match(lineSegmentsGeometry.headers.get('content-type') ?? '', /javascript/);
  assert.match(await lineSegmentsGeometry.text(), /class LineSegmentsGeometry/);

  const events = await handler(new Request('http://localhost/__events'));
  const reader = events.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  await reader.cancel();
});

test('selects map and scene previews with their configured cameras and viewport', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tileflow.workspace.ts'), previewConfig, 'utf8');
  t.after(async () => rm(cwd, {force: true, recursive: true}));

  const project: TileflowBuildCatalog = {
    maps: {
      first: parseTileflowMap(
        defineMap({
          id: 'first',
          version: 1,
          ...fixtureThemeFields,
        }),
      ),
      second: parseTileflowMap(
        defineMap({
          id: 'second',
          version: 1,
          ...fixtureThemeFields,
          view: {bearing: 12, center: [2, 3], pitch: 35, zoom: 9},
        }),
      ),
    },
    scenes: {
      bounds: {
        map: 'second',
        camera: {
          type: 'bounds' as const,
          bounds: [1, 2, 3, 4] as [number, number, number, number],
          padding: 24,
        },
        theme: 'light',
        viewport: {width: 800, height: 600},
      },
      mobile: {
        map: 'second',
        camera: {type: 'center' as const, center: [2.5, 3.5] as [number, number], zoom: 14},
        theme: 'light',
        viewport: {width: 390, height: 844, dpr: 2 as const},
      },
      product: {
        map: 'second',
        camera: {type: 'center' as const, center: [2, 3] as [number, number], zoom: 9},
        theme: 'light',
        viewport: {width: 800, height: 600},
        target: {kind: 'application' as const, path: '/maps'},
      },
    },
  };

  assert.deepEqual(resolveTileflowPreview(project, {map: 'second'}), {
    camera: {type: 'center', center: [2, 3], zoom: 9, bearing: 12, pitch: 35},
    label: 'second / light',
    mapName: 'second',
    themeName: 'light',
    themeNames: ['light'],
  });
  assert.deepEqual(resolveTileflowPreview(project, {map: 'first'}).camera, {
    type: 'center',
    bearing: defaultTileflowRuntimeView.bearing,
    center: [...defaultTileflowRuntimeView.center],
    pitch: defaultTileflowRuntimeView.pitch,
    zoom: defaultTileflowRuntimeView.zoom,
  });
  assert.deepEqual(resolveTileflowPreview(project, {scene: 'bounds'}), {
    camera: {
      type: 'bounds',
      bounds: [1, 2, 3, 4],
      padding: 24,
      bearing: 0,
      pitch: 0,
    },
    label: 'second / light / bounds · 800×600',
    mapName: 'second',
    themeName: 'light',
    viewport: {width: 800, height: 600, dpr: 1},
  });
  assert.throws(() => resolveTileflowPreview(project, {map: 'first', scene: 'mobile'}), /either/);
  assert.throws(() => resolveTileflowPreview(project, {map: 'missing'}), /Unknown Tileflow map/);
  assert.throws(
    () => resolveTileflowPreview(project, {scene: 'product'}),
    /targets an application/,
  );
  assert.throws(
    () =>
      resolveTileflowPreview(
        {
          ...project,
          scenes: {
            ...project.scenes,
            invalidTheme: {...project.scenes!.mobile!, theme: 'not-declared'},
          },
        },
        {scene: 'invalidTheme'},
      ),
    /theme selection is invalid or unknown.*light/u,
  );

  const mapResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/'));
  const mapHtml = await mapResponse.text();
  assert.equal(mapResponse.status, 200);
  assert.match(mapHtml, /\/styles\/second\/light\.json/);
  assert.match(mapHtml, /"center":\[2,3\]/);
  assert.doesNotMatch(mapHtml, /"maxPitch":/);
  assert.match(mapHtml, /"pitch":35/);
  assert.match(mapHtml, /"zoom":9/);
  assert.doesNotMatch(mapHtml, /-3\.7038/);
  assert.match(mapHtml, /cameraRanges/);
  assert.match(mapHtml, /getAll\(name\)/);

  const queryMapResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?map=first'));
  const queryMapHtml = await queryMapResponse.text();
  assert.equal(queryMapResponse.status, 200);
  assert.match(queryMapHtml, /\/styles\/first\/light\.json/);
  assert.doesNotMatch(queryMapHtml, /\/styles\/second\/light\.json/);

  const darkThemeResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?theme=dark'));
  const darkThemeHtml = await darkThemeResponse.text();
  assert.equal(darkThemeResponse.status, 200);
  assert.match(darkThemeHtml, /\/styles\/second\/dark\.json/);
  assert.match(darkThemeHtml, /second \/ dark/);

  const unknownThemeResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?theme=not-declared'));
  assert.equal(unknownThemeResponse.status, 400);
  assert.match(
    ((await unknownThemeResponse.json()) as {error: string}).error,
    /theme selection is invalid or unknown.*dark, dark-faded, dark-monochrome, dawn, dawn-faded, dawn-monochrome, dusk, dusk-faded, dusk-monochrome, faded, light, monochrome/u,
  );

  const missingQueryMapResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?map=missing'));
  assert.equal(missingQueryMapResponse.status, 400);
  assert.deepEqual(await missingQueryMapResponse.json(), {
    error: 'Unknown Tileflow map: missing',
  });

  const duplicateQueryMapResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?map=first&map=second'));
  assert.equal(duplicateQueryMapResponse.status, 400);
  assert.deepEqual(await duplicateQueryMapResponse.json(), {
    error: 'Tileflow map query must appear at most once.',
  });

  const duplicateQueryThemeResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'second',
  })(new Request('http://localhost/?theme=light&theme=dark'));
  assert.equal(duplicateQueryThemeResponse.status, 400);
  assert.deepEqual(await duplicateQueryThemeResponse.json(), {
    error: 'Tileflow theme query must appear at most once.',
  });

  const sceneResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    scene: 'mobile',
  })(new Request('http://localhost/'));
  const sceneHtml = await sceneResponse.text();
  assert.equal(sceneResponse.status, 200);
  assert.match(sceneHtml, /width: 390px/);
  assert.match(sceneHtml, /height: 844px/);
  assert.match(sceneHtml, /second \/ light \/ mobile/);

  const overriddenSceneResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    scene: 'mobile',
  })(new Request('http://localhost/?theme=dark'));
  assert.equal(overriddenSceneResponse.status, 400);
  assert.match(
    ((await overriddenSceneResponse.json()) as {error: string}).error,
    /scene owns its concrete theme/u,
  );

  const boundsResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    scene: 'bounds',
  })(new Request('http://localhost/'));
  const boundsHtml = await boundsResponse.text();
  assert.match(boundsHtml, /"bounds":\[\[1,2\],\[3,4\]\]/);

  const persisted = runPreviewScript(
    boundsHtml,
    'http://localhost/?keep=this&lng=-3.7038&lat=40.4168&zoom=15.25&bearing=12&pitch=0',
  );
  assert.equal(JSON.stringify(persisted.mapOptions?.center), '[-3.7038,40.4168]');
  assert.equal(persisted.mapOptions?.zoom, 15.25);
  // The map raises MapLibre's default pitch limit; the URL camera adds no limit of its own.
  assert.equal(persisted.mapOptions?.maxPitch, 85);
  assert.equal(persisted.mapOptions?.pitch, 0);
  assert.equal('bounds' in (persisted.mapOptions ?? {}), false);
  assert.equal('fitBoundsOptions' in (persisted.mapOptions ?? {}), false);
  persisted.emit('styledata');
  persisted.emit('load');
  assert.equal(persisted.threeDimensionalLabel(), '3D ON');
  assert.equal(persisted.treeLabel(), 'TREES ON');
  assert.equal(persisted.buildingVisibility(), 'visible');
  assert.equal(persisted.treeVisibility(), 'visible');
  persisted.toggleThreeDimensional();
  assert.equal(persisted.threeDimensionalLabel(), '3D OFF');
  assert.equal(persisted.buildingVisibility(), 'none');
  persisted.emit('styledata');
  assert.equal(persisted.buildingVisibility(), 'none');
  persisted.toggleThreeDimensional();
  assert.equal(persisted.pitch(), 0);
  assert.equal(persisted.threeDimensionalLabel(), '3D ON');
  assert.equal(persisted.buildingVisibility(), 'visible');
  persisted.emit('styledata');
  assert.equal(persisted.buildingVisibility(), 'visible');
  persisted.toggleTrees();
  assert.equal(persisted.treeLabel(), 'TREES OFF');
  assert.equal(persisted.treeVisibility(), 'none');
  persisted.toggleTrees();
  assert.equal(persisted.treeLabel(), 'TREES ON');
  // A style without 3D trees keeps its flat trees.
  assert.equal(persisted.treeVisibility(), 'visible');
  const persistedUrl = new URL(persisted.currentUrl());
  assert.equal(persistedUrl.searchParams.get('keep'), 'this');
  assert.equal(persistedUrl.searchParams.get('lng'), '-3.7038');
  assert.equal(persistedUrl.searchParams.get('lat'), '40.4168');
  assert.equal(persistedUrl.searchParams.get('zoom'), '15.25');
  assert.equal(persistedUrl.searchParams.get('bearing'), '12');
  assert.equal(persistedUrl.searchParams.get('pitch'), '0');
  assert.equal(persistedUrl.searchParams.get('buildings3d'), 'on');
  assert.equal(persistedUrl.searchParams.get('trees3d'), 'on');

  const restoredToggles = runPreviewScript(boundsHtml, persistedUrl.href);
  restoredToggles.emit('styledata');
  restoredToggles.emit('load');
  assert.equal(restoredToggles.threeDimensionalLabel(), '3D ON');
  assert.equal(restoredToggles.treeLabel(), 'TREES ON');
  assert.equal(restoredToggles.buildingVisibility(), 'visible');
  assert.equal(restoredToggles.treeVisibility(), 'visible');

  // Ordinary style events must not undo a temporary Rules visibility edit.
  restoredToggles.setBusinessAreaVisibility('none');
  restoredToggles.emit('styledata');
  assert.equal(restoredToggles.businessAreaVisibility(), 'none');
  restoredToggles.setBusinessAreaVisibility('visible');
  restoredToggles.emit('styledata');
  assert.equal(restoredToggles.businessAreaVisibility(), 'visible');

  restoredToggles.applyParentMapState({
    type: 'tileflow:set-map-state',
    schemaVersion: 1,
    state: {
      bearing: -24,
      buildings3d: false,
      center: [-3.688344, 40.453053],
      pitch: 58,
      trees3d: false,
      visibleLayerGroups: ['roads', 'transit', 'buildings', 'landuse', 'water'],
      zoom: 17.75,
    },
  });
  assert.deepEqual(restoredToggles.center(), [-3.688344, 40.453053]);
  assert.equal(restoredToggles.bearing(), -24);
  assert.equal(restoredToggles.pitch(), 58);
  assert.equal(restoredToggles.zoom(), 17.75);
  assert.equal(restoredToggles.threeDimensionalLabel(), '3D OFF');
  assert.equal(restoredToggles.treeLabel(), 'TREES OFF');
  assert.equal(restoredToggles.businessAreaVisibility(), 'visible');
  const controlledUrl = new URL(restoredToggles.currentUrl());
  assert.equal(controlledUrl.searchParams.get('buildings3d'), 'off');
  assert.equal(controlledUrl.searchParams.get('trees3d'), 'off');

  // A style that describes its 3D scene: the controls show and hide Core's layers, which stand in
  // for the compiled extrusion and the flat trees.
  const automaticScene = runPreviewScript(boundsHtml, 'http://localhost/?zoom=16', {
    coreScene: true,
  });
  automaticScene.emit('styledata');
  automaticScene.emit('load');
  assert.equal(automaticScene.threeDimensionalLabel(), '3D ON');
  assert.ok(automaticScene.coreCalls().includes('buildings:show'));

  const coreScene = runPreviewScript(
    boundsHtml,
    'http://localhost/?lng=-3.7&lat=40.4&zoom=16&buildings3d=off',
    {
      coreScene: true,
    },
  );
  coreScene.emit('styledata');
  coreScene.emit('load');
  // Model trees start enabled even with 3D buildings off and pitch zero; the 3D view mounts
  // no buildings until it is shown.
  assert.deepEqual(coreScene.coreCalls(), ['trees:create', 'trees:show']);
  assert.equal(coreScene.treeVisibility(), 'none');
  coreScene.toggleThreeDimensional();
  assert.equal(coreScene.buildingVisibility(), 'none');
  coreScene.toggleTrees();
  coreScene.emit('styledata');
  assert.deepEqual(coreScene.coreCalls().slice(2), [
    'buildings:create',
    'lights:create',
    'buildings:show',
    'trees:hide',
  ]);
  assert.equal(coreScene.treeVisibility(), 'none');
  coreScene.applyParentMapState({
    type: 'tileflow:set-map-state',
    schemaVersion: 1,
    state: {
      bearing: 0,
      buildings3d: false,
      center: [-3.7, 40.4],
      pitch: 0,
      trees3d: false,
      zoom: 16,
    },
  });
  assert.deepEqual(coreScene.coreCalls().slice(6), ['lights:dispose', 'buildings:hide']);

  const unlitScene = runPreviewScript(boundsHtml, 'http://localhost/?zoom=16&buildings3d=on', {
    coreScene: true,
    streetLights: false,
  });
  unlitScene.emit('styledata');
  unlitScene.emit('load');
  assert.ok(unlitScene.coreCalls().includes('buildings:show'));
  assert.equal(
    unlitScene.coreCalls().some((call) => call.startsWith('lights:')),
    false,
  );

  const hiddenVegetation = runPreviewScript(boundsHtml, 'http://localhost/?zoom=16', {
    coreScene: true,
    vegetationVisible: false,
  });
  hiddenVegetation.emit('styledata');
  hiddenVegetation.emit('load');
  assert.equal(hiddenVegetation.treeLabel(), 'TREES OFF');
  assert.equal(hiddenVegetation.treeVisibility(), 'none');
  assert.equal(new URL(hiddenVegetation.currentUrl()).searchParams.get('trees3d'), 'off');
  hiddenVegetation.toggleTrees();
  assert.equal(hiddenVegetation.treeLabel(), 'TREES ON');

  const cameraBeforeInvalidCommand = restoredToggles.center();
  restoredToggles.applyParentMapState({
    type: 'tileflow:set-map-state',
    schemaVersion: 1,
    state: {
      bearing: 0,
      buildings3d: true,
      center: [200, 40],
      pitch: 0,
      trees3d: false,
      zoom: 10,
    },
  });
  assert.deepEqual(restoredToggles.center(), cameraBeforeInvalidCommand);

  const restartedServer = runPreviewScript(boundsHtml, persistedUrl.href);
  restartedServer.emitServerEvent('open');
  assert.equal(restartedServer.reloads(), 0);
  restartedServer.emitServerEvent('error');
  restartedServer.emitServerEvent('open');
  assert.equal(restartedServer.reloads(), 1);

  const embedded = runPreviewScript(boundsHtml, persistedUrl.href, {sharedStatus: true});
  assert.equal(embedded.eventSources(), 0);
  embedded.emitParentStatus({status: 'ready', generation: 999});
  assert.equal(embedded.reloads(), 1);

  const invalidCamera = runPreviewScript(
    mapHtml,
    'http://localhost/?lng=-3.7038&lat=40.4168&zoom=99&bearing=0&pitch=0',
  );
  assert.equal(JSON.stringify(invalidCamera.mapOptions?.center), '[2,3]');
  assert.equal(invalidCamera.mapOptions?.zoom, 9);

  const missingResponse = await createTileflowDevRequestHandler({
    config: 'tileflow.workspace.ts',
    cwd,
    map: 'missing',
  })(new Request('http://localhost/'));
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), {error: 'Unknown Tileflow map: missing'});
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

  const initialGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#343434'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, initialGeneration);

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

test('recovers from an initially invalid local font through fallback watch paths', async (t) => {
  const cwd = await createFixture(t);
  await mkdir(join(cwd, 'fonts'));
  await writeFile(join(cwd, 'fonts', 'LICENSE.txt'), 'Fixture font license\n');
  await writeFile(join(cwd, 'fonts', 'medium.ttf'), 'invalid font');
  await writeFile(join(cwd, 'fonts', 'semibold.ttf'), 'invalid font');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {baedeker} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:baedeker,fonts:['./fonts']});\n`,
  );

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'invalid');
  const invalidGeneration = session.getState().generation;

  for (const [file, source] of [
    ['medium.ttf', 'Regular'],
    ['semibold.ttf', 'SemiBold'],
    ['italic.ttf', 'Italic'],
  ]) {
    await writeFile(
      join(cwd, 'fonts', file),
      await readFile(
        new URL(
          `../../maps/assets/baedeker/fonts/CormorantGaramond-${source}.ttf`,
          import.meta.url,
        ),
      ),
    );
  }

  const ready = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > invalidGeneration,
  );
  assert.equal(ready.status, 'ready');
  assert.ok(
    session
      .getLastGoodArtifacts()
      ?.assets.some((asset) => asset.fileName.startsWith('fonts/cormorant-garamond-regular-')),
  );

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  await waitForState(
    session,
    (state) => state.status === 'invalid' && state.generation > ready.generation,
  );
  const lastGoodPreview = await (
    await createTileflowDevRequestHandler({session})(new Request('http://localhost/'))
  ).text();
  assert.match(lastGoodPreview, /const previewFontFaces = \[\{/);
  assert.match(lastGoodPreview, /fonts\/cormorant-garamond-regular-/);
});

test('rejects and never watches icon directories outside the working tree', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-dev-external-watch-'));
  const cwd = join(parent, 'project');
  const externalIcons = join(parent, 'icons-external');
  await mkdir(cwd);
  await linkWorkspacePackages(cwd);
  await mkdir(externalIcons);
  await writeFile(join(externalIcons, 'pin.svg'), svg('#111111'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('../icons-external'));

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(parent, {force: true, recursive: true});
  });

  assert.equal(session.getState().status, 'invalid');
  const initialGeneration = session.getState().generation;
  await writeFile(join(externalIcons, 'pin.svg'), svg('#222222'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, initialGeneration);

  await mkdir(join(cwd, 'icons'));
  await writeFile(join(cwd, 'icons', 'pin.svg'), svg('#333333'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > initialGeneration,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const recoveredGeneration = session.getState().generation;
  await writeFile(join(externalIcons, 'pin.svg'), svg('#444444'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, recoveredGeneration);
});

const tokenModule = `import tokens from './tokens.json';\nexport default tokens;\n`;
const fixtureGlyphsSource = `{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic','DINish Medium,Noto Sans Regular','DINish Bold,Noto Sans Regular']}`;
const validConfig = `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
import tokens from './tokens.ts';
export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  icons: [],
  glyphs: ${fixtureGlyphsSource},
  modules: {poi: {type: 'poi', icons: false}, roads: disable(), vegetation: disable()},
  name: tokens.water
});
`;
const invalidConfig = `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id: 'main', version: 1, extends: streets, unsupported: true});\n`;
const previewConfig = `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default {
  maps: {
    first: defineMap({id: 'first', version: 1, extends: streets, icons: [], glyphs: ${fixtureGlyphsSource}, modules: {poi: {type: 'poi', icons: false}, roads: disable(), vegetation: disable()}}),
    second: defineMap({
      id: 'second',
      version: 1,
      extends: streets,
      icons: [],
      glyphs: ${fixtureGlyphsSource},
      modules: {poi: {type: 'poi', icons: false}, roads: disable(), vegetation: disable()},
      view: {bearing: 12, center: [2, 3], pitch: 35, zoom: 9},
      scenes: {
        bounds: {
          camera: {type: 'bounds', bounds: [1, 2, 3, 4], padding: 24},
          theme: 'light',
          viewport: {width: 800, height: 600}
        },
        mobile: {
          camera: {type: 'center', center: [2.5, 3.5], zoom: 14},
          theme: 'light',
          viewport: {width: 390, height: 844, dpr: 2}
        }
      }
    })
  }
};
`;

function sidecarBuilder(directory: string): () => Promise<TileflowBuildArtifacts> {
  return async () => {
    try {
      await readFile(join(directory, 'tileflow.icons.json'));
      throw new Error('Invalid icon metadata');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    return {
      assets: [],
      buildManifest: {maps: {}, schemaVersion: 1},
      manifest: {version: 1, maps: {}},
      project: {maps: {}},
      styles: {},
      watchPaths: [directory],
    };
  };
}

async function createFixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dev-session-'));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  return cwd;
}

function waterColor(
  artifacts: ReturnType<TileflowArtifactSession['getLastGoodArtifacts']>,
): unknown {
  return waterColorFromStyle(artifacts?.styles.main?.light);
}

function waterColorFromStyle(style: unknown): unknown {
  return (style as {name?: unknown} | undefined)?.name;
}

function waitForState(
  session: TileflowArtifactSession,
  predicate: (state: TileflowArtifactSessionState) => boolean,
  timeoutMs = 15_000,
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
  return `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id: 'main', version: 1, extends: streets, icons: [...streets.icons, '${source}'], glyphs: ${fixtureGlyphsSource}});\n`;
}

function runPreviewScript(
  html: string,
  href: string,
  options: {
    coreScene?: boolean;
    streetLights?: boolean;
    vegetationVisible?: boolean;
    sharedStatus?: boolean;
  } = {},
): {
  applyParentMapState(data: unknown): void;
  bearing(): number;
  businessAreaVisibility(): string;
  setBusinessAreaVisibility(value: string): void;
  buildingVisibility(): string;
  center(): [number, number];
  coreCalls(): string[];
  currentUrl(): string;
  emit(eventName: string): void;
  emitServerEvent(eventName: string, data?: unknown): void;
  emitParentStatus(status: unknown): void;
  eventSources(): number;
  mapOptions: Record<string, unknown> | undefined;
  pitch(): number;
  reloads(): number;
  threeDimensionalLabel(): string | undefined;
  treeLabel(): string | undefined;
  treeVisibility(): string;
  toggleThreeDimensional(): void;
  toggleTrees(): void;
  zoom(): number;
} {
  const script = /<script type="module">\s*([\s\S]*?)<\/script>\s*<\/body>/
    .exec(html)?.[1]
    ?.replace(/^[ \t]*import [^\n]+;[ \t]*$/gm, '')
    .replace(/^[ \t]*await loadTileflowStyleFonts\([^\n]+;[ \t]*$/gm, '')
    .replace(/^[ \t]*registerTileflowPmtilesProtocol\([^\n]+;[ \t]*$/gm, '')
    .replace(/^[ \t]*registerTileflowContourProtocol\([^\n]+;[ \t]*$/gm, '')
    .replace(/^[ \t]*registerTileflowPathGroundProtocol\([^\n]+;[ \t]*$/gm, '');
  assert.ok(script, 'expected an inline preview script');

  let mapOptions: Record<string, unknown> | undefined;
  let businessAreaVisibility = 'visible';
  let buildingVisibility = 'none';
  let treeVisibility = 'visible';
  const coreCalls: string[] = [];
  const coreLayer = (name: string) => {
    coreCalls.push(`${name}:create`);
    return {
      dispose: () => void coreCalls.push(`${name}:dispose`),
      hide: async () => void coreCalls.push(`${name}:hide`),
      show: async () => void coreCalls.push(`${name}:show`),
    };
  };
  const coreMetadata = options.coreScene
    ? {
        'tileflow:buildings': {version: 1},
        ...(options.streetLights !== false ? {'tileflow:street-lights': {version: 1}} : {}),
        'tileflow:vegetation': {version: 1, flatLayers: ['tileflow-vegetation-trees']},
      }
    : {};
  let currentPitch = 0;
  let reloadCount = 0;
  let eventSources = 0;
  let parentStatusReceiver: ((status: unknown) => void) | undefined;
  let styleReady = false;
  let activeCamera:
    {bearing: number; center: [number, number]; pitch: number; zoom: number} | undefined;
  const controlButtons: FakeElement[] = [];
  const eventSourceListeners = new Map<string, Set<(event: {data: string}) => void>>();
  let currentUrl = href;
  const listeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<(event: any) => void>>();
  const elements = new Map<string, FakeElement>();

  class FakeElement {
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, () => void>();
    readonly style = {display: ''};
    className = '';
    textContent = '';
    title = '';
    type = '';

    addEventListener(name: string, listener: () => void): void {
      this.listeners.set(name, listener);
    }

    appendChild(): void {}

    click(): void {
      this.listeners.get('click')?.();
    }

    remove(): void {}

    removeEventListener(name: string): void {
      this.listeners.delete(name);
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
  }

  const styleLayers: Array<{
    id: string;
    metadata: Record<string, string>;
    sourceLayer?: string;
    type: string;
  }> = [
    {id: 'tileflow-landuse-business-area', metadata: {}, sourceLayer: 'landuse', type: 'fill'},
    {
      id: 'tileflow-buildings-3d',
      metadata: {'tileflow:3d-toggle': 'building'},
      type: 'fill-extrusion',
    },
    {id: 'tileflow-vegetation-trees', metadata: {}, type: 'circle'},
  ];

  class FakeMap {
    readonly camera: {bearing: number; center: [number, number]; pitch: number; zoom: number};

    constructor(options: Record<string, unknown>) {
      mapOptions = options;
      currentPitch = Number(options.pitch ?? 0);
      this.camera = {
        bearing: Number(options.bearing ?? 0),
        center: (options.center as [number, number] | undefined) ?? [0, 0],
        pitch: Number(options.pitch ?? 0),
        zoom: Number(options.zoom ?? 0),
      };
      activeCamera = this.camera;
    }

    addControl(control: {onAdd?(map: FakeMap): FakeElement}): void {
      control.onAdd?.(this);
    }

    easeTo(options: {pitch?: number}): void {
      if (options.pitch !== undefined) {
        this.camera.pitch = options.pitch;
        currentPitch = options.pitch;
      }
      for (const listener of listeners.get('pitch') ?? []) listener();
      for (const listener of listeners.get('moveend') ?? []) listener();
    }

    jumpTo(options: {
      bearing?: number;
      center?: [number, number];
      pitch?: number;
      zoom?: number;
    }): void {
      if (options.bearing !== undefined) this.camera.bearing = options.bearing;
      if (options.center !== undefined) this.camera.center = options.center;
      if (options.pitch !== undefined) {
        this.camera.pitch = options.pitch;
        currentPitch = options.pitch;
      }
      if (options.zoom !== undefined) this.camera.zoom = options.zoom;
      for (const listener of listeners.get('zoomend') ?? []) listener();
      for (const listener of listeners.get('moveend') ?? []) listener();
    }

    getBearing(): number {
      return this.camera.bearing;
    }

    fire(eventName: string): void {
      for (const listener of listeners.get(eventName) ?? []) listener();
    }

    getCenter(): {lat: number; lng: number} {
      return {lat: this.camera.center[1], lng: this.camera.center[0]};
    }

    getPitch(): number {
      return this.camera.pitch;
    }

    // As in MapLibre, a style that has not loaded yet has no definition.
    getStyle():
      | {
          layers: Array<{
            id: string;
            metadata: Record<string, string>;
            'source-layer'?: string;
            type: string;
          }>;
          metadata: Record<string, unknown>;
        }
      | undefined {
      if (!styleReady) return undefined;
      return {
        layers: styleLayers.map(({sourceLayer, ...layer}) => ({
          ...layer,
          ...(sourceLayer ? {'source-layer': sourceLayer} : {}),
        })),
        metadata: {
          'tileflow:compiler': 'tileflow-semantic',
          ...coreMetadata,
          'tileflow:vegetation-display': {
            version: 1,
            mode: options.coreScene ? '3d' : 'flat',
            visible: options.vegetationVisible ?? true,
            fallback: 'none',
            flatLayers: [{id: 'tileflow-vegetation-trees', visible: true}],
          },
        },
      };
    }

    getLayoutProperty(layerId: string, property: string): string | undefined {
      if (property !== 'visibility') return undefined;
      if (layerId === 'tileflow-landuse-business-area') return businessAreaVisibility;
      if (layerId === 'tileflow-buildings-3d') return buildingVisibility;
      if (layerId === 'tileflow-vegetation-trees') return treeVisibility;
      return undefined;
    }

    getZoom(): number {
      return this.camera.zoom;
    }

    isStyleLoaded(): boolean {
      return styleReady;
    }

    getLayersOrder(): string[] {
      return styleReady ? styleLayers.map((layer) => layer.id) : [];
    }

    getLayer(id: string): (typeof styleLayers)[number] | undefined {
      return styleReady ? styleLayers.find((layer) => layer.id === id) : undefined;
    }

    getProjection(): {type: string} {
      return {type: 'mercator'};
    }

    on(eventName: string, listener: () => void): void {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    }

    off(eventName: string, listener: () => void): void {
      listeners.get(eventName)?.delete(listener);
    }

    setLayoutProperty(layerId: string, property: string, value: string): void {
      if (layerId === 'tileflow-landuse-business-area' && property === 'visibility') {
        businessAreaVisibility = value;
      }
      if (layerId === 'tileflow-buildings-3d' && property === 'visibility') {
        buildingVisibility = value;
      }
      if (layerId === 'tileflow-vegetation-trees' && property === 'visibility') {
        treeVisibility = value;
      }
    }

    triggerRepaint(): void {}
  }

  class FakeEventSource {
    constructor() {
      eventSources++;
    }
    addEventListener(name: string, listener: (event: {data: string}) => void): void {
      const eventListeners = eventSourceListeners.get(name) ?? new Set();
      eventListeners.add(listener);
      eventSourceListeners.set(name, eventListeners);
    }
  }

  const parentWindow = options.sharedStatus
    ? {
        __tileflowInspectorHost: {
          subscribePreviewStatus(_child: unknown, receive: (status: unknown) => void) {
            parentStatusReceiver = receive;
            return () => {
              parentStatusReceiver = undefined;
            };
          },
        },
      }
    : {};
  const sandbox: Record<string, any> = {
    EventSource: FakeEventSource,
    // Browser imports are supplied by the harness; the observer itself has bounded-log tests.
    createPreviewObserver: () => ({
      attach(map: unknown) {
        assert.ok(map instanceof FakeMap);
      },
    }),
    attachTileflowLabelPlacement: (map: unknown) => {
      assert.ok(map instanceof FakeMap);
      return () => {};
    },
    attachTileflowHorizonQueries: (map: unknown) => {
      assert.ok(map instanceof FakeMap);
      return () => {};
    },
    // Core's 3D scene, faked as the renderers it mounts for the style's declarations.
    createTileflowMap3D: ({viewMode, vegetation}: {viewMode: string; vegetation: boolean}) => {
      let shown = viewMode === '3d';
      let buildings: ReturnType<typeof coreLayer> | undefined;
      let lights: ReturnType<typeof coreLayer> | undefined;
      const mountBuildings = () => {
        if (shown && options.coreScene) buildings ??= coreLayer('buildings');
      };
      mountBuildings();
      if (options.coreScene) coreCalls.push('trees:create');
      let trees: boolean | undefined;
      const setVegetation = (value: boolean) => {
        if (trees !== value) {
          trees = value;
          if (options.coreScene) coreCalls.push(`trees:${value ? 'show' : 'hide'}`);
        }
        treeVisibility = value && !options.coreScene ? 'visible' : 'none';
      };
      const mountLights = () => {
        if (shown && options.coreScene && options.streetLights !== false)
          lights ??= coreLayer('lights');
      };
      setVegetation(vegetation);
      mountLights();
      return {
        get buildings() {
          return buildings;
        },
        setVegetation,
        async show() {
          shown = true;
          mountBuildings();
          mountLights();
          await buildings?.show();
        },
        async hide() {
          shown = false;
          lights?.dispose();
          lights = undefined;
          await buildings?.hide();
        },
        dispose() {
          buildings?.dispose();
          buildings = undefined;
        },
      };
    },
    attachTileflowNauticalLights: () => () => {},
    attachTileflowNotices: () => () => {},
    attachTileflowAtmosphere: () => () => {},
    tileflowMaxPitch: 85,
    tileflowCanvasContextAttributes: (attributes: object) => ({antialias: true, ...attributes}),
    readTileflowSunPreset: () => undefined,
    resolveTileflowSun: (preset: unknown) => preset,
    tileflowDefaultSunPreset: {},
    URL,
    URLSearchParams,
    addEventListener(name: string, listener: (event: any) => void) {
      const eventListeners = windowListeners.get(name) ?? new Set();
      eventListeners.add(listener);
      windowListeners.set(name, eventListeners);
    },
    document: {
      documentElement: {dataset: {}},
      createElement(tagName: string) {
        const element = new FakeElement();
        if (tagName === 'button') controlButtons.push(element);
        return element;
      },
      getElementById(id: string) {
        const element = new FakeElement();
        elements.set(id, element);
        return element;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, nextUrl: string) {
        currentUrl = nextUrl;
      },
      state: null,
    },
    location: {
      href,
      origin: new URL(href).origin,
      reload() {
        reloadCount += 1;
      },
    },
    maplibregl: {Map: FakeMap, NavigationControl: class {}, setWorkerUrl() {}},
    parent: parentWindow,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  runInNewContext(script, sandbox);

  return {
    emitParentStatus: (status) => parentStatusReceiver?.(status),
    eventSources: () => eventSources,
    applyParentMapState(data) {
      const event = {data, origin: new URL(href).origin, source: parentWindow};
      for (const listener of windowListeners.get('message') ?? []) listener(event);
    },
    bearing: () => activeCamera?.bearing ?? 0,
    businessAreaVisibility: () => businessAreaVisibility,
    setBusinessAreaVisibility: (value) => {
      businessAreaVisibility = value;
    },
    buildingVisibility: () => buildingVisibility,
    center: () => activeCamera?.center ?? [0, 0],
    coreCalls: () => [...coreCalls],
    currentUrl: () => currentUrl,
    emit(eventName) {
      if (eventName === 'load' || eventName === 'styledata') styleReady = true;
      for (const listener of listeners.get(eventName) ?? []) listener();
    },
    emitServerEvent(eventName, data) {
      const event = {data: JSON.stringify(data)};
      for (const listener of eventSourceListeners.get(eventName) ?? []) listener(event);
    },
    mapOptions,
    pitch: () => currentPitch,
    reloads: () => reloadCount,
    threeDimensionalLabel: () =>
      controlButtons.find((button) => button.className === 'tileflow-3d-toggle')?.textContent,
    treeLabel: () =>
      controlButtons.find((button) => button.className === 'tileflow-tree-toggle')?.textContent,
    treeVisibility: () => treeVisibility,
    toggleThreeDimensional: () =>
      controlButtons.find((button) => button.className === 'tileflow-3d-toggle')?.click(),
    toggleTrees: () =>
      controlButtons.find((button) => button.className === 'tileflow-tree-toggle')?.click(),
    zoom: () => activeCamera?.zoom ?? 0,
  };
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
