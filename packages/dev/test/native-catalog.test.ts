import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parseTileflowMap, serializeCanonicalJson} from '@tileflow/core';
import {
  tileflowNativeDegradationsSchema,
  tileflowNativeDiagnosticSchema,
} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {evaluateNativeCatalog, nativeCatalogMaps} from './native-catalog-fixture';

test('prepares every official theme, recording what each native artifact draws differently', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-catalog-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  const first = await evaluateNativeCatalog(cwd);
  const second = await evaluateNativeCatalog(cwd);
  assert.equal(serializeCanonicalJson(first), serializeCanonicalJson(second));
  assert.equal(new Set(first.rows.map(({map}) => map)).size, 3);
  const expected = nativeCatalogMaps
    .flatMap((map) =>
      Object.keys(parseTileflowMap(map).themes).map((theme) => `${map.id}/${theme}`),
    )
    .sort();
  assert.deepEqual(first.rows.map(({map, theme}) => `${map}/${theme}`).sort(), expected);
  // Every theme of every official map has a native artifact; what it leaves out is recorded.
  for (const row of first.rows) {
    assert.equal(row.status, 'compatible-artifacts', JSON.stringify(row.diagnostics));
    assert.match(row.styleSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.deepEqual(row.diagnostics, []);
    assert.equal(tileflowNativeDegradationsSchema.safeParse(row.degradations).success, true);
    for (const diagnostic of row.diagnostics)
      assert.equal(tileflowNativeDiagnosticSchema.safeParse(diagnostic).success, true);
  }
  // Every official map opens in native apps; degradations are information, never a block.
  assert.deepEqual(
    first.maps.map(({map, degradations, incompatibleThemes}) => [
      map,
      degradations.filter((id) => id.startsWith('deviceContours')),
      incompatibleThemes,
    ]),
    [
      ['outdoors', ['deviceContours:outdoors-contours'], []],
      ['soundings', [], []],
      ['streets', [], []],
    ],
  );
  const degradations = (map: string) => [
    ...new Set(
      first.rows
        .filter((row) => row.map === map)
        .flatMap((row) => row.degradations.map(({id, fallback}) => `${id}:${fallback}`)),
    ),
  ];
  // Every Streets theme colours paths on green ground, so each derives the green portions.
  assert.deepEqual(degradations('streets'), [
    'globe:mercator',
    'models3d:extrusions',
    'pathGround:tileflow-path-ground:none',
    'scene3d:extrusions',
    'sky:none',
    'trees3d:none',
  ]);
  assert.deepEqual(degradations('soundings'), [
    'nauticalLightRhythm:steady',
    'reliefResampling:engine-default',
  ]);
  assert.equal(serializeCanonicalJson(first).includes(cwd), false);
});
