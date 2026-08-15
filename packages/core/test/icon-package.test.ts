import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diffTileflowIconMappings,
  diffTileflowIconPackageManifests,
  hashTileflowIconPackageManifest,
  hashTileflowRenderedIconPixels,
  inspectTileflowIconReferences,
  resolveTileflowIconMapping,
  serializeCanonicalJson,
  serializeTileflowIconPackageManifest,
  sha256Hex,
  streets,
  tileflowHostedAlphaCompatibility,
  tileflowHostedIconIdSchema,
  tileflowIconPackageFileNames,
  tileflowIconPackageLabelSchema,
  tileflowIconPackageLimits,
  type TileflowIconPackageManifest,
  tileflowIconPackageManifestSchema,
} from '../src/index';

const manifest: TileflowIconPackageManifest = {
  files: [
    {
      byteLength: 100,
      contentType: 'application/json',
      name: 'sprite.json',
      sha256: '1'.repeat(64),
    },
    {
      byteLength: 200,
      contentType: 'image/png',
      name: 'sprite.png',
      sha256: '2'.repeat(64),
    },
    {
      byteLength: 100,
      contentType: 'application/json',
      name: 'sprite@2x.json',
      sha256: '3'.repeat(64),
    },
    {
      byteLength: 300,
      contentType: 'image/png',
      name: 'sprite@2x.png',
      sha256: '4'.repeat(64),
    },
  ],
  format: 'tileflow-icon-package-v1',
  iconNames: ['airport', 'cafe'],
  renderedIcons: [
    {name: 'airport', pixelSha256: {oneX: '5'.repeat(64), twoX: '6'.repeat(64)}},
    {name: 'cafe', pixelSha256: {oneX: '7'.repeat(64), twoX: '8'.repeat(64)}},
  ],
  sprites: {
    oneX: {height: 24, pixelRatio: 1, width: 48},
    twoX: {height: 48, pixelRatio: 2, width: 96},
  },
};

test('defines the exact four-file package protocol and alpha limits', () => {
  assert.deepEqual(tileflowIconPackageFileNames, [
    'sprite.json',
    'sprite.png',
    'sprite@2x.json',
    'sprite@2x.png',
  ]);
  assert.equal(tileflowIconPackageLimits.maxIconCount, 256);
  assert.equal(tileflowIconPackageLimits.decodeConcurrency, 4);
  assert.equal(tileflowIconPackageLimits.maxGeneratedPackageBytes, 8 * 1024 * 1024);
  assert.equal(tileflowHostedAlphaCompatibility.maxMapsPerDeploy, 1);
  assert.equal(tileflowHostedAlphaCompatibility.iconPackages.maxRetainedPerProject, 24);
});

test('serializes manifests canonically and hashes the canonical bytes', async () => {
  const serialized = serializeTileflowIconPackageManifest(manifest);

  assert.equal(serialized, serializeCanonicalJson(manifest));
  assert.equal(serialized.indexOf('"files"'), 1);
  assert.ok(serialized.indexOf('"format"') > serialized.indexOf('"files"'));
  assert.equal(await hashTileflowIconPackageManifest(manifest), await sha256Hex(serialized));
  assert.equal(
    await hashTileflowIconPackageManifest(manifest),
    'ed5d5710bf2d90f75a4f361e83bb8492497c695c7483a928ee0db852bde4f0c1',
  );
  assert.equal(
    await sha256Hex('tileflow'),
    '1f172c0e6d4b07616dbb0eea9cc006db5549932f039447501d160922c6b0d3c9',
  );
});

test('hashes a versioned RGBA frame and normalizes invisible RGB', async () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 10, 20, 30, 0]);
  const transparentVariant = new Uint8Array([255, 0, 0, 255, 200, 100, 50, 0]);
  const oneX = await hashTileflowRenderedIconPixels({
    height: 1,
    pixelRatio: 1,
    rgba,
    width: 2,
  });

  assert.equal(oneX, '6142fb4715eba88fa090d0feb82ada4e9c2bc61d04af1248cedf5ed851518d12');
  assert.equal(
    await hashTileflowRenderedIconPixels({
      height: 1,
      pixelRatio: 1,
      rgba: transparentVariant,
      width: 2,
    }),
    oneX,
  );
  assert.notEqual(
    await hashTileflowRenderedIconPixels({
      height: 1,
      pixelRatio: 2,
      rgba,
      width: 2,
    }),
    oneX,
  );
  await assert.rejects(
    () =>
      hashTileflowRenderedIconPixels({
        height: 1,
        pixelRatio: 1,
        rgba: new Uint8Array(7),
        width: 2,
      }),
    /exactly 8 bytes/,
  );
});

test('rejects unordered or unsafe icon names and inconsistent dimensions', () => {
  assert.equal(tileflowHostedIconIdSchema.safeParse('cafe-24').success, true);
  assert.equal(tileflowHostedIconIdSchema.safeParse('../cafe').success, false);
  assert.equal(
    tileflowIconPackageManifestSchema.safeParse({...manifest, iconNames: ['cafe', 'airport']})
      .success,
    false,
  );
  assert.equal(
    tileflowIconPackageManifestSchema.safeParse({
      ...manifest,
      renderedIcons: [...manifest.renderedIcons].reverse(),
    }).success,
    false,
  );
  assert.equal(
    tileflowIconPackageManifestSchema.safeParse({
      ...manifest,
      renderedIcons: manifest.renderedIcons.slice(0, 1),
    }).success,
    false,
  );
  assert.equal(
    tileflowIconPackageManifestSchema.safeParse({
      ...manifest,
      sprites: {...manifest.sprites, twoX: {...manifest.sprites.twoX, width: 97}},
    }).success,
    false,
  );
});

test('diffs icons by per-name pixels independently of atlas layout', () => {
  const layoutOnly = {
    ...manifest,
    sprites: {
      oneX: {height: 48, pixelRatio: 1 as const, width: 24},
      twoX: {height: 96, pixelRatio: 2 as const, width: 48},
    },
  };
  assert.deepEqual(diffTileflowIconPackageManifests(manifest, layoutOnly), {
    added: [],
    afterBytes: 700,
    beforeBytes: 700,
    modified: [],
    removed: [],
    unchangedCount: 2,
  });

  const changed = {
    ...manifest,
    iconNames: ['cafe', 'park'],
    renderedIcons: [
      {name: 'cafe', pixelSha256: {oneX: '9'.repeat(64), twoX: '8'.repeat(64)}},
      {name: 'park', pixelSha256: {oneX: 'a'.repeat(64), twoX: 'b'.repeat(64)}},
    ],
  };
  assert.deepEqual(diffTileflowIconPackageManifests(manifest, changed), {
    added: ['park'],
    afterBytes: 700,
    beforeBytes: 700,
    modified: ['cafe'],
    removed: ['airport'],
    unchangedCount: 0,
  });
  assert.deepEqual(diffTileflowIconPackageManifests(null, changed), {
    added: ['cafe', 'park'],
    afterBytes: 700,
    beforeBytes: 0,
    modified: [],
    removed: [],
    unchangedCount: 0,
  });
  assert.deepEqual(diffTileflowIconPackageManifests(manifest, null), {
    added: [],
    afterBytes: 0,
    beforeBytes: 700,
    modified: [],
    removed: ['airport', 'cafe'],
    unchangedCount: 0,
  });
});

test('diffs mappings with stable add, remove, and retarget ordering', () => {
  assert.deepEqual(
    diffTileflowIconMappings(
      {food: 'cafe', health: 'hospital', transit: 'bus'},
      {culture: 'museum', health: 'clinic', transit: 'bus'},
    ),
    {
      added: [{after: 'museum', key: 'culture'}],
      changed: [{after: 'clinic', before: 'hospital', key: 'health'}],
      removed: [{before: 'cafe', key: 'food'}],
    },
  );
  assert.deepEqual(diffTileflowIconMappings(null, null), {added: [], changed: [], removed: []});
});

test('inspects inherited mappings plus literal and dynamic raw override references', () => {
  assert.deepEqual(
    resolveTileflowIconMapping(
      {
        icons: {
          base: {mapping: {food: 'cafe', health: 'hospital'}},
          brand: {extends: 'base', mapping: {health: 'clinic'}},
        },
        maps: {
          production: {
            basemap: streets(),
            icons: {extends: 'brand', mapping: {food: 'restaurant'}},
          },
        },
      },
      'production',
    ),
    {food: 'restaurant', health: 'clinic'},
  );

  const analysis = inspectTileflowIconReferences(
    {
      icons: {
        base: {mapping: {food: 'cafe', health: 'hospital'}, source: './icons'},
        brand: {extends: 'base', mapping: {health: 'clinic'}},
      },
      maps: {
        production: {
          basemap: streets(),
          icons: {extends: 'brand', mapping: {health: 'hospital'}},
          overrides: [
            {
              kind: 'patch',
              id: 'streets-poi-food',
              patch: {layout: {'icon-image': 'tileflow:missing-literal'}},
            },
            {
              kind: 'patch',
              id: 'streets-poi-culture',
              patch: {layout: {'icon-image': ['concat', 'tileflow:', ['get', 'kind']]}},
            },
            {
              kind: 'patch',
              id: 'streets-poi-transit',
              patch: {layout: {'icon-image': ['image', 'tileflow:missing-module']}},
            },
          ],
        },
      },
    },
    'production',
    ['cafe'],
  );

  assert.equal(analysis.analysisComplete, false);
  assert.deepEqual(analysis.dangling, [
    {
      iconName: 'hospital',
      kind: 'mapping',
      path: 'maps.production.icons.mapping.health',
    },
    {
      iconName: 'missing-literal',
      kind: 'style-override-literal',
      path: 'maps.production.overrides.0.patch.layout.icon-image',
    },
    {
      iconName: 'missing-module',
      kind: 'style-override-literal',
      path: 'maps.production.overrides.2.patch.layout.icon-image',
    },
  ]);
  assert.deepEqual(analysis.unanalyzable, [
    {
      kind: 'style-override-expression',
      path: 'maps.production.overrides.1.patch.layout.icon-image',
    },
  ]);

  const inherited = inspectTileflowIconReferences(
    {
      icons: {base: {mapping: {health: 'hospital'}, source: './icons'}},
      maps: {production: {basemap: streets(), icons: 'base'}},
    },
    'production',
    [],
  );
  assert.deepEqual(inherited.dangling, [
    {iconName: 'hospital', kind: 'mapping', path: 'icons.base.mapping.health'},
  ]);
});

test('accepts printable Unicode labels and rejects controls or excessive length', () => {
  assert.equal(tileflowIconPackageLabelSchema.safeParse('Brand icons 🗺️').success, true);
  assert.equal(tileflowIconPackageLabelSchema.safeParse(' bad').success, false);
  assert.equal(tileflowIconPackageLabelSchema.safeParse('bad\nlabel').success, false);
  assert.equal(tileflowIconPackageLabelSchema.safeParse('x'.repeat(65)).success, false);
});
