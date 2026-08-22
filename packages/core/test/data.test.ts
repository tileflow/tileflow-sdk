import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  parseWorldGenerationDescriptor,
  resolveTileflowData,
  streets,
  tileflowWorld,
  tileflowWorldRevision,
  tileflowWorldV1Schema,
  validateTileflowWorldV1Tilejson,
  tileflowWorldGeneration,
  tileflowWorldTileUrl,
  vectorTiles,
  type WorldGenerationDescriptor,
} from '../src';

const worldGenerationFixture: WorldGenerationDescriptor = {
  schemaVersion: 1,
  generation: 'v1',
  tileUrl: 'https://world.tileflow.dev/world/v1/{z}/{x}/{y}.pbf',
  vectorSchema: {id: 'tileflow-world-v1-test', sha256: 'a'.repeat(64)},
  tileEncoding: {format: 'mvt', compression: 'gzip', scheme: 'xyz', extent: 4096},
  minzoom: 0,
  maxzoom: 15,
  bounds: [-180, -85.0511288, 180, 85.0511288],
  attribution: '© OpenStreetMap contributors · Tileflow test fixture',
  assetSet: {
    id: 'a1-0123456789abcdef',
    glyphs: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/glyphs/{fontstack}/{range}.pbf',
    spriteBase: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/sprites/base',
  },
};

test('resolves omitted data to the stable Tileflow World generation without discovery', () => {
  const resolved = resolveTileflowData(undefined);

  assert.equal(resolved.kind, 'tileflow-world');
  assert.equal(resolved.generation, tileflowWorldGeneration);
  assert.deepEqual(resolved.tiles, [tileflowWorldTileUrl]);
  assert.equal(resolved.url, undefined);
  assert.equal(resolved.revision, undefined);
  assert.equal(resolved.assetSet, undefined);
  assert.equal(resolved.sourceId, 'tileflow');
  assert.equal(resolved.schema.layers.bathymetry, 'bathymetry');
  assert.equal(resolved.schema.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(resolved.schema.fields.bathymetrySortKey, 'sort_key');
  assert.equal(resolved.attribution, '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors');
  assert.deepEqual(resolved.identity, {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
});

test('retains an explicit legacy World revision selector', () => {
  const resolved = resolveTileflowData(tileflowWorld({revision: tileflowWorldRevision}), {
    apiBaseUrl: 'https://api.example.test/base',
  });

  assert.equal(resolved.generation, tileflowWorldGeneration);
  assert.equal(resolved.revision, tileflowWorldRevision);
  assert.equal(
    resolved.url,
    `https://api.example.test/tiles/world/tiles.json?archiveVersion=${tileflowWorldRevision}`,
  );
  assert.equal(resolved.tiles, undefined);
  assert.equal(resolved.identity.revision, tileflowWorldRevision);
});

test('validates and resolves a complete compiler-owned World descriptor', () => {
  assert.deepEqual(parseWorldGenerationDescriptor(worldGenerationFixture), worldGenerationFixture);

  const resolved = resolveTileflowData(tileflowWorld(), {
    worldGeneration: worldGenerationFixture,
  });
  assert.deepEqual(resolved.tiles, [worldGenerationFixture.tileUrl]);
  assert.deepEqual(resolved.assetSet, worldGenerationFixture.assetSet);
  assert.deepEqual(resolved.bounds, worldGenerationFixture.bounds);
  assert.equal(resolved.minzoom, 0);
  assert.equal(resolved.maxzoom, 15);
  assert.equal(resolved.attribution, worldGenerationFixture.attribution);
});

test('resolves external vector data without network access', () => {
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

  const direct = resolveTileflowData(
    vectorTiles({
      attribution: '© Fixture',
      bounds: [-10, -5, 10, 5],
      maxzoom: 12,
      minzoom: 2,
      revision: 'fixture_2',
      schema: openMapTiles(),
      tiles: ['https://fixtures.example.test/{z}/{x}/{y}.pbf'],
    }),
  );
  assert.equal(direct.url, undefined);
  assert.deepEqual(direct.tiles, ['https://fixtures.example.test/{z}/{x}/{y}.pbf']);
  assert.equal(direct.identity.url, 'https://fixtures.example.test/{z}/{x}/{y}.pbf');
  assert.deepEqual(direct.bounds, [-10, -5, 10, 5]);
  assert.equal(direct.minzoom, 2);
  assert.equal(direct.maxzoom, 12);
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

test('rejects private URL credentials, invalid descriptors, and missing attribution', () => {
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
  assert.throws(
    () =>
      parseWorldGenerationDescriptor({
        ...worldGenerationFixture,
        assetSet: {...worldGenerationFixture.assetSet, id: 'latest'},
      }),
    /invalid|a1-|assetSet/i,
  );
  assert.throws(
    () =>
      parseWorldGenerationDescriptor({
        ...worldGenerationFixture,
        tileUrl: 'https://world.tileflow.dev/world/latest/{z}/{x}/{y}.pbf',
      }),
    /v1|tileUrl/i,
  );
  assert.throws(
    () => vectorTiles({attribution: '© Example', schema: openMapTiles(), url: 'file:///tmp/a'}),
    /file protocol/,
  );
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: openMapTiles(),
        tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
        url: 'https://example.test/tiles.json',
      }),
    /exactly one/,
  );
});

test('defines Streets as a versioned light recipe identity', () => {
  assert.deepEqual(streets(), {type: 'streets', basemapVersion: 3, variant: 'light'});
});
