import {parseChangesetFile} from '@changesets/parse';
import assert from 'node:assert/strict';
import {readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import semver from 'semver';

export const packageDirectories = [
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
export const publicPackageNames = packageDirectories.map((directory) => `@tileflow/${directory}`);
export const publicPackageNameSet = new Set(publicPackageNames);

const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);
const changesetDirectory = join(repositoryRoot, '.changeset');
const releasePlanPath = join(repositoryRoot, '.changeset', 'release-plan.json');
const supportedReleaseTypes = new Set(['patch', 'minor', 'major']);
const releaseTypeRank = {patch: 1, minor: 2, major: 3};

export async function readPublicManifests() {
  return new Map(
    await Promise.all(
      packageDirectories.map(async (directory) => {
        const path = join(repositoryRoot, 'packages', directory, 'package.json');
        const manifest = JSON.parse(await readFile(path, 'utf8'));
        assert.equal(manifest.name, `@tileflow/${directory}`);
        return [manifest.name, {directory, manifest, path}];
      }),
    ),
  );
}

export async function readPendingChangesets() {
  const files = (await readdir(changesetDirectory))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      ...parseChangesetFile(await readFile(join(changesetDirectory, file), 'utf8')),
    })),
  );
}

export function createReleasePlan(manifests, changesets) {
  const selected = new Map();

  for (const changeset of changesets) {
    assert.ok(
      changeset.releases.length > 0,
      `${changeset.file} must name a package or be removed.`,
    );
    for (const release of changeset.releases) {
      assert.ok(
        publicPackageNameSet.has(release.name),
        `${changeset.file} names an unknown package: ${release.name}.`,
      );
      assert.ok(
        supportedReleaseTypes.has(release.type),
        `${changeset.file} has an unsupported release type: ${release.type}.`,
      );
      const current = selected.get(release.name);
      if (!current) {
        selected.set(release.name, {type: release.type, summaries: [changeset.summary]});
      } else {
        if (releaseTypeRank[release.type] > releaseTypeRank[current.type]) {
          current.type = release.type;
        }
        current.summaries.push(changeset.summary);
      }
    }
  }

  return {
    schemaVersion: 1,
    packages: publicPackageNames
      .filter((name) => selected.has(name))
      .map((name) => {
        const {manifest} = manifests.get(name);
        const selectedRelease = selected.get(name);
        return {
          name,
          from: manifest.version,
          to: nextAlphaVersion(manifest.version, selectedRelease.type),
          type: selectedRelease.type,
          summaries: selectedRelease.summaries,
        };
      }),
    changesets: changesets.map(({file}) => file),
  };
}

export function nextAlphaVersion(currentVersion, releaseType) {
  const parsed = semver.parse(currentVersion);
  assert.ok(parsed, `Invalid package version: ${currentVersion}.`);
  assert.match(currentVersion, /^\d+\.\d+\.\d+-alpha\.\d+$/u, 'Expected a numeric alpha version.');
  assert.ok(supportedReleaseTypes.has(releaseType), `Unsupported release type: ${releaseType}.`);

  if (releaseType === 'patch') {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-alpha.${parsed.prerelease[1] + 1}`;
  }

  const stableBase = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const targetBase = semver.inc(stableBase, releaseType);
  assert.ok(targetBase);
  return `${targetBase}-alpha.0`;
}

export function createUpdatedChangelog(previous, release) {
  const heading = `## ${release.to}`;
  assert.equal(
    previous.includes(heading),
    false,
    `${release.name} changelog already contains ${release.to}.`,
  );
  const lines = release.summaries.map((summary) => `- ${summary.trim()}`).join('\n');
  const firstBreak = previous.indexOf('\n');
  assert.ok(firstBreak >= 0, `${release.name} changelog must begin with a heading line.`);
  return `${previous.slice(0, firstBreak + 1)}\n${heading}\n\n${lines}\n${previous.slice(firstBreak + 1)}`;
}

export async function buildReleasePlan() {
  const manifests = await readPublicManifests();
  const changesets = await readPendingChangesets();
  return createReleasePlan(manifests, changesets);
}

export async function applyReleasePlan(plan) {
  assert.ok(plan.packages.length > 0, 'No publishable changesets are pending.');
  const manifests = await readPublicManifests();

  for (const release of plan.packages) {
    const entry = manifests.get(release.name);
    assert.ok(entry, `Unknown release package: ${release.name}.`);
    assert.equal(
      entry.manifest.version,
      release.from,
      `${release.name} changed during versioning.`,
    );
    entry.manifest.version = release.to;
    await writeFile(entry.path, `${JSON.stringify(entry.manifest, null, 2)}\n`);

    const changelogPath = join(repositoryRoot, 'packages', entry.directory, 'CHANGELOG.md');
    let previous = '';
    try {
      previous = await readFile(changelogPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      previous = `# ${release.name}\n`;
    }
    await writeFile(changelogPath, createUpdatedChangelog(previous, release));
  }

  for (const file of plan.changesets) {
    await rm(join(changesetDirectory, file));
  }
  await writeFile(releasePlanPath, `${JSON.stringify(plan, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2] ?? 'plan';
  const plan = await buildReleasePlan();
  if (command === 'plan') {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  assert.equal(command, 'version', `Unknown command: ${command}.`);
  await applyReleasePlan(plan);
  console.log(`Versioned ${plan.packages.length} package(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
