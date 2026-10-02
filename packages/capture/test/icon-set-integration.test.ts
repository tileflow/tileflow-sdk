import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {PNG} from 'pngjs';
import type {NormalizedTileflowCaptureScene} from '@tileflow/core';
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';
import {
  createTileflowIconSetProject,
  tileflowIconSetFixtureGlyphs,
} from '../../../test-support/icon-set-project';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {selectTileflowCaptureSceneNames} from '../src/capture';
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

test(
  'Capture renders a generated SDF and fails when its required atlas is missing',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async (t) => {
    const {cwd, project} = await captureFixture(t);
    await writeFile(
      join(cwd, 'icons/shop.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="red" d="M6 6H18V18H6Z"/></svg>',
    );
    await writeFile(
      join(cwd, 'icons/tileflow.icons.json'),
      JSON.stringify({
        schemaVersion: 1,
        icons: {shop: {representation: 'sdf', defaults: {color: '#c43d35'}}},
      }),
    );
    const artifacts = await captureArtifactsFor(cwd, project.cacheRoot);
    t.after(async () => artifacts.dispose?.());
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());
    const style = {
      version: 8,
      sprite: `${tileflowSyntheticAssetOrigin}/icons/main/sprite`,
      sources: {
        point: {
          type: 'geojson',
          data: {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}},
        },
      },
      layers: [
        {
          id: 'shop',
          type: 'symbol',
          source: 'point',
          layout: {'icon-image': 'shop'},
          paint: {'icon-color': '#c43d35'},
        },
      ],
    };
    for (const dpr of [1, 2]) {
      const capture = await captureStandaloneTileflowScene({
        assets: artifacts.assets,
        browser,
        scene: {...scene, viewport: {...scene.viewport, dpr}},
        style: style as never,
      });
      const png = PNG.sync.read(Buffer.from(capture.png));
      const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
      assert.deepEqual([...png.data.subarray(offset, offset + 4)], [196, 61, 53, 255]);
      assert.deepEqual(capture.warnings, []);
      assert.equal(capture.networkDependent, false);
    }
    await assert.rejects(
      captureStandaloneTileflowScene({
        assets: artifacts.assets.filter(
          (asset) =>
            !asset.fileName.endsWith('sprite.png') && !asset.fileName.endsWith('sprite@2x.png'),
        ),
        browser,
        scene,
        style: style as never,
      }),
    );
  },
);

test(
  'Capture fits generated RGBA and SDF backgrounds around text at both densities',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
  async (t) => {
    const {cwd, project} = await captureFixture(t);
    const layout = {stretchX: [[9, 15]], stretchY: [[9, 15]], content: [7, 7, 17, 17]};
    for (const icon of ['price', 'tint'])
      await writeFile(
        join(cwd, 'icons', icon + '.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2" fill="#245fe5"/></svg>',
      );
    await writeFile(
      join(cwd, 'icons/tileflow.icons.json'),
      JSON.stringify({
        schemaVersion: 1,
        icons: {
          price: {representation: 'rgba', layout},
          tint: {representation: 'sdf', defaults: {color: '#245fe5'}, layout},
        },
      }),
    );
    const artifacts = await captureArtifactsFor(cwd, project.cacheRoot);
    t.after(async () => artifacts.dispose?.());
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());
    const dimensions = [];
    for (const dpr of [1, 2])
      for (const icon of ['price', 'tint']) {
        const cases = [];
        for (const text of ['$9', '$1,250 / night', 'Room 12\nAvailable']) {
          const capture = await captureStandaloneTileflowScene({
            assets: artifacts.assets,
            browser,
            scene: {...scene, viewport: {...scene.viewport, dpr}},
            style: {
              version: 8,
              sprite: `${tileflowSyntheticAssetOrigin}/icons/main/sprite`,
              sources: {
                point: {
                  type: 'geojson',
                  data: {
                    type: 'Feature',
                    geometry: {type: 'Point', coordinates: [0, 0]},
                    properties: {},
                  },
                },
              },
              layers: [
                {
                  id: 'price',
                  type: 'symbol',
                  source: 'point',
                  layout: {
                    'icon-image': icon,
                    'icon-text-fit': 'both',
                    'icon-text-fit-padding': [4, 4, 4, 4],
                    'text-field': text,
                    'text-font': ['Arial'],
                    'text-size': 16,
                  },
                  paint: {'icon-color': '#245fe5', 'text-color': '#00ff00'},
                },
              ],
            } as never,
          });
          assert.deepEqual(capture.warnings, []);
          assert.equal(capture.networkDependent, false);
          const png = PNG.sync.read(Buffer.from(capture.png));
          const bounds = (match: (r: number, g: number, b: number, a: number) => boolean) => {
            let left = png.width,
              right = -1,
              top = png.height,
              bottom = -1;
            for (let y = 0; y < png.height; y++)
              for (let x = 0; x < png.width; x++) {
                const i = (y * png.width + x) * 4;
                if (match(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!)) {
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                  top = Math.min(top, y);
                  bottom = Math.max(bottom, y);
                }
              }
            assert.ok(
              right > left && bottom > top,
              JSON.stringify({icon, text, dpr, left, right, top, bottom}),
            );
            return {
              left,
              right,
              top,
              bottom,
              width: (right - left + 1) / dpr,
              height: (bottom - top + 1) / dpr,
            };
          };
          const fill = bounds((r, g, b, a) => b > 200 && r < 80 && g < 130 && a > 200);
          const label = bounds((r, g, b, a) => g > 220 && r < 60 && b < 80 && a > 200);
          assert.ok(
            label.left > fill.left &&
              label.right < fill.right &&
              label.top > fill.top &&
              label.bottom < fill.bottom,
          );
          cases.push(fill);
        }
        assert.ok(cases[1]!.width > cases[0]!.width + 50, JSON.stringify(cases));
        assert.ok(cases[2]!.height > cases[0]!.height + 12, JSON.stringify(cases));
        dimensions.push(cases);
      }
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++) {
        assert.ok(Math.abs(dimensions[i]![j]!.width - dimensions[i + 2]![j]!.width) <= 2);
        assert.ok(Math.abs(dimensions[i]![j]!.height - dimensions[i + 2]![j]!.height) <= 2);
      }
  },
);
