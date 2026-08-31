import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {comparePackageTarballs} from './compare-package-tarballs.mjs';

const execFileAsync = promisify(execFile);

test('material comparison ignores versions, development dependencies, and manifest key order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-compare-test-'));
  try {
    const left = await tarball(root, 'left', {
      name: '@tileflow/core',
      version: '0.1.0-alpha.16',
      devDependencies: {typescript: '1.0.0'},
      dependencies: {zod: '^4.0.0', react: '^19.0.0'},
    });
    const right = await tarball(root, 'right', {
      dependencies: {react: '^19.0.0', zod: '^4.0.0'},
      devDependencies: {typescript: '2.0.0'},
      version: '0.1.0-alpha.17',
      name: '@tileflow/core',
    });

    assert.deepEqual(await comparePackageTarballs(left, right, {mode: 'material'}), {
      differences: [],
      equal: true,
    });
    assert.deepEqual(await comparePackageTarballs(left, right), {
      differences: ['package/package.json'],
      equal: false,
    });
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('detects semantic condition reordering under package exports and imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-compare-test-'));
  try {
    const importFirst = await tarball(root, 'import-first', {
      name: '@tileflow/core',
      version: '0.1.0-alpha.16',
      exports: {
        '.': {
          import: './dist/index.js',
          default: './dist/fallback.js',
        },
      },
    });
    const defaultFirst = await tarball(root, 'default-first', {
      name: '@tileflow/core',
      version: '0.1.0-alpha.16',
      exports: {
        '.': {
          default: './dist/fallback.js',
          import: './dist/index.js',
        },
      },
    });

    assert.deepEqual(await comparePackageTarballs(importFirst, defaultFirst, {mode: 'material'}), {
      differences: ['package/package.json'],
      equal: false,
    });

    const nodeFirst = await tarball(root, 'node-first', {
      name: '@tileflow/core',
      version: '0.1.0-alpha.16',
      imports: {
        '#internal': {
          node: './dist/node.js',
          default: './dist/fallback.js',
        },
      },
    });
    const importDefaultFirst = await tarball(root, 'import-default-first', {
      name: '@tileflow/core',
      version: '0.1.0-alpha.16',
      imports: {
        '#internal': {
          default: './dist/fallback.js',
          node: './dist/node.js',
        },
      },
    });
    assert.equal(
      (await comparePackageTarballs(nodeFirst, importDefaultFirst, {mode: 'material'})).equal,
      false,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('detects public bytes, file lists, and executable-mode changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-compare-test-'));
  try {
    const baseline = await tarball(
      root,
      'baseline',
      {name: 'tileflow', version: '0.1.0-alpha.16'},
      {
        'dist/index.js': 'export const value = 1;\n',
      },
    );
    const bytes = await tarball(
      root,
      'bytes',
      {name: 'tileflow', version: '0.1.0-alpha.16'},
      {
        'dist/index.js': 'export const value = 2;\n',
      },
    );
    const list = await tarball(
      root,
      'list',
      {name: 'tileflow', version: '0.1.0-alpha.16'},
      {
        'README.md': 'Public docs.\n',
        'dist/index.js': 'export const value = 1;\n',
      },
    );
    const mode = await tarball(
      root,
      'mode',
      {name: 'tileflow', version: '0.1.0-alpha.16'},
      {
        'dist/index.js': {contents: 'export const value = 1;\n', mode: 0o755},
      },
    );

    assert.deepEqual((await comparePackageTarballs(bytes, baseline)).differences, [
      'package/dist/index.js',
    ]);
    assert.deepEqual((await comparePackageTarballs(list, baseline)).differences, [
      'package file list',
    ]);
    assert.deepEqual((await comparePackageTarballs(mode, baseline)).differences, [
      'package/dist/index.js mode',
    ]);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

async function tarball(root, name, manifest, files = {}) {
  const fixtureRoot = join(root, name);
  const packageRoot = join(fixtureRoot, 'package');
  await mkdir(packageRoot, {recursive: true});
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [path, value] of Object.entries(files)) {
    const target = join(packageRoot, path);
    await mkdir(join(target, '..'), {recursive: true});
    const contents = typeof value === 'string' ? value : value.contents;
    await writeFile(target, contents);
    if (typeof value !== 'string' && value.mode) await chmod(target, value.mode);
  }
  const output = join(root, `${name}.tgz`);
  await execFileAsync('tar', ['-czf', output, '-C', fixtureRoot, 'package']);
  return output;
}
