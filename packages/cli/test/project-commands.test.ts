import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {type CliAccountSessionV2, installAccountSession} from '../src/account-session';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const accountToken = `tf_session_${'a'.repeat(64)}`;

test('projects list uses the account session and emits deterministic secret-free targets', async (t) => {
  const fixture = await createFixture(t);
  let authorization = '';
  const api = await createApi(t, async (request) => {
    authorization = request.headers.authorization ?? '';
    assert.equal(request.url, '/v1/cli/projects?includeArchived=false&limit=100');
    return json(200, {
      items: [target('acme', 'web'), target('acme', 'worker')],
      nextCursor: null,
      schemaVersion: 1,
    });
  });
  await writeSession(fixture, api.url);

  const result = await runCli(
    fixture.projectDirectory,
    ['projects', 'list', '--json', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(authorization, `Bearer ${accountToken}`);
  const document = JSON.parse(result.stdout) as {
    command: string;
    projects: Array<{reference: string}>;
    schemaVersion: number;
  };
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.command, 'projects list');
  assert.deepEqual(
    document.projects.map((item) => item.reference),
    ['@acme/web', '@acme/worker'],
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(accountToken));
});

test('projects archive carries its exact reference and never performs hidden selection', async (t) => {
  const fixture = await createFixture(t);
  let requestCount = 0;
  const api = await createApi(t, async (request) => {
    requestCount += 1;
    assert.equal(request.method, 'PATCH');
    assert.equal(request.url, '/v1/organizations/acme/projects/legacy');
    assert.equal(request.headers.authorization, `Bearer ${accountToken}`);
    assert.deepEqual(JSON.parse(await readRequestBody(request)), {archived: true});
    return json(200, {
      changed: true,
      organization: {id: 'org_acme', name: 'Acme', slug: 'acme'},
      project: project('legacy', 'Legacy'),
    });
  });
  await writeSession(fixture, api.url);

  const result = await runCli(
    fixture.projectDirectory,
    ['projects', 'archive', '@acme/legacy', '--json', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requestCount, 1);
  assert.equal(JSON.parse(result.stdout).command, 'projects archive');
});

test('project create requires an explicit organization when account membership is ambiguous', async (t) => {
  const fixture = await createFixture(t);
  let writes = 0;
  const api = await createApi(t, async (request) => {
    if (request.method !== 'GET') writes += 1;
    return json(200, {
      items: [target('acme', 'web'), target('other', 'web')],
      nextCursor: null,
      schemaVersion: 1,
    });
  });
  await writeSession(fixture, api.url);

  const result = await runCli(
    fixture.projectDirectory,
    ['projects', 'create', 'worker', '--name', 'Worker', '--json', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: false,
    error: {
      code: 'organization_ambiguous',
      options: ['@acme', '@other'],
      retry: 'tileflow projects create worker --name "Worker" --organization @acme',
    },
  });
  assert.match(result.stderr, /--organization @acme/);
});

test('whoami reports an account session with no project identity', async (t) => {
  const fixture = await createFixture(t);
  const api = await createApi(t, async (request) => {
    assert.equal(request.url, '/v1/cli/account');
    return json(200, {
      account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
      schemaVersion: 1,
      session: {expiresAt: '2026-12-01T00:00:00.000Z', id: 'cli_session_ada'},
    });
  });
  await writeSession(fixture, api.url);

  const result = await runCli(
    fixture.projectDirectory,
    ['whoami', '--json', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal((document.account as {id: string}).id, 'usr_ada');
  assert.equal(Object.hasOwn(document, 'project'), false);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(accountToken));
});

test('whoami --json keeps authentication failures as parseable stdout JSON', async (t) => {
  const fixture = await createFixture(t);
  const result = await runCli(
    fixture.projectDirectory,
    ['whoami', '--json', '--api-url', 'https://api.example.test'],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: false,
    error: {code: 'authentication_failed'},
  });
  assert.match(result.stderr, /Not logged in/);
  assert.doesNotMatch(result.stdout, /Not logged in|Next steps/);
  assert.equal(result.stdout.includes('\u001b['), false);
});

test('legacy project login requires fresh account authorization and remains byte-for-byte intact', async (t) => {
  const fixture = await createFixture(t);
  const legacy = `${JSON.stringify({
    apiKey: `tf_cli_${'z'.repeat(48)}`,
    apiUrl: 'https://api.example.test',
    projectId: 'prj_web',
  })}\n`;
  await writeFile(fixture.authPath, legacy, {mode: 0o600});

  const result = await runCli(
    fixture.projectDirectory,
    ['whoami', '--json', '--api-url', 'https://api.example.test'],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /retired project-credential model/);
  const {readFile} = await import('node:fs/promises');
  assert.equal(await readFile(fixture.authPath, 'utf8'), legacy);
});

test('rejected project-profile commands and selectors are not part of the CLI', async (t) => {
  const fixture = await createFixture(t);
  const cases = [
    {arguments: ['login', '--project', '@acme/web'], expected: /unknown option '--project'/},
    {arguments: ['logout', '--all'], expected: /unknown option '--all'/},
    {arguments: ['projects', 'use', '@acme/web'], expected: /unknown command 'use'/},
  ];

  for (const candidate of cases) {
    const result = await runCli(fixture.projectDirectory, candidate.arguments, fixture.directory);
    assert.equal(result.code, 1, `${candidate.arguments.join(' ')}\n${result.stderr}`);
    assert.match(result.stderr, candidate.expected);
  }
});

test('logout revokes and removes only the account session for its API origin', async (t) => {
  const fixture = await createFixture(t);
  let authorization = '';
  const api = await createApi(t, async (request) => {
    assert.equal(request.method, 'DELETE');
    assert.equal(request.url, '/v1/cli/account/session');
    authorization = request.headers.authorization ?? '';
    return json(204, null);
  });
  await writeSession(fixture, api.url);

  const result = await runCli(
    fixture.projectDirectory,
    ['logout', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(authorization, `Bearer ${accountToken}`);
  assert.match(result.stdout, /Signed out of this Tileflow origin/);
  const {readFile} = await import('node:fs/promises');
  await assert.rejects(() => readFile(fixture.authPath, 'utf8'), {code: 'ENOENT'});
});

function target(organizationSlug: string, projectSlug: string) {
  return {
    organization: {
      id: `org_${organizationSlug}`,
      name: organizationSlug[0].toUpperCase() + organizationSlug.slice(1),
      slug: organizationSlug,
    },
    project: project(projectSlug),
    reference: `@${organizationSlug}/${projectSlug}`,
  };
}

function project(slug: string, name = slug[0].toUpperCase() + slug.slice(1)) {
  return {
    archivedAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    id: `prj_${slug}`,
    name,
    slug,
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

async function writeSession(fixture: Awaited<ReturnType<typeof createFixture>>, apiUrl: string) {
  const value: CliAccountSessionV2 = {
    account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
    accountSession: accountToken,
    apiOrigin: apiUrl,
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sessionId: 'cli_session_ada',
  };
  await installAccountSession(value, fixture.authPath);
}

async function createFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-project-commands-'));
  const projectDirectory = join(directory, 'repository');
  const authDirectory = join(directory, '.tileflow');
  const authPath = join(authDirectory, 'config.json');
  await Promise.all([mkdir(projectDirectory), mkdir(authDirectory, {mode: 0o700})]);
  t.after(() => rm(directory, {force: true, recursive: true}));
  return {authPath, directory, projectDirectory};
}

type TestResponse = {body: unknown; status: number};

function json(status: number, body: unknown): TestResponse {
  return {body, status};
}

async function createApi(
  t: TestContext,
  responder: (request: IncomingMessage) => Promise<TestResponse>,
) {
  const server = createServer(async (request, response) => {
    try {
      const result = await responder(request);
      sendJson(response, result.status, result.body);
    } catch (error) {
      sendJson(response, 500, {error: error instanceof Error ? error.message : 'test error'});
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {url: `http://127.0.0.1:${address.port}`};
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage) {
  let source = '';
  for await (const chunk of request) source += String(chunk);
  return source;
}

function runCli(
  cwd: string,
  arguments_: string[],
  home: string,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'TILEFLOW_API_KEY', 'TILEFLOW_API_URL']) {
    delete environment[variable];
  }
  Object.assign(environment, {HOME: home, NO_COLOR: '1', USERPROFILE: home});

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stderr, stdout}));
  });
}
