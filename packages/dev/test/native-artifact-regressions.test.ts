import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {hostedTileset, type MapLibreStyle} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {TileflowNativeCompatibilityError} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowBuildArtifacts,
  disposeTileflowBuildArtifacts,
  writeTileflowBuildArtifacts,
} from '../src/artifacts';
import {assertTileflowNativeCompiledStyles} from '../src/native-artifacts';

const execFileAsync = promisify(execFile);
const tsxLoader = import.meta.resolve('tsx');

async function fixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-regression-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  return cwd;
}

test('preflights resolved HTTPS vector sources instead of rejecting non-empty authoring sources', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets});\n`,
  );
  const artifacts = await createTileflowBuildArtifacts({cwd});
  t.after(() => disposeTileflowBuildArtifacts(artifacts));
  const map = artifacts.project.maps.main!;
  const project = {
    ...artifacts.project,
    maps: {
      main: {
        ...map,
        sources: {
          external: hostedTileset({
            attribution: 'External source fixture',
            local: './external.pmtiles',
            tileset: 'external',
          }),
        },
      },
    },
  } satisfies TileflowBuildCatalog;
  const style: MapLibreStyle = {
    version: 8,
    name: 'External source fixture',
    sources: {
      external: {
        type: 'vector',
        tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [],
  };

  assert.doesNotThrow(() =>
    assertTileflowNativeCompiledStyles(project, {main: {light: style}}),
  );
});

test('prepares an authored external HTTPS vector source for native artifacts', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap,disable,openMapTiles,vectorTiles} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id:'main',version:1,extends:streets,
  projection:'mercator',
  data:vectorTiles({
    attribution:'External vector fixture',revision:'external-v1',schema:openMapTiles(),
    tiles:['https://tiles.example.test/{z}/{x}/{y}.pbf']
  }),
  modules:{
    aeroways:disable(),
    boundaries:disable(),
    roads:disable(),
    transit:disable()
  }
});\n`,
  );

  const artifacts = await createTileflowBuildArtifacts({cwd, renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(artifacts));
  for (const style of Object.values(artifacts.styles.main!)) {
    const source = style.sources.tileflow;
    assert.equal(source?.type, 'vector');
    assert.deepEqual(source?.tiles, ['https://tiles.example.test/{z}/{x}/{y}.pbf']);
  }
});

test('rejects an unresolved local archive before creating snapshots or changing output', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap,hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id:'main',version:1,extends:streets,
  sources:{team:hostedTileset({
    attribution:'Local archive fixture',local:'./missing.pmtiles',tileset:'team'
  })}
});\n`,
  );
  await mkdir(join(cwd, 'output'));
  await writeFile(join(cwd, 'output/sentinel.txt'), 'keep\n');

  await assert.rejects(
    writeTileflowBuildArtifacts({cwd, renderer: 'native', outDir: 'output'}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.ok(error.issues.some(({code}) => code === 'NATIVE_UNSUPPORTED_SOURCE'));
      return true;
    },
  );
  assert.equal(await readFile(join(cwd, 'output/sentinel.txt'), 'utf8'), 'keep\n');
  await assert.rejects(
    readdir(join(cwd, '.tileflow/cache/pmtiles-snapshots/v1')),
    (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'),
  );
});

test('runs the repository native catalog report through the real tsx loader', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const script = fileURLToPath(new URL('../../../scripts/native-catalog-report.ts', import.meta.url));
  const result = await execFileAsync(process.execPath, ['--import', tsxLoader, script], {
    cwd: root,
    timeout: 120_000,
  });
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout) as {
    rows: Array<{map: string; theme: string}>;
    schemaVersion: number;
  };
  assert.equal(report.schemaVersion, 1);
  assert.equal(new Set(report.rows.map(({map}) => map)).size, 10);
  assert.ok(report.rows.every(({map, theme}) => Boolean(map && theme)));
});
