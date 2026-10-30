import assert from 'node:assert/strict';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import test, {type TestContext} from 'node:test';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {startJsonFixtureProcess} from '../../../test-support/fixture-json-process';
import {startFixtureProcess} from '../../../test-support/fixture-process';
import {fixtureResources} from '../../../test-support/fixture-resources';

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

test('fixture cleanup releases every resource in dependency order after a failure', async () => {
  let cleanup!: () => Promise<void>;
  const t = {
    after(callback: () => Promise<void>) {
      cleanup = callback;
    },
  } as TestContext;
  const order: string[] = [];
  const failure = new Error('server cleanup failed');
  fixtureResources(t).push(async () => {
    order.push('directory');
  });
  fixtureResources(t).push(async () => {
    order.push('server');
    throw failure;
  });
  fixtureResources(t).push(async () => {
    order.push('consumer');
  });

  await assert.rejects(
    cleanup(),
    (error: unknown) => error instanceof AggregateError && error.errors[0] === failure,
  );
  assert.deepEqual(order, ['consumer', 'server', 'directory']);
});

test(
  'JSON stop requests preserve the stopped event while consumer cleanup is pending',
  {timeout: 10_000},
  async (t) => {
    const running = startJsonFixtureProcess(
      t,
      [
        '--eval',
        `process.on('message', message => {
          if (message.type !== 'tileflow:stop') return;
          process.stdout.write(JSON.stringify({event: 'stopping'}) + '\\n');
          setTimeout(() => {
            process.stdout.write(JSON.stringify({event: 'stopped'}) + '\\n');
            process.disconnect();
          }, 400);
        });
        process.stdout.write(JSON.stringify({event: 'ready'}) + '\\n');`,
      ],
      {shutdownMs: 100},
    );

    await running.waitFor((event) => event.event === 'ready');
    running.requestStop();
    running.requestStop();
    await running.waitFor((event) => event.event === 'stopped');

    assert.equal((await running.completion).code, 0);
    assert.equal(running.events.filter((event) => event.event === 'stopping').length, 1);
    assert.equal(running.events.filter((event) => event.event === 'stopped').length, 1);
  },
);

test(
  'JSON fixture cleanup still terminates an unresponsive consumer after a stop request',
  {timeout: 10_000},
  async (t) => {
    const running = startJsonFixtureProcess(
      t,
      [
        '--eval',
        `process.on('message', () => {});
        process.stdout.write(JSON.stringify({event: 'ready'}) + '\\n');`,
      ],
      {shutdownMs: 100},
    );

    await running.waitFor((event) => event.event === 'ready');
    running.requestStop();
    await running.stop();

    assert.notEqual((await running.completion).code, 0);
  },
);

test(
  'JSON fixture cancellation rejects pending event waits and releases its worker',
  {timeout: 10_000},
  async (t) => {
    const controller = new AbortController();
    const reason = new Error('fixture cancelled');
    const context = {signal: controller.signal, after: t.after.bind(t)} as TestContext;
    const running = startJsonFixtureProcess(
      context,
      ['--eval', "process.on('message', () => {}); process.send('ready');"],
      {shutdownMs: 100},
    );
    const pending = assert.rejects(
      running.waitFor(() => false, 60_000),
      reason,
    );
    const completion = assert.rejects(running.completion, reason);
    await once(running.child, 'message');
    controller.abort(reason);
    await Promise.all([pending, completion, running.stop()]);
    await assert.rejects(
      running.waitFor(() => false),
      reason,
    );
  },
);

test(
  'JSON fixture exit rejects missing events and preserves failure status',
  {timeout: 10_000},
  async (t) => {
    const running = startJsonFixtureProcess(t, [
      '--eval',
      'process.stdout.write(JSON.stringify({event:"ready"}) + "\\n"); process.exitCode = 7;',
    ]);
    const ready = await running.waitFor((event) => event.event === 'ready');
    assert.equal(ready.event, 'ready');
    await assert.rejects(
      running.waitFor((event) => event.event === 'missing'),
      /\(7\)/u,
    );
    assert.equal((await running.completion).code, 7);
  },
);

test('unknown CLI fixture modes fail without falling back to source', () => {
  const previous = process.env.TILEFLOW_TEST_CLI_MODE;
  process.env.TILEFLOW_TEST_CLI_MODE = 'unknown';
  try {
    assert.throws(() => cliFixtureArguments(['--help']), /must be source or built/u);
  } finally {
    if (previous === undefined) delete process.env.TILEFLOW_TEST_CLI_MODE;
    else process.env.TILEFLOW_TEST_CLI_MODE = previous;
  }
});

test('CLI source fixtures resolve their loader outside ESM packages', () => {
  const previous = process.env.TILEFLOW_TEST_CLI_MODE;
  process.env.TILEFLOW_TEST_CLI_MODE = 'source';
  try {
    const args = cliFixtureArguments(['--version']);
    assert.equal(args[0], '--import');
    assert.ok(existsSync(new URL(args[1]!)));
    assert.ok(existsSync(args[2]!));
    assert.equal(args.at(-1), '--version');
  } finally {
    if (previous === undefined) delete process.env.TILEFLOW_TEST_CLI_MODE;
    else process.env.TILEFLOW_TEST_CLI_MODE = previous;
  }
});
