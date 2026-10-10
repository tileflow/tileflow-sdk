import assert from 'node:assert/strict';
import test from 'node:test';
import type {NativeSurfaceModule} from '../src/native-surface-contract';
import {createNativeSurfaceTransport} from '../src/native-surface-wire';
import {deferred} from './session-fixture';

function fixture() {
  let sequence = 0;
  const listeners = new Set<(value: unknown) => void>();
  const acknowledgements: Array<[string, number]> = [];
  const retired: string[] = [];
  const module: NativeSurfaceModule = {
    async attachSurface() {
      return {surface: `surface_${++sequence}`};
    },
    async expectStyle() {
      return {accepted: true};
    },
    async commitLayout() {
      return {layout: 1};
    },
    async requestFrame() {
      return {requested: true};
    },
    async applyCamera(_surface, command, view) {
      return {command, invalidation: 1, view};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async acknowledgeSurface(surface, value) {
      acknowledgements.push([surface, value]);
      return {acknowledged: true};
    },
    async retireSurface(surface) {
      retired.push(surface);
      return {detached: true};
    },
    async retireRoot() {
      return {detached: true};
    },
  };
  const transport = createNativeSurfaceTransport(
    () => module,
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  );
  return {
    module,
    transport,
    retired,
    acknowledgements,
    emit(value: unknown) {
      for (const callback of listeners) callback(value);
    },
  };
}

test('surfaces acknowledge only their own immutable ordered native evidence', async () => {
  const f = fixture();
  const first: unknown[] = [];
  const second: unknown[] = [];
  const one = await f.transport.attach(
    1,
    (event) => first.push(event),
    () => assert.fail(),
  );
  const two = await f.transport.attach(
    2,
    (event) => second.push(event),
    () => assert.fail(),
  );
  await one.expectStyle('one');
  await two.expectStyle('two');
  const event = {surface: one.id, style: 'one', sequence: 1, layout: 1, kind: 'style'};
  f.emit(event);
  f.emit(event);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.ok(Object.isFrozen(first[0]));
  await one.retire();
  f.emit({...event, sequence: 2});
  assert.equal(first.length, 1);
  assert.deepEqual(f.retired, [one.id]);
  await two.retire();
});

test('bad native receipts and malformed owned events fail with no native payload exposure', async () => {
  const f = fixture();
  let failures = 0;
  const surface = await f.transport.attach(
    1,
    () => assert.fail(),
    () => {
      failures++;
    },
  );
  await surface.expectStyle('one');
  f.emit({
    surface: surface.id,
    style: 'one',
    sequence: 1,
    layout: 1,
    kind: 'gesture-end',
    view: 'private',
  });
  assert.equal(failures, 1);
  f.module.commitLayout = async () => ({layout: NaN});
  await assert.rejects(surface.commitLayout('one'), {message: 'Native surface operation failed.'});
  await surface.retire();
});

test('retirement waits for real native detachment and a failed acknowledgement stays retryable', async () => {
  const f = fixture();
  const surface = await f.transport.attach(
    1,
    () => undefined,
    () => undefined,
  );
  const barrier = deferred<{detached: true}>();
  let calls = 0;
  f.module.retireSurface = async () => {
    calls++;
    return barrier.promise;
  };
  let finished = false;
  const first = surface.retire();
  assert.equal(surface.retire(), first);
  void first.then(
    () => {
      finished = true;
    },
    () => undefined,
  );
  assert.equal(finished, false);
  barrier.reject(new Error('Private native detail.'));
  await assert.rejects(first, {message: 'Native surface operation failed.'});
  f.module.retireSurface = async () => {
    calls++;
    return {detached: true};
  };
  await surface.retire();
  assert.equal(calls, 2);
});

test('theme motion methods are optional and their payloads are bounded', async () => {
  const older = fixture();
  const plain = await older.transport.attach(
    1,
    () => undefined,
    () => assert.fail(),
  );
  assert.equal(plain.cover, undefined);
  assert.equal(plain.applyThemeValues, undefined);
  assert.equal(older.transport.blending(), false);

  const f = fixture();
  const received: unknown[] = [];
  Object.assign(f.module, {
    async coverSurface(_surface: string, duration: number) {
      received.push(['cover', duration]);
      return {covered: duration > 0};
    },
    async revealSurface(_surface: string, duration: number) {
      received.push(['reveal', duration]);
      return {revealed: true};
    },
    async discardSurfaceCover() {
      received.push(['discard']);
      return {discarded: true};
    },
    async applyThemeValues(_surface: string, style: string, values: {paint?: unknown[]}) {
      received.push(['apply', style, values]);
      return {applied: values.paint?.length ?? 0};
    },
  });
  assert.equal(f.transport.blending(), true);
  const surface = await f.transport.attach(
    1,
    () => undefined,
    () => assert.fail(),
  );
  assert.equal(await surface.cover!(450), true);
  await surface.reveal!(450);
  await surface.discardCover!();
  const values = {
    paint: [['ground', 'background-color', 'rgba(1, 2, 3, 1)']] as const,
    layout: [['roads::theme-1', 'visibility', 'none']] as const,
    images: [['grass', 'grass', 'grass-day', 0.5]] as const,
    light: {color: '#ffffff', intensity: 0.2},
  };
  assert.equal(await surface.applyThemeValues!('style_1', values), 1);
  assert.deepEqual(received, [
    ['cover', 450],
    ['reveal', 450],
    ['discard'],
    ['apply', 'style_1', values],
  ]);

  for (const invalid of [
    {paint: [['ground', 'Background Color', 1]]},
    {paint: [['ground', 'background-color', Number.NaN]]},
    {paint: [['ground', 'background-color', {toJSON: () => 1}]]},
    {images: [['grass', 'grass', 'grass-day', 2]]},
    {light: ['#ffffff']},
    {other: []},
  ])
    await assert.rejects(surface.applyThemeValues!('style_1', invalid as never), {
      code: 'NATIVE_SURFACE_UNAVAILABLE',
    });
  await assert.rejects(surface.cover!(5001), {code: 'NATIVE_SURFACE_UNAVAILABLE'});
  assert.equal(received.length, 4, 'invalid requests never reach native code');
});
