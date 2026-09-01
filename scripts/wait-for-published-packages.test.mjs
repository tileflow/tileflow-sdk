import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registryPropagationAttempts,
  registryPropagationIntervalMs,
  waitForPublishedPackages,
} from './wait-for-published-packages.mjs';

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
