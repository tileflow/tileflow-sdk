import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {type CliAccountSession, installAccountSession} from '../src/account-session';

const accountToken = `tf_session_${'a'.repeat(64)}`;

test('project lifecycle stays callable but is hidden from primary help', async (t) => {
  const fixture = await createFixture(t);
  const primary = await runCli(fixture.projectDirectory, ['--help'], fixture.directory);
  const compatibility = await runCli(
    fixture.projectDirectory,
    ['projects', '--help'],
    fixture.directory,
  );

  assert.equal(primary.code, 0, primary.stderr);
  assert.doesNotMatch(primary.stdout, /^\s+projects\b/mu);
  assert.equal(compatibility.code, 0, compatibility.stderr);
  assert.match(compatibility.stdout, /list/u);
  assert.match(compatibility.stdout, /create/u);
});

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

test('a server-revoked account session clearly requires a fresh login', async (t) => {
  const fixture = await createFixture(t);
  const api = await createApi(t, async () => json(401, {error: 'Invalid CLI account session'}));
  await writeSession(fixture, api.url);

  const projects = await runCli(
    fixture.projectDirectory,
    ['projects', 'list', '--json', '--api-url', api.url],
    fixture.directory,
  );
  const whoami = await runCli(
    fixture.projectDirectory,
    ['whoami', '--json', '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(projects.code, 1);
  assert.equal(whoami.code, 1);
  assert.match(projects.stderr, /session is no longer valid.*tileflow login/iu);
  assert.match(whoami.stderr, /session is no longer valid.*tileflow login/iu);
  assert.doesNotMatch(`${projects.stderr}\n${whoami.stderr}`, /Invalid CLI account session/u);
  assert.deepEqual(JSON.parse(projects.stdout), {
    error: {code: 'http_401'},
    ok: false,
    schemaVersion: 1,
  });
  assert.deepEqual(JSON.parse(whoami.stdout), {
    error: {code: 'authentication_failed'},
    ok: false,
    schemaVersion: 1,
  });
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

test('an unrecognized saved login fails closed and remains byte-for-byte intact', async (t) => {
  const fixture = await createFixture(t);
  const unrecognized = `${JSON.stringify({
    apiKey: `tf_cli_${'z'.repeat(48)}`,
    apiUrl: 'https://api.example.test',
  })}\n`;
  await writeFile(fixture.authPath, unrecognized, {mode: 0o600});

  const result = await runCli(
    fixture.projectDirectory,
    ['whoami', '--json', '--api-url', 'https://api.example.test'],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /older format.*tileflow login/);
  const {readFile} = await import('node:fs/promises');
  assert.equal(await readFile(fixture.authPath, 'utf8'), unrecognized);
});

test('login replaces the old API key file and also works with an empty home', async (t) => {
  for (const previousFile of ['legacy', 'empty'] as const) {
    const fixture = await createFixture(t);
    const account = {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'};
    const expiresAt = '2026-12-01T00:00:00.000Z';
    const sessionId = 'cli_session_ada';
    const requests: string[] = [];
    let apiUrl = '';
    const api = await createApi(t, async (request) => {
      requests.push(request.url ?? '');
      if (request.url === '/api/cli/device/start') {
        return json(200, {
          apiUrl,
          deviceCode: 'device_test',
          expiresIn: 60,
          interval: 1,
          userCode: 'TESTCODE',
          verificationUri: `${apiUrl}/activate`,
          verificationUriComplete: `${apiUrl}/activate?code=TESTCODE`,
        });
      }
      if (request.url === '/api/cli/device/token') {
        return json(200, {
          account,
          accountSession: accountToken,
          apiUrl,
          createdAt: '2026-08-15T00:00:00.000Z',
          expiresAt,
          sessionId,
        });
      }
      assert.equal(request.url, '/v1/cli/account');
      assert.equal(request.headers.authorization, `Bearer ${accountToken}`);
      return json(200, {account, schemaVersion: 1, session: {expiresAt, id: sessionId}});
    });
    apiUrl = api.url;
    if (previousFile === 'legacy') {
      await writeFile(fixture.authPath, `${JSON.stringify({apiKey: 'old-api-key', apiUrl})}\n`, {
        mode: 0o600,
      });
    }

    const result = await runCli(
      fixture.projectDirectory,
      ['login', '--no-browser', '--app-url', apiUrl, '--api-url', apiUrl],
      fixture.directory,
    );

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(requests, [
      '/api/cli/device/start',
      '/api/cli/device/token',
      '/v1/cli/account',
    ]);
    const {readFile} = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(fixture.authPath, 'utf8')) as {
      sessions: Record<string, {accountSession: string}>;
      version: number;
    };
    assert.equal(saved.version, 2);
    assert.equal(saved.sessions[apiUrl].accountSession, accountToken);
    assert.equal(Object.hasOwn(saved, 'apiKey'), false);
  }
});

test('unknown login file stops before contacting the dashboard', async (t) => {
  const fixture = await createFixture(t);
  const unknown = '{"version":99,"sessions":{}}\n';
  await writeFile(fixture.authPath, unknown, {mode: 0o600});
  let requests = 0;
  const api = await createApi(t, async () => {
    requests += 1;
    return json(500, {});
  });

  const result = await runCli(
    fixture.projectDirectory,
    ['login', '--no-browser', '--app-url', api.url, '--api-url', api.url],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /auth state is invalid/);
  assert.equal(requests, 0);
  const {readFile} = await import('node:fs/promises');
  assert.equal(await readFile(fixture.authPath, 'utf8'), unknown);
});

test('login revokes a new session if local persistence fails after authorization', async (t) => {
  const fixture = await createFixture(t);
  const account = {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'};
  const expiresAt = '2026-12-01T00:00:00.000Z';
  const sessionId = 'cli_session_ada';
  const changedFile = '{"version":99,"sessions":{}}\n';
  let apiUrl = '';
  let revoked = false;
  const api = await createApi(t, async (request) => {
    if (request.url === '/api/cli/device/start') {
      return json(200, {
        apiUrl,
        deviceCode: 'device_test',
        expiresIn: 60,
        interval: 1,
        userCode: 'TESTCODE',
        verificationUri: `${apiUrl}/activate`,
        verificationUriComplete: `${apiUrl}/activate?code=TESTCODE`,
      });
    }
    if (request.url === '/api/cli/device/token') {
      return json(200, {
        account,
        accountSession: accountToken,
        apiUrl,
        createdAt: '2026-08-15T00:00:00.000Z',
        expiresAt,
        sessionId,
      });
    }
    assert.equal(request.headers.authorization, `Bearer ${accountToken}`);
    if (request.url === '/v1/cli/account') {
      await writeFile(fixture.authPath, changedFile, {mode: 0o600});
      return json(200, {account, schemaVersion: 1, session: {expiresAt, id: sessionId}});
    }
    assert.equal(request.url, '/v1/cli/account/session');
    assert.equal(request.method, 'DELETE');
    revoked = true;
    return json(204, null);
  });
  apiUrl = api.url;

  const result = await runCli(
    fixture.projectDirectory,
    ['login', '--no-browser', '--app-url', apiUrl, '--api-url', apiUrl],
    fixture.directory,
  );

  assert.equal(result.code, 1);
  assert.equal(revoked, true);
  const {readFile} = await import('node:fs/promises');
  assert.equal(await readFile(fixture.authPath, 'utf8'), changedFile);
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
  const value: CliAccountSession = {
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
  overrides: NodeJS.ProcessEnv = {},
  tty = false,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
  ]) {
    delete environment[variable];
  }
  Object.assign(environment, {HOME: home, NO_COLOR: '1', USERPROFILE: home}, overrides);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...(tty
          ? [
              '--import',
              'data:text/javascript,Object.defineProperty(process.stdin,%22isTTY%22,{value:true})',
            ]
          : []),
        ...cliFixtureArguments(arguments_),
      ],
      {
        cwd,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
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

test('Team commands honor environment credentials and origins independently of local auth state', async (t) => {
  const key = `tf_live_${'b'.repeat(48)}`;
  const explicitKey = `tf_live_${'c'.repeat(48)}`;
  let expectedKey = key;
  const requests: string[] = [];
  const api = await createApi(t, async (request) => {
    requests.push(request.url!);
    assert.equal(request.headers.authorization, `Bearer ${expectedKey}`);
    if (request.url === '/v1/models') return json(200, {schemaVersion: 1, models: []});
    return json(401, {error: 'invalid_credential'});
  });
  for (const state of ['empty', 'legacy', 'unknown', 'session']) {
    const fixture = await createFixture(t);
    if (state === 'session') await writeSession(fixture, api.url);
    else if (state !== 'empty')
      await writeFile(
        fixture.authPath,
        JSON.stringify(state === 'legacy' ? {apiKey: 'old-key', apiUrl: api.url} : {version: 99}),
      );
    const {readFile} = await import('node:fs/promises');
    const before = await readFile(fixture.authPath, 'utf8').catch(() => null);
    for (const command of [
      ['models', 'list'],
      ['models', 'status', 'tower'],
      ['tileset', 'list'],
      ['icon-set', 'list'],
    ]) {
      const beforeRequests = requests.length;
      const result = await runCli(fixture.directory, [...command, '--json'], fixture.directory, {
        TILEFLOW_API_KEY: key,
        TILEFLOW_API_URL: api.url,
        CI: '1',
      });
      assert.equal(requests.length, beforeRequests + 1, result.stderr);
      assert.equal(result.code, command.join(' ') === 'models list' ? 0 : 1, result.stderr);
      assert.equal((result.stdout + result.stderr).includes(key), false);
    }
    assert.equal(await readFile(fixture.authPath, 'utf8').catch(() => null), before);
  }
  expectedKey = explicitKey;
  const fixture = await createFixture(t);
  const explicit = await runCli(
    fixture.directory,
    ['models', 'list', '--json', '--api-key', explicitKey, '--api-url', api.url],
    fixture.directory,
    {TILEFLOW_API_KEY: key, TILEFLOW_API_URL: 'https://unused.invalid'},
  );
  assert.equal(explicit.code, 0, explicit.stderr);
});

test('empty or invalid keys and missing CI keys never fall back to a saved login', async (t) => {
  const fixture = await createFixture(t);
  const requests: string[] = [];
  const api = await createApi(t, async (request) => {
    requests.push(request.url!);
    return json(500, {});
  });
  await writeSession(fixture, api.url);
  for (const command of [
    ['models', 'list'],
    ['tileset', 'list'],
    ['icon-set', 'list'],
    ['status', '--map-id', 'map_AbCdEfGhIjKlMnOp'],
  ]) {
    for (const env of [
      {TILEFLOW_API_KEY: ''},
      {TILEFLOW_API_KEY: 'invalid'},
      {CI: '1'},
      {GITHUB_ACTIONS: 'true'},
      {GITLAB_CI: 'true'},
    ]) {
      const result = await runCli(
        fixture.directory,
        [...command, '--json', '--api-url', api.url],
        fixture.directory,
        env,
      );
      assert.equal(result.code, 1, result.stdout);
    }
    const emptyFlag = await runCli(
      fixture.directory,
      [...command, '--api-url', api.url, '--api-key', ''],
      fixture.directory,
    );
    assert.equal(emptyFlag.code, 1);
  }
  assert.deepEqual(requests, []);
});

test('help never prints the environment API key', async (t) => {
  const fixture = await createFixture(t);
  const key = `tf_live_${'d'.repeat(48)}`;
  for (const command of [
    ['deploy'],
    ['status'],
    ['models', 'list'],
    ['tileset', 'list'],
    ['icon-set', 'list'],
    ['icons', 'diff'],
    ['icons', 'lock'],
  ]) {
    const result = await runCli(fixture.directory, [...command, '--help'], fixture.directory, {
      TILEFLOW_API_KEY: key,
    });
    assert.equal((result.stdout + result.stderr).includes(key), false, command.join(' '));
  }
});

test('login validates before saving, revokes failures, and revokes the previous session only after saving', async (t) => {
  for (const failure of [false, true]) {
    const fixture = await createFixture(t);
    const newToken = `tf_session_${'b'.repeat(64)}`;
    const revoked: string[] = [];
    let origin = '';
    const account = {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'};
    const {readFile} = await import('node:fs/promises');
    const api = await createApi(t, async (request) => {
      if (request.url === '/api/cli/device/start')
        return json(200, {
          apiUrl: origin,
          deviceCode: 'device_test',
          expiresIn: 60,
          interval: 1,
          userCode: 'TESTCODE',
          verificationUri: `${origin}/activate`,
          verificationUriComplete: `${origin}/activate?code=TESTCODE`,
        });
      if (request.url === '/api/cli/device/token')
        return json(200, {
          account,
          accountSession: newToken,
          apiUrl: origin,
          createdAt: '2026-08-15T00:00:00.000Z',
          expiresAt: '2026-12-01T00:00:00.000Z',
          sessionId: 'cli_session_new',
        });
      if (request.method === 'DELETE') {
        revoked.push(request.headers.authorization!);
        const saved = JSON.parse(await readFile(fixture.authPath, 'utf8'));
        assert.equal(saved.sessions[origin].accountSession, failure ? accountToken : newToken);
        return json(200, {});
      }
      return failure
        ? json(503, {})
        : json(200, {
            account,
            schemaVersion: 1,
            session: {expiresAt: '2026-12-01T00:00:00.000Z', id: 'cli_session_new'},
          });
    });
    origin = api.url;
    await writeSession(fixture, origin);
    const before = await readFile(fixture.authPath, 'utf8');
    const result = await runCli(
      fixture.directory,
      ['login', '--no-browser', '--api-url', origin, '--app-url', origin],
      fixture.directory,
      {TILEFLOW_API_KEY: 'ignored-by-login'},
      true,
    );
    assert.equal(result.code, failure ? 1 : 0, result.stderr);
    assert.deepEqual(revoked, [`Bearer ${failure ? newToken : accountToken}`]);
    if (failure) assert.equal(await readFile(fixture.authPath, 'utf8'), before);
    assert.equal((result.stdout + result.stderr).includes(newToken), false);
  }
});

test('logout preserves local access when server revocation fails', async (t) => {
  const fixture = await createFixture(t);
  const api = await createApi(t, async () => json(503, {}));
  await writeSession(fixture, api.url);
  const {readFile} = await import('node:fs/promises');
  const before = await readFile(fixture.authPath, 'utf8');
  const result = await runCli(
    fixture.directory,
    ['logout', '--api-url', api.url],
    fixture.directory,
  );
  assert.equal(result.code, 1);
  assert.equal(await readFile(fixture.authPath, 'utf8'), before);
});

test('personal login selects a sole Team and requires an explicit Team when membership is ambiguous', async (t) => {
  const fixture = await createFixture(t);
  const acme = {id: 'team_acme', slug: 'acme', name: 'Acme'};
  const beta = {id: 'team_beta', slug: 'beta', name: 'Beta'};
  let teams = [acme];
  const capabilities: string[] = [];
  const api = await createApi(t, async (request) => {
    if (request.url === '/v1/models') {
      assert.equal(request.headers.authorization, 'Bearer tf_cap_test');
      return json(200, {schemaVersion: 1, models: []});
    }
    assert.equal(request.headers.authorization, `Bearer ${accountToken}`);
    if (request.url === '/v1/cli/teams') return json(200, {schemaVersion: 1, teams});
    assert.equal(request.url, '/v1/cli/team-capabilities');
    const body = JSON.parse(await readRequestBody(request));
    assert.deepEqual(body.scopes, ['models:read']);
    capabilities.push(body.team);
    const team = teams.find((team) => `@${team.slug}` === body.team)!;
    return json(200, {
      schemaVersion: 1,
      capability: 'tf_cap_test',
      reference: body.team,
      team,
      scopes: body.scopes,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  });
  await writeSession(fixture, api.url);
  const run = (extra: string[] = []) =>
    runCli(
      fixture.directory,
      ['models', 'list', '--json', '--api-url', api.url, ...extra],
      fixture.directory,
    );
  assert.equal((await run()).code, 0);
  teams = [acme, beta];
  const ambiguous = await run();
  assert.equal(ambiguous.code, 1);
  assert.equal(JSON.parse(ambiguous.stderr).error.code, 'team_ambiguous');
  assert.deepEqual(capabilities, ['@acme']);
  assert.equal((await run(['--team', '@beta'])).code, 0);
  assert.deepEqual(capabilities, ['@acme', '@beta']);
});

test('login rejects a mismatched API origin before issuing a session', async (t) => {
  const fixture = await createFixture(t);
  const requests: string[] = [];
  let origin = '';
  const api = await createApi(t, async (request) => {
    requests.push(request.url!);
    return json(200, {
      apiUrl: 'https://unexpected.invalid',
      deviceCode: 'device_test',
      expiresIn: 60,
      interval: 1,
      userCode: 'TESTCODE',
      verificationUri: `${origin}/activate`,
      verificationUriComplete: `${origin}/activate?code=TESTCODE`,
    });
  });
  origin = api.url;
  const result = await runCli(
    fixture.directory,
    ['login', '--no-browser', '--app-url', origin, '--api-url', origin],
    fixture.directory,
  );
  assert.equal(result.code, 1);
  assert.deepEqual(requests, ['/api/cli/device/start']);
});
