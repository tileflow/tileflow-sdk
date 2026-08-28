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
  assert.equal((await fetch(`http://127.0.0.1:${port}/styles/main/light.json`)).status, 200);

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

  running.requestStop();
  const stopped = await running.waitFor((event) => event.event === 'stopped');
  assert.equal(stopped.generation, 3);
  const completion = await running.completion;
  assert.equal(completion.code, 0, completion.stderr);
  assert.doesNotMatch(completion.stderr, /watch-secret/);
});

test('preview comparison serves two watched sides and their memory-only inspection sidecars', async (t) => {
  const cwd = await createFixture('tileflow-dev-compare-');
  await writeWatchFixture(cwd, '#315744');
  const port = await reservePort();
  const running = startCli(
    cwd,
    ['preview', '--json', '--map', 'main', '--against-map', 'main', '--port', String(port)],
    {TILEFLOW_API_KEY: 'comparison-secret'},
  );
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
  });

  await Promise.all([
    running.waitFor((event) => event.command === 'dev.compare' && event.side === 'left'),
    running.waitFor((event) => event.command === 'dev.compare' && event.side === 'right'),
  ]);
  await fetchEventually(`http://127.0.0.1:${port}/left/__status`);
  await fetchEventually(`http://127.0.0.1:${port}/right/__status`);

  const shell = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(shell, /Tileflow visual workbench/u);
  assert.match(shell, /Side by side/u);
  assert.match(shell, /Copy scene/u);
  assert.doesNotMatch(shell, /"captureConfig":/u);
  assert.equal(shell.includes(cwd), false);
  assert.equal((await fetch(`http://127.0.0.1:${port}/left/styles/main/light.json`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/right/styles/main/light.json`)).status, 200);

  const sidecarResponse = await fetch(`http://127.0.0.1:${port}/left/__inspection/main/light.json`);
  assert.equal(sidecarResponse.status, 200);
  const sidecar = (await sidecarResponse.json()) as {
    layers?: Array<{contributions?: unknown[]}>;
    map?: string;
    schemaVersion?: number;
    theme?: string;
  };
  assert.equal(sidecar.schemaVersion, 1);
  assert.equal(sidecar.map, 'main');
  assert.equal(sidecar.theme, 'light');
  assert.ok(Array.isArray(sidecar.layers));
  assert.equal(JSON.stringify(running.events).includes(cwd), false);
  assert.doesNotMatch(`${JSON.stringify(running.events)}\n`, /comparison-secret/u);

  running.requestStop();
  const stopped = await running.waitFor(
    (event) => event.command === 'dev.compare' && event.event === 'stopped',
  );
  assert.deepEqual(Object.keys(stopped.generation as object).sort(), ['left', 'right']);
  const completion = await running.completion;
  assert.equal(completion.code, 0, completion.stderr);
});

test('preview comparison publishes distinct cwd-relative config arguments for Copy command', async (t) => {
  const cwd = await createFixture('tileflow-dev-compare-configs-');
  await writeWatchFixture(cwd, '#315744');
  const leftConfig = join(cwd, 'candidate config.ts');
  const rightConfig = join(cwd, "reference's config.ts");
  await Promise.all([
    writeFile(leftConfig, createValidConfig(), 'utf8'),
    writeFile(rightConfig, createValidConfig(), 'utf8'),
  ]);
  const port = await reservePort();
  const running = startCli(cwd, [
    'preview',
    '--json',
    '--config',
    leftConfig,
    '--against-config',
    rightConfig,
    '--map',
    'main',
    '--against-map',
    'main',
    '--port',
    String(port),
  ]);
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
  });

  await Promise.all([
    running.waitFor((event) => event.command === 'dev.compare' && event.side === 'left'),
    running.waitFor((event) => event.command === 'dev.compare' && event.side === 'right'),
  ]);
  await Promise.all([
    fetchEventually(`http://127.0.0.1:${port}/left/__status`),
    fetchEventually(`http://127.0.0.1:${port}/right/__status`),
  ]);
  const shell = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(shell, /"captureConfig":"candidate config\.ts"/u);
  assert.match(shell, /"captureConfig":"reference's config\.ts"/u);
  assert.equal(shell.includes(cwd), false);

  running.requestStop();
  await running.waitFor((event) => event.command === 'dev.compare' && event.event === 'stopped');
  const completion = await running.completion;
  assert.equal(completion.code, 0, completion.stderr);
});

test('preview comparison keeps initial invalid --json output structured and omits stopped', async (t) => {
  const cwd = await createFixture('tileflow-dev-compare-initial-invalid-');
  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  const port = await reservePort();
  const running = startCli(cwd, [
    'preview',
    '--json',
    '--map',
    'main',
    '--against-map',
    'main',
    '--port',
    String(port),
  ]);
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100});
  });

  const failure = await running.waitFor(
    (event) => event.command === 'dev.compare' && event.event === 'error',
  );
  assert.equal(failure.code, 'COMPARISON_INITIAL_INVALID');
  assert.equal(failure.phase, 'initialization');
  assert.ok(Array.isArray(failure.diagnostics));
  assert.equal((failure.diagnostics as unknown[]).length > 0, true);

  const completion = await running.completion;
  assert.equal(completion.code, 1, completion.stderr);
  assert.equal(completion.stderr, '');
  assert.equal(running.events.filter((event) => event.event === 'invalid').length, 2);
  assert.equal(
    running.events.some((event) => event.event === 'stopped'),
    false,
  );
  assert.equal(
    running.events.every((event) => event.command === 'dev.compare'),
    true,
  );
  assert.equal(JSON.stringify(running.events).includes(cwd), false);
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

    running.requestStop();
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
  running.requestStop();
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
    imports: `import tokens from './tokens.json';
import {defineTheme} from '@tileflow/core';
import {streetsThemes} from '@tileflow/maps';`,
    setup: `if (process.env.TILEFLOW_API_KEY) throw new Error('ambient API key reached watched config');
const fixtureTheme = defineTheme(streetsThemes.light, {
  id: 'fixture-light',
  version: 1,
  colorScheme: 'light',
  tokens: {color: {'surface.background': tokens.background}}
});`,
    fields: `${data}themes: {light: fixtureTheme},
      defaultTheme: 'light',
      scenes: {
    proof: {
      theme: 'light',
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
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
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
  const requestStop = () => {
    if (exited) return;
    if (child.connected) {
      try {
        child.send({type: 'tileflow:stop'}, (error) => {
          if (error && !exited) child.kill('SIGTERM');
        });
        return;
      } catch {
        child.kill('SIGTERM');
        return;
      }
    }
    child.kill('SIGTERM');
  };

  return {
    child,
    completion,
    events,
    requestStop,
    stop: async () => {
      requestStop();
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
