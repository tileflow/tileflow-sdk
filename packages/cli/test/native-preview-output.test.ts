import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

async function fixture(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  await writeFile(join(cwd, 'tileflow.config.ts'), tileflowMapFixture({id: 'main'}), 'utf8');
  return cwd;
}

function environment(cwd: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY'])
    delete result[variable];
  return {...result, HOME: cwd, NO_COLOR: '1', USERPROFILE: cwd};
}

function runCli(cwd: string, arguments_: string[]) {
  return new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment(cwd),
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

test('preview rejects an unknown renderer before config execution without echoing it', async (t) => {
  const cwd = await fixture('tileflow-native-preview-renderer-');
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), "throw new Error('CONFIG_MUST_NOT_EXECUTE');\n", 'utf8');
  const result = await runCli(cwd, [
    'preview',
    '--renderer',
    'tf_secret_renderer_do_not_print',
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /CONFIG_MUST_NOT_EXECUTE/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tf_secret_renderer_do_not_print/u);
  const event = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(event.command, 'dev');
  assert.equal(event.event, 'error');
  assert.equal(event.code, 'NATIVE_RENDERER_UNSUPPORTED');
});

test('native preview human output names the exact assets-only manifest and profile', async (t) => {
  const cwd = await fixture('tileflow-native-preview-human-');
  const port = await reservePort();
  const manifest = `http://127.0.0.1:${port}/native/manifest.json`;
  const child = spawn(
    process.execPath,
    [
      '--import',
      tsxLoader,
      cliEntry,
      'preview',
      '--renderer',
      'native',
      '--map',
      'main',
      '--port',
      String(port),
    ],
    {cwd, env: environment(cwd), stdio: ['ignore', 'pipe', 'pipe', 'ipc']},
  );
  let stdout = '';
  let stderr = '';
  let exited = false;
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      exited = true;
      resolve(code);
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
  t.after(async () => {
    requestStop();
    await completion.catch(() => undefined);
    await rm(cwd, {force: true, recursive: true});
  });

  const deadline = Date.now() + 10_000;
  while (
    Date.now() < deadline &&
    (!stdout.includes(manifest) ||
      !stdout.includes('Profile:') ||
      !stdout.includes('native-v1') ||
      !stdout.includes('Endpoint:') ||
      !stdout.includes('assets-only'))
  )
    await new Promise((resolve) => setTimeout(resolve, 25));

  assert.match(stdout, /Tileflow native artifact preview is running/u, stderr);
  assert.ok(stdout.includes(manifest), stdout);
  assert.match(stdout, /Profile:\s+native-v1/u);
  assert.match(stdout, /Endpoint:\s+assets-only/u);
  assert.match(stdout, /Metro remains the JavaScript development server/u);
  assert.doesNotMatch(stdout, /visual workbench/u);

  requestStop();
  assert.equal(await completion, 0, stderr);
});
