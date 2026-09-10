#!/usr/bin/env node

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const runtimeDirectory = 'packages/coordinates-runtime';
const sourceRoots = ['native', 'proofs', 'src', 'test'];
const sourceFiles = ['tsup.engine.config.ts', 'tsup.verifiers.config.ts'];
const rootSourceFiles = [{destination: 'notices/TILEFLOW-LICENSE', path: 'LICENSE'}];
const sourceKind = 'tileflow-coordinates-builder-source';

export async function collectCoordinatesBuilderSource(root = repositoryRoot) {
  const files = [];
  for (const directory of sourceRoots) {
    const source = join(root, runtimeDirectory, directory);
    for (const path of await listFiles(source)) {
      const relativePath = relative(join(root, runtimeDirectory), path);
      files.push({
        destination: relativePath.startsWith('proofs/') ? relativePath : `sources/${relativePath}`,
        source: path,
      });
    }
  }
  for (const path of sourceFiles) {
    const source = join(root, runtimeDirectory, path);
    const info = await lstat(source);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Builder source is invalid: ${path}.`);
    files.push({destination: `sources/${path}`, source});
  }
  for (const entry of rootSourceFiles) {
    const source = join(root, entry.path);
    const info = await lstat(source);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Builder source is invalid: ${entry.path}.`);
    files.push({destination: entry.destination, source});
  }
  return Promise.all(
    files
      .sort((left, right) => comparePath({path: left.destination}, {path: right.destination}))
      .map(async ({destination, source}) => ({
        path: destination,
        sha256: await hashFile(source),
      })),
  );
}

export async function writeCoordinatesBuilderInputSource(root = repositoryRoot) {
  const files = await collectCoordinatesBuilderSource(root);
  const descriptor = {
    schemaVersion: 1,
    kind: sourceKind,
    files,
    sourceDigest: digest({schemaVersion: 1, kind: sourceKind, files}),
  };
  const destination = join(root, runtimeDirectory, 'dist/builder-input-source.json');
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

export async function createCoordinatesBuilderInput({
  admission,
  output,
  root = repositoryRoot,
  runtimePackage,
}) {
  assert.ok(
    admission === 'development' || admission === 'native-qualified-eligible',
    'Builder input admission is invalid.',
  );
  assert.ok(runtimePackage, 'A runtime package tarball is required.');
  const resolvedOutput = resolve(output);
  const tarball = resolve(runtimePackage);
  await assertMissing(resolvedOutput);
  const source = await collectCoordinatesBuilderSource(root);
  const sourceRevision = await verifiedSourceRevision(root);
  const packageDirectory = await extractRuntimePackage(tarball);
  let temporary;
  try {
    const runtime = await importRuntime(root);
    const packageManifest = JSON.parse(
      await readFile(join(packageDirectory, 'package.json'), 'utf8'),
    );
    assert.equal(
      packageManifest.name,
      '@tileflow/coordinates-runtime',
      'Runtime package name is invalid.',
    );
    assert.match(packageManifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    if (admission === 'native-qualified-eligible') {
      assert.match(
        packageManifest.version,
        /^\d+\.\d+\.\d+-alpha\.\d+$/u,
        'Qualified builder inputs require a published alpha package.',
      );
    }
    const descriptor = runtime.coordinatesBuilderInputSourceSchema.parse(
      JSON.parse(await readFile(join(packageDirectory, 'dist/builder-input-source.json'), 'utf8')),
    );
    assert.deepEqual(
      descriptor.files,
      source,
      'Runtime package builder-source inventory is stale.',
    );
    const sourceDigest = digest({schemaVersion: 1, kind: sourceKind, files: source});
    assert.equal(
      descriptor.sourceDigest,
      sourceDigest,
      'Runtime package builder-source identity is stale.',
    );

    const outputDirectory = dirname(resolvedOutput);
    await mkdir(outputDirectory, {recursive: true, mode: 0o700});
    temporary = await mkdtemp(join(outputDirectory, '.coordinates-builder-input-'));
    for (const entry of source) {
      const sourcePath = sourcePathForEntry(root, entry.path);
      const destination = join(temporary, entry.path);
      await mkdir(dirname(destination), {recursive: true, mode: 0o700});
      await copyFile(sourcePath, destination);
    }
    await buildArtifacts({root, output: temporary});
    await copyFile(tarball, join(temporary, 'runtime-package.tgz'));
    const archive = await fileRecord(temporary, 'runtime-package.tgz');
    const runtimeFiles = await inventoryFiles(packageDirectory);
    const verification = {
      schemaVersion: 1,
      kind: 'tileflow-coordinates-builder-input-verification',
      sourceRevision,
      sourceDigest,
      runtimePackage: {
        integrity: await integrity(tarball),
        name: packageManifest.name,
        sha256: await hashFile(tarball),
        version: packageManifest.version,
      },
      checks: {
        bundledAdapter: true,
        bundledVerifiers: true,
        completeSourceInventory: true,
        runtimePackageSourceMatches: true,
        sourceMatchesRevision: true,
      },
    };
    await writeFile(
      join(temporary, 'verification.json'),
      `${JSON.stringify(verification, null, 2)}\n`,
    );
    const verificationReportFile = await fileRecord(temporary, 'verification.json');
    const files = await inventoryFiles(temporary);
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    const nativeSource = requiredSourceFile(byPath, 'sources/native/engine.cpp');
    const buildConfiguration = requiredSourceFile(byPath, 'sources/tsup.engine.config.ts');
    const verificationReport = requiredSourceFile(byPath, verificationReportFile.path);
    const proofs = files
      .filter((entry) => entry.path.startsWith('proofs/'))
      .map(({path, sha256}) => ({path, sha256}));
    const engineBundle = requiredSourceFile(byPath, 'artifacts/engine.mjs');
    const verifiers = files
      .filter((entry) => entry.path.startsWith('artifacts/verifiers/'))
      .map(({path, sha256}) => ({path, sha256}));
    const manifestValue = {
      schemaVersion: 1,
      kind: 'tileflow-coordinates-builder-input',
      admission,
      runtimePackage: {
        archive,
        files: runtimeFiles,
        integrity: await integrity(tarball),
        name: '@tileflow/coordinates-runtime',
        sourceDescriptor: {
          digest: descriptor.sourceDigest,
          path: 'dist/builder-input-source.json',
        },
        version: packageManifest.version,
      },
      adapter: {
        buildConfiguration,
        engineBundle,
        files: source,
        nativeSource,
        sourceDigest,
        sourceRevision,
        verifiers,
      },
      proofs,
      runtimeProfile: runtime.nativeRuntimeProfile,
      provenance: {
        toolchain: {
          nodeVersion: process.versions.node,
          tsupVersion: await packageVersion(root, 'tsup'),
        },
        verificationReport,
      },
      files,
    };
    const manifest = runtime.coordinatesBuilderInputSchema.parse({
      ...manifestValue,
      inputId: `cbi_${digest(manifestValue)}`,
    });
    await writeFile(
      join(temporary, 'builder-input.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await runtime.verifyCoordinatesBuilderInput({
      directory: temporary,
      runtimePackageDirectory: packageDirectory,
    });
    await rename(temporary, resolvedOutput);
    temporary = undefined;
    return {directory: resolvedOutput, manifest};
  } finally {
    if (temporary) await rm(temporary, {force: true, recursive: true});
    await rm(packageDirectory, {force: true, recursive: true});
  }
}

async function importRuntime(root) {
  return import(pathToFileURL(join(root, runtimeDirectory, 'dist/index.js')).href);
}

async function buildArtifacts({output, root}) {
  const artifacts = join(output, 'artifacts');
  await mkdir(join(artifacts, 'verifiers'), {recursive: true, mode: 0o700});
  await runPnpm(
    root,
    [
      'exec',
      'tsup',
      '--config',
      join(runtimeDirectory, 'tsup.engine.config.ts'),
      '--out-dir',
      artifacts,
    ],
    'Builder adapter bundle failed.',
  );
  const tests = [
    'analytical-runtime.conformance.ts',
    'axis.conformance.ts',
    'native.conformance.ts',
    'runtime.conformance.ts',
  ];
  await runPnpm(
    root,
    [
      'exec',
      'tsup',
      '--config',
      join(runtimeDirectory, 'tsup.verifiers.config.ts'),
      '--out-dir',
      join(artifacts, 'verifiers'),
    ],
    'Builder verifier bundle failed.',
  );
  for (const path of [
    join(artifacts, 'engine.mjs'),
    ...tests.map((test) => join(artifacts, 'verifiers', test.replace(/\.ts$/u, '.mjs'))),
  ]) {
    const info = await lstat(path);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Builder artifact is missing: ${path}.`);
  }
}

async function runPnpm(root, args, message) {
  try {
    await execFileAsync('pnpm', args, {cwd: root});
  } catch {
    throw new Error(message);
  }
}

async function verifiedSourceRevision(root) {
  const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD'], {cwd: root});
  const revision = stdout.trim();
  assert.match(revision, /^[a-f0-9]{40}$/u, 'Builder source revision is invalid.');
  const paths = [
    ...sourceRoots.map((path) => `${runtimeDirectory}/${path}`),
    ...sourceFiles.map((path) => `${runtimeDirectory}/${path}`),
    ...rootSourceFiles.map((entry) => entry.path),
  ];
  try {
    await execFileAsync('git', ['diff', '--quiet', 'HEAD', '--', ...paths], {cwd: root});
  } catch {
    throw new Error('Builder source must match its recorded revision.');
  }
  const {stdout: untracked} = await execFileAsync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', ...paths],
    {cwd: root},
  );
  assert.equal(untracked.trim(), '', 'Builder source must not contain untracked inputs.');
  return revision;
}

async function extractRuntimePackage(tarball) {
  const info = await lstat(tarball);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Runtime package tarball is invalid.');
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-runtime-package-'));
  try {
    await execFileAsync('tar', ['-xzf', tarball, '-C', directory]);
    const packageDirectory = join(directory, 'package');
    const packageInfo = await lstat(packageDirectory);
    assert.ok(
      packageInfo.isDirectory() && !packageInfo.isSymbolicLink(),
      'Runtime package is invalid.',
    );
    return packageDirectory;
  } catch (error) {
    await rm(directory, {force: true, recursive: true});
    throw error;
  }
}

async function listFiles(directory) {
  const info = await lstat(directory);
  assert.ok(
    info.isDirectory() && !info.isSymbolicLink(),
    `Builder source is invalid: ${directory}.`,
  );
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, {withFileTypes: true})).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Builder source is invalid: ${child}.`);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`Builder source is invalid: ${child}.`);
    }
  }
  await visit(directory);
  return files;
}

async function inventoryFiles(directory) {
  const files = [];
  for (const path of await listFiles(directory)) {
    files.push(await fileRecord(directory, relative(directory, path)));
  }
  return files.sort(comparePath);
}

async function fileRecord(root, path) {
  const physical = join(root, path);
  const info = await lstat(physical);
  assert.ok(info.isFile() && !info.isSymbolicLink(), `Builder input file is invalid: ${path}.`);
  return {
    path,
    bytes: info.size,
    executable: Boolean(info.mode & 0o111),
    sha256: await hashFile(physical),
  };
}

function requiredSourceFile(files, path) {
  const entry = files.get(path);
  assert.ok(entry, `Builder input source is missing: ${path}.`);
  return {path: entry.path, sha256: entry.sha256};
}

function sourcePathForEntry(root, path) {
  if (path.startsWith('proofs/')) return join(root, runtimeDirectory, path);
  if (path === 'notices/TILEFLOW-LICENSE') return join(root, 'LICENSE');
  assert.ok(path.startsWith('sources/'), `Builder source path is invalid: ${path}.`);
  return join(root, runtimeDirectory, path.slice('sources/'.length));
}

async function packageVersion(root, name) {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.name, name, `Toolchain package is invalid: ${name}.`);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u, `Toolchain version is invalid: ${name}.`);
  return manifest.version;
}

async function assertMissing(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Builder input output already exists.');
}

async function hashFile(path) {
  const value = await readFile(path);
  return createHash('sha256').update(value).digest('hex');
}

async function integrity(path) {
  const value = await readFile(path);
  return `sha512-${createHash('sha512').update(value).digest('base64')}`;
}

function digest(value) {
  return hash(JSON.stringify(canonical(value)));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function comparePath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'source-descriptor') {
    assert.deepEqual(args, [], 'Unexpected source-descriptor arguments.');
    const descriptor = await writeCoordinatesBuilderInputSource();
    process.stdout.write(`${JSON.stringify({ok: true, sourceDigest: descriptor.sourceDigest})}\n`);
    return;
  }
  assert.equal(command, 'produce', 'Expected source-descriptor or produce.');
  const options = parseOptions(args);
  const result = await createCoordinatesBuilderInput(options);
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'coordinates.builder-input.produce',
      inputId: result.manifest.inputId,
      directory: result.directory,
      admission: result.manifest.admission,
    })}\n`,
  );
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert.ok(['--admission', '--output', '--runtime-package'].includes(key), 'Unknown option.');
    assert.ok(value && !values.has(key), 'Builder input options are invalid.');
    values.set(key, value);
  }
  assert.equal(values.size, 3, 'Builder input options are incomplete.');
  return {
    admission: values.get('--admission'),
    output: values.get('--output'),
    runtimePackage: values.get('--runtime-package'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        ok: false,
        command: 'coordinates.builder-input.produce',
        error: {code: 'COORDINATES_BUILDER_INPUT_PRODUCTION_FAILED', reason: error.message},
      })}\n`,
    );
    process.exitCode = 1;
  }
}
