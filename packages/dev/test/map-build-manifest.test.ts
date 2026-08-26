import assert from 'node:assert/strict';
import {copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts, writeTileflowBuildArtifacts} from '../src/artifacts';

const svg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="${color}" d="M2 20h20L12 2z"/></svg>`;

test('build manifest hashes only the winning icon source and is checkout-path independent', async (t) => {
  const firstCwd = await iconFixture(t, 'tileflow-map-revision-first-');
  const secondCwd = await iconFixture(t, 'tileflow-map-revision-second-');

  const first = await createTileflowBuildArtifacts({cwd: firstCwd});
  const second = await createTileflowBuildArtifacts({cwd: secondCwd});
  const initialRevision = first.buildManifest.maps.main?.mapRevisionSha256;

  assert.match(initialRevision ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(initialRevision, second.buildManifest.maps.main?.mapRevisionSha256);
  assert.deepEqual(first.buildManifest.maps.main?.lineage, [{id: 'main', mapVersion: 1}]);
  assert.deepEqual(first.buildManifest.maps.main?.sourceAssets.icons, [
    {
      format: 'svg',
      id: 'cafe',
      kind: 'icon',
      sha256: second.buildManifest.maps.main?.sourceAssets.icons[0]?.sha256,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(first.buildManifest), /tileflow-map-revision-first|\/tmp\//u);

  // The later directory owns `cafe`, so changing the shadowed source is not an effective change.
  await writeFile(join(firstCwd, 'base-icons', 'cafe.svg'), svg('#00ff00'));
  const shadowedChange = await createTileflowBuildArtifacts({cwd: firstCwd});
  assert.equal(shadowedChange.buildManifest.maps.main?.mapRevisionSha256, initialRevision);

  // Source identity is deliberately stronger than rendered-output identity.
  await writeFile(
    join(firstCwd, 'brand-icons', 'cafe.svg'),
    `${svg('#ffffff')}<!-- effective source metadata -->`,
  );
  const sourceOnlyChange = await createTileflowBuildArtifacts({cwd: firstCwd});
  assert.notEqual(sourceOnlyChange.buildManifest.maps.main?.mapRevisionSha256, initialRevision);
  assert.equal(
    sourceOnlyChange.buildManifest.maps.main?.assetSetSha256,
    first.buildManifest.maps.main?.assetSetSha256,
  );

  await writeFile(join(firstCwd, 'brand-icons', 'cafe.svg'), svg('#0000ff'));
  const effectiveChange = await createTileflowBuildArtifacts({cwd: firstCwd});
  assert.notEqual(effectiveChange.buildManifest.maps.main?.mapRevisionSha256, initialRevision);
});

test('build manifest records effective package fonts and is emitted as canonical JSON', async (t) => {
  const cwd = await fixture(t, 'tileflow-map-revision-fonts-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',version:1,extends:cyberpunk});\n",
  );

  const plan = await writeTileflowBuildArtifacts({cwd, outDir: 'dist/tileflow'});
  const entry = plan.buildManifest.maps.night!;
  const serialized = await readFile(join(cwd, 'dist/tileflow/build-manifest.json'), 'utf8');

  assert.equal(serialized, `${JSON.stringify(plan.buildManifest)}\n`);
  assert.deepEqual(entry.lineage, [
    {id: 'night', mapVersion: 1},
    {id: 'cyberpunk', mapVersion: 1},
    {id: 'streets', mapVersion: 1},
  ]);
  assert.deepEqual(
    entry.sourceAssets.fonts.map(({family, sha256}) => ({family, sha256})),
    [
      {
        family: 'Oxanium Medium',
        sha256: 'd0676de4894cd22591b4bb538dae5b8e06c44e0fb943300a7cff3945fe643689',
      },
      {
        family: 'Oxanium SemiBold',
        sha256: 'e2d77ec4ee67b0152166adf5d6393360550a012c2066e0d4589053e14a733cdc',
      },
    ],
  );
  assert.ok(plan.files.some((file) => file.fileName === 'build-manifest.json'));
});

test('package-owned map revision is identical from a workspace package and unpacked tarball layout', async (t) => {
  const sourceCwd = await fixture(t, 'tileflow-map-revision-source-package-');
  const unpackedCwd = await mkdtemp(join(tmpdir(), 'tileflow-map-revision-packed-package-'));
  t.after(() => rm(unpackedCwd, {force: true, recursive: true}));
  await linkWorkspacePackages(unpackedCwd, ['core']);
  const packageTarget = join(unpackedCwd, 'node_modules', '@tileflow', 'maps');
  const packageSource = new URL('../../maps/', import.meta.url);
  await mkdir(packageTarget, {recursive: true});
  await cp(new URL('assets/', packageSource), join(packageTarget, 'assets'), {recursive: true});
  await cp(new URL('dist/', packageSource), join(packageTarget, 'dist'), {recursive: true});
  await copyFile(new URL('package.json', packageSource), join(packageTarget, 'package.json'));
  const packedPackageJson = JSON.parse(
    await readFile(join(packageTarget, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  await writeFile(
    join(packageTarget, 'package.json'),
    `${JSON.stringify({...packedPackageJson, version: '99.0.0'})}\n`,
  );

  const config =
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',version:1,extends:cyberpunk});\n";
  await writeFile(join(sourceCwd, 'tileflow.config.ts'), config);
  await writeFile(join(unpackedCwd, 'tileflow.config.ts'), config);
  const source = await createTileflowBuildArtifacts({cwd: sourceCwd});
  const unpacked = await createTileflowBuildArtifacts({cwd: unpackedCwd});

  assert.equal(
    source.buildManifest.maps.night?.mapRevisionSha256,
    unpacked.buildManifest.maps.night?.mapRevisionSha256,
  );
  assert.deepEqual(
    source.buildManifest.maps.night?.sourceAssets,
    unpacked.buildManifest.maps.night?.sourceAssets,
  );
  assert.equal(source.buildManifest.provenance?.packages['@tileflow/maps'], '0.0.0-development');
  assert.equal(unpacked.buildManifest.provenance?.packages['@tileflow/maps'], '99.0.0');
});

test('changing the World delivery base changes Style identity, not map revision', async (t) => {
  const cwd = await fixture(t, 'tileflow-map-revision-world-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  data: {
    generation: 'v1',
    selection: {kind: 'current', product: 'world-v1'},
    type: 'tileflow-world',
  },
  glyphs: {kind: 'url', url: 'https://fonts.example.test/{fontstack}/{range}.pbf', fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']},
  icons: [],
  modules: {poi: {type: 'poi', icons: false}}
});\n`,
  );
  const first = await createTileflowBuildArtifacts({
    apiBaseUrl: 'https://api-one.example.test',
    cwd,
  });
  const second = await createTileflowBuildArtifacts({
    apiBaseUrl: 'https://api-two.example.test',
    cwd,
  });

  assert.equal(
    first.buildManifest.maps.main?.mapRevisionSha256,
    second.buildManifest.maps.main?.mapRevisionSha256,
  );
  assert.notEqual(
    first.buildManifest.maps.main?.styleSha256,
    second.buildManifest.maps.main?.styleSha256,
  );
});

test('data requirements come only from effective compiled modules and fields', async (t) => {
  const cwd = await fixture(t, 'tileflow-map-requirements-effective-');
  const config = (poiOverride: string) => `import {defineMap, defineRootMap} from '@tileflow/core';
const base = defineRootMap({
  id: 'base', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {kind: 'url', url: 'https://fonts.example.test/{fontstack}/{range}.pbf', fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']},
  modules: {buildings: {type: 'buildings'}, poi: {type: 'poi', icons: false}}
});
export default defineMap({
  id: 'main', version: 1, extends: base,
  modules: {poi: ${poiOverride}}
});
`;
  await writeFile(join(cwd, 'tileflow.config.ts'), config("{type: 'poi', icons: false}"));
  const enabled = await createTileflowBuildArtifacts({cwd});
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    config("{type: 'poi', enabled: false, icons: false}"),
  );
  const disabled = await createTileflowBuildArtifacts({cwd});

  const enabledLayers = enabled.buildManifest.maps.main!.dataRequirements.sourceLayers;
  const disabledLayers = disabled.buildManifest.maps.main!.dataRequirements.sourceLayers;
  assert.ok(enabledLayers.some((layer) => layer.id === 'building'));
  assert.ok(enabledLayers.some((layer) => layer.id === 'poi'));
  assert.ok(disabledLayers.some((layer) => layer.id === 'building'));
  assert.equal(
    disabledLayers.some((layer) => layer.id === 'poi'),
    false,
  );
  assert.ok(
    enabledLayers
      .find((layer) => layer.id === 'poi')
      ?.fields.some((field) => field.name === 'class'),
  );
});

async function iconFixture(t: test.TestContext, prefix: string): Promise<string> {
  const cwd = await fixture(t, prefix);
  await mkdir(join(cwd, 'base-icons'));
  await mkdir(join(cwd, 'brand-icons'));
  await writeFile(join(cwd, 'base-icons', 'cafe.svg'), svg('#ff0000'));
  await writeFile(join(cwd, 'brand-icons', 'cafe.svg'), svg('#ffffff'));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'main', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {kind: 'url', url: 'https://fonts.example.test/{fontstack}/{range}.pbf', fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']},
  icons: ['./base-icons', './brand-icons'],
  modules: {poi: {type: 'poi', icons: false}}
});\n`,
  );
  return cwd;
}

async function fixture(t: test.TestContext, prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}
