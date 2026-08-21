import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  resolveTileflowData,
  streets,
  tileflowWorld,
  tileflowWorldRevision,
  tileflowWorldV1Schema,
  validateTileflowWorldV1Tilejson,
  vectorTiles,
} from '../src';

test('resolves omitted data to a deterministic Tileflow World revision', () => {
  const resolved = resolveTileflowData(undefined, {apiBaseUrl: 'https://api.example.test/base'});

  assert.equal(resolved.kind, 'tileflow-world');
  assert.equal(resolved.revision, tileflowWorldRevision);
  assert.equal(
    resolved.url,
    `https://api.example.test/tiles/world/tiles.json?archiveVersion=${tileflowWorldRevision}`,
  );
  assert.equal(resolved.sourceId, 'tileflow');
  assert.equal(resolved.schema.layers.bathymetry, 'bathymetry');
  assert.equal(resolved.schema.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(resolved.schema.fields.bathymetrySortKey, 'sort_key');
  assert.equal(resolved.attribution, '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors');
  assert.deepEqual(resolved.identity, {
    kind: 'tileflow-world',
    revision: tileflowWorldRevision,
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
});

test('resolves explicit official and external vector data without network access', () => {
  const versionedOfficial = resolveTileflowData(tileflowWorld({revision: 'archive_42'}));
  assert.equal(versionedOfficial.revision, 'archive_42');
  assert.equal(versionedOfficial.attribution, undefined);
  assert.equal(
    versionedOfficial.url,
    'https://api.tileflow.dev/tiles/world/tiles.json?archiveVersion=archive_42',
  );

  const explicitLegacy = resolveTileflowData(tileflowWorld({revision: tileflowWorldRevision}));
  assert.equal(
    explicitLegacy.attribution,
    '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors',
  );

  const external = resolveTileflowData(
    vectorTiles({
      attribution: '© Example',
      revision: 'fixture_1',
      schema: openMapTiles(),
      url: 'pmtiles://catalog/world.pmtiles?public=value',
    }),
  );

  assert.equal(external.url, 'pmtiles://catalog/world.pmtiles?public=value');
  assert.equal(external.attribution, '© Example');
  assert.equal(external.identity.kind, 'vector-tiles');
  assert.equal(external.identity.revision, 'fixture_1');
});

test('supports explicit schema bindings and identifies canonical OpenMapTiles', () => {
  const canonical = openMapTiles();
  const remapped = openMapTiles({
    layers: {globalLandcover: 'worldcover_lowzoom', road: 'roads_v2'},
    fields: {
      access: 'permission',
      class: 'kind',
      layer: 'stacking_order',
      ramp: 'is_ramp',
      service: 'service_kind',
      surface: 'pavement',
    },
  });

  assert.equal(isCanonicalOpenMapTilesSchema(canonical), true);
  assert.equal(isCanonicalOpenMapTilesSchema(remapped), false);
  assert.equal(canonical.layers.globalLandcover, 'globallandcover');
  assert.equal(canonical.layers.businessCorridor, 'business_corridor');
  assert.equal(canonical.layers.tree, 'tree');
  assert.equal(remapped.layers.globalLandcover, 'worldcover_lowzoom');
  assert.equal(remapped.layers.road, 'roads_v2');
  assert.equal(remapped.fields.class, 'kind');
  assert.equal(remapped.fields.access, 'permission');
  assert.equal(remapped.fields.ramp, 'is_ramp');
  assert.equal(remapped.fields.surface, 'pavement');
  assert.equal(canonical.fields.bicycle, 'bicycle');
  assert.equal(canonical.fields.mtbScale, 'mtb_scale');
  assert.equal(canonical.fields.toll, 'toll');
});

test('preserves explicitly absent optional source-layer capabilities', () => {
  const schema = openMapTiles({
    capabilities: {businessCorridor: false, globalLandcover: false, tree: false},
  });

  assert.equal(isCanonicalOpenMapTilesSchema(schema), false);

  const resolved = resolveTileflowData(
    vectorTiles({
      attribution: '© Example',
      schema,
      url: '/tiles.json',
    }),
  );
  assert.equal(resolved.schema.layers.globalLandcover, undefined);
  assert.equal(resolved.schema.layers.businessCorridor, undefined);
  assert.equal(resolved.schema.layers.tree, undefined);
  assert.equal(resolved.identity.capabilities?.globalLandcover, false);
  assert.equal(resolved.identity.capabilities?.businessCorridor, false);
  assert.equal(resolved.identity.capabilities?.bathymetry, false);
  assert.equal(resolved.identity.capabilities?.tree, false);
});

test('defines and validates the required Tileflow World V1 bathymetry extension', () => {
  const generic = openMapTiles();
  const worldV1 = tileflowWorldV1Schema();

  assert.equal(generic.layers.bathymetry, undefined);
  assert.equal(generic.fields.bathymetryMinDepth, undefined);
  assert.equal(worldV1.layers.bathymetry, 'bathymetry');
  assert.equal(worldV1.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(worldV1.fields.bathymetrySortKey, 'sort_key');
  assert.deepEqual(
    validateTileflowWorldV1Tilejson({
      vector_layers: [
        {
          id: 'bathymetry',
          minzoom: 0,
          maxzoom: 9,
          fields: {min_depth: 'Number', sort_key: 'Number'},
        },
      ],
    }),
    [],
  );
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: []}), [
    'Tileflow World V1 requires bathymetry.',
  ]);
});

test('rejects private URL credentials, invalid revisions, and missing attribution', () => {
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: openMapTiles(),
        url: 'https://user:secret@example.test/tiles.json',
      }),
    /must not contain user information/,
  );
  assert.throws(
    () => vectorTiles({attribution: ' ', schema: openMapTiles(), url: '/tiles.json'}),
    /must not be empty/,
  );
  assert.throws(() => tileflowWorld({revision: '../latest'}), /must be portable/);
  assert.throws(
    () => vectorTiles({attribution: '© Example', schema: openMapTiles(), url: 'file:///tmp/a'}),
    /file protocol/,
  );
});

test('defines Streets as a versioned light recipe identity', () => {
  assert.deepEqual(streets(), {type: 'streets', basemapVersion: 3, variant: 'light'});
});
