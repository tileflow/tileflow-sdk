import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AppearancePort,
  type AppearanceState,
  createAppearanceObserver,
} from '../src/appearance';

const system = {sourceKind: 'tileflow', theme: 'system'} as const;

function port(initial: unknown = 'light') {
  let value = initial;
  let reads = 0;
  let subscriptions = 0;
  let removals = 0;
  const listeners: Array<(event: unknown) => void> = [];
  const api: AppearancePort = {
    getColorScheme() {
      reads++;
      return value;
    },
    addChangeListener(listener) {
      subscriptions++;
      listeners.push(listener);
      return {
        remove() {
          removals++;
        },
      };
    },
  };
  return {
    api,
    listeners,
    emit(next: unknown, index = listeners.length - 1) {
      value = next;
      listeners[index]?.({colorScheme: next});
    },
    set(next: unknown) {
      value = next;
    },
    get reads() {
      return reads;
    },
    get subscriptions() {
      return subscriptions;
    },
    get removals() {
      return removals;
    },
  };
}

test('reads only on activation, shares one subscription, and releases the last observer once', () => {
  const p = port();
  const observer = createAppearanceObserver(p.api);
  const first: AppearanceState[] = [];
  const second: AppearanceState[] = [];
  assert.equal(p.reads, 0);
  const releaseFirst = observer.subscribe(system, (state) => first.push(state));
  const releaseSecond = observer.subscribe(system, (state) => second.push(state));
  assert.equal(p.reads, 1);
  assert.equal(p.subscriptions, 1);
  assert.deepEqual(first, [{status: 'available', colorScheme: 'light'}]);
  assert.deepEqual(second, first);
  p.emit('dark');
  p.emit('dark');
  assert.equal(first.length, 2);
  assert.deepEqual(second, first);
  assert.ok(first.every(Object.isFrozen));
  releaseFirst();
  releaseFirst();
  assert.equal(p.removals, 0);
  releaseSecond();
  releaseSecond();
  assert.equal(p.removals, 1);
});

test('null, unspecified and unexpected values are unavailable, never an implicit theme', () => {
  for (const initial of [null, undefined, 'unspecified', 'unexpected', 1, {}]) {
    const p = port();
    p.set(initial);
    const states: AppearanceState[] = [];
    const release = createAppearanceObserver(p.api).subscribe(system, (state) =>
      states.push(state),
    );
    assert.deepEqual(states, [{status: 'unavailable'}]);
    p.emit('dark');
    p.emit(null);
    assert.deepEqual(states, [
      {status: 'unavailable'},
      {status: 'available', colorScheme: 'dark'},
      {status: 'unavailable'},
    ]);
    release();
  }
});

test('default, concrete and direct sources neither read nor subscribe nor publish', () => {
  const p = port('dark');
  const observer = createAppearanceObserver(p.api);
  for (const selection of [
    {sourceKind: 'tileflow'},
    {sourceKind: 'tileflow', theme: 'light'},
    {sourceKind: 'tileflow', theme: 'dark'},
    {sourceKind: 'maplibre'},
    {sourceKind: 'maplibre', theme: 'system'},
  ] as const) {
    const release = observer.subscribe(selection, () =>
      assert.fail('Unexpected appearance update.'),
    );
    release();
    release();
  }
  assert.equal(p.reads, 0);
  assert.equal(p.subscriptions, 0);
  assert.equal(p.removals, 0);
});

test('reactivation rereads current appearance and retired callbacks cannot affect it', () => {
  const p = port('light');
  const observer = createAppearanceObserver(p.api);
  const first: AppearanceState[] = [];
  const stop = observer.subscribe(system, (state) => first.push(state));
  const stale = p.listeners[0]!;
  stop();
  p.set('dark');
  const second: AppearanceState[] = [];
  const stopAgain = observer.subscribe(system, (state) => second.push(state));
  stale({colorScheme: 'light'});
  assert.deepEqual(first, [{status: 'available', colorScheme: 'light'}]);
  assert.deepEqual(second, [{status: 'available', colorScheme: 'dark'}]);
  assert.equal(p.reads, 2);
  assert.equal(p.subscriptions, 2);
  stopAgain();
  p.emit('light');
  assert.equal(second.length, 1);
  assert.equal(p.removals, 2);
});

test('events during activation win over a stale initial read', () => {
  let change: (event: unknown) => void = () => undefined;
  const api: AppearancePort = {
    addChangeListener(listener) {
      change = listener;
      return {remove() {}};
    },
    getColorScheme() {
      change({colorScheme: 'dark'});
      return 'light';
    },
  };
  const states: AppearanceState[] = [];
  const stop = createAppearanceObserver(api).subscribe(system, (state) => states.push(state));
  assert.deepEqual(states, [{status: 'available', colorScheme: 'dark'}]);
  stop();
});

test('synchronous subscribe events are not overwritten or delivered twice', () => {
  const states: AppearanceState[] = [];
  const stop = createAppearanceObserver({
    getColorScheme: () => 'light',
    addChangeListener(listener) {
      listener({colorScheme: 'dark'});
      return {remove() {}};
    },
  }).subscribe(system, (state) => states.push(state));
  assert.deepEqual(states, [{status: 'available', colorScheme: 'dark'}]);
  stop();
});

test('reentrant changes suppress obsolete observer delivery', () => {
  const p = port();
  const observer = createAppearanceObserver(p.api);
  const second: AppearanceState[] = [];
  const releaseFirst = observer.subscribe(system, (state) => {
    if (state.status === 'available' && state.colorScheme === 'dark') p.emit(null);
  });
  const releaseSecond = observer.subscribe(system, (state) => second.push(state));
  p.emit('dark');
  assert.deepEqual(second, [{status: 'available', colorScheme: 'light'}, {status: 'unavailable'}]);
  releaseFirst();
  releaseSecond();
});

test('observer exceptions do not prevent cleanup or other observers', () => {
  const p = port();
  const observer = createAppearanceObserver(p.api);
  const stopBad = observer.subscribe(system, () => {
    throw new Error('Observer-only secret.');
  });
  const states: AppearanceState[] = [];
  const stopGood = observer.subscribe(system, (state) => states.push(state));
  p.emit('dark');
  assert.equal(states.length, 2);
  stopBad();
  stopGood();
  assert.equal(p.removals, 1);
});

test('native read failures and malformed event objects reveal no remote details', () => {
  const p = port();
  p.api.getColorScheme = () => {
    throw new Error('Native secret.');
  };
  const states: AppearanceState[] = [];
  const stop = createAppearanceObserver(p.api).subscribe(system, (state) => states.push(state));
  let getterReads = 0;
  p.listeners[0]!({
    get colorScheme() {
      getterReads++;
      throw new Error('Secret.');
    },
  });
  p.listeners[0]!(null);
  assert.equal(getterReads, 0);
  assert.deepEqual(states, [{status: 'unavailable'}]);
  stop();
});

test('a failed subscription cannot report a known scheme or retain callbacks after release', () => {
  let callback: (event: unknown) => void = () => undefined;
  const states: AppearanceState[] = [];
  const observer = createAppearanceObserver({
    getColorScheme: () => 'dark',
    addChangeListener(listener) {
      callback = listener;
      throw new Error('Native details.');
    },
  });
  const stop = observer.subscribe(system, (state) => states.push(state));
  assert.deepEqual(states, [{status: 'unavailable'}]);
  callback({colorScheme: 'light'});
  assert.deepEqual(states, [{status: 'unavailable'}]);
  stop();
  stop();
});
