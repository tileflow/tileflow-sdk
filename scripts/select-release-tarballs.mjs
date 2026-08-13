import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {assertSelectedRuntimeDependencies, validateReleasePlan} from './reconcile-release.mjs';
import {
  publicPackageNames,
  publicPackageNameSet,
  runtimeDependencySnapshot,
} from './release-config.mjs';

const execFileAsync = promisify(execFile);
const [planPath, tarballListPath, selectedPath] = process.argv.slice(2);
assert.ok(
  planPath && tarballListPath && selectedPath,
  'Expected plan, tarball list, and output path.',
);
assert.equal(process.argv.slice(2).length, 3, 'Unexpected release-tarball selector arguments.');

const plan = validateReleasePlan(JSON.parse(await readFile(planPath, 'utf8')));
assert.ok(plan.packages.length > 0, 'Release plan is empty.');
const versions = new Map(plan.baselines.map(({name, version}) => [name, version]));
for (const release of plan.packages) versions.set(release.name, release.to);
const baselines = new Map(plan.baselines.map((baseline) => [baseline.name, baseline]));

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
  assert.equal(byName.has(manifest.name), false, `Duplicate tarball for ${manifest.name}.`);
  byName.set(manifest.name, {manifest, tarball});
}
assert.deepEqual(
  [...byName.keys()].sort(),
  [...publicPackageNames].sort(),
  'Packed public package set is incomplete.',
);

const selectedNames = new Set(plan.packages.map(({name}) => name));
const releases = new Map(plan.packages.map((release) => [release.name, release]));
const selected = [];
for (const name of publicPackageNames) {
  const packed = byName.get(name);
  assert.equal(packed.manifest.version, versions.get(name), `${name} tarball version mismatch.`);
  const snapshot = runtimeDependencySnapshot(packed.manifest);
  if (selectedNames.has(name)) {
    assert.deepEqual(
      snapshot,
      releases.get(name).runtimeDependencies,
      `${name} internal dependency topology differs from its release plan.`,
    );
    assertSelectedRuntimeDependencies(name, snapshot, versions);
  } else {
    assert.deepEqual(
      snapshot,
      baselines.get(name).runtimeDependencies,
      `${name} is unselected and must preserve its published internal dependency ranges.`,
    );
  }

  if (selectedNames.has(name)) selected.push(packed.tarball);
}

await writeFile(selectedPath, `${selected.join('\n')}\n`);
console.log(`Selected ${selected.length} dependency-safe release tarball(s).`);
