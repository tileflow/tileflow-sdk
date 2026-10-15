import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {decodeTileflowModels, tileflowInsideRings, tileflowModelParts} from '@tileflow/core';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts} from '../src/artifacts';
import {
  isTileflowBuildingModel,
  prepareTileflowBuildingModelMesh,
  tileflowBuildingModelDeclaredFootprint,
  tileflowBuildingModelFootprint,
} from '../src/building-model-mesh';
import {readTileflowGltfTriangles} from '../src/gltf-reader';
import {
  packageTileflowLandmarks,
  prepareTileflowBuildingModel,
  prepareTileflowMapTreeModels,
  TileflowTreeModelError,
} from '../src/tree-models';
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
  assert.match(prepared.buildings.tower!.fileName, /^tower-[0-9a-f]{16}\.glb$/u);
  const [model] = (await decodeTileflowModels(prepared.buildings.tower!.bytes)) ?? [];
  assert.equal(model?.id, 'tower');
  assert.equal(model?.levels.length, 2);
  assert.ok(Math.abs(model!.bounds[5] - 120) < 0.01);
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
  assert.match(design.models[0].url, /models\/city\/tower-[0-9a-f]{16}\.glb$/u);
  assert.equal(design.modelColors.accent, '#806040');
  const asset = plan.assets.find((entry) => entry.fileName.startsWith('models/city/tower-'));
  assert.ok(asset);
  assert.ok(design.models[0].url.endsWith(asset.fileName));
  assert.equal(asset.contentType, 'model/gltf-binary');
  assert.ok(await decodeTileflowModels(asset.source as Uint8Array));
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

test('one building model prepares from its levels into the file a build writes', async () => {
  const prepared = await prepareTileflowBuildingModel('tower', {
    near: writeGlb(block(20, 20, 120)),
    far: writeGlb(block(20, 20, 120)),
  });
  assert.match(prepared.sha256, /^[0-9a-f]{64}$/u);
  const [model] = (await decodeTileflowModels(prepared.bytes)) ?? [];
  assert.equal(model?.levels.length, 2);
  await assert.rejects(
    prepareTileflowBuildingModel('tree', {near: smallTree()}),
    /is not a building model; name each material surface, secondary, glass, accent or roof/,
  );
});

test('landmarks package into the tiles they stand in, with the index that names them', async () => {
  const tower = {near: writeGlb(block(20, 20, 120)), far: writeGlb(block(20, 20, 120))};
  const landmarks = [
    {id: 'tour-montparnasse', at: [2.3219, 48.8421] as const, heading: 30, levels: tower},
    {id: 'eiffel-tower', at: [2.2944962, 48.8582621] as const, heading: 0, levels: tower},
    {id: 'palacio-real', at: [-3.7143, 40.418] as const, heading: 0, levels: tower},
  ];
  const packaged = await packageTileflowLandmarks(landmarks);
  assert.equal(packaged.index.zoom, 14);
  // The Eiffel Tower stands in tile 14/8296/5636.
  assert.deepEqual(packaged.index.landmarks[0], {
    id: 'eiffel-tower',
    at: [2.2944962, 48.8582621],
    tile: [8296, 5636],
  });
  assert.deepEqual(
    packaged.index.tiles,
    packaged.tiles.map(({x, y}) => [x, y]),
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(packaged.indexBytes)), packaged.index);
  const eiffel = packaged.tiles.find(({x, y}) => x === 8296 && y === 5636)!;
  const models = (await decodeTileflowModels(eiffel.bytes)) ?? [];
  assert.deepEqual(
    models.map((model) => [model.id, model.at, model.heading]),
    [['eiffel-tower', [2.2944962, 48.8582621], 0]],
  );
  // The same landmarks package into the same bytes, in any order.
  const again = await packageTileflowLandmarks([...landmarks].reverse());
  assert.deepEqual(
    again.tiles.map((tile) => tile.sha256),
    packaged.tiles.map((tile) => tile.sha256),
  );
  await assert.rejects(
    packageTileflowLandmarks([{...landmarks[0]!, heading: 360}]),
    /turned 0 to 360 degrees/,
  );
  await assert.rejects(
    packageTileflowLandmarks([{...landmarks[0]!, levels: {near: smallTree()}}]),
    /Landmark tour-montparnasse: is not a building model/,
  );
});

test('a map places a model served elsewhere by its address, with no file of its own', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-hosted-model-build-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const url = 'https://models.example.test/eiffel-tower.glb';
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {buildings, defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'paris',version:1,extends:streets,modules:{buildings:buildings({mode:'3d',threeDimensional:{models:[{model:'eiffel-tower',at:[2.2945,48.8583],url:'${url}'}]}})},glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic']}});\n`,
  );
  const plan = await createTileflowBuildArtifacts({cwd});
  const style = Object.values(plan.styles.paris!)[0]!;
  const design = (style.metadata as Record<string, any>)['tileflow:buildings'];
  assert.deepEqual(design.models, [
    {model: 'eiffel-tower', url, at: [2.2945, 48.8583], heading: 0},
  ]);
  assert.equal(plan.assets.filter((entry) => entry.fileName.startsWith('models/')).length, 0);
  // The generation's own copy of the style keeps the address.
  const generation = plan.files.find((file) =>
    /^generations\/[a-f0-9]{64}\/styles\/paris\//u.test(file.fileName),
  );
  assert.ok(generation && String(generation.source).includes(url));
});
