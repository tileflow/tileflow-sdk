import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {
  readPublishedTargets,
  registryPropagationAttempts,
  registryPropagationIntervalMs,
  waitForPublishedPackages,
} from './wait-for-published-packages.mjs';

const execFileAsync = promisify(execFile);

test('waits collectively for asynchronously processed npm publications', async () => {
  const targets = [
    {name: '@tileflow/next', version: '0.1.0-alpha.19'},
    {name: 'tileflow', version: '0.1.0-alpha.0'},
  ];
  const checks = new Map();
  const sleeps = [];

  const result = await waitForPublishedPackages(targets, {
    attempts: 5,
    intervalMs: 10,
    onRetry: () => {},
    readTag: async (name) => {
      const check = (checks.get(name) ?? 0) + 1;
      checks.set(name, check);
      if (name === '@tileflow/next' && check < 4) return '0.1.0-alpha.18';
      return targets.find((target) => target.name === name).version;
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });

  assert.equal(result.attempt, 4);
  assert.deepEqual(sleeps, [10, 10, 10]);
  assert.equal(checks.get('tileflow'), 1);
  assert.equal(checks.get('@tileflow/next'), 4);
});

test('fails closed with bounded package observations', async () => {
  await assert.rejects(
    waitForPublishedPackages([{name: '@tileflow/next', version: '0.1.0-alpha.19'}], {
      attempts: 2,
      intervalMs: 0,
      onRetry: () => {},
      readTag: async () => {
        const error = new Error('untrusted remote output');
        error.code = 'E404';
        throw error;
      },
      sleep: async () => {},
    }),
    /@tileflow\/next@0\.1\.0-alpha\.19 \(observed E404\)/u,
  );
});

test('allows ten minutes for registry processing without serial package delays', () => {
  assert.equal((registryPropagationAttempts - 1) * registryPropagationIntervalMs, 600_000);
});

test('binds registry convergence targets to the sealed release plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-published-targets-'));

  try {
    const fixture = join(root, 'fixture', 'package');
    const selected = join(root, 'selected');
    await Promise.all([mkdir(fixture, {recursive: true}), mkdir(selected)]);
    await writeFile(
      join(fixture, 'package.json'),
      `${JSON.stringify({name: '@tileflow/static', version: '0.1.0-alpha.19'})}\n`,
    );
    const relativeTarball = 'selected/tileflow-static-0.1.0-alpha.19.tgz';
    await execFileAsync('tar', [
      '-czf',
      join(root, relativeTarball),
      '-C',
      join(root, 'fixture'),
      'package',
    ]);
    const selectedListPath = join(root, 'selected-relative.txt');
    await writeFile(selectedListPath, `${relativeTarball}\n`);
    await writePlan(root, {name: '@tileflow/static', to: '0.1.0-alpha.19'});

    assert.deepEqual(await readPublishedTargets(selectedListPath, root), [
      {name: '@tileflow/static', version: '0.1.0-alpha.19'},
    ]);

    await writePlan(root, {name: '@tileflow/core', to: '0.1.0-alpha.19'});
    await assert.rejects(
      readPublishedTargets(selectedListPath, root),
      /order differs from release plan/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

async function writePlan(root, release) {
  await writeFile(join(root, 'plan.json'), `${JSON.stringify({packages: [release]})}\n`);
}
