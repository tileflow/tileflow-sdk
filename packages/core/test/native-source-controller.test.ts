import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeSourceController,
  type TileflowNativeManifestAcquire,
  type TileflowNativeManifestResponse,
  type TileflowNativeSourceState,
} from '../src/native';
import {bytes, deferred, manifest, manifestUrl, source, transport} from './native-manifest-fixture';

function controlled() {
  const requests: Array<{
    response: ReturnType<typeof deferred<TileflowNativeManifestResponse>>;
    cancelled: number;
  }> = [];
  const acquire: TileflowNativeManifestAcquire = () => {
    const request = {response: deferred<TileflowNativeManifestResponse>(), cancelled: 0};
    requests.push(request);
    return {
      response: request.response.promise,
      cancel() {
        request.cancelled++;
      },
    };
  };
  const controller = createTileflowNativeSourceController({acquire});
  const states: TileflowNativeSourceState[] = [];
  controller.subscribe((state) => {
    states.push(state);
  });
  return {controller, states, requests};
}

test('publishes immutable loading/ready snapshots and canonical manifest-driven selection', async () => {
  const t = transport();
  const c = createTileflowNativeSourceController({acquire: t.acquire});
  const initial = c.state;
  assert.equal(initial, undefined);
  const states: TileflowNativeSourceState[] = [];
  c.subscribe((state) => {
    states.push(state);
  });
  const original = structuredClone(source);
  await c.replace(source);
  assert.deepEqual(
    states.map(({status, generation}) => [status, generation]),
    [
      ['loading', 1],
      ['ready', 1],
    ],
  );
  assert.equal(c.state?.status, 'ready');
  if (c.state?.status !== 'ready' || c.state.kind !== 'tileflow')
    throw new Error('Expected Tileflow ready.');
  assert.equal(c.state.theme.name, 'light');
  assert.equal(c.state.map.name, 'streets');
  assert.deepEqual(c.state.map.view, manifest().maps.streets.view);
  assert.equal(c.state.theme.revision, 'light-v1');
  assert.equal(
    c.state.theme.styleUrl,
    'https://maps.example.test/native/styles/streets/light.json',
  );
  assert.ok(Object.isFrozen(c.state));
  assert.ok(Object.isFrozen(c.state.manifest.maps.streets?.themes));
  assert.deepEqual(source, original);
});

test('default, concrete and injected system selection share the runtime precedence', async () => {
  for (const [options, theme] of [
    [{}, 'light'],
    [{colorScheme: 'dark'}, 'light'],
    [{theme: 'dark'}, 'dark'],
    [{theme: 'light', colorScheme: 'dark'}, 'light'],
    [{theme: 'system', colorScheme: 'dark'}, 'dark'],
  ] as const) {
    const t = transport();
    const c = createTileflowNativeSourceController({acquire: t.acquire});
    await c.replace(source, options);
    assert.ok(c.state?.status === 'ready' && c.state.kind === 'tileflow');
    assert.equal(c.state.theme.name, theme);
  }
});

test('selection errors are terminal, safe, and never infer a missing map', async () => {
  for (const [input, options, code] of [
    [{...source, map: 'absent'}, {}, 'NATIVE_MAP_NOT_FOUND'],
    [source, {theme: 'absent'}, 'NATIVE_THEME_INVALID'],
    [source, {theme: 'system'}, 'NATIVE_THEME_INVALID'],
    [source, {theme: 'private?token=secret'}, 'NATIVE_THEME_INVALID'],
  ] as const) {
    const t = transport();
    const c = createTileflowNativeSourceController({acquire: t.acquire});
    await c.replace(input, options);
    assert.equal(c.state?.status, 'error');
    if (c.state?.status === 'error') {
      assert.equal(c.state.error.code, code);
      assert.equal(c.state.error.kind, 'terminal');
      assert.equal(String(c.state.error).includes('secret'), false);
    }
  }
});

for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  test(`only the latest generation commits in response order ${order}`, async () => {
    const {controller, states, requests} = controlled();
    const completions = [
      controller.replace(source),
      controller.replace(source, {theme: 'dark'}),
      controller.replace(source),
    ];
    assert.equal(requests.length, 3);
    assert.deepEqual(
      requests.map(({cancelled}) => cancelled),
      [1, 1, 0],
    );
    const responses = [transport(), transport(), transport()];
    for (const index of order) requests[index]!.response.resolve(responses[index]!.response);
    await Promise.all(completions);
    assert.deepEqual(
      states.map(({status, generation}) => [status, generation]),
      [
        ['loading', 1],
        ['loading', 2],
        ['loading', 3],
        ['ready', 3],
      ],
    );
    assert.equal(responses[0]!.readerCancels, 1);
    assert.equal(responses[1]!.readerCancels, 1);
  });
}

test('a retired rejection and abort cannot overwrite a newer ready state', async () => {
  const {controller, states, requests} = controlled();
  const signal = new AbortController();
  const old = controller.replace(source, {signal: signal.signal});
  const latest = controller.replace(source);
  requests[1]!.response.resolve(transport().response);
  await latest;
  requests[0]!.response.reject(new Error('remote secret'));
  signal.abort('private reason');
  await old;
  assert.deepEqual(
    states.map(({status, generation}) => [status, generation]),
    [
      ['loading', 1],
      ['loading', 2],
      ['ready', 2],
    ],
  );
});

test('invalid replacement retires pending work and cannot re-publish previous data', async () => {
  const {controller, states, requests} = controlled();
  const pending = controller.replace(source);
  await controller.replace({...source, manifestUrl: ''});
  requests[0]!.response.resolve(transport().response);
  await pending;
  assert.equal(requests[0]!.cancelled, 1);
  assert.deepEqual(
    states.map(({status, generation}) => [status, generation]),
    [
      ['loading', 1],
      ['loading', 2],
      ['error', 2],
    ],
  );
  const t = transport();
  const c = createTileflowNativeSourceController({acquire: t.acquire});
  await c.replace(source);
  await c.replace({kind: 'maplibre', style: '/style.json'});
  assert.equal(c.state?.status, 'error');
  assert.equal(c.state?.generation, 2);
  assert.equal(t.calls, 1);
});

test('initial failure and active abort publish distinct terminal/cancelled errors', async () => {
  const {controller, requests} = controlled();
  const first = controller.replace(source);
  requests[0]!.response.reject(new Error('private body'));
  await first;
  assert.equal(controller.state?.status, 'error');
  if (controller.state?.status === 'error') assert.equal(controller.state.error.kind, 'terminal');
  const signal = new AbortController();
  const second = controller.replace(source, {signal: signal.signal});
  signal.abort('private cancellation');
  await second;
  assert.equal(controller.state?.generation, 2);
  if (controller.state?.status === 'error') {
    assert.equal(controller.state.error.code, 'NATIVE_SOURCE_ABORTED');
    assert.equal(controller.state.error.kind, 'cancelled');
  }
  requests[1]!.response.reject(new Error('late private body'));
});

test('dispose is idempotent and suppresses late callbacks and replacements', async () => {
  const {controller, states, requests} = controlled();
  const pending = controller.replace(source);
  controller.dispose();
  controller.dispose();
  await pending;
  assert.equal(requests[0]!.cancelled, 1);
  const t = transport();
  requests[0]!.response.resolve(t.response);
  await requests[0]!.response.promise;
  assert.equal(t.readerCancels, 1);
  assert.deepEqual(
    states.map(({status}) => status),
    ['loading'],
  );
  await assert.rejects(controller.replace(source), {code: 'NATIVE_SOURCE_DISPOSED'});
  assert.equal(requests.length, 1);
});

test('snapshots inputs before async work and ignores observer failures/reentrant stale notifications', async () => {
  const {controller, requests} = controlled();
  const input = {...source};
  const options = {theme: 'dark'};
  controller.subscribe(() => {
    throw new Error('observer-only');
  });
  const pending = controller.replace(input, options);
  input.map = 'changed';
  options.theme = 'changed';
  requests[0]!.response.resolve(transport().response);
  await pending;
  if (controller.state?.status !== 'ready' || controller.state.kind !== 'tileflow')
    throw new Error('Expected Tileflow ready.');
  assert.equal(controller.state.map.name, 'streets');
  assert.equal(controller.state.theme.name, 'dark');
  const calls: number[] = [];
  const next = controlled();
  next.controller.subscribe((state) => {
    if (state.status === 'loading' && state.generation === 1) void next.controller.replace(source);
  });
  next.controller.subscribe((state) => {
    calls.push(state.generation);
  });
  const old = next.controller.replace(source);
  assert.equal(next.requests.length, 1);
  next.requests[0]!.response.resolve(transport().response);
  await old;
  await next.requests[0]!.response.promise;
  assert.ok(calls.every((generation) => generation === 2));
  next.controller.dispose();
});

test('unsubscription and reentrant disposal cannot deliver a queued snapshot', async () => {
  const {controller, states} = controlled();
  let late = 0;
  controller.subscribe(() => controller.dispose());
  controller.subscribe(() => {
    late++;
  });
  await controller.replace(source);
  assert.equal(late, 0);
  assert.equal(states.length, 1);
});
