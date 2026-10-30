import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {bakeBuildingModelLightmap} from '../src/building-model-lightmap';
import {prepareTileflowBuildingModelMesh} from '../src/building-model-mesh';
import {writeGlb} from './tree-model-fixtures';

// A wall four metres wide and ten tall, facing south, standing a little above a wide ground.
const scene = {
  positions: [
    ...[-2, 0, 0.1, 2, 0, 0.1, 2, 0, 10, -2, 0, 10],
    ...[-6, -6, 0, 6, -6, 0, 6, 6, 0, -6, 6, 0],
  ],
  normals: [...Array(4).fill([0, -1, 0]).flat(), ...Array(4).fill([0, 0, 1]).flat()],
  indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
};

function wallSky(
  lightmap: NonNullable<ReturnType<typeof bakeBuildingModelLightmap>>,
  height: number,
) {
  // The output vertices of the wall's corners, by source.
  const at = (source: number) => lightmap.sources.indexOf(source);
  const [bottom, top, right] = [at(0), at(3), at(1)];
  const t = (height - 0.1) / 9.9;
  const uv = [0, 1].map(
    (axis) =>
      lightmap.uvs[bottom * 2 + axis]! +
      (lightmap.uvs[top * 2 + axis]! - lightmap.uvs[bottom * 2 + axis]!) * t +
      (lightmap.uvs[right * 2 + axis]! - lightmap.uvs[bottom * 2 + axis]!) * 0.5,
  );
  const x = Math.min(lightmap.width - 1, Math.floor(uv[0]! * lightmap.width));
  const y = Math.min(lightmap.height - 1, Math.floor(uv[1]! * lightmap.height));
  return lightmap.texels[y * lightmap.width + x]! / 255;
}

test('a lightmap keeps contact shade at the foot of a tall wall and open sky above it', () => {
  const lightmap = bakeBuildingModelLightmap(scene, {texels: 16_384})!;
  assert.ok(lightmap, 'the scene fits the budget');
  assert.ok(lightmap.width * lightmap.height <= 16_384);
  const [foot, top] = [wallSky(lightmap, 0.2), wallSky(lightmap, 8)];
  assert.ok(foot < 0.8 && top > 0.9 && top - foot > 0.15, `foot ${foot}, top ${top}`);
  // Triangles keep their order and positions; vertices only split where charts meet.
  assert.equal(lightmap.indices.length, scene.indices.length);
  for (const [at, vertex] of lightmap.indices.entries())
    assert.equal(lightmap.sources[vertex], scene.indices[at]);
  assert.ok(lightmap.uvs.every((value) => value > 0 && value < 1));
  assert.equal(lightmap.texels.length, lightmap.width * lightmap.height);
  assert.deepEqual(bakeBuildingModelLightmap(scene, {texels: 16_384}), lightmap);
});

test('a lightmap density follows its texel budget', () => {
  const small = bakeBuildingModelLightmap(scene, {texels: 4096})!;
  const large = bakeBuildingModelLightmap(scene, {texels: 65_536})!;
  assert.ok(small.density < large.density);
  assert.ok(large.width * large.height <= 65_536);
  assert.equal(bakeBuildingModelLightmap(scene, {texels: 16}), undefined);
});

// The same scene as a glTF file, Y up, so preparation reads its materials.
const file = () =>
  writeGlb([
    {
      material: 'surface',
      positions: [-2, 0.1, 0, 2, 0.1, 0, 2, 10, 0, -2, 10, 0],
      indices: [0, 1, 2, 0, 2, 3],
    },
    {
      material: 'roof',
      positions: [-6, 0, -6, -6, 0, 6, 6, 0, 6, 6, 0, -6],
      indices: [0, 1, 2, 0, 2, 3],
    },
  ]);

test('preparation can carry visibility in an occlusion texture instead of its vertices', async () => {
  const mesh = prepareTileflowBuildingModelMesh(file(), {lightmapTexels: 16_384});
  const surface = mesh.surface!;
  const texture = surface.textures.at(-1)!;
  assert.equal(texture.mimeType, 'image/jpeg');
  const {width, height, channels} = await sharp(Buffer.from(texture.bytes)).metadata();
  assert.deepEqual([width, height, channels], [texture.width, texture.height, 1]);
  assert.ok(texture.width * texture.height <= 16_384);
  for (const material of surface.materials)
    assert.deepEqual(material.occlusionTexture, {
      texture: surface.textures.length - 1,
      texCoord: 1,
    });
  assert.ok(
    mesh.occlusion.every((value) => value === 1),
    'the texture replaces vertex visibility',
  );
  assert.equal(surface.attributes.length, (mesh.positions.length / 3) * 8);
  assert.equal(mesh.indices.length, 12);
  assert.deepEqual(prepareTileflowBuildingModelMesh(file(), {lightmapTexels: 16_384}), mesh);
});

test('preparation keeps vertex visibility without a lightmap budget or when one cannot fit', () => {
  for (const mesh of [
    prepareTileflowBuildingModelMesh(file()),
    prepareTileflowBuildingModelMesh(file(), {lightmapTexels: 16}),
  ]) {
    assert.ok(!mesh.surface!.materials.some((material) => material.occlusionTexture));
    assert.ok(
      mesh.occlusion.some((value) => value < 0.9),
      'vertex visibility remains',
    );
  }
});

test("preparation can size the occlusion texture by the level's surface", () => {
  const areas: number[] = [];
  const mesh = prepareTileflowBuildingModelMesh(file(), {
    lightmapTexels: (area) => (areas.push(area), 16_384),
  });
  // The wall's 4 × 9.9 m and the ground's 12 × 12 m.
  assert.ok(Math.abs(areas[0]! - (4 * 9.9 + 144)) < 1e-6);
  assert.ok(mesh.surface!.materials.every((material) => material.occlusionTexture));
});
