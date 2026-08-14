import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import semver from 'semver';
import {comparePackageTarballs} from './compare-package-tarballs.mjs';
import {
  automaticInternalRuntimeRange,
  nextAlphaVersion,
  packageDirectories,
  publicPackageNames,
  publicPackageNameSet,
  runtimeDependencyGroups,
  runtimeDependencySnapshot,
  validatePublicManifests,
  validateRuntimeDependencySnapshot,
} from './release-config.mjs';
import {runCommand} from './run-command.mjs';

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/u;
const repositoryRoot = resolve(
  process.env.TILEFLOW_RELEASE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
);

export async function readPublicManifests(root = repositoryRoot) {
  return new Map(
    await Promise.all(
      packageDirectories.map(async (directory, index) => {
        const path = join(root, 'packages', directory, 'package.json');
        const manifest = JSON.parse(await readFile(path, 'utf8'));
        return [publicPackageNames[index], {directory, manifest, path}];
      }),
    ),
  );
}

export async function validateSourceManifests(root = repositoryRoot) {
  const manifests = await readPublicManifests(root);
  validatePublicManifests(manifests, {source: true});
  return manifests;
}

export async function createRegistryState(tsvContents) {
  const packages = await Promise.all(
    tsvContents
      .split('\n')
      .filter(Boolean)
      .map(async (line) => {
        const fields = line.split('\t');
        assert.equal(fields.length, 3, `Invalid registry-state line: ${line}.`);
        const [name, version, tarball] = fields;
        const resolvedTarball = resolve(tarball);
        const manifest = await readTarballManifest(resolvedTarball);
        return {
          name,
          runtimeDependencies: runtimeDependencySnapshot(manifest),
          tarball: resolvedTarball,
          version,
        };
      }),
  );
  const state = {schemaVersion: 2, packages};
  await validateRegistryState(state);
  return state;
}

export async function validateRegistryState(state) {
  assert.equal(state?.schemaVersion, 2, 'Unsupported registry-state schema.');
  assert.ok(Array.isArray(state.packages), 'Registry-state packages must be an array.');
  assert.deepEqual(
    state.packages.map(({name}) => name),
    publicPackageNames,
    'Registry state must contain every public package in dependency-safe order.',
  );

  const manifests = new Map();
  for (const entry of state.packages) {
    assert.ok(entry.tarball, `Registry state is missing a tarball for ${entry.name}.`);
    assert.ok(semver.valid(entry.version), `Invalid registry version for ${entry.name}.`);
    nextAlphaVersion(entry.version);
    const manifest = await readTarballManifest(entry.tarball);
    assert.equal(manifest.name, entry.name, `Registry tarball name mismatch for ${entry.name}.`);
    assert.equal(
      manifest.version,
      entry.version,
      `Registry tarball version mismatch for ${entry.name}.`,
    );
    validateRuntimeDependencySnapshot(entry.name, entry.runtimeDependencies);
    assert.deepEqual(
      entry.runtimeDependencies,
      runtimeDependencySnapshot(manifest),
      `Registry runtime dependency snapshot mismatch for ${entry.name}.`,
    );
    manifests.set(entry.name, {manifest});
  }
  validatePublicManifests(manifests);
  return state;
}

export async function applyReleaseVersions(document, root = repositoryRoot) {
  const releasePlan = document?.channel === 'alpha';
  if (releasePlan) validateReleasePlan(document);
  else await validateRegistryState(document);

  const versions = versionMapFromDocument(document);
  const baselineEntries = releasePlan ? document.baselines : document.packages;
  const baselines = new Map(baselineEntries.map((entry) => [entry.name, entry]));
  const releases = new Map(
    releasePlan ? document.packages.map((release) => [release.name, release]) : [],
  );
  const manifests = await readPublicManifests(root);

  for (const [name, entry] of manifests) {
    const version = versions.get(name);
    assert.ok(version, `Release document has no version for ${name}.`);
    entry.manifest.version = version;
    if (releasePlan && releases.has(name)) {
      applySelectedRuntimeDependencies(entry.manifest, versions);
      assert.deepEqual(
        publishableRuntimeDependencySnapshot(entry.manifest),
        releases.get(name).runtimeDependencies,
        `${name} source dependency topology changed after release planning.`,
      );
    } else {
      applyBaselineRuntimeDependencies(entry.manifest, baselines.get(name).runtimeDependencies, {
        strict: releasePlan,
        versions,
      });
    }
    await writeFile(entry.path, `${JSON.stringify(entry.manifest, null, 2)}\n`);
  }
}

function publishableRuntimeDependencySnapshot(manifest) {
  const snapshot = runtimeDependencySnapshot(manifest);
  for (const dependencies of Object.values(snapshot)) {
    for (const [dependency, range] of Object.entries(dependencies)) {
      dependencies[dependency] = range.startsWith('workspace:')
        ? range.slice('workspace:'.length)
        : range;
    }
  }
  return snapshot;
}

function applyBaselineRuntimeDependencies(manifest, snapshot, {strict, versions}) {
  validateRuntimeDependencySnapshot(manifest.name, snapshot);
  const sourceSnapshot = runtimeDependencySnapshot(manifest);
  if (strict) {
    assert.deepEqual(
      dependencyShape(sourceSnapshot),
      dependencyShape(snapshot),
      `${manifest.name} changed its internal dependency topology without being selected.`,
    );
  }

  for (const group of runtimeDependencyGroups) {
    for (const dependency of Object.keys(sourceSnapshot[group] ?? {})) {
      const baselineRange = snapshot[group]?.[dependency];
      if (baselineRange !== undefined) {
        manifest[group][dependency] = `workspace:${baselineRange}`;
        continue;
      }
      const dependencyVersion = versions.get(dependency);
      assert.ok(dependencyVersion, `${manifest.name} has no baseline version for ${dependency}.`);
      manifest[group][dependency] = `workspace:${automaticInternalRuntimeRange(dependencyVersion)}`;
    }
  }
}

function applySelectedRuntimeDependencies(manifest, versions) {
  for (const group of runtimeDependencyGroups) {
    for (const dependency of Object.keys(manifest[group] ?? {})) {
      if (!publicPackageNameSet.has(dependency)) continue;
      const dependencyVersion = versions.get(dependency);
      assert.ok(dependencyVersion, `${manifest.name} has no release version for ${dependency}.`);
      manifest[group][dependency] = `workspace:${automaticInternalRuntimeRange(dependencyVersion)}`;
    }
  }
}

function dependencyShape(snapshot) {
  return Object.fromEntries(
    runtimeDependencyGroups
      .filter((group) => snapshot[group])
      .map((group) => [group, Object.keys(snapshot[group])]),
  );
}

export async function packAllPackages(
  destinationArgument,
  listPathArgument,
  root = repositoryRoot,
) {
  const destination = resolve(destinationArgument);
  const listPath = resolve(listPathArgument);
  await mkdir(destination, {recursive: true});
  const tarballs = [];

  for (const directory of packageDirectories) {
    const packageRoot = join(root, 'packages', directory);
    const {stdout} = await runCommand(
      'pnpm',
      ['pack', '--pack-destination', destination, '--json'],
      {cwd: packageRoot, label: `pack @tileflow/${directory}`},
    );
    const parsed = JSON.parse(stdout);
    const results = Array.isArray(parsed) ? parsed : [parsed];
    assert.equal(results.length, 1, `Unexpected pnpm pack result for @tileflow/${directory}.`);
    assert.equal(
      typeof results[0]?.filename,
      'string',
      `pnpm pack did not return a filename for @tileflow/${directory}.`,
    );
    tarballs.push(
      results[0].filename.startsWith('/')
        ? results[0].filename
        : join(destination, results[0].filename),
    );
  }

  await writeFile(listPath, `${tarballs.join('\n')}\n`);
  await readTarballsByName(tarballs);
  return tarballs;
}

export async function createReleasePlan({sourceSha, registryState, candidateTarballs}) {
  assert.match(sourceSha, commitPattern, 'Release source must be a full lowercase commit SHA.');
  await validateRegistryState(registryState);
  const candidates = await readTarballsByName(candidateTarballs);
  validatePublicManifests(candidates);
  const registryByName = new Map(registryState.packages.map((entry) => [entry.name, entry]));
  const packages = [];

  for (const name of publicPackageNames) {
    const baseline = registryByName.get(name);
    assert.equal(
      candidates.get(name).manifest.version,
      baseline.version,
      `${name} candidate version does not match its registry baseline.`,
    );
    const comparison = await comparePackageTarballs(
      candidates.get(name).tarball,
      baseline.tarball,
      {mode: 'material'},
    );
    if (comparison.equal) continue;
    packages.push({
      name,
      from: baseline.version,
      to: nextAlphaVersion(baseline.version),
      differences: comparison.differences,
    });
  }

  const effectiveVersions = new Map(
    registryState.packages.map(({name, version}) => [name, version]),
  );
  for (const release of packages) effectiveVersions.set(release.name, release.to);
  for (const release of packages) {
    release.runtimeDependencies = targetRuntimeDependencySnapshot(
      release.name,
      runtimeDependencySnapshot(candidates.get(release.name).manifest),
      effectiveVersions,
    );
  }

  const plan = {
    schemaVersion: 2,
    channel: 'alpha',
    sourceSha,
    baselines: registryState.packages.map(({name, runtimeDependencies, version}) => ({
      name,
      runtimeDependencies,
      version,
    })),
    packages,
  };
  validateReleasePlan(plan);
  return plan;
}

export function validateReleasePlan(plan) {
  assert.equal(plan?.schemaVersion, 2, 'Unsupported automatic-release plan schema.');
  assert.equal(plan.channel, 'alpha', 'Automatic releases must use the alpha channel.');
  assert.match(plan.sourceSha ?? '', commitPattern, 'Release plan has an invalid source SHA.');
  assert.deepEqual(
    plan.baselines?.map(({name}) => name),
    publicPackageNames,
    'Release plan baselines must contain every public package in repository order.',
  );
  const baselineByName = new Map();
  for (const baseline of plan.baselines) {
    assert.equal(
      baselineByName.has(baseline.name),
      false,
      `Duplicate release baseline: ${baseline.name}.`,
    );
    nextAlphaVersion(baseline.version);
    validateRuntimeDependencySnapshot(baseline.name, baseline.runtimeDependencies);
    baselineByName.set(baseline.name, baseline.version);
  }

  assert.ok(Array.isArray(plan.packages), 'Release plan packages must be an array.');
  assert.deepEqual(
    plan.packages.map(({name}) => name),
    publicPackageNames.filter((name) => plan.packages.some((entry) => entry.name === name)),
    'Release packages must be unique and use dependency-safe repository order.',
  );
  for (const entry of plan.packages) {
    assert.ok(publicPackageNameSet.has(entry.name), `Unknown release package: ${entry.name}.`);
    assert.equal(
      entry.from,
      baselineByName.get(entry.name),
      `${entry.name} previous version does not match its registry baseline.`,
    );
    assert.equal(
      entry.to,
      nextAlphaVersion(entry.from),
      `${entry.name} must advance to its next numeric alpha.`,
    );
    assert.ok(
      Array.isArray(entry.differences) &&
        entry.differences.length > 0 &&
        entry.differences.every((difference) => typeof difference === 'string' && difference),
      `${entry.name} must record its material artifact differences.`,
    );
  }
  const effectiveVersions = new Map(plan.baselines.map(({name, version}) => [name, version]));
  for (const entry of plan.packages) effectiveVersions.set(entry.name, entry.to);
  for (const entry of plan.packages) {
    assertSelectedRuntimeDependencies(entry.name, entry.runtimeDependencies, effectiveVersions);
  }
  return plan;
}

export async function validateFinalRelease({
  plan,
  registryState,
  finalTarballs,
  root = repositoryRoot,
}) {
  validateReleasePlan(plan);
  await validateRegistryState(registryState);
  assert.deepEqual(
    plan.baselines,
    registryState.packages.map(({name, runtimeDependencies, version}) => ({
      name,
      runtimeDependencies,
      version,
    })),
    'Release plan registry baselines changed before final validation.',
  );
  const manifests = await readPublicManifests(root);
  validatePublicManifests(manifests);
  const finalByName = await readTarballsByName(finalTarballs);
  const registryByName = new Map(registryState.packages.map((entry) => [entry.name, entry]));
  const versions = versionMapFromDocument(plan);
  const selected = new Set(plan.packages.map(({name}) => name));
  const releaseByName = new Map(plan.packages.map((release) => [release.name, release]));
  const baselineByName = new Map(plan.baselines.map((baseline) => [baseline.name, baseline]));

  for (const name of publicPackageNames) {
    const final = finalByName.get(name);
    assert.equal(final.manifest.version, versions.get(name), `${name} final version mismatch.`);
    const comparison = await comparePackageTarballs(
      final.tarball,
      registryByName.get(name).tarball,
      {mode: 'material'},
    );
    assert.equal(
      comparison.equal,
      !selected.has(name),
      selected.has(name)
        ? `${name} was selected without a material artifact change.`
        : `${name} changed materially without being selected: ${comparison.differences.join(', ')}.`,
    );

    const finalRuntimeDependencies = runtimeDependencySnapshot(final.manifest);
    if (selected.has(name)) {
      assert.deepEqual(
        finalRuntimeDependencies,
        releaseByName.get(name).runtimeDependencies,
        `${name} final internal dependency topology differs from its release plan.`,
      );
      assertSelectedRuntimeDependencies(name, finalRuntimeDependencies, versions);
    } else {
      assert.deepEqual(
        finalRuntimeDependencies,
        baselineByName.get(name).runtimeDependencies,
        `${name} is unselected and must preserve its published internal dependency ranges.`,
      );
    }
  }
}

export function assertSelectedRuntimeDependencies(name, snapshot, versions) {
  validateRuntimeDependencySnapshot(name, snapshot);
  for (const group of runtimeDependencyGroups) {
    for (const [dependency, range] of Object.entries(snapshot[group] ?? {})) {
      const dependencyVersion = versions.get(dependency);
      assert.ok(dependencyVersion, `${name} has no release version for ${dependency}.`);
      assert.equal(
        range,
        automaticInternalRuntimeRange(dependencyVersion),
        `${name} must floor ${dependency} at its effective release version.`,
      );
    }
  }
}

function targetRuntimeDependencySnapshot(name, snapshot, versions) {
  validateRuntimeDependencySnapshot(name, snapshot);
  const target = {};
  for (const group of runtimeDependencyGroups) {
    const dependencies = snapshot[group];
    if (!dependencies) continue;
    target[group] = {};
    for (const dependency of Object.keys(dependencies)) {
      const dependencyVersion = versions.get(dependency);
      assert.ok(dependencyVersion, `${name} has no release version for ${dependency}.`);
      target[group][dependency] = automaticInternalRuntimeRange(dependencyVersion);
    }
  }
  return target;
}

export function renderReleaseSummary(plan) {
  validateReleasePlan(plan);
  const lines = ['## npm alpha reconciliation', '', `Source: \`${plan.sourceSha}\``, ''];
  if (plan.packages.length === 0) {
    lines.push('All public package artifacts already match npm.');
  } else {
    lines.push('| Package | From | To | Material differences |', '| --- | --- | --- | --- |');
    for (const release of plan.packages) {
      const differences = release.differences.map((value) => `\`${value}\``).join(', ');
      lines.push(
        `| \`${release.name}\` | \`${release.from}\` | \`${release.to}\` | ${differences} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function readTarballsByName(tarballs) {
  assert.equal(
    tarballs.length,
    publicPackageNames.length,
    `Expected ${publicPackageNames.length} packed public packages.`,
  );
  const byName = new Map();
  for (const tarball of tarballs) {
    const manifest = await readTarballManifest(tarball);
    assert.ok(publicPackageNameSet.has(manifest.name), `Unexpected package: ${manifest.name}.`);
    assert.equal(byName.has(manifest.name), false, `Duplicate tarball for ${manifest.name}.`);
    byName.set(manifest.name, {manifest, tarball: resolve(tarball)});
  }
  assert.deepEqual(
    [...byName.keys()].sort(),
    [...publicPackageNames].sort(),
    'Packed public package set is incomplete.',
  );
  return byName;
}

async function readTarballManifest(tarball) {
  const {stdout} = await execFileAsync('tar', ['-xOf', resolve(tarball), 'package/package.json'], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function versionMapFromDocument(document) {
  if (document?.schemaVersion === 2 && document.channel === 'alpha') {
    validateReleasePlan(document);
    const versions = new Map(document.baselines.map(({name, version}) => [name, version]));
    for (const release of document.packages) versions.set(release.name, release.to);
    return versions;
  }

  assert.equal(document?.schemaVersion, 2, 'Unsupported registry-state schema.');
  assert.deepEqual(
    document.packages?.map(({name}) => name),
    publicPackageNames,
    'Registry state must contain every public package in repository order.',
  );
  return new Map(document.packages.map(({name, version}) => [name, version]));
}

function nonEmptyLines(value) {
  return value.split('\n').filter(Boolean);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate-source') {
    assert.equal(args.length, 0, 'validate-source accepts no arguments.');
    await validateSourceManifests();
    console.log('Validated development manifests for all public packages.');
    return;
  }
  if (command === 'registry') {
    assert.equal(args.length, 2, 'registry expects an input TSV and output JSON path.');
    const state = await createRegistryState(await readFile(resolve(args[0]), 'utf8'));
    await writeFile(resolve(args[1]), `${JSON.stringify(state, null, 2)}\n`);
    console.log(`Recorded ${state.packages.length} npm alpha baselines.`);
    return;
  }
  if (command === 'apply') {
    assert.equal(args.length, 1, 'apply expects a registry state or release plan.');
    await applyReleaseVersions(JSON.parse(await readFile(resolve(args[0]), 'utf8')));
    console.log('Applied ephemeral package versions.');
    return;
  }
  if (command === 'pack') {
    assert.equal(args.length, 2, 'pack expects a destination and tarball-list path.');
    const tarballs = await packAllPackages(args[0], args[1]);
    console.log(`Packed ${tarballs.length} public packages.`);
    return;
  }
  if (command === 'plan') {
    assert.equal(
      args.length,
      4,
      'plan expects source SHA, registry state, candidate list, and output path.',
    );
    const plan = await createReleasePlan({
      sourceSha: args[0],
      registryState: JSON.parse(await readFile(resolve(args[1]), 'utf8')),
      candidateTarballs: nonEmptyLines(await readFile(resolve(args[2]), 'utf8')),
    });
    await writeFile(resolve(args[3]), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Selected ${plan.packages.length} materially changed package(s).`);
    return;
  }
  if (command === 'validate') {
    assert.equal(args.length, 3, 'validate expects a plan, registry state, and final list.');
    const plan = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
    await validateFinalRelease({
      plan,
      registryState: JSON.parse(await readFile(resolve(args[1]), 'utf8')),
      finalTarballs: nonEmptyLines(await readFile(resolve(args[2]), 'utf8')),
    });
    console.log(`Validated ${plan.packages.length} automatic release package(s).`);
    return;
  }
  if (command === 'summary') {
    assert.equal(args.length, 1, 'summary expects a release plan.');
    const summary = renderReleaseSummary(JSON.parse(await readFile(resolve(args[0]), 'utf8')));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const {appendFile} = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    } else {
      process.stdout.write(summary);
    }
    return;
  }
  assert.fail(`Unknown reconcile-release command: ${command ?? '<missing>'}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
