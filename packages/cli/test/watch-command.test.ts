import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

test('dev emits valid/invalid/recovered/stopped NDJSON and serves last-good local preview assets', async (t) => {
  const cwd = await createFixture('tileflow-dev-watch-');
  await writeWatchFixture(cwd, '#112233');
  const port = await reservePort();
  const running = startCli(cwd, ['dev', '--json', '--map', 'main', '--port', String(port)], {
    TILEFLOW_API_KEY: 'watch-secret',
  });
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
  });

  const ready = await running.waitFor((event) => event.event === 'ready');
  assert.equal(ready.generation, 1);
  const status = await fetchEventually(`http://127.0.0.1:${port}/__status`);
  assert.equal(status.status, 'ready');
  const preview = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.doesNotMatch(preview, /unpkg|fonts\.googleapis|fonts\.gstatic/);

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  const invalid = await running.waitFor((event) => event.event === 'invalid');
  assert.equal(invalid.generation, 2);
  assert.equal(invalid.lastGoodGeneration, 1);
  assert.equal(invalid.code, 'CONFIG_INVALID');
  assert.equal(invalid.phase, 'config-validation');
  assert.equal((invalid.diagnostics as Array<Record<string, unknown>>)[0]?.code, 'CONFIG_INVALID');
  assert.equal(
    (invalid.diagnostics as Array<Record<string, unknown>>)[0]?.phase,
    'config-validation',
  );
  const invalidStatus = await fetchEventually(
    `http://127.0.0.1:${port}/__status`,
    (body) => body.status === 'invalid',
  );
  assert.equal(invalidStatus.lastGoodGeneration, 1);
  assert.equal((await fetch(`http://127.0.0.1:${port}/styles/main.json`)).status, 200);

  await writeFile(join(cwd, 'tileflow.config.ts'), createValidConfig(), 'utf8');
  const recovered = await running.waitFor((event) => event.event === 'recovered');
  assert.equal(recovered.generation, 3);
  assert.equal(
    running.events.some(
      (event) =>
        event.event === 'ready' &&
        typeof event.generation === 'number' &&
        event.generation > Number(invalid.generation),
    ),
    false,
  );
  assert.equal(JSON.stringify(running.events).includes(cwd), false);
  assert.doesNotMatch(`${JSON.stringify(running.events)}\n`, /watch-secret/);

  running.child.kill('SIGTERM');
  if (process.platform === 'win32') {
    const completion = await running.completion;
    assert.equal(completion.code, null, completion.stderr);
    assert.doesNotMatch(completion.stderr, /watch-secret/);
    return;
  }
  const stopped = await running.waitFor((event) => event.event === 'stopped');
  assert.equal(stopped.generation, 3);
  const completion = await running.completion;
  assert.equal(completion.code, 0, completion.stderr);
  assert.doesNotMatch(completion.stderr, /watch-secret/);
});

test(
  'capture watch reuses a long-running process, preserves output on invalid edits, and recovers',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async (t) => {
    const cwd = await createFixture('tileflow-capture-watch-');
    const fixture = await createVectorFixtureServer(t);
    await writeWatchFixture(cwd, '#112233', fixture.origin);
    const running = startCli(
      cwd,
      ['capture', 'proof', '--watch', '--json', '--no-browser-install'],
      {
        ...(process.env.HOME ? {HOME: process.env.HOME} : {}),
        ...(process.env.USERPROFILE ? {USERPROFILE: process.env.USERPROFILE} : {}),
      },
    );
    t.after(async () => {
      await running.stop();
      await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
    });

    const first = await running.waitFor(
      (event) => event.event === 'captured' || event.event === 'failed',
      45_000,
    );
    assert.equal(first.event, 'captured', JSON.stringify(first));
    const outputPath = join(cwd, String(first.outputPath));
    const firstPng = await readFile(outputPath);
    assert.deepEqual([...firstPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    await writeFile(join(cwd, 'tokens.json'), '{"background":"#445566"}\n', 'utf8');
    const second = await running.waitFor(
      (event) => event.event === 'captured' && Number(event.generation) > Number(first.generation),
      45_000,
    );
    assert.match(String(second.sha256), /^[a-f0-9]{64}$/);

    await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
    const invalid = await running.waitFor((event) => event.event === 'invalid');
    assert.equal(invalid.code, 'CONFIG_INVALID');
    assert.equal(invalid.phase, 'config-validation');
    const preserved = await readFile(outputPath);
    assert.equal(preserved.length > 24, true);

    await writeFile(join(cwd, 'tileflow.config.ts'), createValidConfig(fixture.origin), 'utf8');
    const recovered = await running.waitFor(
      (event) =>
        event.event === 'recovered' && Number(event.generation) > Number(invalid.generation),
    );
    const third = await running.waitFor(
      (event) =>
        event.event === 'captured' && Number(event.generation) >= Number(recovered.generation),
      45_000,
    );
    assert.equal(third.outputPath, first.outputPath);
    assert.equal(JSON.stringify(running.events).includes(cwd), false);

    running.child.kill('SIGINT');
    if (process.platform === 'win32') {
      const completion = await running.completion;
      assert.equal(completion.code, null, completion.stderr);
      return;
    }
    await running.waitFor((event) => event.event === 'stopped');
    const completion = await running.completion;
    assert.equal(completion.code, 0, completion.stderr);
  },
);

test('capture watch exits nonzero when stopped with no valid capture and an invalid generation', async (t) => {
  const cwd = await createFixture('tileflow-capture-watch-invalid-stop-');
  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  const running = startCli(cwd, ['capture', 'proof', '--watch', '--json', '--no-browser-install']);
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
  });

  await running.waitFor((event) => event.event === 'invalid');
  running.child.kill('SIGTERM');
  if (process.platform === 'win32') {
    const completion = await running.completion;
    assert.equal(completion.code, null, completion.stderr);
    return;
  }
  await running.waitFor((event) => event.event === 'stopped');
  const completion = await running.completion;
  assert.equal(completion.code, 1, completion.stderr);
});

function createValidConfig(tileOrigin?: string): string {
  const data =
    tileOrigin === undefined
      ? ''
      : `data: {
        type: 'vector-tiles',
        tiles: [${JSON.stringify(`${tileOrigin}/tiles/world/{z}/{x}/{y}.pbf`)}],
        minzoom: 0,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85],
        revision: 'fixture_1',
        attribution: 'Fixture data',
        schema: {type: 'openmaptiles', contractVersion: 1}
      },
`;
  return tileflowMapFixture({
    id: 'main',
    imports: `import tokens from './tokens.json';`,
    setup: `if (process.env.TILEFLOW_API_KEY) throw new Error('ambient API key reached watched config');`,
    fields: `${data}theme: {colors: {background: tokens.background}},
      scenes: {
    proof: {
      camera: {type: 'center', center: [0, 0], zoom: 0},
      viewport: {width: 128, height: 128}
    }
  }`,
  });
}
const invalidConfig = tileflowMapFixture({
  id: 'main',
  fields: `modules: {poi: {type: 'poi', unsupported: true}}`,
});

async function writeWatchFixture(
  cwd: string,
  background: string,
  tileOrigin?: string,
): Promise<void> {
  await writeFile(join(cwd, 'tokens.json'), `${JSON.stringify({background})}\n`, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), createValidConfig(tileOrigin), 'utf8');
}

async function createFixture(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(directory);
  return directory;
}

async function createVectorFixtureServer(t: TestContext): Promise<{origin: string}> {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if ((request.url?.split('?')[0] ?? '/').endsWith('.pbf')) {
      response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
      response.end(Buffer.alloc(0));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  return {origin: `http://127.0.0.1:${address.port}`};
}

function startCli(cwd: string, arguments_: string[], overrides: NodeJS.ProcessEnv = {}) {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }
  Object.assign(environment, {HOME: cwd, NO_COLOR: '1', USERPROFILE: cwd}, overrides);
  const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const events: Array<Record<string, unknown>> = [];
  const waiters = new Set<{
    predicate: (event: Record<string, unknown>) => boolean;
    reject: (error: Error) => void;
    resolve: (event: Record<string, unknown>) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let stdoutBuffer = '';
  let stderr = '';
  let exited = false;

  child.stderr!.setEncoding('utf8');
  child.stdout!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout!.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  });

  const completion = new Promise<{code: number | null; stderr: string}>(
    (resolveCompletion, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        exited = true;
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(`CLI exited before the expected event (${code}): ${stderr}`));
        }
        waiters.clear();
        resolveCompletion({code, stderr});
      });
    },
  );

  return {
    child,
    completion,
    events,
    stop: async () => {
      if (!exited) child.kill('SIGTERM');
      await completion.catch(() => undefined);
    },
    waitFor: (
      predicate: (event: Record<string, unknown>) => boolean,
      timeoutMs = 10_000,
    ): Promise<Record<string, unknown>> => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveEvent, reject) => {
        const waiter = {
          predicate,
          reject,
          resolve: resolveEvent,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `Timed out waiting for CLI event. events: ${JSON.stringify(events)} stderr: ${stderr}`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function fetchEventually(
  url: string,
  predicate: (body: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = (await response.json()) as Record<string, unknown>;
      if (response.ok && predicate(body)) return body;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out fetching ${url}`);
}
