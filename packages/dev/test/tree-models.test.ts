import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {decodeTileflowTreeModel, tileflowTreeParts} from '@tileflow/core';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts} from '../src/artifacts';
import {readTileflowGltfTriangles} from '../src/gltf-reader';
import {prepareTileflowTreeModelMesh} from '../src/tree-model-mesh';
import {prepareTileflowMapTreeModels, TileflowTreeModelError} from '../src/tree-models';
import {smallTree, writeGlb} from './tree-model-fixtures';

test('a glTF binary becomes a unit tree, Z up, its parts named by its materials', () => {
  const mesh = prepareTileflowTreeModelMesh(smallTree(), 'near');
  const count = mesh.positions.length / 3;
  const axis = (index: number) => mesh.positions.filter((_, at) => at % 3 === index);
  // 10 m tall from its origin, its crown 6 m across: height 1, crown half a unit out.
  assert.ok(Math.abs(Math.max(...axis(2)) - 1) < 1e-6);
  assert.ok(Math.abs(Math.min(...axis(2))) < 1e-6);
  const reach = Math.max(
    ...Array.from({length: count}, (_, vertex) =>
      Math.hypot(mesh.positions[vertex * 3]!, mesh.positions[vertex * 3 + 1]!),
    ),
  );
  assert.ok(Math.abs(reach - 0.5) < 1e-6);
  // Its author's proportions: a crown 6 m across on a 10 m tree.
  assert.ok(Math.abs(mesh.proportion - 0.6) < 1e-6);
  // glTF's +Z (towards the viewer) becomes -Y: the crown's +Z point lies south.
  const south = mesh.positions.findIndex((value, at) => at % 3 === 1 && value < -0.49);
  assert.ok(south >= 0);
  assert.deepEqual(
    new Set(mesh.parts),
    new Set([tileflowTreeParts.bark, tileflowTreeParts.leaves]),
  );
  assert.equal(mesh.indices.length, 3 * 16);
  // Normals are unit length; the top of the crown faces up more than down.
  for (let vertex = 0; vertex < count; vertex += 1)
    assert.ok(
      Math.abs(
        Math.hypot(
          mesh.normals[vertex * 3]!,
          mesh.normals[vertex * 3 + 1]!,
          mesh.normals[vertex * 3 + 2]!,
        ) - 1,
      ) < 1e-6,
    );
  // Occlusion: the crown's top is lighter than its underside.
  const top = axis(2).indexOf(Math.max(...axis(2)));
  const crownBottom = mesh.positions.findIndex(
    (value, at) => at % 3 === 2 && Math.abs(value - 0.4) < 1e-6 && mesh.parts[(at - 2) / 3] === 1,
  );
  assert.ok(mesh.occlusion[top]! > mesh.occlusion[(crownBottom - 2) / 3]!);
});

test('materials name parts, ignoring case and an exporter suffix, and shades follow colour', () => {
  const light: [number, number, number] = [0.4, 0.8, 0.4];
  const dark: [number, number, number] = [0.05, 0.2, 0.05];
  const crown = (y: number, colour: [number, number, number]) => ({
    material: 'Leaves.001',
    colour,
    positions: [0, y + 2, 0, 1, y, 0, 0, y, 1],
    indices: [0, 1, 2],
  });
  const mesh = prepareTileflowTreeModelMesh(
    writeGlb([crown(6, light), crown(3, dark), {...crown(0, dark), material: 'STEM'}]),
    'near',
  );
  assert.deepEqual(mesh.parts.slice(0, 6), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(mesh.parts.slice(6), [3, 3, 3]);
  assert.ok(mesh.shades[0]! > 0.5 && mesh.shades[3]! < -0.5);
});

test('the reader names what an author must change', () => {
  const problem = (bytes: Uint8Array, level: 'near' | 'far' = 'near') => {
    try {
      prepareTileflowTreeModelMesh(bytes, level);
    } catch (error) {
      return (error as Error).message;
    }
    return 'no error';
  };
  assert.match(
    problem(smallTree({crown: 'Material'})),
    /"Material" that names no part of a tree; name each material bark, leaves, fronds or stem/,
  );
  assert.match(
    problem(writeGlb([{positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}])),
    /without a material/,
  );
  assert.match(
    problem(writeGlb([], {extensionsRequired: ['KHR_draco_mesh_compression']})),
    /compressed geometry \(KHR_draco_mesh_compression\); export it without compression/,
  );
  assert.match(problem(new TextEncoder().encode('{"asset":{}}')), /not a glTF binary/);
  // A far model takes at most 120 triangles.
  const many = Array.from({length: 130}, (_, index) => ({
    material: 'leaves',
    positions: [index, 1, 0, index + 1, 1, 0, index, 2, 0],
    indices: [0, 1, 2],
  }));
  assert.match(
    problem(writeGlb(many), 'far'),
    /has 130 triangles; a far tree model takes at most 120.*Decimate/,
  );
  assert.match(
    problem(
      writeGlb([
        {material: 'leaves', positions: [0, -1, 0, 1, -1, 0, 0, -2, 0], indices: [0, 1, 2]},
      ]),
    ),
    /stands below its origin/,
  );
  // Node transforms apply: a model lifted by its node stands from its origin.
  const lifted = readTileflowGltfTriangles(
    writeGlb([
      {
        material: 'bark',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
        translation: [0, 3, 0],
      },
    ]),
  );
  assert.deepEqual(
    lifted[0]!.positions.filter((_, at) => at % 3 === 2),
    [3, 3, 4],
  );
});

test('a map prepares its model directories, the later directory winning', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-tree-models-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await mkdir(join(cwd, 'base'));
  await mkdir(join(cwd, 'own'));
  await writeFile(join(cwd, 'base', 'royal-palm.glb'), smallTree());
  await writeFile(join(cwd, 'base', 'olive.glb'), smallTree());
  await writeFile(join(cwd, 'base', 'notes.txt'), 'sources live elsewhere');
  await writeFile(join(cwd, 'own', 'royal-palm.glb'), smallTree());
  await writeFile(join(cwd, 'own', 'royal-palm.far.glb'), smallTree());
  const prepared = await prepareTileflowMapTreeModels(['./base', './own'], {
    baseDirectory: cwd,
    configPath: 'maps.main.models',
    cwd,
    target: 'local',
  });
  assert.deepEqual(Object.keys(prepared.models).sort(), ['olive', 'royal-palm']);
  assert.ok(prepared.models['royal-palm']!.far);
  assert.equal(prepared.models.olive!.far, undefined);
  assert.ok(decodeTileflowTreeModel(prepared.models['royal-palm']!.near, 'near'));
  assert.deepEqual(prepared.identities.map(({id, level}) => `${id}:${level}`).sort(), [
    'olive:near',
    'royal-palm:far',
    'royal-palm:near',
  ]);

  await writeFile(join(cwd, 'own', 'Royal Palm.glb'), smallTree());
  await writeFile(join(cwd, 'own', 'cypress.far.glb'), smallTree());
  await writeFile(join(cwd, 'own', 'oak.gltf'), '{}');
  await assert.rejects(
    prepareTileflowMapTreeModels(['./own'], {
      baseDirectory: cwd,
      configPath: 'maps.main.models',
      cwd,
      target: 'local',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TileflowTreeModelError);
      assert.equal(error.code, 'TREE_MODEL_INVALID');
      const text = error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
      assert.match(text, /maps\.main\.models\.0\/Royal Palm\.glb: a model's file name is its id/);
      assert.match(text, /cypress\.far\.glb: has no cypress\.glb beside it/);
      assert.match(text, /oak\.gltf: is a text glTF; export the model as a glTF binary/);
      return true;
    },
  );
});

test('a map draws its own models: the style carries them and the revision counts their files', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-tree-model-build-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await mkdir(join(cwd, 'models'));
  await writeFile(join(cwd, 'models', 'royal-palm.glb'), smallTree());
  await writeFile(join(cwd, 'models', 'spare.glb'), smallTree());
  const config = (models: string) =>
    `import {defineMap, vegetation} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'palms',version:1,extends:streets,models:['./models'],modules:{vegetation:vegetation({mode:'3d',threeDimensional:{forms:{palm:{models:${models}}}}})},glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic']}});\n`;
  await writeFile(join(cwd, 'tileflow.config.ts'), config("['royal-palm']"));

  const plan = await createTileflowBuildArtifacts({cwd});
  const style = Object.values(plan.styles.palms!)[0]!;
  const vegetation = (style.metadata as Record<string, any>)['tileflow:vegetation'];
  assert.deepEqual(vegetation.forms.palm.models, ['royal-palm']);
  // Only the models the map draws travel in its style.
  assert.deepEqual(Object.keys(vegetation.models), ['royal-palm']);
  assert.ok(decodeTileflowTreeModel(vegetation.models['royal-palm'].near, 'near'));
  const manifest = plan.buildManifest as unknown as {
    maps: Record<string, {sourceAssets: {models?: {id: string; level: string}[]}}>;
  };
  assert.deepEqual(
    manifest.maps.palms!.sourceAssets.models?.map(({id, level}) => `${id}:${level}`),
    ['royal-palm:near', 'spare:near'],
  );
  assert.ok(plan.inputs.directories.some((directory) => directory.endsWith('/models')));

  await writeFile(join(cwd, 'tileflow.config.ts'), config("['coconut-palm']"));
  await assert.rejects(
    createTileflowBuildArtifacts({cwd}),
    /draws missing 3D models: coconut-palm\. Add coconut-palm\.glb to a map\.models directory/,
  );
});
