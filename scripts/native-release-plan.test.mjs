import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {reservationIndexKey} from './native-maven-repository.mjs';
import {mavenArtifactDirectory, readNativeReleaseCatalog} from './native-release-config.mjs';
import {mavenVersions, planNativeRelease} from './native-release-plan.mjs';

const catalog = await readNativeReleaseCatalog();
const first = '0.1.0-alpha.0';
const second = '0.1.0-alpha.1';

function metadata(artifactId, versions) {
  return `<metadata>
  <groupId>${catalog.maven.group}</groupId>
  <artifactId>${artifactId}</artifactId>
  <versioning><versions>${versions.map((version) => `<version>${version}</version>`).join('')}</versions></versioning>
</metadata>`;
}

function mavenRepository(listings, reservationIndex) {
  const files = new Map(
    Object.entries(listings).map(([artifactId, source]) => [
      `${catalog.maven.repositoryUrl}/${mavenArtifactDirectory(catalog, artifactId)}/maven-metadata.xml`,
      source,
    ]),
  );
  if (reservationIndex !== undefined) {
    files.set(
      `${catalog.maven.repositoryUrl}/${reservationIndexKey}`,
      JSON.stringify(reservationIndex),
    );
  }
  return async (url) =>
    files.has(url) ? new Response(files.get(url)) : new Response(null, {status: 404});
}

test('the version planner rejects malformed or unexpected public Maven metadata', async () => {
  for (const source of [
    '<html><body>Unexpected service response</body></html>',
    metadata('other-artifact', [first]),
    metadata('tileflow', [first, first]),
    metadata('tileflow', ['1.0.0']),
    metadata('tileflow', [first]).replace('</versions>', ''),
  ]) {
    await assert.rejects(
      mavenVersions(catalog, {fetch: mavenRepository({tileflow: source})}),
      /maven-metadata\.xml/u,
    );
  }
});

async function swiftRepository(t, versions = []) {
  const swiftRemote = await mkdtemp(join(tmpdir(), 'tileflow-native-version-test-'));
  t.after(() => rm(swiftRemote, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', swiftRemote, ...args]);
  git('init', '--quiet');
  git(
    '-c',
    'user.name=Tileflow',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'Fixture',
  );
  for (const version of versions) git('-c', 'tag.gpgSign=false', 'tag', version);
  return swiftRemote;
}

test('a Swift tag and only some Maven listings leave the version incomplete', async (t) => {
  const swiftRemote = await swiftRepository(t, [first, second]);

  const listings = Object.fromEntries(
    catalog.maven.publications.map(({artifactId}) => [
      artifactId,
      metadata(artifactId, artifactId === 'tileflow' ? [first, second] : [first]),
    ]),
  );
  const plan = await planNativeRelease({
    catalog,
    sourceRevision: 'a'.repeat(40),
    swiftRemote,
    request: mavenRepository(listings),
  });
  assert.equal(plan.version, '0.1.0-alpha.2');
  assert.equal(plan.previousVersion, second);
  assert.deepEqual(plan.incompleteVersions, [second]);
});

test('a fresh workflow advances past a reservation without Maven listings', async (t) => {
  const swiftRemote = await swiftRepository(t, [first, second]);
  const listings = Object.fromEntries(
    catalog.maven.publications.map(({artifactId}) => [artifactId, metadata(artifactId, [first])]),
  );
  const third = '0.1.0-alpha.2';
  const reservationIndex = {
    schemaVersion: 1,
    group: catalog.maven.group,
    versions: [second, third],
  };
  const plan = await planNativeRelease({
    catalog,
    sourceRevision: 'a'.repeat(40),
    swiftRemote,
    request: mavenRepository(listings, reservationIndex),
  });
  assert.equal(plan.version, '0.1.0-alpha.3');
  assert.equal(plan.previousVersion, third);
  assert.deepEqual(plan.incompleteVersions, [second, third]);
});

test('an invalid reservation index blocks planning', async (t) => {
  const swiftRemote = await swiftRepository(t);
  await assert.rejects(
    planNativeRelease({
      catalog,
      sourceRevision: 'a'.repeat(40),
      swiftRemote,
      request: mavenRepository(
        {},
        {schemaVersion: 1, group: catalog.maven.group, versions: [first, first]},
      ),
    }),
    /Invalid Maven reservation index/u,
  );
});
