import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  createStyle,
  getTileflowStyleFontFaces,
  type MapLibreStyle,
  resolveMap,
  type TileflowFontDirectory,
} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {cyberpunkFonts, siegfried, siegfriedFonts} from '@tileflow/maps';
import {
  bindTileflowStyleFontBundle,
  getTileflowFontWatchPaths,
  prepareTileflowStyleFonts,
  TileflowFontCompilationError,
} from '../src/fonts';
import {getTileflowPreviewRuntimeResponse} from '../src/preview-assets';
import {renderTileflowPreviewHtml} from '../src/preview-html';
import {fixtureThemeFields} from './theme-fixture';

const oxaniumMedium = new URL(
  '../../maps/assets/cyberpunk/fonts/Oxanium-Medium.ttf',
  import.meta.url,
);
const nextGeistWoff2 = new URL(
  '../../next/node_modules/next/dist/next-devtools/server/font/geist-latin.woff2',
  import.meta.url,
);

test('prepares declared TTF faces, licenses, metadata, and watch inputs deterministically', async (t) => {
  const cwd = await fixture(t);
  await createFontDirectory(cwd, 'fonts', [['MapFont.ttf', await readFile(oxaniumMedium)]]);
  const project = fontProject(['./fonts']);
  const styles = {main: {light: fontStyle(['Oxanium Medium', 'Noto Sans', 'sans-serif'])}};

  const first = await prepareTileflowStyleFonts(project, styles, {
    assetBaseUrl: '/tileflow',
    cwd,
    target: 'local',
  });
  const second = await prepareTileflowStyleFonts(project, styles, {
    assetBaseUrl: '/tileflow',
    cwd,
    target: 'local',
  });

  assert.deepEqual(
    first.assets.map((asset) => [asset.contentType, asset.fileName]),
    second.assets.map((asset) => [asset.contentType, asset.fileName]),
  );
  assert.equal(first.assets.length, 2);
  assert.match(first.assets[0]!.fileName, /^fonts\/licenses\/license-[a-f0-9]{64}\.txt$/u);
  assert.match(first.assets[1]!.fileName, /^fonts\/oxanium-medium-[a-f0-9]{64}\.ttf$/u);
  assert.deepEqual(first.watchPaths, [await realpath(join(cwd, 'fonts'))]);
  assert.deepEqual(getTileflowStyleFontFaces(first.styles.main!.light!), [
    {
      family: 'Oxanium Medium',
      source: `/tileflow/${first.assets[1]!.fileName}`,
      style: 'normal',
      weight: '500',
    },
  ]);
  const bundle = first.bundles.main!;
  assert.match(bundle.contentHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(bundle.files, first.assets);
  assert.deepEqual(bundle.manifest.fontFaces, [
    {
      family: 'Oxanium Medium',
      file: first.assets[1]!.fileName,
      licenseFile: first.assets[0]!.fileName,
      style: 'normal',
      weight: '500',
    },
  ]);
  assert.deepEqual(first.sourceIdentities.main, [
    {
      family: 'Oxanium Medium',
      sha256: createHash('sha256').update(first.assets[1]!.source).digest('hex'),
      style: 'normal',
      weight: '500',
    },
  ]);
  assert.equal(
    getTileflowStyleFontFaces(
      bindTileflowStyleFontBundle(
        first.styles.main!.light!,
        bundle,
        `https://assets.example.test/font-bundles/${bundle.contentHash}`,
      ),
    )[0]?.source,
    `https://assets.example.test/font-bundles/${bundle.contentHash}/${first.assets[1]!.fileName}`,
  );
});

test('later directories replace exact canonical faces', async (t) => {
  const cwd = await fixture(t);
  const source = await readFile(oxaniumMedium);
  const override = Buffer.concat([source, Buffer.from([0])]);
  await createFontDirectory(cwd, 'base', [['base.ttf', source]], 'base license');
  await createFontDirectory(cwd, 'override', [['override.ttf', override]], 'override license');

  const prepared = await prepareTileflowStyleFonts(
    fontProject(['./base', './override']),
    {main: {light: fontStyle(['Oxanium Medium'])}},
    {assetBaseUrl: '..', cwd, target: 'hosted'},
  );
  const expectedDigest = createHash('sha256').update(override).digest('hex');
  const fontAsset = prepared.assets.find((asset) => asset.contentType === 'font/ttf');

  assert.equal(fontAsset?.fileName, `fonts/oxanium-medium-${expectedDigest}.ttf`);
  assert.equal(prepared.assets.filter((asset) => asset.contentType === 'font/ttf').length, 1);
  assert.equal(prepared.assets.filter((asset) => asset.fileName.includes('/licenses/')).length, 1);
  assert.equal(
    getTileflowStyleFontFaces(prepared.styles.main!.light!)[0]?.source,
    `../fonts/oxanium-medium-${expectedDigest}.ttf`,
  );
});

test('prepares all three packaged Siegfried faces with one OFL license', async (t) => {
  const cwd = await fixture(t);
  const icons = [
    'siegfried-dark-forest',
    'siegfried-dark-glacier',
    'siegfried-dark-gravel',
    'siegfried-dark-orchard',
    'siegfried-dark-paper-grain',
    'siegfried-dark-rock',
    'siegfried-dark-scree',
    'siegfried-dark-water-lines',
    'siegfried-dark-wetland',
    'siegfried-forest',
    'siegfried-glacier',
    'siegfried-gravel',
    'siegfried-orchard',
    'siegfried-paper-grain',
    'siegfried-rock',
    'siegfried-scree',
    'siegfried-water-lines',
    'siegfried-wetland',
  ];
  const light = createStyle(siegfried, {
    preparedAssets: {icons: {ids: icons, sprite: '/assets/icons/siegfried/sprite'}},
    theme: 'light',
  });
  const dark = createStyle(siegfried, {
    preparedAssets: {icons: {ids: icons, sprite: '/assets/icons/siegfried/sprite'}},
    theme: 'dark',
  });
  const prepared = await prepareTileflowStyleFonts(
    {maps: {siegfried}},
    {siegfried: {dark, light}},
    {assetBaseUrl: '/assets', cwd, target: 'local'},
  );

  assert.deepEqual(prepared.watchPaths, []);
  assert.equal(prepared.assets.filter((asset) => asset.contentType === 'font/ttf').length, 3);
  assert.equal(prepared.assets.filter((asset) => asset.fileName.includes('/licenses/')).length, 1);
  assert.deepEqual(
    getTileflowStyleFontFaces(prepared.styles.siegfried!.light!).map(
      ({family, style: fontStyle, weight}) => ({family, style: fontStyle, weight}),
    ),
    [
      {family: 'Cormorant Garamond Italic', style: 'italic', weight: '400'},
      {family: 'Cormorant Garamond Regular', style: 'normal', weight: '400'},
      {family: 'Cormorant Garamond SemiBold', style: 'normal', weight: '600'},
    ],
  );
  assert.deepEqual(
    getTileflowStyleFontFaces(prepared.styles.siegfried!.dark!).map(
      ({family, style: fontStyle, weight}) => ({family, style: fontStyle, weight}),
    ),
    [
      {family: 'Cormorant Garamond Italic', style: 'italic', weight: '400'},
      {family: 'Cormorant Garamond Regular', style: 'normal', weight: '400'},
      {family: 'Cormorant Garamond SemiBold', style: 'normal', weight: '600'},
    ],
  );
  assert.deepEqual(await getTileflowFontWatchPaths({maps: {siegfried}}, cwd), []);
  assert.deepEqual(resolveMap(siegfried).fonts, [siegfriedFonts]);
});

test('font extension, MIME, and OpenType signature must agree', async (t) => {
  const cwd = await fixture(t);
  await createFontDirectory(cwd, 'fonts', [['renamed.otf', await readFile(oxaniumMedium)]]);

  await assert.rejects(
    prepareTileflowStyleFonts(
      fontProject(['./fonts']),
      {main: {light: fontStyle(['Oxanium Medium'])}},
      {assetBaseUrl: '/assets', cwd, target: 'hosted'},
    ),
    /File bytes do not match the \.otf format/u,
  );
});

test('resolves local font directories from the nested config base', async (t) => {
  const cwd = await fixture(t);
  const baseDirectory = join(cwd, 'configs', 'map');
  await mkdir(baseDirectory, {recursive: true});
  await createFontDirectory(baseDirectory, 'fonts', [
    ['MapFont.ttf', await readFile(oxaniumMedium)],
  ]);

  const prepared = await prepareTileflowStyleFonts(
    fontProject(['./fonts']),
    {main: {light: fontStyle(['Oxanium Medium'])}},
    {assetBaseUrl: '/assets', baseDirectory, cwd, target: 'local'},
  );

  assert.deepEqual(prepared.watchPaths, [await realpath(join(baseDirectory, 'fonts'))]);
  assert.deepEqual(
    await getTileflowFontWatchPaths(fontProject(['./fonts']), cwd, baseDirectory),
    prepared.watchPaths,
  );
});

test('reads real WOFF2 metadata through the same generic directory contract', async (t) => {
  let source: Uint8Array;
  try {
    source = await readFile(nextGeistWoff2);
  } catch {
    t.skip('The workspace Next.js WOFF2 fixture is not installed.');
    return;
  }
  const cwd = await fixture(t);
  await createFontDirectory(cwd, 'fonts', [['Geist.woff2', source]]);

  const prepared = await prepareTileflowStyleFonts(
    fontProject(['./fonts']),
    {main: {light: fontStyle(['Geist Regular'])}},
    {assetBaseUrl: '/assets', cwd, target: 'local'},
  );

  assert.equal(
    prepared.assets.some((asset) => asset.contentType === 'font/woff2'),
    true,
  );
  assert.deepEqual(getTileflowStyleFontFaces(prepared.styles.main!.light!), [
    {
      family: 'Geist Regular',
      source: `/assets/${prepared.assets.find((asset) => asset.contentType === 'font/woff2')!.fileName}`,
      style: 'normal',
      weight: '400',
    },
  ]);
});

test('rejects missing licenses, missing primaries, dynamic stacks, and casefold collisions', async (t) => {
  const source = await readFile(oxaniumMedium);

  {
    const cwd = await fixture(t);
    await mkdir(join(cwd, 'fonts'));
    await writeFile(join(cwd, 'fonts', 'font.ttf'), source);
    await assert.rejects(
      prepareTileflowStyleFonts(
        fontProject(['./fonts']),
        {main: {light: fontStyle(['Oxanium Medium'])}},
        {assetBaseUrl: '/assets', cwd, target: 'local'},
      ),
      (error: unknown) =>
        error instanceof TileflowFontCompilationError && /LICENSE\.txt/u.test(error.message),
    );
  }

  {
    const cwd = await fixture(t);
    await createFontDirectory(cwd, 'fonts', [['font.ttf', source]]);
    await assert.rejects(
      prepareTileflowStyleFonts(
        fontProject(['./fonts']),
        {main: {light: fontStyle(['Missing Regular'])}},
        {assetBaseUrl: '/assets', cwd, target: 'local'},
      ),
      /No declared font directory provides canonical face "Missing Regular"/u,
    );
    await assert.rejects(
      prepareTileflowStyleFonts(
        fontProject(['./fonts']),
        {main: {light: fontStyle(['get', 'font'] as never)}},
        {assetBaseUrl: '/assets', cwd, target: 'local'},
      ),
      /static non-empty text-font stack/u,
    );
  }

  {
    const cwd = await fixture(t);
    await createFontDirectory(cwd, 'lower', [['font.ttf', source]]);
    await createFontDirectory(cwd, 'upper', [
      ['font.ttf', replaceUtf16Be(source, 'Oxanium Medium', 'OXANIUM MEDIUM')],
    ]);
    await assert.rejects(
      prepareTileflowStyleFonts(
        fontProject(['./lower', './upper']),
        {main: {light: fontStyle(['Oxanium Medium'])}},
        {assetBaseUrl: '/assets', cwd, target: 'local'},
      ),
      /differs from already declared "Oxanium Medium" only by case/u,
    );
  }
});

test('maps without a local font provider do not emit or mutate font metadata', async (t) => {
  const cwd = await fixture(t);
  const project = fontProject(undefined);
  const style = fontStyle(['System Regular']);
  const prepared = await prepareTileflowStyleFonts(
    project,
    {main: {light: style}},
    {assetBaseUrl: '/assets', cwd, target: 'local'},
  );
  assert.deepEqual(prepared, {
    assets: [],
    bundles: {},
    sourceIdentities: {},
    styles: {main: {light: style}},
    watchPaths: [],
  });
});

test('rejects non-portable map and concrete theme keys at the preparation boundary', async () => {
  const map = fontProject(undefined).maps.main!;
  const style = fontStyle(['System Regular']);
  const options = {assetBaseUrl: '/assets', cwd: process.cwd(), target: 'local'} as const;

  for (const mapName of ['Main', 'main_map', 'con', 'constructor']) {
    await assert.rejects(
      prepareTileflowStyleFonts({maps: {[mapName]: map}}, {[mapName]: {light: style}}, options),
      (error: unknown) =>
        error instanceof TileflowFontCompilationError &&
        error.issues.some(
          (issue) => issue.path === `maps.${mapName}` && /portable map key/u.test(issue.message),
        ),
      mapName,
    );
  }

  for (const themeName of ['Dark', 'dark_mode', 'con', 'constructor', 'system']) {
    const invalidProject = {
      maps: {
        main: {
          ...map,
          defaultTheme: themeName,
          themes: {[themeName]: fixtureThemeFields.themes.light},
        },
      },
    } as unknown as TileflowBuildCatalog;

    await assert.rejects(
      prepareTileflowStyleFonts(invalidProject, {main: {[themeName]: style}}, options),
      (error: unknown) =>
        error instanceof TileflowFontCompilationError &&
        error.issues.some(
          (issue) =>
            issue.path === `styles.main.${themeName}` &&
            /concrete portable theme key/u.test(issue.message),
        ),
      themeName,
    );
  }

  const invalidAuthoredProject = {
    maps: {
      main: {
        ...map,
        defaultTheme: 'system',
        themes: {system: fixtureThemeFields.themes.light},
      },
    },
  } as unknown as TileflowBuildCatalog;
  await assert.rejects(
    prepareTileflowStyleFonts(invalidAuthoredProject, {main: {light: style}}, options),
    /concrete theme name|system is browser-only/u,
  );
});

test('watch-path discovery remains tolerant of an invalid compiled theme identity', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'fonts'));
  const map = fontProject(['./fonts']).maps.main!;
  const invalidProject = {
    maps: {
      main: {
        ...map,
        defaultTheme: 'system',
        themes: {system: fixtureThemeFields.themes.light},
      },
    },
  } as unknown as TileflowBuildCatalog;

  assert.deepEqual(await getTileflowFontWatchPaths(invalidProject, cwd), [
    await realpath(join(cwd, 'fonts')),
  ]);
  await assert.rejects(
    prepareTileflowStyleFonts(
      invalidProject,
      {main: {system: fontStyle(['System Regular'])}},
      {assetBaseUrl: '/assets', cwd, target: 'local'},
    ),
    /concrete portable theme key/u,
  );
});

test('discovers mutable font directories before compilation and excludes package assets', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'fonts'));

  assert.deepEqual(await getTileflowFontWatchPaths(fontProject(['./fonts']), cwd), [
    await realpath(join(cwd, 'fonts')),
  ]);
  assert.deepEqual(await getTileflowFontWatchPaths(fontProject([cyberpunkFonts]), cwd), []);
});

test('preview loads generic style metadata through the shared browser runtime', async () => {
  const html = renderTileflowPreviewHtml(
    {
      camera: {bearing: 0, center: [0, 0], pitch: 0, type: 'center', zoom: 4},
      label: 'Generic',
      mapName: 'main',
      themeName: 'light',
    },
    '',
    {generation: 1, status: 'ready'},
    true,
    [
      {
        family: 'Generic </script> Regular',
        source: '/fonts/generic-a1.woff2',
        style: 'normal',
        weight: '400',
      },
    ],
  );
  assert.match(html, /import \{loadTileflowStyleFonts\}/u);
  assert.match(html, /registerTileflowContourProtocol/u);
  assert.match(html, /from "\/__runtime\/tileflow-browser\.js"/u);
  assert.match(html, /await loadTileflowStyleFonts\(styleUrl, \{fontFaces: previewFontFaces\}\)/u);
  assert.match(html, /Generic \\u003c\/script\\u003e Regular/u);
  assert.doesNotMatch(html, /Oxanium|__runtime\/fonts\//u);

  const runtime = getTileflowPreviewRuntimeResponse('/__runtime/tileflow-browser.js');
  assert.equal(runtime?.status, 200);
  assert.match(runtime?.headers.get('content-type') ?? '', /javascript/u);
  assert.match((await runtime?.text()) ?? '', /loadTileflowStyleFonts/u);
  assert.equal(getTileflowPreviewRuntimeResponse('/__runtime/fonts/oxanium-medium.ttf'), undefined);
});

function fontProject(fonts: readonly TileflowFontDirectory[] | undefined): TileflowBuildCatalog {
  return {
    maps: {
      main: {
        id: 'main',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 1},
        ...fixtureThemeFields,
        ...(fonts === undefined ? {} : {fonts}),
      },
    },
  };
}

function fontStyle(fontStack: unknown): MapLibreStyle {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'labels',
        type: 'symbol',
        layout: {'text-field': 'Name', 'text-font': fontStack},
      },
    ],
  } as MapLibreStyle;
}

async function fixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-fonts-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return cwd;
}

async function createFontDirectory(
  cwd: string,
  directory: string,
  files: ReadonlyArray<readonly [string, Uint8Array]>,
  license = 'Test font license\n',
): Promise<void> {
  const root = join(cwd, directory);
  await mkdir(root);
  await writeFile(join(root, 'LICENSE.txt'), license);
  for (const [fileName, source] of files) {
    await writeFile(join(root, fileName), source);
  }
}

function replaceUtf16Be(input: Uint8Array, from: string, replacement: string): Uint8Array {
  assert.equal(from.length, replacement.length);
  const source = Buffer.from(input);
  const needle = Buffer.from([...from].flatMap((character) => [0, character.charCodeAt(0)]));
  const value = Buffer.from([...replacement].flatMap((character) => [0, character.charCodeAt(0)]));
  let offset = source.indexOf(needle);
  assert.notEqual(offset, -1);
  while (offset >= 0) {
    value.copy(source, offset);
    offset = source.indexOf(needle, offset + value.length);
  }
  return source;
}
