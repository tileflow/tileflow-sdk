import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CoordinatesCommand,
  CoordinatesContractError,
  createCoordinatesClient,
} from '../src/index';
import {request, transformResponse} from './fixtures';

const apiKey = 'tf_coordinates_test_key';

function failure(command: CoordinatesCommand) {
  return {
    schemaVersion: 1,
    ok: false,
    command,
    releaseId: null,
    provenance: null,
    warnings: [],
    usage: {mode: 'hosted', state: 'not-consumed', units: 0},
    error: {
      code: 'COORDINATES_INVALID_REQUEST',
      reason: 'INVALID_VALUE',
      phase: 'input',
      details: {},
      message: 'remote diagnostic must not pass through',
    },
  };
}

function hostedTransformResponse() {
  const response = transformResponse() as any;
  response.usage = {mode: 'hosted', state: 'committed', units: 1};
  response.invocationId = 'cq_00000000-0000-4000-8000-000000000001';
  return response;
}

function expectsContractError(error: unknown, reason?: string) {
  assert.ok(error instanceof CoordinatesContractError);
  if (reason) assert.equal(error.reason, reason);
  return true;
}

test('each command sends one normalized POST request to its Coordinates endpoint', async () => {
  const calls: Array<{init?: RequestInit; url: string}> = [];
  const client = createCoordinatesClient({
    apiKey,
    apiUrl: 'http://localhost:8787/base/',
    fetch: async (url, init) => {
      calls.push({url: String(url), init});
      const command = String(url).split('/').at(-1) as CoordinatesCommand;
      return Response.json(failure(command), {status: 400});
    },
  });

  const callsByCommand = [
    ['search', () => client.search({})],
    ['describe', () => client.describe({id: 'EPSG:4258'})],
    ['operations', () => client.operations({from: 'EPSG:4258', to: 'EPSG:25832'})],
    ['transform', () => client.transform(request)],
  ] as const;
  for (const [command, run] of callsByCommand) {
    await assert.rejects(run, (error: unknown) => {
      expectsContractError(error);
      assert.equal(JSON.stringify(error).includes('remote diagnostic'), false);
      return true;
    });
    const call = calls.at(-1)!;
    assert.equal(call.url, `http://localhost:8787/base/v1/coordinates/${command}`);
    assert.equal(call.init?.method, 'POST');
    assert.equal(call.init?.redirect, 'error');
    assert.equal((call.init?.headers as Record<string, string>).Authorization, `Bearer ${apiKey}`);
  }
  assert.equal(calls.length, 4);
});

test('a fully validated Hosted transform response is returned', async () => {
  let calls = 0;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(String(url), 'https://api.tileflow.dev/v1/coordinates/transform');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        schemaVersion: 1,
        from: 'EPSG:4258',
        to: 'EPSG:25832',
        positions: [[12, 55]],
        allowBallpark: false,
        requireBestKnown: true,
      });
      return Response.json(hostedTransformResponse());
    },
  });

  const response = await client.transform(request);
  assert.equal(response.ok, true);
  assert.equal(response.command, 'transform');
  assert.equal(calls, 1);
});

test('invalid requests fail before fetch', async () => {
  let calls = 0;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () => {
      calls += 1;
      return Response.json(hostedTransformResponse());
    },
  });

  await assert.rejects(
    () => client.transform({...request, positions: []}),
    (error: unknown) => expectsContractError(error, 'INVALID_VALUE'),
  );
  assert.equal(calls, 0);
});

test('JavaScript options reject unknown fields and invalid signals before fetch', async () => {
  const fetch = async () => Response.json(hostedTransformResponse());
  for (const options of [
    {apiKey, fetch, unexpected: true},
    {apiKey, fetch, signal: {}},
  ]) {
    assert.throws(
      () => createCoordinatesClient(options as any),
      (error: unknown) => expectsContractError(error, 'INVALID_VALUE'),
    );
  }

  let calls = 0;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () => {
      calls += 1;
      return Response.json(hostedTransformResponse());
    },
  });
  for (const options of [{unexpected: true}, {signal: {}}]) {
    await assert.rejects(
      () => client.transform(request, options as any),
      (error: unknown) => expectsContractError(error, 'INVALID_VALUE'),
    );
  }
  assert.equal(calls, 0);
});

test('unsafe API URLs are rejected without a request', () => {
  for (const apiUrl of [
    'http://api.tileflow.dev',
    'https://key@api.tileflow.dev',
    'https://api.tileflow.dev/?token=secret',
    'https://api.tileflow.dev/#secret',
  ]) {
    assert.throws(
      () => createCoordinatesClient({apiKey, apiUrl, fetch: async () => Response.json({})}),
      (error: unknown) => expectsContractError(error, 'INVALID_VALUE'),
    );
  }
});

test('redirects, malformed bodies, and HTTP/body contradictions are safe failures', async () => {
  const redirected = Response.json(hostedTransformResponse());
  Object.defineProperty(redirected, 'redirected', {value: true});
  const replies = [
    redirected,
    new Response('remote secret: 12,55', {status: 500}),
    Response.json(failure('search')),
  ];
  let calls = 0;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () => replies[calls++]!,
  });

  await assert.rejects(
    () => client.transform(request),
    (error: unknown) => {
      expectsContractError(error, 'RESPONSE_SHAPE_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.transform(request),
    (error: unknown) => {
      expectsContractError(error, 'RESPONSE_SHAPE_INVALID');
      assert.equal(JSON.stringify(error).includes('12,55'), false);
      return true;
    },
  );
  await assert.rejects(
    () => client.search({}),
    (error: unknown) => expectsContractError(error, 'RESPONSE_SHAPE_INVALID'),
  );
  assert.equal(calls, 3);
});

test('oversized responses are cancelled and do not claim transform usage is zero', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () =>
      new Response(body, {headers: {'content-length': String(4 * 1024 * 1024 + 1)}}),
  });

  await assert.rejects(
    () => client.transform(request),
    (error: unknown) => {
      assert.ok(error instanceof CoordinatesContractError);
      assert.deepEqual(error.response.usage, {mode: 'hosted', state: 'unconfirmed', units: null});
      return true;
    },
  );
  assert.equal(cancelled, true);
});

test('abort reasons never enter the failure payload and make exactly one request', async () => {
  const abort = new AbortController();
  let calls = 0;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async (_url, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private abort reason')), {
          once: true,
        });
      });
    },
  });

  const pending = client.transform(request, {signal: abort.signal});
  abort.abort('private abort reason');
  await assert.rejects(pending, (error: unknown) => {
    expectsContractError(error, 'CANCELLED');
    assert.equal(JSON.stringify(error).includes('private abort reason'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('an abort bounds a fetch that ignores its signal and cancels a late response', async () => {
  const abort = new AbortController();
  let calls = 0;
  let resolveFetch: ((response: Response) => void) | undefined;
  let cancelled = false;
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () => {
      calls += 1;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    },
  });

  const pending = client.transform(request, {signal: abort.signal});
  abort.abort('private ignored abort reason');
  const outcome = await Promise.race([
    pending.then(
      () => 'resolved',
      () => 'rejected',
    ),
    new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
  ]);
  assert.equal(outcome, 'rejected');
  assert.equal(calls, 1);

  resolveFetch!(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('a Coordinates error thrown by fetch becomes a safe transport failure', async () => {
  const remoteError = new CoordinatesContractError({
    schemaVersion: 1,
    ok: false,
    command: 'transform',
    releaseId: null,
    provenance: null,
    warnings: [],
    usage: null,
    error: {
      code: 'COORDINATES_ACCESS_DENIED',
      reason: 'ACCESS_DENIED',
      phase: 'response',
      details: {},
    },
  });
  const client = createCoordinatesClient({
    apiKey,
    fetch: async () => {
      throw remoteError;
    },
  });

  await assert.rejects(
    () => client.transform(request),
    (error: unknown) => {
      assert.ok(error instanceof CoordinatesContractError);
      assert.equal(error.code, 'COORDINATES_UNAVAILABLE');
      assert.equal(error.reason, 'SERVICE_UNAVAILABLE');
      assert.deepEqual(error.response.usage, {mode: 'hosted', state: 'unconfirmed', units: null});
      return true;
    },
  );
});
