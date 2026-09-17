import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createForegroundLocationController,
  foregroundLocationAnnotations,
  recenterForegroundLocationView,
  validateForegroundLocationFix,
  type ApplicationForegroundLocationAdapter,
  type ApplicationLocationObservation,
  type ApplicationLocationPermission,
} from '../harness/foreground-location-recipe';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, reject, resolve};
}

test('foreground location is idle until the application explicitly requests permission', async () => {
  const permission = deferred<ApplicationLocationPermission>();
  let permissionRequests = 0;
  let observations = 0;
  const adapter: ApplicationForegroundLocationAdapter = {
    requestPermission() {
      permissionRequests += 1;
      return permission.promise;
    },
    observe() {
      observations += 1;
      return () => undefined;
    },
  };
  const owner = createForegroundLocationController(adapter, true);

  assert.deepEqual(owner.getSnapshot(), {fix: null, status: 'idle'});
  assert.equal(permissionRequests, 0);
  assert.equal(observations, 0);

  const request = owner.requestPermission();
  assert.deepEqual(owner.getSnapshot(), {fix: null, status: 'requesting'});
  assert.equal(permissionRequests, 1);
  assert.equal(observations, 0);

  permission.resolve('granted-precise');
  await request;
  assert.deepEqual(owner.getSnapshot(), {fix: null, status: 'granted-precise'});
  assert.equal(observations, 1);
  owner.dispose();
});

test('only validated coordinates and accuracy become the stable accessible location annotation', async () => {
  let listener: ((update: ApplicationLocationObservation) => void) | undefined;
  const adapter: ApplicationForegroundLocationAdapter = {
    async requestPermission() {
      return 'granted-approximate';
    },
    observe(next) {
      listener = next;
      return () => undefined;
    },
  };
  const owner = createForegroundLocationController(adapter, true);
  await owner.requestPermission();
  listener?.({
    type: 'fix',
    fix: {accuracy: 125, latitude: 38.7223, longitude: -9.1393},
  });

  const snapshot = owner.getSnapshot();
  assert.equal(snapshot.status, 'granted-approximate');
  assert.deepEqual(snapshot.fix, {accuracy: 125, latitude: 38.7223, longitude: -9.1393});
  const annotations = foregroundLocationAnnotations(snapshot);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0]?.id, 'application-foreground-location');
  assert.equal(annotations[0]?.ariaLabel, 'Approximate current location');
  assert.deepEqual(annotations[0]?.coordinate, [-9.1393, 38.7223]);
  assert.deepEqual(annotations[0]?.data, {accuracyMeters: 125, precision: 'approximate'});

  for (const input of [
    {accuracy: -1, latitude: 38, longitude: -9},
    {accuracy: Number.POSITIVE_INFINITY, latitude: 38, longitude: -9},
    {accuracy: 5, latitude: 91, longitude: -9},
    {accuracy: 5, latitude: 38, longitude: 181},
    {accuracy: 5, latitude: 38, longitude: -9, rawProviderValue: 'forbidden'},
    Object.defineProperty({accuracy: 5, latitude: 38}, 'longitude', {get: () => -9}),
  ])
    assert.equal(validateForegroundLocationFix(input), undefined);

  listener?.({type: 'fix', fix: {accuracy: -1, latitude: 38, longitude: -9}});
  assert.deepEqual(owner.getSnapshot(), {fix: null, status: 'unavailable'});
  assert.deepEqual(foregroundLocationAnnotations(owner.getSnapshot()), []);
  owner.dispose();
});

test('background teardown, foreground restart and revocation ignore retired provider callbacks', async () => {
  const listeners: Array<(update: ApplicationLocationObservation) => void> = [];
  let releases = 0;
  const adapter: ApplicationForegroundLocationAdapter = {
    async requestPermission() {
      return 'granted-precise';
    },
    observe(listener) {
      listeners.push(listener);
      return () => {
        releases += 1;
      };
    },
  };
  const owner = createForegroundLocationController(adapter, true);
  await owner.requestPermission();
  assert.equal(listeners.length, 1);
  listeners[0]?.({type: 'fix', fix: {accuracy: 4, latitude: 38.72, longitude: -9.14}});
  assert.equal(owner.getSnapshot().status, 'granted-precise');

  owner.setForeground(false);
  assert.equal(releases, 1);
  listeners[0]?.({type: 'revoked'});
  assert.equal(owner.getSnapshot().status, 'granted-precise');
  assert.equal(foregroundLocationAnnotations(owner.getSnapshot()).length, 1);

  owner.setForeground(true);
  assert.equal(listeners.length, 2);
  listeners[1]?.({type: 'revoked'});
  assert.deepEqual(owner.getSnapshot(), {fix: null, status: 'revoked'});
  assert.deepEqual(foregroundLocationAnnotations(owner.getSnapshot()), []);
  assert.equal(releases, 2);
  owner.dispose();
});

test('provider failure is application state and late permission results cannot survive disposal', async () => {
  const unavailable = createForegroundLocationController(
    {
      async requestPermission() {
        throw new Error('provider detail must stay inside the application recipe');
      },
      observe() {
        assert.fail('unavailable permission must not start observation');
      },
    },
    true,
  );
  await unavailable.requestPermission();
  assert.deepEqual(unavailable.getSnapshot(), {fix: null, status: 'unavailable'});

  const permission = deferred<ApplicationLocationPermission>();
  let observations = 0;
  const retired = createForegroundLocationController(
    {
      requestPermission: () => permission.promise,
      observe() {
        observations += 1;
        return () => undefined;
      },
    },
    true,
  );
  const pending = retired.requestPermission();
  retired.dispose();
  permission.resolve('granted-precise');
  await pending;
  assert.equal(observations, 0);
});

test('recenter is an explicit immediate controlled-view transformation, never a fix side effect', () => {
  const current = Object.freeze({
    bearing: 12,
    center: Object.freeze([-9.2, 38.7] as const),
    pitch: 18,
    zoom: 13,
  });
  const state = Object.freeze({
    fix: Object.freeze({accuracy: 6, latitude: 38.7223, longitude: -9.1393}),
    status: 'granted-precise' as const,
  });

  assert.deepEqual(current.center, [-9.2, 38.7]);
  const next = recenterForegroundLocationView(current, state);
  assert.deepEqual(next, {
    bearing: 12,
    center: [-9.1393, 38.7223],
    pitch: 18,
    zoom: 13,
  });
  assert.deepEqual(current.center, [-9.2, 38.7]);
  assert.equal(recenterForegroundLocationView(current, {fix: null, status: 'denied'}), current);
});
