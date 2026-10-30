import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {inspect} from 'node:util';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const comparison = ['--map', 'main', '--against-map', 'main'];

for (const [label, args] of [
  ['single map', []],
  ['comparison', comparison],
] as const) {
  test(`preview opens ${label} Inspector once, after the server is listening`, async (t) => {
    const preview = await startPreview(t, [...args]);
    await waitUntil(async () => (await preview.opened()).length === 1, preview.diagnostics);
    assert.deepEqual(await preview.opened(), [preview.origin]);
    const response = await fetch(preview.origin);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Tileflow Inspector/u);

    await writeFile(preview.configPath, tileflowMapFixture({id: 'main', version: 2}));
    const basePath = args.length ? '/left' : '/map';
    await waitUntil(async () => {
      const status = await fetch(`${preview.origin}${basePath}/__status`);
      return (await status.json()).generation >= 2;
    }, preview.diagnostics);
    const result = await preview.stop();
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await preview.opened(), [preview.origin]);
  });
}

for (const [label, args] of [
  ['--no-open', ['--no-open']],
  ['comparison --no-open', [...comparison, '--no-open']],
  ['--json', ['--json']],
  ['comparison --json', [...comparison, '--json']],
  ['native assets', ['--renderer', 'native']],
] as const) {
  test(`preview keeps the browser closed for ${label}`, async (t) => {
    const preview = await startPreview(t, [...args]);
    await waitUntil(async () => {
      await fetch(preview.origin);
      return true;
    }, preview.diagnostics);
    const result = await preview.stop();
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await preview.opened(), []);
  });
}

test('preview does not open the browser if its port is already occupied', async (t) => {
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
  const preview = await startPreview(t, [], address.port);
  const result = await preview.completion;
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /EADDRINUSE|address already in use/iu);
  assert.deepEqual(await preview.opened(), []);
});

for (const [state, exitCode, signalCode] of [
  ['running', null, null],
  ['exited', 7, null],
  ['signalled', null, 'SIGTERM'],
] as const) {
  test(`preview timeout diagnoses the ${state} process without extending the deadline`, async (t) => {
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    const connection = Object.assign(new Error('connection refused'), {code: 'ECONNREFUSED'});
    const failure = new TypeError('fetch failed', {cause: connection});
    const snapshot = {
      origin: 'http://127.0.0.1:43210',
      pid: 12345,
      exitCode,
      signalCode,
      stdout: 'Preparing comparison',
      stderr: '',
    };
    let attempts = 0;
    let snapshots = 0;

    await assert.rejects(
      waitUntil(
        async () => {
          attempts += 1;
          now += 15_000;
          snapshot.stderr = 'Comparison preparation failed';
          throw failure;
        },
        () => {
          snapshots += 1;
          return snapshot;
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.cause, failure);
        for (const value of [
          snapshot.origin,
          snapshot.stdout,
          snapshot.stderr,
          connection.code,
          `pid: ${snapshot.pid}`,
          `exitCode: ${exitCode}`,
          `signalCode: ${signalCode ? `'${signalCode}'` : 'null'}`,
          '15000',
        ])
          assert.ok(error.message.includes(value), `Missing diagnostic: ${value}`);
        return true;
      },
    );
    assert.equal(attempts, 1);
    assert.equal(snapshots, 1);
  });
}

test('successful preview polling retains retries without collecting failure diagnostics', async () => {
  let attempts = 0;
  await waitUntil(
    async () => ++attempts === 2,
    () => assert.fail('A successful wait must not collect failure diagnostics.'),
  );
  assert.equal(attempts, 2);
});

async function startPreview(t: TestContext, args: string[], port?: number) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-preview-open-'));
  await linkWorkspacePackages(cwd);
  const configPath = join(cwd, 'tileflow.config.ts');
  await writeFile(configPath, tileflowMapFixture({id: 'main'}));
  const logPath = join(cwd, 'opened.jsonl');
  await writeFile(logPath, '');
  const preloadPath = join(cwd, 'record-browser-open.mjs');
  // Intercept only the OS browser launcher; leave compilation subprocesses intact.
  await writeFile(
    preloadPath,
    `import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (!['open', 'xdg-open', 'explorer.exe'].includes(command)) {
    return originalSpawn(command, args, options);
  }
  appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args[0]) + '\\n');
  return Object.assign(new EventEmitter(), {unref() {}});
};
syncBuiltinESMExports();
`,
  );
  if (port === undefined) {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(preloadPath).href,
      ...cliFixtureArguments(['preview', '--port', String(port), ...args]),
    ],
    {
      cwd,
      env: {...process.env, NO_COLOR: '1', TILEFLOW_API_KEY: ''},
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<{code: number | null; stdout: string; stderr: string}>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({code, stdout, stderr}));
    },
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send({type: 'tileflow:stop'});
      else child.kill('SIGTERM');
    }
    return completion;
  };
  t.after(async () => {
    await stop();
    await rm(cwd, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  return {
    completion,
    configPath,
    diagnostics: () => ({
      origin: `http://127.0.0.1:${port}`,
      pid: child.pid,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      stdout,
      stderr,
    }),
    opened: async (): Promise<string[]> =>
      (await readFile(logPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    origin: `http://127.0.0.1:${port}`,
    stop,
  };
}

async function waitUntil(predicate: () => Promise<boolean>, diagnostics: () => unknown) {
  const started = Date.now();
  const deadline = started + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for preview.\n${inspect(
      {elapsedMs: Date.now() - started, preview: diagnostics(), lastError},
      {depth: null, colors: false},
    )}`,
    {cause: lastError},
  );
}
