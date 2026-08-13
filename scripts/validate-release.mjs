import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import semver from 'semver';
import {
  nextAlphaVersion,
  publicPackageNames,
  publicPackageNameSet,
  readPublicManifests,
} from './release-packages.mjs';

const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);
const expectedRepository = 'git+https://github.com/tileflow/tileflow-sdk.git';
const expectedBugs = 'https://github.com/tileflow/tileflow-sdk/issues';
const args = process.argv.slice(2);
const requirePackages = args.includes('--require-packages');
const positionalArgs = args.filter((argument) => argument !== '--require-packages');

assert.equal(
  positionalArgs.length,
  1,
  'Expected one release-YYYYMMDD.N batch tag and optional --require-packages.',
);
const [tag] = positionalArgs;
const tagMatch = /^release-(\d{4})(\d{2})(\d{2})\.([1-9]\d*)$/u.exec(tag);
assert.ok(tagMatch, 'Expected a release-YYYYMMDD.N batch tag.');
const [, yearText, monthText, dayText] = tagMatch;
const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
assert.equal(
  `${date.getUTCFullYear()}`.padStart(4, '0') +
    `${date.getUTCMonth() + 1}`.padStart(2, '0') +
    `${date.getUTCDate()}`.padStart(2, '0'),
  `${yearText}${monthText}${dayText}`,
  `Release tag ${tag} contains an invalid calendar date.`,
);

const manifests = await readPublicManifests();
const releasePlan = JSON.parse(
  await readFile(join(repositoryRoot, '.changeset', 'release-plan.json'), 'utf8'),
);

assert.equal(releasePlan.schemaVersion, 1, 'Unsupported release plan schema.');
assert.ok(Array.isArray(releasePlan.packages), 'Release plan packages must be an array.');
assert.ok(Array.isArray(releasePlan.changesets), 'Release plan changesets must be an array.');
assert.ok(releasePlan.packages.length <= publicPackageNames.length, 'Too many release packages.');
if (requirePackages) assert.ok(releasePlan.packages.length > 0, 'Release plan is empty.');
if (releasePlan.packages.length > 0) {
  assert.ok(releasePlan.changesets.length > 0, 'A release plan must retain its changeset names.');
}
assert.equal(
  new Set(releasePlan.changesets).size,
  releasePlan.changesets.length,
  'Release plan changesets must be unique.',
);
for (const changeset of releasePlan.changesets) {
  assert.match(changeset, /^[^/]+\.md$/u, `Invalid release plan changeset: ${changeset}.`);
}

const selectedNames = releasePlan.packages.map(({name}) => name);
assert.equal(
  new Set(selectedNames).size,
  selectedNames.length,
  'Release plan packages must be unique.',
);
assert.deepEqual(
  selectedNames,
  publicPackageNames.filter((name) => selectedNames.includes(name)),
  'Release plan packages must use dependency-safe repository order.',
);

for (const release of releasePlan.packages) {
  assert.ok(publicPackageNameSet.has(release.name), `Unknown release package: ${release.name}.`);
  assert.ok(
    ['patch', 'minor', 'major'].includes(release.type),
    `Invalid type for ${release.name}.`,
  );
  assert.ok(semver.valid(release.from), `Invalid previous version for ${release.name}.`);
  assert.ok(semver.valid(release.to), `Invalid release version for ${release.name}.`);
  assert.match(
    release.to,
    /^\d+\.\d+\.\d+-alpha\.\d+$/u,
    `${release.name} must remain a numeric alpha release.`,
  );
  assert.equal(
    release.to,
    nextAlphaVersion(release.from, release.type),
    `${release.name} must use the next independent alpha version.`,
  );
  assert.equal(
    manifests.get(release.name).manifest.version,
    release.to,
    `${release.name} manifest does not match the release plan.`,
  );
  assert.ok(
    Array.isArray(release.summaries) &&
      release.summaries.length > 0 &&
      release.summaries.every((summary) => typeof summary === 'string' && summary.trim()),
    `${release.name} must include a non-empty release summary.`,
  );
}

for (const [name, {manifest}] of manifests) {
  assert.equal(manifest.private, undefined, `${name} must remain publishable.`);
  assert.equal(manifest.publishConfig?.access, 'public', `${name} must publish publicly.`);
  assert.equal(
    manifest.publishConfig?.registry,
    undefined,
    `${name} must use the workflow registry.`,
  );
  assert.equal(manifest.repository?.url, expectedRepository, `${name} repository mismatch.`);
  assert.equal(manifest.bugs?.url, expectedBugs, `${name} issue tracker mismatch.`);

  for (const dependencyGroup of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [dependency, range] of Object.entries(manifest[dependencyGroup] ?? {})) {
      if (publicPackageNameSet.has(dependency)) {
        assert.equal(range, 'workspace:*', `${name} must use workspace:* for ${dependency}.`);
      }
    }
  }
}

console.log(
  `Validated ${tag} for ${releasePlan.packages.length} independent package(s): ${selectedNames.join(', ')}.`,
);
