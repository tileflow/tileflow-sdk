import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parseTileflowMap, serializeCanonicalJson} from '@tileflow/core';
import {tileflowNativeDiagnosticSchema} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {evaluateNativeCatalog, nativeCatalogMaps} from './native-catalog-fixture';

test('records every official map/theme deterministically and requires Streets to pass', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-catalog-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  const first = await evaluateNativeCatalog(cwd);
  const second = await evaluateNativeCatalog(cwd);
  assert.equal(serializeCanonicalJson(first), serializeCanonicalJson(second));
  assert.equal(new Set(first.rows.map(({map}) => map)).size, 10);
  const expected = nativeCatalogMaps
    .flatMap((map) =>
      Object.keys(parseTileflowMap(map).themes).map((theme) => `${map.id}/${theme}`),
    )
    .sort();
  assert.deepEqual(first.rows.map(({map, theme}) => `${map}/${theme}`).sort(), expected);
  const streets = first.rows.filter(({map}) => map === 'streets');
  assert.ok(streets.length > 0);
  assert.ok(
    streets.every(({status}) => status === 'compatible-artifacts'),
    JSON.stringify(streets),
  );
  for (const row of first.rows) {
    if (row.status === 'compatible-artifacts') {
      assert.match(row.styleSha256 ?? '', /^[a-f0-9]{64}$/u);
      assert.deepEqual(row.diagnostics, []);
    } else {
      assert.ok(row.diagnostics.length > 0);
      assert.equal(row.styleSha256, undefined);
      for (const diagnostic of row.diagnostics) {
        assert.equal(tileflowNativeDiagnosticSchema.safeParse(diagnostic).success, true);
      }
    }
  }
  assert.equal(serializeCanonicalJson(first).includes(cwd), false);
});
