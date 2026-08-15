import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {defineTileflow, patchLayer, roads, streets} from '@tileflow/core';
import {
  createTileflowBuildArtifacts,
  createTileflowStyle,
  createTileflowStyles,
  TileflowStyleValidationError,
  validateTileflowStyle,
  writeTileflowBuildArtifacts,
} from '../src/index';

test('direct style creation reports a stable layer/property diagnostic', () => {
  const project = invalidProject('madrid');

  assert.throws(
    () => createTileflowStyle(project, 'madrid'),
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

test('multi-map style construction aggregates, sorts, and bounds semantic issues', () => {
  const project = defineTileflow({
    maps: Object.fromEntries(
      Array.from({length: 40}, (_, index) => {
        const map = `map-${String(39 - index).padStart(2, '0')}`;
        return [map, invalidProject(map).maps[map]!];
      }),
    ),
  });

  assert.throws(
    () => createTileflowStyles(project),
    (error: unknown) => {
      assert.ok(error instanceof TileflowStyleValidationError);
      assert.equal(error.issues.length, 32);
      assert.equal(error.issues[0]?.map, 'map-00');
      assert.equal(error.issues.at(-1)?.map, 'map-31');
      assert.deepEqual(
        [...error.issues].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        ),
        error.issues,
      );
      return true;
    },
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

test('artifact construction shares validation and aggregates invalid config maps', async (t) => {
  const cwd = await createFixture(t, 'tileflow-dev-invalid-style-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `export default {
  maps: {
    zeta: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]},
    alpha: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]}
  }
};\n`,
  );

  await assert.rejects(
    () => createTileflowBuildArtifacts({cwd}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowStyleValidationError);
      assert.deepEqual(
        error.issues.map((issue) => issue.path),
        [
          'maps.alpha.style.layers.streets-background.paint.background-color',
          'maps.zeta.style.layers.streets-background.paint.background-color',
        ],
      );
      return true;
    },
  );
});

test('direct Streets roads validate and written artifacts equal in-memory styles', async (t) => {
  const direct = createTileflowStyle(
    defineTileflow({
      maps: {
        madrid: {
          basemap: streets(),
          modules: {
            roads: roads({
              detail: 'all',
              extras: {paths: true},
              hierarchy: 'clear',
              outline: 'strong',
              weight: 'regular',
            }),
          },
        },
      },
    }),
    'madrid',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(direct)), direct);

  const cwd = await createFixture(t, 'tileflow-dev-valid-style-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `export default {
  maps: {
    madrid: {
      basemap: {type: 'streets', basemapVersion: 2, variant: 'light'},
      modules: {roads: {
        type: 'roads',
        detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
        extras: {paths: true}
      }}
    }
  }
};\n`,
  );
  const artifacts = await createTileflowBuildArtifacts({cwd});
  const written = await writeTileflowBuildArtifacts({cwd, outDir: 'dist/tileflow'});
  const diskStyle = JSON.parse(
    await readFile(join(cwd, 'dist/tileflow/styles/madrid.json'), 'utf8'),
  );

  assert.deepEqual(artifacts.styles.madrid, written.styles.madrid);
  assert.deepEqual(diskStyle, artifacts.styles.madrid);
});

function invalidProject(map: string) {
  return defineTileflow({
    maps: {
      [map]: {
        basemap: streets(),
        overrides: [patchLayer('streets-background', {paint: {'background-color': 42}})],
      },
    },
  });
}

async function createFixture(t: TestContext, prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}
