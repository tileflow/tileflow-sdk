import {parseChangesetFile} from '@changesets/parse';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import semver from 'semver';
import {
  createReleasePlan,
  createUpdatedChangelog,
  nextAlphaVersion,
  packageDirectories,
  publicPackageNames,
  publicPackageNameSet,
  readPublicManifests,
} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/u;
const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);
const expectedRepository = 'git+https://github.com/tileflow/tileflow-sdk.git';
const expectedBugs = 'https://github.com/tileflow/tileflow-sdk/issues';
const args = process.argv.slice(2);
const options = parseArguments(args);

const manifests = await readPublicManifests();
const releasePlan = JSON.parse(
  await readFile(join(repositoryRoot, '.changeset', 'release-plan.json'), 'utf8'),
);

assert.equal(releasePlan.schemaVersion, 1, 'Unsupported release plan schema.');
assert.ok(Array.isArray(releasePlan.packages), 'Release plan packages must be an array.');
assert.ok(Array.isArray(releasePlan.changesets), 'Release plan changesets must be an array.');
assert.ok(releasePlan.packages.length <= publicPackageNames.length, 'Too many release packages.');
if (options.requirePackages) assert.ok(releasePlan.packages.length > 0, 'Release plan is empty.');
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

if (options.baseRevision && options.headRevision) {
  await validateReleaseHistory({
    baseRevision: options.baseRevision,
    headRevision: options.headRevision,
    manifests,
    releasePlan,
  });
}

console.log(
  `Validated release plan for ${releasePlan.packages.length} independent package(s): ${selectedNames.join(', ')}.`,
);

function parseArguments(input) {
  const parsed = {baseRevision: null, headRevision: null, requirePackages: false};
  for (let index = 0; index < input.length; index += 1) {
    const argument = input[index];
    if (argument === '--require-packages') {
      assert.equal(parsed.requirePackages, false, 'Duplicate --require-packages option.');
      parsed.requirePackages = true;
      continue;
    }
    if (argument === '--base' || argument === '--head') {
      const value = input[index + 1];
      assert.match(value ?? '', commitPattern, `${argument} requires a full lowercase commit SHA.`);
      const key = argument === '--base' ? 'baseRevision' : 'headRevision';
      assert.equal(parsed[key], null, `Duplicate ${argument} option.`);
      parsed[key] = value;
      index += 1;
      continue;
    }
    assert.fail(`Unknown release validation argument: ${argument}.`);
  }
  assert.equal(
    Boolean(parsed.baseRevision),
    Boolean(parsed.headRevision),
    '--base and --head must be provided together.',
  );
  return parsed;
}

async function validateReleaseHistory({baseRevision, headRevision, manifests, releasePlan}) {
  const base = await resolveCommit(baseRevision);
  const head = await resolveCommit(headRevision);
  assert.equal(base, baseRevision, 'The release base SHA did not resolve exactly.');
  assert.equal(head, headRevision, 'The release head SHA did not resolve exactly.');
  assert.equal(await resolveCommit('HEAD'), head, 'The release head must match the checkout HEAD.');
  await execGit(['merge-base', '--is-ancestor', base, head]);

  const {stdout: changedPlan} = await execGit([
    'diff',
    '--name-only',
    base,
    head,
    '--',
    '.changeset/release-plan.json',
  ]);
  assert.equal(
    changedPlan.trim(),
    '.changeset/release-plan.json',
    'The official Release PR must change .changeset/release-plan.json.',
  );

  const baseManifests = await readPublicManifestsAtRevision(base);
  const baseChangesets = await readChangesetsAtRevision(base);
  assert.deepEqual(
    releasePlan,
    createReleasePlan(baseManifests, baseChangesets),
    'The release plan does not exactly match the reviewed changesets and base versions.',
  );

  const selected = new Set(releasePlan.packages.map(({name}) => name));
  const releasesByName = new Map(releasePlan.packages.map((release) => [release.name, release]));
  for (const [name, {manifest}] of manifests) {
    const baseManifest = baseManifests.get(name).manifest;
    const baseVersion = baseManifest.version;
    if (!selected.has(name)) {
      assert.equal(
        manifest.version,
        baseVersion,
        `${name} changed version without being selected in the release plan.`,
      );
      assert.deepEqual(
        manifest,
        baseManifest,
        `${name} manifest changed without being selected in the release plan.`,
      );
      continue;
    }

    const release = releasesByName.get(name);
    assert.deepEqual(
      manifest,
      {...baseManifest, version: release.to},
      `${name} manifest contains changes outside deterministic release versioning.`,
    );
  }

  const currentChangesets = await listChangesetFilesAtRevision(head);
  assert.deepEqual(
    currentChangesets,
    [],
    `The Release PR must consume every pending changeset and add none; found ${currentChangesets.join(', ')}.`,
  );

  const expectedPaths = new Set([
    '.changeset/release-plan.json',
    ...releasePlan.changesets.map((file) => `.changeset/${file}`),
  ]);
  for (const release of releasePlan.packages) {
    const directory = baseManifests.get(release.name).directory;
    const changelogPath = `packages/${directory}/CHANGELOG.md`;
    expectedPaths.add(`packages/${directory}/package.json`);
    expectedPaths.add(changelogPath);

    const baseChangelog = await readFileAtRevision(base, changelogPath, `# ${release.name}\n`);
    const headChangelog = await readFileAtRevision(head, changelogPath);
    assert.equal(
      headChangelog,
      createUpdatedChangelog(baseChangelog, release),
      `${release.name} changelog does not match deterministic release versioning.`,
    );
  }

  const {stdout: changedOutput} = await execGit(['diff', '--name-only', base, head]);
  const changedPaths = changedOutput.split('\n').filter(Boolean).sort();
  assert.deepEqual(
    changedPaths,
    [...expectedPaths].sort(),
    'The Release PR may contain only deterministic version, changelog, plan, and changeset outputs.',
  );
}

async function readPublicManifestsAtRevision(revision) {
  return new Map(
    await Promise.all(
      packageDirectories.map(async (directory, index) => {
        const name = publicPackageNames[index];
        const {stdout} = await execGit(['show', `${revision}:packages/${directory}/package.json`]);
        const manifest = JSON.parse(stdout);
        assert.equal(manifest.name, name, `${name} base manifest name mismatch.`);
        return [name, {directory, manifest}];
      }),
    ),
  );
}

async function readChangesetsAtRevision(revision) {
  const files = await listChangesetFilesAtRevision(revision);
  return Promise.all(
    files.map(async (file) => {
      const {stdout} = await execGit(['show', `${revision}:.changeset/${file}`]);
      return {file, ...parseChangesetFile(stdout)};
    }),
  );
}

async function listChangesetFilesAtRevision(revision) {
  const {stdout} = await execGit(['ls-tree', '-r', '--name-only', revision, '--', '.changeset']);
  return stdout
    .split('\n')
    .filter((path) => /^\.changeset\/[^/]+\.md$/u.test(path) && path !== '.changeset/README.md')
    .map((path) => path.slice('.changeset/'.length))
    .sort();
}

async function resolveCommit(revision) {
  const {stdout} = await execGit(['rev-parse', '--verify', `${revision}^{commit}`]);
  return stdout.trim();
}

async function readFileAtRevision(revision, path, missingValue) {
  try {
    const {stdout} = await execGit(['show', `${revision}:${path}`]);
    return stdout;
  } catch (error) {
    if (missingValue === undefined) throw error;
    return missingValue;
  }
}

function execGit(arguments_) {
  return execFileAsync('git', arguments_, {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
}
