import assert from 'node:assert/strict';
import test from 'node:test';
import {geolocate, GEOIP_ERROR_CODES, GeoIpError} from '../src/client';

const anonymousAvailable = {
  location: {city: 'Lisboa', countryCode: 'PT'},
  schemaVersion: 1,
  status: 'available',
  usage: {units: 0},
};

const managedAvailable = {...anonymousAvailable, usage: {units: 1}};
const unavailable = {
  location: null,
  schemaVersion: 1,
  status: 'unavailable',
  usage: {units: 0},
};

test('posts one anonymous request without credentials or retries', async () => {
  const requests: Request[] = [];
  const result = await geolocate({
    apiUrl: 'https://api.example.test/root/',
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(anonymousAvailable);
    },
  });

  assert.equal(result.status, 'available');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geoip');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('Authorization'), null);
  assert.equal(requests[0]?.headers.get('Accept'), 'application/json');
  assert.equal(requests[0]?.headers.get('Content-Type'), 'application/json');
  assert.equal(requests[0]?.credentials, 'omit');
  assert.equal(requests[0]?.redirect, 'error');
  assert.deepEqual(await requests[0]?.json(), {});
});

test('posts one managed request after trimming its map ID', async () => {
  const requests: Request[] = [];
  const result = await geolocate({
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(managedAvailable);
    },
    mapId: '  map_1234567890abcdef  ',
  });

  assert.equal(result.status, 'available');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.tileflow.dev/v1/geoip');
  assert.deepEqual(await requests[0]?.json(), {mapId: 'map_1234567890abcdef'});
});

test('rejects invalid options and never downgrades a managed request', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json(anonymousAvailable);
  };

  for (const options of [
    {mapId: undefined},
    {mapId: null},
    {mode: 'anonymous'},
    {mode: 'managed'},
    {extra: true, mapId: 'map_1234567890abcdef'},
    {mapId: 'map_too-short'},
    {mode: 'automatic'},
    {apiKey: 'secret'},
  ]) {
    await assert.rejects(
      geolocate({...options, fetch: fetcher} as never),
      /Invalid Tileflow GeoIP options/u,
    );
  }
  assert.equal(calls, 0);
});

test('rejects a redirected origin and never repeats the request', async () => {
  const response = Response.json(anonymousAvailable);
  Object.defineProperty(response, 'redirected', {value: true});
  let calls = 0;

  await assert.rejects(
    geolocate({
      fetch: async () => {
        calls += 1;
        return response;
      },
    }),
    /request failed/u,
  );
  assert.equal(calls, 1);
});

test('rejects response usage that does not match the selected mode', async () => {
  for (const [options, response] of [
    [{}, managedAvailable],
    [{mapId: 'map_1234567890abcdef'}, anonymousAvailable],
  ] as const) {
    await assert.rejects(
      geolocate({...options, fetch: async () => Response.json(response)}),
      /invalid response/u,
    );
  }

  assert.deepEqual(await geolocate({fetch: async () => Response.json(unavailable)}), unavailable);
});

test('bounds success and error bodies, including streamed bodies', async () => {
  let canceled = false;
  for (const response of [
    new Response('x'.repeat(8193)),
    new Response('', {headers: {'Content-Length': '8193'}}),
    new Response('{private-body', {status: 503}),
  ]) {
    await assert.rejects(geolocate({fetch: async () => response.clone()}), (error) => {
      assert.ok(error instanceof GeoIpError);
      assert.doesNotMatch(error.message, /private-body/u);
      return true;
    });
  }

  const streamed = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(8193)));
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  await assert.rejects(geolocate({fetch: async () => streamed}), /invalid response/u);
  assert.equal(canceled, true);
});

test('preserves safe known errors and makes unknown or generic failures safe', async () => {
  await assert.rejects(
    geolocate({
      fetch: async () =>
        Response.json(
          {
            code: 'GEOIP_USAGE_UNCONFIRMED',
            error: 'Usage may have been counted; do not repeat this request.',
            requestId: 'req_123',
          },
          {status: 503},
        ),
      mapId: 'map_1234567890abcdef',
    }),
    (error) => {
      assert.ok(error instanceof GeoIpError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'GEOIP_USAGE_UNCONFIRMED');
      assert.equal(error.requestId, 'req_123');
      return true;
    },
  );

  for (const [code, status] of [
    ['GEOIP_ABORTED', 499],
    ['GEOIP_ANONYMOUS_LIMITED', 429],
    ['GEOIP_DISABLED', 503],
    ['GEOIP_INVALID_REQUEST', 400],
    ['GEOIP_MAP_NOT_FOUND', 404],
    ['GEOIP_ORIGIN_FORBIDDEN', 403],
    ['GEOIP_QUOTA_EXCEEDED', 429],
    ['GEOIP_REQUEST_TOO_LARGE', 413],
    ['GEOIP_UNAVAILABLE', 503],
  ] as const) {
    await assert.rejects(
      geolocate({
        fetch: async () => Response.json({code, error: 'Known GeoIP failure'}, {status}),
      }),
      (error) => {
        assert.ok(error instanceof GeoIpError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      },
    );
  }

  for (const response of [
    Response.json({code: 'FUTURE_FAILURE', error: 'private'}, {status: 503}),
    Response.json({error: 'Rate limited', requestId: 'req_429'}, {status: 429}),
  ]) {
    await assert.rejects(geolocate({fetch: async () => response.clone()}), (error) => {
      assert.ok(error instanceof GeoIpError);
      assert.equal(error.code, null);
      return true;
    });
  }
  assert.ok(GEOIP_ERROR_CODES.includes('GEOIP_MAP_NOT_FOUND'));
});

test('preserves extensible unconfirmed errors with every platform request ID prefix', async () => {
  for (const prefix of ['.', ':', '-', '_', 'a']) {
    await assert.rejects(
      geolocate({
        fetch: async () =>
          Response.json(
            {
              code: 'GEOIP_USAGE_UNCONFIRMED',
              error: 'One API unit may have been counted; do not repeat this request.',
              futureErrorField: true,
              requestId: `${prefix}edge-id`,
            },
            {status: 503},
          ),
        mapId: 'map_1234567890abcdef',
      }),
      (error) => {
        assert.ok(error instanceof GeoIpError);
        assert.equal(error.code, 'GEOIP_USAGE_UNCONFIRMED');
        assert.equal(error.requestId, `${prefix}edge-id`);
        assert.match(error.message, /may have been counted/u);
        return true;
      },
    );
  }
});

test('preserves extensible generic errors but never trusts a malformed, unknown, or mismatched code', async () => {
  await assert.rejects(
    geolocate({
      fetch: async () =>
        Response.json(
          {error: 'Rate limited', futureErrorField: true, requestId: '.edge-id'},
          {status: 429},
        ),
    }),
    (error) => {
      assert.ok(error instanceof GeoIpError);
      assert.equal(error.code, null);
      assert.equal(error.requestId, '.edge-id');
      assert.equal(error.message, 'Rate limited');
      return true;
    },
  );

  for (const body of [
    {code: 'FUTURE_FAILURE', error: 'private unknown code'},
    {code: 123, error: 'private malformed code'},
    {code: 'GEOIP_DISABLED', error: 'private mismatched status'},
  ]) {
    await assert.rejects(
      geolocate({fetch: async () => Response.json(body, {status: 429})}),
      (error) => {
        assert.ok(error instanceof GeoIpError);
        assert.equal(error.code, null);
        assert.equal(error.requestId, null);
        assert.equal(error.message, 'Tileflow GeoIP request failed');
        return true;
      },
    );
  }
});

test('passes through aborts without another request and cancels response reading', async () => {
  const controller = new AbortController();
  const reason = new Error('caller stopped');
  let observed: AbortSignal | null = null;
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
  );
  const pending = geolocate({
    fetch: async (_input, init) => {
      observed = init?.signal as AbortSignal;
      return response;
    },
    signal: controller.signal,
  });
  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(observed, controller.signal);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});
