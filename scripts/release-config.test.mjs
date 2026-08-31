import assert from 'node:assert/strict';
import test from 'node:test';
import {satisfies} from 'semver';
import {
  automaticInternalRuntimeRange,
  developmentVersion,
  internalRuntimeRange,
  internalWorkspaceRuntimeRange,
  initialVersionByPackageName,
  nextAlphaVersion,
  packageNameForDirectory,
  packageLegalFileNames,
  publicLicenseIdentifier,
  publicPackageCatalog,
  publicPackageNames,
  validatePublicManifests,
  validatePublishedInternalRuntimeRange,
} from './release-config.mjs';

test('the public package catalog owns order and independent first versions', () => {
  assert.deepEqual(
    publicPackageCatalog.map(({name}) => name),
    publicPackageNames,
  );
  assert.equal(initialVersionByPackageName.get('@tileflow/maps'), '0.1.0-alpha.0');
  assert.equal(initialVersionByPackageName.get('@tileflow/interactions'), '0.1.0-alpha.0');
  assert.equal(initialVersionByPackageName.get('tileflow'), '0.1.0-alpha.0');
  assert.equal(packageNameForDirectory('cli'), 'tileflow');
  assert.deepEqual(
    publicPackageNames.filter((name) => !name.startsWith('@tileflow/')),
    ['tileflow'],
  );
  assert.equal(publicPackageNames.includes('@tileflow/cli'), false);
  assert.equal(new Set(publicPackageCatalog.map(({name}) => name)).size, publicPackageNames.length);
});

test('advances only the numeric alpha counter', () => {
  assert.equal(nextAlphaVersion('0.1.0-alpha.16'), '0.1.0-alpha.17');
  assert.equal(nextAlphaVersion('2.4.9-alpha.0'), '2.4.9-alpha.1');
  for (const invalid of ['0.1.0', '0.1.0-beta.1', '0.1.0-alpha', developmentVersion]) {
    assert.throws(() => nextAlphaVersion(invalid), /numeric alpha version/u);
  }
});

test('the shared runtime range accepts supported alphas but not beta or stable releases', () => {
  assert.equal(satisfies('0.1.0-alpha.16', internalRuntimeRange), true);
  assert.equal(satisfies('0.1.0-alpha.999', internalRuntimeRange), true);
  assert.equal(satisfies('0.1.0-beta.0', internalRuntimeRange), false);
  assert.equal(satisfies('0.1.0-rc.1', internalRuntimeRange), false);
  assert.equal(satisfies('0.1.0', internalRuntimeRange), false);
});

test('accepts legacy exact alphas and generated dynamic floors but rejects wider prerelease ranges', () => {
  const dynamic = automaticInternalRuntimeRange('0.1.0-alpha.42');
  assert.equal(dynamic, '>=0.1.0-alpha.42 <0.1.0-beta.0');
  assert.equal(validatePublishedInternalRuntimeRange('0.1.0-alpha.16'), 'legacy-exact');
  assert.equal(validatePublishedInternalRuntimeRange(dynamic), 'automatic-range');
  for (const invalid of [
    '0.1.0-beta.0',
    '0.1.0-rc.1',
    '0.1.0',
    '>=0.1.0-alpha.16 <0.1.0',
    '>=0.1.0-alpha.16 <0.1.0-rc.0',
    '0.1.0-alpha.01',
    '01.1.0-alpha.1',
    '>=0.1.0-alpha.01 <0.1.0-beta.0',
  ]) {
    assert.throws(() => validatePublishedInternalRuntimeRange(invalid));
  }
});

test('accepts development source manifests and dependency-safe runtime ranges', () => {
  const manifests = fixtureManifests();
  manifests.get('@tileflow/dev').manifest.dependencies = {
    '@tileflow/core': internalWorkspaceRuntimeRange,
  };
  manifests.get('@tileflow/capture').manifest.devDependencies = {'@tileflow/react': 'workspace:*'};
  validatePublicManifests(manifests, {source: true});
});

test('rejects exact internal runtime pins, release versions in source, and reversed topology', () => {
  const exact = fixtureManifests();
  exact.get('@tileflow/dev').manifest.dependencies = {'@tileflow/core': 'workspace:*'};
  assert.throws(
    () => validatePublicManifests(exact, {source: true}),
    /workspace:>=0\.1\.0-alpha\.16 <0\.1\.0-beta\.0/u,
  );

  const released = fixtureManifests();
  released.get('@tileflow/core').manifest.version = '0.1.0-alpha.16';
  assert.throws(() => validatePublicManifests(released, {source: true}), /source version/u);

  const reversed = fixtureManifests();
  reversed.get('@tileflow/core').manifest.dependencies = {
    '@tileflow/static': internalWorkspaceRuntimeRange,
  };
  assert.throws(() => validatePublicManifests(reversed, {source: true}), /must precede/u);
});

test('requires Apache-2.0 metadata and every legal distribution file', () => {
  const missingLicense = fixtureManifests();
  delete missingLicense.get('@tileflow/core').manifest.license;
  assert.throws(
    () => validatePublicManifests(missingLicense, {source: true}),
    /must declare Apache-2\.0/u,
  );

  const missingNotice = fixtureManifests();
  missingNotice.get('@tileflow/core').manifest.files = packageLegalFileNames.filter(
    (name) => name !== 'NOTICE',
  );
  assert.throws(() => validatePublicManifests(missingNotice, {source: true}), /must pack NOTICE/u);
});

function fixtureManifests() {
  return new Map(
    publicPackageNames.map((name) => [
      name,
      {
        manifest: {
          name,
          version: developmentVersion,
          license: publicLicenseIdentifier,
          files: [...packageLegalFileNames],
          repository: {
            type: 'git',
            url: 'git+https://github.com/tileflow/tileflow-sdk.git',
          },
          bugs: {url: 'https://github.com/tileflow/tileflow-sdk/issues'},
          publishConfig: {access: 'public'},
        },
      },
    ]),
  );
}
