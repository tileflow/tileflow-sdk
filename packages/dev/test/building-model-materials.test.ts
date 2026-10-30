import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareTileflowBuildingModelMesh} from '../src/building-model-mesh';
import {readTileflowGltfTriangles} from '../src/gltf-reader';
import {writeGlb} from './tree-model-fixtures';

const image = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const geometry = {material: 'surface', positions: [0, 1, 0, 1, 1, 0, 0, 1, -1], indices: [0, 1, 2]};

test('building import preserves glTF physical channels without changing semantic colours or roles', () => {
  const bytes = writeGlb(
    [
      {
        ...geometry,
        lightingRole: 'door',
        texcoords: [0, 0, 1, 0, 0, 1],
        texcoords1: [0.25, 0, 0.75, 0, 0.25, 1],
        vertexColors: [0.5, 0.6, 0.7, 1, 0.5, 0.6, 0.7, 1, 0.5, 0.6, 0.7, 1],
        materialData: {
          pbrMetallicRoughness: {
            baseColorFactor: [0.8, 0.7, 0.6, 0.9],
            metallicFactor: 0.4,
            roughnessFactor: 0.3,
            baseColorTexture: {
              index: 0,
              extensions: {
                KHR_texture_transform: {
                  texCoord: 1,
                  offset: [0.1, 0.2],
                  scale: [2, 3],
                  rotation: 0.5,
                },
              },
            },
            metallicRoughnessTexture: {index: 0},
          },
          normalTexture: {index: 0, scale: 0.7},
          occlusionTexture: {index: 0, strength: 0.6},
          emissiveTexture: {index: 0},
          emissiveFactor: [0.2, 0.3, 0.4],
          extensions: {KHR_materials_emissive_strength: {emissiveStrength: 3}},
          alphaMode: 'MASK',
          alphaCutoff: 0.35,
          doubleSided: true,
        },
      },
    ],
    {
      textures: [{source: 0, sampler: 0}],
      samplers: [{wrapS: 33071, wrapT: 33648, minFilter: 9729}],
    },
    [{bytes: image, mimeType: 'image/png'}],
  );
  const mesh = prepareTileflowBuildingModelMesh(bytes);
  assert.deepEqual(mesh.parts, [0, 0, 0]);
  assert.deepEqual(mesh.lightingRoles, [2, 2, 2]);
  assert.ok(mesh.surface, 'physical channels must not disappear at import');
  const material = mesh.surface.materials[0]!;
  assert.deepEqual(material.baseColorFactor, [0.8, 0.7, 0.6, 0.9]);
  assert.equal(material.metallicFactor, 0.4);
  assert.equal(material.roughnessFactor, 0.3);
  assert.equal(material.emissiveStrength, 3);
  assert.equal(material.alphaMode, 'MASK');
  assert.equal(material.normalTexture!.strength, 0.7);
  assert.equal(material.occlusionTexture!.strength, 0.6);
  assert.deepEqual(material.baseColorTexture, {
    texture: 0,
    texCoord: 1,
    offset: [0.1, 0.2],
    scale: [2, 3],
    rotation: 0.5,
  });
  assert.deepEqual(mesh.surface.textures[0]!.bytes, image);
  assert.equal(mesh.surface.textures[0]!.wrapT, 33648);
  assert.deepEqual(mesh.surface.ranges, [{from: 0, count: 3, material: 0, emissiveBounds: [1, 1]}]);
  assert.ok(
    Math.abs(mesh.surface.attributes[4]! - 0.5) < 1e-6,
    'vertex colour must not include the material factor twice',
  );
  assert.equal(
    readTileflowGltfTriangles(bytes)[0]!.surface,
    undefined,
    'the tree reader retains its geometry-only path',
  );
});

test('separate source meshes keep their own emission height even when sharing a material', () => {
  const mesh = prepareTileflowBuildingModelMesh(
    writeGlb([geometry, {...geometry, translation: [0, 3, 0]}]),
  );
  assert.equal(mesh.surface!.materials.length, 1);
  assert.deepEqual(
    mesh.surface!.ranges.map((range) => range.emissiveBounds),
    [
      [1, 1],
      [4, 4],
    ],
  );
});

test('explicit area emitters follow node transforms and keep lighting roles independent of palette', () => {
  const mesh = prepareTileflowBuildingModelMesh(
    writeGlb([
      {
        ...geometry,
        translation: [10, 2, 20],
        nodeExtras: {
          tileflow: {
            emitters: [
              {
                start: [-1, 0, 0],
                end: [1, 0, 0],
                height: 3,
                depth: 0.2,
                role: 'door',
                part: 'accent',
              },
            ],
          },
        },
      },
    ]),
  );
  assert.deepEqual(mesh.surface!.emitters, [
    {
      start: [9, -20, 2],
      end: [11, -20, 2],
      height: 3,
      depth: 0.2,
      role: 'door',
      part: 'accent',
    },
  ]);
  assert.equal(
    prepareTileflowBuildingModelMesh(writeGlb([geometry])).surface?.emitters?.length ?? 0,
    0,
  );
});

test('import rejects missing UVs and external or invalid images before preparing a textured model', () => {
  const materialData = {pbrMetallicRoughness: {baseColorTexture: {index: 0}}};
  assert.throws(
    () =>
      prepareTileflowBuildingModelMesh(
        writeGlb([{...geometry, materialData}], {textures: [{source: 0}]}, [
          {bytes: image, mimeType: 'image/png'},
        ]),
      ),
    /texture|UV|coordinate/i,
  );
  assert.throws(
    () =>
      prepareTileflowBuildingModelMesh(
        writeGlb([{...geometry, texcoords: [0, 0, 1, 0, 0, 1], materialData}], {
          textures: [{source: 0}],
          images: [{uri: 'https://example.test/private.png'}],
        }),
      ),
    /embed|external|image/i,
  );
  assert.throws(
    () =>
      prepareTileflowBuildingModelMesh(
        writeGlb(
          [{...geometry, texcoords: [0, 0, 1, 0, 0, 1], materialData}],
          {textures: [{source: 0}]},
          [{bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png'}],
        ),
      ),
    /image|PNG/i,
  );
});

test('a second UV set outside the unit square is rejected', () => {
  assert.throws(
    () =>
      prepareTileflowBuildingModelMesh(
        writeGlb([{...geometry, texcoords: [0, 0, 1, 0, 0, 1], texcoords1: [0, 0, 2, 0, 0, 1]}]),
      ),
    /TEXCOORD_1/u,
  );
});
