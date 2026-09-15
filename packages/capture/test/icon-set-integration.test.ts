import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {NormalizedTileflowCaptureScene} from '@tileflow/core';
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';
import {
  createTileflowIconSetProject,
  tileflowIconSetFixtureGlyphs,
} from '../../../test-support/icon-set-project';
import {selectTileflowCaptureSceneNames} from '../src/capture';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {captureStandaloneTileflowScene, tileflowSyntheticAssetOrigin} from '../src/standalone';

const sceneName = 'locked-icons';
const scene: NormalizedTileflowCaptureScene = {
  camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
  map: 'main',
  target: {kind: 'map'},
  theme: 'light',
  viewport: {width: 320, height: 240, dpr: 1},
};

async function captureFixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-capture-icon-sets-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const project = await createTileflowIconSetProject(cwd);
  // Capture needs a committed scene on the single exported map.
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, disable, iconSet} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets,icons:[iconSet('@acme/brand'),iconSet('@acme/transport'),'./icons'],modules:{poi:{type:'poi',icons:false},roads:disable()},glyphs:${tileflowIconSetFixtureGlyphs},scenes:{${JSON.stringify(sceneName)}:{theme:'light',camera:{type:'center',center:[0,0],zoom:1},viewport:{width:320,height:240}}}});\n`,
  );
  return {cwd, project};
}

/** Capture reads the same prepared artifacts as every other consumer, under its synthetic origin. */
async function captureArtifactsFor(cwd: string, cacheRoot: string) {
  return createTileflowBuildArtifacts({
    assetBaseUrl: tileflowSyntheticAssetOrigin,
    cwd,
    icons: {cacheRoot, offline: true},
  });
}

test('Capture prepares the effective composed sprite from exact locked pins', async (t) => {
  const {cwd, project} = await captureFixture(t);
  const artifacts = await captureArtifactsFor(cwd, project.cacheRoot);
  t.after(async () => artifacts.dispose?.());

  const entry = artifacts.buildManifest.maps.main!;
  assert.equal(entry.mapRevisionSchemaVersion, 2);
  assert.deepEqual(
    entry.sourceAssets.iconComposition?.contributors.map((contributor) =>
      contributor.kind === 'icon-set' ? contributor.reference : contributor.kind,
    ),
    ['@acme/brand', '@acme/transport', 'local'],
  );
  assert.deepEqual(
    artifacts.assets
      .filter((asset) => asset.fileName.startsWith('icons/main/'))
      .map((asset) => asset.fileName),
    [
      'icons/main/sprite.json',
      'icons/main/sprite.png',
      'icons/main/sprite@2x.json',
      'icons/main/sprite@2x.png',
    ],
  );
  const sprite = (artifacts.styles.main!.light as {sprite?: string}).sprite;
  assert.equal(sprite, `${tileflowSyntheticAssetOrigin}/icons/main/sprite`);
  assert.deepEqual(
    Object.keys(
      JSON.parse(
        String(
          artifacts.assets.find((asset) => asset.fileName === 'icons/main/sprite.json')?.source,
        ),
      ) as Record<string, unknown>,
    ).sort(),
    ['bus', 'hospital', 'shop'],
  );
  assert.deepEqual(selectTileflowCaptureSceneNames(artifacts, [sceneName]), [sceneName]);
});

test(
  'Capture renders the composed sprite as one effective atlas in a real browser',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async (t) => {
    const {cwd, project} = await captureFixture(t);
    const artifacts = await captureArtifactsFor(cwd, project.cacheRoot);
    t.after(async () => artifacts.dispose?.());
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());

    // Render only the composed atlas, so the proof needs no remote tiles or glyphs.
    const capture = await captureStandaloneTileflowScene({
      assets: artifacts.assets,
      browser,
      scene,
      style: {
        version: 8,
        name: 'locked-icons',
        sprite: `${tileflowSyntheticAssetOrigin}/icons/main/sprite`,
        sources: {
          pins: {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: ['bus', 'hospital', 'shop'].map((icon, index) => ({
                type: 'Feature',
                geometry: {type: 'Point', coordinates: [index * 0.5 - 0.5, 0]},
                properties: {icon},
              })),
            },
          },
        },
        layers: [
          {id: 'ground', type: 'background', paint: {'background-color': '#ffffff'}},
          {
            id: 'pins',
            type: 'symbol',
            source: 'pins',
            layout: {'icon-image': ['get', 'icon'], 'icon-allow-overlap': true},
          },
        ],
      } as never,
    });

    assert.deepEqual([...capture.png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(capture.networkDependent, false);
    assert.deepEqual(capture.warnings, []);
  },
);
