import {MeshoptEncoder} from 'meshoptimizer/encoder';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readTileflowBuildings3D, tileflowBuildingsMetadataKey} from '../src/buildings-3d-design';
import {meshTileflowBuildings, tileflowBuildingExtent} from '../src/buildings-3d-mesh';
import {cameraTileAt} from '../src/camera-tiles-browser';
import {createTileflowPlacedModels} from '../src/models-3d-browser';
import {
  decodeTileflowModels,
  encodeTileflowModels,
  readTileflowLandmarkTileFootprints,
  readTileflowModelFileIds,
  type TileflowModelEntry,
} from '../src/models-3d-file';
import {
  readTileflowLandmarkRegion,
  readTileflowLandmarksTileJson,
  serializeTileflowLandmarkRegion,
  tileflowLandmarkRegionOf,
  tileflowLandmarkTileOf,
} from '../src/models-3d-landmarks';
import {
  tileflowInsideRings,
  type TileflowModelBytes,
  tileflowModelFootprintInTile,
  type TileflowModelMesh,
  tileflowModelParts,
  tileflowModelVertexBytes,
  tileflowRingsOverlap,
} from '../src/models-3d-model';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

/** A box 20 m wide and 10 m tall round the origin: two triangles a face, its roof a part of its own. */
function box(): TileflowModelMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const parts: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[][], number][] = [
    [
      [0, 0, 1],
      [
        [-10, -10, 10],
        [10, -10, 10],
        [10, 10, 10],
        [-10, 10, 10],
      ],
      tileflowModelParts.roof,
    ],
    [
      [0, -1, 0],
      [
        [-10, -10, 0],
        [10, -10, 0],
        [10, -10, 10],
        [-10, -10, 10],
      ],
      tileflowModelParts.surface,
    ],
    [
      [1, 0, 0],
      [
        [10, -10, 0],
        [10, 10, 0],
        [10, 10, 10],
        [10, -10, 10],
      ],
      tileflowModelParts.glass,
    ],
  ];
  for (const [normal, corners, part] of faces) {
    const first = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
      parts.push(part);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  // A duplicate of the roof's first corner, which the file welds into it.
  positions.push(-10, -10, 10);
  normals.push(0, 0, 1);
  parts.push(tileflowModelParts.roof);
  indices.push(positions.length / 3 - 1, 2, 3);
  const count = positions.length / 3;
  return {
    positions,
    normals,
    parts,
    shades: new Array(count).fill(0),
    occlusion: new Array(count).fill(1),
    indices,
  };
}

const footprint = [[-10, -10, 10, -10, 10, 10, -10, 10]];
const tower = (extra: Partial<TileflowModelEntry> = {}): TileflowModelEntry => ({
  id: 'tower',
  levels: [box(), box()],
  footprint,
  ...extra,
});

/** Each triangle as the bytes of its three vertices, sorted: what a file draws, whatever its order. */
function triangles(model: TileflowModelBytes, level = 0): string[] {
  const {vertices, indices} = model.levels[level]!;
  const vertex = (index: number) => [...vertices.subarray(index * 16, index * 16 + 16)].join(',');
  const out: string[] = [];
  for (let at = 0; at < indices.length; at += 3)
    out.push(
      [vertex(indices[at]!), vertex(indices[at + 1]!), vertex(indices[at + 2]!)].sort().join('|'),
    );
  return out.sort();
}

test('a model file is a glTF binary of its levels, bounds and footprint', async () => {
  const bytes = encodeTileflowModels([tower()]);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'glTF');
  const json = JSON.parse(
    new TextDecoder().decode(
      bytes.subarray(20, 20 + new DataView(bytes.buffer).getUint32(12, true)),
    ),
  );
  assert.deepEqual(json.extensionsRequired, ['KHR_mesh_quantization']);
  assert.deepEqual(
    json.nodes.map((node: {name: string}) => node.name),
    ['near', 'mid', 'tower'],
  );
  const [model] = (await decodeTileflowModels(bytes))!;
  assert.ok(model);
  assert.equal(model.id, 'tower');
  assert.equal(model.at, undefined);
  assert.equal(model.levels.length, 2);
  for (const [axis, value] of [-10, -10, 0, 10, 10, 10].entries())
    assert.ok(Math.abs(model.bounds[axis]! - value) < 1e-3, `bound ${axis}`);
  assert.deepEqual(
    model.footprint.map((ring) => [...ring]),
    footprint,
  );
  const level = model.levels[0]!;
  // Thirteen corners, one of them twice: twelve vertices, seven triangles.
  assert.equal(level.vertices.length, 12 * tileflowModelVertexBytes);
  assert.ok(level.indices instanceof Uint16Array);
  assert.equal(level.indices.length, 21);
  const view = new DataView(level.vertices.buffer, level.vertices.byteOffset);
  // The roof's first corner, 10 m west, 10 m south and 10 m up: in glTF's axes x -10, y 10, z 10.
  const metres = (axis: number) => level.centre[axis]! + view.getInt16(axis * 2, true) * level.step;
  assert.ok(Math.abs(metres(0) + 10) < 1e-3);
  assert.ok(Math.abs(metres(1) - 10) < 1e-3);
  assert.ok(Math.abs(metres(2) - 10) < 1e-3);
  // Its normal points up, glTF's +y; its part is the roof, unshaded and unoccluded.
  assert.deepEqual([view.getInt8(8), view.getInt8(9), view.getInt8(10)], [0, 127, 0]);
  assert.equal(level.vertices[12], tileflowModelParts.roof);
  assert.equal(level.vertices[13], 128);
  assert.equal(level.vertices[14], 255);
});

test('meshoptimizer compresses a model file into the same triangles', async () => {
  await MeshoptEncoder.ready;
  const plain = encodeTileflowModels([tower()]);
  const packed = encodeTileflowModels([tower()], MeshoptEncoder);
  const json = JSON.parse(
    new TextDecoder().decode(
      packed.subarray(20, 20 + new DataView(packed.buffer).getUint32(12, true)),
    ),
  );
  assert.deepEqual(json.extensionsRequired, ['EXT_meshopt_compression', 'KHR_mesh_quantization']);
  assert.equal(json.buffers[1].extensions.EXT_meshopt_compression.fallback, true);
  const [a] = (await decodeTileflowModels(plain))!;
  const [b] = (await decodeTileflowModels(packed))!;
  assert.deepEqual(triangles(b!), triangles(a!));
  assert.deepEqual(triangles(b!, 1), triangles(a!, 1));
  assert.deepEqual(b!.bounds, a!.bounds);
});

test('a model file names its models without decoding a mesh', async () => {
  await MeshoptEncoder.ready;
  const packed = encodeTileflowModels(
    [tower(), tower({id: 'annex', footprint: [[-5, -5, 5, -5, 5, 5, -5, 5]]})],
    MeshoptEncoder,
  );
  assert.deepEqual(readTileflowModelFileIds(packed), ['tower', 'annex']);
  assert.deepEqual(readTileflowModelFileIds(encodeTileflowModels([tower()])), ['tower']);
  // A glTF binary that is no prepared model file, and a damaged one, name nothing.
  const json = new TextEncoder().encode(JSON.stringify({asset: {version: '2.0'}, scenes: [{}]}));
  const plain = new Uint8Array(20 + json.byteLength);
  const view = new DataView(plain.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, plain.byteLength, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  plain.set(json, 20);
  assert.equal(readTileflowModelFileIds(plain), undefined);
  assert.equal(readTileflowModelFileIds(packed.subarray(0, packed.byteLength - 4)), undefined);
});

test('a landmark tile holds several models, each where it stands', async () => {
  await MeshoptEncoder.ready;
  const bytes = encodeTileflowModels(
    [
      tower({id: 'eiffel-tower', at: [2.2944962, 48.8582621], heading: 0}),
      tower({id: 'tour-montparnasse', at: [2.3219, 48.8421], heading: 30}),
    ],
    MeshoptEncoder,
  );
  const models = (await decodeTileflowModels(bytes))!;
  assert.deepEqual(
    models.map((model) => [model.id, model.at, model.heading]),
    [
      ['eiffel-tower', [2.2944962, 48.8582621], 0],
      ['tour-montparnasse', [2.3219, 48.8421], 30],
    ],
  );
});

test('a model keeps to its limits and stands on the ground', () => {
  const near = box();
  assert.throws(() => encodeTileflowModels([tower({levels: []})]), /1 to 3 levels/u);
  assert.throws(
    () => encodeTileflowModels([tower({levels: [near, near, near, near]})]),
    /1 to 3 levels/u,
  );
  const sunk = {
    ...near,
    positions: near.positions.map((value, index) => (index % 3 === 2 ? value - 5 : value)),
  };
  assert.throws(() => encodeTileflowModels([tower({levels: [sunk]})]), /stands on the ground/u);
  assert.throws(
    () => encodeTileflowModels([tower({footprint: [[0, 0, 1, 1]]})]),
    /at least three points/u,
  );
  assert.throws(
    () => encodeTileflowModels([tower({levels: [{...near, parts: near.parts.map(() => 9)}]})]),
    /has no part/u,
  );
  assert.throws(() => encodeTileflowModels([tower({id: 'Tower'})]), /not a model id/u);
  assert.throws(() => encodeTileflowModels([tower(), tower()]), /different ids/u);
  assert.throws(() => encodeTileflowModels([]), /1 to 512 models/u);
  assert.throws(() => encodeTileflowModels([tower({at: [0, 89]})]), /no place on the map/u);
});

test('only a whole model file of this layout decodes', async () => {
  const bytes = encodeTileflowModels([tower()]);
  assert.equal(await decodeTileflowModels(bytes.slice(0, bytes.length - 4)), undefined);
  assert.equal(await decodeTileflowModels(new Uint8Array(64)), undefined);
  assert.ok(await decodeTileflowModels(bytes.buffer.slice(0)));
  const jsonLength = new DataView(bytes.buffer).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const rewritten = async (change: (json: any) => void) => {
    const copy = structuredClone(json);
    change(copy);
    const text = new TextEncoder().encode(JSON.stringify(copy).padEnd(jsonLength, ' '));
    if (text.length !== jsonLength) throw new Error('the change must keep the JSON short');
    const out = bytes.slice();
    out.set(text, 20);
    return decodeTileflowModels(out);
  };
  assert.ok(await rewritten(() => {}));
  assert.equal(await rewritten((value) => (value.extensionsRequired = ['KHR_draco'])), undefined);
  assert.equal(await rewritten((value) => (value.nodes[0].name = 'far')), undefined);
  assert.equal(await rewritten((value) => (value.accessors[1].byteOffset = 4)), undefined);
  assert.equal(await rewritten((value) => (value.nodes[0].scale = [1, 2, 1])), undefined);
  assert.equal(
    await rewritten((value) => (value.nodes[2].extras.tileflow.model = 'No Id')),
    undefined,
  );
});

test("a footprint lands round its origin in the tile's units, turned by its heading", () => {
  // The Eiffel Tower's origin at zoom 15: a 20 m square round it.
  const at: [number, number] = [2.294481, 48.858258];
  const zoom = 15;
  const x = ((at[0] + 180) / 360) * 2 ** zoom;
  const phi = (at[1] * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom;
  const tile = {x: Math.floor(x), y: Math.floor(y), zoom};
  const [ring] = tileflowModelFootprintInTile(footprint, {at, heading: 0}, tile, 8192);
  const origin = [(x - tile.x) * 8192, (y - tile.y) * 8192];
  const metres = (40_075_016.686 * Math.cos(phi)) / 2 ** zoom / 8192;
  // The first corner lies 10 m west and 10 m south: left of and below the origin in tile units.
  assert.ok(Math.abs(ring![0]! - (origin[0]! - 10 / metres)) < 1e-6);
  assert.ok(Math.abs(ring![1]! - (origin[1]! + 10 / metres)) < 1e-6);
  // Turned 90° clockwise, a point 10 m north of the origin ends 10 m east of it.
  const [turned] = tileflowModelFootprintInTile(
    [[0, 10, 1, 10, 0, 11]],
    {at, heading: 90},
    tile,
    8192,
  );
  assert.ok(Math.abs(turned![0]! - (origin[0]! + 10 / metres)) < 1e-6);
  assert.ok(Math.abs(turned![1]! - origin[1]!) < 1e-6);
  assert.ok(tileflowInsideRings([ring!], origin[0]!, origin[1]!));
  assert.ok(!tileflowInsideRings([ring!], origin[0]! + 20 / metres, origin[1]!));
});

test('a building meets a footprint when it reaches into it, not when it only touches it', () => {
  const square = (left: number, top: number, side: number) => [
    left,
    top,
    left + side,
    top,
    left + side,
    top + side,
    left,
    top + side,
  ];
  const mask = [square(0, 0, 100)];
  // A neighbour sharing the mask's east wall, and one that reaches 0.4 units into it.
  assert.ok(!tileflowRingsOverlap([square(100, 0, 50)], mask, 0.5));
  assert.ok(!tileflowRingsOverlap([square(99.6, 0, 50)], mask, 0.5));
  // One whose corner is 5 units inside.
  assert.ok(tileflowRingsOverlap([square(95, 95, 50)], mask, 0.5));
  // A long bar passing through the mask with every corner outside it.
  assert.ok(tileflowRingsOverlap([[-20, 40, 120, 40, 120, 60, -20, 60]], mask, 0.5));
  // A mask inside a large building.
  assert.ok(tileflowRingsOverlap([square(-50, -50, 300)], [square(10, 10, 20)], 0.5));
  // Far away.
  assert.ok(!tileflowRingsOverlap([square(500, 500, 10)], mask, 0.5));
});

test('buildings a model stands in for are not raised, and their neighbours are', () => {
  const ring = (left: number, top: number, width: number, height: number) => [
    left,
    top,
    left + width,
    top,
    left + width,
    top + height,
    left,
    top + height,
    left,
    top,
  ];
  const layer: TileflowTileLayer = {
    extent: tileflowBuildingExtent,
    features: [
      // Its centre inside the footprint.
      {type: 'Polygon', properties: {render_height: 30}, geometry: [ring(100, 100, 100, 100)]},
      // Its centre outside, its corner well inside.
      {type: 'Polygon', properties: {render_height: 30}, geometry: [ring(250, 250, 200, 200)]},
      // Sharing the footprint's east wall.
      {type: 'Polygon', properties: {render_height: 30}, geometry: [ring(300, 50, 100, 100)]},
      // Far away.
      {type: 'Polygon', properties: {render_height: 30}, geometry: [ring(1000, 1000, 100, 100)]},
    ],
  };
  const all = meshTileflowBuildings(layer, {tileMetres: 1000});
  const masked = meshTileflowBuildings(layer, {
    tileMetres: 1000,
    masks: [[50, 50, 300, 50, 300, 300, 50, 300]],
  });
  assert.equal(all?.features.length, 4);
  assert.equal(masked?.features.length, 2);
});

test('the design reads the models a map places, the colours of their parts and its landmarks', () => {
  const read = (extra: Record<string, unknown>) =>
    readTileflowBuildings3D({
      [tileflowBuildingsMetadataKey]: {
        version: 1,
        source: 'tileflow',
        layers: {building: 'building'},
        color: '#cccccc',
        ...extra,
      },
    });
  const design = read({
    models: [
      {
        model: 'eiffel-tower',
        url: '/models/eiffel-tower.glb',
        at: [2.2945, 48.8583],
        heading: -45,
      },
      {model: 'Not An Id', url: '/x.glb', at: [0, 0]},
      {model: 'far-away', url: '/y.glb', at: [0, 89]},
      {model: 'no-file', at: [0, 0]},
    ],
    modelColors: {accent: '#806040', surface: 7, stone: '#ffffff'},
    landmarks: {url: 'https://api.tileflow.dev/landmarks/tiles.json'},
  });
  assert.deepEqual(design?.models, [
    {model: 'eiffel-tower', url: '/models/eiffel-tower.glb', at: [2.2945, 48.8583], heading: 315},
  ]);
  assert.deepEqual(design?.modelColors, {accent: '#806040'});
  assert.equal(design?.lighting, 'sun');
  assert.equal(design?.shadows, true);
  assert.equal(design?.occlusion, true);
  assert.deepEqual(design?.landmarks, {url: 'https://api.tileflow.dev/landmarks/tiles.json'});
  assert.equal(read({}).models, undefined);
  assert.equal(read({models: 'none'})?.models, undefined);
  assert.equal(read({landmarks: true})?.landmarks, undefined);
});

test(
  'model downloads await the request transform before using its URL and credentials',
  {timeout: 2000},
  async (t) => {
    let fetched!: () => void;
    const downloaded = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    let request: {url: unknown; init?: RequestInit} | undefined;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      request = {url, init};
      fetched();
      return new Response(null, {status: 404});
    });
    const models = createTileflowPlacedModels({
      async transformRequest(url, resourceType) {
        assert.equal(resourceType, 'Tile');
        return {
          url: url + '?transformed=1',
          headers: {Authorization: 'Bearer fixture'},
          credentials: 'include',
        };
      },
      changed() {},
    });
    t.after(() => models.dispose());
    models.update(
      [{model: 'tower', url: 'https://models.example.test/tower.glb', at: [0, 0], heading: 0}],
      undefined,
      [{x: 16384, y: 16384}],
      15,
    );
    assert.equal(request, undefined);
    await downloaded;
    assert.equal(request!.url, 'https://models.example.test/tower.glb?transformed=1');
    assert.deepEqual(request!.init?.headers, {Authorization: 'Bearer fixture'});
    assert.equal(request!.init?.credentials, 'include');
  },
);

test(
  "a landmark's footprint holds the buildings under it flat until its tile arrives, for a while",
  {timeout: 5000},
  async (t) => {
    await MeshoptEncoder.ready;
    const at = [2.2944962, 48.8582621] as const;
    const bytes = encodeTileflowModels(
      [tower({id: 'eiffel-tower', at, heading: 0})],
      MeshoptEncoder,
    );
    const landmarks = readTileflowLandmarkTileFootprints(bytes)!;
    const hash = 'a'.repeat(64);
    const tilesUrl = 'https://api.tileflow.test/landmarks/tiles.json';
    const index = serializeTileflowLandmarkRegion({
      region: [32, 22],
      tiles: [[8296, 5636, hash, landmarks]],
    });
    let release: (response: Response) => void = () => {};
    let tileRequests = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      const address = String(url);
      if (address === tilesUrl)
        return Response.json({
          tilejson: '3.0.0',
          format: 'tileflow-landmarks-v2',
          minzoom: 14,
          maxzoom: 14,
          tiles: ['https://api.tileflow.test/landmarks/tiles/{sha256}.glb'],
          regions: {
            zoom: 6,
            url: 'https://api.tileflow.test/landmarks/regions/{z}/{x}/{y}.json',
            available: [[32, 22]],
          },
        });
      if (address.endsWith('/regions/6/32/22.json')) return new Response(index);
      tileRequests += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const models = createTileflowPlacedModels({changed() {}, timing: {hold: 300, settle: 2000}});
    t.after(() => models.dispose());
    const [x, y] = cameraTileAt(at[0], at[1], 15);
    const tile = {x: Math.floor(x), y: Math.floor(y), z: 15};
    const update = () => models.update([], tilesUrl, [tile], 15);
    const until = async (done: () => boolean) => {
      for (let tries = 0; tries < 200 && !done(); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        update();
      }
      assert.ok(done());
    };

    // A tile of buildings waits for the index round it, then builds with the footprint held.
    update();
    let settled = false;
    void models.settle(tile, new AbortController().signal).then(() => {
      settled = true;
    });
    await until(() => settled);
    assert.ok(models.masksIn(tile, 8192), 'the footprint holds its buildings flat');
    assert.equal(models.shown().length, 0);
    assert.equal(tileRequests, 1);

    // The tile is late: after the hold, the buildings rise.
    await until(() => models.masksIn(tile, 8192) === undefined);

    // It arrives: the tower stands, fading in, and its footprint is left to it again.
    release(new Response(bytes));
    await until(() => models.shown().length === 1);
    assert.ok(models.masksIn(tile, 8192));
    assert.equal(typeof models.shown()[0]!.standingSince, 'number');
  },
);

test(
  'a landmark holds its buildings flat for as long as they are hidden, then a while longer',
  {timeout: 5000},
  async (t) => {
    await MeshoptEncoder.ready;
    const at = [2.2944962, 48.8582621] as const;
    const bytes = encodeTileflowModels(
      [tower({id: 'eiffel-tower', at, heading: 0})],
      MeshoptEncoder,
    );
    const index = serializeTileflowLandmarkRegion({
      region: [32, 22],
      tiles: [[8296, 5636, 'c'.repeat(64), readTileflowLandmarkTileFootprints(bytes)!]],
    });
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      const address = String(url);
      if (address.endsWith('tiles.json'))
        return Response.json({
          tilejson: '3.0.0',
          format: 'tileflow-landmarks-v2',
          minzoom: 14,
          maxzoom: 14,
          tiles: ['https://api.tileflow.test/landmarks/tiles/{sha256}.glb'],
          regions: {
            zoom: 6,
            url: 'https://api.tileflow.test/landmarks/regions/{z}/{x}/{y}.json',
            available: [[32, 22]],
          },
        });
      if (address.includes('/regions/')) return new Response(index);
      return new Promise<Response>(() => {});
    });
    const models = createTileflowPlacedModels({changed() {}, timing: {hold: 100}});
    t.after(() => models.dispose());
    const [x, y] = cameraTileAt(at[0], at[1], 15);
    const tile = {x: Math.floor(x), y: Math.floor(y), z: 15};
    let shown = false;
    const update = () =>
      models.update([], 'https://api.tileflow.test/tiles.json', [tile], 15, shown);
    const wait = async (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        update();
      }
    };
    update();
    await wait(300);
    assert.ok(models.masksIn(tile, 8192), 'hidden buildings stay held past the hold');
    shown = true;
    await wait(50);
    assert.ok(models.masksIn(tile, 8192), 'shown buildings stay held for the hold');
    await wait(200);
    assert.equal(models.masksIn(tile, 8192), undefined, 'then they rise');
  },
);

test(
  'a landmark whose tile fails lets the buildings under it rise at once',
  {timeout: 5000},
  async (t) => {
    await MeshoptEncoder.ready;
    const at = [2.2944962, 48.8582621] as const;
    const bytes = encodeTileflowModels(
      [tower({id: 'eiffel-tower', at, heading: 0})],
      MeshoptEncoder,
    );
    const index = serializeTileflowLandmarkRegion({
      region: [32, 22],
      tiles: [[8296, 5636, 'b'.repeat(64), readTileflowLandmarkTileFootprints(bytes)!]],
    });
    let fail: () => void = () => {};
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      const address = String(url);
      if (address.endsWith('tiles.json'))
        return Response.json({
          tilejson: '3.0.0',
          format: 'tileflow-landmarks-v2',
          minzoom: 14,
          maxzoom: 14,
          tiles: ['https://api.tileflow.test/landmarks/tiles/{sha256}.glb'],
          regions: {
            zoom: 6,
            url: 'https://api.tileflow.test/landmarks/regions/{z}/{x}/{y}.json',
            available: [[32, 22]],
          },
        });
      if (address.includes('/regions/')) return new Response(index);
      return new Promise<Response>((resolve) => {
        fail = () => resolve(new Response(null, {status: 500}));
      });
    });
    const models = createTileflowPlacedModels({changed() {}, timing: {hold: 60_000}});
    t.after(() => models.dispose());
    const [x, y] = cameraTileAt(at[0], at[1], 15);
    const tile = {x: Math.floor(x), y: Math.floor(y), z: 15};
    const update = () => models.update([], 'https://api.tileflow.test/tiles.json', [tile], 15);
    const until = async (done: () => boolean) => {
      for (let tries = 0; tries < 200 && !done(); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        update();
      }
      assert.ok(done());
    };
    update();
    await until(() => models.masksIn(tile, 8192) !== undefined);
    fail();
    await until(() => models.masksIn(tile, 8192) === undefined);
  },
);

test("a landmarks tileset's TileJSON names its tile address, its regions and those that hold landmarks", () => {
  const url = 'https://api.tileflow.dev/landmarks/tiles.json';
  const json = {
    tilejson: '3.0.0',
    format: 'tileflow-landmarks-v2',
    minzoom: 14,
    maxzoom: 14,
    tiles: ['https://api.tileflow.dev/landmarks/tiles/{sha256}.glb'],
    regions: {
      zoom: 6,
      url: 'https://api.tileflow.dev/landmarks/releases/abc/regions/{z}/{x}/{y}.json',
      available: [[32, 22]],
    },
  };
  const tileset = readTileflowLandmarksTileJson(json, url);
  assert.equal(tileset?.tileZoom, 14);
  assert.equal(tileset?.regionZoom, 6);
  assert.ok(tileset?.regions.has('32/22'));
  assert.equal(
    readTileflowLandmarksTileJson({...json, format: 'tileflow-landmarks-v1'}, url),
    undefined,
  );
  assert.equal(readTileflowLandmarksTileJson({...json, minzoom: 13}, url), undefined);
  assert.equal(
    readTileflowLandmarksTileJson({...json, tiles: ['/tiles/{z}/{x}/{y}.glb']}, url),
    undefined,
  );
  assert.equal(
    readTileflowLandmarksTileJson(
      {...json, regions: {...json.regions, available: [[1.5, 2]]}},
      url,
    ),
    undefined,
  );
});

test("a landmark's tile and region follow from where it stands, and a region's index names its tiles and their landmarks", () => {
  const eiffel = tileflowLandmarkTileOf([2.2944962, 48.8582621]);
  assert.deepEqual(eiffel, [8296, 5636]);
  assert.deepEqual(tileflowLandmarkRegionOf(eiffel), [32, 22]);
  assert.throws(() => tileflowLandmarkTileOf([0, 89]), /longitude and a latitude/u);
  const hash = (digit: string) => digit.repeat(64);
  const tower = {
    id: 'eiffel-tower',
    at: [2.2944962, 48.8582621] as const,
    heading: 0,
    footprint: [[-62.54, -62.5, 62.5, -62.5, 62.5, 62.5, -62.5, 62.5]],
  };
  const bridge = {
    id: 'pont-d-iena',
    at: [2.2929, 48.8597] as const,
    heading: 30,
    footprint: [[-7, -80, 7, -80, 7, 80, -7, 80]],
  };
  const montparnasse = {
    id: 'tour-montparnasse',
    at: [2.3219, 48.8421] as const,
    heading: 0,
    footprint: [[-25, -16, 25, -16, 25, 16, -25, 16]],
  };
  const bytes = serializeTileflowLandmarkRegion({
    region: [32, 22],
    tiles: [
      [8297, 5637, hash('b'), [montparnasse]],
      [8296, 5636, hash('a'), [tower, bridge]],
    ],
  });
  // Canonical bytes: tiles by x then y, their landmarks by id, footprints in whole decimetres.
  assert.equal(
    new TextDecoder().decode(bytes),
    `{"format":"tileflow-landmark-region-v2","zoom":14,"region":[6,32,22],"tiles":[[8296,5636,"${hash('a')}",[{"id":"eiffel-tower","at":[2.2944962,48.8582621],"heading":0,"footprint":[[-625,-625,625,-625,625,625,-625,625]]},{"id":"pont-d-iena","at":[2.2929,48.8597],"heading":30,"footprint":[[-70,-800,70,-800,70,800,-70,800]]}]],[8297,5637,"${hash('b')}",[{"id":"tour-montparnasse","at":[2.3219,48.8421],"heading":0,"footprint":[[-250,-160,250,-160,250,160,-250,160]]}]]]}`,
  );
  const region = readTileflowLandmarkRegion(JSON.parse(new TextDecoder().decode(bytes)));
  assert.deepEqual(region?.tiles[0]?.slice(0, 3), [8296, 5636, hash('a')]);
  assert.deepEqual(region?.tiles[0]?.[3]?.[0], {
    ...tower,
    footprint: [[-62.5, -62.5, 62.5, -62.5, 62.5, 62.5, -62.5, 62.5]],
  });
  // An index of the first format, which named no landmarks, is still read.
  assert.deepEqual(
    readTileflowLandmarkRegion({
      format: 'tileflow-landmark-region-v1',
      zoom: 14,
      region: [6, 32, 22],
      tiles: [[8296, 5636, hash('a')]],
    })?.tiles,
    [[8296, 5636, hash('a')]],
  );
  assert.throws(
    () => serializeTileflowLandmarkRegion({region: [32, 22], tiles: [[0, 0, hash('a'), [tower]]]}),
    /outside region 32\/22/u,
  );
  assert.throws(
    () =>
      serializeTileflowLandmarkRegion({
        region: [32, 22],
        tiles: [
          [8296, 5636, hash('a'), [tower]],
          [8296, 5636, hash('b'), [tower]],
        ],
      }),
    /appears twice/u,
  );
  assert.throws(
    () => serializeTileflowLandmarkRegion({region: [32, 22], tiles: [[8296, 5636, 'x', [tower]]]}),
    /no SHA-256/u,
  );
  assert.throws(
    () => serializeTileflowLandmarkRegion({region: [32, 22], tiles: [[8296, 5636, hash('a')]]}),
    /names no landmark/u,
  );
  assert.throws(
    () =>
      serializeTileflowLandmarkRegion({
        region: [32, 22],
        tiles: [[8296, 5636, hash('a'), [montparnasse]]],
      }),
    /stands in tile 8297\/5637, not 8296\/5636/u,
  );
  assert.throws(
    () =>
      serializeTileflowLandmarkRegion({
        region: [32, 22],
        tiles: [[8296, 5636, hash('a'), [{...tower, footprint: [[0, 0, 1, 1]]}]]],
      }),
    /no valid footprint/u,
  );
  const written = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(
    readTileflowLandmarkRegion({...written, tiles: [[0, 0, hash('a'), written.tiles[0][3]]]}),
    undefined,
  );
  assert.equal(
    readTileflowLandmarkRegion({...written, tiles: [[8296, 5636, hash('a')]]}),
    undefined,
    'a tile of the second format names its landmarks',
  );
  assert.equal(
    readTileflowLandmarkRegion({
      ...written,
      tiles: [
        [8296, 5636, hash('a'), [{...written.tiles[0][3][0], footprint: [[0.5, 0, 1, 0, 1, 1]]}]],
      ],
    }),
    undefined,
    'footprints travel in whole decimetres',
  );
});
