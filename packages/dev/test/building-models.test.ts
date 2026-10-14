import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {decodeTileflowModel, tileflowInsideRings, tileflowModelParts} from '@tileflow/core';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts} from '../src/artifacts';
import {
  isTileflowBuildingModel,
  prepareTileflowBuildingModelMesh,
  tileflowBuildingModelDeclaredFootprint,
  tileflowBuildingModelFootprint,
} from '../src/building-model-mesh';
import {readTileflowGltfTriangles} from '../src/gltf-reader';
import {prepareTileflowMapTreeModels, TileflowTreeModelError} from '../src/tree-models';
import {type GlbPart, writeGlb} from './tree-model-fixtures';
import {smallTree} from './tree-model-fixtures';

/**
 * A block of `width` × `depth` metres and `height` tall standing on its origin, its walls one
 * material and its roof another; glTF is Y up, so depth runs along its Z.
 */
function block(
  width: number,
  depth: number,
  height: number,
  materials: {wall?: string; roof?: string} = {},
  at: [number, number] = [0, 0],
): GlbPart[] {
  const [x0, z0] = [at[0] - width / 2, at[1] - depth / 2];
  const [x1, z1] = [at[0] + width / 2, at[1] + depth / 2];
  return [
    {
      material: materials.roof ?? 'roof',
      positions: [x0, height, z0, x1, height, z0, x1, height, z1, x0, height, z1],
      indices: [0, 2, 1, 0, 3, 2],
    },
    {
      material: materials.wall ?? 'surface',
      colour: [0.8, 0.8, 0.8],
      positions: [x0, 0, z1, x1, 0, z1, x1, height, z1, x0, height, z1],
      indices: [0, 1, 2, 0, 2, 3],
    },
  ];
}

test('a building model keeps its metres round its origin and its parts named by its materials', () => {
  const mesh = prepareTileflowBuildingModelMesh(writeGlb(block(20, 10, 30)));
  const axis = (index: number) => mesh.positions.filter((_, at) => at % 3 === index);
  assert.equal(Math.max(...axis(0)), 10);
  assert.equal(Math.min(...axis(0)), -10);
  assert.equal(Math.max(...axis(2)), 30);
  assert.equal(Math.min(...axis(2)), 0);
  // glTF's +Z (towards the viewer) becomes south.
  assert.equal(Math.min(...axis(1)), -5);
  assert.deepEqual(
    new Set(mesh.parts),
    new Set([tileflowModelParts.roof, tileflowModelParts.surface]),
  );
  // Each part takes its theme colour: a part of one colour is not shaded.
  assert.ok(mesh.shades.every((shade) => shade === 0));
});

test('the reader names what an author must change in a building model', () => {
  const problem = (parts: GlbPart[]) => {
    try {
      prepareTileflowBuildingModelMesh(writeGlb(parts));
    } catch (error) {
      return (error as Error).message;
    }
    return 'no error';
  };
  assert.match(
    problem(block(10, 10, 10, {wall: 'Brick'})),
    /"Brick" that names no part of a building/,
  );
  const sunk = block(10, 10, 10).map((part) => ({
    ...part,
    translation: [0, -3, 0] as [number, number, number],
  }));
  assert.match(problem(sunk), /reaches 3\.0 m below its origin/);
});

test("a footprint follows the model's outline on the ground, courtyards included", () => {
  // An L of two blocks: 40 × 10 m along x, and 10 × 30 m along y at its west end.
  const mesh = prepareTileflowBuildingModelMesh(
    writeGlb([...block(40, 10, 12), ...block(10, 30, 12, {}, [-15, -10])]),
  );
  const rings = tileflowBuildingModelFootprint(mesh);
  assert.ok(rings.length >= 1);
  assert.ok(tileflowInsideRings(rings, 0, 0));
  assert.ok(tileflowInsideRings(rings, -15, 15));
  // Inside the L's corner, outside the model: not covered.
  assert.ok(!tileflowInsideRings(rings, 10, 15));
  assert.ok(!tileflowInsideRings(rings, 30, 0));
});

test('a model may say what it stands in for with a footprint mesh, which is never drawn', () => {
  // Two thin posts 40 m apart, and a footprint covering the ground between them.
  const posts = [...block(2, 2, 30, {}, [-20, 0]), ...block(2, 2, 30, {}, [20, 0])];
  const ground: GlbPart = {
    material: 'Footprint',
    positions: [-25, 0, -10, 25, 0, -10, 25, 0, 10, -25, 0, 10],
    indices: [0, 2, 1, 0, 3, 2],
  };
  const primitives = readTileflowGltfTriangles(writeGlb([...posts, ground]));
  assert.ok(isTileflowBuildingModel(primitives));
  const mesh = prepareTileflowBuildingModelMesh(primitives);
  assert.equal(mesh.indices.length, 2 * 2 * 6);
  const declared = tileflowBuildingModelDeclaredFootprint(primitives);
  assert.ok(declared);
  assert.ok(tileflowInsideRings(tileflowBuildingModelFootprint(declared), 0, 0));
  // Without it, the ground between the posts is not covered.
  assert.ok(!tileflowInsideRings(tileflowBuildingModelFootprint(mesh), 0, 0));
});

test('a map prepares its building models as files and its tree models for its style', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-building-models-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await mkdir(join(cwd, 'models'));
  await writeFile(join(cwd, 'models', 'royal-palm.glb'), smallTree());
  await writeFile(join(cwd, 'models', 'tower.glb'), writeGlb(block(20, 20, 120)));
  await writeFile(join(cwd, 'models', 'tower.far.glb'), writeGlb(block(20, 20, 120)));
  const prepared = await prepareTileflowMapTreeModels(['./models'], {
    baseDirectory: cwd,
    configPath: 'maps.main.models',
    cwd,
    target: 'local',
  });
  assert.deepEqual(Object.keys(prepared.models), ['royal-palm']);
  assert.deepEqual(Object.keys(prepared.buildings), ['tower']);
  assert.match(prepared.buildings.tower!.fileName, /^tower-[0-9a-f]{16}\.tfmd$/u);
  const model = decodeTileflowModel(prepared.buildings.tower!.bytes);
  assert.equal(model?.levels.length, 2);
  assert.equal(model?.bounds[5], 120);
  assert.deepEqual(prepared.identities.map(({id, level}) => `${id}:${level}`).sort(), [
    'royal-palm:near',
    'tower:far',
    'tower:near',
  ]);

  await writeFile(join(cwd, 'models', 'royal-palm.mid.glb'), smallTree());
  await assert.rejects(
    prepareTileflowMapTreeModels(['./models'], {
      baseDirectory: cwd,
      configPath: 'maps.main.models',
      cwd,
      target: 'local',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TileflowTreeModelError);
      assert.match(error.message, /royal-palm\.mid\.glb: is a tree model/);
      return true;
    },
  );
});

test('a map places its building models: the style names their files, which the build writes', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-building-model-build-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await mkdir(join(cwd, 'models'));
  await writeFile(join(cwd, 'models', 'tower.glb'), writeGlb(block(20, 20, 120)));
  const config = (model: string) =>
    `import {buildings, defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'city',version:1,extends:streets,models:['./models'],modules:{buildings:buildings({mode:'3d',threeDimensional:{models:[{model:'${model}',at:[2.2945,48.8583],heading:45}],modelColors:{accent:'#806040'}}})},glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic']}});\n`;
  await writeFile(join(cwd, 'tileflow.config.ts'), config('tower'));

  const plan = await createTileflowBuildArtifacts({cwd});
  const style = Object.values(plan.styles.city!)[0]!;
  const design = (style.metadata as Record<string, any>)['tileflow:buildings'];
  assert.equal(design.models.length, 1);
  assert.equal(design.models[0].model, 'tower');
  assert.deepEqual(design.models[0].at, [2.2945, 48.8583]);
  assert.equal(design.models[0].heading, 45);
  assert.match(design.models[0].url, /models\/city\/tower-[0-9a-f]{16}\.tfmd$/u);
  assert.equal(design.modelColors.accent, '#806040');
  const asset = plan.assets.find((entry) => entry.fileName.startsWith('models/city/tower-'));
  assert.ok(asset);
  assert.ok(design.models[0].url.endsWith(asset.fileName));
  assert.ok(decodeTileflowModel(asset.source as Uint8Array));
  const manifest = plan.buildManifest as unknown as {
    maps: Record<string, {sourceAssets: {models?: {id: string; level: string}[]}}>;
  };
  assert.deepEqual(
    manifest.maps.city!.sourceAssets.models?.map(({id, level}) => `${id}:${level}`),
    ['tower:near'],
  );

  await writeFile(join(cwd, 'tileflow.config.ts'), config('palace'));
  await assert.rejects(
    createTileflowBuildArtifacts({cwd}),
    /places missing 3D models: palace\. Add palace\.glb to a map\.models directory/,
  );
  await readFile(join(cwd, 'tileflow.config.ts'));
});
