import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {streetsIcons} from '@tileflow/maps';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowBuildArtifacts,
  getTileflowArtifactFiles,
  tileflowArtifactInventoryFileName,
  TileflowHostedManifestOverwriteError,
  writeTileflowBuildArtifacts,
} from '../src/artifacts';

test('models source, prepared and artifact-plan boundaries with a complete input graph', async (t) => {
  const cwd = await fixture(t, 'tileflow-artifact-plan-');
  await mkdir(join(cwd, 'icons'));
  await writeFile(
    join(cwd, 'icons', 'culture.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#000" d="M2 20h20L12 2z"/></svg>',
  );
  await writeFile(join(cwd, 'tokens.ts'), "export const variant = 'light';\n");
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; import {variant} from './tokens'; export default defineMap({id:'main',name:variant,version:1,extends:streets,icons:[...streets.icons,'./icons'],glyphs:${fixtureGlyphsSource}});\n`,
  );

  const plan = await createTileflowBuildArtifacts({
    assetBaseUrl: '/tileflow',
    cwd,
    styleBaseUrl: '/tileflow',
  });
  const realCwd = await realpath(cwd);
  const sourceIcons = plan.sourceProject.maps.main?.icons;
  const preparedIcons = plan.project.maps.main?.icons;

  assert.equal(plan.schemaVersion, 1);
  assert.deepEqual(sourceIcons, [streetsIcons, './icons']);
  assert.deepEqual(preparedIcons, [streetsIcons, './icons']);
  assert.ok(plan.files.some((file) => file.fileName === 'icons/main/sprite.png'));
  const styleUrl = plan.manifest.maps.main!.themes.light!.styleUrl;
  assert.match(styleUrl, /^\/tileflow\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/);
  const immutableStyleFile = plan.files.find(
    (file) => `/${file.fileName}` === styleUrl.replace('/tileflow', ''),
  );
  assert.ok(immutableStyleFile && typeof immutableStyleFile.source === 'string');
  const immutableStyle = JSON.parse(immutableStyleFile.source) as {sprite?: string};
  assert.match(
    immutableStyle.sprite ?? '',
    /^\/tileflow\/generations\/[a-f0-9]{64}\/icons\/main\/sprite$/,
  );
  assert.ok(
    plan.files.some(
      (file) => `/${file.fileName}` === `${immutableStyle.sprite?.replace('/tileflow', '')}.png`,
    ),
  );
  assert.ok(plan.inputs.files.includes(join(realCwd, 'tileflow.config.ts')));
  assert.ok(plan.inputs.files.includes(join(realCwd, 'tokens.ts')));
  assert.deepEqual(plan.inputs.directories, [join(realCwd, 'icons')]);
  assert.deepEqual(plan.watchPaths, [...plan.inputs.files, ...plan.inputs.directories].sort());

  const {files: _files, ...stableArtifacts} = plan;
  const style = plan.styles.main?.light;
  assert.ok(style);
  for (const [mapName, themeName] of [
    ['con', 'light'],
    ['constructor', 'light'],
    ['main', 'system'],
    ['main', 'con'],
  ] as const) {
    assert.throws(
      () =>
        getTileflowArtifactFiles({
          ...stableArtifacts,
          styles: {[mapName]: {[themeName]: style}},
        }),
      /Unexpected Tileflow managed artifact file name/u,
      `${mapName}/${themeName}`,
    );
  }
});

test('resolves and watches local assets from a nested config directory within cwd', async (t) => {
  const cwd = await fixture(t, 'tileflow-artifact-nested-config-');
  const configDirectory = join(cwd, 'apps', 'map');
  const sharedDirectory = join(cwd, 'apps', 'shared');
  await mkdir(join(configDirectory, 'icons'), {recursive: true});
  await mkdir(sharedDirectory);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#000" d="M2 20h20L12 2z"/></svg>';
  await writeFile(join(configDirectory, 'icons', 'coffee.svg'), svg);
  await writeFile(join(sharedDirectory, 'culture.svg'), svg);
  await writeFile(
    join(configDirectory, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'nested',version:1,extends:streets,icons:[...streets.icons,'./icons','../shared'],glyphs:${fixtureGlyphsSource}});\n`,
  );

  const plan = await createTileflowBuildArtifacts({
    config: 'apps/map/tileflow.config.ts',
    cwd,
  });

  assert.deepEqual(plan.sourceProject.maps.nested?.icons, [streetsIcons, './icons', '../shared']);
  assert.deepEqual(
    plan.inputs.directories,
    [await realpath(sharedDirectory), await realpath(join(configDirectory, 'icons'))].sort(),
  );
  assert.ok(plan.files.some((file) => file.fileName.endsWith('/icons/nested/sprite.png')));
});

test('materializes package-owned Cyberpunk fonts and retargets immutable runtime metadata', async (t) => {
  const cwd = await fixture(t, 'tileflow-artifact-fonts-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:1,extends:cyberpunk});\n",
  );

  const plan = await createTileflowBuildArtifacts({
    assetBaseUrl: '/tileflow',
    cwd,
    styleBaseUrl: '/tileflow',
  });
  const stableFontAssets = plan.assets.filter((asset) => asset.fileName.startsWith('fonts/'));
  assert.deepEqual(
    stableFontAssets.map((asset) => asset.fileName),
    [
      stableFontAssets[0]?.fileName,
      `fonts/oxanium-medium-${'d0676de4894cd22591b4bb538dae5b8e06c44e0fb943300a7cff3945fe643689'}.ttf`,
      `fonts/oxanium-semibold-${'e2d77ec4ee67b0152166adf5d6393360550a012c2066e0d4589053e14a733cdc'}.ttf`,
    ],
  );
  assert.match(
    stableFontAssets[0]?.fileName ?? '',
    /^fonts\/licenses\/license-[a-f0-9]{64}\.txt$/u,
  );
  const stableFaces = plan.styles.night?.dark?.metadata?.['tileflow:fontFaces'] as Array<{
    family: string;
    source: string;
    weight: string;
  }>;
  assert.deepEqual(
    stableFaces.map(({family, weight}) => ({family, weight})),
    [
      {family: 'Oxanium Medium', weight: '500'},
      {family: 'Oxanium SemiBold', weight: '600'},
    ],
  );
  assert.ok(stableFaces.every((face) => face.source.startsWith('/tileflow/fonts/oxanium-')));
  assert.equal(
    await readFile(
      new URL('../../maps/assets/cyberpunk/fonts/LICENSE.txt', import.meta.url),
      'utf8',
    ),
    new TextDecoder().decode(
      stableFontAssets.find((asset) => asset.fileName.includes('/licenses/'))?.source as Uint8Array,
    ),
  );

  const immutableTheme = plan.manifest.maps.night!.themes.dark!;
  const immutableStyleUrl = immutableTheme.styleUrl;
  const immutableStyleFile = plan.files.find(
    (file) => `/${file.fileName}` === immutableStyleUrl.replace('/tileflow', ''),
  );
  assert.ok(immutableStyleFile && typeof immutableStyleFile.source === 'string');
  const immutableStyle = JSON.parse(immutableStyleFile.source) as {
    metadata?: {'tileflow:fontFaces'?: Array<{source: string}>};
  };
  const immutableFaces = immutableStyle.metadata?.['tileflow:fontFaces'] ?? [];
  assert.ok(
    immutableFaces.every((face) =>
      /^\/tileflow\/generations\/[a-f0-9]{64}\/fonts\/oxanium-/u.test(face.source),
    ),
  );
  assert.deepEqual(immutableTheme.fontFaces, immutableFaces);
  for (const face of immutableFaces) {
    assert.ok(
      plan.files.some((file) => `/${file.fileName}` === face.source.replace('/tileflow', '')),
    );
  }

  const relativePlan = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  const relativeTheme = relativePlan.manifest.maps.night!.themes.dark!;
  const relativeStyleFile = relativePlan.files.find(
    (file) => file.fileName === relativeTheme.styleUrl.replace(/^\.\//u, ''),
  );
  assert.ok(relativeStyleFile && typeof relativeStyleFile.source === 'string');
  const relativeStyle = JSON.parse(relativeStyleFile.source) as {
    metadata?: {'tileflow:fontFaces'?: Array<{source: string}>};
  };
  const relativeFaces = relativeStyle.metadata?.['tileflow:fontFaces'] ?? [];
  assert.ok(relativeFaces.every((face) => /^\.\.\/\.\.\/fonts\//u.test(face.source)));
  const publicManifestUrl = new URL('https://example.test/tileflow/manifest.json');
  const publicStyleUrl = new URL(relativeTheme.styleUrl, publicManifestUrl);
  for (const face of relativeFaces) {
    const publicFontUrl = new URL(face.source, publicStyleUrl);
    const fontFileName = publicFontUrl.pathname.replace(/^\/tileflow\//u, '');
    assert.ok(relativePlan.files.some((file) => file.fileName === fontFileName));
  }

  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:2,extends:cyberpunk,glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Oxanium Medium','Oxanium SemiBold']}});\n",
  );
  const remoteGlyphPlan = await createTileflowBuildArtifacts({cwd});
  assert.equal(
    remoteGlyphPlan.assets.some((asset) => asset.fileName.startsWith('fonts/')),
    false,
  );
  assert.deepEqual(remoteGlyphPlan.manifest.maps.night?.themes.dark?.fontFaces, []);
  assert.equal(remoteGlyphPlan.styles.night?.dark?.metadata?.['tileflow:fontFaces'], undefined);
});

test('keeps relative sprites valid inside the default content-addressed build layout', async (t) => {
  const cwd = await fixture(t, 'tileflow-relative-artifact-plan-');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'main',version:1,extends:streets,glyphs:${fixtureGlyphsSource}});\n`,
  );

  const plan = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  const styleReference = plan.manifest.maps.main!.themes.light!.styleUrl;
  assert.match(styleReference, /^\.\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/);
  const immutableStyleFile = plan.files.find(
    (file) => file.fileName === styleReference.replace(/^\.\//, ''),
  );
  assert.ok(immutableStyleFile && typeof immutableStyleFile.source === 'string');
  const immutableStyle = JSON.parse(immutableStyleFile.source) as {sprite?: string};
  assert.equal(immutableStyle.sprite, '../../icons/main/sprite');

  const publicManifestUrl = new URL('https://example.test/tileflow/manifest.json');
  const publicStyleUrl = new URL(styleReference, publicManifestUrl);
  const publicSpriteUrl = new URL(`${immutableStyle.sprite}.png`, publicStyleUrl);
  assert.equal(
    publicSpriteUrl.pathname,
    immutableStyleFile.fileName
      .replace(/\/styles\/main\/light\.json$/, '/icons/main/sprite.png')
      .replace(/^/, '/tileflow/'),
  );
  assert.ok(
    plan.files.some(
      (file) =>
        file.fileName ===
        immutableStyleFile.fileName.replace(
          /\/styles\/main\/light\.json$/,
          '/icons/main/sprite.png',
        ),
    ),
  );
});

test('replaces a managed generation, removes only inventoried stale files and preserves user files', async (t) => {
  const cwd = await fixture(t, 'tileflow-artifact-write-');
  const outDir = join(cwd, 'dist', 'tileflow');
  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['alpha', 'zeta']));
  await writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir});
  const firstInventory = await readInventory(outDir);
  const firstGenerationFiles = generationFiles(firstInventory);
  await writeFile(join(outDir, 'user-note.txt'), 'keep me\n');

  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['alpha']));
  await writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir});

  await assert.rejects(() => readFile(join(outDir, 'styles', 'zeta', 'light.json')), {
    code: 'ENOENT',
  });
  assert.equal(await readFile(join(outDir, 'user-note.txt'), 'utf8'), 'keep me\n');
  const secondInventory = await readInventory(outDir);
  const secondGenerationFiles = generationFiles(secondInventory);
  assert.notEqual(secondInventory.generation, firstInventory.generation);
  assert.equal(secondInventory.schemaVersion, 1);
  assert.match(secondInventory.generation, /^[a-f0-9]{64}$/);
  assert.ok(secondInventory.files.includes('manifest.json'));
  assert.ok(secondInventory.files.includes('styles/alpha/light.json'));
  assert.ok(secondInventory.files.includes('styles/alpha/dark.json'));
  assert.equal(
    secondInventory.files.some((file) => file.startsWith('styles/zeta/')),
    false,
  );
  for (const fileName of firstGenerationFiles) {
    assert.equal(secondInventory.files.includes(fileName), true);
    await readFile(join(outDir, fileName));
  }
  assert.equal(
    secondGenerationFiles.filter((file) => /\/styles\/alpha\/(?:dark|light)\.json$/.test(file))
      .length,
    2,
  );

  await writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir});
  const repeatedInventory = await readInventory(outDir);
  assert.deepEqual(repeatedInventory, secondInventory);
  for (const fileName of firstGenerationFiles) await readFile(join(outDir, fileName));

  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['alpha', 'beta']));
  await writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir});
  const thirdInventory = await readInventory(outDir);
  const thirdGenerationFiles = generationFiles(thirdInventory);
  assert.notEqual(thirdInventory.generation, secondInventory.generation);
  for (const fileName of firstGenerationFiles) {
    assert.equal(thirdInventory.files.includes(fileName), false);
    await assert.rejects(() => readFile(join(outDir, fileName)), {code: 'ENOENT'});
  }
  for (const fileName of [...secondGenerationFiles, ...thirdGenerationFiles]) {
    assert.equal(thirdInventory.files.includes(fileName), true);
    await readFile(join(outDir, fileName));
  }
  assert.equal(await readFile(join(outDir, 'user-note.txt'), 'utf8'), 'keep me\n');
});

test('refuses to replace a Hosted manifest unless the caller opts in explicitly', async (t) => {
  const cwd = await fixture(t, 'tileflow-hosted-guard-');
  const outDir = join(cwd, 'public', 'tileflow');
  await mkdir(outDir, {recursive: true});
  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['main']));
  const hosted = {
    apiUrl: 'https://api.example.test',
    maps: {
      main: {
        defaultTheme: 'light',
        environment: 'production',
        mapId: 'map_main',
        themes: {
          light: {
            colorScheme: 'light',
            styleId: 'style_main',
            styleUrl: 'https://styles.example.test/main.json',
          },
        },
      },
    },
    version: 1,
  };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(hosted)}\n`);

  await assert.rejects(
    () => writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir}),
    (error: unknown) => error instanceof TileflowHostedManifestOverwriteError,
  );
  assert.deepEqual(JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')), hosted);

  await writeTileflowBuildArtifacts({
    config: 'tileflow.workspace.ts',
    cwd,
    outDir,
    overwriteHostedManifest: true,
  });
  const replacement = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as {
    apiUrl?: string;
    maps?: {main?: {themes?: {light?: {styleUrl?: string}}}};
    version?: number;
  };
  assert.equal(replacement.apiUrl, undefined);
  assert.equal(replacement.version, 1);
  assert.match(
    replacement.maps?.main?.themes?.light?.styleUrl ?? '',
    /styles\/main\/light\.json$/u,
  );
});

test('rejects a forged inventory instead of deleting an unmanaged file', async (t) => {
  const cwd = await fixture(t, 'tileflow-forged-inventory-');
  const outDir = join(cwd, 'dist', 'tileflow');
  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['main']));
  await writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir});
  await writeFile(join(outDir, 'user-note.txt'), 'keep me\n');
  const inventory = await readInventory(outDir);
  await writeFile(
    join(outDir, tileflowArtifactInventoryFileName),
    `${JSON.stringify({...inventory, files: [...inventory.files, 'user-note.txt']})}\n`,
  );

  await assert.rejects(
    () => writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir}),
    /Invalid Tileflow artifact inventory/,
  );
  assert.equal(await readFile(join(outDir, 'user-note.txt'), 'utf8'), 'keep me\n');

  await writeFile(
    join(outDir, tileflowArtifactInventoryFileName),
    `${JSON.stringify({...inventory, files: [...inventory.files, 'styles/main/../dark.json']})}\n`,
  );
  await assert.rejects(
    () => writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir}),
    /Invalid Tileflow artifact inventory/,
  );
  assert.equal(await readFile(join(outDir, 'user-note.txt'), 'utf8'), 'keep me\n');
});

test('rejects artifact output paths that escape the working directory', async (t) => {
  const cwd = await fixture(t, 'tileflow-output-escape-');
  const outside = await mkdtemp(join(tmpdir(), 'tileflow-output-outside-'));
  t.after(() => rm(outside, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['main']));
  await writeFile(join(outside, 'sentinel.txt'), 'untouched\n');

  await assert.rejects(
    () =>
      writeTileflowBuildArtifacts({
        config: 'tileflow.workspace.ts',
        cwd,
        outDir: join(outside, 'tileflow'),
      }),
    /artifact output escapes its working directory/u,
  );
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'untouched\n');
  await assert.rejects(() => readFile(join(outside, 'tileflow', 'manifest.json')), {
    code: 'ENOENT',
  });
});

test('rejects symlinks at the artifact output root and in its ancestry', async (t) => {
  const cwd = await fixture(t, 'tileflow-output-symlink-');
  const outside = await mkdtemp(join(tmpdir(), 'tileflow-output-target-'));
  t.after(() => rm(outside, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.workspace.ts'), config(['main']));
  await writeFile(join(outside, 'sentinel.txt'), 'untouched\n');

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    await symlink(outside, join(cwd, 'root-link'), linkType);
    await symlink(outside, join(cwd, 'ancestor-link'), linkType);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      t.skip(`symlinks unavailable: ${String(error.code)}`);
      return;
    }
    throw error;
  }

  for (const outDir of ['root-link', 'ancestor-link/tileflow']) {
    await assert.rejects(
      () => writeTileflowBuildArtifacts({config: 'tileflow.workspace.ts', cwd, outDir}),
      /symbolic link/u,
      outDir,
    );
  }
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'untouched\n');
  await assert.rejects(() => readFile(join(outside, 'manifest.json')), {code: 'ENOENT'});
  await assert.rejects(() => readFile(join(outside, 'tileflow', 'manifest.json')), {
    code: 'ENOENT',
  });
});

type TestInventory = {files: string[]; generation: string; schemaVersion: number};

async function readInventory(outDir: string): Promise<TestInventory> {
  return JSON.parse(
    await readFile(join(outDir, tileflowArtifactInventoryFileName), 'utf8'),
  ) as TestInventory;
}

function generationFiles(inventory: TestInventory): string[] {
  const prefix = `generations/${inventory.generation}/`;
  return inventory.files.filter((file) => file.startsWith(prefix));
}

function config(mapNames: string[]): string {
  return `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default {maps:{${mapNames
    .map(
      (name) =>
        `${JSON.stringify(name)}:defineMap({id:${JSON.stringify(name)},version:1,extends:streets,icons:[],modules:{poi:{type:'poi',icons:false},roads:disable()},glyphs:${fixtureGlyphsSource}})`,
    )
    .join(',')}}};\n`;
}

const fixtureGlyphsSource = `{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold']}`;

async function fixture(t: {after(callback: () => Promise<void>): void}, prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}
