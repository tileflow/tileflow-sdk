import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {startFixtureProcess} from '../../../test-support/fixture-process';

test('fixture processes preserve output and unsuccessful exit codes', async () => {
  const running = startFixtureProcess([
    '--eval',
    "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7",
  ]);
  assert.deepEqual(await running.completion, {code: 7, stdout: 'out', stderr: 'err'});
  await running.stop();
});

test(
  'fixture cleanup requests a graceful IPC stop and can be repeated',
  {timeout: 10_000},
  async () => {
    const running = startFixtureProcess([
      '--eval',
      `process.on('message', message => {
      if (message.type === 'tileflow:stop') {
        process.stdout.write('stopped');
        process.disconnect();
      }
    });
    process.send('ready');`,
    ]);

    try {
      await once(running.child, 'message');
      await Promise.all([running.stop(), running.stop()]);
      assert.deepEqual(await running.completion, {code: 0, stdout: 'stopped', stderr: ''});
    } finally {
      await running.stop();
    }
  },
);

test(
  'fixture cleanup terminates an unresponsive consumer and its descendants',
  {timeout: 10_000},
  async () => {
    const running = startFixtureProcess(
      [
        '--eval',
        `const {spawn} = require('node:child_process');
    const descendant = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'inherit', 'inherit']
    });
    descendant.once('spawn', () => process.send(descendant.pid));
    process.on('message', () => {});`,
      ],
      {shutdownMs: 100},
    );

    try {
      const [pid] = await once(running.child, 'message');
      await running.stop();
      assert.notEqual((await running.completion).code, 0);
      // The descendant inherits stdout; completion requires its pipe to close too.
      assert.equal(typeof pid, 'number');
    } finally {
      await running.stop();
    }
  },
);

test(
  'test cancellation stops its consumer and rejects further work',
  {timeout: 10_000},
  async () => {
    const controller = new AbortController();
    const reason = new Error('Test cancelled');
    const running = startFixtureProcess(
      ['--eval', "process.on('message', () => process.disconnect()); process.send('ready')"],
      {signal: controller.signal},
    );
    const rejected = assert.rejects(running.completion, reason);

    await once(running.child, 'message');
    controller.abort(reason);
    await rejected;
    await running.stop();
    assert.throws(() => startFixtureProcess(['--eval', ''], {signal: controller.signal}), reason);
  },
);

test('fixture spawn failures settle cleanup', async () => {
  const running = startFixtureProcess(['--eval', ''], {cwd: '/missing-tileflow-test-directory'});
  await assert.rejects(running.completion, {code: 'ENOENT'});
  await running.stop();
});
