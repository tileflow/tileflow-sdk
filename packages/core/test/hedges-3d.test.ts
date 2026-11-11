import assert from 'node:assert/strict';
import test from 'node:test';
import {placeTileflowHedges, tileflowHedgeVertexBytes} from '../src/hedges-3d';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

const fields = {subclass: 'type', hedge: 'hedge', height: 'height'};
function mesh(paths: number[][], tileMetres = 100) {
  const layer: TileflowTileLayer = {
    extent: 100,
    features: [{type: 'LineString', properties: {type: 'hedge'}, geometry: paths}],
  };
  const {geometry} = placeTileflowHedges(layer, tileMetres, fields);
  const view = new DataView(geometry.buffer);
  return Array.from({length: geometry.length / tileflowHedgeVertexBytes}, (_, index) => {
    const at = index * tileflowHedgeVertexBytes;
    return {
      x: (view.getUint16(at + 24, true) * tileMetres) / 8192 + view.getFloat32(at, true),
      y: (-view.getUint16(at + 26, true) * tileMetres) / 8192 + view.getFloat32(at + 4, true),
      z: view.getFloat32(at + 8, true),
      normal: [12, 13, 14].map((offset) => view.getInt8(at + offset) / 127),
      round: [18, 19, 20].map((offset) => view.getInt8(at + offset) / 127),
      shade: view.getUint8(at + 33),
      seed: view.getUint8(at + 36),
    };
  });
}

type Vertex = ReturnType<typeof mesh>[number];
function roof(vertices: Vertex[]) {
  const triangles: Vertex[][] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    const triangle = vertices.slice(index, index + 3);
    if (triangle.every((v) => v.z === 1)) triangles.push(triangle);
  }
  return triangles;
}
function area(triangles: Vertex[][]) {
  return triangles.reduce(
    (sum, [a, b, c]) =>
      sum + Math.abs((b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x)) / 2,
    0,
  );
}

test('a straight hedge is a thin continuous roof with no overlapping pieces', () => {
  const vertices = mesh([[10, 10, 90, 10]]);
  const top = roof(vertices);
  assert.equal(top.length, 2, 'a long straight roof is just two triangles');
  assert.ok(Math.abs(area(top) - 80 * 0.4) < 1e-5);
  assert.ok(vertices.every((v) => v.y >= -10.250001 && v.y <= -9.749999));
  assert.deepEqual([...new Set(vertices.map((v) => v.shade))], [128]);
  assert.deepEqual([...new Set(vertices.map((v) => v.seed))], [0]);
  for (const vertex of vertices) {
    assert.deepEqual(vertex.round, vertex.normal, 'smooth trees do not round hedge walls');
    assert.ok(Math.abs(Math.hypot(...vertex.normal) - 1) < 0.02);
  }
  assert.ok(
    top.flat().every((v) => v.normal[2] === 1),
    'the roof faces upward',
  );
});

test('corners share the exact roof edge and closed hedges have no end caps', () => {
  const turn = roof(mesh([[10, 20, 20, 20, 20, 10]]));
  assert.equal(turn.length, 4);
  assert.ok(Math.abs(area(turn) - 20 * 0.4) < 1e-5, 'joint adds no overlapping roof area');
  const first = new Set(
    turn
      .slice(0, 2)
      .flat()
      .map((v) => `${v.x},${v.y}`),
  );
  const second = new Set(
    turn
      .slice(2)
      .flat()
      .map((v) => `${v.x},${v.y}`),
  );
  assert.equal([...first].filter((point) => second.has(point)).length, 2);
  const ring = mesh([[20, 20, 30, 20, 30, 30, 20, 30, 20, 20]]);
  assert.equal(ring.length, 4 * 5 * 6, 'only five connected surfaces per segment');
  assert.ok(Math.abs(area(roof(ring)) - 40 * 0.4) < 1e-5);
});

test('buffered hedges meet at tile boundaries without duplicate surfaces', () => {
  const left = mesh([[90, 50, 110, 50]]);
  const right = mesh([[-10, 50, 10, 50]]);
  for (const tile of [left, right]) {
    assert.ok(tile.every((v) => v.x >= -1e-6 && v.x <= 100.000001));
    assert.ok(tile.every((v) => v.y >= -100.000001 && v.y <= 1e-6));
    assert.ok(Math.abs(area(roof(tile)) - 10 * 0.4) < 1e-5);
  }
  const boundary = (vertices: Vertex[], x: number) =>
    [
      ...new Set(
        vertices
          .filter((v) => Math.abs(v.x - x) < 1e-6)
          .map((v) => `${v.y.toFixed(5)},${v.z.toFixed(5)}`),
      ),
    ].sort();
  assert.deepEqual(boundary(left, 100), boundary(right, 0));
});

test('duplicate vertices and tight turns produce finite bounded geometry', () => {
  const vertices = mesh([[10, 10, 10, 10, 20, 10, 10.01, 10.01, 10.01, 10.01]]);
  assert.ok(vertices.length > 0);
  for (const v of vertices) {
    assert.ok([v.x, v.y, v.z, ...v.normal].every(Number.isFinite));
    assert.ok(v.x >= 9.5 && v.x <= 20.5 && v.y >= -10.51 && v.y <= -9.5);
  }
  assert.equal(mesh([[10, 10, 10, 10]]).length, 0);
});
