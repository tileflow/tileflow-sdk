import assert from 'node:assert/strict';
import test from 'node:test';
import {createStaticMap, StaticMapError} from '../src/client';
import {StaticMapRequestError} from '../src/scene';

const scene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
  theme: 'light',
};

test('retains the request reference and retry delay without retrying an HTTP failure', async () => {
  let calls = 0;
  await assert.rejects(
    createStaticMap(scene, {
      fetch: async () => {
        calls += 1;
        return Response.json(
          {code: 'STATIC_RENDERER_SATURATED', error: 'The renderer is busy', retryable: true},
          {headers: {'Retry-After': '3', 'X-Request-ID': 'request-render-1'}, status: 503},
        );
      },
      idempotencyKey: 'static_diagnostic_reference',
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaticMapError);
      assert.equal(error.requestId, 'request-render-1');
      assert.equal(error.retryAfterMs, 3000);
      assert.equal(error.retryable, true);
      assert.equal(error.response.requestId, error.requestId);
      assert.equal(error.response.retryAfterMs, error.retryAfterMs);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('preserves typed request details with additive transport metadata', async () => {
  const details = {icon: 'shop', overlay: {id: 'shop-marker', index: 0, type: 'symbol'}};
  await assert.rejects(
    createStaticMap(scene, {
      fetch: async () =>
        Response.json(
          {
            code: 'STATIC_MAP_ICON_UNAVAILABLE',
            details,
            error: 'The requested icon is not available in the map',
            internal: 'private-diagnostic-value',
            reason: 'ICON_NOT_FOUND',
            requestId: 'request-body-1',
            retryable: false,
          },
          {headers: {'Retry-After': '5', 'X-Request-ID': 'request-header-1'}, status: 422},
        ),
      idempotencyKey: 'static_diagnostic_details',
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaticMapRequestError);
      assert.equal(error.reason, 'ICON_NOT_FOUND');
      assert.equal(error.requestId, 'request-body-1');
      assert.equal(error.retryAfterMs, 5000);
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, details);
      assert.deepEqual(error.response.details, details);
      assert.equal(error.response.reason, error.reason);
      assert.equal(error.response.requestId, error.requestId);
      assert.equal('internal' in error.response, false);
      assert.equal(Object.isFrozen(error.response), true);
      return true;
    },
  );
});

test('redacts credentials and signed URLs in public diagnostic strings and overlay identifiers', async () => {
  const apiKey = 'custom-private-credential';
  const token = 'tf_live_private-remote-token';
  const password = 'private-password';
  const signature = 'private-signature';
  await assert.rejects(
    createStaticMap(scene, {
      apiKey,
      fetch: async () =>
        Response.json(
          {
            code: 'STATIC_MAP_ICON_UNAVAILABLE',
            details: {icon: 'shop', overlay: {id: apiKey, index: 0, type: 'symbol'}},
            error: `Asset rejected for ${apiKey}, Bearer ${token}, password="${password}" and https://assets.example.test/image?signature=${signature}`,
            reason: 'ICON_NOT_FOUND',
            requestId: token,
            retryable: false,
          },
          {headers: {'X-Request-ID': 'safe-reference'}, status: 422},
        ),
      idempotencyKey: 'static_diagnostic_secrecy',
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaticMapRequestError);
      assert.equal(error.requestId, 'safe-reference');
      assert.equal(error.response.code, 'STATIC_MAP_ICON_UNAVAILABLE');
      const diagnostic = JSON.stringify({message: error.message, response: error.response});
      for (const secret of [apiKey, token, password, signature]) {
        assert.equal(diagnostic.includes(secret), false);
      }
      assert.equal(diagnostic.includes('https://'), false);
      assert.equal(error.details?.overlay?.id, '[redacted]');
      return true;
    },
  );
});

test('redacts complete quoted credentials and Basic authentication material', async () => {
  for (const message of [
    'Rejected credentials: {"password":"secret with spaces"}',
    "Rejected credentials: {'access_token':'secret with spaces'}",
    'Rejected credentials: {"password":"secret \\"quoted\\" suffix"}',
    'Rejected credentials: password="secret with spaces',
    'Authorization failed for Basic dXNlcjpzZWNyZXQ=',
  ]) {
    await assert.rejects(
      createStaticMap(scene, {
        fetch: async () => Response.json({error: message}, {status: 403}),
        idempotencyKey: 'static_diagnostic_quoted_credentials',
      }),
      (error: unknown) => {
        assert.ok(error instanceof StaticMapError);
        assert.doesNotMatch(
          JSON.stringify({message: error.message, response: error.response}),
          /secret|with spaces|quoted|suffix|dXNlcjpzZWNyZXQ/u,
        );
        return true;
      },
    );
  }
});

test('does not reflect SQL diagnostics, stack dumps or control characters', async () => {
  for (const message of [
    'Failed query: select password from credentials',
    'Query: select private_value from private_table',
    'Stack: private-stack-value',
    'SQLITE_ERROR: no such table private_table',
    'SQLSTATE23505: duplicate private_constraint',
    'PostgreSQL error: private_relation is unavailable',
    'at query (/app/private.ts:10:3)',
    'Renderer failed\u001b[31mprivate-terminal-value',
    'Renderer failed\u202eprivate-bidi-value',
  ]) {
    await assert.rejects(
      createStaticMap(scene, {
        fetch: async () => Response.json({error: message}, {status: 503}),
        idempotencyKey: 'static_diagnostic_unsafe',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof StaticMapError, false);
        assert.equal(error.message.includes('private'), false);
        assert.equal(error.message.includes('password'), false);
        return true;
      },
    );
  }
});

test('ignores invalid metadata and does not infer retryability from status or delay', async () => {
  for (const retryAfter of ['-1', 'Infinity', '86401', 'not-a-date']) {
    await assert.rejects(
      createStaticMap(scene, {
        fetch: async () =>
          Response.json(
            {
              code: 'RATE_LIMITED',
              error: 'Too many requests',
              requestId: 'not a safe identifier',
              retryAfterMs: 100_000_000,
            },
            {headers: {'Retry-After': retryAfter, 'X-Request-ID': 'safe-reference'}, status: 429},
          ),
        idempotencyKey: 'static_diagnostic_invalid_metadata',
      }),
      (error: unknown) => {
        assert.ok(error instanceof StaticMapError);
        assert.equal(error.requestId, 'safe-reference');
        assert.equal(error.retryAfterMs, null);
        assert.equal(error.retryable, null);
        return true;
      },
    );
  }
});

test('accepts a bounded HTTP-date retry header', async () => {
  await assert.rejects(
    createStaticMap(scene, {
      fetch: async () =>
        Response.json(
          {error: 'Temporarily unavailable'},
          {
            headers: {'Retry-After': 'Sat, 01 Jan 2000 00:00:00 GMT'},
            status: 503,
          },
        ),
      idempotencyKey: 'static_diagnostic_date',
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaticMapError);
      assert.equal(error.retryAfterMs, 0);
      assert.equal(error.retryable, null);
      return true;
    },
  );
});
