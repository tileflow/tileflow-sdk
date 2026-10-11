import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import type {TileflowRuntimeStyle} from '../src/runtime';
import type {MapLibreStyle} from '../src/types';

type Listener = (event?: unknown) => void;

/** A MapLibre-shaped map with global state that records every state write. */
class StateMap {
  readonly writes: [string, unknown][] = [];
  readonly state: Record<string, unknown> = {};
  loading = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  constructor(private readonly canvas?: unknown) {}

  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  setStyle() {
    // A new style starts without the states an application set.
    for (const key of Object.keys(this.state)) delete this.state[key];
    queueMicrotask(() => {
      for (const listener of [...(this.listeners.get('style.load') ?? [])]) listener();
    });
  }
  setGlobalStateProperty(name: string, value: unknown) {
    if (this.loading) throw new Error('Style is not done loading.');
    this.writes.push([name, value]);
    this.state[name] = value;
  }
  getCanvas() {
    return this.canvas;
  }
}

function motionCanvas(reducedMotion = false) {
  let clock = 0;
  const frames: (() => void)[] = [];
  const view = {
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => {};
    },
    matchMedia: () => ({matches: reducedMotion}),
    performance: {now: () => clock},
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  };
  return {
    canvas: {ownerDocument: {defaultView: view}},
    /** Moves the clock and runs the frames requested so far. */
    advance(ms: number) {
      clock += ms;
      for (const frame of frames.splice(0)) frame();
    },
  };
}

const style: MapLibreStyle = {layers: [], name: 'state fixture', sources: {}, version: 8};
const night: TileflowRuntimeStyle = {fontFaces: [], style, theme: 'night'};
const day: TileflowRuntimeStyle = {fontFaces: [], style: {...style}, theme: 'day'};

function controllerFor(map: StateMap) {
  return createTileflowThemeController({initial: night, loadFonts: () => Promise.resolve(), map});
}

test('a state is written at once without a transition, and read back', async () => {
  const map = new StateMap();
  const controller = controllerFor(map);

  assert.equal(controller.getState('selection'), undefined);
  assert.deepEqual(await controller.setState('selection', true), {
    status: 'applied',
    theme: 'night',
  });
  assert.equal(controller.getState(' selection '), true);
  assert.deepEqual(map.writes, [['selection', true]]);
});

test('a number eases from the value it shows to the new one over the transition', async () => {
  const motion = motionCanvas();
  const map = new StateMap(motion.canvas);
  const controller = controllerFor(map);
  await controller.setState('selection', 0);

  const done = controller.setState('selection', 1, {transition: {duration: 300}});
  for (let elapsed = 0; elapsed < 300; elapsed += 30) motion.advance(30);
  assert.deepEqual(await done, {status: 'applied', theme: 'night'});

  const values = map.writes.slice(1).map(([, value]) => value as number);
  assert.ok(values.length > 3, 'several frames are written');
  assert.deepEqual(
    values,
    [...values].sort((a, b) => a - b),
  );
  assert.equal(values.at(-1), 1);
  assert.equal(controller.getState('selection'), 1);
});

test('a newer value supersedes an easing in progress and starts from where it stands', async () => {
  const motion = motionCanvas();
  const map = new StateMap(motion.canvas);
  const controller = controllerFor(map);
  await controller.setState('selection', 0);

  const first = controller.setState('selection', 1, {transition: {duration: 300}});
  motion.advance(150);
  const halfway = map.state.selection as number;
  const second = controller.setState('selection', 0, {transition: {duration: 300}});
  assert.deepEqual(await first, {status: 'superseded', theme: 'night'});
  motion.advance(30);
  assert.ok((map.state.selection as number) <= halfway, 'it turns back from where it stood');
  for (let elapsed = 30; elapsed < 300; elapsed += 30) motion.advance(30);
  assert.deepEqual(await second, {status: 'applied', theme: 'night'});
  assert.equal(map.state.selection, 0);
});

test('booleans, strings, and a first number change at once even with a transition', async () => {
  const motion = motionCanvas();
  const map = new StateMap(motion.canvas);
  const controller = controllerFor(map);

  await controller.setState('mode', 'walk', {transition: {duration: 300}});
  await controller.setState('selection', 1, {transition: {duration: 300}});
  assert.deepEqual(map.writes, [
    ['mode', 'walk'],
    ['selection', 1],
  ]);
});

test('reduced motion sets a number at once', async () => {
  const motion = motionCanvas(true);
  const map = new StateMap(motion.canvas);
  const controller = controllerFor(map);
  await controller.setState('selection', 0);

  await controller.setState('selection', 1, {transition: {duration: 300}});
  assert.deepEqual(map.writes, [
    ['selection', 0],
    ['selection', 1],
  ]);
});

test('states stay through theme changes', async () => {
  const map = new StateMap();
  const controller = controllerFor(map);
  await controller.setState('selection', true);

  assert.equal((await controller.setTheme(day)).status, 'applied');
  assert.equal(map.state.selection, true);
});

test('a state set while the style loads is written once it is applied', async () => {
  const map = new StateMap();
  const controller = controllerFor(map);
  map.loading = true;
  await controller.setState('selection', true);
  assert.equal(map.state.selection, undefined);

  map.loading = false;
  await controller.setTheme(day);
  assert.equal(map.state.selection, true);
});

test('rejects malformed states and maps without global state', async () => {
  const controller = controllerFor(new StateMap());
  for (const [name, value] of [
    ['', true],
    ['selection', Number.NaN],
    ['selection', {}],
  ] as const) {
    const result = await controller.setState(name, value as never);
    assert.equal(result.status, 'failed');
    assert.ok(result.error instanceof TypeError);
  }

  // A MapLibre older than 5.6 has no global state.
  const older = {off() {}, on() {}, setStyle() {}};
  const result = await createTileflowThemeController({
    initial: night,
    loadFonts: () => Promise.resolve(),
    map: older,
  }).setState('selection', true);
  assert.equal(result.status, 'failed');
  assert.match(result.error?.message ?? '', /global state/u);
});
