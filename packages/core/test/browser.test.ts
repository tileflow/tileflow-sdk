import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachTileflowMapLifecycle,
  createTileflowMarkerController,
  createTileflowSessionStarter,
  createTileflowTransformRequest,
  type TileflowMapLifecycleEvent,
} from '../src/browser';

test('map readiness waits two frames and invalidating events cancel stale idle work', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler();
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  assert.deepEqual(states, ['loading']);
  map.emit('idle');
  assert.equal(scheduler.pendingCount, 1);

  scheduler.flushNext();
  assert.deepEqual(states, ['loading']);
  assert.equal(scheduler.pendingCount, 1);

  map.emit('dataloading');
  assert.deepEqual(states, ['loading', 'loading']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  scheduler.flushNext();
  map.emit('styledataloading');
  assert.deepEqual(states, ['loading', 'loading', 'loading']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  map.emit('error');
  assert.deepEqual(states, ['loading', 'loading', 'loading', 'error']);
  assert.equal(scheduler.pendingCount, 0);

  map.emit('idle');
  scheduler.flushNext();
  scheduler.flushNext();
  assert.deepEqual(states, ['loading', 'loading', 'loading', 'error', 'idle']);

  lifecycle.dispose();
});

test('detach and dispose unsubscribe every event and invalidate pending frames', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler();
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  map.emit('idle');
  scheduler.flushNext();
  assert.equal(scheduler.pendingCount, 1);

  lifecycle.invalidate();
  assert.equal(scheduler.pendingCount, 0);
  lifecycle.dispose();
  lifecycle.dispose();

  assert.equal(map.unsubscribeCount, 5);
  assert.equal(map.listenerCount, 0);
  for (const event of lifecycleEvents) map.emit(event);
  scheduler.flushAll();
  assert.deepEqual(states, ['loading']);
});

test('dispose guards stale frame callbacks even when scheduler cancellation is best effort', () => {
  const map = new FakeMap();
  const scheduler = new FakeFrameScheduler(false);
  const states: string[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler,
    setState: (state) => states.push(state),
    subscribe: subscribeFakeMap,
  });

  map.emit('idle');
  scheduler.flushNext();
  assert.equal(scheduler.pendingCount, 1);
  lifecycle.dispose();
  scheduler.flushAll();

  assert.deepEqual(states, ['loading']);
  assert.equal(map.listenerCount, 0);
});

test('partial subscription failure rolls back and dispose attempts every unsubscriber', () => {
  const map = new FakeMap();
  const rolledBack: TileflowMapLifecycleEvent[] = [];

  assert.throws(
    () =>
      attachTileflowMapLifecycle({
        map,
        scheduler: new FakeFrameScheduler(),
        setState: () => {},
        subscribe: (_map, event) => {
          if (event === 'styledataloading') throw new Error('subscribe failed');
          return () => rolledBack.push(event);
        },
      }),
    /subscribe failed/,
  );
  assert.deepEqual(rolledBack, ['dataloading', 'load']);

  const unsubscribed: TileflowMapLifecycleEvent[] = [];
  const lifecycle = attachTileflowMapLifecycle({
    map,
    scheduler: new FakeFrameScheduler(),
    setState: () => {},
    subscribe: (_map, event) => () => {
      unsubscribed.push(event);
      if (event === 'styledataloading') throw new Error('first unsubscribe failure');
      if (event === 'load') throw new Error('later unsubscribe failure');
    },
  });

  assert.throws(() => lifecycle.dispose(), /first unsubscribe failure/);
  assert.deepEqual(unsubscribed, ['error', 'idle', 'styledataloading', 'dataloading', 'load']);
  lifecycle.dispose();
});

test('load resolves the latest handler and starts each session key and style once', () => {
  const calls: string[] = [];
  const sends: Array<{mapId?: string; source: string; styleId?: string}> = [];
  const starter = createTileflowSessionStarter({
    sessionId: 'ses_test',
    source: 'react',
    startSession: (_analytics, input) => {
      calls.push(`session:${input.styleId}`);
      sends.push(input);
    },
  });
  let handler = () => calls.push('load:first');
  let analytics = {apiUrl: 'https://api.example.com', mapId: 'map_1'};
  let styleId = 'style-a';
  const firstMap = new FakeMap();
  const firstLifecycle = attachTileflowMapLifecycle({
    getSession: () => ({analytics, styleId}),
    map: firstMap,
    onLoad: () => handler(),
    scheduler: new FakeFrameScheduler(),
    sessionStarter: starter,
    setState: () => {},
    subscribe: subscribeFakeMap,
  });

  firstMap.emit('load');
  handler = () => calls.push('load:latest');
  firstMap.emit('load');
  styleId = 'style-b';
  firstMap.emit('load');
  firstLifecycle.dispose();

  const secondMap = new FakeMap();
  const secondLifecycle = attachTileflowMapLifecycle({
    getSession: () => ({analytics, styleId}),
    map: secondMap,
    onLoad: () => handler(),
    scheduler: new FakeFrameScheduler(),
    sessionStarter: starter,
    setState: () => {},
    subscribe: subscribeFakeMap,
  });
  secondMap.emit('load');

  analytics = {...analytics, enabled: false};
  styleId = 'style-disabled';
  secondMap.emit('load');
  secondMap.emit('load');
  secondLifecycle.dispose();

  assert.deepEqual(calls, [
    'load:first',
    'session:style-a',
    'load:latest',
    'load:latest',
    'session:style-b',
    'load:latest',
    'load:latest',
    'session:style-disabled',
    'load:latest',
  ]);
  assert.deepEqual(
    sends.map(({mapId, source, styleId: sentStyleId}) => ({mapId, source, styleId: sentStyleId})),
    [
      {mapId: 'map_1', source: 'react', styleId: 'style-a'},
      {mapId: 'map_1', source: 'react', styleId: 'style-b'},
      {mapId: 'map_1', source: 'react', styleId: 'style-disabled'},
    ],
  );
});

test('transform request preserves sync user fields and applies analytics to the user URL', () => {
  let resourceType: string | undefined;
  const transform = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => ({apiUrl: 'https://api.example.com', mapId: 'map_1', styleId: 'style_1'}),
    sessionId: 'ses_test',
    transformRequest: (_url: string, nextResourceType?: string) => {
      resourceType = nextResourceType;
      return {
        headers: {'x-test': 'yes'},
        url: 'https://api.example.com/v1/tiles/world/1/2/3.pbf?token=safe',
      };
    },
  });

  const request = transform('https://ignored.example.com/tile.pbf', 'Tile');
  assert.equal(resourceType, 'Tile');
  assert.ok(request && !(request instanceof Promise));
  assert.deepEqual(request.headers, {'x-test': 'yes'});
  const requestUrl = new URL(request.url!);
  assert.equal(requestUrl.searchParams.get('token'), 'safe');
  assert.equal(requestUrl.searchParams.get('session'), 'ses_test');
  assert.equal(requestUrl.searchParams.get('map'), 'map_1');
  assert.equal(requestUrl.searchParams.get('styleId'), 'style_1');
});

test('transform request preserves request-time and resolution-time async analytics policies', async () => {
  let analytics = {apiUrl: 'https://api.example.com', mapId: 'map_before'};
  const requestDeferred = deferred<{url: string}>();
  const resolutionDeferred = deferred<{url: string}>();
  const requestTransform = createTileflowTransformRequest({
    always: true,
    asyncAnalyticsTiming: 'request',
    getAnalytics: () => analytics,
    sessionId: 'ses_test',
    transformRequest: () => requestDeferred.promise,
  });
  const resolutionTransform = createTileflowTransformRequest({
    always: true,
    asyncAnalyticsTiming: 'resolution',
    getAnalytics: () => analytics,
    sessionId: 'ses_test',
    transformRequest: () => resolutionDeferred.promise,
  });

  const requestResult = requestTransform('https://api.example.com/tiles/a/0/0/0.pbf');
  const resolutionResult = resolutionTransform('https://api.example.com/tiles/b/0/0/0.pbf');
  analytics = {...analytics, mapId: 'map_after'};
  requestDeferred.resolve({url: 'https://api.example.com/tiles/a/0/0/0.pbf'});
  resolutionDeferred.resolve({url: 'https://api.example.com/tiles/b/0/0/0.pbf'});

  assert.equal(new URL((await requestResult)!.url!).searchParams.get('map'), 'map_before');
  assert.equal(new URL((await resolutionResult)!.url!).searchParams.get('map'), 'map_after');
});

test('transform request can be omitted, remains a no-op when forced, and propagates rejection', async () => {
  assert.equal(
    createTileflowTransformRequest({
      getAnalytics: () => undefined,
      sessionId: 'ses_test',
    }),
    undefined,
  );
  assert.equal(
    createTileflowTransformRequest({
      getAnalytics: () => ({enabled: false, mapId: 'map_1'}),
      sessionId: 'ses_test',
    }),
    undefined,
  );

  const forced = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => undefined,
    sessionId: 'ses_test',
  });
  assert.equal(forced('https://example.com/tile.pbf'), undefined);

  const original = {headers: {'x-test': 'yes'}, url: 'https://example.com/tile.pbf'};
  const disabled = createTileflowTransformRequest({
    getAnalytics: () => ({enabled: false, mapId: 'map_1'}),
    sessionId: 'ses_test',
    transformRequest: () => original,
  });
  assert.equal(disabled?.('https://example.com/original.pbf'), original);

  const expected = new Error('transform failed');
  const rejecting = createTileflowTransformRequest({
    always: true,
    getAnalytics: () => undefined,
    sessionId: 'ses_test',
    transformRequest: () => Promise.reject(expected),
  });
  await assert.rejects(rejecting('https://example.com/tile.pbf') as Promise<unknown>, expected);
});

test('marker replacement cleans previous and partially attached batches and remains reusable', () => {
  type MarkerDefinition = {id: string};
  type Marker = {id: string; removed: number};
  const created: Marker[] = [];
  const attached: string[] = [];
  const controller = createTileflowMarkerController<object, MarkerDefinition, Marker>({
    attach: (marker) => {
      attached.push(marker.id);
      if (marker.id === 'broken') throw new Error('attach failed');
    },
    create: ({id}) => {
      const marker = {id, removed: 0};
      created.push(marker);
      return marker;
    },
    remove: (marker) => {
      marker.removed += 1;
      if (marker.id === 'partial') throw new Error('remove failed');
    },
  });
  const map = {};

  controller.replace(map, [{id: 'old'}]);
  assert.throws(() => controller.replace(map, [{id: 'partial'}, {id: 'broken'}]), /attach failed/);
  assert.deepEqual(
    created.map(({id, removed}) => ({id, removed})),
    [
      {id: 'old', removed: 1},
      {id: 'partial', removed: 1},
      {id: 'broken', removed: 1},
    ],
  );

  controller.clear();
  controller.replace(map, [{id: 'recovered'}]);
  controller.dispose();
  controller.dispose();
  assert.equal(created.at(-1)?.removed, 1);
  assert.deepEqual(attached, ['old', 'partial', 'broken', 'recovered']);
});

const lifecycleEvents: TileflowMapLifecycleEvent[] = [
  'load',
  'dataloading',
  'styledataloading',
  'idle',
  'error',
];

class FakeMap {
  readonly listeners = new Map<TileflowMapLifecycleEvent, Set<() => void>>();
  unsubscribeCount = 0;

  get listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }

  emit(event: TileflowMapLifecycleEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
}

function subscribeFakeMap(
  map: FakeMap,
  event: TileflowMapLifecycleEvent,
  listener: () => void,
): () => void {
  const listeners = map.listeners.get(event) ?? new Set();
  listeners.add(listener);
  map.listeners.set(event, listeners);
  let subscribed = true;

  return () => {
    if (!subscribed) return;
    subscribed = false;
    map.unsubscribeCount += 1;
    listeners.delete(listener);
  };
}

class FakeFrameScheduler {
  #callbacks = new Map<number, () => void>();
  #cancellationWorks: boolean;
  #nextFrame = 1;

  constructor(cancellationWorks = true) {
    this.#cancellationWorks = cancellationWorks;
  }

  get pendingCount(): number {
    return this.#callbacks.size;
  }

  cancelFrame = (frame: number): void => {
    if (this.#cancellationWorks) this.#callbacks.delete(frame);
  };

  requestFrame = (callback: () => void): number => {
    const frame = this.#nextFrame++;
    this.#callbacks.set(frame, callback);
    return frame;
  };

  flushAll(): void {
    while (this.#callbacks.size > 0) this.flushNext();
  }

  flushNext(): void {
    const entry = this.#callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return;
    const [frame, callback] = entry;
    this.#callbacks.delete(frame);
    callback();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {promise, resolve};
}
