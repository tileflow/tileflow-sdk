import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowBuildings3D,
  tileflowBuildings3DLayerId,
  tileflowSunLightMatrix,
} from '../src/buildings-3d-browser';
import {
  meshTileflowBuildings,
  tileflowBuildingExtent,
  tileflowBuildingVertexBytes,
} from '../src/buildings-3d-mesh';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

// MVT exterior rings are clockwise in tile units (y down); this is a 1000 × 1000 square.
const square = [0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0];

function layerOf(
  features: {geometry: number[][]; properties?: Record<string, string | number | boolean>}[],
): TileflowTileLayer {
  return {
    extent: 4096,
    features: features.map(({geometry, properties}) => ({
      type: 'Polygon' as const,
      properties: {render_height: 30, ...properties},
      geometry: geometry.map((ring) => ring.map((value) => value + 1000)),
    })),
  };
}

function vertex(mesh: NonNullable<ReturnType<typeof meshTileflowBuildings>>, index: number) {
  const view = new DataView(
    mesh.vertices.buffer,
    mesh.vertices.byteOffset + index * tileflowBuildingVertexBytes,
  );
  return {
    x: view.getUint16(0, true),
    y: view.getUint16(2, true),
    base: view.getUint16(4, true) / 10,
    top: view.getUint16(6, true) / 10,
    normal: [view.getInt8(8) / 127, view.getInt8(9) / 127],
    raised: view.getUint8(10),
    wall: view.getUint8(11),
    tone: view.getUint8(20),
    corners: view.getUint8(22),
    length: view.getUint8(23),
    feature: view.getUint16(24, true),
  };
}

test('a building becomes a roof and four walls facing out of it', () => {
  const mesh = meshTileflowBuildings(
    layerOf([{geometry: [square], properties: {building_tone: 'commercial'}}]),
    {tileMetres: 1000},
  );
  assert.ok(mesh);
  assert.equal(mesh.vertices.length, 20 * tileflowBuildingVertexBytes);
  assert.equal(mesh.wallsFrom, 6);
  assert.equal(mesh.indices.length, 6 + 4 * 6);
  assert.equal(mesh.top, 30);
  assert.equal(mesh.features.length, 1);
  const roof = vertex(mesh, 0);
  assert.equal(roof.raised, 1);
  assert.equal(roof.wall, 0);
  assert.equal(roof.top, 30);
  assert.equal(roof.tone, 1);
  // Scaled from the 4096 extent to the renderer's 8192.
  assert.equal(roof.x, 2000);
  // Every wall's normal points away from the square's centre.
  const centre = [(2000 + 4000) / 2, (2000 + 4000) / 2];
  for (let index = 4; index < 20; index += 4) {
    const start = vertex(mesh, index);
    const end = vertex(mesh, index + 1);
    assert.equal(start.wall, 1);
    const middle = [(start.x + end.x) / 2, (start.y + end.y) / 2];
    const outward =
      start.normal[0]! * (middle[0]! - centre[0]!) + start.normal[1]! * (middle[1]! - centre[1]!);
    assert.ok(outward > 0, `wall ${index} faces in`);
    // A convex square has no tight corner.
    assert.equal(start.corners, 0);
  }
  // 2000 units of 8192 at 1000 m per tile: about 244 m a side.
  assert.equal(vertex(mesh, 4).length, Math.round((2000 / tileflowBuildingExtent) * 1000));
});

test("an L's inside corner is tight for the walls that meet there", () => {
  // An L in tile units, clockwise: the inside corner is at (500, 500).
  const shape = [0, 0, 1000, 0, 1000, 500, 500, 500, 500, 1000, 0, 1000, 0, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [shape]}]), {tileMetres: 1000});
  assert.ok(mesh);
  const tight: number[] = [];
  for (let index = 6; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 4) {
    const start = vertex(mesh, index);
    if (start.corners) tight.push(start.corners);
  }
  // The wall arriving at the inside corner has it at its end; the one leaving, at its start.
  assert.deepEqual(tight.sort(), [1, 2]);
});

test('hidden buildings, other geometry and empty layers raise nothing', () => {
  assert.equal(
    meshTileflowBuildings(layerOf([{geometry: [square], properties: {hide_3d: true}}]), {
      tileMetres: 1000,
    }),
    undefined,
  );
  assert.equal(
    meshTileflowBuildings(
      {extent: 4096, features: [{type: 'LineString', properties: {}, geometry: [[0, 0, 10, 10]]}]},
      {tileMetres: 1000},
    ),
    undefined,
  );
  assert.equal(meshTileflowBuildings({extent: 4096, features: []}, {tileMetres: 1000}), undefined);
});

test('a building the tile edge cuts has no wall along the edge', () => {
  // From x = -1000 to 1000 in the layer's units before the shift: half of it lies past the edge.
  const across = [-2000, 0, 0, 0, 0, 1000, -2000, 1000, -2000, 0];
  const mesh = meshTileflowBuildings(layerOf([{geometry: [across]}]), {tileMetres: 1000});
  assert.ok(mesh);
  for (let index = 0; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    assert.ok(vertex(mesh, index).x >= 0);
  }
  // Three walls: the one on the tile's left edge belongs to the next tile.
  assert.equal(mesh.indices.length - mesh.wallsFrom, 3 * 6);
});

test('heights fall back to five metres and bases stay under the top', () => {
  const mesh = meshTileflowBuildings(
    {
      extent: 4096,
      features: [
        {type: 'Polygon', properties: {}, geometry: [square]},
        {
          type: 'Polygon',
          properties: {render_height: 20, render_min_height: 50},
          geometry: [square],
        },
      ],
    },
    {tileMetres: 1000},
  );
  assert.ok(mesh);
  assert.equal(vertex(mesh, 0).top, 5);
  const second = vertex(mesh, 20);
  assert.equal(second.feature, 1);
  assert.equal(second.base, 20);
  assert.equal(second.top, 20);
});

test('the sun sees nearer points at a smaller depth and holds the whole box', () => {
  const box = {min: [-500, -500, 0], max: [500, 500, 100]};
  const light = tileflowSunLightMatrix([0, -0.5, 0.866], box);
  const apply = ([x, y, z]: number[]) => {
    const m = light.matrix;
    return [0, 1, 2].map(
      (row) => m[row]! * x! + m[4 + row]! * y! + m[8 + row]! * z! + m[12 + row]!,
    );
  };
  for (const x of [-500, 500])
    for (const y of [-500, 500])
      for (const z of [0, 100])
        for (const value of apply([x, y, z])) assert.ok(Math.abs(value) <= 1, `${x} ${y} ${z}`);
  // A roof is nearer the sun than the ground under it.
  assert.ok(apply([0, 0, 100])[2]! < apply([0, 0, 0])[2]!);
  assert.ok(light.depth > 0);
  assert.ok(light.extent > 1000);
});

function fakeMap() {
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Set<string>();
  return {
    layers,
    listeners,
    addLayer(layer: {id: string}) {
      layers.add(layer.id);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 25.76, lng: -80.19}),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getPaintProperty: () => undefined,
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle: () => ({layers: [{id: 'labels', type: 'symbol'}]}),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    triggerRepaint() {},
  };
}

test('the renderer puts its layer on the map, grows without a renderer and leaves cleanly', async () => {
  const map = fakeMap();
  const buildings = createTileflowBuildings3D({map});
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  await buildings.grow(0.5, {transition: {duration: 0}});
  assert.equal(buildings.scale, 0.5);
  await buildings.show({transition: {duration: 0}});
  assert.equal(buildings.scale, 1);
  await assert.rejects(buildings.grow(Number.NaN), RangeError);
  await assert.rejects(buildings.grow(1, {transition: {duration: -1}}), RangeError);
  assert.deepEqual(buildings.stats, {tiles: 0, buildings: 0, vertices: 0});
  buildings.dispose();
  assert.equal(map.layers.has(tileflowBuildings3DLayerId), false);
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('renderer options are validated', () => {
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), minzoom: 30}), RangeError);
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), maxTiles: 0}), RangeError);
  assert.throws(() => createTileflowBuildings3D({map: fakeMap(), maxTiles: 100}), RangeError);
});
