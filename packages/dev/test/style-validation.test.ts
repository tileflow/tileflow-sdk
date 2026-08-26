import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {defineRootMap, roads} from '@tileflow/core';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  assertValidTileflowStyle,
  createTileflowBuildArtifacts,
  createTileflowStyle,
  TileflowStyleValidationError,
  TileflowValidationError,
  validateTileflowStyle,
  writeTileflowBuildArtifacts,
} from '../src/index';

const fixtureGlyphs = {
  kind: 'url',
  url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
} as const;

const streetsPreparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

test('direct style creation reports a stable layer/property diagnostic', () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'streets-background',
        type: 'background',
        paint: {'background-color': 42},
      },
    ],
  } as never;

  assert.throws(
    () => assertValidTileflowStyle(style, 'madrid'),
    (error: unknown) => {
      assert.ok(error instanceof TileflowStyleValidationError);
      assert.equal(error.code, 'STYLE_INVALID');
      assert.equal(error.phase, 'style-validation');
      assert.deepEqual(error.issues, [
        {
          map: 'madrid',
          message: 'color expected, number found',
          path: 'maps.madrid.style.layers.streets-background.paint.background-color',
        },
      ]);
      return true;
    },
  );
});

test('style validation sorts and bounds semantic issues', () => {
  const style = {
    version: 8,
    sources: {},
    layers: Array.from({length: 40}, (_, index) => ({
      id: `background-${String(39 - index).padStart(2, '0')}`,
      type: 'background',
      paint: {'background-color': 42},
    })),
  } as never;
  const issues = validateTileflowStyle(style, 'many');

  assert.equal(issues.length, 32);
  assert.deepEqual(
    [...issues].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    issues,
  );
  assert.ok(
    issues.every(
      (issue) =>
        issue.map === 'many' && issue.path.startsWith('maps.many.style.layers.background-'),
    ),
  );
});

test('semantic diagnostics sanitize programmatic map and layer identifiers', () => {
  const issues = validateTileflowStyle(
    {
      version: 8,
      sources: {},
      layers: [
        {
          id: '/Users/alice/.secret',
          type: 'background',
          paint: {'background-color': 42},
        },
      ],
    },
    '../private',
  );

  assert.deepEqual(issues, [
    {
      map: '-private',
      message: 'color expected, number found',
      path: 'maps.-private.style.layers.-Users-alice-secret.paint.background-color',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(issues), /\/Users|\.secret|\.\.\/private/);
});

test('artifact construction rejects removed physical overrides before writing', async (t) => {
  const cwd = await createFixture(t, 'tileflow-dev-removed-overrides-');
  await writeFile(
    join(cwd, 'tileflow.workspace.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'madrid',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  overrides: []
});\n`,
  );

  await assert.rejects(
    () => createTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd}),
    (error: unknown) =>
      error instanceof TileflowValidationError &&
      error.messages.some((message) => /unrecognized key "overrides"/iu.test(message.message)),
  );
});

test('direct Streets roads validate and written artifacts equal in-memory styles', async (t) => {
  const direct = createTileflowStyle(
    {
      maps: {
        madrid: defineRootMap({
          id: 'madrid',
          version: 1,
          root: {compiler: 'streets', compilerVersion: 1},
          glyphs: fixtureGlyphs,
          modules: {
            roads: roads({
              detail: 'all',
              extras: {paths: true},
              hierarchy: 'clear',
              outline: 'strong',
              weight: 'regular',
            }),
          },
        }),
      },
    },
    'madrid',
    {preparedAssets: streetsPreparedAssets},
  );
  assert.deepEqual(JSON.parse(JSON.stringify(direct)), direct);

  const cwd = await createFixture(t, 'tileflow-dev-valid-style-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
import {streetsIcons} from '@tileflow/maps';
export default defineRootMap({
  id: 'madrid',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {kind: 'url', url: 'https://fonts.example.test/{fontstack}/{range}.pbf', fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']},
  icons: [streetsIcons],
  modules: {roads: {
        type: 'roads',
        detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
        extras: {paths: true}
      }}
});\n`,
  );
  const artifacts = await createTileflowBuildArtifacts({cwd});
  const written = await writeTileflowBuildArtifacts({cwd, outDir: 'dist/tileflow'});
  const diskStyle = JSON.parse(
    await readFile(join(cwd, 'dist/tileflow/styles/madrid.json'), 'utf8'),
  );

  assert.deepEqual(artifacts.styles.madrid, written.styles.madrid);
  assert.deepEqual(diskStyle, artifacts.styles.madrid);
});

test('builds World and glyph selectors independently without repository state', async (t) => {
  const cwd = await createFixture(t, 'tileflow-dev-world-selection-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'madrid',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {
    kind: 'url',
    url: 'https://assets.example.test/base/exact/glyphs/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  icons: [],
  modules: {roads: {type: 'roads', enabled: false}, poi: {type: 'poi', enabled: false}}
});\n`,
  );
  const before = await readdir(cwd);
  const first = await createTileflowBuildArtifacts({
    apiBaseUrl: 'https://api-one.example.test',
    cwd,
  });
  const second = await createTileflowBuildArtifacts({
    apiBaseUrl: 'https://api-two.example.test',
    cwd,
  });
  const style = first.styles.madrid!;
  const source = style.sources.tileflow as Record<string, unknown>;

  assert.notDeepEqual(first, second);
  assert.deepEqual(await readdir(cwd), before);
  assert.equal(source.url, 'https://api-one.example.test/tiles/world/tiles.json');
  assert.equal(Object.hasOwn(source, 'tiles'), false);
  assert.equal(
    style.glyphs,
    'https://assets.example.test/base/exact/glyphs/{fontstack}/{range}.pbf',
  );
  assert.equal(style.sprite, undefined);
  assert.equal(first.assets.length, 0);
});

async function createFixture(t: TestContext, prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}
