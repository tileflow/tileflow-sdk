import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {publicPackageNames} from './release-packages.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('select-release-tarballs.mjs', import.meta.url));

test('selects only release-plan tarballs and records unselected npm dependencies', async () => {
  const fixture = await createTarballFixture({
    '@tileflow/cli': {
      dependencies: {
        '@tileflow/capture': '0.1.0-alpha.17',
        '@tileflow/core': '0.1.0-alpha.16',
      },
    },
  });
  try {
    await writePlan(fixture, [release('@tileflow/capture'), release('@tileflow/cli')]);
    await runSelector(fixture);

    const selected = nonEmptyLines(await readFile(fixture.selectedPath, 'utf8'));
    assert.equal(selected.length, 2);
    assert.match(selected[0], /tileflow-capture-/u);
    assert.match(selected[1], /tileflow-cli-/u);
    assert.deepEqual(nonEmptyLines(await readFile(fixture.dependenciesPath, 'utf8')), [
      '@tileflow/core\t0.1.0-alpha.16',
    ]);
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects a selected package that points at the wrong batch dependency version', async () => {
  const fixture = await createTarballFixture({
    '@tileflow/cli': {dependencies: {'@tileflow/capture': '0.1.0-alpha.16'}},
  });
  try {
    await writePlan(fixture, [release('@tileflow/capture'), release('@tileflow/cli')]);
    await assert.rejects(runSelector(fixture), (error) => {
      assert.match(
        `${error.stderr ?? ''}${error.stdout ?? ''}`,
        /must depend on the @tileflow\/capture version in this release batch/u,
      );
      return true;
    });
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects a selected dependency that would publish after its consumer', async () => {
  const fixture = await createTarballFixture({
    '@tileflow/core': {
      version: '0.1.0-alpha.17',
      dependencies: {'@tileflow/static': '0.1.0-alpha.17'},
    },
    '@tileflow/static': {version: '0.1.0-alpha.17'},
  });
  try {
    await writePlan(fixture, [release('@tileflow/core'), release('@tileflow/static')]);
    await assert.rejects(runSelector(fixture), (error) => {
      assert.match(
        `${error.stderr ?? ''}${error.stdout ?? ''}`,
        /@tileflow\/static must be published before its selected dependent @tileflow\/core/u,
      );
      return true;
    });
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('does not impose publication order for development-only dependencies', async () => {
  const fixture = await createTarballFixture({
    '@tileflow/capture': {devDependencies: {'@tileflow/react': '0.1.0-alpha.16'}},
    '@tileflow/react': {version: '0.1.0-alpha.17'},
  });
  try {
    await writePlan(fixture, [release('@tileflow/capture'), release('@tileflow/react')]);
    await runSelector(fixture);
    assert.deepEqual(
      nonEmptyLines(await readFile(fixture.selectedPath, 'utf8')).map(
        (path) => path.match(/tileflow-(capture|react)-/u)?.[1],
      ),
      ['capture', 'react'],
    );
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects missing and duplicate public tarballs', async () => {
  const fixture = await createTarballFixture();
  try {
    await writePlan(fixture, [release('@tileflow/core')]);
    const paths = nonEmptyLines(await readFile(fixture.listPath, 'utf8'));
    await writeFile(fixture.listPath, `${paths.slice(1).join('\n')}\n`);
    await assert.rejects(runSelector(fixture), /Expected 11 packed public packages/u);

    await writeFile(fixture.listPath, `${paths.slice(0, -1).join('\n')}\n${paths[0]}\n`);
    await assert.rejects(runSelector(fixture), /Duplicate tarball for @tileflow\/core/u);
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects an empty plan and a selected tarball version mismatch', async () => {
  const fixture = await createTarballFixture();
  try {
    await writePlan(fixture, []);
    await assert.rejects(runSelector(fixture), /Release plan is empty/u);

    await writePlan(fixture, [release('@tileflow/core')]);
    await assert.rejects(runSelector(fixture), /@tileflow\/core tarball version mismatch/u);
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

async function createTarballFixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-tarballs-'));
  const tarballRoot = join(root, 'tarballs');
  await mkdir(tarballRoot, {recursive: true});
  const tarballs = [];

  for (const name of publicPackageNames) {
    const directory = join(root, 'package');
    await rm(directory, {force: true, recursive: true});
    await mkdir(directory, {recursive: true});
    const version =
      name === '@tileflow/capture' || name === '@tileflow/cli'
        ? '0.1.0-alpha.17'
        : '0.1.0-alpha.16';
    await writeFile(
      join(directory, 'package.json'),
      `${JSON.stringify({name, version, ...overrides[name]}, null, 2)}\n`,
    );
    const filename = `${name.replace('@tileflow/', 'tileflow-')}-${version}.tgz`;
    const tarball = join(tarballRoot, filename);
    await execFileAsync('tar', ['-czf', tarball, '-C', root, 'package']);
    tarballs.push(tarball);
  }

  const fixture = {
    root,
    planPath: join(root, 'release-plan.json'),
    listPath: join(root, 'tarballs.txt'),
    selectedPath: join(root, 'selected.txt'),
    dependenciesPath: join(root, 'registry-dependencies.txt'),
  };
  await writeFile(fixture.listPath, `${tarballs.join('\n')}\n`);
  return fixture;
}

function release(name) {
  return {
    name,
    from: '0.1.0-alpha.16',
    to: '0.1.0-alpha.17',
    type: 'patch',
    summaries: ['Release this package independently.'],
  };
}

async function writePlan(fixture, packages) {
  await writeFile(
    fixture.planPath,
    `${JSON.stringify({schemaVersion: 1, packages, changesets: []}, null, 2)}\n`,
  );
}

function runSelector(fixture) {
  return execFileAsync(process.execPath, [
    scriptPath,
    fixture.planPath,
    fixture.listPath,
    fixture.selectedPath,
    fixture.dependenciesPath,
  ]);
}

function nonEmptyLines(value) {
  return value.split('\n').filter(Boolean);
}
