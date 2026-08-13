import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {packageDirectories, publicPackageNames} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('validate-release.mjs', import.meta.url));

test('accepts a non-empty independent release batch', async () => {
  const root = await createReleaseFixture();
  try {
    await writeManifest(root, 0, {version: '0.1.0-alpha.17'});
    await writePlan(root, [release('@tileflow/core')]);
    const {stdout} = await runValidator(root, ['release-20260813.1', '--require-packages']);
    assert.match(stdout, /Validated release-20260813\.1 for 1 independent package/u);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects old version tags, invalid dates, and empty required batches', async () => {
  const root = await createReleaseFixture();
  try {
    await writePlan(root, []);
    await rejectsValidator(root, ['v0.1.0-alpha.17'], /Expected a release-YYYYMMDD\.N batch tag/u);
    await rejectsValidator(root, ['release-20260230.1'], /contains an invalid calendar date/u);
    await rejectsValidator(
      root,
      ['release-20260813.1', '--require-packages'],
      /Release plan is empty/u,
    );
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
      ['release-20260813.2', '--require-packages'],
      /must use the next independent alpha version/u,
    );

    await writeManifest(root, 0, {version: '0.1.0-alpha.99'});
    await writePlan(root, [release('@tileflow/core')]);
    await rejectsValidator(
      root,
      ['release-20260813.2', '--require-packages'],
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
    await rejectsValidator(
      root,
      ['release-20260813.3', '--require-packages'],
      /Release plan packages must be unique/u,
    );

    await writePlan(root, [release('@tileflow/dev'), release('@tileflow/core')]);
    await rejectsValidator(
      root,
      ['release-20260813.3', '--require-packages'],
      /dependency-safe repository order/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects a populated plan with no changeset audit trail', async () => {
  const root = await createReleaseFixture();
  try {
    await writeManifest(root, 0, {version: '0.1.0-alpha.17'});
    await writePlan(root, [release('@tileflow/core')], []);
    await rejectsValidator(
      root,
      ['release-20260813.4', '--require-packages'],
      /must retain its changeset names/u,
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
