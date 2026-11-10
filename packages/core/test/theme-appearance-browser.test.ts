import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowAppearanceBinding} from '../src/browser';

type Result = {status: 'applied'; theme: string} | {error: Error; status: 'failed'; theme: string};

function setup(options: {loaded?: boolean; results?: Result[]} = {}) {
  const calls: {args: unknown[]; method: string}[] = [];
  const listeners = new Set<() => void>();
  let loaded = options.loaded ?? true;
  const results = [...(options.results ?? [])];
  const next = (): Promise<Result> =>
    Promise.resolve(results.shift() ?? {status: 'applied', theme: 'light'});
  const controller = {
    setColors: (...args: unknown[]) => {
      calls.push({args, method: 'setColors'});
      return next();
    },
    setEmphasis: (...args: unknown[]) => {
      calls.push({args, method: 'setEmphasis'});
      return next();
    },
  };
  const map = {
    isStyleLoaded: () => loaded,
    off: (_event: string, listener: () => void) => listeners.delete(listener),
    on: (_event: string, listener: () => void) => listeners.add(listener),
  };
  const errors: [string, string][] = [];
  const binding = createTileflowAppearanceBinding({
    controller: controller as never,
    map,
    onError: (error, part) => errors.push([part, error.message]),
  });
  return {
    binding,
    calls,
    errors,
    finishLoading() {
      loaded = true;
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
}

const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test('applies colours and emphasis once for equal content, whatever the key order', async () => {
  const {binding, calls} = setup();
  binding.update({colors: {a: '#111111', b: '#222222'}, emphasis: {labels: 0.5}});
  binding.update({colors: {b: '#222222', a: '#111111'}, emphasis: {labels: 0.5}});
  assert.deepEqual(
    calls.map((call) => call.method),
    ['setColors', 'setEmphasis'],
  );
  binding.update({colors: {a: '#333333', b: '#222222'}, emphasis: {labels: 0.5}});
  assert.deepEqual(
    calls.map((call) => call.method),
    ['setColors', 'setEmphasis', 'setColors'],
  );
});

test('does not touch the controller when nothing was ever declared', () => {
  const {binding, calls} = setup();
  binding.update({});
  binding.update({colors: {}, emphasis: undefined});
  assert.equal(calls.length, 0);
});

test('restores the design when a declared part is removed, and passes the transition', () => {
  const {binding, calls} = setup();
  binding.update({colors: {a: '#111111'}, emphasis: {labels: 0.2}}, {transition: {duration: 0}});
  binding.update({});
  assert.deepEqual(
    calls.map((call) => [call.method, call.args[0]]),
    [
      ['setColors', {a: '#111111'}],
      ['setEmphasis', {labels: 0.2}],
      ['setColors', {}],
      ['setEmphasis', undefined],
    ],
  );
  assert.deepEqual(calls[0]!.args[1], {transition: {duration: 0}});
});

test('waits for the style to load before writing colours or emphasis', () => {
  const {binding, calls, finishLoading, listeners} = setup({loaded: false});
  binding.update({colors: {a: '#111111'}, emphasis: {labels: 0.2}});
  assert.equal(calls.length, 0);
  assert.equal(listeners.size, 1);
  finishLoading();
  assert.deepEqual(
    calls.map((call) => call.method),
    ['setColors', 'setEmphasis'],
  );
  assert.equal(listeners.size, 0);
});

test('a newer emphasis replaces one that is still waiting', () => {
  const {binding, calls, finishLoading} = setup({loaded: false});
  binding.update({emphasis: {labels: 0.2}});
  binding.update({emphasis: {labels: 0.4}});
  finishLoading();
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    [{labels: 0.4}],
  );
});

test('reports a failed change and tries it again on the next update', async () => {
  const {binding, calls, errors} = setup({
    results: [
      {
        error: new Error('Unknown colour token or invalid override.'),
        status: 'failed',
        theme: 'light',
      },
    ],
  });
  binding.update({colors: {nope: '#111111'}});
  await settleMicrotasks();
  assert.deepEqual(errors, [['colors', 'Unknown colour token or invalid override.']]);
  binding.update({colors: {nope: '#111111'}});
  assert.equal(calls.length, 2);
  await settleMicrotasks();
  assert.equal(errors.length, 1);
});

test('does nothing after dispose and stops waiting for the style', () => {
  const {binding, calls, listeners} = setup({loaded: false});
  binding.update({emphasis: {labels: 0.2}});
  assert.equal(listeners.size, 1);
  binding.dispose();
  assert.equal(listeners.size, 0);
  binding.update({colors: {a: '#111111'}});
  assert.equal(calls.length, 0);
});
