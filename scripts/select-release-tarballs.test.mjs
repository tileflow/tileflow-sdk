import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  automaticInternalRuntimeRange,
  publicPackageNames,
  runtimeDependencySnapshot,
} from './release-config.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('select-release-tarballs.mjs', import.meta.url));

test('selects only changed tarballs in dependency-safe repository order', async () => {
  const fixture = await createFixture({
    '@tileflow/cli': {
      dependencies: {
        '@tileflow/capture': automaticInternalRuntimeRange('0.1.0-alpha.17'),
        '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.16'),
      },
    },
  });
  try {
    await writePlan(fixture, ['@tileflow/capture', '@tileflow/cli']);
    await runSelector(fixture);
    assert.deepEqual(
      nonEmptyLines(await readFile(fixture.selectedPath, 'utf8')).map(
        (path) => path.match(/tileflow-(capture|cli)-/u)?.[1],
      ),
      ['capture', 'cli'],
    );
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects selected-package exact pins and ranges that omit the effective dependency', async () => {
  for (const range of ['0.1.0-alpha.16', '>=0.1.0-alpha.99 <0.1.0-beta.0']) {
    const fixture = await createFixture({
      '@tileflow/cli': {dependencies: {'@tileflow/core': range}},
    });
    try {
      await writePlan(fixture, ['@tileflow/capture', '@tileflow/cli']);
      await assert.rejects(runSelector(fixture));
    } finally {
      await rm(fixture.root, {force: true, recursive: true});
    }
  }
});

test('rejects omitted and injected internal edges relative to the release plan', async () => {
  const omitted = await createFixture();
  try {
    await writePlan(omitted, ['@tileflow/capture', '@tileflow/cli']);
    const plan = JSON.parse(await readFile(omitted.planPath, 'utf8'));
    plan.packages.find(({name}) => name === '@tileflow/cli').runtimeDependencies = {
      dependencies: {
        '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.16'),
      },
    };
    await writeFile(omitted.planPath, `${JSON.stringify(plan, null, 2)}\n`);
    await assert.rejects(
      runSelector(omitted),
      /dependency topology differs from its release plan/u,
    );
  } finally {
    await rm(omitted.root, {force: true, recursive: true});
  }

  const injected = await createFixture({
    '@tileflow/cli': {
      dependencies: {
        '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.16'),
      },
    },
  });
  try {
    await writePlan(injected, ['@tileflow/capture', '@tileflow/cli']);
    const plan = JSON.parse(await readFile(injected.planPath, 'utf8'));
    plan.packages.find(({name}) => name === '@tileflow/cli').runtimeDependencies = {};
    await writeFile(injected.planPath, `${JSON.stringify(plan, null, 2)}\n`);
    await assert.rejects(
      runSelector(injected),
      /dependency topology differs from its release plan/u,
    );
  } finally {
    await rm(injected.root, {force: true, recursive: true});
  }
});

test('ignores development-only dependency topology', async () => {
  const fixture = await createFixture({
    '@tileflow/capture': {devDependencies: {'@tileflow/react': '0.1.0-alpha.16'}},
  });
  try {
    await writePlan(fixture, ['@tileflow/capture', '@tileflow/cli']);
    await runSelector(fixture);
    assert.equal(nonEmptyLines(await readFile(fixture.selectedPath, 'utf8')).length, 2);
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

test('rejects missing, duplicate, empty-plan, and version-mismatched tarballs', async () => {
  const fixture = await createFixture();
  try {
    await writePlan(fixture, ['@tileflow/core']);
    const paths = nonEmptyLines(await readFile(fixture.listPath, 'utf8'));
    await writeFile(fixture.listPath, `${paths.slice(1).join('\n')}\n`);
    await assert.rejects(runSelector(fixture), /Expected 11 packed public packages/u);

    await writeFile(fixture.listPath, `${paths.slice(0, -1).join('\n')}\n${paths[0]}\n`);
    await assert.rejects(runSelector(fixture), /Duplicate tarball for @tileflow\/core/u);

    await writeFile(fixture.listPath, `${paths.join('\n')}\n`);
    await writePlan(fixture, []);
    await assert.rejects(runSelector(fixture), /Release plan is empty/u);

    await writePlan(fixture, ['@tileflow/core']);
    await assert.rejects(runSelector(fixture), /tarball version mismatch/u);
  } finally {
    await rm(fixture.root, {force: true, recursive: true});
  }
});

async function createFixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-tarballs-'));
  const tarballRoot = join(root, 'tarballs');
  await mkdir(tarballRoot, {recursive: true});
  const tarballs = [];
  const runtimeDependencies = {};
  for (const name of publicPackageNames) {
    const safeName = name.replace('@tileflow/', 'tileflow-');
    const fixtureRoot = join(root, safeName);
    const packageRoot = join(fixtureRoot, 'package');
    await mkdir(packageRoot, {recursive: true});
    const version =
      name === '@tileflow/capture' || name === '@tileflow/cli'
        ? '0.1.0-alpha.17'
        : '0.1.0-alpha.16';
    const packageManifest = {name, version, ...overrides[name]};
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(packageManifest, null, 2)}\n`,
    );
    runtimeDependencies[name] = runtimeDependencySnapshot(packageManifest);
    const tarball = join(tarballRoot, `${safeName}-${version}.tgz`);
    await execFileAsync('tar', ['-czf', tarball, '-C', fixtureRoot, 'package']);
    tarballs.push(tarball);
  }
  const fixture = {
    root,
    planPath: join(root, 'plan.json'),
    listPath: join(root, 'tarballs.txt'),
    selectedPath: join(root, 'selected.txt'),
    runtimeDependencies,
  };
  await writeFile(fixture.listPath, `${tarballs.join('\n')}\n`);
  return fixture;
}

async function writePlan(fixture, names) {
  const selected = new Set(names);
  const baselines = publicPackageNames.map((name) => ({
    name,
    runtimeDependencies: selected.has(name) ? {} : fixture.runtimeDependencies[name],
    version: '0.1.0-alpha.16',
  }));
  const packages = names.map((name) => ({
    name,
    from: '0.1.0-alpha.16',
    to: '0.1.0-alpha.17',
    differences: ['package/dist/index.js'],
    runtimeDependencies: fixture.runtimeDependencies[name],
  }));
  await writeFile(
    fixture.planPath,
    `${JSON.stringify({schemaVersion: 2, channel: 'alpha', sourceSha: 'a'.repeat(40), baselines, packages}, null, 2)}\n`,
  );
}

function runSelector(fixture) {
  return execFileAsync(process.execPath, [
    scriptPath,
    fixture.planPath,
    fixture.listPath,
    fixture.selectedPath,
  ]);
}

function nonEmptyLines(value) {
  return value.split('\n').filter(Boolean);
}
