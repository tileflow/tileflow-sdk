import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autocomplete,
  geocode,
  geocodeReverse,
  GEOCODING_ERROR_CODES,
  GeocodingError,
  resolveSuggestion,
} from '../src/client';

const success = {
  attribution: [{text: 'Synthetic fixture'}],
  queryId: 'gq_11111111-1111-4111-8111-111111111111',
  results: [],
  schemaVersion: 1,
  source: {id: 'synthetic', revision: 'fixture-1'},
  usage: {units: 1},
};

const autocompleteSuccess = {
  attribution: [{text: 'Synthetic fixture'}],
  schemaVersion: 1,
  source: {id: 'synthetic', revision: 'fixture-1'},
  suggestions: [{kind: 'place', label: 'Hospital La Paz', token: 'opaque-token_1'}],
};

const resolveSuccess = {
  attribution: [{text: 'Synthetic fixture'}],
  result: {address: {}, kind: 'place', label: 'Hospital La Paz', position: [-3.7, 40.4]},
  schemaVersion: 1,
  source: {id: 'synthetic', revision: 'fixture-1'},
  usage: {units: 1},
};

test('posts one normalized request with Team authorization and no retry', async () => {
  const requests: Request[] = [];
  const result = await geocode(
    {query: '  Lisboa  ', limit: 3},
    {
      apiKey: 'team_test_key',
      apiUrl: 'https://api.example.test/root/',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(success, {headers: {'Cache-Control': 'no-store'}});
      },
    },
  );

  assert.equal(result.queryId, success.queryId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geocoding/forward');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('Authorization'), 'Bearer team_test_key');
  assert.equal(requests[0]?.headers.get('Accept'), 'application/json');
  assert.equal(requests[0]?.headers.get('Content-Type'), 'application/json');
  assert.equal(requests[0]?.redirect, 'error');
  assert.deepEqual(await requests[0]?.json(), {
    limit: 3,
    query: 'Lisboa',
    retention: 'temporary',
  });
});

test('rejects a redirect response without replaying the authenticated request', async () => {
  let calls = 0;
  const response = Response.json(success);
  Object.defineProperty(response, 'redirected', {value: true});

  await assert.rejects(
    geocode(
      {query: 'Lisboa'},
      {
        apiKey: 'team_test_key',
        fetch: async () => {
          calls += 1;
          return response;
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.message, 'Tileflow geocoding request failed');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('rejects invalid requests before transport', async () => {
  let calls = 0;
  await assert.rejects(
    geocode(
      {query: ''},
      {
        apiKey: 'team_test_key',
        fetch: async () => {
          calls += 1;
          return Response.json(success);
        },
      },
    ),
    /Invalid Tileflow geocoding request/u,
  );
  assert.equal(calls, 0);
});

test('rejects plaintext remote API origins before sending a bearer credential', async () => {
  let calls = 0;
  await assert.rejects(
    geocode(
      {query: 'Lisboa'},
      {
        apiKey: 'team_test_key',
        apiUrl: 'http://api.example.test',
        fetch: async () => {
          calls += 1;
          return Response.json(success);
        },
      },
    ),
    /Invalid Tileflow API URL/u,
  );
  assert.equal(calls, 0);
});

test('rejects responses beyond the requested limit', async () => {
  const candidate = {
    address: {},
    kind: 'place',
    label: 'Place',
    position: [0, 0],
  };
  await assert.rejects(
    geocode(
      {query: 'Place', limit: 1},
      {
        apiKey: 'team_test_key',
        fetch: async () => Response.json({...success, results: [candidate, candidate]}),
      },
    ),
    /invalid response/u,
  );
});

test('reports malformed or oversized success bodies without reflecting their contents', async () => {
  for (const response of [
    new Response('{private-query', {status: 200}),
    new Response('x'.repeat(70_000), {status: 200}),
  ]) {
    await assert.rejects(
      geocode({query: 'Lisboa'}, {apiKey: 'team_test_key', fetch: async () => response.clone()}),
      (error) => {
        assert.ok(error instanceof GeocodingError);
        assert.equal(error.message, 'Tileflow geocoding returned an invalid response');
        assert.doesNotMatch(error.message, /private-query/u);
        return true;
      },
    );
  }
});

test('cancels declared oversized bodies and releases readers after success', async () => {
  let canceled = false;
  const oversized = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    {headers: {'Content-Length': '70000'}},
  );
  await assert.rejects(
    geocode({query: 'Lisboa'}, {apiKey: 'team_test_key', fetch: async () => oversized}),
    /invalid response/u,
  );
  assert.equal(canceled, true);

  const valid = Response.json(success);
  await geocode({query: 'Lisboa'}, {apiKey: 'team_test_key', fetch: async () => valid});
  assert.equal(valid.body?.locked, false);
});

test('preserves only bounded safe API error fields', async () => {
  await assert.rejects(
    geocode(
      {query: 'Lisboa'},
      {
        apiKey: 'team_test_key',
        fetch: async () =>
          Response.json(
            {
              code: 'GEOCODING_UPSTREAM_UNAVAILABLE',
              error: 'Geocoding provider is unavailable',
              requestId: 'req_123',
            },
            {status: 502},
          ),
      },
    ),
    (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'GEOCODING_UPSTREAM_UNAVAILABLE');
      assert.equal(error.requestId, 'req_123');
      assert.equal(error.message, 'Geocoding provider is unavailable');
      return true;
    },
  );
  assert.ok(GEOCODING_ERROR_CODES.includes('GEOCODING_USAGE_UNCONFIRMED'));
});

test('preserves the deterministic unsupported-territory error', async () => {
  await assert.rejects(
    geocode(
      {query: 'Tokyo', retention: 'persistent'},
      {
        apiKey: 'team_test_key',
        fetch: async () =>
          Response.json(
            {
              code: 'GEOCODING_TERRITORY_UNSUPPORTED',
              error: 'Persistent retention is unsupported for this territory',
              requestId: 'req_japan',
            },
            {status: 422},
          ),
      },
    ),
    (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'GEOCODING_TERRITORY_UNSUPPORTED');
      assert.equal(error.requestId, 'req_japan');
      return true;
    },
  );
});

test('rejects a geocoding error code at the wrong HTTP status', async () => {
  await assert.rejects(
    geocode(
      {query: 'Lisboa'},
      {
        apiKey: 'team_test_key',
        fetch: async () =>
          Response.json(
            {code: 'GEOCODING_QUOTA_EXCEEDED', error: 'Geocoding API usage limit reached'},
            {status: 503},
          ),
      },
    ),
    (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.code, null);
      assert.equal(error.message, 'Tileflow geocoding request failed');
      return true;
    },
  );
});

test('turns malformed, oversized and unsafe remote failures into generic errors', async () => {
  for (const response of [
    new Response('{', {status: 502, headers: {'Content-Type': 'application/json'}}),
    new Response('x'.repeat(9_000), {
      status: 502,
      headers: {'Content-Type': 'application/json'},
    }),
    Response.json(
      {code: 'GEOCODING_UPSTREAM_UNAVAILABLE', error: 'secret\u0000body'},
      {status: 502},
    ),
  ]) {
    await assert.rejects(
      geocode({query: 'Lisboa'}, {apiKey: 'team_test_key', fetch: async () => response.clone()}),
      (error) => {
        assert.ok(error instanceof GeocodingError);
        assert.equal(error.message, 'Tileflow geocoding request failed');
        assert.equal(error.code, null);
        return true;
      },
    );
  }
});

test('passes through the caller AbortSignal without starting another request', async () => {
  const controller = new AbortController();
  let observed: AbortSignal | null = null;
  controller.abort(new Error('cancelled'));

  await assert.rejects(
    geocode(
      {query: 'Lisboa'},
      {
        apiKey: 'team_test_key',
        signal: controller.signal,
        fetch: async (_input, init) => {
          observed = init?.signal as AbortSignal;
          throw controller.signal.reason;
        },
      },
    ),
    /cancelled/u,
  );
  assert.equal(observed, controller.signal);
});

test('preserves caller cancellation while reading and cancels the response body', async () => {
  const controller = new AbortController();
  const reason = new Error('caller stopped response');
  let canceled = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        closeTimer = setTimeout(() => stream.close(), 25);
      },
      cancel() {
        canceled = true;
        clearTimeout(closeTimer);
      },
    }),
  );
  const pending = geocode(
    {query: 'Lisboa'},
    {apiKey: 'team_test_key', fetch: async () => response, signal: controller.signal},
  );
  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});

test('posts one normalized reverse request with no retry', async () => {
  const requests: Request[] = [];
  const result = await geocodeReverse(
    {position: [-9.1393, 38.7223], kinds: ['address', 'place']},
    {
      apiKey: 'team_test_key',
      apiUrl: 'https://api.example.test/root/',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(success, {headers: {'Cache-Control': 'no-store'}});
      },
    },
  );

  assert.equal(result.queryId, success.queryId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geocoding/reverse');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('Authorization'), 'Bearer team_test_key');
  assert.equal(requests[0]?.redirect, 'error');
  assert.deepEqual(await requests[0]?.json(), {
    kinds: ['address', 'place'],
    limit: 1,
    position: [-9.1393, 38.7223],
    retention: 'temporary',
  });
});

test('rejects invalid reverse requests before transport', async () => {
  let calls = 0;

  await assert.rejects(
    geocodeReverse(
      {position: [181, 0]},
      {
        apiKey: 'team_test_key',
        fetch: async () => {
          calls += 1;
          return Response.json(success);
        },
      },
    ),
    /Invalid Tileflow geocoding request/u,
  );
  assert.equal(calls, 0);
});

test('preserves safe reverse API errors after one call', async () => {
  let calls = 0;

  await assert.rejects(
    geocodeReverse(
      {position: [139.6917, 35.6895], retention: 'persistent'},
      {
        apiKey: 'team_test_key',
        fetch: async () => {
          calls += 1;
          return Response.json(
            {
              code: 'GEOCODING_TERRITORY_UNSUPPORTED',
              error: 'Persistent retention is unsupported for this territory',
              requestId: 'req_japan_reverse',
            },
            {status: 422},
          );
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'GEOCODING_TERRITORY_UNSUPPORTED');
      assert.equal(error.requestId, 'req_japan_reverse');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('rejects reverse responses beyond the default limit or byte bound', async () => {
  const candidate = {
    address: {},
    kind: 'place',
    label: 'Place',
    position: [0, 0],
  };

  for (const response of [
    Response.json({...success, results: [candidate, candidate]}),
    new Response('x'.repeat(70_000), {status: 200}),
  ]) {
    await assert.rejects(
      geocodeReverse(
        {position: [0, 0]},
        {apiKey: 'team_test_key', fetch: async () => response.clone()},
      ),
      /invalid response/u,
    );
  }
});

test('posts one normalized autocomplete request and accepts an empty response', async () => {
  const requests: Request[] = [];
  const result = await autocomplete(
    {query: '  Hospital La Paz  '},
    {
      apiKey: 'team_test_key',
      apiUrl: 'https://api.example.test/root/',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({...autocompleteSuccess, suggestions: []});
      },
    },
  );

  assert.deepEqual(result.suggestions, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geocoding/autocomplete');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('Authorization'), 'Bearer team_test_key');
  assert.equal(requests[0]?.redirect, 'error');
  assert.deepEqual(await requests[0]?.json(), {limit: 5, query: 'Hospital La Paz'});
});

test('rejects autocomplete response envelopes with excess suggestions or usage', async () => {
  const suggestion = autocompleteSuccess.suggestions[0];
  for (const response of [
    {...autocompleteSuccess, suggestions: Array.from({length: 6}, () => suggestion)},
    {...autocompleteSuccess, usage: {units: 1}},
  ]) {
    await assert.rejects(
      autocomplete(
        {query: 'Hospital', limit: 5},
        {apiKey: 'team_test_key', fetch: async () => Response.json(response)},
      ),
      /invalid response/u,
    );
  }
});

test('keeps only the selected newer suggestion after an aborted earlier autocomplete', async () => {
  const first = new AbortController();
  const second = new AbortController();
  let autocompleteCalls = 0;
  let firstCanceled = false;
  let resolveCalls = 0;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = (await request.json()) as {query?: string; retention?: string; token?: string};

    if (request.url.endsWith('/autocomplete')) {
      autocompleteCalls += 1;
      if (body.query === 'A') {
        return new Response(
          new ReadableStream({
            cancel() {
              firstCanceled = true;
            },
          }),
        );
      }
      assert.deepEqual(body, {limit: 5, query: 'B'});
      return Response.json({
        ...autocompleteSuccess,
        suggestions: [{kind: 'place', label: 'B place', token: 'token-B'}],
      });
    }

    assert.equal(request.url.endsWith('/resolve-suggestion'), true);
    resolveCalls += 1;
    assert.equal(body.token, 'token-B');
    assert.equal(body.retention, resolveCalls === 1 ? 'temporary' : 'persistent');
    return Response.json(resolveSuccess);
  };

  const pendingFirst = autocomplete(
    {query: 'A'},
    {apiKey: 'team_test_key', fetch, signal: first.signal},
  );
  const latest = await autocomplete(
    {query: 'B'},
    {apiKey: 'team_test_key', fetch, signal: second.signal},
  );
  first.abort(new Error('superseded by B'));

  await assert.rejects(pendingFirst, /superseded by B/u);
  assert.equal(firstCanceled, true);
  assert.deepEqual(latest.suggestions, [{kind: 'place', label: 'B place', token: 'token-B'}]);

  await resolveSuggestion(
    {token: latest.suggestions[0]!.token},
    {apiKey: 'team_test_key', fetch, signal: second.signal},
  );
  await resolveSuggestion(
    {retention: 'persistent', token: latest.suggestions[0]!.token},
    {apiKey: 'team_test_key', fetch, signal: second.signal},
  );

  assert.equal(autocompleteCalls, 2);
  assert.equal(resolveCalls, 2);
});

test('posts one suggestion resolution with retention and returns one candidate', async () => {
  const requests: Request[] = [];
  const result = await resolveSuggestion(
    {retention: 'persistent', token: 'opaque-token_1'},
    {
      apiKey: 'team_test_key',
      apiUrl: 'https://api.example.test/root/',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(resolveSuccess);
      },
    },
  );

  assert.equal(result.result.label, 'Hospital La Paz');
  assert.equal(result.usage.units, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://api.example.test/root/v1/geocoding/resolve-suggestion');
  assert.deepEqual(await requests[0]?.json(), {
    retention: 'persistent',
    token: 'opaque-token_1',
  });
});

test('rejects invalid suggestion usage and preserves pick error semantics', async () => {
  await assert.rejects(
    resolveSuggestion(
      {token: 'opaque-token_1'},
      {
        apiKey: 'team_test_key',
        fetch: async () => Response.json({...resolveSuccess, usage: {units: 0}}),
      },
    ),
    /invalid response/u,
  );

  for (const [code, status] of [
    ['GEOCODING_INVALID_SUGGESTION', 400],
    ['GEOCODING_SUGGESTION_EXPIRED', 410],
    ['GEOCODING_UPSTREAM_THROTTLED', 429],
    ['GEOCODING_PICK_LIMIT_EXCEEDED', 429],
  ] as const) {
    await assert.rejects(
      resolveSuggestion(
        {token: 'opaque-token_1'},
        {
          apiKey: 'team_test_key',
          fetch: async () => Response.json({code, error: 'Synthetic failure'}, {status}),
        },
      ),
      (error) => {
        assert.ok(error instanceof GeocodingError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      },
    );
  }
});

test('preserves caller cancellation while reading a suggestion resolution', async () => {
  const controller = new AbortController();
  const reason = new Error('caller stopped resolution');
  let canceled = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        closeTimer = setTimeout(() => stream.close(), 25);
      },
      cancel() {
        canceled = true;
        clearTimeout(closeTimer);
      },
    }),
  );
  const pending = resolveSuggestion(
    {token: 'opaque-token_1'},
    {apiKey: 'team_test_key', fetch: async () => response, signal: controller.signal},
  );
  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});
