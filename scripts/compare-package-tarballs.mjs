import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {lstat, mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export async function comparePackageTarballs(candidateArgument, publishedArgument, options = {}) {
  const mode = options.mode ?? 'exact';
  assert.ok(['exact', 'material'].includes(mode), `Unknown tarball comparison mode: ${mode}.`);
  const candidate = resolve(candidateArgument);
  const published = resolve(publishedArgument);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tileflow-tarball-compare-'));

  try {
    const candidateRoot = join(temporaryRoot, 'candidate');
    const publishedRoot = join(temporaryRoot, 'published');
    await Promise.all([
      extractTarball(candidate, candidateRoot),
      extractTarball(published, publishedRoot),
    ]);

    const candidateFiles = await listRegularFiles(candidateRoot);
    const publishedFiles = await listRegularFiles(publishedRoot);
    const differences = [];
    if (!arraysEqual(candidateFiles, publishedFiles)) {
      differences.push('package file list');
      return {differences, equal: false};
    }

    for (const path of candidateFiles) {
      const [candidateMetadata, publishedMetadata, candidateBytes, publishedBytes] =
        await Promise.all([
          lstat(join(candidateRoot, path)),
          lstat(join(publishedRoot, path)),
          readFile(join(candidateRoot, path)),
          readFile(join(publishedRoot, path)),
        ]);
      if ((candidateMetadata.mode & 0o777) !== (publishedMetadata.mode & 0o777)) {
        differences.push(`${path} mode`);
        continue;
      }

      const equal =
        path === 'package/package.json'
          ? canonicalManifest(candidateBytes, mode) === canonicalManifest(publishedBytes, mode)
          : candidateBytes.equals(publishedBytes);
      if (!equal) differences.push(path);
    }

    return {differences, equal: differences.length === 0};
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

async function extractTarball(tarball, destination) {
  const [{stdout: namesOutput}, {stdout: verboseOutput}] = await Promise.all([
    execFileAsync('tar', ['-tzf', tarball], {maxBuffer: 10 * 1024 * 1024}),
    execFileAsync('tar', ['-tvzf', tarball], {maxBuffer: 10 * 1024 * 1024}),
  ]);
  const names = namesOutput.split('\n').filter(Boolean);
  assert.ok(names.length > 0, `Package tarball is empty: ${tarball}.`);
  for (const name of names) {
    const segments = name.split('/').filter(Boolean);
    assert.equal(segments[0], 'package', `Tarball entry must stay under package/: ${name}.`);
    assert.equal(segments.includes('..'), false, `Tarball entry traverses its root: ${name}.`);
  }
  for (const line of verboseOutput.split('\n').filter(Boolean)) {
    assert.match(line, /^[-d]/u, `Tarball contains a non-file entry: ${line}.`);
  }
  await execFileAsync('mkdir', ['-p', destination]);
  await execFileAsync('tar', ['-xzf', tarball, '-C', destination]);
}

async function listRegularFiles(root) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }

      const metadata = await lstat(path);
      assert.equal(metadata.isFile(), true, `Unexpected non-regular tarball entry: ${path}`);
      files.push(relative(root, path));
    }
  }

  await visit(root);
  return files.sort();
}

function canonicalManifest(bytes, mode) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (mode === 'material') {
    delete manifest.version;
    delete manifest.devDependencies;
  }
  return JSON.stringify(sortManifest(manifest));
}

function sortManifest(manifest) {
  return Object.fromEntries(
    Object.entries(manifest)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        // Node resolves conditional targets in declaration order, including nested conditions.
        sortRecursively(value, key === 'exports' || key === 'imports'),
      ]),
  );
}

function sortRecursively(value, preserveObjectOrder = false) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortRecursively(entry, preserveObjectOrder));
  }
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  if (!preserveObjectOrder) entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, sortRecursively(entry, preserveObjectOrder)]),
  );
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function main() {
  const args = process.argv.slice(2);
  const material = args[0] === '--material';
  if (material) args.shift();
  const [candidate, published] = args;
  assert.ok(candidate && published && args.length === 2, 'Expected two package tarball paths.');
  const result = await comparePackageTarballs(candidate, published, {
    mode: material ? 'material' : 'exact',
  });
  assert.equal(result.equal, true, `Published package differs: ${result.differences.join(', ')}.`);
  console.log(`Tarball contents match: ${resolve(candidate)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
