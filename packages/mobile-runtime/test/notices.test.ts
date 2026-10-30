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

test('PMTiles uses only its exact reviewed notice when the tarball omits the license', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-mobile-notices-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dependency = join(root, 'pmtiles');
  const core = join(root, 'packages/core');
  await mkdir(dependency);
  await mkdir(core, {recursive: true});
  const manifest = {name: 'pmtiles', version: '4.5.0', license: 'BSD-3-Clause'};
  await writeFile(join(dependency, 'package.json'), JSON.stringify(manifest));
  await writeFile(
    join(core, 'THIRD_PARTY_NOTICES.md'),
    '# Notices\n\n## PMTiles 4.5.0\n\nReviewed upstream license fixture\n\n## Another package\nOther notice\n'.replaceAll(
      '\n',
      '\r\n',
    ),
  );
  const options = {inputs: ['index.js'], packageRoot: dependency, repositoryRoot: root};
  const result = await collectRuntimeNotices(options);
  assert.ok(result.text.includes('Reviewed upstream license fixture'));
  assert.ok(!result.text.includes('Other notice'));
  await writeFile(
    join(dependency, 'package.json'),
    JSON.stringify({...manifest, version: '4.6.0'}),
  );
  await assert.rejects(
    collectRuntimeNotices(options),
    /No license text found for bundled package pmtiles@4.6.0/u,
  );
});
