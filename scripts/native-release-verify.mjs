import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {readNativeStylePins} from './mobile-native-style.mjs';
import {primaryFileNames, validateMavenRepository} from './native-maven-bundle.mjs';
import {mavenArtifactDirectory, readNativeReleaseCatalog} from './native-release-config.mjs';

// Checks shared by the release workflow and local dry runs: consumers built from a candidate carry
// the pinned native renderer, and an approved bundle is internally consistent.

const root = fileURLToPath(new URL('../', import.meta.url));
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

/** Both package formats can retain ignored outputs from builds of the old renderer. */
export function assertNativeMapAssets(entries) {
  const retired =
    /(?:^|\/)EmbeddedRuntime(?:\/|$)|^assets\/tileflow\/(?:index\.html|maplibre\.css|runtime\.js|receipt\.json|dependencies\.json|notices\.txt)$/u;
  const stale = entries.find((entry) => retired.test(entry));
  if (stale) throw new Error(`Unexpected embedded renderer resource: ${stale}`);
}

/** Service consumers must compile and link without the map targets or renderer artifacts. */
export function assertServicesOnlyConsumer({dependencies, entries, linkage = ''}) {
  const forbiddenTargets = /\bTarget ['"](?:MapLibre|Tileflow|TileflowStyleBridge)['"] in project/u;
  const forbiddenCoordinates = /org\.maplibre\.gl:|dev\.tileflow:tileflow(?:-sdk)?:/u;
  if (forbiddenTargets.test(dependencies) || forbiddenCoordinates.test(dependencies))
    throw new Error('The services consumer depends on the native map renderer.');
  if (
    entries.some((entry) =>
      /(?:^|\/)(?:MapLibre\.framework|libmaplibre\.so)(?:\/|$)/u.test(entry),
    ) ||
    /MapLibre\.framework|libmaplibre\.so|Lorg\/maplibre\/android\//u.test(linkage)
  )
    throw new Error('The services consumer contains or links the native map renderer.');
  assertNativeMapAssets(entries);
}

/** A candidate's transitive Foundation must resolve even when the app declares only Services. */
export function assertAndroidCandidateDependencies(dependencies, candidate, modules) {
  for (const name of modules) {
    const coordinate = candidate.android.modules[name];
    if (!coordinate) throw new Error(`The candidate has no artifact for :${name}.`);
    const prefix = coordinate.slice(0, coordinate.lastIndexOf(':') + 1);
    const version = coordinate.slice(prefix.length);
    const resolutions = dependencies
      .split('\n')
      .filter((line) => line.includes(prefix))
      .map((line) => line.split(prefix)[1].trim().split(/\s+/u));
    if (
      !resolutions.length ||
      resolutions.some(([resolved, next]) => resolved !== version || next === '->')
    )
      throw new Error(`The Android consumer did not resolve ${coordinate} exactly.`);
  }
}

async function swiftExample(consumers, scheme) {
  const consumer = await readJson(join(consumers, 'candidate.json'));
  const candidate = await readJson(join(consumer.candidate, 'candidate.json'));
  const servicesOnly = scheme === 'ServicesExample';
  const project = join(
    consumers,
    servicesOnly
      ? 'ios-services/TileflowServicesConsumer.xcodeproj'
      : 'ios/TileflowExamples.xcodeproj',
  );
  const derived = join(consumers, `derived-${scheme}`);
  const dependencies = await command('xcodebuild', [
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
  const resolved = await readJson(
    join(project, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
  );
  const engine = resolved.pins?.find(
    (item) =>
      item.location.replace(/\.git$/u, '') ===
      'https://github.com/maplibre/maplibre-gl-native-distribution',
  );
  if (!servicesOnly && engine?.state?.version !== candidate.engines.ios)
    throw new Error(`${scheme}: unexpected MapLibre version ${engine?.state?.version}.`);

  // A URL dependency must also resolve to the Tileflow release tag.
  if (/^(?:file|https):\/\//u.test(consumer.swiftPackage)) {
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
  if (!app) throw new Error(`${scheme}: the app was not built.`);
  const entries = await readdir(app, {recursive: true});
  if (servicesOnly) {
    if (!/Target ['"]TileflowServices['"] in project/u.test(dependencies))
      throw new Error('The services consumer did not build TileflowServices.');
    const linkage = await command('/usr/bin/otool', ['-L', join(app, scheme)]);
    assertServicesOnlyConsumer({dependencies, entries, linkage});
    console.log('Swift Services built without the map renderer.');
  } else {
    if (!(await findDirectory(app, 'MapLibre.framework')))
      throw new Error(`${scheme}: the app did not embed MapLibre.framework.`);
    assertNativeMapAssets(entries);
    console.log(`${scheme} built with MapLibre ${candidate.engines.ios}.`);
  }
}

async function androidExample(consumers, module = 'example') {
  const consumer = await readJson(join(consumers, 'candidate.json'));
  const candidate = await readJson(join(consumer.candidate, 'candidate.json'));
  const android = join(consumers, 'android');
  await command('./gradlew', [`:${module}:assembleDebug`, '--console=plain'], {cwd: android});
  const dependencies = await command(
    './gradlew',
    [`:${module}:dependencies`, '--configuration', 'debugRuntimeClasspath', '--console=plain'],
    {cwd: android},
  );
  const servicesOnly = module === 'services';
  assertAndroidCandidateDependencies(
    dependencies,
    candidate,
    servicesOnly
      ? ['tileflow-services', 'tileflow-foundation']
      : Object.keys(candidate.android.modules),
  );
  const apk = join(android, module, `build/outputs/apk/debug/${module}-debug.apk`);
  const entries = (await command('/usr/bin/unzip', ['-Z1', apk])).split('\n');
  if (servicesOnly) {
    const dex = await command('/usr/bin/unzip', ['-p', apk, 'classes*.dex'], {encoding: 'buffer'});
    assertServicesOnlyConsumer({dependencies, entries, linkage: dex.toString('latin1')});
    console.log('Android Services built without the map renderer.');
    return;
  }
  const engine = 'org.maplibre.gl:android-sdk-opengl:';
  const versions = dependencies
    .split('\n')
    .filter((line) => line.includes(engine))
    .map((line) => line.split(engine)[1].trim().split(/\s+/u));
  if (
    !versions.length ||
    versions.some(([version, next]) => version !== candidate.engines.android || next === '->')
  )
    throw new Error(
      `The Android example did not resolve ${engine}${candidate.engines.android} exactly.`,
    );

  assertNativeMapAssets(entries);
  if (!entries.some((entry) => /^lib\/[^/]+\/libmaplibre\.so$/u.test(entry)))
    throw new Error('The Android example did not package libmaplibre.so.');
  console.log(`Android example built with MapLibre ${candidate.engines.android}.`);
}

/** Everything in an approved bundle describes one version built from one clean revision. */
async function verifyBundle(release, version, sourceRevision) {
  const catalog = await readNativeReleaseCatalog();
  const plan = await readJson(join(release, 'plan.json'));
  const candidate = await readJson(join(release, 'candidate/candidate.json'));
  const swiftRelease = await readJson(join(release, 'swift-release/swift-release.json'));
  const provenance = await readJson(join(release, 'candidate/swift/provenance.json'));
  const engines = await readNativeStylePins(root);
  const checks = [
    [plan.version, version, 'plan version'],
    [plan.sourceRevision, sourceRevision, 'plan source'],
    [candidate.version, version, 'candidate version'],
    [candidate.sourceRevision, sourceRevision, 'candidate source'],
    [candidate.sourceDirty, false, 'candidate source state'],
    [provenance.version, version, 'Swift provenance version'],
    [provenance.sourceRevision, sourceRevision, 'Swift provenance source'],
    [provenance.sourceDirty, false, 'Swift provenance source state'],
    [swiftRelease.version, version, 'Swift release version'],
    [swiftRelease.sourceRevision, sourceRevision, 'Swift release source'],
    ...Object.entries(engines).flatMap(([platform, version]) => [
      [candidate.engines?.[platform], version, `candidate ${platform} renderer`],
      [provenance.engines?.[platform], version, `Swift provenance ${platform} renderer`],
      [swiftRelease.engines?.[platform], version, `Swift release ${platform} renderer`],
    ]),
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
  await validateMavenRepository(join(release, 'candidate/maven'), {catalog, version, engines});
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
    `- MapLibre Native: iOS ${candidate.engines.ios}, Android ${candidate.engines.android}`,
    `- Swift: https://github.com/${catalog.swift.repository} tag \`${candidate.version}\` at commit \`${swiftRelease.commit}\` (tree \`${swiftRelease.tree}\`, parent \`${swiftRelease.parent ?? 'none'}\`)`,
    `- Tileflow Maven (${catalog.maven.repositoryUrl}): ${Object.values(candidate.android.modules)
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
    engines: candidate.engines,
    swift: {
      repository: `https://github.com/${catalog.swift.repository}`,
      tag: candidate.version,
      commit: swiftRelease.commit,
      tree: swiftRelease.tree,
    },
    maven: {
      repositoryUrl: catalog.maven.repositoryUrl,
      coordinates: Object.values(candidate.android.modules),
      files: maven,
    },
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
  else if (subcommand === 'swift-services')
    await swiftExample(path('--consumers'), 'ServicesExample');
  else if (subcommand === 'android-example') await androidExample(path('--consumers'));
  else if (subcommand === 'android-services') await androidExample(path('--consumers'), 'services');
  else if (subcommand === 'bundle') {
    await verifyBundle(path('--release'), value('--version'), value('--source-revision'));
  } else if (subcommand === 'summary') process.stdout.write(await summary(path('--release')));
  else if (subcommand === 'receipt') {
    await receipt(path('--release'), value('--bundle-digest'), path('--output'));
  } else {
    throw new Error(
      'Usage: native-release-verify.mjs swift-example|swift-services|android-example|android-services|bundle|summary|receipt [options]',
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
