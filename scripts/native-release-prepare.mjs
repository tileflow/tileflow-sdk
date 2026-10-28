import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

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
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/u.test(version)) {
  throw new Error('Invalid candidate version.');
}

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

/** Every non-ignored source file and its digest: the inputs of the embedded runtime and SDKs. */
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

// Rebuild the embedded runtime from these inputs; never stage a runtime left by an earlier build.
// Staging checks every resource digest. Consumers never run this build command.
await command(process.execPath, ['scripts/mobile-protocol-generate.mjs', '--check']);
await rm(resolve(root, 'packages/mobile-runtime/dist'), {recursive: true, force: true});
await command('pnpm', ['exec', 'turbo', 'build', '--filter=@tileflow/mobile-runtime', '--force']);
await command(process.execPath, ['scripts/mobile-runtime-stage.mjs']);
const swift = join(destination, 'swift');
await mkdir(swift);
for (const path of ['Package.swift', 'Sources', 'Tests']) {
  await cp(resolve(root, 'platforms/ios', path), join(swift, path), {recursive: true});
}
await cp(resolve(root, 'LICENSE'), join(swift, 'LICENSE'));
await writeFile(join(swift, '.gitignore'), '.build/\n.swiftpm/\nxcuserdata/\n');

const maven = join(destination, 'maven');
// Gradle module → Maven artifact. The map is `tileflow-sdk`; service clients ship separately.
const androidArtifacts = {
  tileflow: 'tileflow-sdk',
  'tileflow-configuration': 'tileflow-configuration',
  'tileflow-search': 'tileflow-search',
  'tileflow-routing': 'tileflow-routing',
  'tileflow-elevation': 'tileflow-elevation',
  'tileflow-geoip': 'tileflow-geoip',
  'tileflow-service-content': 'tileflow-service-content',
};
const gradleOutput = await command(
  './gradlew',
  [
    ...Object.keys(androidArtifacts).map(
      (module) => `:${module}:publishReleasePublicationToCandidateRepository`,
    ),
    `-PtileflowVersion=${version}`,
    `-PtileflowRepository=${maven}`,
    '--console=plain',
  ],
  resolve(root, 'platforms/android'),
);
await writeFile(join(destination, 'android-build.log'), `${gradleOutput}\n`);
const receipt = JSON.parse(
  await readFile(resolve(root, 'packages/mobile-runtime/dist/receipt.json'), 'utf8'),
);
const artifactPath = `dev/tileflow/tileflow-sdk/${version}/tileflow-sdk-${version}.aar`;
const aarReceipt = JSON.parse(
  await command('/usr/bin/unzip', [
    '-p',
    join(maven, artifactPath),
    'assets/tileflow/receipt.json',
  ]),
);
if (JSON.stringify(receipt) !== JSON.stringify(aarReceipt))
  throw new Error('Android runtime receipt differs.');
if ((await sourceInventory()) !== buildInputs) {
  throw new Error('Source files changed while the candidate was built.');
}
await writeFile(join(destination, 'source-inventory.json'), buildInputs);
await cp(resolve(root, 'LICENSE'), join(destination, 'LICENSE'));
const provenance = {
  schemaVersion: 1,
  version,
  sourceRepository: 'https://github.com/tileflow/tileflow-sdk',
  sourceRevision: await command('git', ['rev-parse', 'HEAD']),
  sourceDirty,
  sourceInventorySha256: buildInputsSha256,
  runtimeHash: receipt.runtimeHash,
};
await writeFile(join(swift, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
const manifest = {
  schemaVersion: 1,
  version,
  sourceRevision: provenance.sourceRevision,
  sourceDirty: provenance.sourceDirty,
  runtime: receipt,
  swift: {path: 'swift', files: await inventory(swift)},
  android: {
    coordinate: `dev.tileflow:tileflow-sdk:${version}`,
    modules: Object.fromEntries(
      Object.entries(androidArtifacts).map(([module, artifact]) => [
        module,
        `dev.tileflow:${artifact}:${version}`,
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
  `Prepared local SwiftPM and Maven candidate: ${destination}\nRuntime: ${receipt.runtimeHash}`,
);
