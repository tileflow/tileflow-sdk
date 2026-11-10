import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {packageLegalFileNames as releaseLegalFileNames} from './release-config.mjs';
import {
  packageLegalFileNames,
  preparePackageLicense,
  removePackageLicense,
  stagePackageLicenseInputs,
} from './package-license.mjs';

test('prepares and removes the source license and notice for a package tarball', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-package-license-test-'));
  const packageRoot = join(root, 'packages', 'core');
  const license = 'Apache License\n';
  const notice = 'Copyright 2026 Tileflow\n';

  try {
    await mkdir(packageRoot, {recursive: true});
    await writeFile(join(root, 'LICENSE'), license);
    await writeFile(join(root, 'NOTICE'), notice);
    await preparePackageLicense({root, packageRoot});
    assert.equal(await readFile(join(packageRoot, 'LICENSE'), 'utf8'), license);
    assert.equal(await readFile(join(packageRoot, 'NOTICE'), 'utf8'), notice);

    await removePackageLicense({packageRoot});
    for (const name of ['LICENSE', 'NOTICE'])
      await assert.rejects(readFile(join(packageRoot, name), 'utf8'), {code: 'ENOENT'});
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('stages license lifecycle inputs beside copied package trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-package-license-stage-test-'));
  const sourceRoot = join(root, 'source');
  const stagingRoot = join(root, 'staging');
  const license = 'Apache License\n';
  const notice = 'Copyright 2026 Tileflow\n';
  const helper = 'export {};\n';

  try {
    await mkdir(join(sourceRoot, 'scripts'), {recursive: true});
    await writeFile(join(sourceRoot, 'LICENSE'), license);
    await writeFile(join(sourceRoot, 'NOTICE'), notice);
    await writeFile(join(sourceRoot, 'scripts', 'package-license.mjs'), helper);

    await stagePackageLicenseInputs({root: sourceRoot, stagingRoot});

    assert.equal(await readFile(join(stagingRoot, 'LICENSE'), 'utf8'), license);
    assert.equal(await readFile(join(stagingRoot, 'NOTICE'), 'utf8'), notice);
    assert.equal(
      await readFile(join(stagingRoot, 'scripts', 'package-license.mjs'), 'utf8'),
      helper,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('release validation requires the same legal files the pack hook prepares', () => {
  assert.deepEqual(releaseLegalFileNames, [...packageLegalFileNames]);
});
