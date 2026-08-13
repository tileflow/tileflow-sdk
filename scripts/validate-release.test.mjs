import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  createUpdatedChangelog,
  packageDirectories,
  publicPackageNames,
} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('validate-release.mjs', import.meta.url));

test('accepts a non-empty independent release batch', async () => {
  const root = await createReleaseFixture();
  try {
    await writeManifest(root, 0, {version: '0.1.0-alpha.17'});
    await writePlan(root, [release('@tileflow/core')]);
    const {stdout} = await runValidator(root, ['--require-packages']);
    assert.match(stdout, /Validated release plan for 1 independent package/u);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects tag arguments, incomplete history options, and empty required batches', async () => {
  const root = await createReleaseFixture();
  try {
    await writePlan(root, []);
    await rejectsValidator(root, ['release-20260813.1'], /Unknown release validation argument/u);
    await rejectsValidator(root, ['--base', 'a'.repeat(40)], /must be provided together/u);
    await rejectsValidator(root, ['--require-packages'], /Release plan is empty/u);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects skipped alpha versions and selected manifest drift', async () => {
  const root = await createReleaseFixture();
  try {
    await writePlan(root, [release('@tileflow/core', {to: '0.1.0-alpha.18'})]);
    await rejectsValidator(
      root,
      ['--require-packages'],
      /must use the next independent alpha version/u,
    );

    await writeManifest(root, 0, {version: '0.1.0-alpha.99'});
    await writePlan(root, [release('@tileflow/core')]);
    await rejectsValidator(
      root,
      ['--require-packages'],
      /manifest does not match the release plan/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects duplicate and dependency-unsafe release entries', async () => {
  const root = await createReleaseFixture();
  try {
    await writePlan(root, [release('@tileflow/core'), release('@tileflow/core')]);
    await rejectsValidator(root, ['--require-packages'], /Release plan packages must be unique/u);

    await writePlan(root, [release('@tileflow/dev'), release('@tileflow/core')]);
    await rejectsValidator(root, ['--require-packages'], /dependency-safe repository order/u);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects a populated plan with no changeset audit trail', async () => {
  const root = await createReleaseFixture();
  try {
    await writeManifest(root, 0, {version: '0.1.0-alpha.17'});
    await writePlan(root, [release('@tileflow/core')], []);
    await rejectsValidator(root, ['--require-packages'], /must retain its changeset names/u);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('binds an automatic publish to the reviewed base, exact head, and consumed changesets', async () => {
  const {base, head, root} = await createHistoryFixture();
  try {
    const {stdout} = await runValidator(root, [
      '--base',
      base,
      '--head',
      head,
      '--require-packages',
    ]);
    assert.match(stdout, /Validated release plan for 1 independent package/u);

    await rejectsValidator(
      root,
      ['--base', base, '--head', base, '--require-packages'],
      /release head must match the checkout HEAD/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('accepts squash, rebase-shaped, and merge-commit release histories', async (t) => {
  for (const fixtureOptions of [
    {label: 'squash'},
    {label: 'rebase-shaped multi-commit', trailingCommit: true},
    {label: 'merge commit', mergeCommit: true},
  ]) {
    await t.test(fixtureOptions.label, async () => {
      const {base, head, root} = await createHistoryFixture(fixtureOptions);
      try {
        await runValidator(root, ['--base', base, '--head', head, '--require-packages']);
      } finally {
        await rm(root, {force: true, recursive: true});
      }
    });
  }
});

test('rejects an unchanged stale plan and a changeset that was not consumed', async () => {
  const stale = await createHistoryFixture();
  try {
    const staleBase = stale.head;
    await writeFile(join(stale.root, 'README.md'), '# Unrelated change\n');
    const staleHead = await commitFixture(stale.root, 'unrelated change after release');
    await rejectsValidator(
      stale.root,
      ['--base', staleBase, '--head', staleHead, '--require-packages'],
      /must change \.changeset\/release-plan\.json/u,
    );
  } finally {
    await rm(stale.root, {force: true, recursive: true});
  }

  const unconsumed = await createHistoryFixture({keepChangeset: true});
  try {
    await rejectsValidator(
      unconsumed.root,
      ['--base', unconsumed.base, '--head', unconsumed.head, '--require-packages'],
      /must consume every pending changeset and add none/u,
    );
  } finally {
    await rm(unconsumed.root, {force: true, recursive: true});
  }
});

test('rejects a new changeset or source change added by the Release PR', async () => {
  for (const fixtureOptions of [{newHeadChangeset: true}, {hitchhikeSource: true}]) {
    const {base, head, root} = await createHistoryFixture(fixtureOptions);
    try {
      await rejectsValidator(
        root,
        ['--base', base, '--head', head, '--require-packages'],
        fixtureOptions.newHeadChangeset
          ? /must consume every pending changeset and add none/u
          : /may contain only deterministic version, changelog, plan, and changeset outputs/u,
      );
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  }
});

test('rejects a release plan whose previous version differs from the reviewed base', async () => {
  const {base, head, root} = await createHistoryFixture({
    releaseOverride: {from: '0.1.0-alpha.15', to: '0.1.0-alpha.16'},
  });
  try {
    await rejectsValidator(
      root,
      ['--base', base, '--head', head, '--require-packages'],
      /does not exactly match the reviewed changesets and base versions/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects a base commit that is not an ancestor of the release head', async () => {
  const {base, head, root} = await createHistoryFixture();
  try {
    const tree = await runGit(root, ['rev-parse', `${base}^{tree}`]);
    const unrelatedBase = await runGit(root, [
      '-c',
      'user.name=Tileflow release test',
      '-c',
      'user.email=release-test@tileflow.invalid',
      'commit-tree',
      tree,
      '-m',
      'unrelated base',
    ]);
    await rejectsValidator(
      root,
      ['--base', unrelatedBase, '--head', head, '--require-packages'],
      /merge-base --is-ancestor/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects version drift in an unselected package', async () => {
  const {base, head, root} = await createHistoryFixture({unselectedDrift: true});
  try {
    await rejectsValidator(
      root,
      ['--base', base, '--head', head, '--require-packages'],
      /@tileflow\/static changed version without being selected/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

async function createReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-validation-'));
  await mkdir(join(root, '.changeset'), {recursive: true});
  for (let index = 0; index < packageDirectories.length; index += 1) {
    await writeManifest(root, index);
  }
  return root;
}

async function createHistoryFixture({
  hitchhikeSource = false,
  keepChangeset = false,
  mergeCommit = false,
  newHeadChangeset = false,
  releaseOverride = {},
  trailingCommit = false,
  unselectedDrift = false,
} = {}) {
  const root = await createReleaseFixture();
  await writeFile(
    join(root, '.changeset', 'release.md'),
    '---\n"@tileflow/core": patch\n---\n\nRelease this package independently.\n',
  );
  await runGit(root, ['init']);
  const base = await commitFixture(root, 'base with reviewed changeset');
  const baseBranch = await runGit(root, ['branch', '--show-current']);
  if (mergeCommit) await runGit(root, ['switch', '-c', 'release']);

  const selectedRelease = release('@tileflow/core', releaseOverride);
  await writeManifest(root, 0, {version: selectedRelease.to});
  if (unselectedDrift) await writeManifest(root, 1, {version: '0.1.0-alpha.17'});
  await writePlan(root, [selectedRelease]);
  if (!keepChangeset) await rm(join(root, '.changeset', 'release.md'));
  if (newHeadChangeset) {
    await writeFile(
      join(root, '.changeset', 'unexpected.md'),
      '---\n"@tileflow/core": patch\n---\n\nUnexpected follow-up.\n',
    );
  }
  if (hitchhikeSource) {
    await mkdir(join(root, 'packages', 'core', 'src'), {recursive: true});
    await writeFile(join(root, 'packages', 'core', 'src', 'unexpected.ts'), 'export {};\n');
  }
  const baseChangelog = `# ${selectedRelease.name}\n`;
  const changelogPath = join(root, 'packages', 'core', 'CHANGELOG.md');
  if (!trailingCommit) {
    await writeFile(changelogPath, createUpdatedChangelog(baseChangelog, selectedRelease));
  }
  let head = await commitFixture(root, 'version reviewed packages');
  if (trailingCommit) {
    await writeFile(changelogPath, createUpdatedChangelog(baseChangelog, selectedRelease));
    head = await commitFixture(root, 'write generated changelog');
  }
  if (mergeCommit) {
    await runGit(root, ['switch', baseBranch]);
    await runGit(root, [
      '-c',
      'user.name=Tileflow release test',
      '-c',
      'user.email=release-test@tileflow.invalid',
      'merge',
      '--no-ff',
      'release',
      '-m',
      'merge official release pull request',
    ]);
    head = await runGit(root, ['rev-parse', 'HEAD']);
  }
  return {base, head, root};
}

async function writeManifest(root, index, overrides = {}) {
  const directory = packageDirectories[index];
  const packageRoot = join(root, 'packages', directory);
  await mkdir(packageRoot, {recursive: true});
  const manifest = {
    name: publicPackageNames[index],
    version: '0.1.0-alpha.16',
    publishConfig: {access: 'public'},
    repository: {
      type: 'git',
      url: 'git+https://github.com/tileflow/tileflow-sdk.git',
    },
    bugs: {url: 'https://github.com/tileflow/tileflow-sdk/issues'},
    ...(index === 1 ? {dependencies: {'@tileflow/core': 'workspace:*'}} : {}),
    ...overrides,
  };
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function release(name, overrides = {}) {
  return {
    name,
    from: '0.1.0-alpha.16',
    to: '0.1.0-alpha.17',
    type: 'patch',
    summaries: ['Release this package independently.'],
    ...overrides,
  };
}

async function writePlan(root, packages, changesets = ['release.md']) {
  await writeFile(
    join(root, '.changeset', 'release-plan.json'),
    `${JSON.stringify({schemaVersion: 1, packages, changesets}, null, 2)}\n`,
  );
}

function runValidator(root, args) {
  return execFileAsync(process.execPath, [scriptPath, ...args], {
    env: {...process.env, TILEFLOW_RELEASE_ROOT: root},
  });
}

async function rejectsValidator(root, args, pattern) {
  await assert.rejects(runValidator(root, args), (error) => {
    assert.match(`${error.stderr ?? ''}${error.stdout ?? ''}`, pattern);
    return true;
  });
}

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
