import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectTileflowMapBuildLineage,
  createTileflowMapBuildManifest,
  hashTileflowAssetSet,
  hashTileflowAssetSetIdentities,
  hashTileflowMapRevision,
  tileflowMapBuildManifestSchemaVersion,
} from '../src/map-build-manifest';
import {defineMap, defineRootMap} from '../src/maps';
import {defineModuleEffects, patchModuleLayer} from '../src/recipe';
import type {MapLibreStyle} from '../src/types';

const noAssets = {fonts: [], icons: []} as const;

test('verified per-file identities reproduce the exact byte-backed asset-set hash', async () => {
  const assets = [
    {
      contentType: 'image/png',
      fileName: 'icons/streets/sprite.png',
      source: new Uint8Array([0, 1, 2, 255]),
    },
    {
      contentType: 'application/json',
      fileName: 'icons/streets/sprite.json',
      source: '{}',
    },
  ] as const;
  const identities = [
    {
      byteLength: 4,
      contentType: 'image/png',
      fileName: 'icons/streets/sprite.png',
      sha256: '3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56',
    },
    {
      byteLength: 2,
      contentType: 'application/json',
      fileName: 'icons/streets/sprite.json',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    },
  ] as const;

  assert.equal(
    await hashTileflowAssetSet(assets),
    await hashTileflowAssetSetIdentities(identities),
  );
  assert.equal(
    await hashTileflowAssetSetIdentities(identities),
    '1b157857752c75d36fe7f3d2fad3a94f03f69659cb5e38e3f639a4a49f1990a2',
  );
  await assert.rejects(
    hashTileflowAssetSetIdentities([...identities, identities[0]]),
    /Duplicate Tileflow map asset/u,
  );
});

test('locks the version-1 domain-separated canonical map revision vector', async () => {
  const map = defineRootMap({
    id: 'fixture',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    glyphs: {
      fontStacks: ['Noto Sans Regular'],
      kind: 'url',
      url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    },
    theme: {colors: {land: '#ffffff'}},
  });

  assert.equal(
    await hashTileflowMapRevision(map, noAssets),
    'fa2df53da48dc9d15bcfb919e9339ba04dd25b38de15039a0f67ca691446b338',
  );
});

function root(id: string, land: string, version = 1) {
  return defineRootMap({
    id,
    version,
    root: {compiler: 'streets', compilerVersion: 1},
    glyphs: {
      fontStacks: ['Noto Sans Regular'],
      kind: 'url',
      url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    },
    theme: {colors: {land}},
  });
}

function style(color: string, tileUrl = 'https://world.example.test/current/{z}/{x}/{y}') {
  return {
    glyphs: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    layers: [{id: 'background', paint: {'background-color': color}, type: 'background'}],
    sources: {tileflow: {tiles: [tileUrl], type: 'vector'}},
    version: 8,
  } as MapLibreStyle;
}

test('map revision follows effective inheritance while masked ancestry stays out of the hash', async () => {
  const red = root('root-red', '#ff0000');
  const blue = root('root-blue', '#0000ff');
  const inheritedRed = defineMap({id: 'leaf', version: 3, extends: red});
  const inheritedBlue = defineMap({id: 'leaf', version: 3, extends: blue});
  const maskedRed = defineMap({
    id: 'leaf',
    version: 3,
    extends: red,
    theme: {colors: {land: '#111111'}},
  });
  const maskedBlue = defineMap({
    id: 'leaf',
    version: 3,
    extends: blue,
    theme: {colors: {land: '#111111'}},
  });

  assert.notEqual(
    await hashTileflowMapRevision(inheritedRed, noAssets),
    await hashTileflowMapRevision(inheritedBlue, noAssets),
  );
  assert.equal(
    await hashTileflowMapRevision(maskedRed, noAssets),
    await hashTileflowMapRevision(maskedBlue, noAssets),
  );
  assert.equal(
    await hashTileflowMapRevision(
      defineMap({
        id: 'leaf',
        version: 3,
        extends: root('same-root', '#ff0000', 1),
        theme: {colors: {land: '#111111'}},
      }),
      noAssets,
    ),
    await hashTileflowMapRevision(
      defineMap({
        id: 'leaf',
        version: 3,
        extends: root('same-root', '#0000ff', 99),
        theme: {colors: {land: '#111111'}},
      }),
      noAssets,
    ),
  );
  assert.equal(
    await hashTileflowMapRevision(maskedRed, noAssets),
    await hashTileflowMapRevision(
      defineMap({id: 'leaf', version: 4, extends: red, theme: {colors: {land: '#111111'}}}),
      noAssets,
    ),
  );
  assert.deepEqual(
    collectTileflowMapBuildLineage(
      defineMap({id: 'same-id', version: 2, extends: root('same-id', '#ffffff', 1)}),
    ),
    [
      {id: 'same-id', mapVersion: 2},
      {id: 'same-id', mapVersion: 1},
    ],
  );
});

test('map revision excludes editorial identity, default view, scenes and delivery policy', async () => {
  const design = root('shared-root', '#ffffff');
  const first = defineMap({
    id: 'first-map',
    name: 'First editorial name',
    version: 1,
    extends: design,
    delivery: {hosted: {allowedOrigins: ['https://first.example.test']}},
    scenes: {
      proof: {
        camera: {type: 'center', center: [0, 0], zoom: 2},
        viewport: {height: 640, width: 640},
      },
    },
    view: {center: [0, 0], zoom: 2},
  });
  const second = defineMap({
    id: 'second-map',
    name: 'Second editorial name',
    version: 99,
    extends: design,
    delivery: {hosted: {allowedOrigins: ['https://second.example.test']}},
    scenes: {
      audit: {
        camera: {type: 'center', center: [40, 20], zoom: 8},
        viewport: {height: 720, width: 1_280},
      },
    },
    view: {bearing: 30, center: [40, 20], pitch: 45, zoom: 8},
  });

  assert.equal(
    await hashTileflowMapRevision(first, noAssets),
    await hashTileflowMapRevision(second, noAssets),
  );
});

test('source identities change map revision independently from compiled outputs', async () => {
  const map = defineMap({id: 'leaf', version: 1, extends: root('root', '#ffffff')});
  const firstSources = {
    fonts: [],
    icons: [{format: 'svg', id: 'cafe', kind: 'icon', sha256: 'a'.repeat(64)}],
  } as const;
  const secondSources = {
    fonts: [],
    icons: [{format: 'svg', id: 'cafe', kind: 'icon', sha256: 'b'.repeat(64)}],
  } as const;

  assert.notEqual(
    await hashTileflowMapRevision(map, firstSources),
    await hashTileflowMapRevision(map, secondSources),
  );
});

test('compiler-private effective map contributions participate and remain owner-atomic', async () => {
  const withEffect = (color: string) =>
    defineRootMap({
      id: 'effect-root',
      version: 1,
      root: {compiler: 'streets', compilerVersion: 1},
      modules: {land: {type: 'land'}},
      ...defineModuleEffects([
        patchModuleLayer('land', 'land.background', {
          paint: {'background-color': color},
        }),
      ]),
    });
  const red = withEffect('#ff0000');
  const blue = withEffect('#0000ff');

  assert.notEqual(
    await hashTileflowMapRevision(red, noAssets),
    await hashTileflowMapRevision(blue, noAssets),
  );
  assert.equal(
    await hashTileflowMapRevision(
      defineMap({id: 'leaf', version: 1, extends: red, modules: {land: {type: 'land'}}}),
      noAssets,
    ),
    await hashTileflowMapRevision(
      defineMap({id: 'leaf', version: 1, extends: blue, modules: {land: {type: 'land'}}}),
      noAssets,
    ),
  );
});

test('build manifest keeps lineage, Style and output assets on separate identity axes', async () => {
  const firstRoot = root('first-root', '#ffffff');
  const secondRoot = root('second-root', '#ffffff', 7);
  const firstMap = defineMap({id: 'leaf', version: 1, extends: firstRoot});
  const secondMap = defineMap({id: 'leaf', version: 1, extends: secondRoot});
  const first = await createTileflowMapBuildManifest({
    leaf: {
      assets: [{contentType: 'image/png', fileName: 'icons/leaf/sprite.png', source: 'one'}],
      lineage: [
        {id: 'leaf', mapVersion: 1},
        {id: 'first-root', mapVersion: 1},
      ],
      map: firstMap,
      sourceAssets: noAssets,
      style: style('#ffffff', 'https://world.example.test/release-one/{z}/{x}/{y}'),
    },
  });
  const movedWorld = await createTileflowMapBuildManifest({
    leaf: {
      assets: [{contentType: 'image/png', fileName: 'icons/leaf/sprite.png', source: 'one'}],
      lineage: [
        {id: 'leaf', mapVersion: 1},
        {id: 'second-root', mapVersion: 7},
      ],
      map: secondMap,
      sourceAssets: noAssets,
      style: style('#ffffff', 'https://world.example.test/release-two/{z}/{x}/{y}'),
    },
  });
  const changedOutput = await createTileflowMapBuildManifest({
    leaf: {
      assets: [{contentType: 'image/png', fileName: 'icons/leaf/sprite.png', source: 'two'}],
      lineage: [
        {id: 'leaf', mapVersion: 1},
        {id: 'first-root', mapVersion: 1},
      ],
      map: firstMap,
      sourceAssets: noAssets,
      style: style('#000000', 'https://world.example.test/release-one/{z}/{x}/{y}'),
    },
  });

  assert.equal(first.schemaVersion, tileflowMapBuildManifestSchemaVersion);
  assert.deepEqual(first.maps.leaf?.lineage, [
    {id: 'leaf', mapVersion: 1},
    {id: 'first-root', mapVersion: 1},
  ]);
  assert.deepEqual(movedWorld.maps.leaf?.lineage, [
    {id: 'leaf', mapVersion: 1},
    {id: 'second-root', mapVersion: 7},
  ]);
  assert.equal(first.maps.leaf?.mapRevisionSha256, movedWorld.maps.leaf?.mapRevisionSha256);
  assert.notEqual(first.maps.leaf?.styleSha256, movedWorld.maps.leaf?.styleSha256);
  assert.equal(first.maps.leaf?.mapRevisionSha256, changedOutput.maps.leaf?.mapRevisionSha256);
  assert.notEqual(first.maps.leaf?.styleSha256, changedOutput.maps.leaf?.styleSha256);
  assert.notEqual(first.maps.leaf?.assetSetSha256, changedOutput.maps.leaf?.assetSetSha256);
  assert.equal('coreVersion' in first.maps.leaf!, false);
  assert.deepEqual(first.maps.leaf?.recipe, {compiler: 'streets', compilerVersion: 1});
});

test('package and lockfile provenance changes without changing map revision', async () => {
  const map = defineMap({id: 'leaf', version: 1, extends: root('root', '#ffffff')});
  const build = (coreVersion: string, lockfileSha256: string) =>
    createTileflowMapBuildManifest(
      {
        leaf: {
          assets: [],
          lineage: [
            {id: 'leaf', mapVersion: 1},
            {id: 'root', mapVersion: 1},
          ],
          map,
          sourceAssets: noAssets,
          style: style('#ffffff'),
        },
      },
      {
        provenance: {
          lockfile: {format: 'pnpm', sha256: lockfileSha256},
          packages: {'@tileflow/core': coreVersion},
          schemaVersion: 1,
        },
      },
    );
  const first = await build('1.0.0', 'a'.repeat(64));
  const second = await build('2.0.0', 'b'.repeat(64));

  assert.equal(first.maps.leaf?.mapRevisionSha256, second.maps.leaf?.mapRevisionSha256);
  assert.notDeepEqual(first.provenance, second.provenance);
});

test('build manifest infers only effective final Style data requirements outside map revision', async () => {
  const map = defineMap({id: 'leaf', version: 1, extends: root('root', '#ffffff')});
  const build = async (includePoi: boolean) =>
    createTileflowMapBuildManifest({
      leaf: {
        assets: [],
        lineage: [
          {id: 'leaf', mapVersion: 1},
          {id: 'root', mapVersion: 1},
        ],
        map,
        sourceAssets: noAssets,
        style: {
          layers: [
            {
              filter: ['==', ['get', 'class'], 'commercial'],
              id: 'building',
              source: 'tileflow',
              'source-layer': 'building',
              type: 'fill',
            },
            ...(includePoi
              ? [
                  {
                    filter: ['has', 'name'],
                    id: 'poi',
                    layout: {'text-field': ['get', 'name']},
                    source: 'tileflow',
                    'source-layer': 'poi',
                    type: 'symbol',
                  } as const,
                ]
              : []),
          ],
          sources: {tileflow: {tiles: ['https://world.example.test/{z}/{x}/{y}'], type: 'vector'}},
          version: 8,
        } as MapLibreStyle,
      },
    });
  const withoutPoi = await build(false);
  const withPoi = await build(true);

  assert.deepEqual(withoutPoi.maps.leaf?.dataRequirements.sourceLayers, [
    {fields: [{name: 'class'}], id: 'building'},
  ]);
  assert.deepEqual(withPoi.maps.leaf?.dataRequirements.sourceLayers, [
    {fields: [{name: 'class'}], id: 'building'},
    {fields: [{name: 'name'}], id: 'poi'},
  ]);
  assert.equal(withoutPoi.maps.leaf?.mapRevisionSha256, withPoi.maps.leaf?.mapRevisionSha256);
  assert.notEqual(withoutPoi.maps.leaf?.styleSha256, withPoi.maps.leaf?.styleSha256);
});
