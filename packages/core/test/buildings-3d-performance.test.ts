import assert from 'node:assert/strict';
import test from 'node:test';
import {meshTileflowBuildings} from '../src/buildings-3d-mesh';
import {buildingContactSegments} from '../src/buildings-3d-occlusion';
import {prepareBuildingTile, preparedBuildingTileTransfer} from '../src/buildings-3d-tile';
import {
  buildingBoxVisible,
  buildingCornerDetail,
  buildingDrawRanges,
} from '../src/buildings-3d-view';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

const layer: TileflowTileLayer = {
  extent: 8192,
  features: [500, 4500].map((x) => ({
    type: 'Polygon',
    properties: {render_height: 30},
    geometry: [[x, 500, x + 500, 500, x + 500, 1000, x, 1000, x, 500]],
  })),
};
const options = {tileMetres: 1000, edgeRadius: 0.8};

test('spatial batches cover every triangle once and merge for a fully visible tile', () => {
  const mesh = meshTileflowBuildings(layer, options)!;
  const shape = prepareBuildingTile(mesh).mesh;
  assert.equal(mesh.groups!.length, 2);
  assert.deepEqual(
    buildingDrawRanges(shape, () => true),
    [{from: 0, count: mesh.indices.length}],
  );
  const seen = new Set<number>();
  const view = new DataView(mesh.vertices.buffer);
  for (const group of mesh.groups!) {
    for (const [from, count] of [
      [group.roofsFrom, group.roofsCount],
      [group.wallsFrom, group.wallsCount],
    ]) {
      for (let at = from!; at < from! + count!; at += 1) {
        assert.ok(!seen.has(at));
        seen.add(at);
        const v = mesh.indices[at]! * 28;
        assert.ok(
          view.getUint16(v, true) >= group.bounds[0] && view.getUint16(v, true) <= group.bounds[2],
        );
        assert.ok(
          view.getUint16(v + 2, true) >= group.bounds[1] &&
            view.getUint16(v + 2, true) <= group.bounds[3],
        );
        assert.ok(view.getUint16(v + 6, true) / 10 <= group.bounds[4]);
      }
    }
  }
  assert.equal(seen.size, mesh.indices.length);
  assert.ok(
    buildingDrawRanges(shape, (group) => group.bounds[0] < 1000).reduce(
      (sum, range) => sum + range.count,
      0,
    ) < mesh.indices.length,
  );
});

test('a tile keeps only what drawing needs, with 16-bit indices when its vertices fit', () => {
  const mesh = meshTileflowBuildings(layer, options)!;
  const {mesh: shape, data} = prepareBuildingTile(mesh);
  assert.equal(shape.vertexCount, mesh.vertices.length / 28);
  assert.equal(shape.indexCount, mesh.indices.length);
  assert.ok(!('vertices' in shape) && !('indices' in shape));
  assert.ok(data.indices instanceof Uint16Array);
  assert.deepEqual([...data.indices], [...mesh.indices]);
  assert.deepEqual(data.contact, buildingContactSegments(mesh));
  const transfer = preparedBuildingTileTransfer({mesh: shape, data});
  assert.equal(new Set(transfer).size, 3, 'each array moves in its own buffer');
  // 65,537 vertices no longer fit 16 bits.
  const large = {...mesh, vertices: new Uint8Array(65_537 * 28)};
  assert.ok(prepareBuildingTile(large).data.indices instanceof Uint32Array);
});

test('clip tests retain intersecting boxes, elevated roofs and off-camera shadow casters', () => {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(buildingBoxVisible(matrix, [-2, -2, -2, 2, 2, 2]), true);
  assert.equal(buildingBoxVisible(matrix, [2, 0, 0, 3, 1, 1]), false);
  assert.equal(buildingBoxVisible(matrix, [0, 0, 0, 1, 1, 1]), true);
  const camera = [...matrix];
  camera[9] = -1;
  assert.equal(buildingBoxVisible(camera, [0, 2, 0, 1, 3, 3]), true);
  const light = [...matrix];
  light[12] = -2;
  assert.equal(buildingBoxVisible(light, [2, 0, 0, 3, 1, 1]), true);
  assert.equal(buildingBoxVisible([NaN], [2, 0, 0, 3, 1, 1]), true);
});

test('distant rounding reduces geometry while close views keep the original tessellation', () => {
  const close = meshTileflowBuildings(layer, options)!;
  const middle = meshTileflowBuildings(layer, {...options, cornerAngle: Math.PI / 3})!;
  const far = meshTileflowBuildings(layer, {...options, edgeRadius: 0})!;
  assert.ok(far.vertices.length < middle.vertices.length);
  assert.ok(middle.vertices.length < close.vertices.length);
  assert.deepEqual(close.features, middle.features);
  assert.equal(close.top, far.top);
  assert.deepEqual(
    [15, 16, 18, 22].map((zoom) => buildingCornerDetail(zoom)),
    [0, 1, 2, 2],
  );
});

test('corner detail accounts for latitude, radius and an oblique foreground', () => {
  assert.equal(buildingCornerDetail(16, 80, 0.8, 60), 2);
  assert.equal(buildingCornerDetail(16, 40, 0.1, 0), 0);
  assert.equal(buildingCornerDetail(15, 40, 0.8, 80), 2);
});
