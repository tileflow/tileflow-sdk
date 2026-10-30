import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  centralPortal,
  centralReleaseState,
  verifyCentralFiles,
  waitForDeployment,
} from './native-central-portal.mjs';
import {
  createCentralBundle,
  primaryFileNames,
  validateModuleMetadata,
  validatePom,
  writeZip,
} from './native-maven-bundle.mjs';
import {
  compareAlphaVersions,
  planNativeVersion,
  readNativeReleaseCatalog,
  validateNativeReleaseCatalog,
} from './native-release-config.mjs';
import {mavenVersions} from './native-release-plan.mjs';
import {prepareSwiftRelease, publishSwiftRelease} from './native-swift-release.mjs';
import {readPublicReleaseBlockers} from './public-release-interlock.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = await readNativeReleaseCatalog();
const version = '0.1.0-alpha.3';
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-native-release-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function pom(artifactId, overrides = {}) {
  const publication = catalog.maven.publications.find((item) => item.artifactId === artifactId);
  const field = (name, value) =>
    overrides[name] === null ? '' : `<${name}>${overrides[name] ?? value}</${name}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <!-- do_not_remove: published-with-gradle-metadata -->
  <modelVersion>4.0.0</modelVersion>
  ${field('groupId', 'dev.tileflow')}
  ${field('artifactId', artifactId)}
  ${field('version', version)}
  <packaging>aar</packaging>
  ${field('name', publication.name)}
  ${field('description', publication.description.replaceAll("'", '&apos;'))}
  <url>${catalog.project.url}</url>
  <licenses><license><name>Apache License, Version 2.0</name><url>https://www.apache.org/licenses/LICENSE-2.0.txt</url></license></licenses>
  ${overrides.developers === null ? '' : '<developers><developer><id>tileflow</id><name>Tileflow</name></developer></developers>'}
  <scm>
    <url>${catalog.project.url}</url>
    ${field('connection', 'scm:git:https://github.com/tileflow/tileflow-sdk.git')}
    <developerConnection>scm:git:ssh://git@github.com/tileflow/tileflow-sdk.git</developerConnection>
  </scm>
  <dependencies>${overrides.dependencies ?? ''}</dependencies>
</project>
`;
}

const dependency = (groupId, artifactId, dependencyVersion) =>
  `<dependency><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${dependencyVersion}</version></dependency>`;

/** A Gradle-shaped unsigned candidate repository for every catalog artifact. */
async function candidateRepository(directory) {
  for (const {artifactId} of catalog.maven.publications) {
    const base = join(directory, 'dev/tileflow', artifactId, version);
    await mkdir(base, {recursive: true});
    const files = new Map();
    for (const name of primaryFileNames(artifactId, version)) {
      if (name.endsWith('.pom')) files.set(name, Buffer.from(pom(artifactId)));
      else if (!name.endsWith('.module')) {
        // A minimal zip: the local file header signature is what the validator checks.
        files.set(name, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(name)]));
      }
    }
    const moduleName = `${artifactId}-${version}.module`;
    const aar = `${artifactId}-${version}.aar`;
    files.set(
      moduleName,
      Buffer.from(
        JSON.stringify({
          formatVersion: '1.1',
          component: {group: 'dev.tileflow', module: artifactId, version},
          variants: [
            {
              name: 'releaseRuntimeElements',
              files: [
                {
                  name: aar,
                  url: aar,
                  size: files.get(aar).length,
                  sha512: digest('sha512', files.get(aar)),
                  sha256: digest('sha256', files.get(aar)),
                  sha1: digest('sha1', files.get(aar)),
                  md5: digest('md5', files.get(aar)),
                },
              ],
            },
          ],
        }),
      ),
    );
    for (const [name, bytes] of files) {
      await writeFile(join(base, name), bytes);
      await writeFile(join(base, `${name}.sha1`), digest('sha1', bytes));
    }
    await writeFile(
      join(directory, 'dev/tileflow', artifactId, 'maven-metadata.xml'),
      '<metadata/>',
    );
  }
}

test('the release catalog matches the Gradle libraries that publish', async () => {
  const settings = await readFile(join(root, 'platforms/android/settings.gradle.kts'), 'utf8');
  const included = [...settings.matchAll(/include\(":([a-z-]+)"\)/gu)].map((match) => match[1]);
  const publishing = [];
  for (const item of await readdir(join(root, 'platforms/android'), {withFileTypes: true})) {
    if (!item.isDirectory()) continue;
    const build = await readFile(
      join(root, 'platforms/android', item.name, 'build.gradle.kts'),
      'utf8',
    ).catch(() => '');
    if (build.includes('gradle/publishing.gradle.kts')) publishing.push(item.name);
  }
  const modules = catalog.maven.publications.map((item) => item.module);
  assert.deepEqual([...publishing].sort(), [...modules].sort());
  assert.ok(modules.every((module) => included.includes(module)));
  assert.equal(catalog.maven.publications[0].artifactId, 'tileflow-sdk');
  assert.throws(
    () => validateNativeReleaseCatalog({...catalog, initialVersion: '1.0.0'}),
    /initialVersion/u,
  );
});

test('one alpha version names every native artifact and advances from what is public', () => {
  const initialVersion = '0.1.0-alpha.0';
  assert.deepEqual(planNativeVersion({initialVersion, swiftVersions: [], mavenVersions: []}), {
    from: null,
    to: initialVersion,
    incomplete: [],
  });
  assert.deepEqual(
    planNativeVersion({
      initialVersion,
      swiftVersions: ['0.1.0-alpha.0', '0.1.0-alpha.1', '0.1.0-alpha.10'],
      mavenVersions: ['0.1.0-alpha.0', '0.1.0-alpha.1', '0.1.0-alpha.9'],
    }),
    {from: '0.1.0-alpha.10', to: '0.1.0-alpha.11', incomplete: ['0.1.0-alpha.9', '0.1.0-alpha.10']},
  );
  assert.throws(
    () => planNativeVersion({initialVersion, swiftVersions: ['v0.1.0'], mavenVersions: []}),
    /X\.Y\.Z-alpha\.N; found v0\.1\.0/u,
  );
  assert.ok(compareAlphaVersions('0.2.0-alpha.0', '0.1.0-alpha.9') > 0);
});

test('reads published Maven versions and treats a missing artifact as unpublished', async () => {
  const requested = [];
  const versions = await mavenVersions(catalog, {
    baseUrl: 'https://repository.test',
    fetch: async (url) => {
      requested.push(url);
      if (url.includes('/tileflow-sdk/')) {
        return new Response(
          '<metadata><versioning><versions><version>0.1.0-alpha.0</version><version>0.1.0-alpha.1</version></versions></versioning></metadata>',
        );
      }
      return new Response('', {status: 404});
    },
  });
  assert.deepEqual(versions.sort(), ['0.1.0-alpha.0', '0.1.0-alpha.1']);
  assert.equal(requested.length, catalog.maven.publications.length);
  await assert.rejects(
    mavenVersions(catalog, {fetch: async () => new Response('', {status: 503})}),
    /answered 503/u,
  );
});

test('POMs must carry the metadata Maven Central requires and exact release dependencies', () => {
  const options = {catalog, artifactId: 'tileflow-search', version};
  assert.deepEqual(validatePom(pom('tileflow-search'), options), []);
  assert.deepEqual(
    validatePom(
      pom('tileflow-search', {
        dependencies: dependency('dev.tileflow', 'tileflow-configuration', version),
      }),
      options,
    ),
    [],
  );
  const problems = (overrides) =>
    validatePom(pom('tileflow-search', overrides), options).join('\n');
  assert.match(problems({developers: null}), /developers need a name/u);
  assert.match(problems({connection: null}), /scm connection is required/u);
  assert.match(problems({version: '0.1.0-alpha.2'}), /version must be 0\.1\.0-alpha\.3/u);
  assert.match(problems({name: 'Search'}), /name must match/u);
  assert.match(
    problems({dependencies: dependency('dev.tileflow', 'tileflow-configuration', '0.1.0-alpha.2')}),
    /tileflow-configuration must use 0\.1\.0-alpha\.3/u,
  );
  assert.match(
    problems({dependencies: dependency('dev.tileflow', 'tileflow-internal', version)}),
    /not a published artifact/u,
  );
  assert.match(
    problems({dependencies: dependency('com.example', 'library', '1.0-SNAPSHOT')}),
    /non-exact version/u,
  );
  assert.match(
    problems({dependencies: dependency('com.example', 'library', '[1.0,2.0)')}),
    /non-exact/u,
  );
});

test('Gradle module metadata must describe the exact released files', () => {
  const bytes = Buffer.from('aar bytes');
  const name = `tileflow-search-${version}.aar`;
  const metadata = (file) =>
    JSON.stringify({
      component: {group: 'dev.tileflow', module: 'tileflow-search', version},
      variants: [{name: 'release', files: [file]}],
    });
  const file = {
    name,
    url: name,
    size: bytes.length,
    sha1: digest('sha1', bytes),
    sha256: digest('sha256', bytes),
    sha512: digest('sha512', bytes),
  };
  const options = {catalog, artifactId: 'tileflow-search', version};
  assert.deepEqual(validateModuleMetadata(metadata(file), new Map([[name, bytes]]), options), []);
  assert.match(
    validateModuleMetadata(metadata({...file, size: 1}), new Map([[name, bytes]]), options).join(),
    /digests differ/u,
  );
  assert.match(validateModuleMetadata(metadata(file), new Map(), options).join(), /missing/u);
});

test('the Central bundle signs and checksums every file and zips them deterministically', async (t) => {
  const directory = await temporary(t);
  const repository = join(directory, 'maven');
  await candidateRepository(repository);
  const signed = [];
  const bundle = (name) =>
    createCentralBundle({
      repository,
      catalog,
      version,
      staging: join(directory, `${name}-staging`),
      output: join(directory, `${name}.zip`),
      sign: async (path) => {
        signed.push(path);
        await writeFile(`${path}.asc`, `signature of ${digest('sha256', await readFile(path))}\n`);
      },
      verifySignature: async (path, signature) => ({
        ok: (await readFile(signature, 'utf8')).includes(digest('sha256', await readFile(path))),
        problem: 'does not match',
      }),
    });
  const first = await bundle('first');
  const second = await bundle('second');
  const files = catalog.maven.publications.length * 5;
  assert.equal(signed.length, files * 2);
  assert.equal(first.files, files * 6);
  assert.equal(first.sha256, second.sha256);
  const {stdout} = await run('unzip', ['-Z1', join(directory, 'first.zip')]);
  const entries = stdout.trim().split('\n');
  assert.equal(entries.length, files * 6);
  assert.ok(entries.every((entry) => entry.startsWith('dev/tileflow/')));
  assert.ok(!entries.some((entry) => entry.includes('maven-metadata')));
  const aar = `dev/tileflow/tileflow-sdk/${version}/tileflow-sdk-${version}.aar`;
  const {stdout: sha1} = await run('unzip', ['-p', join(directory, 'first.zip'), `${aar}.sha1`]);
  assert.equal(sha1, digest('sha1', await readFile(join(repository, aar))));
  await run('unzip', ['-tq', join(directory, 'first.zip')]);

  await writeFile(join(repository, 'dev/tileflow/tileflow-sdk/notes.txt'), 'unexpected');
  await assert.rejects(bundle('third'), /Unexpected file in Maven repository/u);
});

test('the zip writer produces archives that standard tools read', async (t) => {
  const directory = await temporary(t);
  const output = join(directory, 'archive.zip');
  await writeZip(output, [
    {name: 'b/file.txt', bytes: Buffer.from('second')},
    {name: 'a.txt', bytes: Buffer.alloc(100_000, 7)},
  ]);
  const {stdout} = await run('unzip', ['-Z1', output]);
  assert.deepEqual(stdout.trim().split('\n'), ['a.txt', 'b/file.txt']);
  const {stdout: content} = await run('unzip', ['-p', output, 'b/file.txt']);
  assert.equal(content, 'second');
  await assert.rejects(writeZip(output, []), /EEXIST/u);
});

test('the Central Portal client uses the user token and stops on rejected deployments', async () => {
  const calls = [];
  const states = ['PENDING', 'VALIDATING', 'FAILED'];
  const portal = centralPortal({
    username: 'user',
    password: 'secret',
    baseUrl: 'https://portal.test',
    fetch: async (url, init) => {
      calls.push({url, method: init.method, authorization: init.headers.authorization});
      if (url.includes('/published?')) {
        return Response.json({published: url.includes('name=tileflow-sdk')});
      }
      if (url.includes('/status?')) {
        return Response.json({deploymentState: states.shift(), errors: {pom: ['missing scm']}});
      }
      return new Response('', {status: 204});
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(await portal.published('dev.tileflow', 'tileflow-sdk', version), true);
  assert.equal(calls[0].authorization, `Bearer ${Buffer.from('user:secret').toString('base64')}`);
  assert.equal(
    calls[0].url,
    `https://portal.test/api/v1/publisher/published?namespace=dev.tileflow&name=tileflow-sdk&version=${version}`,
  );
  await assert.rejects(
    waitForDeployment(portal, 'deployment', 'VALIDATED', {timeoutMs: 10_000, intervalMs: 1}),
    /rejected deployment deployment:[\s\S]*missing scm/u,
  );
  await assert.rejects(centralReleaseState(portal, catalog, version), /only part of/u);
  assert.throws(() => centralPortal({username: '', password: ''}), /MAVEN_CENTRAL_TOKEN_USERNAME/u);
});

test('Maven Central verification compares the served bytes with the approved files', async (t) => {
  const directory = await temporary(t);
  await candidateRepository(directory);
  const served = async (url) => {
    const path = url.replace('https://repository.test/', '');
    return new Response(await readFile(join(directory, path)));
  };
  await verifyCentralFiles({
    catalog,
    version,
    repository: directory,
    baseUrl: 'https://repository.test',
    fetch: served,
    timeoutMs: 1_000,
  });
  await assert.rejects(
    verifyCentralFiles({
      catalog,
      version,
      repository: directory,
      baseUrl: 'https://repository.test',
      fetch: async () => new Response('other bytes'),
      timeoutMs: 1_000,
    }),
    /serves different bytes/u,
  );
});

test('the Swift release is one commit and tag pushed once, without force', async (t) => {
  const directory = await temporary(t);
  const remote = join(directory, 'tileflow-swift.git');
  await run('git', ['init', '--quiet', '--bare', remote]);
  const sourceRevision = (await run('git', ['rev-parse', 'HEAD'], {cwd: root})).stdout.trim();
  async function candidate(name, releaseVersion, content) {
    const path = join(directory, name);
    await mkdir(join(path, 'swift/Sources/Tileflow'), {recursive: true});
    const files = {
      'Package.swift': '// swift-tools-version: 6.0\n',
      'Sources/Tileflow/Map.swift': content,
      '.gitignore': '.build/\n',
    };
    for (const [file, text] of Object.entries(files))
      await writeFile(join(path, 'swift', file), text);
    await writeFile(
      join(path, 'candidate.json'),
      JSON.stringify({
        version: releaseVersion,
        sourceRevision,
        sourceDirty: false,
        runtime: {runtimeHash: 'a'.repeat(64)},
        swift: {
          path: 'swift',
          files: Object.fromEntries(Object.keys(files).map((file) => [file, ''])),
        },
      }),
    );
    return path;
  }
  const first = await candidate('first', '0.1.0-alpha.0', 'let first = 1\n');
  const release = await prepareSwiftRelease({
    candidate: first,
    output: join(first, 'release'),
    remote,
  });
  assert.equal(release.parent, null);
  const publish = (prepared, candidatePath) =>
    publishSwiftRelease({
      release: prepared,
      bundle: join(candidatePath, 'release/swift-release.bundle'),
      swift: join(candidatePath, 'swift'),
      remote,
      log: () => {},
    });
  assert.equal(await publish(release, first), 'new');
  assert.equal(await publish(release, first), 'published');
  await assert.rejects(
    prepareSwiftRelease({candidate: first, output: join(first, 'again'), remote}),
    /already has tag 0\.1\.0-alpha\.0/u,
  );

  const second = await candidate('second', '0.1.0-alpha.1', 'let second = 2\n');
  const next = await prepareSwiftRelease({
    candidate: second,
    output: join(second, 'release'),
    remote,
  });
  assert.equal(next.parent, release.commit);
  // A third release prepared on the same parent can no longer be pushed once the second lands.
  const third = await candidate('third', '0.1.0-alpha.2', 'let third = 3\n');
  const stale = await prepareSwiftRelease({
    candidate: third,
    output: join(third, 'release'),
    remote,
  });
  assert.equal(await publish(next, second), 'new');
  await assert.rejects(publish(stale, third), /main is .*; the release was prepared on/u);
  const tags = (await run('git', ['--git-dir', remote, 'tag', '--list'])).stdout.trim().split('\n');
  assert.deepEqual(tags, ['0.1.0-alpha.0', '0.1.0-alpha.1']);
  const log = (await run('git', ['--git-dir', remote, 'log', '--format=%an %s', 'main'])).stdout;
  assert.equal(
    log,
    'github-actions[bot] Tileflow 0.1.0-alpha.1\ngithub-actions[bot] Tileflow 0.1.0-alpha.0\n',
  );
});

test('the native release workflow confines credentials to the approved publish job', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/native-publish.yml', import.meta.url),
    'utf8',
  );
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  const publish = jobs.slice(jobs.indexOf('\n  publish:\n'));
  const beforePublish = jobs.slice(0, jobs.indexOf('\n  publish:\n'));

  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n\n/mu);
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch:\n\s+inputs:|^ {2}(?:push|schedule|pull_request):/mu,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /group: native-publish\n {2}cancel-in-progress: false/u);
  assert.doesNotMatch(beforePublish, /secrets\.|environment:/u);
  assert.equal((workflow.match(/^ {4}environment: /gmu) ?? []).length, 1);
  assert.match(publish, /^ {4}environment: native-publish$/mu);
  assert.doesNotMatch(workflow, /id-token: write|contents: write|GITHUB_TOKEN|NPM_TOKEN/u);
  assert.doesNotMatch(publish, /pnpm |turbo |gradlew|xcodebuild/u);
  assert.ok(
    publish.indexOf('Require release credentials') <
      publish.indexOf('Checkout exact release source'),
  );
  for (const [, name] of workflow.matchAll(/secrets\.([A-Z_]+)/gu)) {
    assert.ok(
      [
        'MAVEN_CENTRAL_TOKEN_USERNAME',
        'MAVEN_CENTRAL_TOKEN_PASSWORD',
        'NATIVE_SIGNING_KEY',
        'NATIVE_SIGNING_KEY_PASSPHRASE',
        'SWIFT_DISTRIBUTION_DEPLOY_KEY',
      ].includes(name),
      name,
    );
  }
  const interlock = beforePublish.indexOf('Enforce native release interlock');
  assert.ok(interlock >= 0 && interlock < beforePublish.indexOf('Plan the native version'));
  assert.ok(publish.indexOf('Upload to Maven Central') < publish.indexOf('Push the Swift release'));
  assert.ok(
    publish.indexOf('Push the Swift release') <
      publish.indexOf('Publish the validated Maven Central'),
  );
  for (const [, reference] of workflow.matchAll(/uses: (\S+)/gu)) {
    assert.match(reference, /@[0-9a-f]{40}$/u, `${reference} must be pinned to a commit`);
  }
});

test('the native interlock file, when present, is a valid blocker list', async () => {
  const document = await readPublicReleaseBlockers(root, 'NATIVE_RELEASE_BLOCKERS.json');
  if (document) assert.ok(document.blockers.length > 0);
});
