import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {createReleaseReceipt} from './create-release-receipt.mjs';

const execFileAsync = promisify(execFile);

test('binds the final receipt to the exact ordered tarballs and bundle digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-receipt-'));
  try {
    const selected = join(root, 'selected');
    await mkdir(selected);
    const releases = [
      {name: '@tileflow/core', from: '0.1.0-alpha.16', to: '0.1.0-alpha.17'},
      {name: '@tileflow/maps', from: null, to: '0.1.0-alpha.0'},
    ];
    const relativeTarballs = [];
    for (const release of releases) {
      const fixture = join(root, release.name.replace('@tileflow/', 'fixture-'));
      await mkdir(join(fixture, 'package'), {recursive: true});
      await writeFile(
        join(fixture, 'package', 'package.json'),
        `${JSON.stringify({name: release.name, version: release.to})}\n`,
      );
      const filename = `${release.name.replace('@tileflow/', 'tileflow-')}-${release.to}.tgz`;
      await execFileAsync('tar', ['-czf', join(selected, filename), '-C', fixture, 'package']);
      relativeTarballs.push(`selected/${filename}`);
    }
    const planPath = join(root, 'plan.json');
    const selectedListPath = join(root, 'selected-relative.txt');
    await writeFile(
      planPath,
      `${JSON.stringify({
        schemaVersion: 4,
        channel: 'alpha',
        sourceSha: 'a'.repeat(40),
        packages: releases.map((release) => ({
          ...release,
          differences: ['package/dist/index.js'],
        })),
      })}\n`,
    );
    await writeFile(selectedListPath, `${relativeTarballs.join('\n')}\n`);

    const receipt = await createReleaseReceipt({
      bundleSha256: 'b'.repeat(64),
      planPath,
      selectedListPath,
    });
    assert.equal(receipt.sourceSha, 'a'.repeat(40));
    assert.equal(receipt.bundleSha256, 'b'.repeat(64));
    assert.deepEqual(
      receipt.packages.map(({from, name, to}) => ({from, name, to})),
      releases,
    );
    assert.ok(receipt.packages.every(({tarballSha256}) => /^[0-9a-f]{64}$/u.test(tarballSha256)));
    assert.ok(
      receipt.packages.every(({npmIntegrity}) => /^sha512-[A-Za-z0-9+/]+=*$/u.test(npmIntegrity)),
    );

    const reversedPath = join(root, 'reversed.txt');
    await writeFile(reversedPath, `${relativeTarballs.toReversed().join('\n')}\n`);
    await assert.rejects(
      createReleaseReceipt({
        bundleSha256: 'b'.repeat(64),
        planPath,
        selectedListPath: reversedPath,
      }),
      /order differs/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
