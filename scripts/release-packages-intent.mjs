import {parseChangesetFile} from '@changesets/parse';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {packageDirectories, publicPackageNames, publicPackageNameSet} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const packageNameByDirectory = new Map(
  packageDirectories.map((directory, index) => [directory, publicPackageNames[index]]),
);
const commitPattern = /^[0-9a-f]{40}$/u;
const changesetPathPattern = /^\.changeset\/[^/]+\.md$/u;

export function findPublishablePackageChanges(changedFiles) {
  const selected = new Set();

  for (const path of changedFiles) {
    const segments = path.split('/');
    if (segments[0] !== 'packages' || segments.length < 3) continue;
    if (segments[2] === 'test' && segments.length > 3) continue;

    const packageName = packageNameByDirectory.get(segments[1]);
    assert.ok(packageName, `Unknown public package directory changed: packages/${segments[1]}.`);
    selected.add(packageName);
  }

  return publicPackageNames.filter((name) => selected.has(name));
}

export function readChangesetDeclarations(changesetFiles) {
  const declared = new Set();

  for (const {path, contents} of changesetFiles) {
    const changeset = parseChangesetFile(contents);
    for (const release of changeset.releases) {
      assert.ok(
        publicPackageNameSet.has(release.name),
        `${path} names an unknown public package: ${release.name}.`,
      );
      declared.add(release.name);
    }
  }

  return declared;
}

export function readReleasePlanDeclarations(contents) {
  const plan = JSON.parse(contents);
  assert.equal(plan.schemaVersion, 1, 'Unsupported release plan schema.');
  assert.ok(Array.isArray(plan.packages), 'Release plan packages must be an array.');

  const declared = new Set();
  for (const release of plan.packages) {
    assert.equal(typeof release?.name, 'string', 'Release plan package names must be strings.');
    assert.ok(
      publicPackageNameSet.has(release.name),
      `Release plan names an unknown public package: ${release.name}.`,
    );
    assert.equal(
      declared.has(release.name),
      false,
      `Duplicate release plan package: ${release.name}.`,
    );
    declared.add(release.name);
  }
  return declared;
}

export function verifyReleaseIntent({changedFiles, declaredPackages, declarationSource}) {
  const changedPackages = findPublishablePackageChanges(changedFiles);
  const missing = changedPackages.filter((name) => !declaredPackages.has(name));
  assert.deepEqual(
    missing,
    [],
    `Publishable package changes lack release intent in ${declarationSource}: ${missing.join(', ')}.`,
  );
  return changedPackages;
}

async function resolveCommit(repositoryRoot, revision) {
  assert.match(
    revision ?? '',
    commitPattern,
    `Expected a full lowercase Git commit SHA: ${revision}.`,
  );
  const {stdout} = await execFileAsync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
    cwd: repositoryRoot,
  });
  return stdout.trim();
}

async function readChangedFiles(repositoryRoot, base, head) {
  const {stdout} = await execFileAsync(
    'git',
    [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      '--diff-filter=ACDMRTUXB',
      `${base}...${head}`,
      '--',
    ],
    {cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024},
  );
  return stdout.split('\0').filter(Boolean);
}

async function readChangedChangesets(repositoryRoot, changedFiles) {
  const files = [];
  for (const path of changedFiles.filter(
    (path) => changesetPathPattern.test(path) && path !== '.changeset/README.md',
  )) {
    try {
      files.push({path, contents: await readFile(join(repositoryRoot, path), 'utf8')});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

export async function verifyRepositoryReleaseIntent({
  repositoryRoot,
  mode,
  baseRevision,
  headRevision,
  requireHead = false,
}) {
  assert.ok(['changesets', 'release-plan'].includes(mode), `Unknown release intent mode: ${mode}.`);
  const base = await resolveCommit(repositoryRoot, baseRevision);
  const head = await resolveCommit(repositoryRoot, headRevision);

  if (requireHead) {
    const {stdout} = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: repositoryRoot,
    });
    const checkoutHead = stdout.trim();
    assert.equal(
      checkoutHead,
      head,
      `Dispatched release head ${head} does not match checkout HEAD ${checkoutHead}.`,
    );
  }

  const changedFiles = await readChangedFiles(repositoryRoot, base, head);
  let declaredPackages;
  let declarationSource;

  if (mode === 'changesets') {
    assert.equal(
      changedFiles.includes('.changeset/release-plan.json'),
      false,
      'Only the official changeset-release/main Release PR may change .changeset/release-plan.json.',
    );
    const changesetFiles = await readChangedChangesets(repositoryRoot, changedFiles);
    declaredPackages = readChangesetDeclarations(changesetFiles);
    declarationSource = 'changed .changeset/*.md files';
  } else {
    const releasePlanPath = '.changeset/release-plan.json';
    assert.ok(
      changedFiles.includes(releasePlanPath),
      `${releasePlanPath} must change in the release PR.`,
    );
    declaredPackages = readReleasePlanDeclarations(
      await readFile(join(repositoryRoot, releasePlanPath), 'utf8'),
    );
    declarationSource = releasePlanPath;
  }

  const changedPackages = verifyReleaseIntent({
    changedFiles,
    declaredPackages,
    declarationSource,
  });
  console.log(
    changedPackages.length === 0
      ? 'No publishable package changes require release intent.'
      : `Verified release intent for ${changedPackages.join(', ')}.`,
  );
}

async function main() {
  const [mode, baseRevision, headRevision, ...options] = process.argv.slice(2);
  assert.ok(baseRevision && headRevision, 'Expected mode, base SHA, and head SHA.');
  assert.deepEqual(
    options.filter((option) => option !== '--require-head'),
    [],
    'Unknown option.',
  );
  await verifyRepositoryReleaseIntent({
    repositoryRoot: process.cwd(),
    mode,
    baseRevision,
    headRevision,
    requireHead: options.includes('--require-head'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
