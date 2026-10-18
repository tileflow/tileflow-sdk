import assert from 'node:assert/strict';
import test from 'node:test';
import {meshTileflowBuildings, tileflowBuildingVertexBytes} from '../src/buildings-3d-mesh';
import {buildingContactSegments} from '../src/buildings-3d-occlusion';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

test('contact segments follow real wall indices across buildings, courtyards and rounded corners', () => {
  const layer: TileflowTileLayer = {
    extent: 8192,
    features: [
      {
        type: 'Polygon',
        properties: {render_height: 24},
        geometry: [
          [1000, 1000, 2000, 1000, 2000, 2000, 1000, 2000, 1000, 1000],
          [1250, 1250, 1250, 1750, 1750, 1750, 1750, 1250, 1250, 1250],
        ],
      },
      {
        type: 'Polygon',
        properties: {render_height: 12, render_min_height: 4},
        geometry: [[3000, 3000, 4000, 3000, 4000, 4000, 3000, 4000, 3000, 3000]],
      },
      {
        type: 'Polygon',
        properties: {render_height: 18},
        geometry: [[-500, 5000, 1000, 5000, 1000, 6000, -500, 6000, -500, 5000]],
      },
    ],
  };
  for (const edgeRadius of [0, 0.8]) {
    const mesh = meshTileflowBuildings(layer, {tileMetres: 1000, edgeRadius})!;
    const segments = buildingContactSegments(mesh);
    const source = new DataView(mesh.vertices.buffer);
    const packed = new DataView(segments.buffer);
    const count = segments.length / 16;
    assert.equal(count * 6, mesh.indices.length - mesh.wallsFrom);
    const heights = new Set<number>();
    let cuts = 0;
    let courtyard = 0;
    for (let wall = 0; wall < count; wall += 1) {
      const index = mesh.wallsFrom + wall * 6;
      const a = mesh.indices[index]! * tileflowBuildingVertexBytes;
      const b = mesh.indices[index + 1]! * tileflowBuildingVertexBytes;
      const at = wall * 16;
      assert.equal(source.getUint8(a + 11), 1, 'a roof must not create a ground shadow');
      for (const [offset, original] of [
        [0, a],
        [2, a + 2],
        [4, b],
        [6, b + 2],
        [8, a + 4],
        [10, a + 6],
      ])
        assert.equal(packed.getUint16(at + offset!, true), source.getUint16(original!, true));
      assert.equal(packed.getUint8(at + 12), source.getUint8(a + 14));
      assert.equal(packed.getUint8(at + 13), source.getUint8(a + 27));
      heights.add(packed.getUint16(at + 8, true));
      cuts += packed.getUint8(at + 13) > 0 ? 1 : 0;
      courtyard += source.getUint8(a + 22) & 4 ? 1 : 0;
      assert.ok(
        !(packed.getUint16(at, true) === 0 && packed.getUint16(at + 4, true) === 0),
        'tile cuts must not introduce a wall',
      );
    }
    assert.deepEqual(
      heights,
      new Set([0, 40]),
      'raised parts retain their base for rejection on the GPU',
    );
    assert.equal(cuts, 2);
    assert.equal(courtyard, 4);
  }
});
