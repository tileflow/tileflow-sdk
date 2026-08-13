import assert from 'node:assert/strict';
import semver from 'semver';

export const developmentVersion = '0.0.0-development';
export const internalRuntimeRange = '>=0.1.0-alpha.16 <0.1.0-beta.0';
export const internalWorkspaceRuntimeRange = `workspace:${internalRuntimeRange}`;
export const internalRuntimeUpperBound = '0.1.0-beta.0';
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
export const runtimeDependencyGroups = ['dependencies', 'optionalDependencies', 'peerDependencies'];

const numericAlphaPattern =
  /^((?:0|[1-9]\d*))\.((?:0|[1-9]\d*))\.((?:0|[1-9]\d*))-alpha\.((?:0|[1-9]\d*))$/u;
const automaticAlphaRangePattern =
  /^>=((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-alpha\.(?:0|[1-9]\d*)) <0\.1\.0-beta\.0$/u;

export function parseNumericAlpha(value) {
  const match = numericAlphaPattern.exec(value ?? '');
  assert.ok(match, `Expected a numeric alpha version, found ${value ?? '<missing>'}.`);
  assert.equal(
    semver.valid(value),
    value,
    `Expected a canonical numeric alpha version, found ${value}.`,
  );
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Number(match[4]),
  };
}

export function nextAlphaVersion(value) {
  const parsed = parseNumericAlpha(value);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-alpha.${parsed.prerelease + 1}`;
}

export function automaticInternalRuntimeRange(version) {
  const parsed = parseNumericAlpha(version);
  assert.deepEqual(
    [parsed.major, parsed.minor, parsed.patch],
    [0, 1, 0],
    `Automatic internal ranges only support 0.1.0 alpha versions, found ${version}.`,
  );
  return `>=${version} <${internalRuntimeUpperBound}`;
}

export function validatePublishedInternalRuntimeRange(range) {
  if (numericAlphaPattern.test(range ?? '')) {
    parseNumericAlpha(range);
    return 'legacy-exact';
  }

  const match = automaticAlphaRangePattern.exec(range ?? '');
  assert.ok(
    match,
    `Expected an exact alpha or an automatic alpha-only range, found ${range ?? '<missing>'}.`,
  );
  assert.equal(
    automaticInternalRuntimeRange(match[1]),
    range,
    `Invalid automatic internal runtime range: ${range}.`,
  );
  return 'automatic-range';
}

export function runtimeDependencySnapshot(manifest) {
  const snapshot = {};
  for (const group of runtimeDependencyGroups) {
    const dependencies = {};
    for (const dependency of publicPackageNames) {
      const range = manifest[group]?.[dependency];
      if (range !== undefined) dependencies[dependency] = range;
    }
    if (Object.keys(dependencies).length > 0) snapshot[group] = dependencies;
  }
  return snapshot;
}

export function validateRuntimeDependencySnapshot(name, snapshot) {
  assert.ok(
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot),
    `${name} runtime dependency snapshot must be an object.`,
  );
  assert.deepEqual(
    Object.keys(snapshot),
    runtimeDependencyGroups.filter((group) => Object.keys(snapshot[group] ?? {}).length > 0),
    `${name} runtime dependency groups must use canonical order.`,
  );

  for (const group of runtimeDependencyGroups) {
    const dependencies = snapshot[group] ?? {};
    assert.ok(
      dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies),
      `${name} ${group} snapshot must be an object.`,
    );
    assert.deepEqual(
      Object.keys(dependencies),
      publicPackageNames.filter((dependency) => dependencies[dependency] !== undefined),
      `${name} ${group} dependencies must use canonical order.`,
    );
    for (const [dependency, range] of Object.entries(dependencies)) {
      assert.ok(
        publicPackageNameSet.has(dependency),
        `${name} has unknown dependency ${dependency}.`,
      );
      assert.ok(
        publicPackageNames.indexOf(dependency) < publicPackageNames.indexOf(name),
        `${dependency} must precede its dependent ${name} in publication order.`,
      );
      validatePublishedInternalRuntimeRange(range);
    }
  }
  return snapshot;
}

export function packageNameForDirectory(directory) {
  const index = packageDirectories.indexOf(directory);
  assert.notEqual(index, -1, `Unknown public package directory: ${directory}.`);
  return publicPackageNames[index];
}

export function validatePublicManifests(manifests, {source = false} = {}) {
  assert.ok(manifests instanceof Map, 'Public manifests must be a Map.');
  assert.deepEqual(
    [...manifests.keys()],
    publicPackageNames,
    'Public manifests must use dependency-safe repository order.',
  );

  for (const [name, entry] of manifests) {
    const manifest = entry.manifest ?? entry;
    assert.equal(manifest.name, name, `${name} manifest name mismatch.`);
    if (source) {
      assert.equal(
        manifest.version,
        developmentVersion,
        `${name} source version must be ${developmentVersion}.`,
      );
    } else {
      parseNumericAlpha(manifest.version);
    }

    assert.equal(manifest.private, undefined, `${name} must remain publishable.`);
    assert.equal(manifest.publishConfig?.access, 'public', `${name} must publish publicly.`);
    assert.equal(
      manifest.repository?.url,
      'git+https://github.com/tileflow/tileflow-sdk.git',
      `${name} repository mismatch.`,
    );
    assert.equal(
      manifest.bugs?.url,
      'https://github.com/tileflow/tileflow-sdk/issues',
      `${name} issue tracker mismatch.`,
    );

    for (const group of runtimeDependencyGroups) {
      for (const [dependency, range] of Object.entries(manifest[group] ?? {})) {
        if (!publicPackageNameSet.has(dependency)) continue;
        if (source) {
          assert.equal(
            range,
            internalWorkspaceRuntimeRange,
            `${name} must use ${internalWorkspaceRuntimeRange} for runtime dependency ${dependency}.`,
          );
        } else {
          validatePublishedInternalRuntimeRange(range);
        }
        assert.ok(
          publicPackageNames.indexOf(dependency) < publicPackageNames.indexOf(name),
          `${dependency} must precede its dependent ${name} in publication order.`,
        );
      }
    }

    for (const [dependency, range] of Object.entries(manifest.devDependencies ?? {})) {
      if (!publicPackageNameSet.has(dependency)) continue;
      if (source) {
        assert.ok(
          range === 'workspace:*' || range === internalWorkspaceRuntimeRange,
          `${name} has unsupported development-only range ${range} for ${dependency}.`,
        );
      }
    }
  }
}

export function orderPublicPackages(names) {
  const unique = new Set(names);
  assert.equal(unique.size, names.length, 'Release package names must be unique.');
  for (const name of unique) {
    assert.ok(publicPackageNameSet.has(name), `Unknown public package: ${name}.`);
  }
  return publicPackageNames.filter((name) => unique.has(name));
}
