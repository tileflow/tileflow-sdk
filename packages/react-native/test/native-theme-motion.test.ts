import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountedMapOwner, type MountedMapPorts} from '../src/mounted-map-owner';
import type {NativeMapAdmission} from '../src/native-admission-owner';
import type {
  NativeSurface,
  NativeSurfaceEvent,
  NativeThemeValues,
} from '../src/native-surface-contract';
import {snapshotThemeBlend, snapshotThemeTransition} from '../src/theme-motion-input';
import {deferred} from './session-fixture';

const origin = 'https://maps.example.test';
const settle = async () => {
  for (let index = 0; index < 20; index++) await new Promise((resolve) => setImmediate(resolve));
};
const themeStyle = (ground: string, label: string) => ({
  version: 8,
  sources: {},
  layers: [
    {id: 'ground', type: 'background', paint: {'background-color': ground}},
    {
      id: 'names',
      type: 'background',
      paint: {'background-color': label, 'background-opacity': 0.5},
    },
  ],
});

/** A mounted owner with a scripted native surface that records cover, reveal and blend calls. */
function fixture(options: {motion?: boolean; blending?: boolean} = {}) {
  const motion = options.motion ?? true;
  const blending = options.blending ?? true;
  const calls: string[] = [];
  const reads: string[] = [];
  const events: Array<{type: string; [key: string]: unknown}> = [];
  const batches: NativeThemeValues[] = [];
  const shown: Array<Readonly<Record<string, unknown>>> = [];
  let notify: ((event: NativeSurfaceEvent) => void) | undefined;
  let token = '';
  let sequence = 0;
  let covered = true;
  let held: ReturnType<typeof deferred<void>> | undefined;
  const documents: Record<string, unknown> = {
    [`${origin}/manifest.json`]: {
      version: 1,
      maps: {
        main: {
          defaultTheme: 'night',
          themes: {
            night: {colorScheme: 'dark', styleUrl: './night.json'},
            dusk: {colorScheme: 'dark', styleUrl: './dusk.json'},
            day: {colorScheme: 'light', styleUrl: './day.json'},
          },
        },
      },
    },
    [`${origin}/night.json`]: themeStyle('#000000', '#ffffff'),
    [`${origin}/dusk.json`]: themeStyle('#402040', '#ffe0c0'),
    [`${origin}/day.json`]: themeStyle('#ffffff', '#000000'),
  };
  const surface: NativeSurface = {
    id: 'surface',
    async expectStyle(style) {
      calls.push('expect');
      token = style;
    },
    async commitLayout() {
      return 1;
    },
    async requestFrame() {},
    async applyCamera(command, view) {
      calls.push(`camera ${view.zoom}`);
      return {command, view};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async retire() {},
    ...(motion
      ? {
          async cover(duration: number) {
            calls.push(`cover ${duration}`);
            return covered;
          },
          async reveal(duration: number) {
            calls.push(`reveal ${duration}`);
            await held?.promise;
            calls.push('revealed');
          },
          async discardCover() {
            calls.push('discard');
          },
        }
      : {}),
    ...(blending
      ? {
          async applyThemeValues(style: string, values: NativeThemeValues) {
            assert.equal(style, token);
            batches.push(values);
            return (values.paint?.length ?? 0) + (values.layout?.length ?? 0);
          },
        }
      : {}),
  };
  const ports: MountedMapPorts = {
    documents: {
      acquire(url) {
        if (!url.endsWith('manifest.json')) reads.push(url.slice(origin.length));
        const bytes = new TextEncoder().encode(JSON.stringify(documents[url]));
        let read = false;
        return {
          response: Promise.resolve({
            url,
            status: 200,
            reader: {
              async read() {
                if (read) return {done: true};
                read = true;
                return {done: false, value: bytes};
              },
              cancel() {},
            },
          }),
          cancel() {},
        };
      },
    },
    createBinding: () => ({
      async replace() {
        return {kind: 'direct'};
      },
      dispose() {},
    }),
    appearance: () => () => undefined,
    installation: {
      open() {
        const map: NativeMapAdmission = {
          context: 'context',
          generation: 1,
          scope: {context: 'context', installation: 'installation'},
          state: {status: 'active', context: 'context'},
          async prepare() {
            return null;
          },
          discriminate: (url) => url,
          discriminateForTest: (url) => url,
          async extendResources() {
            return {resources: 0};
          },
          async retire() {
            return {retired: true};
          },
        };
        return {ready: Promise.resolve(map), async retire() {}};
      },
      async retryRetirements() {},
    },
    surfaces: {
      available() {},
      blending: () => blending,
      async attach(_root, listener) {
        notify = listener;
        return surface;
      },
      async retireRoot() {},
    },
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  };
  const owner = createMountedMapOwner(ports);
  const source = {map: 'main', manifestUrl: `${origin}/manifest.json`};
  let props: Record<string, unknown> = {};
  const native = (kind: NativeSurfaceEvent['kind']) =>
    notify!({
      surface: 'surface',
      style: token,
      sequence: ++sequence,
      layout: 1,
      kind,
    } as NativeSurfaceEvent);
  const f = {
    owner,
    calls,
    reads,
    events,
    batches,
    shown,
    native,
    cover(value: boolean) {
      covered = value;
    },
    /** Holds the next fades until `releaseReveal`; meanwhile `settle`, not `whenIdle`, waits. */
    holdReveal() {
      held = deferred<void>();
    },
    releaseReveal() {
      held?.resolve();
      held = undefined;
    },
    update(next: Record<string, unknown> = {}) {
      props = {...props, ...next};
      owner.update({
        source,
        onLoad: (event) => events.push(event),
        onError: (event) => events.push(event),
        onReadinessChange: (event) => events.push(event),
        onThemeChange: (event) => events.push(event),
        ...props,
      });
    },
    /** Mounts the native view, accepts the published style and draws one complete frame. */
    async draw() {
      await owner.whenIdle();
      const renderer = owner.getSnapshot().renderer!;
      owner.rootMounted(renderer.key, 1);
      owner.nativeStyleLoaded(renderer.key, 1);
      await owner.whenIdle();
      shown.push(owner.getSnapshot().renderer!.style);
      native('style');
      await owner.whenIdle();
      f.update();
      await owner.whenIdle();
      native('render');
      await owner.whenIdle();
    },
    phases: () =>
      events.filter((event) => event.type === 'theme-change').map((event) => event.phase),
    readiness: () =>
      events.filter((event) => event.type === 'readiness-change').map((event) => event.status),
    layerIds: () =>
      (owner.getSnapshot().renderer!.style.layers as {id: string}[]).map((layer) => layer.id),
  };
  return f;
}

test('theme motion inputs are validated without echoing their values', () => {
  assert.equal(snapshotThemeTransition(undefined), 0);
  assert.equal(snapshotThemeTransition({duration: 449.6}), 450);
  for (const value of [{duration: -1}, {duration: 5001}, {duration: '450'}, {speed: 1}, 450])
    assert.throws(() => snapshotThemeTransition(value), /Native style preparation failed/u);
  assert.deepEqual(snapshotThemeBlend({themes: ['night', 'day'], position: 0.5}), {
    themes: ['night', 'day'],
    position: 0.5,
  });
  for (const value of [
    {themes: ['night'], position: 0},
    {themes: ['night', 'day'], position: 1.5},
    {themes: ['night', 'system'], position: 0},
    {themes: ['night', 'day'], position: 0, extra: true},
  ])
    assert.throws(() => snapshotThemeBlend(value), /Native style preparation failed/u);
});

test('a transition covers the current frame before the style changes and is ready after the fade', async () => {
  const f = fixture();
  f.update({themeTransition: {duration: 450}});
  await f.draw();
  assert.deepEqual(
    f.calls.filter((call) => !call.startsWith('camera')),
    ['expect'],
    'the first style has nothing to cover',
  );
  assert.equal(f.readiness().at(-1), 'ready');

  f.calls.length = 0;
  f.holdReveal();
  f.update({theme: 'day'});
  await f.owner.whenIdle();
  assert.deepEqual(f.calls.slice(0, 2), ['cover 450', 'expect']);
  f.native('style');
  await settle();
  // The fade starts once the style is accepted, without waiting for camera or layout barriers.
  assert.ok(f.calls.includes('reveal 450'));
  f.update();
  await settle();
  f.native('render');
  await settle();
  assert.notEqual(f.phases().at(-1), 'ready', 'ready waits for the fade');
  assert.notEqual(f.readiness().at(-1), 'ready');
  f.releaseReveal();
  await f.owner.whenIdle();
  assert.equal(f.phases().at(-1), 'ready');
  assert.equal(f.readiness().at(-1), 'ready');
  await f.owner.dispose();
});

test('without a cover, a theme changes at once', async () => {
  for (const f of [fixture({motion: false}), fixture()]) {
    f.update({themeTransition: {duration: 450}});
    await f.draw();
    f.cover(false);
    f.calls.length = 0;
    f.update({theme: 'day'});
    await f.draw();
    assert.equal(f.calls.includes('reveal 450'), false);
    assert.equal(f.phases().at(-1), 'ready');
    await f.owner.dispose();
  }
});

test('a failed style discards the cover and restores the previous theme at once', async () => {
  const f = fixture();
  f.update({themeTransition: {duration: 450}});
  await f.draw();
  f.calls.length = 0;
  f.update({theme: 'day'});
  await f.owner.whenIdle();
  f.native('error');
  await f.owner.whenIdle();
  assert.deepEqual(
    f.calls.filter((call) => !call.startsWith('camera')),
    ['cover 450', 'expect', 'discard', 'expect'],
  );
  assert.equal(f.phases().at(-1), 'error');
  await f.owner.dispose();
});

test('selecting the shown theme again before a change finishes restores its style', async () => {
  const f = fixture();
  f.update();
  await f.draw();
  const night = f.layerIds();
  f.update({theme: 'day'});
  await f.owner.whenIdle();
  f.update({theme: 'night'});
  await f.owner.whenIdle();
  const style = f.owner.getSnapshot().renderer!.style;
  assert.equal(
    (style.layers as {paint?: Record<string, unknown>}[])[0]!.paint!['background-color'],
    '#000000',
  );
  assert.deepEqual(f.layerIds().slice(0, -1), night.slice(0, -1));
  assert.equal(
    f.reads.filter((url) => url === '/night.json').length,
    1,
    'the held style is reused',
  );
  await f.owner.dispose();
});

test('a blend prepares its themes once, then moves its position without loading', async () => {
  const f = fixture();
  f.update({themeBlend: {themes: ['night', 'dusk', 'day'], position: 0.25}});
  await f.draw();
  assert.deepEqual(f.reads.sort(), ['/day.json', '/dusk.json', '/night.json']);
  const ground = (
    f.owner.getSnapshot().renderer!.style.layers as {paint: Record<string, string>}[]
  )[0]!;
  assert.match(ground.paint['background-color']!, /^rgba\(/u);
  assert.equal(f.phases().at(-1), 'ready');
  const key = f.owner.getSnapshot().renderer!.key;

  f.update({themeBlend: {themes: ['night', 'dusk', 'day'], position: 1.75}});
  await f.owner.whenIdle();
  assert.equal(f.reads.length, 3);
  assert.equal(f.owner.getSnapshot().renderer!.key, key);
  const values = Object.fromEntries(
    f.batches
      .flatMap((batch) => batch.paint ?? [])
      .map(([layer, property, value]) => [`${layer} ${property}`, value]),
  );
  assert.match(String(values['ground background-color']), /^rgba\(/u);

  // Leaving the blend shows `theme` again from the style the blend already prepared.
  f.update({themeBlend: undefined, theme: 'day'});
  await f.draw();
  assert.equal(f.reads.length, 3);
  assert.equal(
    (f.owner.getSnapshot().renderer!.style.layers as {paint: Record<string, string>}[])[0]!.paint[
      'background-color'
    ],
    '#ffffff',
  );
  await f.owner.dispose();
});

test('without native blending, a blend shows its nearest theme and follows it', async () => {
  const f = fixture({blending: false});
  f.update({themeBlend: {themes: ['night', 'day'], position: 0.2}});
  await f.draw();
  const background = () =>
    (f.owner.getSnapshot().renderer!.style.layers as {paint: Record<string, string>}[])[0]!.paint[
      'background-color'
    ];
  assert.equal(background(), '#000000');
  f.update({themeBlend: {themes: ['night', 'day'], position: 0.4}});
  await f.owner.whenIdle();
  assert.deepEqual(f.reads, ['/night.json']);
  f.update({themeBlend: {themes: ['night', 'day'], position: 0.8}});
  await f.draw();
  assert.equal(background(), '#ffffff');
  await f.owner.dispose();
});

test('an invalid blend reports a renderer error without changing the map', async () => {
  const f = fixture();
  f.update();
  await f.draw();
  const style = f.owner.getSnapshot().renderer!.style;
  f.update({themeBlend: {themes: ['night', 'unknown-$'], position: 0}});
  await f.owner.whenIdle();
  assert.equal(f.events.at(-1)?.type, 'renderer-error');
  assert.equal(f.owner.getSnapshot().renderer!.style, style);
  await f.owner.dispose();
});

test('a controlled view that changes while a style loads is applied once the style is accepted', async () => {
  const f = fixture();
  const view = (zoom: number) => ({
    center: [-80.13, 25.78] as [number, number],
    zoom,
    bearing: 0,
    pitch: 0,
  });
  f.update({themeTransition: {duration: 450}, view: view(14), onViewChange() {}});
  await f.draw();
  f.calls.length = 0;
  f.update({theme: 'day'});
  await f.owner.whenIdle();
  // The parent moves the camera before the new style is accepted.
  f.update({view: view(15)});
  await f.owner.whenIdle();
  assert.equal(
    f.events.some((event) => event.type === 'renderer-error'),
    false,
  );
  f.native('style');
  await f.owner.whenIdle();
  assert.equal(f.calls.at(-1), 'camera 15');
  assert.equal(
    f.events.some((event) => event.type === 'renderer-error'),
    false,
  );
  await f.owner.dispose();
});
