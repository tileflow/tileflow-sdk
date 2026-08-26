import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  packageDirectories,
  packageLegalFileNames,
  publicLicenseIdentifier,
} from './release-config.mjs';
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function synchronizePackageLegalFiles({root = repositoryRoot, write = false} = {}) {
  const canonicalFiles = new Map(
    await Promise.all(
      packageLegalFileNames.map(async (name) => [name, await readFile(join(root, name), 'utf8')]),
    ),
  );

  for (const directory of packageDirectories) {
    const packageRoot = join(root, 'packages', directory);
    const manifestPath = join(packageRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(
      manifest.license,
      publicLicenseIdentifier,
      `${manifest.name} must declare ${publicLicenseIdentifier}.`,
    );
    assert.ok(Array.isArray(manifest.files), `${manifest.name} must declare packaged files.`);

    for (const name of packageLegalFileNames) {
      assert.ok(manifest.files.includes(name), `${manifest.name} must pack ${name}.`);
      const packagePath = join(packageRoot, name);
      const canonical = canonicalFiles.get(name);
      if (write) await writeFile(packagePath, canonical);
      else
        assert.equal(
          await readFile(packagePath, 'utf8'),
          canonical,
          `${manifest.name} ${name} differs from the repository copy. Run pnpm legal:sync.`,
        );
    }
  }

  return {files: packageLegalFileNames, packages: packageDirectories};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  assert.ok(mode === '--check' || mode === '--write', 'Expected --check or --write.');
  const result = await synchronizePackageLegalFiles({write: mode === '--write'});
  console.log(
    `${mode === '--write' ? 'Synchronized' : 'Validated'} ${result.files.length} legal files across ${result.packages.length} public packages.`,
  );
}
