import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

test('declares the browser entry without exposing it from the package root', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    files: string[];
  };

  assert.deepEqual(manifest.exports['./browser'], {
    types: './dist/browser.d.ts',
    import: './dist/browser.js',
    default: './dist/browser.js',
  });
  assert.deepEqual(manifest.exports['./manifest'], {
    types: './dist/manifest.d.ts',
    import: './dist/manifest.js',
    default: './dist/manifest.js',
  });
  assert.deepEqual(manifest.exports['./capture'], {
    types: './dist/capture.d.ts',
    import: './dist/capture.js',
    default: './dist/capture.js',
  });
  assert.deepEqual(manifest.exports['./runtime'], {
    types: './dist/runtime.d.ts',
    import: './dist/runtime.js',
    default: './dist/runtime.js',
  });
  assert.equal(manifest.exports['./recipe'], undefined);
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.equal(manifest.exports['./maps'], undefined);
  assert.equal(Object.hasOwn(manifest.exports['.'] as object, 'browser'), false);
  assert.deepEqual(manifest.files, [
    'dist',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'GENERATED_OUTPUT_LICENSE.md',
    'TRADEMARKS.md',
  ]);
});

test('imports the packaged manifest and runtime boundaries without browser globals', async () => {
  const script = `
    const capture = await import('@tileflow/core/capture');
    const manifest = await import('@tileflow/core/manifest');
    const runtime = await import('@tileflow/core/runtime');
    if (typeof capture.normalizeTileflowCaptureId !== 'function') process.exit(1);
    if (typeof manifest.parseTileflowRuntimeManifest !== 'function') process.exit(2);
    if (typeof runtime.resolveTileflowRuntimeView !== 'function') process.exit(3);
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('keeps config compilation out of runtime and browser bundles', async () => {
  for (const entry of ['runtime.js', 'browser.js']) {
    const output = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
    assert.doesNotMatch(output, /createStyle|createStyleFromCatalog|compilerVersion/u);
  }
});

test('ships notices for every third-party component embedded in the browser entry', async () => {
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  for (const requiredNotice of [
    'maplibre-contour 0.1.0',
    'd3-contour',
    'vt-pbf',
    'pbf 4.0.1',
    'node-buffer-more-ints',
    'buffer <https://github.com/feross/buffer>',
    'TypeScript helper code',
  ]) {
    assert.equal(notices.includes(requiredNotice), true, `missing notice for ${requiredNotice}`);
  }
});

test('keeps the native browser entry free of bare package imports', async () => {
  const output = await readFile(new URL('../dist/browser.js', import.meta.url), 'utf8');
  assert.doesNotMatch(output, /(?:from\s+|import\s*)["'][^./]/u);
});

test('imports the packaged browser entry without reading browser globals', async () => {
  const script = `
    for (const name of [
      'window',
      'document',
      'navigator',
      'requestAnimationFrame',
      'ResizeObserver',
    ]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    const entry = await import('@tileflow/core/browser');
    if (typeof entry.attachTileflowMapLifecycle !== 'function') process.exit(2);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('does not re-export the browser kernel from the packaged root', async () => {
  const script = `
    const entry = await import('@tileflow/core');
    if ('attachTileflowMapLifecycle' in entry) process.exit(2);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('packages the singular map engine without official maps or legacy authoring exports', async () => {
  const script = `
    const entry = await import('@tileflow/core');
    for (const name of [
      'defineMap', 'land', 'water', 'roads', 'transit', 'aeroways',
      'buildings', 'boundaries', 'labels', 'poi', 'vegetation', 'nautical', 'bathymetry', 'createStyle',
      'tileflowWorld', 'defineTheme', 'fixed', 'resolveMarine',
      'inferTileflowSourceRequirements',
    ]) {
      if (typeof entry[name] !== 'function') process.exit(2);
    }
    if (typeof entry.token !== 'object' || typeof entry.color !== 'object') process.exit(2);
    for (const removed of [
      'basemap', 'createStyleFromProject', 'cyberpunk', 'defineRootMap', 'defineTileflow', 'osm', 'streets',
      'styleOverride', 'verdant', 'WorldGenerationDescriptor', 'parseWorldGenerationDescriptor',
      'tileflowStreetsCompilerVersion', 'tileflowWorldTileUrl',
      'expression', 'filter',
      'isMapLibreExpressionOperator',
    ]) {
      if (removed in entry) process.exit(3);
    }
    let rejectedDataGlyphs = false;
    const light = entry.defineTheme({
      id: 'smoke-light', version: 1, colorScheme: 'light',
      tokens: {
        color: {
          'boundaries.default': '#C9D1D9', 'labels.halo': '#FFFFFF',
          'labels.muted': '#727B84', 'labels.primary': '#3C4043',
          'roads.casing': '#D9DEE2', 'roads.default': '#FFFFFF',
          'roads.major': '#F4C95D', 'surface.background': '#F6F7F3',
          'surface.building': '#E6E3DA', 'surface.land': '#F1F3ED',
          'surface.park': '#CDE8B5', 'surface.water': '#A9D3F5',
        },
        font: {default: 'Noto Sans Regular'},
      },
      typography: {font: entry.token.font('default')},
    });
    try {
      const removedDataGlyphMap = entry.defineMap({
        id: 'removed-data-glyphs',
        version: 1,
        defaultTheme: 'light',
        themes: {light},
        glyphs: {kind: 'data', fontStacks: ['Noto Sans Regular']},
      });
      entry.parseTileflowMap(removedDataGlyphMap);
    } catch {
      rejectedDataGlyphs = true;
    }
    if (!rejectedDataGlyphs) process.exit(6);
    const map = entry.defineMap({
      id: 'smoke',
      version: 1,
      defaultTheme: 'light',
      glyphs: {
        kind: 'url',
        url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
        fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
      },
      themes: {light},
    });
    const style = entry.createStyle(map, {
      preparedAssets: {
        icons: {
          ids: [
            'coffee', 'crosswalk', 'culture', 'education', 'food', 'health',
            'lodging', 'major-transit', 'oneway', 'road-shield-circle-neutral',
            'road-shield-rectangle-blue', 'road-shield-rectangle-green',
            'road-shield-rectangle-neutral', 'road-shield-rectangle-orange',
            'road-shield-rectangle-red', 'road-shield-rectangle-yellow',
            'services', 'shopping', 'sidewalk-dot',
          ],
          sprite: '/tileflow/test/streets/sprite',
        },
      },
    });
    if (style.metadata['tileflow:map'] !== 'smoke') process.exit(4);
    if (style.metadata['tileflow:compiler'] !== 'tileflow-semantic') process.exit(4);
    if (!style.layers.every((layer) => layer.id.startsWith('tileflow-'))) process.exit(5);

  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');

  const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /highway-primary|rendererPreference/i);
});

test('keeps removed World, compiler-family, and data glyph contracts out of declarations', async () => {
  const declarationDirectory = new URL('../dist/', import.meta.url);
  const declarationFiles = (await readdir(declarationDirectory)).filter((fileName) =>
    fileName.endsWith('.d.ts'),
  );
  const declarations = (
    await Promise.all(
      declarationFiles.map((fileName) => readFile(new URL(fileName, declarationDirectory), 'utf8')),
    )
  ).join('\n');
  for (const removed of [
    'WorldGenerationDescriptor',
    'parseWorldGenerationDescriptor',
    'TileflowStreetsModules',
    'tileflowWorldTileUrl',
    'worldGenerationDescriptorSchema',
  ]) {
    assert.equal(declarations.includes(removed), false, `found removed declaration ${removed}`);
  }
  assert.equal(declarations.includes('TileflowSemanticModules'), true);
  assert.doesNotMatch(declarations, /kind:\s*(?:'data'|"data")/u);
});
