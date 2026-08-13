import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import semver from 'semver';
import {publicPackageNames, publicPackageNameSet} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const [planPath, tarballListPath, selectedPath, registryDependenciesPath] = process.argv.slice(2);
assert.ok(
  planPath && tarballListPath && selectedPath && registryDependenciesPath,
  'Expected plan, tarball list, selected-tarball output, and registry-dependency output paths.',
);
assert.equal(process.argv.slice(2).length, 4, 'Unexpected release-tarball selector arguments.');

const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.equal(plan.schemaVersion, 1, 'Unsupported release plan schema.');
assert.ok(Array.isArray(plan.packages), 'Release plan packages must be an array.');
assert.ok(plan.packages.length > 0, 'Release plan is empty.');

const selectedNames = plan.packages.map(({name}) => name);
assert.equal(new Set(selectedNames).size, selectedNames.length, 'Release packages must be unique.');
assert.deepEqual(
  selectedNames,
  publicPackageNames.filter((name) => selectedNames.includes(name)),
  'Release packages must use dependency-safe repository order.',
);

const tarballs = (await readFile(tarballListPath, 'utf8'))
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
assert.equal(
  tarballs.length,
  publicPackageNames.length,
  `Expected ${publicPackageNames.length} packed public packages.`,
);

const byName = new Map();
for (const tarball of tarballs) {
  const {stdout} = await execFileAsync('tar', ['-xOf', tarball, 'package/package.json']);
  const manifest = JSON.parse(stdout);
  assert.ok(
    publicPackageNameSet.has(manifest.name),
    `Unexpected tarball package: ${manifest.name}.`,
  );
  assert.ok(semver.valid(manifest.version), `Invalid tarball version for ${manifest.name}.`);
  assert.equal(byName.has(manifest.name), false, `Duplicate tarball for ${manifest.name}.`);
  byName.set(manifest.name, {manifest, tarball});
}
assert.deepEqual(
  [...byName.keys()].sort(),
  [...publicPackageNames].sort(),
  'Packed public package set is incomplete.',
);

const releasesByName = new Map(plan.packages.map((release) => [release.name, release]));
const selected = [];
const registryDependencies = new Map();

for (const release of plan.packages) {
  assert.ok(publicPackageNameSet.has(release.name), `Unknown release package: ${release.name}.`);
  const packed = byName.get(release.name);
  assert.ok(packed, `Missing release tarball for ${release.name}.`);
  assert.equal(packed.manifest.version, release.to, `${release.name} tarball version mismatch.`);
  selected.push(packed.tarball);

  for (const dependencyGroup of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [dependency, range] of Object.entries(packed.manifest[dependencyGroup] ?? {})) {
      if (!publicPackageNameSet.has(dependency)) continue;

      assert.ok(
        semver.valid(range),
        `${release.name} must pack ${dependency} as one exact version, found ${range}.`,
      );
      const dependencyRelease = releasesByName.get(dependency);
      if (dependencyRelease) {
        assert.equal(
          range,
          dependencyRelease.to,
          `${release.name} must depend on the ${dependency} version in this release batch.`,
        );
        continue;
      }

      const packedDependency = byName.get(dependency);
      assert.ok(packedDependency, `Missing packed internal dependency ${dependency}.`);
      assert.equal(
        range,
        packedDependency.manifest.version,
        `${release.name} internal dependency ${dependency} does not match the workspace tarball.`,
      );
      registryDependencies.set(`${dependency}\0${range}`, {name: dependency, version: range});
    }
  }
}

const registryDependencyLines = [...registryDependencies.values()]
  .sort(
    (left, right) =>
      publicPackageNames.indexOf(left.name) - publicPackageNames.indexOf(right.name) ||
      left.version.localeCompare(right.version),
  )
  .map(({name, version}) => `${name}\t${version}`);

await Promise.all([
  writeFile(selectedPath, `${selected.join('\n')}\n`),
  writeFile(
    registryDependenciesPath,
    registryDependencyLines.length === 0 ? '' : `${registryDependencyLines.join('\n')}\n`,
  ),
]);
console.log(
  `Selected ${selected.length} release tarball(s); ${registryDependencyLines.length} internal dependency version(s) must already exist on npm.`,
);
