import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowLineProgressGradient} from '../src/line-progress';
import {createTileflowLineProgress} from '../src/line-progress-browser';

const transparent = 'rgba(0, 0, 0, 0)';

/** The [position, colour] stops of a gradient, after checking its shape. */
function stops(gradient: unknown[]): [number, string][] {
  assert.deepEqual(gradient.slice(0, 3), ['interpolate', ['linear'], ['line-progress']]);
  const pairs: [number, string][] = [];
  for (let index = 3; index < gradient.length; index += 2)
    pairs.push([gradient[index] as number, gradient[index + 1] as string]);
  for (const [index, [at]] of pairs.entries()) {
    assert.ok(at >= 0 && at <= 1, `stop ${at} is within the line`);
    if (index > 0) assert.ok(at > pairs[index - 1]![0], `stops rise strictly at ${at}`);
  }
  assert.ok(pairs.length >= 2);
  return pairs;
}

test('a line drawn halfway is inked to its head, white-hot there and clear past it', () => {
  const pairs = stops(
    tileflowLineProgressGradient(
      {end: 0.5},
      {color: '#ff4fae', highlight: '#ffffff', headLength: 0.1},
    ),
  );
  assert.deepEqual(pairs, [
    [0, '#ff4fae'],
    [0.4, '#ff4fae'],
    [0.5, '#ffffff'],
    [0.5005, transparent],
  ]);
});

test('the head starts at the line start while it is shorter than the head', () => {
  const pairs = stops(
    tileflowLineProgressGradient({end: 0.02}, {color: '#f00', highlight: '#fff', headLength: 0.1}),
  );
  assert.deepEqual(pairs, [
    [0, '#f00'],
    [0.02, '#fff'],
    [0.0205, transparent],
  ]);
});

test('a drawn line carries a light that rises behind it and falls off in front', () => {
  const pairs = stops(
    tileflowLineProgressGradient(
      {light: 0.5},
      {color: '#f00', highlight: '#fff', headLength: 0.04, lightLength: 0.1},
    ),
  );
  assert.deepEqual(pairs, [
    [0, '#f00'],
    [0.4, '#f00'],
    [0.5, '#fff'],
    [0.535, '#f00'],
    [1, '#f00'],
  ]);
  // A light at the very end keeps the highlight at the end.
  assert.deepEqual(
    stops(tileflowLineProgressGradient({light: 1}, {color: '#f00', highlight: '#fff'})).at(-1),
    [1, '#fff'],
  );
});

test('the drawn stretch can start past the line start, and an empty stretch shows nothing', () => {
  const pairs = stops(tileflowLineProgressGradient({start: 0.25}, {color: '#00f'}));
  assert.deepEqual(pairs, [
    [0.2495, transparent],
    [0.25, '#00f'],
    [1, '#00f'],
  ]);
  assert.deepEqual(stops(tileflowLineProgressGradient({start: 0.6, end: 0.6}, {color: '#00f'})), [
    [0, transparent],
    [1, transparent],
  ]);
  // A light outside the drawn stretch does not show.
  assert.deepEqual(
    stops(tileflowLineProgressGradient({end: 0.3, light: 0.8}, {color: '#00f', headLength: 0})),
    [
      [0, '#00f'],
      [0.3, '#00f'],
      [0.3005, transparent],
    ],
  );
});

test('random states always give strictly rising stops within the line', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1.4 - 0.2;
  for (let index = 0; index < 2000; index += 1) {
    stops(
      tileflowLineProgressGradient(
        {start: random(), end: random(), light: index % 3 ? random() : undefined},
        {color: '#123', highlight: '#fff', headLength: random(), lightLength: random()},
      ),
    );
  }
});

type Listener = () => void;

class LineMap {
  readonly writes: [string, string, unknown][] = [];
  readonly layers = new Map<string, object>();
  private readonly listeners = new Set<Listener>();
  constructor(private readonly canvas?: unknown) {}
  getCanvas() {
    return this.canvas;
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  setPaintProperty(layer: string, name: string, value: unknown) {
    this.writes.push([layer, name, value]);
  }
  on(_event: 'styledata', listener: Listener) {
    this.listeners.add(listener);
  }
  off(_event: 'styledata', listener: Listener) {
    this.listeners.delete(listener);
  }
  restyle() {
    for (const listener of [...this.listeners]) listener();
  }
  get listening() {
    return this.listeners.size;
  }
}

function clock(reducedMotion = false) {
  let now = 0;
  let frames: (() => void)[] = [];
  const view = {
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => {};
    },
    matchMedia: () => ({matches: reducedMotion}),
    performance: {now: () => now},
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  };
  return {
    canvas: {ownerDocument: {defaultView: view}},
    advance(ms: number) {
      now += ms;
      const due = frames;
      frames = [];
      for (const frame of due) frame();
    },
  };
}

const route = [
  {id: 'route-casing', color: '#0b0f12', opacity: 0.8},
  {id: 'route-line', color: '#ff4fae', highlight: '#ffffff'},
];

test('the controller paints the layers on the map and skips those that are not', () => {
  const map = new LineMap();
  map.layers.set('route-line', {});
  const progress = createTileflowLineProgress(map, {layers: route, initial: {end: 0}});
  assert.deepEqual(
    map.writes.map(([layer, name]) => `${layer}:${name}`),
    ['route-line:line-gradient', 'route-line:line-opacity'],
  );
  assert.deepEqual(progress.get(), {start: 0, end: 0, opacity: 1});

  // A layer added later is painted on the next style change; unchanged layers are not written.
  map.writes.length = 0;
  map.layers.set('route-casing', {});
  map.restyle();
  assert.deepEqual(
    map.writes.map(
      ([layer, name, value]) => `${layer}:${name}:${name === 'line-opacity' ? value : ''}`,
    ),
    ['route-casing:line-gradient:', 'route-casing:line-opacity:0.8'],
  );

  // A layer the style re-created is painted again in full.
  map.writes.length = 0;
  map.layers.set('route-line', {});
  map.restyle();
  assert.deepEqual(
    map.writes.map(([layer, name]) => `${layer}:${name}`),
    ['route-line:line-gradient', 'route-line:line-opacity'],
  );

  progress.set({opacity: 0.5});
  assert.equal(map.writes.at(-1)?.[2], 0.5);
  progress.dispose();
  assert.equal(map.listening, 0);
});

test('an animation draws the line on over its duration and resolves when it gets there', async () => {
  const time = clock();
  const map = new LineMap(time.canvas);
  map.layers.set('route-line', {});
  const progress = createTileflowLineProgress(map, {layers: route, initial: {end: 0}});
  const drawn = progress.animate({to: {end: 1}, duration: 1000, easing: (t) => t});
  time.advance(250);
  assert.equal(progress.get().end, 0.25);
  time.advance(250);
  assert.equal(progress.get().end, 0.5);
  time.advance(600);
  assert.equal(await drawn, true);
  assert.deepEqual(progress.get(), {start: 0, end: 1, opacity: 1});

  // A light that is not showing sets off from the start of the drawn stretch.
  const lap = progress.animate({to: {light: 1}, duration: 100, easing: (t) => t});
  time.advance(50);
  assert.equal(progress.get().light, 0.5);
  time.advance(60);
  assert.equal(await lap, true);
  progress.set({light: undefined});
  assert.equal(progress.get().light, undefined);
});

test('a newer request or disposal supersedes a running animation', async () => {
  const time = clock();
  const map = new LineMap(time.canvas);
  map.layers.set('route-line', {});
  const progress = createTileflowLineProgress(map, {layers: route, initial: {end: 0}});
  const first = progress.animate({to: {end: 1}, duration: 1000});
  time.advance(100);
  const second = progress.animate({to: {opacity: 0}, duration: 1000});
  assert.equal(await first, false);
  time.advance(100);
  const end = progress.get().end;
  progress.dispose();
  assert.equal(await second, false);
  // The superseded animation leaves the line where it was.
  assert.ok(end > 0 && end < 1);
  const writes = map.writes.length;
  time.advance(1000);
  assert.equal(map.writes.length, writes);
  assert.equal(await progress.animate({to: {end: 1}, duration: 10}), false);
});

test('reduced motion, a zero duration or no browser window show the target at once', async () => {
  for (const [canvas, duration] of [
    [clock(true).canvas, 500],
    [clock().canvas, 0],
    [undefined, 500],
  ] as const) {
    const map = new LineMap(canvas);
    map.layers.set('route-line', {});
    const progress = createTileflowLineProgress(map, {layers: route, initial: {end: 0}});
    assert.equal(await progress.animate({to: {end: 1}, duration}), true);
    assert.equal(progress.get().end, 1);
  }
});

test('invalid options and durations are refused', () => {
  const map = new LineMap();
  assert.throws(() => createTileflowLineProgress(map, {layers: []}), /at least one layer/u);
  assert.throws(
    () => createTileflowLineProgress(map, {layers: [route[1]!, route[1]!]}),
    /listed twice/u,
  );
  assert.throws(
    () => createTileflowLineProgress(map, {layers: [{id: 'a', color: ''}]}),
    /needs a colour/u,
  );
  assert.throws(
    () => createTileflowLineProgress(map, {layers: route, headLength: 2}),
    /share of the line/u,
  );
  const progress = createTileflowLineProgress(map, {layers: route});
  assert.throws(() => progress.animate({to: {end: 0}, duration: -1}), RangeError);
  assert.throws(() => progress.animate({to: {end: 0}, duration: 120_000}), RangeError);
  progress.configure({layers: [{id: 'route-line', color: '#000'}]});
  assert.throws(() => progress.configure({layers: []}), /at least one layer/u);
});
