import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {satisfies} from 'semver';
import {assertPublicWorkspaceManifest} from '../test-support/public-workspace-manifest.mjs';
import {
  automaticInternalRuntimeRange,
  developmentVersion,
  initialVersionByPackageName,
  internalRuntimeRange,
  internalWorkspaceRuntimeRange,
  nextAlphaVersion,
  packageLegalFileNames,
  packageNameForDirectory,
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
  assert.equal(initialVersionByPackageName.get('@tileflow/react-native'), '0.1.0-alpha.0');
  assert.equal(packageNameForDirectory('react-native'), '@tileflow/react-native');
  assert.ok(
    publicPackageNames.indexOf('@tileflow/react-native') >
      publicPackageNames.indexOf('@tileflow/interactions'),
  );
  assert.equal(initialVersionByPackageName.get('@tileflow/geoip'), '0.1.0-alpha.0');
  assert.equal(initialVersionByPackageName.get('@tileflow/search'), '0.1.0-alpha.0');
  assert.equal(initialVersionByPackageName.get('tileflow'), '0.1.0-alpha.0');
  assert.equal(packageNameForDirectory('cli'), 'tileflow');
  assert.deepEqual(
    publicPackageNames.filter((name) => !name.startsWith('@tileflow/')),
    ['tileflow'],
  );
  assert.equal(publicPackageNames.includes('@tileflow/cli'), false);
  assert.equal(new Set(publicPackageCatalog.map(({name}) => name)).size, publicPackageNames.length);
});

test('React Native is publishable without shipping development tests or widening its peers', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../packages/react-native/package.json', import.meta.url), 'utf8'),
  );
  assertPublicWorkspaceManifest('@tileflow/react-native', manifest);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  assert.deepEqual(manifest.peerDependencies, {
    '@maplibre/maplibre-react-native': '11.3.10',
    react: '19.2.0',
    'react-native': '0.83.10',
  });
  assert.ok(manifest.files.includes('android/src/main'));
  assert.ok(manifest.files.includes('TileflowNativeAdmission.podspec'));
  assert.ok(manifest.files.includes('react-native.config.cjs'));
  assert.ok(!manifest.files.includes('android/src'));
  assert.ok(!manifest.files.some((path) => /(?:^|\/)(?:test|tests|harness)(?:\/|$)/iu.test(path)));
});

test('workspace package checks remain strict before and after release materialization', () => {
  const name = '@tileflow/react-native';
  const source = fixtureManifests().get(name).manifest;
  source.dependencies = {'@tileflow/core': internalWorkspaceRuntimeRange};
  assertPublicWorkspaceManifest(name, source);
  assert.throws(() =>
    assertPublicWorkspaceManifest(name, {
      ...source,
      dependencies: {'@tileflow/core': 'workspace:*'},
    }),
  );

  const released = {
    ...source,
    version: '0.1.0-alpha.0',
    dependencies: {
      '@tileflow/core': `workspace:${automaticInternalRuntimeRange('0.1.0-alpha.42')}`,
    },
  };
  const original = structuredClone(released);
  assertPublicWorkspaceManifest(name, released);
  assert.deepEqual(released, original);

  for (const version of ['0.0.0-bootstrap.0', '0.1.0', '0.1.0-beta.0'])
    assert.throws(() => assertPublicWorkspaceManifest(name, {...released, version}));

  for (const range of [
    'workspace:*',
    automaticInternalRuntimeRange('0.1.0-alpha.42'),
    'workspace:>=0.1.0-alpha.42 <0.1.0',
  ])
    assert.throws(() =>
      assertPublicWorkspaceManifest(name, {...released, dependencies: {'@tileflow/core': range}}),
    );
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

test('requires Apache-2.0 metadata and the packaged license', () => {
  const missingLicense = fixtureManifests();
  delete missingLicense.get('@tileflow/core').manifest.license;
  assert.throws(
    () => validatePublicManifests(missingLicense, {source: true}),
    /must declare Apache-2\.0/u,
  );

  const missingLicenseFile = fixtureManifests();
  missingLicenseFile.get('@tileflow/core').manifest.files = [];
  assert.throws(
    () => validatePublicManifests(missingLicenseFile, {source: true}),
    /must pack LICENSE/u,
  );
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
