import assert from 'node:assert/strict';
import test from 'node:test';
import type {CompiledTileflowIconPackage} from '@tileflow/dev/icons';
import type {CliAccountSessionV2} from '../src/account-session';
import {
  requestHostedJson,
  requestMapCapability,
  requestProjectCapability,
  uploadHostedIconPackage,
  validateApiKey,
} from '../src/hosted-client';

test('Hosted client pins requests and credentials to one normalized origin', async () => {
  let calls = 0;
  let observedAuthorization = '';
  let observedUrl = '';
  const requestFetch = (async (input, init) => {
    calls += 1;
    observedUrl = String(input);
    observedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
    return Response.json({
      apiKeyId: 'key_test',
      credentialType: 'project_api_key',
      mapId: 'map_AbCdEfGhIjKlMnOp',
      organization: {id: 'org_test', name: 'Test', slug: 'test'},
      project: {id: 'prj_map', name: 'Map', slug: 'map'},
      projectId: 'prj_map',
      scopes: ['styles:write'],
    });
  }) as typeof fetch;

  const result = await validateApiKey('https://api.example.test/', 'tf_live_example', {
    fetch: requestFetch,
  });
  assert.equal(result.ok, true);
  assert.equal(observedUrl, 'https://api.example.test/v1/me');
  assert.equal(observedAuthorization, 'Bearer tf_live_example');

  await assert.rejects(
    requestHostedJson('https://api.example.test/tenant', '/v1/me', {}, {fetch: requestFetch}),
    /safe HTTP origin/u,
  );
  await assert.rejects(
    requestHostedJson(
      'https://api.example.test',
      '//attacker.example/collect',
      {},
      {
        fetch: requestFetch,
      },
    ),
    /safe root-relative path/u,
  );
  assert.equal(calls, 1);
});

test('Map capability requests preserve the visible target and hide its Project', async () => {
  const session: CliAccountSessionV2 = {
    account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
    accountSession: `tf_session_${'a'.repeat(64)}`,
    apiOrigin: 'https://api.example.test',
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sessionId: 'cli_session_ada',
  };
  let requestBody: Record<string, unknown> | null = null;
  const result = await requestMapCapability(
    session,
    {mapId: 'map_AbCdEfGhIjKlMnOp'},
    ['styles:write'],
    {
      fetch: (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          capability: `tf_cap_${'a'.repeat(80)}`,
          expiresAt: '2026-08-15T00:05:00.000Z',
          mapId: 'map_AbCdEfGhIjKlMnOp',
          scopes: ['styles:write'],
        });
      }) as typeof fetch,
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(requestBody, {
    mapId: 'map_AbCdEfGhIjKlMnOp',
    scopes: ['styles:write'],
  });
  assert.equal(Object.hasOwn(requestBody ?? {}, 'project'), false);
});

test('Hosted client applies a bounded timeout across fetch and body consumption', async () => {
  const hangingFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;

  await assert.rejects(
    requestHostedJson(
      'https://api.example.test',
      '/v1/status',
      {},
      {
        fetch: hangingFetch,
        timeoutMs: 5,
      },
    ),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
  await assert.rejects(
    requestHostedJson('https://api.example.test', '/v1/status', {}, {timeoutMs: 60_001}),
    /between 1 and 60000/u,
  );
});

test('Hosted client rejects chunked responses above the byte limit', async () => {
  let cancelled = false;
  const oversizedFetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(new Uint8Array(700_000));
          controller.enqueue(new Uint8Array(400_000));
        },
      }),
    )) as typeof fetch;

  await assert.rejects(
    requestHostedJson('https://api.example.test', '/v1/status', {}, {fetch: oversizedFetch}),
    /safe size limit/u,
  );
  assert.equal(cancelled, true);
});

test('Hosted authentication failures never reflect an untrusted remote body', async () => {
  const session: CliAccountSessionV2 = {
    account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
    accountSession: `tf_session_${'a'.repeat(64)}`,
    apiOrigin: 'https://api.example.test',
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sessionId: 'cli_session_ada',
  };
  const secret = 'REMOTE_INTERNAL_SECRET_SHOULD_NOT_BE_REFLECTED';
  const result = await requestProjectCapability(session, '@acme/maps', ['styles:write'], {
    fetch: (async () => Response.json({error: secret}, {status: 403})) as typeof fetch,
  });

  assert.deepEqual(result, {error: 'Project capability request failed (403).', ok: false});
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('icon upload accepts only the exact server-confirmed package identity and sprite URL', async () => {
  const iconPackage = compiledIconPackageFixture();
  const id = 'icp_1234567890abcdef';
  const exact = {
    changed: true,
    contentHash: iconPackage.contentHash,
    iconCount: iconPackage.manifest.iconNames.length,
    id,
    spriteUrl: `https://assets.example.test/sprites/${id}/sprite`,
    totalBytes: iconPackage.manifest.files.reduce((total, file) => total + file.byteLength, 0),
  };
  const request = (body: Record<string, unknown>) =>
    uploadHostedIconPackage(
      {apiKey: 'tf_live_example', apiUrl: 'https://api.example.test'},
      iconPackage,
      {fetch: (async () => Response.json(body)) as typeof fetch},
    );

  const accepted = await request(exact);
  assert.equal(accepted.ok, true);

  for (const drifted of [
    {...exact, contentHash: 'b'.repeat(64)},
    {...exact, iconCount: exact.iconCount + 1},
    {...exact, totalBytes: exact.totalBytes + 1},
    {...exact, spriteUrl: 'https://assets.example.test/sprites/icp_other_value_123/sprite'},
    {...exact, spriteUrl: `${exact.spriteUrl}?mutable=1`},
  ]) {
    await assert.rejects(
      request(drifted),
      /Icon package upload response did not confirm the submitted package/u,
    );
  }

  await assert.rejects(
    request({changed: true, spriteUrl: exact.spriteUrl}),
    /Icon package upload response returned an invalid response/u,
  );
});

function compiledIconPackageFixture(): CompiledTileflowIconPackage {
  const definitions = [
    ['sprite.json', 'application/json'],
    ['sprite.png', 'image/png'],
    ['sprite@2x.json', 'application/json'],
    ['sprite@2x.png', 'image/png'],
  ] as const;
  const files = definitions.map(([fileName, contentType], index) => ({
    contentType,
    fileName,
    source: new Uint8Array([index + 1]),
  }));
  return {
    contentHash: 'a'.repeat(64),
    files,
    manifest: {
      files: definitions.map(([name, contentType], index) => ({
        byteLength: 1,
        contentType,
        name,
        sha256: String(index + 1).repeat(64),
      })) as CompiledTileflowIconPackage['manifest']['files'],
      format: 'tileflow-icon-package-v1',
      iconNames: ['pin'],
      renderedIcons: [{name: 'pin', pixelSha256: {oneX: 'a'.repeat(64), twoX: 'b'.repeat(64)}}],
      sprites: {
        oneX: {height: 1, pixelRatio: 1, width: 1},
        twoX: {height: 2, pixelRatio: 2, width: 2},
      },
    },
  };
}
