import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import type {CliAccountSession} from '../src/account-session';
import type {MapSetupTeam} from '../src/hosted-client';
import {
  checkMapSetupOptions,
  normalizeBrowserOrigin,
  parseBrowserAccess,
  resolveMapSetupTeam,
  setUpManagedMap,
} from '../src/map-setup';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const accountSessionToken = `tf_session_${'b'.repeat(64)}`;
const createdMapId = 'map_NewMapAbCdEfGhIj';
const team = (slug: string, eligible = true): MapSetupTeam => ({
  eligible,
  name: slug.toUpperCase(),
  slug,
  ...(eligible ? {} : {unavailableReason: 'map_limit' as const}),
});

test('Team resolution follows the Web entry rule', () => {
  assert.deepEqual(resolveMapSetupTeam([team('acme')]), {kind: 'selected', team: team('acme')});
  assert.deepEqual(resolveMapSetupTeam([team('acme'), team('full', false)]), {
    kind: 'selected',
    team: team('acme'),
  });
  assert.deepEqual(resolveMapSetupTeam([team('acme'), team('beta')]), {
    kind: 'choose',
    teams: [team('acme'), team('beta')],
  });
  assert.deepEqual(resolveMapSetupTeam([team('full', false)]), {kind: 'map_limit'});
  assert.deepEqual(resolveMapSetupTeam([]), {kind: 'none'});
  assert.deepEqual(resolveMapSetupTeam([team('acme'), team('beta')], 'beta'), {
    kind: 'selected',
    team: team('beta'),
  });
  assert.deepEqual(resolveMapSetupTeam([team('full', false)], 'full'), {kind: 'map_limit'});
  assert.deepEqual(resolveMapSetupTeam([team('acme')], 'other'), {kind: 'not_found'});
});

test('browser access is explicit and accepts only exact HTTP(S) origins', () => {
  assert.equal(normalizeBrowserOrigin('https://App.Example.com'), 'https://app.example.com');
  assert.equal(normalizeBrowserOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(normalizeBrowserOrigin('http://[::1]:8080'), 'http://[::1]:8080');
  for (const invalid of [
    'example.com',
    'https://example.com/path',
    'https://*.example.com',
    'https://user@example.com',
    'https://example.com?x=1',
    'ftp://example.com',
  ]) {
    assert.equal(normalizeBrowserOrigin(invalid), null, invalid);
  }
  assert.deepEqual(parseBrowserAccess({}), {ok: true, value: null});
  assert.deepEqual(parseBrowserAccess({anyWebsite: true}), {ok: true, value: {kind: 'any'}});
  assert.deepEqual(
    parseBrowserAccess({origin: ['https://b.example.com', 'https://a.example.com']}),
    {
      ok: true,
      value: {kind: 'selected', origins: ['https://a.example.com', 'https://b.example.com']},
    },
  );
  assert.equal(parseBrowserAccess({anyWebsite: true, origin: ['https://a.example.com']}).ok, false);
  assert.equal(checkMapSetupOptions({team: 'acme'}).ok, false);
  assert.equal(checkMapSetupOptions({setupKey: 'short'}).ok, false);
});

test('without a terminal, person-owned choices must arrive as flags before any write', async (t) => {
  const writes: unknown[] = [];
  const api = await createFakeApi(t, async (request) => {
    if (request.url === '/v1/cli/map-setup/teams') {
      return {schemaVersion: 1, teams: [team('acme'), team('beta'), team('full', false)]};
    }
    writes.push(JSON.parse(await readBody(request)));
    return createdResponse('beta', ['https://app.example.com']);
  });
  const session = accountSession(api.url);

  const ambiguous = await setUpManagedMap(session, {anyWebsite: true}, {prompts: null});
  assert.equal(ambiguous.ok, false);
  assert.equal(!ambiguous.ok && ambiguous.code, 'team_ambiguous');
  assert.deepEqual(!ambiguous.ok && ambiguous.options, ['@acme', '@beta']);

  const noAccess = await setUpManagedMap(session, {team: '@beta'}, {prompts: null});
  assert.equal(!noAccess.ok && noAccess.code, 'browser_access_required');

  const full = await setUpManagedMap(session, {anyWebsite: true, team: '@full'}, {prompts: null});
  assert.equal(!full.ok && full.code, 'map_limit');
  assert.deepEqual(writes, []);

  const created = await setUpManagedMap(
    session,
    {origin: ['https://app.example.com'], setupKey: 'agent-retry-0001', team: '@beta'},
    {prompts: null},
  );
  assert.ok(created.ok);
  assert.equal(created.value.map.id, createdMapId);
  assert.equal(created.setupKey, 'agent-retry-0001');
  assert.deepEqual(writes, [
    {
      allowedOrigins: ['https://app.example.com'],
      idempotencyKey: 'agent-retry-0001',
      team: '@beta',
    },
  ]);
});

test('prompts choose among several Teams and record Any website explicitly', async (t) => {
  let body: unknown;
  const api = await createFakeApi(t, async (request) => {
    if (request.url === '/v1/cli/map-setup/teams') {
      return {schemaVersion: 1, teams: [team('acme'), team('beta')]};
    }
    body = JSON.parse(await readBody(request));
    return createdResponse('acme', []);
  });
  const offered: string[] = [];
  const created = await setUpManagedMap(
    accountSession(api.url),
    {},
    {
      prompts: {
        chooseAccess: async () => ({kind: 'any'}),
        chooseTeam: async (teams) => {
          offered.push(...teams.map(({slug}) => slug));
          return teams[0]!;
        },
      },
    },
  );
  assert.ok(created.ok);
  assert.deepEqual(offered, ['acme', 'beta']);
  assert.deepEqual(body, {
    allowedOrigins: [],
    idempotencyKey: (body as {idempotencyKey: string}).idempotencyKey,
    team: '@acme',
  });
  assert.match((body as {idempotencyKey: string}).idempotencyKey, /^cli-[0-9a-f]{32}$/u);
});

test('server refusals keep their stable codes', async (t) => {
  const api = await createFakeApi(t, async (request) => {
    if (request.url === '/v1/cli/map-setup/teams') {
      return {schemaVersion: 1, teams: [team('acme')]};
    }
    await readBody(request);
    return {status: 409, body: {code: 'setup_conflict', error: 'conflict'}};
  });
  const result = await setUpManagedMap(
    accountSession(api.url),
    {anyWebsite: true, setupKey: 'agent-retry-0001'},
    {prompts: null},
  );
  assert.equal(!result.ok && result.code, 'setup_conflict');
  assert.match(!result.ok ? result.error : '', /Omit --setup-key/u);
});

test('maps create prints the Map and the deploy command as JSON for agents', async (t) => {
  const directory = await createHome(t);
  const api = await createFakeApi(t, async (request) => {
    assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
    if (request.url === '/v1/cli/map-setup/teams') {
      return {schemaVersion: 1, teams: [team('acme')]};
    }
    assert.equal(request.url, '/v1/cli/maps');
    await readBody(request);
    return createdResponse('acme', ['https://app.example.com']);
  });
  await writeAccountSession(directory, api.url);

  const result = await runCli(directory, [
    'maps',
    'create',
    '--api-url',
    api.url,
    '--origin',
    'https://app.example.com',
    '--json',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal((document.map as {id: string}).id, createdMapId);
  assert.equal(document.next, `tileflow deploy --map-id ${createdMapId}`);
  assert.match(String(document.setupKey), /^cli-[0-9a-f]{32}$/u);
  assert.doesNotMatch(result.stdout, new RegExp(accountSessionToken));
});

test('deploy without --map-id creates the Map after local preflight and deploys to it', async (t) => {
  const directory = await createHome(t);
  await linkWorkspacePackages(directory);
  const configPath = join(directory, 'tileflow.config.ts');
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(configPath, tileflowMapFixture({id: 'madrid', fields: `name: 'Madrid'`}));
  const capability = `tf_cap_${'c'.repeat(96)}`;
  const requests: string[] = [];
  const api = await createFakeApi(t, async (request) => {
    requests.push(`${request.method} ${request.url}`);
    const body = await readBody(request);
    if (request.url === '/v1/cli/map-setup/teams') {
      return {schemaVersion: 1, teams: [team('acme')]};
    }
    if (request.url === '/v1/cli/maps') {
      assert.deepEqual(JSON.parse(body).allowedOrigins, []);
      return createdResponse('acme', []);
    }
    if (request.url === '/v1/cli/map-capabilities') {
      assert.equal(JSON.parse(body).mapId, createdMapId);
      return {
        capability,
        expiresAt: '2026-12-01T00:00:00.000Z',
        mapId: createdMapId,
        schemaVersion: 1,
        scopes: ['styles:write'],
      };
    }
    assert.equal(request.url, '/v1/styles');
    assert.equal(request.headers.authorization, `Bearer ${capability}`);
    return deploymentResponse(createdMapId);
  });
  await writeAccountSession(directory, api.url);
  const deploy = (extra: string[] = []) =>
    runCli(directory, [
      'deploy',
      '--config',
      configPath,
      '--manifest',
      manifestPath,
      '--api-url',
      api.url,
      '--any-website',
      ...extra,
    ]);

  const result = await deploy();
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(requests, [
    'GET /v1/cli/map-setup/teams',
    'POST /v1/cli/maps',
    'POST /v1/cli/map-capabilities',
    'POST /v1/styles',
  ]);
  assert.match(result.stdout, new RegExp(`tileflow deploy --map-id ${createdMapId}`));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    maps: Record<string, {mapId: string}>;
  };
  assert.equal(manifest.maps.madrid?.mapId, createdMapId);

  // A second deploy without --map-id never creates another Map for the same repository map.
  requests.length = 0;
  const repeated = await deploy();
  assert.equal(repeated.code, 1);
  assert.match(repeated.stdout, new RegExp(`already deployed to ${createdMapId}`));
  assert.deepEqual(requests, []);
});

test('CI and explicit credentials never create a Map', async (t) => {
  const directory = await createHome(t);
  for (const environment of [{CI: 'true'}, {TILEFLOW_API_KEY: `tf_live_${'a'.repeat(48)}`}]) {
    const result = await runCli(
      directory,
      ['deploy', '--api-url', 'http://127.0.0.1:9', '--any-website'],
      environment,
    );
    assert.equal(result.code, 1);
    assert.match(result.stdout, /requires --map-id/u);
  }
  const mixed = await runCli(directory, ['deploy', '--map-id', createdMapId, '--any-website']);
  assert.equal(mixed.code, 1);
  assert.match(mixed.stdout, /apply only when deploy creates a Map/u);
});

function accountSession(apiOrigin: string): CliAccountSession {
  return {
    account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
    accountSession: accountSessionToken,
    apiOrigin,
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sessionId: 'cli_session_ada',
  };
}

function createdResponse(slug: string, allowedOrigins: string[]) {
  return {
    delivery: {allowedOrigins},
    map: {id: createdMapId, name: null, state: 'setup_pending'},
    schemaVersion: 1,
    team: {name: slug.toUpperCase(), slug},
  };
}

function deploymentResponse(mapId: string) {
  const themes = [
    'dark',
    'dark-faded',
    'dark-monochrome',
    'dawn',
    'dawn-faded',
    'dawn-monochrome',
    'dusk',
    'dusk-faded',
    'dusk-monochrome',
    'faded',
    'light',
    'monochrome',
  ];
  return {
    mapId,
    themes: Object.fromEntries(
      themes.map((theme) => [
        theme,
        {
          styleId: `${mapId}_${theme}`,
          styleUrl: `https://api.example.test/maps/${mapId}/${theme}.json`,
        },
      ]),
    ),
  };
}

async function createHome(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-map-setup-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

async function writeAccountSession(home: string, apiUrl: string) {
  await mkdir(join(home, '.tileflow'), {recursive: true});
  await writeFile(
    join(home, '.tileflow', 'config.json'),
    `${JSON.stringify({sessions: {[apiUrl]: accountSession(apiUrl)}, version: 2})}\n`,
    {mode: 0o600},
  );
}

async function createFakeApi(
  t: TestContext,
  handle: (
    request: IncomingMessage,
  ) => Promise<Record<string, unknown> | {body: Record<string, unknown>; status: number}>,
) {
  const server = createServer(async (request, response) => {
    try {
      const result = await handle(request);
      const status = typeof result.status === 'number' ? result.status : 200;
      const body = typeof result.status === 'number' ? result.body : result;
      response.writeHead(status, {'Content-Type': 'application/json'});
      response.end(JSON.stringify(body));
    } catch (error) {
      response.writeHead(500, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({error: error instanceof Error ? error.message : 'test error'}));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {url: `http://127.0.0.1:${address.port}`};
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function runCli(
  home: string,
  arguments_: string[],
  overrides: Record<string, string> = {},
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
    'TILEFLOW_DEPLOY_REF',
    'TILEFLOW_DEPLOY_REPOSITORY',
    'TILEFLOW_DEPLOY_REVISION',
    'TILEFLOW_DEPLOY_RUN_ID',
    'TILEFLOW_DEPLOY_RUN_URL',
  ]) {
    delete environment[variable];
  }
  Object.assign(environment, {HOME: home, NO_COLOR: '1', USERPROFILE: home}, overrides);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd: home,
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
