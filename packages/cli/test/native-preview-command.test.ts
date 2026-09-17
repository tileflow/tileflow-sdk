import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseTileflowRuntimeManifest} from '@tileflow/core/manifest';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const validConfig = tileflowMapFixture({id: 'main'});
const invalidConfig = tileflowMapFixture({
  id: 'main',
  fields: `modules: {poi: {type: 'poi', unsupported: true}}`,
});

async function fixture(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  return cwd;
}

function startCli(cwd: string, arguments_: string[]) {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY'])
    delete environment[variable];
  Object.assign(environment, {HOME: cwd, NO_COLOR: '1', USERPROFILE: cwd});
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

  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
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
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const completion = new Promise<{code: number | null; stderr: string}>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      exited = true;
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`CLI exited before expected event (${code}): ${stderr}`));
      }
      waiters.clear();
      resolve({code, stderr});
    });
  });
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
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          reject,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(`Timed out waiting for CLI event: ${JSON.stringify(events)} ${stderr}`),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

function runCli(cwd: string, arguments_: string[]) {
  return new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: {...process.env, NO_COLOR: '1', TILEFLOW_API_KEY: ''},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({code, stdout, stderr}));
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function fetchEventually(url: string): Promise<Response> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status !== 503) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out fetching ${url}`);
}

test('native preview serves canonical native-v1 assets only and preserves last-known-good generations', async (t) => {
  const cwd = await fixture('tileflow-native-preview-');
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const manifestUrl = `${origin}/native/manifest.json`;
  const running = startCli(cwd, [
    'preview',
    '--renderer',
    'native',
    '--json',
    '--map',
    'main',
    '--theme',
    'light',
    '--port',
    String(port),
  ]);
  t.after(async () => {
    await running.stop();
    await rm(cwd, {force: true, recursive: true});
  });

  const ready = await running.waitFor((event) => event.event === 'ready');
  assert.equal(ready.renderer, 'native');
  assert.equal(ready.profile, 'native-v1');
  assert.equal(ready.manifest, manifestUrl);
  assert.equal(ready.assetsOnly, true);

  const manifestResponse = await fetchEventually(manifestUrl);
  assert.equal(manifestResponse.status, 200);
  const manifest = parseTileflowRuntimeManifest(await manifestResponse.json());
  const styleUrl = manifest.maps.main?.themes.light?.styleUrl;
  assert.ok(styleUrl);
  const styleLocation = new URL(styleUrl);
  assert.equal(styleLocation.origin, origin);
  assert.match(
    styleLocation.pathname,
    /^\/native\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
  );
  const styleResponse = await fetch(styleUrl);
  assert.equal(styleResponse.status, 200);
  const style = (await styleResponse.json()) as {version?: number};
  assert.equal(style.version, 8);

  assert.equal((await fetch(`${origin}/`)).status, 404);
  assert.equal((await fetch(`${origin}/native/`)).status, 404);
  assert.equal((await fetch(`${origin}/native/__runtime/tileflow-preview.js`)).status, 404);

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  const invalid = await running.waitFor((event) => event.event === 'invalid');
  assert.equal(invalid.renderer, 'native');
  assert.equal(invalid.profile, 'native-v1');
  assert.equal(invalid.manifest, manifestUrl);
  assert.equal((await fetch(styleUrl)).status, 200);

  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  const recovered = await running.waitFor((event) => event.event === 'recovered');
  assert.equal(recovered.renderer, 'native');
  assert.equal(recovered.profile, 'native-v1');
  assert.equal(Number(recovered.generation) > Number(invalid.generation), true);

  running.requestStop();
  const stopped = await running.waitFor((event) => event.event === 'stopped');
  assert.equal(stopped.renderer, 'native');
  assert.equal(stopped.profile, 'native-v1');
  assert.equal(stopped.manifest, manifestUrl);
  const completion = await running.completion;
  assert.equal(completion.code, 0, completion.stderr);
});

test('native preview rejects browser-only workbench selections before config execution', async (t) => {
  const cwd = await fixture('tileflow-native-preview-reject-');
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "throw new Error('CONFIG_MUST_NOT_EXECUTE');\n",
    'utf8',
  );

  for (const extra of [
    ['--scene', 'proof'],
    ['--against-map', 'main'],
  ]) {
    const result = await runCli(cwd, ['preview', '--renderer', 'native', '--json', ...extra]);
    assert.equal(result.code, 1);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /CONFIG_MUST_NOT_EXECUTE/u);
  }
});

test('default and explicit web preview lifecycle output remain compatible', async (t) => {
  const cwd = await fixture('tileflow-web-preview-compat-');
  t.after(() => rm(cwd, {force: true, recursive: true}));

  async function firstReady(renderer?: 'web') {
    const port = await reservePort();
    const running = startCli(cwd, [
      'preview',
      '--json',
      ...(renderer ? ['--renderer', renderer] : []),
      '--map',
      'main',
      '--port',
      String(port),
    ]);
    const ready = await running.waitFor((event) => event.event === 'ready');
    assert.equal(Object.hasOwn(ready, 'renderer'), false);
    assert.equal(Object.hasOwn(ready, 'profile'), false);
    assert.equal(Object.hasOwn(ready, 'manifest'), false);
    assert.equal(Object.hasOwn(ready, 'assetsOnly'), false);
    running.requestStop();
    await running.waitFor((event) => event.event === 'stopped');
    const completion = await running.completion;
    assert.equal(completion.code, 0, completion.stderr);
    return ready;
  }

  assert.deepEqual(await firstReady('web'), await firstReady());
});
