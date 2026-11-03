import assert from 'node:assert/strict';
import test from 'node:test';
import {registerTileflowPathGroundProtocol} from '../src/path-ground-browser';
import {
  deriveTileflowGreenPaths,
  encodeTileflowPathLayer,
  type PathGroundBindings,
} from '../src/path-ground-geometry';
import {prepareTileflowNativePathGround} from '../src/path-ground-native';
import {parsePathGroundRequest, pathGroundProtocolUrl} from '../src/path-ground-protocol';
import type {MapLibreStyle} from '../src/types';
import {decodeTileflowVectorTile, type TileflowTileFeature} from '../src/vector-tile-decode';

const bindings: PathGroundBindings = {
  road: 'transportation',
  landcover: 'landcover',
  landuse: 'landuse',
  class: 'class',
  subclass: 'subclass',
  brunnel: 'brunnel',
};

test('native preparation keeps complete paths and layer indices without a browser protocol', () => {
  const upstream = {type: 'vector' as const, url: 'https://tiles.example.test/tiles.json'};
  const web: MapLibreStyle = {
    version: 8,
    sources: {
      tileflow: upstream,
      'tileflow-path-ground': {
        type: 'vector',
        url: pathGroundProtocolUrl({...bindings, url: upstream.url}),
      },
    },
    layers: [
      {
        id: 'full-path',
        type: 'line',
        source: 'tileflow',
        'source-layer': 'transportation',
        paint: {'line-color': '#D5DAD7'},
      },
      {
        id: 'green-only',
        type: 'line',
        source: 'tileflow-path-ground',
        'source-layer': 'transportation',
        paint: {'line-color': '#FFFFFF', 'line-opacity': 1},
      },
    ],
  };
  const native = prepareTileflowNativePathGround(web);
  assert.deepEqual(
    native.layers.map((l) => l.id),
    web.layers.map((l) => l.id),
  );
  assert.equal(native.layers[0], web.layers[0]);
  assert.deepEqual(native.sources['tileflow-path-ground'], upstream);
  assert.equal((native.layers[1] as {paint: {'line-opacity': number}}).paint['line-opacity'], 0);
  assert.equal((web.layers[1] as {paint: {'line-opacity': number}}).paint['line-opacity'], 1);
  const malformed = {
    ...web,
    sources: {
      ...web.sources,
      'tileflow-path-ground': {type: 'vector' as const, url: 'tileflow-path-ground://invalid'},
    },
  };
  assert.equal(prepareTileflowNativePathGround(malformed), malformed);
});
const square = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
const hole = [40, 40, 40, 60, 60, 60, 60, 40, 40, 40];
const path: TileflowTileFeature = {
  id: 17,
  type: 'LineString',
  properties: {class: 'path', subclass: 'footway', name: 'Garden walk'},
  geometry: [[-10, 50, 110, 50]],
};
function tile(cover: TileflowTileFeature[], roads = [path], coverExtent = 4096) {
  const parts = [
    encodeTileflowPathLayer('transportation', 4096, roads),
    encodeTileflowPathLayer('landcover', coverExtent, cover),
  ];
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
const garden = (
  geometry: readonly (readonly number[])[],
  properties = {class: 'grass'},
): TileflowTileFeature => ({type: 'Polygon', properties, geometry});
const paths = (bytes: Uint8Array) =>
  decodeTileflowVectorTile(deriveTileflowGreenPaths(bytes, bindings)).transportation!.features;

test('paths change ground exactly at green boundaries and preserve real paved holes', () => {
  const result = paths(tile([garden([square, hole])]));
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 17);
  assert.deepEqual(result[0]!.properties, path.properties);
  assert.deepEqual(result[0]!.geometry, [
    [0, 50, 40, 50],
    [60, 50, 100, 50],
  ]);
});
test('overlapping green polygons are a union, including separate exteriors in one MVT feature', () => {
  const result = paths(tile([garden([square, hole, [30, 30, 70, 30, 70, 70, 30, 70, 30, 30]])]));
  assert.equal(result[0]!.geometry.length, 1);
  assert.deepEqual(result[0]!.geometry[0]!.slice(0, 2), [0, 50]);
  assert.deepEqual(result[0]!.geometry[0]!.slice(-2), [100, 50]);
});
test('plain farmland stays ground-coloured and grade-separated paths are excluded', () => {
  assert.deepEqual(paths(tile([garden([square], {class: 'farmland'})])), []);
  assert.deepEqual(
    paths(
      tile([garden([square])], [{...path, properties: {...path.properties, brunnel: 'bridge'}}]),
    ),
    [],
  );
  assert.deepEqual(
    paths(
      tile([garden([square])], [{...path, properties: {...path.properties, brunnel: 'tunnel'}}]),
    ),
    [],
  );
});
test('green geometry uses the road extent, and missing cover returns an empty overlay', () => {
  assert.deepEqual(paths(tile([garden([square.map((n) => n * 2)])], [path], 8192))[0]!.geometry, [
    [0, 50, 100, 50],
  ]);
  assert.deepEqual(paths(tile([])), []);
});
test('the packaged protocol resolves the same upstream TileJSON, caches bounded derived bytes and honors cancellation', async () => {
  const source = {...bindings, url: 'https://tiles.example.test/release-1/tiles.json'};
  const calls: string[] = [];
  let handler:
    | Parameters<Parameters<typeof registerTileflowPathGroundProtocol>[0]['addProtocol']>[1]
    | undefined;
  const registry = {
    addProtocol: (_name: string, h: NonNullable<typeof handler>) => {
      handler = h;
    },
  };
  registerTileflowPathGroundProtocol(registry, {
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith('.json')
        ? Response.json({tiles: ['./{z}/{x}/{y}.pbf'], maxzoom: 15})
        : new Response(tile([garden([square])]));
    },
  });
  assert.ok(handler);
  const description = await handler({url: pathGroundProtocolUrl(source)}, new AbortController());
  const json = description.data as {tiles: string[]; maxzoom: number};
  assert.equal(json.maxzoom, 15);
  const url = json.tiles[0]!.replace('{z}', '15').replace('{x}', '16047').replace('{y}', '12356');
  const result = await handler({url}, new AbortController());
  assert.equal(
    decodeTileflowVectorTile(new Uint8Array(result.data as ArrayBuffer)).transportation!.features
      .length,
    1,
  );
  await handler({url}, new AbortController());
  assert.deepEqual(calls, [
    'https://tiles.example.test/release-1/tiles.json',
    'https://tiles.example.test/release-1/15/16047/12356.pbf',
  ]);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(handler({url}, abort));
  assert.throws(() =>
    parsePathGroundRequest(pathGroundProtocolUrl({...source, url: 'file:///tmp/tiles.json'})),
  );
});
