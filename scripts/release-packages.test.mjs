import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {nextAlphaVersion, packageDirectories, publicPackageNames} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('release-packages.mjs', import.meta.url));
const initialVersion = '0.1.0-alpha.16';
const internalDependencies = {
  capture: {'@tileflow/core': 'workspace:*', '@tileflow/dev': 'workspace:*'},
  cli: {
    '@tileflow/capture': 'workspace:*',
    '@tileflow/core': 'workspace:*',
    '@tileflow/dev': 'workspace:*',
  },
  dev: {'@tileflow/core': 'workspace:*'},
  next: {'@tileflow/dev': 'workspace:*'},
  react: {'@tileflow/core': 'workspace:*', '@tileflow/static': 'workspace:*'},
  svelte: {'@tileflow/core': 'workspace:*'},
  vite: {'@tileflow/dev': 'workspace:*'},
  vue: {'@tileflow/core': 'workspace:*'},
  webpack: {'@tileflow/dev': 'workspace:*'},
};

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-independent-release-'));
  await mkdir(join(root, '.changeset'), {recursive: true});
  for (const [index, directory] of packageDirectories.entries()) {
    const packageRoot = join(root, 'packages', directory);
    await mkdir(packageRoot, {recursive: true});
    const manifest = {
      name: publicPackageNames[index],
      version: initialVersion,
      ...(internalDependencies[directory] ? {dependencies: internalDependencies[directory]} : {}),
    };
    await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}

async function runVersion(root) {
  await execFileAsync(process.execPath, [scriptPath, 'version'], {
    env: {...process.env, TILEFLOW_RELEASE_ROOT: root},
  });
}

async function readManifest(root, directory) {
  return JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'));
}

async function assertPackageVersions(root, expectedVersions) {
  for (const [index, directory] of packageDirectories.entries()) {
    const manifest = await readManifest(root, directory);
    assert.equal(
      manifest.version,
      expectedVersions[directory] ?? initialVersion,
      `${publicPackageNames[index]} was unexpectedly versioned.`,
    );
  }
}

test('advances numeric alpha versions without promoting them to latest', () => {
  assert.equal(nextAlphaVersion('0.1.0-alpha.16', 'patch'), '0.1.0-alpha.17');
  assert.equal(nextAlphaVersion('0.1.0-alpha.16', 'minor'), '0.2.0-alpha.0');
  assert.equal(nextAlphaVersion('0.1.0-alpha.16', 'major'), '1.0.0-alpha.0');
});

test('versions only packages explicitly named by changesets', async () => {
  const root = await createFixture();
  try {
    await writeFile(
      join(root, '.changeset', 'core-only.md'),
      '---\n"@tileflow/core": patch\n---\n\nImprove core compilation.\n',
    );

    await runVersion(root);
    await assertPackageVersions(root, {core: '0.1.0-alpha.17'});
    const plan = JSON.parse(await readFile(join(root, '.changeset', 'release-plan.json'), 'utf8'));
    assert.deepEqual(
      plan.packages.map(({name, from, to}) => ({name, from, to})),
      [
        {
          name: '@tileflow/core',
          from: '0.1.0-alpha.16',
          to: '0.1.0-alpha.17',
        },
      ],
    );
    await assert.rejects(readFile(join(root, '.changeset', 'core-only.md')));
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('versions dependents only when each dependent is explicitly selected', async () => {
  const root = await createFixture();
  try {
    await writeFile(
      join(root, '.changeset', 'core-with-explicit-dependents.md'),
      [
        '---',
        '"@tileflow/core": patch',
        '"@tileflow/dev": minor',
        '"@tileflow/capture": patch',
        '---',
        '',
        'Update core and the dependents that need new published artifacts.',
        '',
      ].join('\n'),
    );

    await runVersion(root);
    await assertPackageVersions(root, {
      capture: '0.1.0-alpha.17',
      core: '0.1.0-alpha.17',
      dev: '0.2.0-alpha.0',
    });

    const plan = JSON.parse(await readFile(join(root, '.changeset', 'release-plan.json'), 'utf8'));
    assert.deepEqual(
      plan.packages.map(({name, from, to, type}) => ({name, from, to, type})),
      [
        {
          name: '@tileflow/core',
          from: initialVersion,
          to: '0.1.0-alpha.17',
          type: 'patch',
        },
        {
          name: '@tileflow/dev',
          from: initialVersion,
          to: '0.2.0-alpha.0',
          type: 'minor',
        },
        {
          name: '@tileflow/capture',
          from: initialVersion,
          to: '0.1.0-alpha.17',
          type: 'patch',
        },
      ],
    );
    assert.equal((await readManifest(root, 'cli')).version, initialVersion);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
