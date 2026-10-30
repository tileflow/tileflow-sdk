import assert from 'node:assert/strict';
import test from 'node:test';
import {
  meshTileflowBuildings,
  tileflowBuildingExtent,
  tileflowBuildingVertexBytes,
} from '../src/buildings-3d-mesh';
import {tileflowRoofOf} from '../src/buildings-3d-roofs';

const extent = tileflowBuildingExtent;
// A 20 m by 10 m building, its long side east-west, at one tile unit per metre.
const rectangle = [1000, 1000, 1020, 1000, 1020, 1010, 1000, 1010];
const roofOf = (properties: Record<string, unknown>, ring = rectangle, top = 12) =>
  tileflowRoofOf(ring, ring, properties, 0, top, 1, extent);
const close = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 0.05, `${label}: ${actual} is not ${expected}`);

test('a gabled roof rises from the eaves to a ridge along the long side', () => {
  const roof = roofOf({roof_shape: 'gabled', roof_height: 3})!;
  assert.ok(roof);
  assert.equal(roof.faces.length, 2);
  close(roof.ridge, 12, 'ridge');
  close(roof.eaves, 9, 'eaves');
  close(roof.heightAt(1010, 1005), 12, 'middle');
  close(roof.heightAt(1010, 1000), 9, 'long side');
  close(roof.heightAt(1000, 1005), 12, 'gable end at the ridge');
  // The gable ends rise to the ridge halfway; the long walls stay at the eaves.
  assert.deepEqual(roof.breaks(1000, 1000, 1000, 1010), [0.5]);
  assert.deepEqual(roof.breaks(1000, 1000, 1020, 1000), []);
  // Each face tilts away from the ridge.
  const tilts = roof.faces.map((face) => Math.sign(face.normal[1])).sort();
  assert.deepEqual(tilts, [-1, 1]);
});

test('a ridge follows the stated orientation or the slope direction', () => {
  const across = roofOf({roof_shape: 'gabled', roof_height: 3, roof_orientation: 'across'})!;
  close(across.heightAt(1010, 1000), 12, 'ridge across the building');
  close(across.heightAt(1000, 1005), 9, 'end walls at the eaves');
  // Slopes facing east and west put the ridge north-south.
  const facingEast = roofOf({roof_shape: 'gabled', roof_height: 3, roof_direction: 90})!;
  close(facingEast.heightAt(1010, 1000), 12, 'ridge north-south');
});

test('hipped, pyramidal, mansard and skillion roofs take their own planes', () => {
  const hipped = roofOf({roof_shape: 'hipped', roof_height: 3})!;
  assert.equal(hipped.faces.length, 4);
  close(hipped.heightAt(1000, 1005), 9, 'hipped end');
  close(hipped.heightAt(1010, 1005), 12, 'hipped ridge');
  assert.deepEqual(hipped.breaks(1000, 1000, 1000, 1010), []);
  const pyramid = roofOf({roof_shape: 'pyramidal', roof_height: 3})!;
  assert.equal(pyramid.faces.length, 4);
  close(pyramid.heightAt(1015, 1005), 10.5, 'pyramid halfway along');
  const mansard = roofOf({roof_shape: 'mansard', roof_height: 4})!;
  assert.ok(mansard.faces.length >= 8);
  // The steep lower slope reaches 65 % of the roof over 40 % of the half width.
  close(mansard.heightAt(1010, 1002), 8 + 4 * 0.65, 'mansard break');
  const skillion = roofOf({roof_shape: 'skillion', roof_height: 2, roof_direction: 180})!;
  assert.equal(skillion.faces.length, 1);
  // Facing south: high on the north side (smaller y in the tile).
  close(skillion.heightAt(1010, 1000), 12, 'north side');
  close(skillion.heightAt(1010, 1010), 10, 'south side');
});

test('without a stated height the roof keeps a usual pitch and sits on the walls', () => {
  // From levels: the walls keep their height and the roof stands on them.
  const onWalls = roofOf({roof_shape: 'gabled', height_source: 'levels'})!;
  close(onWalls.eaves, 12, 'eaves');
  close(onWalls.ridge, 12 + 5 * Math.tan(Math.PI / 6), 'ridge at 30 degrees');
  // A measured height reaches the ridge.
  const measured = roofOf({roof_shape: 'gabled', height_source: 'height'})!;
  close(measured.ridge, 12, 'measured ridge');
});

test('some buildings keep a flat roof', () => {
  assert.equal(roofOf({}), undefined);
  assert.equal(roofOf({roof_shape: 'flat'}), undefined);
  assert.equal(roofOf({roof_shape: 'sawtooth'}), undefined);
  // An L fills too little of its rectangle.
  const l = [1000, 1000, 1020, 1000, 1020, 1004, 1004, 1004, 1004, 1020, 1000, 1020];
  assert.equal(roofOf({roof_shape: 'gabled'}, l), undefined);
  // A building the tile's buffer cut at its western edge.
  const cut = [-64, 1000, 20, 1000, 20, 1010, -64, 1010];
  assert.equal(roofOf({roof_shape: 'gabled'}, cut), undefined);
});

test('a domed tower is faceted and highest at its centre', () => {
  const ring: number[] = [];
  for (let k = 0; k < 24; k += 1) {
    const angle = (k / 24) * 2 * Math.PI;
    ring.push(2000 + 10 * Math.cos(angle), 2000 + 10 * Math.sin(angle));
  }
  const dome = roofOf({roof_shape: 'dome', roof_height: 8}, ring, 30)!;
  assert.ok(dome.faces.length > 12);
  close(dome.heightAt(2000, 2000), 30, 'top');
  assert.ok(dome.heightAt(2009, 2000) < 26, 'edge');
});

test('the mesh raises gable ends and tilts the roof', () => {
  const layer = {
    extent: 4096,
    features: [
      {
        type: 'Polygon' as const,
        properties: {render_height: 12, roof_shape: 'gabled', roof_height: 3},
        geometry: [[1000, 1000, 1100, 1000, 1100, 1050, 1000, 1050, 1000, 1000]],
      },
    ],
  };
  const mesh = meshTileflowBuildings(layer, {tileMetres: 1000})!;
  assert.ok(mesh);
  close(mesh.top, 12, 'top');
  const tops = new Set<number>();
  let tilted = 0;
  for (let index = 0; index < mesh.vertices.length / tileflowBuildingVertexBytes; index += 1) {
    const view = new DataView(mesh.vertices.buffer, index * tileflowBuildingVertexBytes);
    if (view.getUint8(10) === 1) tops.add(view.getUint16(6, true) / 10);
    if (view.getUint8(11) === 0 && view.getInt8(9) !== 0) tilted += 1;
  }
  assert.deepEqual(
    [...tops].sort((a, b) => a - b),
    [9, 12],
  );
  assert.ok(tilted > 0, 'roof normals tilt');
});

test('rounded walls join shaped roofs and culling bounds contain the ridge', () => {
  const mesh = meshTileflowBuildings(
    {
      extent: 4096,
      features: [
        {
          type: 'Polygon',
          properties: {
            render_height: 12,
            roof_shape: 'gabled',
            height_source: 'levels',
            class: 'residential',
          },
          geometry: [[1000, 1000, 1100, 1000, 1100, 1050, 1000, 1050, 1000, 1000]],
        },
      ],
    },
    {tileMetres: 1000, edgeRadius: 0.8},
  )!;
  assert.ok(mesh.top > 12, 'the roof rises above the level-derived wall height');
  assert.ok(
    mesh.groups!.every(({bounds}) => bounds[4] >= mesh.top),
    'the ridge is not culled',
  );
  const roofPoints = new Set<string>();
  const wallPoints: string[] = [];
  for (let offset = 0; offset < mesh.vertices.length; offset += tileflowBuildingVertexBytes) {
    const view = new DataView(
      mesh.vertices.buffer,
      mesh.vertices.byteOffset + offset,
      tileflowBuildingVertexBytes,
    );
    const key = [view.getUint16(0, true), view.getUint16(2, true), view.getUint16(6, true)].join(
      ',',
    );
    assert.equal(
      Math.floor(view.getUint8(20) / 4),
      1,
      'the residential window class survives rounding',
    );
    if (view.getUint8(11) === 0) roofPoints.add(key);
    else if (view.getUint8(10) === 1) wallPoints.push(key);
  }
  assert.ok(wallPoints.length > 16, 'the footprint has rounded corner segments');
  for (const point of wallPoints) assert.ok(roofPoints.has(point), `wall meets roof at ${point}`);
});
