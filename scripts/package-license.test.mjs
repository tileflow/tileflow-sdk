import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  preparePackageLicense,
  removePackageLicense,
  stagePackageLicenseInputs,
} from './package-license.mjs';

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

test('stages license lifecycle inputs beside copied package trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-package-license-stage-test-'));
  const sourceRoot = join(root, 'source');
  const stagingRoot = join(root, 'staging');
  const license = 'Apache License\n';
  const helper = 'export {};\n';

  try {
    await mkdir(join(sourceRoot, 'scripts'), {recursive: true});
    await writeFile(join(sourceRoot, 'LICENSE'), license);
    await writeFile(join(sourceRoot, 'scripts', 'package-license.mjs'), helper);

    await stagePackageLicenseInputs({root: sourceRoot, stagingRoot});

    assert.equal(await readFile(join(stagingRoot, 'LICENSE'), 'utf8'), license);
    assert.equal(
      await readFile(join(stagingRoot, 'scripts', 'package-license.mjs'), 'utf8'),
      helper,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
