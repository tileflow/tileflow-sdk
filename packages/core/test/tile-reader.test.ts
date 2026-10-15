import {VectorTile} from '@mapbox/vector-tile';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PbfReader} from 'pbf';
import {
  createTileflowTileReader,
  readTileflowMapTileSource,
  tileflowTilePointToLngLat,
  tileflowTilesForBounds,
} from '../src/tile-reader';
import {decodeTileflowVectorTile} from '../src/vector-tile-decode';

// --- A small Mapbox Vector Tile encoder for fixtures ---

type Value = string | number | boolean;
type FixtureFeature = {
  id?: number;
  type: 1 | 2 | 3;
  properties: Record<string, Value>;
  /** Parts as [[x, y], …] in tile units; rings are closed by ClosePath, not by repeating. */
  parts: [number, number][][];
};

function varint(out: number[], value: number) {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}
const zigzag = (value: number) => (value < 0 ? -2 * value - 1 : 2 * value);
function field(out: number[], number: number, wire: number) {
  varint(out, number * 8 + wire);
}
function bytesField(out: number[], number: number, bytes: number[] | Uint8Array) {
  field(out, number, 2);
  varint(out, bytes.length);
  out.push(...bytes);
}
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

function encodeValue(value: Value): number[] {
  const out: number[] = [];
  if (typeof value === 'string') bytesField(out, 1, utf8(value));
  else if (typeof value === 'boolean') {
    field(out, 7, 0);
    varint(out, value ? 1 : 0);
  } else if (Number.isInteger(value) && value >= 0) {
    field(out, 5, 0);
    varint(out, value);
  } else if (Number.isInteger(value)) {
    field(out, 6, 0);
    varint(out, zigzag(value));
  } else {
    field(out, 3, 1);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    out.push(...new Uint8Array(view.buffer));
  }
  return out;
}

function encodeGeometry(type: 1 | 2 | 3, parts: [number, number][][]): number[] {
  const commands: number[] = [];
  let x = 0;
  let y = 0;
  const move = (points: [number, number][], command: number) => {
    commands.push(command | (points.length << 3));
    for (const [px, py] of points) {
      commands.push(zigzag(px - x), zigzag(py - y));
      x = px;
      y = py;
    }
  };
  if (type === 1) move(parts.flat(), 1);
  else
    for (const part of parts) {
      move([part[0]!], 1);
      move(part.slice(1), 2);
      if (type === 3) commands.push(7 | (1 << 3));
    }
  return commands;
}

function encodeTile(layers: Record<string, {extent?: number; features: FixtureFeature[]}>) {
  const tile: number[] = [];
  for (const [name, {extent = 4096, features}] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: Value[] = [];
    const layer: number[] = [];
    field(layer, 15, 0);
    varint(layer, 2);
    bytesField(layer, 1, utf8(name));
    for (const feature of features) {
      const encoded: number[] = [];
      if (feature.id !== undefined) {
        field(encoded, 1, 0);
        varint(encoded, feature.id);
      }
      const tags: number[] = [];
      for (const [key, value] of Object.entries(feature.properties)) {
        let k = keys.indexOf(key);
        if (k < 0) k = keys.push(key) - 1;
        let v = values.indexOf(value);
        if (v < 0) v = values.push(value) - 1;
        tags.push(k, v);
      }
      const packedTags: number[] = [];
      for (const tag of tags) varint(packedTags, tag);
      bytesField(encoded, 2, packedTags);
      field(encoded, 3, 0);
      varint(encoded, feature.type);
      const geometry: number[] = [];
      for (const command of encodeGeometry(feature.type, feature.parts)) varint(geometry, command);
      bytesField(encoded, 4, geometry);
      bytesField(layer, 2, encoded);
    }
    for (const key of keys) bytesField(layer, 3, utf8(key));
    for (const value of values) bytesField(layer, 4, encodeValue(value));
    field(layer, 5, 0);
    varint(layer, extent);
    bytesField(tile, 3, layer);
  }
  return new Uint8Array(tile);
}

const streets = encodeTile({
  transportation: {
    features: [
      {
        id: 7,
        type: 2,
        properties: {class: 'primary', oneway: 1, layer: -1, brunnel: 'bridge'},
        parts: [
          [
            [-64, 100],
            [2048, 100],
            [4160, 3000],
          ],
          [
            [10, 10],
            [20, 30],
          ],
        ],
      },
    ],
  },
  poi: {
    extent: 512,
    features: [
      // An id beyond 2^53, as World's POI ids are, reads as MapLibre reads it.
      {
        id: 2 ** 60 + 2 ** 40,
        type: 1,
        properties: {name: 'Café', rank: 2.5, open: true},
        parts: [[[1, 2]], [[3, 4]]],
      },
    ],
  },
  building: {
    features: [
      {
        type: 3,
        properties: {render_height: 42},
        parts: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        ],
      },
    ],
  },
});

test('the decoder reads layers, properties and geometry as the reference decoder does', () => {
  const decoded = decodeTileflowVectorTile(streets);
  const reference = new VectorTile(new PbfReader(streets));
  assert.deepEqual(Object.keys(decoded).sort(), Object.keys(reference.layers).sort());
  for (const [name, layer] of Object.entries(decoded)) {
    const expected = reference.layers[name]!;
    assert.equal(layer.extent, expected.extent);
    assert.equal(layer.features.length, expected.length);
    for (const [index, feature] of layer.features.entries()) {
      const other = expected.feature(index);
      assert.equal(feature.id, other.id);
      assert.equal(feature.type, ['Unknown', 'Point', 'LineString', 'Polygon'][other.type]);
      assert.deepEqual(feature.properties, {...other.properties});
      const parts = other.loadGeometry().map((part) => part.flatMap((point) => [point.x, point.y]));
      // The reference keeps a MultiPoint's points apart; this decoder keeps one part per MoveTo.
      assert.deepEqual(
        feature.type === 'Point' ? [feature.geometry.flat()] : feature.geometry,
        feature.type === 'Point' ? [parts.flat()] : parts,
      );
    }
  }
  assert.deepEqual(decoded.transportation!.features[0]!.properties, {
    class: 'primary',
    oneway: 1,
    layer: -1,
    brunnel: 'bridge',
  });
  // A polygon ring is closed: its first point comes again at the end.
  assert.deepEqual(decoded.building!.features[0]!.geometry, [
    [0, 0, 100, 0, 100, 100, 0, 100, 0, 0],
  ]);
});

test('only the chosen layers are decoded, and broken bytes throw', () => {
  assert.deepEqual(Object.keys(decodeTileflowVectorTile(streets, {layers: ['poi']})), ['poi']);
  assert.deepEqual(decodeTileflowVectorTile(new Uint8Array()), {});
  assert.throws(
    () => decodeTileflowVectorTile(streets.subarray(0, streets.length - 5)),
    /Truncated/u,
  );
});

test('tile addresses cover an area nearest its centre first, across the antimeridian too', () => {
  const tiles = tileflowTilesForBounds([-80.14, 25.77, -80.12, 25.8], 14);
  assert.ok(tiles.length >= 2 && tiles.length <= 6);
  for (const tile of tiles) assert.equal(tile.z, 14);
  const [lng, lat] = tileflowTilePointToLngLat(tiles[0]!, 2048, 2048);
  assert.ok(Math.abs(lng + 80.13) < 0.03 && Math.abs(lat - 25.785) < 0.03);
  const wrapped = tileflowTilesForBounds([179.9, 0, -179.9, 0.1], 4);
  assert.deepEqual(new Set(wrapped.map(({x}) => x)), new Set([15, 0]));
  assert.throws(() => tileflowTilesForBounds([0, 10, 1, 5], 3), RangeError);
  assert.deepEqual(tileflowTilePointToLngLat({z: 0, x: 0, y: 0}, 0, 0), [-180, 85.0511287798066]);
});

function fakeFetch(responses: Record<string, () => Response>) {
  const calls: {url: string; init: RequestInit}[] = [];
  const pending: (() => void)[] = [];
  let hold = false;
  return {
    calls,
    hold(on: boolean) {
      hold = on;
      if (!on) for (const release of pending.splice(0)) release();
    },
    async fetch(url: string, init: RequestInit) {
      calls.push({url, init});
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      const path = new URL(url).pathname;
      return responses[path]?.() ?? new Response(null, {status: 404});
    },
  };
}

const tileResponse = () => new Response(streets, {status: 200});

test('the reader requests each tile once, caches it and applies the request rules', async () => {
  const network = fakeFetch({'/14/4573/7139.pbf': tileResponse});
  const reader = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf?release=1',
    layers: ['transportation'],
    transformRequest: async (url) => ({url: `${url}&signed=1`, headers: {'X-Map': 'demo'}}),
    fetch: network.fetch,
  });
  network.hold(true);
  const both = Promise.all([
    reader.readTile({z: 14, x: 4573, y: 7139}),
    reader.readTile({z: 14, x: 4573, y: 7139}),
  ]);
  network.hold(false);
  const [first, second] = await both;
  assert.equal(first, second);
  assert.deepEqual(Object.keys(first!.layers), ['transportation']);
  assert.equal(network.calls.length, 1);
  assert.equal(
    network.calls[0]!.url,
    'https://tiles.example.test/14/4573/7139.pbf?release=1&signed=1',
  );
  assert.deepEqual(network.calls[0]!.init.headers, {'X-Map': 'demo'});
  assert.equal(await reader.readTile({z: 14, x: 4573, y: 7139}), first);
  assert.equal(network.calls.length, 1);

  // An absent tile is remembered as absent; an error is not remembered.
  assert.equal(await reader.readTile({z: 14, x: 1, y: 1}), undefined);
  assert.equal(await reader.readTile({z: 14, x: 1, y: 1}), undefined);
  assert.equal(network.calls.length, 2);
  reader.clear();
  await reader.readTile({z: 14, x: 4573, y: 7139});
  assert.equal(network.calls.length, 3);
});

test('a server error rejects without being cached, and bad addresses are refused', async () => {
  let status = 503;
  const reader = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf',
    fetch: async () => (status === 200 ? tileResponse() : new Response(null, {status})),
  });
  await assert.rejects(reader.readTile({z: 2, x: 1, y: 1}), /HTTP 503/u);
  status = 200;
  assert.ok(await reader.readTile({z: 2, x: 1, y: 1}));
  await assert.rejects(reader.readTile({z: 2, x: 4, y: 0}), RangeError);
  await assert.rejects(reader.readTile({z: 1.5, x: 0, y: 0}), RangeError);
});

test('a reader that stops waiting leaves the request to finish for the cache', async () => {
  const network = fakeFetch({'/3/1/1.pbf': tileResponse});
  const reader = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf',
    fetch: network.fetch,
  });
  network.hold(true);
  const controller = new AbortController();
  const read = reader.readTile({z: 3, x: 1, y: 1}, {signal: controller.signal});
  controller.abort();
  await assert.rejects(read, {name: 'AbortError'});
  network.hold(false);
  assert.ok(await reader.readTile({z: 3, x: 1, y: 1}));
  assert.equal(network.calls.length, 1);
  await assert.rejects(reader.readTile({z: 3, x: 1, y: 1}, {signal: AbortSignal.abort()}), {
    name: 'AbortError',
  });
});

test('requests wait their turn beyond the concurrency limit and the cache stays bounded', async () => {
  let running = 0;
  let most = 0;
  const reader = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf',
    concurrency: 2,
    cacheSize: 3,
    fetch: async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return tileResponse();
    },
  });
  const addresses = Array.from({length: 6}, (_, x) => ({z: 4, x, y: 0}));
  await Promise.all(addresses.map((address) => reader.readTile(address)));
  assert.equal(most, 2);
  // The three most recent tiles are cached; the first was evicted.
  let fetched = 0;
  const counting = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf',
    cacheSize: 1,
    fetch: async () => {
      fetched += 1;
      return tileResponse();
    },
  });
  await counting.readTile({z: 1, x: 0, y: 0});
  await counting.readTile({z: 1, x: 1, y: 0});
  await counting.readTile({z: 1, x: 0, y: 0});
  assert.equal(fetched, 3);
});

test('an area is read at the source zooms and refused when too large', async () => {
  const network = fakeFetch({});
  const reader = createTileflowTileReader({
    tiles: 'https://tiles.example.test/{z}/{x}/{y}.pbf',
    maxzoom: 12,
    fetch: async (url, init) => {
      await network.fetch(url, init);
      return tileResponse();
    },
  });
  const tiles = await reader.readArea({bounds: [-80.14, 25.77, -80.12, 25.8], zoom: 16});
  assert.ok(tiles.length >= 1);
  for (const tile of tiles) assert.equal(tile.z, 12);
  await assert.rejects(
    reader.readArea({bounds: [-10, -10, 10, 10], zoom: 12, maxTiles: 4}),
    /more than the 4 allowed/u,
  );
});

test('a map source gives the reader its address and zooms once loaded', () => {
  const sources: Record<string, unknown> = {
    world: {tiles: ['https://world.example.test/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 15},
    pending: {url: 'https://world.example.test/tiles.json'},
  };
  const map = {getSource: (id: string) => sources[id]};
  assert.deepEqual(readTileflowMapTileSource(map, 'world'), {
    tiles: 'https://world.example.test/{z}/{x}/{y}.pbf',
    minzoom: 0,
    maxzoom: 15,
  });
  assert.equal(readTileflowMapTileSource(map, 'pending'), undefined);
  assert.equal(readTileflowMapTileSource(map, 'missing'), undefined);
});

test("a source served from a Tileflow PMTiles archive is read through Core's protocol", async (t) => {
  let requested = '';
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    requested = String(input);
    throw new Error('stop after URL resolution');
  });
  const reader = createTileflowTileReader({
    tiles: 'tileflow-pmtiles://https://assets.example.test/canopy.pmtiles/{z}/{x}/{y}.mvt',
  });
  await assert.rejects(reader.readTile({z: 15, x: 16000, y: 12000}), /stop after URL resolution/u);
  // The archive itself is requested, not the tile address.
  assert.equal(requested, 'https://assets.example.test/canopy.pmtiles');
});

test('invalid reader options are refused', () => {
  assert.throws(() => createTileflowTileReader({tiles: 'https://x.test/tile.pbf'}), /\{z\}/u);
  assert.throws(
    () => createTileflowTileReader({tiles: 'https://x.test/{z}/{x}/{y}', minzoom: 5, maxzoom: 3}),
    RangeError,
  );
  assert.throws(
    () => createTileflowTileReader({tiles: 'https://x.test/{z}/{x}/{y}', concurrency: 0}),
    RangeError,
  );
  assert.throws(
    () => createTileflowTileReader({tiles: 'https://x.test/{z}/{x}/{y}', cacheSize: -1}),
    RangeError,
  );
});
