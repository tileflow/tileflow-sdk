import assert from 'node:assert/strict';
import test from 'node:test';
import {TileflowOfflineError} from '../src/offline/error';
import {createOfflineStore} from '../src/offline/store';
import type {OfflineRegionEvent} from '../src/offline/types';
import type {Spec} from '../src/specs/NativeTileflowOffline';

function fakeModule(overrides: Partial<Record<keyof Spec, unknown>> = {}) {
  const log: string[] = [];
  let emit: ((event: unknown) => void) | undefined;
  const module = {
    estimateRegion: async () => ({packCount: 1}),
    loadRegion: async (id: string) => ({id, state: 'downloading'}),
    updateRegionMetadata: async () => undefined,
    allRegions: async () => [],
    region: async () => ({}),
    pauseRegion: async () => undefined,
    resumeRegion: async () => undefined,
    cancelRegion: async () => undefined,
    removeRegion: async () => undefined,
    automaticUpdatesEnabled: async () => false,
    setAutomaticUpdates: async () => undefined,
    isNetworkEnabled: () => true,
    setNetworkEnabled: (enabled: boolean) => log.push(`network ${enabled}`),
    startObserving: () => log.push('start'),
    stopObserving: () => log.push('stop'),
    onRegionEvent: (listener: (event: unknown) => void) => {
      emit = listener;
      return {remove: () => log.push('removed')};
    },
    ...overrides,
  } as unknown as Spec;
  return {module, log, emit: (event: unknown) => emit?.(event)};
}

test('one native subscription serves every listener and stops with the last', () => {
  const {module, log, emit} = fakeModule();
  const {TileflowOfflineStore} = createOfflineStore(
    () => module,
    () => undefined,
  );
  const seen: string[] = [];
  const first = TileflowOfflineStore.subscribe((event: OfflineRegionEvent) =>
    seen.push(`a ${event.type}`),
  );
  const second = TileflowOfflineStore.subscribe((event: OfflineRegionEvent) =>
    seen.push(`b ${event.type}`),
  );
  emit({type: 'removed', id: 'madrid'});
  first.remove();
  first.remove();
  emit({type: 'removed', id: 'lisbon'});
  second.remove();
  assert.deepEqual(seen, ['a removed', 'b removed', 'b removed']);
  assert.deepEqual(log, ['start', 'removed', 'stop']);
});

test('a listener that throws does not stop the others', () => {
  const {module, emit} = fakeModule();
  const reported: unknown[] = [];
  const {TileflowOfflineStore} = createOfflineStore(
    () => module,
    (error) => reported.push(error),
  );
  const seen: string[] = [];
  TileflowOfflineStore.subscribe(() => {
    throw new Error('listener');
  });
  TileflowOfflineStore.subscribe((event) => seen.push(event.type));
  emit({type: 'removed', id: 'madrid'});
  assert.deepEqual(seen, ['removed']);
  assert.equal(reported.length, 1);
});

test('a background transfer warning reaches listeners with its code and message', () => {
  const {module, emit} = fakeModule();
  const {TileflowOfflineStore} = createOfflineStore(
    () => module,
    () => undefined,
  );
  const warnings: string[] = [];
  TileflowOfflineStore.subscribe((event: OfflineRegionEvent) => {
    if (event.type === 'warning') warnings.push(`${event.code}: ${event.message}`);
  });
  emit({type: 'warning', code: 'backgroundTransferUnavailable', message: 'Foreground downloads.'});
  assert.deepEqual(warnings, ['backgroundTransferUnavailable: Foreground downloads.']);
});

test('region resolves null for an unknown ID', async () => {
  const {module} = fakeModule({region: async () => ({})});
  const {TileflowOfflineStore} = createOfflineStore(
    () => module,
    () => undefined,
  );
  assert.equal(await TileflowOfflineStore.region('missing'), null);
});

test('native offline errors become TileflowOfflineError with their fields', async () => {
  const {module} = fakeModule({
    loadRegion: async () => {
      throw Object.assign(new Error('TileflowOfflineError.deviceLimitExceeded'), {
        code: 'deviceLimitExceeded',
        userInfo: {code: 'deviceLimitExceeded', recoverable: false, limit: 3, status: 409},
      });
    },
  });
  const {TileflowOfflineStore} = createOfflineStore(
    () => module,
    () => undefined,
  );
  const error = await TileflowOfflineStore.loadRegion('madrid', {
    geometry: {type: 'Point', coordinates: [0, 0]},
    content: {type: 'hosted', mapId: 'map_0123456789abcdef', themes: ['day']},
  }).catch((e) => e);
  assert.ok(error instanceof TileflowOfflineError);
  assert.equal(error.code, 'deviceLimitExceeded');
  assert.equal(error.recoverable, false);
  assert.equal(error.limit, 3);
  assert.equal(error.status, 409);
});

test('the switch reaches the native network setting', () => {
  const {module, log} = fakeModule();
  const {TileflowOfflineSwitch} = createOfflineStore(
    () => module,
    () => undefined,
  );
  TileflowOfflineSwitch.setNetworkEnabled(false);
  assert.equal(TileflowOfflineSwitch.isNetworkEnabled(), true);
  assert.deepEqual(log, ['network false']);
});
