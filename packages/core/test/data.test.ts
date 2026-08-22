import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  parseWorldGenerationDescriptor,
  resolveTileflowData,
  streets,
  tileflowWorld,
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
  assert.equal(resolved.attribution, '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors');
  assert.deepEqual(resolved.identity, {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
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

test('normalizes schemas created before the optional global land-cover binding', () => {
  const legacySchema = openMapTiles();
  delete legacySchema.layers.globalLandcover;

  assert.equal(isCanonicalOpenMapTilesSchema(legacySchema), true);

  const resolved = resolveTileflowData(
    vectorTiles({
      attribution: '© Example',
      schema: legacySchema,
      url: '/tiles.json',
    }),
  );
  assert.equal(resolved.schema.layers.globalLandcover, 'globallandcover');
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
