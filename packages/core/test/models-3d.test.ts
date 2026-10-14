import assert from 'node:assert/strict';
import test from 'node:test';
import {readTileflowBuildings3D, tileflowBuildingsMetadataKey} from '../src/buildings-3d-design';
import {meshTileflowBuildings, tileflowBuildingExtent} from '../src/buildings-3d-mesh';
import {
  decodeTileflowModel,
  encodeTileflowModel,
  type TileflowModelMesh,
  tileflowInsideRings,
  tileflowModelFootprintInTile,
  tileflowModelParts,
  tileflowModelVertexBytes,
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

test('a model file holds its levels, bounds and footprint as they were encoded', () => {
  const near = box();
  const bytes = encodeTileflowModel({levels: [near, near], footprint});
  const model = decodeTileflowModel(bytes);
  assert.ok(model);
  assert.deepEqual(model.bounds, [-10, -10, 0, 10, 10, 10]);
  assert.equal(model.levels.length, 2);
  assert.deepEqual(
    model.footprint.map((ring) => [...ring]),
    footprint,
  );
  const level = model.levels[0]!;
  assert.equal(level.vertices.length, 12 * tileflowModelVertexBytes);
  assert.ok(level.indices instanceof Uint16Array);
  assert.deepEqual([...level.indices], near.indices);
  const view = new DataView(level.vertices.buffer, level.vertices.byteOffset);
  // The first vertex sits at the bounds' minimum in x and y and at their top: -32768 and 32767.
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), -32768);
  assert.equal(view.getInt16(4, true), 32767);
  assert.equal(view.getInt8(8), 127);
  assert.equal(level.vertices[9], tileflowModelParts.roof);
  assert.equal(level.vertices[10], 128);
  assert.equal(level.vertices[11], 255);
});

test('a model keeps to its limits and stands on the ground', () => {
  const near = box();
  assert.throws(() => encodeTileflowModel({levels: [], footprint}), /1 to 3 levels/u);
  assert.throws(
    () => encodeTileflowModel({levels: [near, near, near, near], footprint}),
    /1 to 3 levels/u,
  );
  const sunk = {
    ...near,
    positions: near.positions.map((value, index) => (index % 3 === 2 ? value - 5 : value)),
  };
  assert.throws(() => encodeTileflowModel({levels: [sunk], footprint}), /stands on the ground/u);
  assert.throws(
    () => encodeTileflowModel({levels: [near], footprint: [[0, 0, 1, 1]]}),
    /at least three points/u,
  );
  assert.throws(
    () => encodeTileflowModel({levels: [{...near, parts: near.parts.map(() => 9)}], footprint}),
    /has no part/u,
  );
});

test('only a whole model file of this version decodes', () => {
  const bytes = encodeTileflowModel({levels: [box()], footprint});
  assert.equal(decodeTileflowModel(bytes.slice(0, bytes.length - 1)), undefined);
  const other = bytes.slice();
  other[4] = 9;
  assert.equal(decodeTileflowModel(other), undefined);
  assert.equal(decodeTileflowModel(new Uint8Array(64)), undefined);
  assert.ok(decodeTileflowModel(bytes.buffer.slice(0)));
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

test('buildings whose centre falls inside a placed model are not raised', () => {
  const square = (left: number) => [
    left,
    100,
    left + 100,
    100,
    left + 100,
    200,
    left,
    200,
    left,
    100,
  ];
  const layer: TileflowTileLayer = {
    extent: tileflowBuildingExtent,
    features: [
      {type: 'Polygon', properties: {render_height: 30}, geometry: [square(100)]},
      {type: 'Polygon', properties: {render_height: 30}, geometry: [square(1000)]},
    ],
  };
  const all = meshTileflowBuildings(layer, {tileMetres: 1000});
  const masked = meshTileflowBuildings(layer, {
    tileMetres: 1000,
    masks: [[50, 50, 300, 50, 300, 300, 50, 300]],
  });
  assert.equal(all?.features.length, 2);
  assert.equal(masked?.features.length, 1);
  assert.equal(masked!.vertices.length * 2, all!.vertices.length);
});

test('the design reads the models a map places and the colours of their parts', () => {
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
        url: '/models/eiffel-tower.tfmd',
        at: [2.2945, 48.8583],
        heading: -45,
      },
      {model: 'Not An Id', url: '/x.tfmd', at: [0, 0]},
      {model: 'far-away', url: '/y.tfmd', at: [0, 89]},
      {model: 'no-file', at: [0, 0]},
    ],
    modelColors: {accent: '#806040', surface: 7, stone: '#ffffff'},
  });
  assert.deepEqual(design?.models, [
    {model: 'eiffel-tower', url: '/models/eiffel-tower.tfmd', at: [2.2945, 48.8583], heading: 315},
  ]);
  assert.deepEqual(design?.modelColors, {accent: '#806040'});
  assert.equal(read({}).models, undefined);
  assert.equal(read({models: 'none'})?.models, undefined);
});
