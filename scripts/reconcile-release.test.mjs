import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {
  applyReleaseVersions,
  createRegistryState,
  createReleasePlan,
  renderReleaseSummary,
  validateFinalRelease,
  validateReleasePlan,
} from './reconcile-release.mjs';
import {
  automaticInternalRuntimeRange,
  developmentVersion,
  internalRuntimeRange,
  internalWorkspaceRuntimeRange,
  packageDirectories,
  publicPackageNames,
} from './release-config.mjs';

const execFileAsync = promisify(execFile);
const sourceSha = 'a'.repeat(40);

test('selects only materially changed artifacts and advances independent alpha counters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    versions['@tileflow/core'] = '0.1.0-alpha.20';
    versions['@tileflow/static'] = '0.1.0-alpha.7';
    const registry = await tarballSet(root, 'registry', versions);
    const candidates = await tarballSet(root, 'candidate', versions, {
      '@tileflow/core': {files: {'dist/index.js': 'export const changed = true;\n'}},
      '@tileflow/static': {
        manifest: {devDependencies: {typescript: '999.0.0'}},
      },
    });
    const state = await registryState(registry, versions);
    const plan = await createReleasePlan({
      sourceSha,
      registryState: state,
      candidateTarballs: candidates.paths,
    });

    assert.deepEqual(
      plan.packages.map(({name, from, to}) => ({name, from, to})),
      [
        {
          name: '@tileflow/core',
          from: '0.1.0-alpha.20',
          to: '0.1.0-alpha.21',
        },
      ],
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('selects a dependent only when its published runtime range materially changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    const registry = await tarballSet(root, 'registry', versions, {
      '@tileflow/dev': {manifest: {dependencies: {'@tileflow/core': '0.1.0-alpha.16'}}},
    });
    const candidates = await tarballSet(root, 'candidate', versions, {
      '@tileflow/dev': {manifest: {dependencies: {'@tileflow/core': internalRuntimeRange}}},
    });
    const plan = await createReleasePlan({
      sourceSha,
      registryState: await registryState(registry, versions),
      candidateTarballs: candidates.paths,
    });
    assert.deepEqual(
      plan.packages.map(({name}) => name),
      ['@tileflow/dev'],
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('produces an empty plan when npm already contains the current public artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    const registry = await tarballSet(root, 'registry', versions);
    const candidates = await tarballSet(root, 'candidate', versions);
    const plan = await createReleasePlan({
      sourceSha,
      registryState: await registryState(registry, versions),
      candidateTarballs: candidates.paths,
    });
    assert.deepEqual(plan.packages, []);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('repairs a dependency-first partial publication without rebumping the published dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-partial-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    versions['@tileflow/core'] = '0.1.0-alpha.21';
    const devBaseline = {dependencies: {'@tileflow/core': '0.1.0-alpha.16'}};
    const registry = await tarballSet(root, 'registry-partial', versions, {
      '@tileflow/core': {files: {'dist/index.js': 'export const newCore = true;\n'}},
      '@tileflow/dev': {manifest: devBaseline},
    });
    const candidates = await tarballSet(root, 'candidate-partial', versions, {
      '@tileflow/core': {files: {'dist/index.js': 'export const newCore = true;\n'}},
      '@tileflow/dev': {
        files: {'dist/index.js': 'export const newDev = true;\n'},
        manifest: devBaseline,
      },
    });

    const plan = await createReleasePlan({
      sourceSha,
      registryState: await registryState(registry, versions),
      candidateTarballs: candidates.paths,
    });
    assert.deepEqual(
      plan.packages.map(({name, from, to, runtimeDependencies}) => ({
        name,
        from,
        to,
        runtimeDependencies,
      })),
      [
        {
          name: '@tileflow/dev',
          from: '0.1.0-alpha.16',
          to: '0.1.0-alpha.17',
          runtimeDependencies: {
            dependencies: {
              '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.21'),
            },
          },
        },
      ],
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('applies registry baselines and selected targets only in the ephemeral checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-test-'));
  try {
    await sourceManifestTree(root);
    const plan = releasePlan([
      {
        name: '@tileflow/core',
        from: '0.1.0-alpha.16',
        to: '0.1.0-alpha.17',
        differences: ['package/dist/index.js'],
      },
    ]);
    await applyReleaseVersions(plan, root);
    for (const [index, directory] of packageDirectories.entries()) {
      const manifest = JSON.parse(
        await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'),
      );
      assert.equal(
        manifest.version,
        publicPackageNames[index] === '@tileflow/core' ? '0.1.0-alpha.17' : '0.1.0-alpha.16',
      );
    }
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('floors selected dependents at effective dependency versions and preserves unselected ranges', async () => {
  const scenarios = [
    {
      name: 'core and dev selected',
      selected: ['@tileflow/core', '@tileflow/dev'],
      expectedRange: automaticInternalRuntimeRange('0.1.0-alpha.17'),
    },
    {
      name: 'dev selected alone',
      selected: ['@tileflow/dev'],
      expectedRange: automaticInternalRuntimeRange('0.1.0-alpha.16'),
    },
    {
      name: 'core selected alone',
      selected: ['@tileflow/core'],
      expectedRange: '0.1.0-alpha.16',
    },
  ];

  for (const scenario of scenarios) {
    const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-floor-test-'));
    try {
      await sourceManifestTree(
        root,
        {},
        {
          '@tileflow/dev': {dependencies: {'@tileflow/core': internalWorkspaceRuntimeRange}},
        },
      );
      const plan = releasePlan(scenario.selected.map(releaseEntry), {
        '@tileflow/dev': {
          dependencies: {'@tileflow/core': '0.1.0-alpha.16'},
        },
      });
      await applyReleaseVersions(plan, root);
      const dev = JSON.parse(await readFile(join(root, 'packages', 'dev', 'package.json'), 'utf8'));
      assert.equal(dev.dependencies['@tileflow/core'], scenario.expectedRange, scenario.name);
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  }
});

test('candidate application keeps source dependency additions and removals visible', async () => {
  const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));

  const addedRoot = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-added-edge-test-'));
  try {
    const registry = await tarballSet(addedRoot, 'registry', versions);
    const state = await registryState(registry, versions);
    await sourceManifestTree(
      addedRoot,
      {},
      {
        '@tileflow/dev': {dependencies: {'@tileflow/core': internalWorkspaceRuntimeRange}},
      },
    );
    await applyReleaseVersions(state, addedRoot);
    const dev = JSON.parse(
      await readFile(join(addedRoot, 'packages', 'dev', 'package.json'), 'utf8'),
    );
    assert.equal(
      dev.dependencies['@tileflow/core'],
      automaticInternalRuntimeRange('0.1.0-alpha.16'),
    );
  } finally {
    await rm(addedRoot, {force: true, recursive: true});
  }

  const removedRoot = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-removed-edge-test-'));
  try {
    const registry = await tarballSet(removedRoot, 'registry', versions, {
      '@tileflow/dev': {manifest: {dependencies: {'@tileflow/core': '0.1.0-alpha.16'}}},
    });
    const state = await registryState(registry, versions);
    await sourceManifestTree(removedRoot);
    await applyReleaseVersions(state, removedRoot);
    const dev = JSON.parse(
      await readFile(join(removedRoot, 'packages', 'dev', 'package.json'), 'utf8'),
    );
    assert.equal(dev.dependencies, undefined);
  } finally {
    await rm(removedRoot, {force: true, recursive: true});
  }
});

test('validates final tarballs, shared internal ranges, and unselected immutability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    const registry = await tarballSet(root, 'registry', versions, {
      '@tileflow/dev': {
        manifest: {dependencies: {'@tileflow/core': internalRuntimeRange}},
      },
    });
    const state = await registryState(registry, versions);
    const plan = releasePlan([releaseEntry('@tileflow/core')], {
      '@tileflow/dev': {
        dependencies: {'@tileflow/core': internalRuntimeRange},
      },
    });
    const finalVersions = {...versions, '@tileflow/core': '0.1.0-alpha.17'};
    const final = await tarballSet(root, 'final', finalVersions, {
      '@tileflow/core': {files: {'dist/index.js': 'export const changed = true;\n'}},
      '@tileflow/dev': {
        manifest: {dependencies: {'@tileflow/core': internalRuntimeRange}},
      },
    });
    await sourceManifestTree(root, finalVersions, {
      '@tileflow/dev': {dependencies: {'@tileflow/core': internalRuntimeRange}},
    });

    await validateFinalRelease({
      plan,
      registryState: state,
      finalTarballs: final.paths,
      root,
    });

    const drifted = await tarballSet(root, 'drifted', finalVersions, {
      '@tileflow/core': {files: {'dist/index.js': 'export const changed = true;\n'}},
      '@tileflow/dev': {
        files: {'dist/index.js': 'unselected drift\n'},
        manifest: {dependencies: {'@tileflow/core': internalRuntimeRange}},
      },
    });
    await assert.rejects(
      validateFinalRelease({plan, registryState: state, finalTarballs: drifted.paths, root}),
      /changed materially without being selected/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('rejects selected tarballs whose internal dependency topology differs from the plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-reconcile-topology-test-'));
  try {
    const versions = Object.fromEntries(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
    const baselineWithEdge = {
      '@tileflow/dev': {manifest: {dependencies: {'@tileflow/core': '0.1.0-alpha.16'}}},
    };
    const registryWithEdge = await tarballSet(
      root,
      'registry-with-edge',
      versions,
      baselineWithEdge,
    );
    const stateWithEdge = await registryState(registryWithEdge, versions);
    const planWithEdge = releasePlan([releaseEntry('@tileflow/dev')], {
      '@tileflow/dev': {dependencies: {'@tileflow/core': '0.1.0-alpha.16'}},
    });
    const finalVersions = {...versions, '@tileflow/dev': '0.1.0-alpha.17'};
    const omitted = await tarballSet(root, 'omitted-edge', finalVersions, {
      '@tileflow/dev': {files: {'dist/index.js': 'selected without its dependency\n'}},
    });
    await sourceManifestTree(root, finalVersions, {
      '@tileflow/dev': {
        dependencies: {
          '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.16'),
        },
      },
    });
    await assert.rejects(
      validateFinalRelease({
        plan: planWithEdge,
        registryState: stateWithEdge,
        finalTarballs: omitted.paths,
        root,
      }),
      /dependency topology differs from its release plan/u,
    );

    const registryWithoutEdge = await tarballSet(root, 'registry-without-edge', versions);
    const stateWithoutEdge = await registryState(registryWithoutEdge, versions);
    const planWithoutEdge = releasePlan([releaseEntry('@tileflow/dev')]);
    const injected = await tarballSet(root, 'injected-edge', finalVersions, {
      '@tileflow/dev': {
        files: {'dist/index.js': 'selected with an unplanned dependency\n'},
        manifest: {
          dependencies: {
            '@tileflow/core': automaticInternalRuntimeRange('0.1.0-alpha.16'),
          },
        },
      },
    });
    await sourceManifestTree(root, finalVersions);
    await assert.rejects(
      validateFinalRelease({
        plan: planWithoutEdge,
        registryState: stateWithoutEdge,
        finalTarballs: injected.paths,
        root,
      }),
      /dependency topology differs from its release plan/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('renders a deterministic human-readable reconciliation summary', () => {
  const plan = releasePlan([
    {
      name: '@tileflow/core',
      from: '0.1.0-alpha.16',
      to: '0.1.0-alpha.17',
      differences: ['package/dist/index.js'],
    },
  ]);
  assert.match(renderReleaseSummary(plan), /@tileflow\/core/u);
  assert.match(renderReleaseSummary(plan), /0\.1\.0-alpha\.17/u);
  assert.match(renderReleaseSummary(releasePlan([])), /already match npm/u);
});

async function registryState(set, versions) {
  const tsv = publicPackageNames
    .map((name) => `${name}\t${versions[name]}\t${set.byName.get(name)}`)
    .join('\n');
  return createRegistryState(`${tsv}\n`);
}

function releasePlan(packages, runtimeDependencies = {}) {
  const effectiveVersions = new Map(publicPackageNames.map((name) => [name, '0.1.0-alpha.16']));
  for (const release of packages) effectiveVersions.set(release.name, release.to);
  return validateReleasePlan({
    schemaVersion: 2,
    channel: 'alpha',
    sourceSha,
    baselines: publicPackageNames.map((name) => ({
      name,
      runtimeDependencies: runtimeDependencies[name] ?? {},
      version: '0.1.0-alpha.16',
    })),
    packages: packages.map((release) => ({
      ...release,
      runtimeDependencies: dynamicRuntimeDependencies(
        runtimeDependencies[release.name] ?? {},
        effectiveVersions,
      ),
    })),
  });
}

function dynamicRuntimeDependencies(snapshot, versions) {
  return Object.fromEntries(
    Object.entries(snapshot).map(([group, dependencies]) => [
      group,
      Object.fromEntries(
        Object.keys(dependencies).map((dependency) => [
          dependency,
          automaticInternalRuntimeRange(versions.get(dependency)),
        ]),
      ),
    ]),
  );
}

function releaseEntry(name) {
  return {
    name,
    from: '0.1.0-alpha.16',
    to: '0.1.0-alpha.17',
    differences: ['package/dist/index.js'],
  };
}

async function sourceManifestTree(root, versions = {}, overrides = {}) {
  for (const [index, directory] of packageDirectories.entries()) {
    const name = publicPackageNames[index];
    const packageRoot = join(root, 'packages', directory);
    await mkdir(packageRoot, {recursive: true});
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(manifest(name, versions[name] ?? developmentVersion, overrides[name]), null, 2)}\n`,
    );
  }
}

async function tarballSet(root, prefix, versions, overrides = {}) {
  const paths = [];
  const byName = new Map();
  for (const name of publicPackageNames) {
    const safeName = name.replace('@tileflow/', 'tileflow-');
    const fixture = join(root, `${prefix}-${safeName}`);
    const packageRoot = join(fixture, 'package');
    await mkdir(join(packageRoot, 'dist'), {recursive: true});
    const override = overrides[name] ?? {};
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(manifest(name, versions[name], override.manifest), null, 2)}\n`,
    );
    await writeFile(
      join(packageRoot, 'dist', 'index.js'),
      `export const name = ${JSON.stringify(name)};\n`,
    );
    for (const [path, contents] of Object.entries(override.files ?? {})) {
      const target = join(packageRoot, path);
      await mkdir(join(target, '..'), {recursive: true});
      await writeFile(target, contents);
    }
    const tarball = join(root, `${prefix}-${safeName}.tgz`);
    await execFileAsync('tar', ['-czf', tarball, '-C', fixture, 'package']);
    paths.push(tarball);
    byName.set(name, tarball);
  }
  return {byName, paths};
}

function manifest(name, version, override = {}) {
  return {
    name,
    version,
    repository: {type: 'git', url: 'git+https://github.com/tileflow/tileflow-sdk.git'},
    bugs: {url: 'https://github.com/tileflow/tileflow-sdk/issues'},
    publishConfig: {access: 'public'},
    ...override,
  };
}
