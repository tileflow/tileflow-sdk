import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {CoordinatesNativeError, createNativeRunner} from '../src/native';

const fixture = fileURLToPath(new URL('./native-fixture.mjs', import.meta.url));

test('runs isolated JSON processes and maps malformed and failed processes', async () => {
  const runner = createRunner();
  try {
    assert.deepEqual(await runner.run({mode: 'echo'}), {ok: true, mode: 'echo'});
    for (const mode of ['malformed', 'exit']) {
      await assert.rejects(
        runner.run({mode}),
        (error: unknown) =>
          error instanceof CoordinatesNativeError &&
          error.code === (mode === 'malformed' ? 'INVALID_RESPONSE' : 'UNAVAILABLE'),
      );
    }
  } finally {
    runner.close();
  }
});

test('rejects oversized input before spawning and oversized output after bounded capture', async () => {
  const runner = createRunner();
  try {
    await assert.rejects(
      runner.run({payload: 'x'.repeat(33 * 1024)}),
      (error: unknown) => error instanceof CoordinatesNativeError && error.code === 'UNAVAILABLE',
    );
    await assert.rejects(
      runner.run({mode: 'oversized'}),
      (error: unknown) =>
        error instanceof CoordinatesNativeError && error.code === 'INVALID_RESPONSE',
    );
  } finally {
    runner.close();
  }
});

test('runs at most two processes, bounds the queue, and close cancels active and queued work', async () => {
  const marker = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-native-queue-'));
  const runner = createRunner();
  const work = [
    runner.run({mode: 'hold', marker, milliseconds: 30_000}),
    runner.run({mode: 'hold', marker, milliseconds: 30_000}),
    ...Array.from({length: 16}, () => runner.run({mode: 'hold', marker, milliseconds: 30_000})),
  ];
  try {
    await waitFor(async () => (await readdir(marker)).length === 2);
    assert.equal((await readdir(marker)).length, 2);
    await assert.rejects(
      runner.run({mode: 'echo'}),
      (error: unknown) => error instanceof CoordinatesNativeError && error.code === 'UNAVAILABLE',
    );
    runner.close();
    const results = await Promise.allSettled(work);
    assert.equal(
      results.every(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof CoordinatesNativeError &&
          result.reason.code === 'CANCELLED',
      ),
      true,
    );
    await assert.rejects(
      runner.run({mode: 'echo'}),
      (error: unknown) => error instanceof CoordinatesNativeError && error.code === 'UNAVAILABLE',
    );
  } finally {
    runner.close();
    await rm(marker, {force: true, recursive: true});
  }
});

test('an abort signal kills active work without forwarding its reason', async () => {
  const marker = await mkdtemp(join(tmpdir(), 'tileflow-coordinates-native-abort-'));
  const runner = createRunner();
  const controller = new AbortController();
  try {
    const pending = runner.run({mode: 'hold', marker, milliseconds: 30_000}, controller.signal);
    await waitFor(async () => (await readdir(marker)).length === 1);
    controller.abort('private abort reason');
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof CoordinatesNativeError &&
        error.code === 'CANCELLED' &&
        !error.message.includes('private abort reason'),
    );
  } finally {
    runner.close();
    await rm(marker, {force: true, recursive: true});
  }
});

test('a process that outlives the native deadline is terminated as a timeout', async () => {
  const runner = createRunner();
  const started = Date.now();
  try {
    await assert.rejects(
      runner.run({mode: 'hold', milliseconds: 16_000}),
      (error: unknown) => error instanceof CoordinatesNativeError && error.code === 'TIMEOUT',
    );
    assert.ok(Date.now() - started >= 14_000);
  } finally {
    runner.close();
  }
});

function createRunner() {
  return createNativeRunner(process.execPath, fixture, dirname(fixture));
}

async function waitFor(predicate: () => Promise<boolean>, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for native fixture');
}
