import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {collectRuntimeNotices} from '../../../scripts/mobile-runtime-notices.mjs';

test('prebundled dependencies retain their upstream notices alongside their own license', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-mobile-notices-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'dist'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({name: 'bundled-library', version: '1.0.0', license: 'MIT'}),
  );
  await writeFile(join(root, 'LICENSE'), 'Library license fixture');
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'Embedded dependency license fixture');
  const result = await collectRuntimeNotices({
    inputs: ['dist/index.js'],
    packageRoot: root,
    repositoryRoot: root,
  });
  assert.ok(result.text.includes('Library license fixture'));
  assert.ok(result.text.includes('Embedded dependency license fixture'));
  assert.deepEqual(result.inventory, [{name: 'bundled-library', version: '1.0.0', license: 'MIT'}]);
});
