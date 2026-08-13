import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {lstat, mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';

const [candidateArgument, publishedArgument] = process.argv.slice(2);
assert.ok(
  candidateArgument && publishedArgument,
  'Expected candidate and published tarball paths.',
);

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
  assert.deepEqual(candidateFiles, publishedFiles, 'Published package file list differs.');

  for (const path of candidateFiles) {
    const [candidateMetadata, publishedMetadata, candidateBytes, publishedBytes] =
      await Promise.all([
        lstat(join(candidateRoot, path)),
        lstat(join(publishedRoot, path)),
        readFile(join(candidateRoot, path)),
        readFile(join(publishedRoot, path)),
      ]);
    assert.equal(
      candidateMetadata.mode & 0o777,
      publishedMetadata.mode & 0o777,
      `Published package file mode differs: ${path}`,
    );

    if (path === 'package/package.json') {
      assert.equal(
        canonicalManifest(candidateBytes),
        canonicalManifest(publishedBytes),
        'Published package manifest differs.',
      );
      continue;
    }

    assert.equal(
      candidateBytes.equals(publishedBytes),
      true,
      `Published package file differs: ${path}`,
    );
  }

  console.log(`Tarball contents match: ${candidate}`);
} finally {
  await rm(temporaryRoot, {force: true, recursive: true});
}

async function extractTarball(tarball, destination) {
  await run('mkdir', ['-p', destination]);
  await run('tar', ['-xzf', tarball, '-C', destination]);
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

function canonicalManifest(bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  for (const group of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    if (manifest[group]) manifest[group] = sortObject(manifest[group]);
  }
  return JSON.stringify(sortObject(manifest));
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {shell: false, stdio: 'inherit'});
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(new Error(`${command} failed${signal ? ` after ${signal}` : ` with ${code}`}.`));
    });
  });
}
