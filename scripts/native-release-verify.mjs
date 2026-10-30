import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {primaryFileNames, validateMavenRepository} from './native-maven-bundle.mjs';
import {mavenArtifactDirectory, readNativeReleaseCatalog} from './native-release-config.mjs';

// Checks shared by the release workflow and local dry runs: consumers built from a candidate carry
// its exact embedded runtime, and an approved bundle is internally consistent.

const run = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function command(executable, args, options = {}) {
  try {
    const {stdout} = await run(executable, args, {maxBuffer: 256 * 1024 * 1024, ...options});
    return stdout;
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim().split('\n').slice(-60);
    throw new Error(`${executable} ${args.join(' ')} failed:\n${output.join('\n')}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function findDirectory(directory, name) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    if (!item.isDirectory()) continue;
    const path = join(directory, item.name);
    if (item.name === name) return path;
    const found = await findDirectory(path, name);
    if (found) return found;
  }
  return null;
}

/** The runtime files a consumer ships must be the candidate's, byte for byte. */
async function assertRuntime(files, runtime, where) {
  const receipt = JSON.parse((await files('receipt.json')).toString('utf8'));
  if (JSON.stringify(receipt) !== JSON.stringify(runtime)) {
    throw new Error(`${where}: the embedded runtime receipt differs from the candidate.`);
  }
  for (const [name, digest] of Object.entries(runtime.files)) {
    if (sha256(await files(name)) !== digest) throw new Error(`${where}: ${name} differs.`);
  }
}

async function swiftExample(consumers, scheme) {
  const consumer = await readJson(join(consumers, 'candidate.json'));
  const candidate = await readJson(join(consumer.candidate, 'candidate.json'));
  const project = join(consumers, 'ios/TileflowExamples.xcodeproj');
  const derived = join(consumers, `derived-${scheme}`);
  await command('xcodebuild', [
    'build',
    '-project',
    project,
    '-scheme',
    scheme,
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    derived,
    'CODE_SIGNING_ALLOWED=NO',
  ]);
  // A URL dependency must resolve to the release tag, not to a local path.
  if (/^(?:file|https):\/\//u.test(consumer.swiftPackage)) {
    const resolved = await readJson(
      join(project, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
    );
    // Xcode records a file URL as its path.
    const location = consumer.swiftPackage.replace(/^file:\/\//u, '');
    const pin = resolved.pins?.find((item) => item.location === location);
    if (pin?.state?.version !== candidate.version) {
      throw new Error(
        `${scheme}: ${consumer.swiftPackage} did not resolve to ${candidate.version}.`,
      );
    }
    const release = join(consumer.candidate, '../swift-release/swift-release.json');
    const expected = await readJson(release).catch(() => null);
    if (expected && pin.state.revision !== expected.commit) {
      throw new Error(
        `${scheme}: the tag resolved to ${pin.state.revision}, not ${expected.commit}.`,
      );
    }
  }
  const app = await findDirectory(join(derived, 'Build/Products'), `${scheme}.app`);
  const runtime = app && (await findDirectory(app, 'EmbeddedRuntime'));
  if (!runtime) throw new Error(`${scheme}: the app has no embedded runtime resources.`);
  await assertRuntime((name) => readFile(join(runtime, name)), candidate.runtime, scheme);
  console.log(
    `${scheme} built from ${consumer.swiftPackage} with runtime ${candidate.runtime.runtimeHash}.`,
  );
}

async function androidExample(consumers) {
  const consumer = await readJson(join(consumers, 'candidate.json'));
  const candidate = await readJson(join(consumer.candidate, 'candidate.json'));
  const android = join(consumers, 'android');
  await command('./gradlew', [':example:assembleDebug', '--console=plain'], {cwd: android});
  const dependencies = await command(
    './gradlew',
    [':example:dependencies', '--configuration', 'debugRuntimeClasspath', '--console=plain'],
    {cwd: android},
  );
  if (!dependencies.includes(candidate.android.coordinate)) {
    throw new Error(`The Android example does not use ${candidate.android.coordinate}.`);
  }
  for (const coordinate of Object.values(candidate.android.modules)) {
    const module = coordinate.slice(0, coordinate.lastIndexOf(':') + 1);
    const lines = dependencies.split('\n').filter((line) => line.includes(module));
    if (lines.some((line) => !line.includes(coordinate) || line.includes(`${coordinate} -> `))) {
      throw new Error(`The Android example resolved another version of ${module.slice(0, -1)}.`);
    }
  }
  const apk = join(android, 'example/build/outputs/apk/debug/example-debug.apk');
  await assertRuntime(
    async (name) =>
      Buffer.from(
        await command('/usr/bin/unzip', ['-p', apk, `assets/tileflow/${name}`], {
          encoding: 'buffer',
        }),
      ),
    candidate.runtime,
    'Android example',
  );
  console.log(
    `Android example built from ${consumer.mavenRepository} with runtime ${candidate.runtime.runtimeHash}.`,
  );
}

/** Everything in an approved bundle describes one version built from one clean revision. */
async function verifyBundle(release, version, sourceRevision) {
  const catalog = await readNativeReleaseCatalog();
  const plan = await readJson(join(release, 'plan.json'));
  const candidate = await readJson(join(release, 'candidate/candidate.json'));
  const swiftRelease = await readJson(join(release, 'swift-release/swift-release.json'));
  const provenance = await readJson(join(release, 'candidate/swift/provenance.json'));
  const checks = [
    [plan.version, version, 'plan version'],
    [plan.sourceRevision, sourceRevision, 'plan source'],
    [candidate.version, version, 'candidate version'],
    [candidate.sourceRevision, sourceRevision, 'candidate source'],
    [candidate.sourceDirty, false, 'candidate source state'],
    [provenance.version, version, 'Swift provenance version'],
    [provenance.sourceRevision, sourceRevision, 'Swift provenance source'],
    [provenance.sourceDirty, false, 'Swift provenance source state'],
    [provenance.runtimeHash, candidate.runtime.runtimeHash, 'Swift provenance runtime'],
    [swiftRelease.version, version, 'Swift release version'],
    [swiftRelease.sourceRevision, sourceRevision, 'Swift release source'],
    [swiftRelease.runtimeHash, candidate.runtime.runtimeHash, 'Swift release runtime'],
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`${label} is ${actual}, expected ${expected}.`);
  }
  for (const [path, digest] of Object.entries(candidate.swift.files)) {
    if (sha256(await readFile(join(release, 'candidate/swift', path))) !== digest) {
      throw new Error(`Swift file ${path} differs from the candidate inventory.`);
    }
  }
  for (const [path, digest] of Object.entries(candidate.android.files)) {
    if (sha256(await readFile(join(release, 'candidate/maven', path))) !== digest) {
      throw new Error(`Maven file ${path} differs from the candidate inventory.`);
    }
  }
  await validateMavenRepository(join(release, 'candidate/maven'), {catalog, version});
  console.log(`Release bundle ${version} is consistent with ${sourceRevision}.`);
}

async function describe(release) {
  const catalog = await readNativeReleaseCatalog();
  const candidate = await readJson(join(release, 'candidate/candidate.json'));
  const swiftRelease = await readJson(join(release, 'swift-release/swift-release.json'));
  const maven = {};
  for (const {artifactId} of catalog.maven.publications) {
    for (const name of primaryFileNames(artifactId, candidate.version)) {
      const path = `${mavenArtifactDirectory(catalog, artifactId)}/${candidate.version}/${name}`;
      maven[path] = sha256(await readFile(join(release, 'candidate/maven', path)));
    }
  }
  return {catalog, candidate, swiftRelease, maven};
}

async function summary(release) {
  const {catalog, candidate, swiftRelease} = await describe(release);
  return [
    `## Native release ${candidate.version}`,
    '',
    `- Source: \`${candidate.sourceRevision}\``,
    `- Embedded runtime: \`${candidate.runtime.runtimeHash}\``,
    `- Swift: https://github.com/${catalog.swift.repository} tag \`${candidate.version}\` at commit \`${swiftRelease.commit}\` (tree \`${swiftRelease.tree}\`, parent \`${swiftRelease.parent ?? 'none'}\`)`,
    `- Maven Central: ${Object.values(candidate.android.modules)
      .map((coordinate) => `\`${coordinate}\``)
      .join(', ')}`,
    '',
  ].join('\n');
}

async function receipt(release, bundleDigest, output) {
  const {catalog, candidate, swiftRelease, maven} = await describe(release);
  const document = {
    schemaVersion: 1,
    kind: 'tileflow-native-release-receipt',
    version: candidate.version,
    sourceRepository: candidate.sourceRepository,
    sourceRevision: candidate.sourceRevision,
    bundleSha256: bundleDigest,
    runtimeHash: candidate.runtime.runtimeHash,
    swift: {
      repository: `https://github.com/${catalog.swift.repository}`,
      tag: candidate.version,
      commit: swiftRelease.commit,
      tree: swiftRelease.tree,
    },
    maven: {coordinates: Object.values(candidate.android.modules), files: maven},
  };
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, {flag: 'wx'});
}

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  const value = (key) => {
    const index = args.indexOf(key);
    const result = index >= 0 ? args[index + 1] : undefined;
    if (!result) throw new Error(`${key} is required.`);
    return result;
  };
  const path = (key) => {
    const result = value(key);
    if (!isAbsolute(result)) throw new Error(`${key} must be absolute.`);
    return result;
  };
  if (subcommand === 'swift-example') await swiftExample(path('--consumers'), value('--scheme'));
  else if (subcommand === 'android-example') await androidExample(path('--consumers'));
  else if (subcommand === 'bundle') {
    await verifyBundle(path('--release'), value('--version'), value('--source-revision'));
  } else if (subcommand === 'summary') process.stdout.write(await summary(path('--release')));
  else if (subcommand === 'receipt') {
    await receipt(path('--release'), value('--bundle-digest'), path('--output'));
  } else {
    throw new Error(
      'Usage: native-release-verify.mjs swift-example|android-example|bundle|summary|receipt [options]',
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
