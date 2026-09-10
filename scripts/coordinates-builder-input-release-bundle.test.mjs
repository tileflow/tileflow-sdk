import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('retains a Coordinates builder input only for the selected runtime tarball', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const start = workflow.indexOf('Produce verified Coordinates builder input');
  const end = workflow.indexOf('Recheck current main before handing off publication');
  const step = workflow.slice(start, end);

  assert.ok(start >= 0 && end > start, 'Coordinates builder-input workflow step is missing.');
  assert.match(step, /SELECTED_TARBALLS=.*selected-tarballs\.txt/u);
  assert.doesNotMatch(step, /FINAL_TARBALLS/u);
  assert.match(step, /coordinates-builder-input-receipt\.json/u);
  assert.match(step, /manifest\.adapter\?\.sourceRevision !== process\.env\.RELEASE_SHA/u);
  assert.match(step, /sourceDigest: manifest\.adapter\.sourceDigest/u);
  assert.match(step, /archiveSha256: manifest\.runtimePackage\.archive\.sha256/u);
  assert.match(
    workflow,
    /bundle_entries\+=\(coordinates-builder-input coordinates-builder-input-receipt\.json\)/u,
  );
});
