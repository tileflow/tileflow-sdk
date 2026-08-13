import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {
  findPublishablePackageChanges,
  readChangesetDeclarations,
  readReleasePlanDeclarations,
  verifyReleaseIntent,
  verifyRepositoryReleaseIntent,
} from './release-packages-intent.mjs';

const execFileAsync = promisify(execFile);

test('classifies package artifacts and build config as publishable but ignores package tests', () => {
  assert.deepEqual(
    findPublishablePackageChanges([
      'packages/core/src/compiler.ts',
      'packages/core/test/compiler.test.ts',
      'packages/dev/README.md',
      'packages/react/tsup.config.ts',
      'docs/contracts/local-visual-capture.md',
    ]),
    ['@tileflow/core', '@tileflow/dev', '@tileflow/react'],
  );
  assert.deepEqual(
    findPublishablePackageChanges([
      'packages/cli/test/deploy-command.test.ts',
      'packages/capture/test/browser-setup.test.ts',
    ]),
    [],
  );
});

test('keeps a publishable source deletion visible when a file moves into tests', () => {
  assert.deepEqual(
    findPublishablePackageChanges([
      'packages/core/src/old-compiler.ts',
      'packages/core/test/old-compiler.test.ts',
    ]),
    ['@tileflow/core'],
  );
});

test('accepts multi-package changes when every package has reviewed release intent', () => {
  const declarations = readChangesetDeclarations([
    {
      path: '.changeset/core-and-react.md',
      contents:
        '---\n"@tileflow/core": patch\n"@tileflow/react": patch\n---\n\nUpdate public artifacts.\n',
    },
    {
      path: '.changeset/dev.md',
      contents: '---\n"@tileflow/dev": minor\n---\n\nUpdate development integration.\n',
    },
  ]);
  assert.deepEqual(
    verifyReleaseIntent({
      changedFiles: [
        'packages/core/src/compiler.ts',
        'packages/dev/README.md',
        'packages/react/tsup.config.ts',
      ],
      declaredPackages: declarations,
      declarationSource: 'changed .changeset/*.md files',
    }),
    ['@tileflow/core', '@tileflow/dev', '@tileflow/react'],
  );
});

test('rejects every changed package missing from the reviewed changesets', () => {
  const declarations = readChangesetDeclarations([
    {
      path: '.changeset/core.md',
      contents: '---\n"@tileflow/core": patch\n---\n\nUpdate core.\n',
    },
  ]);
  assert.throws(
    () =>
      verifyReleaseIntent({
        changedFiles: ['packages/core/src/index.ts', 'packages/dev/package.json'],
        declaredPackages: declarations,
        declarationSource: 'changed .changeset/*.md files',
      }),
    /@tileflow\/dev/u,
  );
});

test('uses the release plan as intent only for packages declared by the release PR', () => {
  const declarations = readReleasePlanDeclarations(
    JSON.stringify({schemaVersion: 1, packages: [{name: '@tileflow/dev'}]}),
  );
  assert.deepEqual(
    verifyReleaseIntent({
      changedFiles: ['packages/dev/package.json', 'packages/cli/test/deploy-command.test.ts'],
      declaredPackages: declarations,
      declarationSource: '.changeset/release-plan.json',
    }),
    ['@tileflow/dev'],
  );
  assert.throws(
    () =>
      verifyReleaseIntent({
        changedFiles: ['packages/core/README.md'],
        declaredPackages: declarations,
        declarationSource: '.changeset/release-plan.json',
      }),
    /@tileflow\/core/u,
  );
  assert.throws(
    () =>
      readReleasePlanDeclarations(
        JSON.stringify({
          schemaVersion: 1,
          packages: [{name: '@tileflow/dev'}, {name: '@tileflow/dev'}],
        }),
      ),
    /Duplicate release plan package/u,
  );
});

test('compares the complete PR and ignores unchanged changesets already on main', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-intent-'));
  try {
    await mkdir(join(root, 'packages', 'core', 'src'), {recursive: true});
    await mkdir(join(root, '.changeset'), {recursive: true});
    await writeFile(join(root, 'packages', 'core', 'src', 'index.ts'), 'export const value = 1;\n');
    await writeFile(
      join(root, '.changeset', 'stale-core.md'),
      '---\n"@tileflow/core": patch\n---\n\nAn older change already on main.\n',
    );
    await runGit(root, ['init']);
    const base = await commitFixture(root, 'base');

    await writeFile(join(root, 'packages', 'core', 'src', 'index.ts'), 'export const value = 2;\n');
    const missingIntentHead = await commitFixture(root, 'change core without release intent');
    await assert.rejects(
      verifyRepositoryReleaseIntent({
        repositoryRoot: root,
        mode: 'changesets',
        baseRevision: base,
        headRevision: missingIntentHead,
      }),
      /@tileflow\/core/u,
    );

    await writeFile(
      join(root, '.changeset', 'current-core.md'),
      '---\n"@tileflow/core": patch\n---\n\nDescribe the current core change.\n',
    );
    const declaredHead = await commitFixture(root, 'declare current core release intent');
    await verifyRepositoryReleaseIntent({
      repositoryRoot: root,
      mode: 'changesets',
      baseRevision: base,
      headRevision: declaredHead,
      requireHead: true,
    });
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects a release plan edited by a normal source pull request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-intent-plan-'));
  try {
    await mkdir(join(root, '.changeset'), {recursive: true});
    await writeFile(
      join(root, '.changeset', 'release-plan.json'),
      '{"schemaVersion":1,"packages":[],"changesets":[]}\n',
    );
    await runGit(root, ['init']);
    const base = await commitFixture(root, 'base release plan');
    await writeFile(
      join(root, '.changeset', 'release-plan.json'),
      '{"schemaVersion":1,"packages":[{"name":"@tileflow/core"}],"changesets":[]}\n',
    );
    const head = await commitFixture(root, 'manually edit release plan');

    await assert.rejects(
      verifyRepositoryReleaseIntent({
        repositoryRoot: root,
        mode: 'changesets',
        baseRevision: base,
        headRevision: head,
      }),
      /Only the official changeset-release\/main Release PR/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

async function runGit(root, args) {
  const {stdout} = await execFileAsync('git', args, {cwd: root});
  return stdout.trim();
}

async function commitFixture(root, message) {
  await runGit(root, ['add', '.']);
  await runGit(root, [
    '-c',
    'user.name=Tileflow release test',
    '-c',
    'user.email=release-test@tileflow.invalid',
    'commit',
    '-m',
    message,
  ]);
  return runGit(root, ['rev-parse', 'HEAD']);
}
