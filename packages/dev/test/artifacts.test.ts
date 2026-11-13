import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {materializeTileflowStyleFamily} from '@tileflow/core/build';
import {streetsIcons} from '@tileflow/maps';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowBuildArtifacts,
  getTileflowArtifactFiles,
  tileflowArtifactInventoryFileName,
  TileflowHostedManifestOverwriteError,
  writeTileflowBuildArtifacts,
} from '../src/artifacts';
import {
  copyStreetsFontFixture,
  streetsFontFixtureDirectory,
  streetsFontFixtures,
} from './streets-font-fixture';

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
  for (const file of plan.files.filter((entry) =>
    /styles\/main\/light\.json$/u.test(entry.fileName),
  )) {
    assert.equal(typeof file.source, 'string');
    assert.equal(file.source, `${JSON.stringify(JSON.parse(file.source as string))}\n`);
  }
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

for (const mixed of [false, true])
  test(`materializes a map's own fonts${mixed ? ' with shared fallback' : ''} and retargets immutable runtime metadata`, async (t) => {
    const cwd = await fixture(t, 'tileflow-artifact-fonts-');
    await copyStreetsFontFixture(cwd);
    await writeFile(
      join(cwd, 'tileflow.config.ts'),
      `import {defineMap, officialFontFallback} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:1,extends:streets,fonts:['./fonts']${mixed ? ',fontFallback:officialFontFallback' : ''}});\n`,
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
        ...streetsFontFixtures.map(({fileName}) => fileName),
        stableFontAssets.find((asset) => asset.fileName.includes('/licenses/'))?.fileName,
      ].sort(),
    );
    assert.match(
      stableFontAssets.find((asset) => asset.fileName.includes('/licenses/'))?.fileName ?? '',
      /^fonts\/licenses\/license-[a-f0-9]{64}\.txt$/u,
    );
    const stableFaces = plan.styles.night?.light?.metadata?.['tileflow:fontFaces'] as Array<{
      family: string;
      source: string;
      weight: string;
    }>;
    assert.deepEqual(
      stableFaces.map(({family, weight}) => ({family, weight})),
      streetsFontFixtures.map(({family, weight}) => ({family, weight})),
    );
    assert.ok(stableFaces.every((face) => face.source.startsWith('/tileflow/fonts/')));
    assert.equal(
      await readFile(new URL('LICENSE.txt', streetsFontFixtureDirectory), 'utf8'),
      new TextDecoder().decode(
        stableFontAssets.find((asset) => asset.fileName.includes('/licenses/'))
          ?.source as Uint8Array,
      ),
    );

    const immutableTheme = plan.manifest.maps.night!.themes.light!;
    const immutableStyleUrl = immutableTheme.styleUrl;
    const immutableStyleFile = plan.files.find(
      (file) => `/${file.fileName}` === immutableStyleUrl.replace('/tileflow', ''),
    );
    assert.ok(immutableStyleFile && typeof immutableStyleFile.source === 'string');
    const immutableStyle = JSON.parse(immutableStyleFile.source) as {
      metadata?: {
        'tileflow:fontFaces'?: Array<{source: string}>;
        'tileflow:fontLicenses'?: string[];
      };
    };
    const immutableFaces = immutableStyle.metadata?.['tileflow:fontFaces'] ?? [];
    const licenses = immutableStyle.metadata?.['tileflow:fontLicenses'] ?? [];
    const localLicenses = licenses.filter((url) => url.includes('/fonts/licenses/'));
    assert.ok(localLicenses.length);
    for (const url of localLicenses) {
      assert.match(url, /\/generations\/[a-f0-9]{64}\/fonts\/licenses\//u);
      assert.ok(plan.files.some((file) => url.endsWith('/' + file.fileName)));
    }
    if (mixed) assert.ok(licenses.some((url) => url.startsWith('https://api.tileflow.dev/base/')));

    if (mixed)
      assertFontFileClosure(
        immutableStyle,
        immutableFaces,
        new URL(immutableStyleUrl, 'https://example.test').href,
      );
    assert.ok(
      immutableFaces.every((face) =>
        /^\/tileflow\/generations\/[a-f0-9]{64}\/fonts\/(?:dinish|noto-sans)-/u.test(face.source),
      ),
    );
    assert.deepEqual(immutableTheme.fontFaces, immutableFaces);
    for (const face of immutableFaces) {
      assert.ok(
        plan.files.some((file) => `/${file.fileName}` === face.source.replace('/tileflow', '')),
      );
    }

    const relativePlan = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
    const relativeTheme = relativePlan.manifest.maps.night!.themes.light!;
    const relativeStyleFile = relativePlan.files.find(
      (file) => file.fileName === relativeTheme.styleUrl.replace(/^\.\//u, ''),
    );
    assert.ok(relativeStyleFile && typeof relativeStyleFile.source === 'string');
    const relativeStyle = JSON.parse(relativeStyleFile.source) as {
      metadata?: {'tileflow:fontFaces'?: Array<{source: string}>};
    };
    const relativeFaces = relativeStyle.metadata?.['tileflow:fontFaces'] ?? [];
    if (mixed)
      assertFontFileClosure(
        relativeStyle,
        relativeFaces,
        new URL(relativeTheme.styleUrl, 'https://example.test/tileflow/manifest.json').href,
      );
    assert.ok(relativeFaces.every((face) => /^\.\.\/\.\.\/fonts\//u.test(face.source)));
    const publicManifestUrl = new URL('https://example.test/tileflow/manifest.json');
    const publicStyleUrl = new URL(relativeTheme.styleUrl, publicManifestUrl);
    for (const face of relativeFaces) {
      const publicFontUrl = new URL(face.source, publicStyleUrl);
      const fontFileName = publicFontUrl.pathname.replace(/^\/tileflow\//u, '');
      assert.ok(relativePlan.files.some((file) => file.fileName === fontFileName));
    }
    const relativeFamilyPath = relativePlan.manifest.maps.night!.familyUrl!;
    const relativeFamilyFile = relativePlan.files.find(
      (file) => file.fileName === relativeFamilyPath.replace(/^\.\//u, ''),
    )!;
    const familyStyle = materializeTileflowStyleFamily(
      JSON.parse(String(relativeFamilyFile.source)),
      'light',
    );
    const familyFaces = familyStyle.metadata?.['tileflow:fontFaces'] as Array<{source: string}>;
    if (mixed)
      assertFontFileClosure(
        familyStyle,
        familyFaces,
        new URL(relativeFamilyPath, publicManifestUrl).href,
      );
    assert.deepEqual(
      familyFaces.map(
        (face) => new URL(face.source, new URL(relativeFamilyPath, publicManifestUrl)).href,
      ),
      relativeFaces.map((face) => new URL(face.source, publicStyleUrl).href),
    );

    await writeFile(
      join(cwd, 'tileflow.config.ts'),
      "import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:2,extends:streets,glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['DINish Bold,Noto Sans Regular', 'DINish Medium,Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic', 'Noto Sans Regular']}});\n",
    );
    const remoteGlyphPlan = await createTileflowBuildArtifacts({cwd});
    assert.equal(
      remoteGlyphPlan.assets.some((asset) => asset.fileName.startsWith('fonts/')),
      false,
    );
    assert.deepEqual(remoteGlyphPlan.manifest.maps.night?.themes.light?.fontFaces, []);
    assert.equal(remoteGlyphPlan.styles.night?.light?.metadata?.['tileflow:fontFaces'], undefined);
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

  for (const [stylePath, familyPath] of [
    [styleReference, plan.manifest.maps.main!.familyUrl!],
    ['./styles/main/light.json', './families/main.json'],
  ] as const) {
    const file = (path: string) =>
      plan.files.find((entry) => entry.fileName === path.replace(/^\.\//u, ''))!;
    const style = JSON.parse(String(file(stylePath).source));
    const family = JSON.parse(String(file(familyPath).source));
    const appearance = materializeTileflowStyleFamily(family, 'light');
    assert.equal(
      new URL(`${appearance.sprite}.png`, new URL(familyPath, publicManifestUrl)).href,
      new URL(`${style.sprite}.png`, new URL(stylePath, publicManifestUrl)).href,
      'family and standalone style must address the same emitted sprite',
    );
  }
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
  assert.equal(replacement.version, 3);
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
        `${JSON.stringify(name)}:defineMap({id:${JSON.stringify(name)},version:1,extends:streets,icons:[],modules:{poi:{type:'poi',icons:false},roads:disable(),vegetation:disable()},glyphs:${fixtureGlyphsSource}})`,
    )
    .join(',')}}};\n`;
}

test('production output can carry an exact World release TileJSON in place of its url', async (t) => {
  const cwd = await fixture(t, 'tileflow-artifact-inline-tilejson-');
  const releaseId = 'world-v1-a3dea8b5-43fa-425f-ae4b-798be8c166e4';
  const descriptorSha256 = 'b'.repeat(64);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, tileflowWorld} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'main',name:'Main',version:1,extends:streets,data:tileflowWorld({release:{releaseId:'${releaseId}',descriptorSha256:'${descriptorSha256}'}}),glyphs:${fixtureGlyphsSource}});\n`,
  );
  const requested: string[] = [];
  const tiles = `https://world.tileflow.dev/tiles/world/${releaseId}/{z}/{x}/{y}.pbf?worldDescriptorSha256=${descriptorSha256}`;
  const tileJsonFetch = (async (url: string) => {
    requested.push(url);
    return new Response(
      JSON.stringify({
        tiles: [tiles],
        minzoom: 0,
        maxzoom: 15,
        tileflow: {world: {releaseId, descriptorSha256}},
      }),
    );
  }) as typeof globalThis.fetch;
  const worldSources = (styles: Record<string, Record<string, {sources: object}>>) =>
    Object.values(styles.main!).flatMap((style) =>
      Object.values(style.sources as Record<string, {url?: string; tiles?: string[]}>).filter(
        (source) => source.url?.includes(releaseId) || source.tiles?.[0] === tiles,
      ),
    );

  const published = await createTileflowBuildArtifacts({
    cwd,
    target: 'production',
    inlineTileJson: true,
    tileJsonFetch,
  });
  assert.equal(new Set(requested).size, requested.length, 'each TileJSON is read once');
  assert.ok(requested.length > 0);
  const inlined = worldSources(published.styles);
  assert.ok(inlined.length > 0);
  for (const source of inlined) {
    assert.equal(source.url, undefined);
    assert.deepEqual(source.tiles, [tiles]);
  }

  // Without the option, and in local output, sources keep their TileJSON reference.
  for (const options of [
    {target: 'production' as const},
    {target: 'local' as const, inlineTileJson: true},
  ]) {
    const kept = worldSources(
      (await createTileflowBuildArtifacts({cwd, tileJsonFetch, ...options})).styles,
    );
    assert.ok(kept.length > 0);
    for (const source of kept) assert.match(source.url ?? '', /worldReleaseId=/u);
  }
});

const fixtureGlyphsSource = `{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic','DINish Medium,Noto Sans Regular','DINish Bold,Noto Sans Regular']}`;

async function fixture(t: {after(callback: () => Promise<void>): void}, prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}

function assertFontFileClosure(style: object, own: {source: string}[], owner: string) {
  const faces = (style as {'font-faces': Record<string, {url: string}[]>})['font-faces'];
  const urls = [...new Set(Object.values(faces).flatMap((files) => files.map((file) => file.url)))];
  const shared = urls.filter((url) => url.startsWith('https://api.tileflow.dev/base/'));
  assert.ok(shared.some((url) => url.endsWith('/NotoSansCJKjp-Regular.otf')));
  const local = urls.filter((url) => !shared.includes(url));
  assert.deepEqual(
    new Set(local.map((url) => new URL(url, owner).href)),
    new Set(own.map((face) => new URL(face.source, owner).href)),
  );
}
