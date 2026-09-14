import {Command} from 'commander';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {registerIconSetCommands} from '../src/icon-set-command';

const apiKey = `tf_live_${'a'.repeat(48)}`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/></svg>';

type CapturedRequest = {
  authorization: string;
  body: BodyInit | null | undefined;
  headers: Headers;
  method: string;
  url: string;
};

function program(
  respond: (request: CapturedRequest) => Response | Promise<Response>,
  captured: CapturedRequest[],
  loadAuthConfig: () => Promise<never> = async () => {
    throw new Error('account state must not be loaded');
  },
) {
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    const request: CapturedRequest = {
      authorization: headers.get('authorization') ?? '',
      body: init?.body,
      headers,
      method: init?.method ?? 'GET',
      url: String(input),
    };
    captured.push(request);
    return respond(request);
  }) as typeof fetch;
  const command = new Command().name('tileflow').exitOverride();
  registerIconSetCommands(command, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: loadAuthConfig as never,
  });
  return command;
}

/** Capture only while a command runs; the test reporter keeps the real streams otherwise. */
function captureOutput(t: {after(callback: () => void): void}) {
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalError = console.error;
  const output = {
    stderr: '',
    stdout: '',
    async run<T>(operation: () => Promise<T>): Promise<T> {
      process.stdout.write = ((chunk: string | Uint8Array) => {
        output.stdout += String(chunk);
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        output.stderr += String(chunk);
        return true;
      }) as typeof process.stderr.write;
      console.log = (...values: unknown[]) => {
        output.stdout += `${values.join(' ')}\n`;
      };
      console.error = (...values: unknown[]) => {
        output.stderr += `${values.join(' ')}\n`;
      };
      try {
        return await operation();
      } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        console.log = originalLog;
        console.error = originalError;
      }
    },
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  });
  return output;
}

/** Exactly the fields the Icon Set service projects for one retained revision. */
const revision = (version: number) => ({
  id: `icv_${String(version).padStart(16, '0')}`,
  reference: '@acme/brand',
  version,
  publishedAt: '2026-09-14T10:00:00.000Z',
  purgedAt: null,
  iconCount: 1,
  totalBytes: 383,
  publisher: {kind: 'membership', id: 'user_1'},
  pin: null as unknown,
});

const revisionSummary = (version: number) => ({
  id: `icv_${String(version).padStart(16, '0')}`,
  reference: '@acme/brand',
  version,
  publishedAt: '2026-09-14T10:00:00.000Z',
  purgedAt: null,
  iconCount: 1,
  totalBytes: 383,
  publisher: {kind: 'membership', id: 'user_1'},
  packageId: `icp_${String(version).padStart(16, '0')}`,
});

test('Team data keys read the Icon Set catalog without loading account state', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    () => Response.json({schemaVersion: 1, sets: [], nextCursor: null}),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'list',
      '--api-url',
      'https://api.example.test',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.url, 'https://api.example.test/v1/icon-sets?limit=100');
  assert.equal(captured[0]!.authorization, `Bearer ${apiKey}`);
  assert.deepEqual(JSON.parse(output.stdout), {
    command: 'icon-set list',
    schemaVersion: 1,
    sets: [],
    team: null,
  });
});

test('list follows bounded cursors and rejects a repeated page', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const set = {
    id: 'ics_0000000000000001',
    reference: '@acme/brand',
    name: 'Brand',
    description: '',
    archivedAt: null,
    latestVersion: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
  const command = program(
    (request) =>
      Response.json(
        request.url.includes('cursor=')
          ? {
              schemaVersion: 1,
              sets: [{...set, id: 'ics_0000000000000002', reference: '@acme/transport'}],
              nextCursor: null,
            }
          : {schemaVersion: 1, sets: [set], nextCursor: 'next-page'},
      ),
    captured,
  );

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'icon-set', 'list', '--api-key', apiKey, '--json']),
  );

  assert.deepEqual(
    captured.map((request) => request.url),
    [
      'https://api.tileflow.dev/v1/icon-sets?limit=100',
      'https://api.tileflow.dev/v1/icon-sets?limit=100&cursor=next-page',
    ],
  );
  const document = JSON.parse(output.stdout) as {sets: Array<{reference: string}>};
  assert.deepEqual(
    document.sets.map((entry) => entry.reference),
    ['@acme/brand', '@acme/transport'],
  );
});

test('versions accepts bounded revision summaries without artifact manifests', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    () => Response.json({schemaVersion: 1, versions: [revisionSummary(2)], nextCursor: null}),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'versions',
      'brand',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  assert.equal(captured[0]!.url, 'https://api.tileflow.dev/v1/icon-sets/brand/versions?limit=100');
  const document = JSON.parse(output.stdout) as {versions: Array<Record<string, unknown>>};
  assert.deepEqual(document.versions, [
    {
      iconCount: 1,
      id: 'icv_0000000000000002',
      packageId: 'icp_0000000000000002',
      publishedAt: '2026-09-14T10:00:00.000Z',
      purgedAt: null,
      reference: '@acme/brand',
      totalBytes: 383,
      version: 2,
    },
  ]);
});

test('publish sends the exact four generated files with one durable idempotency key', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-set-publish-'));
  t.after(() => void rm(directory, {force: true, recursive: true}));
  await mkdir(join(directory, 'icons'));
  await writeFile(join(directory, 'icons', 'shop.svg'), svg);
  const originalCwd = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(originalCwd));

  const command = program(
    () => Response.json({schemaVersion: 1, changed: true, revision: revision(3)}),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'publish',
      './icons',
      '--id',
      'brand',
      '--api-key',
      apiKey,
      '--idempotency-key',
      'publish-key-0001',
      '--json',
    ]),
  );

  assert.equal(captured.length, 1);
  const request = captured[0]!;
  assert.equal(request.method, 'PUT');
  assert.match(
    request.url,
    /^https:\/\/api\.tileflow\.dev\/v1\/icon-sets\/brand\/versions\/[a-f0-9]{64}$/u,
  );
  assert.equal(request.headers.get('idempotency-key'), 'publish-key-0001');
  assert.ok(request.body instanceof FormData);
  const form = request.body;
  assert.deepEqual([...form.keys()].sort(), [
    'sprite.json',
    'sprite.png',
    'sprite@2x.json',
    'sprite@2x.png',
  ]);
  for (const [name, value] of form.entries()) {
    assert.ok(value instanceof File, `${name} must be a file part`);
    assert.equal(value.name, name);
  }
  const document = JSON.parse(output.stdout) as Record<string, unknown>;
  assert.equal(document.command, 'icon-set publish');
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(document.publication, 'changed');
  const iconSet = document.iconSet as Record<string, unknown>;
  assert.equal(iconSet.reference, '@acme/brand');
  assert.equal(iconSet.version, 3);
  assert.match(String(iconSet.contentHash), /^[a-f0-9]{64}$/u);
  assert.equal(output.stdout.includes(apiKey), false);
  assert.equal(output.stdout.includes(directory), false);
});

test('publish applies requested display metadata after the durable revision', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-set-metadata-'));
  t.after(() => void rm(directory, {force: true, recursive: true}));
  await mkdir(join(directory, 'icons'));
  await writeFile(join(directory, 'icons', 'shop.svg'), svg);
  const originalCwd = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(originalCwd));

  const command = program(
    (request) =>
      request.method === 'PUT'
        ? Response.json({schemaVersion: 1, changed: true, revision: revision(3)})
        : Response.json({
            schemaVersion: 1,
            set: {
              id: 'ics_0000000000000001',
              reference: '@acme/brand',
              name: 'Brand icons',
              description: 'Shared identity icons.',
              archivedAt: null,
              latestVersion: 3,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-14T10:00:00.000Z',
            },
          }),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'publish',
      './icons',
      '--id',
      'brand',
      '--name',
      'Brand icons',
      '--description',
      'Shared identity icons.',
      '--api-key',
      apiKey,
      '--idempotency-key',
      'publish-key-0001',
      '--json',
    ]),
  );

  assert.deepEqual(
    captured.map((request) => [request.method, request.url]),
    [
      ['PUT', captured[0]!.url],
      ['PATCH', 'https://api.tileflow.dev/v1/icon-sets/brand'],
    ],
  );
  assert.equal(captured[1]!.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(captured[1]!.body)), {
    description: 'Shared identity icons.',
    name: 'Brand icons',
  });
});

test('publish reports an explicit retryable failure when metadata delivery fails', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-set-metadata-failure-'));
  t.after(() => void rm(directory, {force: true, recursive: true}));
  await mkdir(join(directory, 'icons'));
  await writeFile(join(directory, 'icons', 'shop.svg'), svg);
  const originalCwd = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(originalCwd));

  const command = program((request) => {
    if (request.method === 'PUT') {
      return Response.json({schemaVersion: 1, changed: true, revision: revision(3)});
    }
    throw new Error('metadata transport unavailable');
  }, captured);

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'publish',
      './icons',
      '--id',
      'brand',
      '--name',
      'Brand icons',
      '--api-key',
      apiKey,
      '--idempotency-key',
      'publish-key-0001',
      '--json',
    ]),
  );

  assert.deepEqual(
    captured.map((request) => request.method),
    ['PUT', 'PATCH'],
  );
  assert.equal(JSON.parse(output.stderr).error.code, 'icon_set_metadata_update_failed');
});

test('an unchanged republication reports the same revision without a new integer', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-set-retry-'));
  t.after(() => void rm(directory, {force: true, recursive: true}));
  await mkdir(join(directory, 'icons'));
  await writeFile(join(directory, 'icons', 'shop.svg'), svg);
  const originalCwd = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(originalCwd));

  const command = program(
    () => Response.json({schemaVersion: 1, changed: false, revision: revision(3)}),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'publish',
      './icons',
      '--id',
      'brand',
      '--api-key',
      apiKey,
      '--idempotency-key',
      'publish-key-0001',
      '--json',
    ]),
  );

  const document = JSON.parse(output.stdout) as Record<string, unknown>;
  assert.equal(document.publication, 'unchanged');
  assert.equal((document.iconSet as {version: number}).version, 3);
});

test('archive and unarchive patch only the catalog display state', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const set = {
    id: 'ics_0000000000000001',
    reference: '@acme/brand',
    name: 'Brand',
    description: '',
    archivedAt: '2026-09-14T10:00:00.000Z',
    latestVersion: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
  };
  const command = program(() => Response.json({schemaVersion: 1, set}), captured);

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'archive',
      'brand',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );
  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'unarchive',
      'brand',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  assert.deepEqual(
    captured.map((request) => [request.method, request.url, request.body]),
    [
      ['PATCH', 'https://api.tileflow.dev/v1/icon-sets/brand', '{"archived":true}'],
      ['PATCH', 'https://api.tileflow.dev/v1/icon-sets/brand', '{"archived":false}'],
    ],
  );
  assert.equal(output.stdout.trim().split('\n').length, 2);
});

test('purge requires the exact confirmation and an explicit unknown-lock acknowledgement', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    () =>
      Response.json({
        schemaVersion: 1,
        result: {
          schemaVersion: 1,
          versionId: 'icv_0000000000000002',
          version: 2,
          purged: true,
          knownRetainedDeployments: 1,
          physicalBytesReleased: 0,
          unknownRepositoryLocks: true,
          warning: 'Undeployed repository locks are not discoverable.',
        },
      }),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'purge',
      'brand',
      '--version',
      '2',
      '--confirm',
      '@acme/brand@3',
      '--acknowledge-unknown-locks',
      '--idempotency-key',
      'purge-key-0001',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );
  assert.equal(captured.length, 0);
  assert.match(output.stderr, /confirm/iu);

  process.exitCode = 0;
  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'purge',
      'brand',
      '--version',
      '2',
      '--confirm',
      '@acme/brand@2',
      '--idempotency-key',
      'purge-key-0001',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );
  assert.equal(captured.length, 0);
  assert.match(output.stderr, /acknowledge/iu);

  process.exitCode = 0;
  output.stdout = '';
  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'purge',
      'brand',
      '--version',
      '2',
      '--confirm',
      '@acme/brand@2',
      '--acknowledge-unknown-locks',
      '--idempotency-key',
      'purge-key-0001',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.method, 'POST');
  assert.equal(captured[0]!.url, 'https://api.tileflow.dev/v1/icon-sets/brand/versions/2/purge');
  assert.equal(captured[0]!.headers.get('idempotency-key'), 'purge-key-0001');
  assert.deepEqual(JSON.parse(String(captured[0]!.body)), {
    acknowledgeUnknownLocks: true,
    confirmation: '@acme/brand@2',
  });
  const document = JSON.parse(output.stdout) as {result: {unknownRepositoryLocks: boolean}};
  assert.equal(document.result.unknownRepositoryLocks, true);
});

test('account sessions exchange for a Team capability carrying only Icon Set scopes', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    (request) => {
      if (request.url.endsWith('/v1/cli/teams')) {
        return Response.json({
          schemaVersion: 1,
          teams: [{id: 'org_1', name: 'Acme', slug: 'acme'}],
        });
      }
      if (request.url.endsWith('/v1/cli/team-capabilities')) {
        const body = JSON.parse(String(request.body)) as {scopes: string[]};
        return Response.json({
          schemaVersion: 1,
          capability: `tf_cap_${'b'.repeat(20)}`,
          expiresAt: '2030-01-01T00:00:00.000Z',
          reference: '@acme',
          scopes: [...body.scopes].sort(),
          team: {id: 'org_1', name: 'Acme', slug: 'acme'},
        });
      }
      return Response.json({schemaVersion: 1, sets: [], nextCursor: null});
    },
    captured,
    (async () => ({
      version: 2,
      sessions: {
        'https://api.tileflow.dev': {
          account: {email: 'agent@example.test', id: 'user_1', name: 'Agent'},
          accountSession: `tf_session_${'c'.repeat(64)}`,
          apiOrigin: 'https://api.tileflow.dev',
          createdAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2030-01-01T00:00:00.000Z',
          sessionId: 'sess_1',
        },
      },
    })) as never,
  );

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'icon-set', 'list', '--team', '@acme', '--json']),
  );

  const capability = captured.find((request) => request.url.endsWith('/v1/cli/team-capabilities'));
  assert.ok(capability);
  assert.deepEqual(JSON.parse(String(capability.body)), {scopes: ['icons:read'], team: '@acme'});
  assert.deepEqual((JSON.parse(output.stdout) as {team: unknown}).team, {
    id: 'org_1',
    slug: 'acme',
  });
});

test('a rejected credential emits a sanitized bounded failure document', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    () =>
      Response.json(
        {schemaVersion: 1, code: 'ICON_SET_FORBIDDEN', error: 'secret internal detail'},
        {status: 403},
      ),
    captured,
  );

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'icon-set',
      'status',
      'brand',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  const failure = JSON.parse(output.stderr) as {error: {code: string; message: string}};
  assert.equal(failure.error.code, 'http_403');
  assert.equal(failure.error.message.includes('secret internal detail'), false);
  assert.equal(output.stderr.includes(apiKey), false);
  assert.equal(process.exitCode, 1);
});
