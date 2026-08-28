import assert from 'node:assert/strict';
import test from 'node:test';
import {defineMap, parseTileflowMap} from '../src';
import {
  collectTileflowMapBuildLineage,
  createTileflowMapBuildManifest,
  hashTileflowAssetSet,
  hashTileflowAssetSetIdentities,
  hashTileflowMapRevision,
  type TileflowEffectiveMapSourceAssets,
} from '../src/build';
import type {MapLibreStyle} from '../src/types';
import {extendStreets, testLightTheme} from './map-fixture';

const sourceAssets: TileflowEffectiveMapSourceAssets = {
  fonts: [],
  icons: [],
};

const lightStyle: MapLibreStyle = {
  layers: [
    {
      id: 'land',
      paint: {'fill-color': '#ffffff'},
      'source-layer': 'landcover',
      source: 'world',
      type: 'fill',
    },
  ],
  sources: {world: {type: 'vector', url: 'https://tiles.example.test/tile.json'}},
  version: 8,
};

const darkStyle: MapLibreStyle = {
  ...lightStyle,
  layers: [{...lightStyle.layers[0]!, paint: {'fill-color': '#111827'}}],
};

const assets = [
  {contentType: 'image/png', fileName: 'icons/main/sprite.png', source: new Uint8Array([1, 2])},
];

test('verified per-file identities reproduce the byte-backed asset-set hash', async () => {
  const byteHash = await hashTileflowAssetSet(assets);
  const identityHash = await hashTileflowAssetSetIdentities([
    {
      byteLength: 2,
      contentType: 'image/png',
      fileName: 'icons/main/sprite.png',
      sha256: 'a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222',
    },
  ]);
  assert.equal(identityHash, byteHash);
});

test('map revision identifies the complete resolved theme document and source closure', async () => {
  const base = extendStreets({id: 'base'});
  const sameDesign = defineMap({id: 'renamed', version: 7, extends: base});
  const resolvedBase = parseTileflowMap(base);
  assert.equal(
    await hashTileflowMapRevision(resolvedBase, sourceAssets),
    await hashTileflowMapRevision(parseTileflowMap(sameDesign), sourceAssets),
  );

  const dark = {...testLightTheme, colorScheme: 'dark' as const, id: 'test-dark'};
  const themed = extendStreets({
    id: 'themed',
    defaultTheme: 'dark',
    themes: {dark, light: testLightTheme},
  });
  assert.notEqual(
    await hashTileflowMapRevision(resolvedBase, sourceAssets),
    await hashTileflowMapRevision(parseTileflowMap(themed), sourceAssets),
  );

  const changedSources: TileflowEffectiveMapSourceAssets = {
    fonts: [],
    icons: [{format: 'svg', id: 'marker', kind: 'icon', sha256: 'b'.repeat(64)}],
  };
  assert.notEqual(
    await hashTileflowMapRevision(resolvedBase, sourceAssets),
    await hashTileflowMapRevision(resolvedBase, changedSources),
  );
});

test('build manifest records every concrete theme on independent style identity axes', async () => {
  const dark = {...testLightTheme, colorScheme: 'dark' as const, id: 'test-dark', version: 2};
  const map = extendStreets({
    id: 'main',
    defaultTheme: 'dark',
    systemThemes: {dark: 'dark', light: 'light'},
    themes: {dark, light: testLightTheme},
  });
  const manifest = await createTileflowMapBuildManifest({
    main: {
      assets,
      lineage: collectTileflowMapBuildLineage(map),
      map: parseTileflowMap(map),
      sourceAssets,
      styles: {dark: darkStyle, light: lightStyle},
    },
  });

  const entry = manifest.maps.main!;
  assert.equal(entry.defaultTheme, 'dark');
  assert.deepEqual(entry.semanticCompiler, {name: 'tileflow-semantic', version: 1});
  assert.deepEqual(entry.systemThemes, {dark: 'dark', light: 'light'});
  assert.deepEqual(Object.keys(entry.themes), ['dark', 'light']);
  assert.equal(entry.themes.dark?.colorScheme, 'dark');
  assert.equal(entry.themes.dark?.themeId, 'test-dark');
  assert.equal(entry.themes.dark?.themeVersion, 2);
  assert.notEqual(entry.themes.dark?.styleSha256, entry.themes.light?.styleSha256);
  assert.deepEqual(
    entry.themes.dark?.dataRequirements,
    entry.themes.light?.dataRequirements,
    'palette-only themes retain one structural data contract',
  );
  assert.deepEqual(
    entry.themes.dark?.sourceRequirements,
    entry.themes.light?.sourceRequirements,
    'palette-only themes retain one multi-source contract',
  );
});

test('build manifest records raster DEM requirements independently from vector fields', async () => {
  const map = extendStreets({id: 'main'});
  const reliefStyle: MapLibreStyle = {
    ...lightStyle,
    layers: [
      ...lightStyle.layers,
      {
        id: 'bathymetry-relief',
        paint: {
          'color-relief-color': [
            'interpolate',
            ['linear'],
            ['elevation'],
            -11_000,
            '#123456',
            0,
            '#abcdef',
          ],
        },
        source: 'bathymetry-dem',
        type: 'color-relief',
      },
    ],
    sources: {
      ...lightStyle.sources,
      'bathymetry-dem': {
        encoding: 'terrarium',
        tileSize: 512,
        type: 'raster-dem',
        url: 'https://tiles.example.test/bathymetry-dem.json',
      },
    },
  };
  const manifest = await createTileflowMapBuildManifest({
    main: {
      assets,
      lineage: collectTileflowMapBuildLineage(map),
      map: parseTileflowMap(map),
      sourceAssets,
      styles: {light: reliefStyle},
    },
  });

  assert.deepEqual(manifest.maps.main?.themes.light?.sourceRequirements.rasterDemSources, {
    'bathymetry-dem': {
      encoding: 'terrarium',
      sourceId: 'bathymetry-dem',
      tileSize: 512,
      type: 'raster-dem',
    },
  });
  assert.deepEqual(
    Object.keys(manifest.maps.main?.themes.light?.sourceRequirements.sources ?? {}),
    ['world'],
  );
});

test('build manifest fails closed when compiled and declared theme families drift', async () => {
  const map = extendStreets({id: 'main'});
  const input = {
    assets,
    lineage: collectTileflowMapBuildLineage(map),
    map: parseTileflowMap(map),
    sourceAssets,
  };
  await assert.rejects(
    createTileflowMapBuildManifest({main: {...input, styles: {}}}),
    /must exactly match its declared themes/u,
  );
  await assert.rejects(
    createTileflowMapBuildManifest({
      main: {...input, styles: {extra: darkStyle, light: lightStyle}},
    }),
    /must exactly match its declared themes/u,
  );
});

test('provenance remains a build axis independent of theme style identities', async () => {
  const map = extendStreets({id: 'main'});
  const build = (version: string) =>
    createTileflowMapBuildManifest(
      {
        main: {
          assets,
          lineage: collectTileflowMapBuildLineage(map),
          map: parseTileflowMap(map),
          sourceAssets,
          styles: {light: lightStyle},
        },
      },
      {provenance: {packages: {'@tileflow/core': version}, schemaVersion: 1}},
    );
  const [first, second] = await Promise.all([build('1.0.0'), build('1.0.1')]);
  assert.deepEqual(first.maps, second.maps);
  assert.notDeepEqual(first.provenance, second.provenance);
});
