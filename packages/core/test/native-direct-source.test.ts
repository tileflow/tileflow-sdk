import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeSourceController,
  type TileflowNativeManifestAcquire,
  type TileflowNativeManifestResponse,
  type TileflowNativeSource,
  type TileflowNativeSourceState,
} from '../src/native';
import type {MapLibreStyle} from '../src/types';
import {deferred, source, transport} from './native-manifest-fixture';

const direct = {kind: 'maplibre' as const, style: 'https://maps.example.test/direct.json'};
function style(): MapLibreStyle {
  return {
    version: 8,
    name: 'Unmanaged',
    sources: {roads: {type: 'vector', url: './tiles.json'}},
    layers: [{id: 'roads', type: 'line', source: 'roads', paint: {'line-width': ['get', 'width']}}],
    metadata: {values: [null, true, '😀', -0, 1.25]},
  };
}

function controlled() {
  const requests: Array<{
    response: ReturnType<typeof deferred<TileflowNativeManifestResponse>>;
    cancels: number;
  }> = [];
  const acquire: TileflowNativeManifestAcquire = () => {
    const request = {response: deferred<TileflowNativeManifestResponse>(), cancels: 0};
    requests.push(request);
    return {
      response: request.response.promise,
      cancel() {
        request.cancels++;
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

test('direct HTTPS styles are canonical, unmanaged, and do not acquire a manifest', async () => {
  const {controller, requests, states} = controlled();
  await controller.replace({
    kind: 'maplibre',
    style: 'https://ＭＡＰＳ.example.test:443/a/../style.json',
  });
  const ready = controller.state;
  assert.ok(ready?.status === 'ready' && ready.kind === 'maplibre');
  assert.deepEqual(ready.source, {kind: 'maplibre', style: 'https://maps.example.test/style.json'});
  assert.deepEqual(Object.keys(ready).sort(), ['generation', 'kind', 'source', 'status']);
  assert.deepEqual(
    states.map(({status}) => status),
    ['loading', 'ready'],
  );
  assert.equal(requests.length, 0);
  for (const key of ['manifest', 'manifestUrl', 'map', 'theme', 'analytics', 'grant'])
    assert.equal(Object.hasOwn(ready, key), false);
  await controller.replace({
    kind: 'maplibre',
    style: 'https://api.tileflow.dev/maps/map-fixture/style.json',
  });
  assert.equal(requests.length, 0);
  assert.equal(Object.hasOwn(controller.state!, 'map'), false);
});

test('direct objects retain style data without transformation, inference or mutation', async () => {
  const {controller, requests} = controlled();
  const input = style();
  const before = structuredClone(input);
  const sourceInput = {kind: 'maplibre' as const, style: input};
  await controller.replace(sourceInput, {colorScheme: 'dark'});
  const ready = controller.state;
  assert.ok(ready?.status === 'ready' && ready.kind === 'maplibre');
  assert.deepEqual(ready.source.style, before);
  assert.notEqual(ready.source.style, input);
  assert.equal(typeof ready.source.style, 'object');
  assert.ok(Object.isFrozen(ready.source));
  assert.ok(Object.isFrozen(ready.source.style));
  assert.ok(Object.isFrozen((ready.source.style as MapLibreStyle).layers[0]!.paint));
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.layers), false);
  input.name = 'Changed';
  input.layers[0]!.id = 'changed';
  input.metadata!.values = [];
  assert.deepEqual(ready.source.style, before);
  assert.equal(requests.length, 0);
});

test('direct themes are rejected while an injected color scheme alone is neutral', async () => {
  const {controller, requests} = controlled();
  for (const theme of ['light', 'system', '', 'secret?token=private']) {
    await controller.replace(direct, {theme, colorScheme: 'dark'});
    const state = controller.state;
    assert.ok(state?.status === 'error');
    assert.equal(state.error.code, 'NATIVE_THEME_INVALID');
    assert.equal(state.error.field, 'theme');
    assert.equal(state.error.message.includes('private'), false);
  }
  for (const colorScheme of ['light', 'dark'] as const) {
    await controller.replace(direct, {colorScheme});
    assert.ok(controller.state?.status === 'ready' && controller.state.kind === 'maplibre');
    assert.deepEqual(controller.state.source, direct);
    assert.equal(Object.hasOwn(controller.state, 'theme'), false);
  }
  assert.equal(requests.length, 0);
});

test('direct URLs retain explicit network policy and sanitize failures', async () => {
  const {controller, requests} = controlled();
  for (const value of [
    '',
    '/relative.json',
    'file:///private.json',
    'mapbox://styles/private',
    'https://user:private@host.test/a',
    'https://host.test/a#private',
    'http://host.test/a',
  ]) {
    await controller.replace({kind: 'maplibre', style: value});
    const state = controller.state;
    assert.ok(state?.status === 'error');
    assert.equal(state.error.code, 'NATIVE_SOURCE_INVALID');
    assert.equal(state.error.field, 'source');
    assert.equal(state.error.cause, undefined);
    assert.equal(state.error.message.includes('private'), false);
  }
  await controller.replace(
    {kind: 'maplibre', style: 'http://10.0.2.2:8765/a.json'},
    {
      developmentOrigin: 'http://10.0.2.2:8765',
    },
  );
  assert.ok(controller.state?.status === 'ready' && controller.state.kind === 'maplibre');
  assert.equal(requests.length, 0);
});

for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  for (const staleRejects of [false, true]) {
    test(`mixed sources remain latest-wins: ${order}; stale rejects=${staleRejects}`, async () => {
      const {controller, states, requests} = controlled();
      const first = controller.replace(source);
      await controller.replace(direct);
      const second = controller.replace(source, {theme: 'dark'});
      await controller.replace({kind: 'maplibre', style: style()});
      const third = controller.replace(source);
      assert.equal(requests.length, 3);
      assert.deepEqual(
        requests.map(({cancels}) => cancels),
        [1, 1, 0],
      );
      for (const index of order) {
        if (index < 2 && staleRejects)
          requests[index]!.response.reject(new Error('remote private'));
        else requests[index]!.response.resolve(transport().response);
      }
      await Promise.all([first, second, third]);
      const ready = states.filter((state) => state.status === 'ready');
      assert.deepEqual(
        ready.map((state) => [state.generation, state.kind]),
        [
          [2, 'maplibre'],
          [4, 'maplibre'],
          [5, 'tileflow'],
        ],
      );
      const last = controller.state;
      assert.ok(last?.status === 'ready' && last.kind === 'tileflow');
      assert.equal(last.source.kind, 'tileflow');
      assert.equal(last.map.name, 'streets');
      assert.equal(last.theme.name, 'light');
      assert.equal(last.manifestUrl, 'https://maps.example.test/native/manifest.json');
    });
  }
}

test('invalid direct replacement retires a Tileflow operation and never republishes old data', async () => {
  const {controller, requests, states} = controlled();
  const pending = controller.replace(source);
  await controller.replace({kind: 'maplibre', style: null} as unknown as TileflowNativeSource);
  requests[0]!.response.resolve(transport().response);
  await pending;
  assert.equal(requests[0]!.cancels, 1);
  assert.deepEqual(
    states.map(({status, generation}) => [status, generation]),
    [
      ['loading', 1],
      ['loading', 2],
      ['error', 2],
    ],
  );
  await controller.replace(direct);
  await controller.replace({...source, manifestUrl: ''});
  assert.equal(controller.state?.status, 'error');
  assert.equal(controller.state?.generation, 4);
});

test('a direct snapshot precedes cleanup and loading observers that mutate caller data', async () => {
  const input = style();
  const before = structuredClone(input);
  const response = deferred<TileflowNativeManifestResponse>();
  const controller = createTileflowNativeSourceController({
    acquire: () => ({
      response: response.promise,
      cancel() {
        input.name = 'cleanup';
        input.layers.length = 0;
      },
    }),
  });
  const pending = controller.replace(source);
  controller.subscribe((state) => {
    if (state.status === 'loading' && state.generation === 2) input.sources = {};
  });
  await controller.replace({kind: 'maplibre', style: input});
  response.resolve(transport().response);
  await pending;
  const ready = controller.state;
  assert.ok(ready?.status === 'ready' && ready.kind === 'maplibre');
  assert.deepEqual(ready.source.style, before);
});

test('direct reentrancy suppresses stale notifications and dispose remains idempotent', async () => {
  const {controller, requests} = controlled();
  const observed: Array<[string, number]> = [];
  let replacement: Promise<void> | undefined;
  controller.subscribe((state) => {
    if (state.status === 'loading' && state.generation === 1)
      replacement = controller.replace(direct);
  });
  controller.subscribe((state) => {
    observed.push([state.status, state.generation]);
  });
  await controller.replace({kind: 'maplibre', style: style()});
  await replacement;
  assert.deepEqual(observed, [
    ['loading', 2],
    ['ready', 2],
  ]);
  assert.equal(requests.length, 0);
  controller.dispose();
  controller.dispose();
  await assert.rejects(controller.replace(direct), {code: 'NATIVE_SOURCE_DISPOSED'});
  const last = controller.state;
  controller.subscribe(() => {
    throw new Error('Must not notify after disposal.');
  });
  assert.equal(controller.state, last);
});

test('direct pre-abort and reentrant disposal cannot manufacture readiness', async () => {
  const {controller, states, requests} = controlled();
  const abort = new AbortController();
  abort.abort('private reason');
  await controller.replace(direct, {signal: abort.signal});
  assert.equal(controller.state?.status, 'error');
  if (controller.state?.status === 'error') {
    assert.equal(controller.state.error.code, 'NATIVE_SOURCE_ABORTED');
    assert.equal(controller.state.error.kind, 'cancelled');
    assert.equal(controller.state.error.message.includes('private'), false);
  }
  const next = controlled();
  let late = 0;
  next.controller.subscribe(() => next.controller.dispose());
  next.controller.subscribe(() => {
    late++;
  });
  await next.controller.replace(direct);
  assert.equal(late, 0);
  assert.equal(next.controller.state?.status, 'loading');
  assert.equal(
    states.some(({status}) => status === 'ready'),
    false,
  );
  assert.equal(requests.length, 0);
});
