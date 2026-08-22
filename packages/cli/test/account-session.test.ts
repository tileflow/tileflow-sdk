import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {
  type CliAccountSessionV2,
  emptyAuthConfig,
  installAccountSession,
  loadAuthConfig,
  readAuthFile,
  removeAccountSession,
  resolveAccountSession,
  writeAuthFileAtomic,
} from '../src/account-session';

test('account auth state writes atomically with one project-free session per API origin', async (t) => {
  const fixture = await createFixture(t);
  const first = session({accountSession: token('a')});
  const replacement = session({accountSession: token('b'), sessionId: 'cli_session_replacement'});

  await installAccountSession(first, fixture.authPath);
  await installAccountSession(replacement, fixture.authPath);

  const state = await readAuthFile(fixture.authPath);
  assert.equal(state.kind, 'v2');
  if (state.kind !== 'v2') return;
  assert.equal(Object.keys(state.config.sessions).length, 1);
  assert.equal(state.config.sessions[first.apiOrigin].accountSession, replacement.accountSession);
  if (process.platform !== 'win32') {
    assert.equal((await stat(fixture.authPath)).mode & 0o777, 0o600);
    assert.equal((await stat(fixture.authDirectory)).mode & 0o777, 0o700);
  }
  assert.deepEqual(
    (await readdir(fixture.authDirectory)).filter((entry) => entry.includes('.tmp-')),
    [],
  );
  const source = await readFile(fixture.authPath, 'utf8');
  assert.doesNotMatch(source, /project|profile|selection|directory/i);
});

test('sessions are selected only by normalized origin and expiry', async () => {
  const first = session();
  const second = session({
    accountSession: token('c'),
    apiOrigin: 'https://other.example.test',
    sessionId: 'cli_session_other',
  });
  const config = {
    sessions: {[first.apiOrigin]: first, [second.apiOrigin]: second},
    version: 2 as const,
  };

  assert.equal(resolveAccountSession(config, `${first.apiOrigin}/`).kind, 'selected');
  assert.equal(resolveAccountSession(config, second.apiOrigin).kind, 'selected');
  assert.equal(resolveAccountSession(config, 'https://missing.example.test').kind, 'missing');
  assert.equal(
    resolveAccountSession(config, first.apiOrigin, new Date('2027-01-01T00:00:00.000Z')).kind,
    'expired',
  );
  const removed = removeAccountSession(config, first.apiOrigin);
  assert.equal(removed.removed?.sessionId, first.sessionId);
  assert.deepEqual(Object.keys(removed.config.sessions), [second.apiOrigin]);
});

test('legacy project login is recognized but never elevated or modified', async (t) => {
  const fixture = await createFixture(t);
  const legacy = `${JSON.stringify({
    apiKey: `tf_cli_${'z'.repeat(48)}`,
    apiUrl: 'https://api.example.test',
    projectId: 'prj_legacy',
    scopes: ['styles:write'],
  })}\n`;
  await writeFile(fixture.authPath, legacy, {mode: 0o600});

  assert.equal((await readAuthFile(fixture.authPath)).kind, 'legacy_project_login');
  await assert.rejects(loadAuthConfig(fixture.authPath), /Run `tileflow login`/);
  assert.equal(await readFile(fixture.authPath, 'utf8'), legacy);
});

test('a successful fresh login replaces the unpublished profile-selection shape', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.authPath,
    `${JSON.stringify({profiles: {}, selections: {}, version: 2})}\n`,
    {mode: 0o600},
  );
  assert.equal((await readAuthFile(fixture.authPath)).kind, 'superseded_profiles');

  await installAccountSession(session(), fixture.authPath);
  const loaded = await loadAuthConfig(fixture.authPath);
  assert.equal(Object.keys(loaded.sessions).length, 1);
});

test('empty account state remains a valid bounded document', async (t) => {
  const fixture = await createFixture(t);
  await writeAuthFileAtomic(emptyAuthConfig(), fixture.authPath);
  assert.deepEqual(await loadAuthConfig(fixture.authPath), emptyAuthConfig());
});

function session(overrides: Partial<CliAccountSessionV2> = {}): CliAccountSessionV2 {
  return {
    account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
    accountSession: token('d'),
    apiOrigin: 'https://api.example.test',
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sessionId: 'cli_session_ada',
    ...overrides,
  };
}

function token(character: string) {
  return `tf_session_${character.repeat(64)}`;
}

async function createFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-account-session-'));
  const authDirectory = join(directory, '.tileflow');
  const authPath = join(authDirectory, 'config.json');
  await mkdir(authDirectory, {mode: 0o700});
  t.after(async () => {
    const {rm} = await import('node:fs/promises');
    await rm(directory, {force: true, recursive: true});
  });
  return {authDirectory, authPath};
}
