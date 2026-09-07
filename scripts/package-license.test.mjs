import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {preparePackageLicense, removePackageLicense} from './package-license.mjs';

test('prepares and removes the single source license for a package tarball', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-package-license-test-'));
  const packageRoot = join(root, 'packages', 'core');
  const license = 'Apache License\n';

  try {
    await mkdir(packageRoot, {recursive: true});
    await writeFile(join(root, 'LICENSE'), license);
    await preparePackageLicense({root, packageRoot});
    assert.equal(await readFile(join(packageRoot, 'LICENSE'), 'utf8'), license);

    await removePackageLicense({packageRoot});
    await assert.rejects(readFile(join(packageRoot, 'LICENSE'), 'utf8'), {code: 'ENOENT'});
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
