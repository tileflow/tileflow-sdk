import {MeshoptEncoder} from 'meshoptimizer/encoder';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTileflowModels,
  encodeTileflowModels,
  type TileflowModelEntry,
} from '../src/models-3d-file';
import type {TileflowModelMesh} from '../src/models-3d-model';

const pixel = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function mesh(): TileflowModelMesh {
  return {
    positions: [0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    normals: Array.from({length: 6}, () => [0, 0, 1]).flat(),
    parts: [0, 0, 0, 0, 0, 0],
    lightingRoles: [1, 1, 1, 1, 1, 1],
    shades: [0, 0, 0, 0, 0, 0],
    occlusion: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
    indices: [0, 1, 2, 3, 4, 5],
    surface: {
      // UV0, UV1, and linear vertex RGBA. Coincident triangles have different UV seams.
      attributes: [
        0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0.25, 0, 0, 0, 1, 1,
        1, 1, 0.75, 0, 1, 0, 1, 1, 1, 1, 0.25, 1, 0, 1, 1, 1, 1, 1,
      ],
      materials: [
        {
          baseColorFactor: [0.8, 0.7, 0.6, 0.9],
          metallicFactor: 0.6,
          roughnessFactor: 0.25,
          emissiveFactor: [0.2, 0.1, 0],
          emissiveStrength: 2,
          alphaMode: 'MASK',
          alphaCutoff: 0.4,
          doubleSided: true,
          baseColorTexture: {
            texture: 0,
            texCoord: 1,
            offset: [0.2, 0.3],
            scale: [2, 3],
            rotation: 0.4,
          },
          occlusionTexture: {texture: 0, strength: 0.7},
        },
      ],
      textures: [
        {
          mimeType: 'image/png',
          bytes: pixel,
          width: 1,
          height: 1,
          wrapS: 33071,
          wrapT: 10497,
          minFilter: 9987,
          magFilter: 9729,
        },
      ],
      ranges: [{from: 0, count: 6, material: 0}],
      emitters: [
        {start: [0, 0, 0], end: [2, 0, 0], height: 3, depth: 0.2, role: 'door', part: 'accent'},
      ],
    },
  };
}

const model = (level = mesh()): TileflowModelEntry => ({
  id: 'material-fixture',
  levels: [level],
  footprint: [[0, 0, 2, 0, 2, 2, 0, 2]],
});

test('physical material data survives prepared model compression independently of palette and AO', async () => {
  await MeshoptEncoder.ready;
  for (const compressor of [undefined, MeshoptEncoder]) {
    const bytes = encodeTileflowModels([model()], compressor);
    const decoded = (await decodeTileflowModels(bytes))![0]!.levels[0]!;
    assert.ok(decoded.surface, 'physical data must survive transport');
    assert.deepEqual(decoded.surface.materials, mesh().surface!.materials);
    assert.deepEqual(decoded.surface.textures, mesh().surface!.textures);
    assert.deepEqual(decoded.surface.emitters, mesh().surface!.emitters);
    assert.deepEqual(decoded.surface.ranges, [{from: 0, count: 6, material: 0}]);
    assert.equal(decoded.surface.attributes.length, (decoded.vertices.length / 16) * 8);
    for (let at = 0; at < decoded.vertices.length; at += 16) {
      assert.equal(decoded.vertices[at + 12], 0);
      assert.equal(decoded.vertices[at + 14], 102);
      assert.equal(decoded.vertices[at + 15], 1);
    }
  }
});

test('physical UV seams survive welding and triangle reordering', async () => {
  await MeshoptEncoder.ready;
  const decoded = (await decodeTileflowModels(encodeTileflowModels([model()], MeshoptEncoder)))![0]!
    .levels[0]!;
  assert.equal(
    decoded.vertices.length / 16,
    6,
    'coincident vertices with different UVs must stay separate',
  );
  const uv = [...decoded.indices].map((index) => decoded.surface!.attributes[index * 8]);
  assert.deepEqual([...uv].sort(), [0, 0, 0.25, 0.25, 0.75, 1].sort());
});

test('material references, image budgets and draw ranges fail before encoding invalid models', () => {
  const base = mesh();
  const surface = base.surface!;
  for (const broken of [
    {...surface, attributes: [0, 0]},
    {...surface, ranges: [{from: 0, count: 3, material: 9}]},
    {...surface, ranges: [{from: 0, count: 3, material: 0}]},
    {...surface, materials: [{baseColorTexture: {texture: 9}}]},
    {...surface, textures: [{...surface.textures[0]!, width: 100_000}]},
    {...surface, emitters: [{...surface.emitters![0]!, height: -1}]},
  ]) {
    assert.throws(() => encodeTileflowModels([model({...base, surface: broken})]), RangeError);
  }
});
