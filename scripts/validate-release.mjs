import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const packageDirectories = [
  'core',
  'static',
  'dev',
  'capture',
  'vite',
  'next',
  'webpack',
  'react',
  'vue',
  'svelte',
  'cli',
];
const expectedRepository = 'git+https://github.com/tileflow/tileflow-sdk.git';
const expectedBugs = 'https://github.com/tileflow/tileflow-sdk/issues';
const tag = process.argv[2];

assert.match(
  tag ?? '',
  /^v\d+\.\d+\.\d+(?:-alpha\.\d+)?$/u,
  'Expected a stable or numeric alpha v-prefixed release tag.',
);

const actualDirectories = (await readdir(join(repositoryRoot, 'packages'), {withFileTypes: true}))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(
  actualDirectories,
  [...packageDirectories].sort(),
  'Unexpected package directory set.',
);

const manifests = await Promise.all(
  packageDirectories.map(async (directory) => {
    const path = join(repositoryRoot, 'packages', directory, 'package.json');
    return {directory, manifest: JSON.parse(await readFile(path, 'utf8'))};
  }),
);
const versions = new Set(manifests.map(({manifest}) => manifest.version));
assert.equal(versions.size, 1, 'All public packages must use one coordinated version.');
const [version] = versions;
assert.equal(tag, `v${version}`, `Release tag ${tag} does not match package version ${version}.`);

const packageNames = new Set(manifests.map(({manifest}) => manifest.name));
assert.equal(packageNames.size, packageDirectories.length, 'Public package names must be unique.');
for (const {directory, manifest} of manifests) {
  assert.equal(
    manifest.name,
    `@tileflow/${directory}`,
    `Unexpected name for packages/${directory}.`,
  );
  assert.equal(manifest.private, undefined, `${manifest.name} must remain publishable.`);
  assert.equal(manifest.publishConfig?.access, 'public', `${manifest.name} must publish publicly.`);
  assert.equal(
    manifest.publishConfig?.registry,
    undefined,
    `${manifest.name} must use the workflow registry.`,
  );
  assert.equal(
    manifest.repository?.url,
    expectedRepository,
    `${manifest.name} repository mismatch.`,
  );
  assert.equal(manifest.bugs?.url, expectedBugs, `${manifest.name} issue tracker mismatch.`);

  for (const dependencyGroup of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [dependency, range] of Object.entries(manifest[dependencyGroup] ?? {})) {
      if (packageNames.has(dependency)) {
        assert.equal(
          range,
          'workspace:*',
          `${manifest.name} must use workspace:* for ${dependency}.`,
        );
      }
    }
  }
}

console.log(`Validated ${manifests.length} packages for ${tag}.`);
