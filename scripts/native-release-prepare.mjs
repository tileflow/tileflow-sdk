import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {readNativeStylePins} from './mobile-native-style.mjs';
import {validateMavenRepository} from './native-maven-bundle.mjs';
import {parseAlphaVersion, readNativeReleaseCatalog} from './native-release-config.mjs';
import {assertNativeMapAssets} from './native-release-verify.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
const usage =
  'Usage: native-release-prepare.mjs --output /new/directory [--version 0.0.0-local.1] [--allow-dirty]';
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (key === '--allow-dirty' && !options.has(key)) {
    options.set(key, true);
    continue;
  }
  if (!['--output', '--version'].includes(key) || !args[index + 1] || options.has(key)) {
    throw new Error(usage);
  }
  options.set(key, args[index + 1]);
  index += 1;
}
const output = options.get('--output');
const version = options.get('--version') ?? '0.0.0-local.1';
if (!output || !isAbsolute(output)) throw new Error('--output must be an absolute, new directory.');
// Release versions come from the native release plan; local candidates use 0.0.0-<label>.
if (!parseAlphaVersion(version) && !/^0\.0\.0-[a-z]+(?:\.[0-9A-Za-z-]+)*$/u.test(version)) {
  throw new Error('The version must be X.Y.Z-alpha.N or a local 0.0.0-<label> candidate.');
}
const catalog = await readNativeReleaseCatalog(root);

async function command(executable, arguments_, cwd = root) {
  const result = await run(executable, arguments_, {cwd, maxBuffer: 16 * 1024 * 1024});
  return result.stdout.trim();
}

// A candidate describes committed source. Local experiments must say that they are not.
const sourceDirty = Boolean(await command('git', ['status', '--porcelain']));
if (sourceDirty && !options.has('--allow-dirty')) {
  throw new Error(
    'The source tree has uncommitted changes. Commit them, or pass --allow-dirty for a local candidate.',
  );
}
const destination = resolve(output);
await mkdir(destination); // Fail rather than replace a previous candidate.
await writeFile(join(destination, 'INCOMPLETE'), 'Preparation has not completed.\n');

/** Hash all versioned and non-ignored source inputs. */
async function sourceInventory() {
  const files = (
    await command('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const inventory = {};
  for (const path of files) {
    inventory[path] = createHash('sha256')
      .update(await readFile(resolve(root, path)))
      .digest('hex');
  }
  return `${JSON.stringify(inventory, null, 2)}\n`;
}
const buildInputs = await sourceInventory();
const buildInputsSha256 = createHash('sha256').update(buildInputs).digest('hex');

async function inventory(directory, prefix = '') {
  const files = {};
  for (const item of (await readdir(directory, {withFileTypes: true})).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const path = join(directory, item.name);
    if (item.isDirectory()) Object.assign(files, await inventory(path, relative));
    else if (item.isFile())
      files[relative] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    else throw new Error(`Unexpected non-file in candidate: ${relative}`);
  }
  return files;
}

await command('pnpm', ['native:check-generated']);
const engines = await readNativeStylePins(root);
const swift = join(destination, 'swift');
await mkdir(swift);
for (const path of Object.keys(JSON.parse(buildInputs))) {
  if (!/^platforms\/ios\/(?:Package\.swift$|(?:Sources|Tests)\/)/u.test(path)) continue;
  const relative = path.slice('platforms/ios/'.length);
  assertNativeMapAssets([relative]);
  await mkdir(dirname(join(swift, relative)), {recursive: true});
  await cp(resolve(root, path), join(swift, relative));
}
await cp(resolve(root, 'LICENSE'), join(swift, 'LICENSE'));
const swiftReadme = await readFile(resolve(root, 'platforms/ios/distribution/README.md'), 'utf8');
if (!swiftReadme.includes(`https://github.com/${catalog.swift.repository}`)) {
  throw new Error(
    'platforms/ios/distribution/README.md must name the Swift distribution repository.',
  );
}
await writeFile(join(swift, 'README.md'), swiftReadme);
for (const platform of ['common', 'ios']) {
  await cp(
    resolve(root, 'platforms/notices', platform, 'MapLibreNotices'),
    join(swift, 'MapLibreNotices'),
    {recursive: true},
  );
}
await writeFile(join(swift, '.gitignore'), '.build/\n.swiftpm/\nxcuserdata/\n');

const maven = join(destination, 'maven');
// Gradle module → Maven artifact, from platforms/native-release.json. The map is `tileflow-sdk`;
// service clients ship separately.
const androidArtifacts = Object.fromEntries(
  catalog.maven.publications.map(({module, artifactId}) => [module, artifactId]),
);
const sourceRevision = await command('git', ['rev-parse', 'HEAD']);
const gradleOutput = await command(
  './gradlew',
  [
    ...Object.keys(androidArtifacts).map(
      (module) => `:${module}:publishReleasePublicationToCandidateRepository`,
    ),
    `-PtileflowVersion=${version}`,
    `-PtileflowSourceRevision=${sourceRevision}`,
    `-PtileflowRepository=${maven}`,
    '--console=plain',
  ],
  resolve(root, 'platforms/android'),
);
await writeFile(join(destination, 'android-build.log'), `${gradleOutput}\n`);
// POM, Gradle metadata, sources and documentation must already meet Maven Central's requirements.
await validateMavenRepository(maven, {catalog, version, engines});
const mapArtifact = androidArtifacts.tileflow;
const artifactPath = `${catalog.maven.group.replaceAll('.', '/')}/${mapArtifact}/${version}/${mapArtifact}-${version}.aar`;
const entries = await command('/usr/bin/unzip', ['-Z1', join(maven, artifactPath)]);
assertNativeMapAssets(entries.split('\n'));
if ((await sourceInventory()) !== buildInputs) {
  throw new Error('Source files changed while the candidate was built.');
}
await writeFile(join(destination, 'source-inventory.json'), buildInputs);
await cp(resolve(root, 'LICENSE'), join(destination, 'LICENSE'));
const provenance = {
  schemaVersion: 1,
  version,
  sourceRepository: `https://github.com/${catalog.sourceRepository}`,
  sourceRevision,
  sourceDirty,
  sourceInventorySha256: buildInputsSha256,
  engines,
};
await writeFile(join(swift, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
const manifest = {
  schemaVersion: 1,
  version,
  sourceRepository: provenance.sourceRepository,
  sourceRevision: provenance.sourceRevision,
  sourceDirty: provenance.sourceDirty,
  engines,
  swift: {path: 'swift', files: await inventory(swift)},
  android: {
    coordinate: `${catalog.maven.group}:${mapArtifact}:${version}`,
    modules: Object.fromEntries(
      Object.entries(androidArtifacts).map(([module, artifact]) => [
        module,
        `${catalog.maven.group}:${artifact}:${version}`,
      ]),
    ),
    path: 'maven',
    files: await inventory(maven),
  },
  sourceInventorySha256: buildInputsSha256,
  toolchain: {
    node: process.version,
    swift: await command('swift', ['--version']),
    xcode: await command('xcodebuild', ['-version']),
    gradle: await command('./gradlew', ['--version'], resolve(root, 'platforms/android')),
  },
};
await writeFile(join(destination, 'candidate.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const {unlink} = await import('node:fs/promises');
await unlink(join(destination, 'INCOMPLETE'));
console.log(
  `Prepared local SwiftPM and Maven candidate: ${destination}\nMapLibre Native: iOS ${engines.ios}, Android ${engines.android}`,
);
