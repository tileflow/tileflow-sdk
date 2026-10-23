import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {PbfWriter} from 'pbf';
import {inspectTile, tilePolygon, visibleTiles} from '../src/inspector/tiles';

function vectorTile(count = 61) {
  const writer = new PbfWriter();
  for (const name of ['roads', 'unrendered-points']) {
    writer.writeMessage(
      3,
      (_, layer) => {
        layer.writeVarintField(15, 2);
        layer.writeStringField(1, name);
        layer.writeVarintField(5, 4096);
        layer.writeStringField(3, 'name');
        layer.writeMessage(
          4,
          (_, value) => value.writeStringField(1, 'Full tile feature'),
          undefined,
        );
        for (let index = 0; index < count; index++) {
          layer.writeMessage(
            2,
            (_, feature) => {
              feature.writeVarintField(1, index);
              feature.writePackedVarint(2, [0, 0]);
              feature.writeVarintField(3, 1);
              feature.writePackedVarint(4, [9, 2, 2]);
            },
            undefined,
          );
        }
      },
      undefined,
    );
  }
  return writer.finish();
}

function fixture(type = 'vector', extra: Record<string, unknown> = {}) {
  const tile = {
    tileID: {key: 'tile', canonical: {z: 1, x: 0, y: 0, key: 'canonical'}, overscaledZ: 3, wrap: 1},
    state: 'loaded',
    tileSize: 512,
    ...extra,
  };
  const tiles = [tile];
  const map = {
    getStyle: () => ({sources: {world: {type}}, layers: []}),
    style: {tileManagers: {world: {_inViewTiles: {getAllTiles: () => tiles}}}},
    queryRenderedFeatures: () => {
      throw new Error('Must not sample the viewport');
    },
    querySourceFeatures: () => {
      throw new Error('Must not combine multiple tiles');
    },
  } as unknown as MapLibreMap;
  return {map, tile, tiles, record: visibleTiles(map).tiles[0]};
}

test('reads the entire selected vector tile across source layers, including non-rendered features and ID zero', () => {
  const bytes = vectorTile();
  // Real map data crosses the preview iframe boundary.
  const raw = runInNewContext('new Uint8Array(bytes).buffer', {bytes: [...bytes]}) as ArrayBuffer;
  const {map, record} = fixture('vector', {latestRawTileData: raw, latestEncoding: 'mvt'});
  const contents = inspectTile(map, record);
  assert.deepEqual(Object.keys(contents.layers!), ['roads', 'unrendered-points']);
  assert.equal(contents.layers!.roads.length, 61);
  assert.equal(contents.layers!['unrendered-points'].length, 61);
  const first = contents.layers!.roads.feature(0);
  assert.equal(first.id, 0);
  assert.equal(first.properties.name, 'Full tile feature');
  assert.equal(contents.layers!.roads.feature(60).id, 60);
  assert.equal(first.toGeoJSON(record.x, record.y, record.z).geometry.type, 'Point');
  assert.equal(inspectTile(map, record).layers, contents.layers);
  assert.deepEqual(new Uint8Array(raw), bytes);
});

test('refreshes replaced data and distinguishes unavailable, invalid, unsupported and evicted tiles', () => {
  const {map, tile, tiles, record} = fixture('vector', {latestRawTileData: vectorTile().buffer});
  const before = inspectTile(map, record);
  Object.assign(tile, {latestRawTileData: vectorTile(2).buffer});
  assert.equal(inspectTile(map, record).layers!.roads.length, 2);
  assert.notEqual(inspectTile(map, record).layers, before.layers);
  Object.assign(tile, {latestRawTileData: new Uint8Array([255]).buffer});
  assert.match(inspectTile(map, record).message!, /could not be decoded/);
  Object.assign(tile, {latestEncoding: 'mlt'});
  assert.match(inspectTile(map, record).message!, /MLT/);
  Object.assign(tile, {latestRawTileData: undefined});
  assert.match(inspectTile(map, record).message!, /not available/);
  tiles.length = 0;
  assert.match(inspectTile(map, record).message!, /no longer in view/);
});

test('reports DEM grid and elevation range without treating pixels as vector data', () => {
  const dem = {dim: 256, min: -12.5, max: 642.25, data: new Uint32Array(260 * 260)};
  const {map, record} = fixture('raster-dem', {dem});
  const contents = inspectTile(map, record);
  assert.deepEqual(contents.terrain, {
    size: 256,
    min: -12.5,
    max: 642.25,
    bytes: dem.data.byteLength,
  });
  assert.equal(contents.layers, undefined);
  assert.equal(contents.revision, dem);
  const raster = fixture('raster');
  assert.match(inspectTile(raster.map, raster.record).message!, /raster pixels/);
});

test('tile bounds follow the selected wrapped world copy and canonical zoom', () => {
  const {record} = fixture();
  assert.equal(record.wrap, 1);
  assert.equal(record.key, 'world:tile');
  assert.equal(record.overscaledZ, 3);
  const ring = tilePolygon(record).coordinates[0];
  assert.equal(ring[0][0], 180);
  assert.equal(ring[1][0], 360);
  assert.deepEqual(ring[0], ring.at(-1));
});
