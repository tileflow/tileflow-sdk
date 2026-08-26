import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {defineMap, defineRootMap, parseTileflowMap} from '@tileflow/core';
import {inspectLoadedTileflowConfig} from '../src/inspect';

test('inspects resolved lineage and merge provenance without source paths or secrets', () => {
  const cwd = resolve('/tmp/tileflow-inspect-fixture');
  const secret = `tf_live_${'b'.repeat(32)}`;
  const root = defineRootMap({
    id: 'root',
    name: 'Root',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    data: {
      type: 'vector-tiles',
      attribution: 'Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: `https://example.test/data.json?token=${secret}`,
    },
    modules: {
      land: {
        type: 'land',
        background: {
          color: {
            kind: 'expression',
            value: ['literal', {[secret]: `${cwd}/private/${secret}`}],
          },
        },
      },
    },
    theme: {colors: {land: '#eeeeee'}, mode: 'light'},
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
      mode: 'hillshade',
      url: `./${secret}/terrain?token=${secret}#${secret}`,
    },
    theme: {
      colors: {water: '#112233'},
      typography: {font: `/opt/private/${secret}`},
    },
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
          root: resolved.root,
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
  assert.deepEqual(
    (
      first.maps[0]?.resolved.modules as
        | {land?: {background?: {color?: {value?: unknown[]}}}}
        | undefined
    )?.land?.background?.color?.value?.[1],
    {'tf_[redacted]': './private/tf_[redacted]'},
  );
  assert.equal(
    (first.maps[0]?.resolved.theme as {typography?: {font?: string}} | undefined)?.typography?.font,
    '(external path)',
  );
  assert.deepEqual(
    first.maps[0]?.provenance.find((entry) => entry.path === 'theme.colors.water'),
    {
      declared: true,
      inherited: false,
      operation: 'defined',
      path: 'theme.colors.water',
      sourceDepth: 1,
      sourceMap: 'child',
    },
  );
  assert.equal(
    first.maps[0]?.provenance.find((entry) => entry.path === 'theme.colors.land')?.sourceMap,
    'root',
  );
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /\/tmp\/tileflow-inspect-fixture|tf_live_|user:password|token=/u);
  assert.equal(serialized.includes('inputFiles'), false);
});

test('provenance depth disambiguates a wrapper with the same id as its parent', () => {
  const root = defineRootMap({
    id: 'streets',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    theme: {colors: {land: '#eeeeee'}},
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
    inspection.maps[0]?.provenance.find(({path}) => path === 'theme.colors.land')?.sourceDepth,
    0,
  );
});

test('rejects unknown map selection with a structured inspection error', () => {
  const root = defineRootMap({
    id: 'main',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
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
