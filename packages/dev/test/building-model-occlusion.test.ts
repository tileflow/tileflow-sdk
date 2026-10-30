import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareTileflowBuildingModelMesh} from '../src/building-model-mesh';
import type {TileflowGltfPrimitive} from '../src/gltf-reader';
import {writeGlb} from './tree-model-fixtures';

function plane(z: number, halfWidth: number, material = 'surface'): TileflowGltfPrimitive {
  return {
    material,
    positions: [
      -halfWidth,
      -halfWidth,
      z,
      halfWidth,
      -halfWidth,
      z,
      halfWidth,
      halfWidth,
      z,
      -halfWidth,
      halfWidth,
      z,
    ],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    colours: new Array<number>(12).fill(0.5),
    indices: [0, 1, 2, 0, 2, 3],
  };
}

test('model preparation distinguishes exposed surfaces from a geometric recess', () => {
  const surface = plane(0.2, 0.1);
  const exposed = prepareTileflowBuildingModelMesh([surface]);
  const recessed = prepareTileflowBuildingModelMesh([surface, plane(0.5, 3, 'roof')]);
  assert.ok(exposed.occlusion.every((value) => value > 0.99));
  assert.ok(
    recessed.occlusion.slice(0, 4).every((value) => value < 0.65),
    'nearby geometry must block ambient light on the lower surface',
  );
  assert.ok(recessed.occlusion.slice(4).every((value) => value > 0.99));
  assert.deepEqual(recessed.positions.slice(0, 12), exposed.positions);
  assert.deepEqual(recessed.normals.slice(0, 12), exposed.normals);
  assert.deepEqual(recessed.shades.slice(0, 4), exposed.shades);
});

test('ambient visibility is deterministic, independent of colour, and ignores footprint meshes', () => {
  const geometry = [plane(0.2, 0.1), plane(0.5, 3, 'roof')];
  const first = prepareTileflowBuildingModelMesh(geometry);
  const recoloured = prepareTileflowBuildingModelMesh(
    geometry.map((part) => ({...part, colours: part.colours.map(() => 0.9)})),
  );
  assert.deepEqual(first.occlusion, recoloured.occlusion);
  assert.deepEqual(first.occlusion, prepareTileflowBuildingModelMesh(geometry).occlusion);
  assert.deepEqual(
    prepareTileflowBuildingModelMesh([geometry[0]!, plane(0.5, 3, 'footprint')]).occlusion,
    [1, 1, 1, 1],
  );
  assert.ok(
    prepareTileflowBuildingModelMesh([geometry[0]!, plane(100, 3)])
      .occlusion.slice(0, 4)
      .every((value) => value > 0.99),
    'distant geometry must not create local contact occlusion',
  );
});

test('architectural lighting roles remain independent of parts and default explicitly', () => {
  const base = plane(1, 1);
  const mesh = prepareTileflowBuildingModelMesh([
    {...base, material: 'surface', lightingRole: 'door'},
    {...base, material: 'surface', lightingRole: 'wall'},
    {...base, material: 'glass'},
    {...base, material: 'roof'},
    {...base, material: 'accent', lightingRole: 'unclassified'},
  ]);
  assert.deepEqual(mesh.partNames, ['surface', 'glass', 'roof', 'accent']);
  assert.deepEqual(
    mesh.parts.filter((_, i) => i % 4 === 0),
    [0, 0, 1, 2, 3],
  );
  assert.deepEqual(
    mesh.lightingRoles!.filter((_, i) => i % 4 === 0),
    [2, 1, 4, 3, 0],
  );
  assert.throws(
    () => prepareTileflowBuildingModelMesh([{...base, lightingRole: 'dooor'}]),
    /unknown lighting role/,
  );

  const fromFile = prepareTileflowBuildingModelMesh(
    writeGlb([
      {
        material: 'accent',
        lightingRole: 'logo',
        positions: [0, 1, 0, 1, 1, 0, 0, 2, 0],
        indices: [0, 1, 2],
      },
    ]),
  );
  assert.deepEqual(fromFile.partNames, ['accent']);
  assert.deepEqual(fromFile.parts, [0, 0, 0]);
  assert.deepEqual(fromFile.lightingRoles, [6, 6, 6]);
});
