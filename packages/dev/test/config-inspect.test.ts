import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {
  defineMap,
  defineTheme,
  land,
  parseTileflowMap,
  refineRenderTarget,
  token,
  withRenderStack,
} from '@tileflow/core';
import {inspectLoadedTileflowConfig} from '../src/inspect';

test('inspects resolved lineage and merge provenance without source paths or secrets', () => {
  const cwd = resolve('/tmp/tileflow-inspect-fixture');
  const secret = `tf_live_${'b'.repeat(32)}`;
  const rootTheme = defineTheme({
    colorScheme: 'light',
    id: 'root-light',
    tokens: {color: {land: '#eeeeee', water: '#88bbdd'}},
    typography: {font: 'Fixture'},
    version: 1,
  });
  const childTheme = defineTheme(rootTheme, {
    colorScheme: 'light',
    id: 'child-light',
    tokens: {color: {water: '#112233'}},
    typography: {font: `/opt/private/${secret}`},
    version: 2,
  });
  const root = defineMap({
    id: 'root',
    name: 'Root',
    version: 1,
    data: {
      type: 'vector-tiles',
      attribution: 'Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: `https://example.test/data.json?token=${secret}`,
    },
    modules: {
      land: withRenderStack(
        land({
          background: {
            color: token.color('land'),
          },
        }),
        {
          rootOpacity: refineRenderTarget({
            renderer: 'background',
            style: {opacity: 0.75},
            target: 'land.background',
          }),
        },
      ),
    },
    defaultTheme: 'light',
    themes: {light: rootTheme},
  });
  const child = defineMap({
    id: 'child',
    name: `${cwd}/private/${secret}`,
    version: 2,
    extends: root,
    glyphs: {
      kind: 'url',
      fontStacks: ['Fixture'],
      url: `https://example.test/glyphs/${secret}/{fontstack}/{range}.pbf`,
    },
    terrain: {
      hillshade: {accentColor: '#123456', exaggeration: 0.42},
      mode: 'hillshade',
      url: `./${secret}/terrain?token=${secret}#${secret}`,
    },
    defaultTheme: 'light',
    themes: {light: childTheme},
  });
  const resolved = parseTileflowMap(child);
  const loaded = {
    authoringMaps: {child},
    configFile: `${cwd}/tileflow.config.ts`,
    inputFiles: [`${cwd}/tileflow.config.ts`],
    project: {
      mapMetadata: {
        child: {
          id: 'child',
          lineage: [
            {id: 'child', mapVersion: 2},
            {id: 'root', mapVersion: 1},
          ],
          version: 2,
        },
      },
      maps: {child: resolved},
    },
  };

  const first = inspectLoadedTileflowConfig(loaded, {cwd});
  const second = inspectLoadedTileflowConfig(loaded, {cwd});
  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.command, 'inspect');
  assert.equal(first.phase, 'config-inspection');
  assert.equal(first.code, 'INSPECTION_READY');
  assert.deepEqual(
    first.maps[0]?.lineage.map(({id, depth}) => ({id, depth})),
    [
      {id: 'root', depth: 0},
      {id: 'child', depth: 1},
    ],
  );
  assert.equal(first.maps[0]?.resolved.name, './private/tf_[redacted]');
  assert.equal(
    (first.maps[0]?.resolved.glyphs as {url?: string} | undefined)?.url,
    'https://example.test/[redacted]',
  );
  assert.equal(
    (first.maps[0]?.resolved.data as {url?: string} | undefined)?.url,
    'https://example.test/data.json?[redacted]',
  );
  assert.equal(
    (first.maps[0]?.resolved.terrain as {url?: string} | undefined)?.url,
    './tf_[redacted]/terrain?[redacted]#[redacted]',
  );
  assert.equal(
    (first.maps[0]?.resolved.themes as {light?: {typography?: {font?: string}}} | undefined)?.light
      ?.typography?.font,
    '(external path)',
  );
  assert.deepEqual(
    first.maps[0]?.provenance.find((entry) => entry.path === 'themes.light.tokens.color.water'),
    {
      declared: true,
      inherited: false,
      operation: 'overridden',
      path: 'themes.light.tokens.color.water',
      sourceDepth: 1,
      sourceMap: 'child',
    },
  );
  assert.equal(first.maps[0]?.themeContract.defaultTheme, 'light');
  assert.deepEqual(first.maps[0]?.themeContract.tokenSchema.color, ['land', 'water']);
  assert.equal(first.maps[0]?.themeContract.themes.light?.tokens.color.water, '#112233');
  assert.deepEqual(first.maps[0]?.themeContract.audit, [
    {
      category: 'number',
      code: 'THEME_IMPLICIT_FIXED',
      message:
        'Visual number literal is implicitly fixed; use token.number(...) or fixed(value, {reason}).',
      owner: 'land',
      path: 'modules.land.renderStack.rootOpacity.style.opacity',
      phase: 'theme-audit',
      scope: 'module',
      severity: 'warning',
      suggestion:
        'Replace the literal with token.number(...) or document the invariant with fixed(value, {reason}).',
      value: 0.75,
    },
    {
      category: 'color',
      code: 'THEME_IMPLICIT_FIXED',
      message:
        'Visual color literal is implicitly fixed; use token.color(...) or fixed(value, {reason}).',
      path: 'terrain.hillshade.accentColor',
      phase: 'theme-audit',
      scope: 'terrain',
      severity: 'error',
      suggestion:
        'Replace the literal with token.color(...) or document the invariant with fixed(value, {reason}).',
      value: '#123456',
    },
    {
      category: 'number',
      code: 'THEME_IMPLICIT_FIXED',
      message:
        'Visual number literal is implicitly fixed; use token.number(...) or fixed(value, {reason}).',
      path: 'terrain.hillshade.exaggeration',
      phase: 'theme-audit',
      scope: 'terrain',
      severity: 'warning',
      suggestion:
        'Replace the literal with token.number(...) or document the invariant with fixed(value, {reason}).',
      value: 0.42,
    },
  ]);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /\/tmp\/tileflow-inspect-fixture|tf_live_|user:password|token=/u);
  assert.equal(serialized.includes('inputFiles'), false);
});

test('provenance depth disambiguates a wrapper with the same id as its parent', () => {
  const root = defineMap({
    id: 'streets',
    version: 1,
    defaultTheme: 'light',
    themes: {
      light: defineTheme({
        colorScheme: 'light',
        id: 'light',
        tokens: {color: {land: '#eeeeee'}},
        version: 1,
      }),
    },
    view: {zoom: 10},
  });
  const wrapper = defineMap({id: 'streets', version: 2, extends: root, view: {zoom: 12}});
  const resolved = parseTileflowMap(wrapper);
  const inspection = inspectLoadedTileflowConfig(
    {
      authoringMaps: {streets: wrapper},
      configFile: '/tmp/tileflow.config.ts',
      inputFiles: [],
      project: {maps: {streets: resolved}},
    },
    {cwd: '/tmp'},
  );

  assert.deepEqual(
    inspection.maps[0]?.lineage.map(({depth, id}) => ({depth, id})),
    [
      {depth: 0, id: 'streets'},
      {depth: 1, id: 'streets'},
    ],
  );
  assert.deepEqual(
    inspection.maps[0]?.provenance.find(({path}) => path === 'view.zoom'),
    {
      declared: true,
      inherited: false,
      operation: 'overridden',
      path: 'view.zoom',
      sourceDepth: 1,
      sourceMap: 'streets',
    },
  );
  assert.equal(
    inspection.maps[0]?.provenance.find(({path}) => path === 'themes.light.tokens.color.land')
      ?.sourceDepth,
    0,
  );
});

test('rejects unknown map selection with a structured inspection error', () => {
  const root = defineMap({
    id: 'main',
    version: 1,
    defaultTheme: 'light',
    themes: {
      light: defineTheme({colorScheme: 'light', id: 'light', version: 1}),
    },
  });
  const resolved = parseTileflowMap(root);

  assert.throws(
    () =>
      inspectLoadedTileflowConfig(
        {
          authoringMaps: {main: root},
          configFile: '/tmp/tileflow.config.ts',
          inputFiles: [],
          project: {maps: {main: resolved}},
        },
        {cwd: '/tmp', map: 'missing'},
      ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INSPECT_MAP_NOT_FOUND' &&
      'phase' in error &&
      error.phase === 'config-inspection',
  );
});
