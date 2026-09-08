import assert from 'node:assert/strict';
import {copyFile, mkdir, readFile, readdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const licenseFileName = 'LICENSE';
const publicLicenseIdentifier = 'Apache-2.0';

export async function preparePackageLicense({root = repositoryRoot, packageRoot} = {}) {
  assert.ok(packageRoot, 'A package root is required.');
  await copyFile(join(root, licenseFileName), join(packageRoot, licenseFileName));
}

export async function removePackageLicense({packageRoot} = {}) {
  assert.ok(packageRoot, 'A package root is required.');
  await rm(join(packageRoot, licenseFileName), {force: true});
}

export async function stagePackageLicenseInputs({root = repositoryRoot, stagingRoot} = {}) {
  assert.ok(stagingRoot, 'A staging root is required.');
  await mkdir(join(stagingRoot, 'scripts'), {recursive: true});
  await Promise.all([
    copyFile(join(root, licenseFileName), join(stagingRoot, licenseFileName)),
    copyFile(
      join(root, 'scripts', 'package-license.mjs'),
      join(stagingRoot, 'scripts', 'package-license.mjs'),
    ),
  ]);
}

export async function verifyPackageLicenseLayout({root = repositoryRoot} = {}) {
  const license = await readFile(join(root, licenseFileName), 'utf8');
  assert.match(license, /Apache License\n\s+Version 2\.0, January 2004/u);

  const packageDirectories = [];
  for (const entry of await readdir(join(root, 'packages'), {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(join(root, 'packages', entry.name, 'package.json'), 'utf8'),
    );
    if (manifest.private !== true) packageDirectories.push(entry.name);
  }

  for (const directory of packageDirectories.sort()) {
    const packageRoot = join(root, 'packages', directory);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

    assert.equal(
      manifest.license,
      publicLicenseIdentifier,
      `${manifest.name} must declare ${publicLicenseIdentifier}.`,
    );
    assert.ok(Array.isArray(manifest.files), `${manifest.name} must declare packaged files.`);
    assert.ok(
      manifest.files.includes(licenseFileName),
      `${manifest.name} must pack ${licenseFileName}.`,
    );
    assert.equal(
      manifest.scripts?.prepack,
      'node ../../scripts/package-license.mjs --prepare',
      `${manifest.name} must prepare ${licenseFileName} before packing.`,
    );
    assert.equal(
      manifest.scripts?.postpack,
      'node ../../scripts/package-license.mjs --clean',
      `${manifest.name} must remove the prepared ${licenseFileName} after packing.`,
    );

    await assert.rejects(
      readFile(join(packageRoot, licenseFileName), 'utf8'),
      {code: 'ENOENT'},
      `${manifest.name} must not version a package ${licenseFileName}.`,
    );
  }

  return {licenseFileName, packages: packageDirectories};
}

async function main() {
  const mode = process.argv[2];
  if (mode === '--check') {
    const result = await verifyPackageLicenseLayout();
    console.log(
      `Validated ${result.licenseFileName} packaging for ${result.packages.length} public packages.`,
    );
    return;
  }

  const packageRoot = process.cwd();
  if (mode === '--prepare') {
    await preparePackageLicense({packageRoot});
    return;
  }
  if (mode === '--clean') {
    await removePackageLicense({packageRoot});
    return;
  }
  assert.fail('Expected --check, --prepare, or --clean.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
