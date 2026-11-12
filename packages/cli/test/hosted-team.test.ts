import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {HostedRequestError} from '../src/hosted-error';
import {authorizedTeamRequest, resolveTeamAuthority} from '../src/hosted-team';

test('concurrent Team requests share one renewal with unchanged authority', async (t) => {
  const fixture = await authorityFixture(t);
  assert.ok(fixture.authority);
  fixture.expire();

  const responses = await Promise.all(
    Array.from({length: 4}, () => authorizedTeamRequest(fixture.authority!, '/v1/tilesets', 'GET')),
  );

  assert.equal(
    responses.every((response) => response.ok),
    true,
  );
  assert.equal(fixture.grants(), 2);
  assert.equal(fixture.requests(), 4);
});

test('Team renewal rejects a reused slug selecting a different Team', async (t) => {
  const fixture = await authorityFixture(t, {renewedTeamId: 'org_other'});
  assert.ok(fixture.authority);
  fixture.expire();

  await assert.rejects(
    authorizedTeamRequest(fixture.authority, '/v1/tilesets', 'GET'),
    /Team authorization could not be renewed/u,
  );
  assert.equal(fixture.requests(), 0);
});

test('revoked account authorization stops before another Team request', async (t) => {
  const fixture = await authorityFixture(t, {denyRenewal: true});
  assert.ok(fixture.authority);
  fixture.expire();

  await assert.rejects(
    authorizedTeamRequest(fixture.authority, '/v1/tilesets', 'GET'),
    (error: unknown) => {
      assert.ok(error instanceof HostedRequestError);
      assert.equal(error.failure.status, 401);
      assert.equal(error.failure.code, 'ACCOUNT_SESSION_REVOKED');
      assert.equal(error.failure.requestId, 'renewal-ref');
      assert.match(error.message, /tileflow login/u);
      assert.ok(error.nextSteps.some((step) => step.includes('tileflow login')));
      return true;
    },
  );
  assert.equal(fixture.grants(), 2);
  assert.equal(fixture.requests(), 0);
});

test('initial Team authority must match the discovered Team identity', async (t) => {
  const fixture = await authorityFixture(t, {initialTeamId: 'org_other'});
  assert.equal(fixture.authority, null);
  assert.equal(fixture.requests(), 0);
});

async function authorityFixture(
  t: TestContext,
  options: {
    denyRenewal?: boolean;
    initialTeamId?: string;
    renewedTeamId?: string;
  } = {},
) {
  const apiOrigin = 'https://api.example.test';
  const team = {id: 'org_acme', name: 'Acme', slug: 'acme'};
  const accountSession = `tf_session_${'a'.repeat(64)}`;
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const environment = Object.fromEntries(
    ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI'].map((name) => [name, process.env[name]]),
  );
  let now = Date.now();
  let grants = 0;
  let requests = 0;

  t.mock.method(Date, 'now', () => now);
  for (const name of Object.keys(environment)) delete process.env[name];
  process.stderr.write = (() => true) as typeof process.stderr.write;

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, apiOrigin);
    const authorization = new Headers(init?.headers).get('authorization');
    if (url.pathname === '/v1/cli/teams') return Response.json({schemaVersion: 1, teams: [team]});
    if (url.pathname === '/v1/cli/team-capabilities') {
      assert.equal(authorization, `Bearer ${accountSession}`);
      assert.deepEqual(JSON.parse(String(init?.body)), {scopes: ['tilesets:write'], team: '@acme'});
      grants += 1;
      if (options.denyRenewal && grants > 1)
        return Response.json(
          {
            code: 'ACCOUNT_SESSION_REVOKED',
            error: 'This account session was revoked.',
            requestId: 'renewal-ref',
          },
          {status: 401},
        );
      return Response.json({
        capability: `tf_cap_${String(grants).repeat(80)}`,
        expiresAt: new Date(now + 300_000).toISOString(),
        reference: '@acme',
        schemaVersion: 1,
        scopes: ['tilesets:write'],
        team: {
          ...team,
          id: (grants === 1 ? options.initialTeamId : options.renewedTeamId) ?? team.id,
        },
      });
    }
    assert.equal(authorization, `Bearer tf_cap_${String(grants).repeat(80)}`);
    requests += 1;
    return Response.json({ok: true});
  }) as typeof fetch;

  const authority = await resolveTeamAuthority({json: true, team: '@acme'}, ['tilesets:write'], {
    defaultApiUrl: apiOrigin,
    loadAuthConfig: async () => ({
      version: 2,
      sessions: {
        [apiOrigin]: {
          account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
          accountSession,
          apiOrigin,
          createdAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 86_400_000).toISOString(),
          sessionId: 'cli_ada',
        },
      },
    }),
  });
  return {
    authority,
    expire: () => {
      now += 301_000;
    },
    grants: () => grants,
    requests: () => requests,
  };
}
