import assert from 'node:assert/strict';
import test from 'node:test';
import {areEquivalentTileflowOptionValues, createTileflowReconciler} from '../src/reconcile';

test('an effect runs again only when one of its dependencies changes identity', () => {
  const reconciler = createTileflowReconciler();
  const runs: string[] = [];
  const colors = {water: '#2563eb'};
  const pass = (value: unknown) => {
    reconciler.effect('appearance', [value], () => {
      runs.push('run');
      return () => runs.push('cleanup');
    });
    reconciler.commit();
  };

  pass(colors);
  pass(colors);
  assert.deepEqual(runs, ['run']);
  pass({water: '#2563eb'});
  assert.deepEqual(runs, ['run', 'cleanup', 'run']);
});

test('a pass runs the cleanups of changed effects before any of their bodies, in order', () => {
  const reconciler = createTileflowReconciler();
  const log: string[] = [];
  const pass = (value: number) => {
    for (const key of ['first', 'second']) {
      reconciler.effect(key, [value], () => {
        log.push(`${key}:${value}`);
        return () => log.push(`${key}:cleanup:${value}`);
      });
    }
    reconciler.commit();
  };

  pass(1);
  pass(2);
  assert.deepEqual(log, [
    'first:1',
    'second:1',
    'first:cleanup:1',
    'second:cleanup:1',
    'first:2',
    'second:2',
  ]);
});

test('dispose runs every remaining cleanup, last declared first, even when one throws', () => {
  const reconciler = createTileflowReconciler();
  const log: string[] = [];
  reconciler.effect('map', [], () => () => log.push('map'));
  reconciler.effect('broken', [], () => () => {
    throw new Error('broken cleanup');
  });
  reconciler.effect('listener', [], () => () => log.push('listener'));
  reconciler.commit();

  assert.throws(() => reconciler.dispose(), /broken cleanup/u);
  assert.deepEqual(log, ['listener', 'map']);
  // Nothing is left to clean up a second time.
  reconciler.dispose();
  assert.deepEqual(log, ['listener', 'map']);
});

test('memo recomputes only for new dependencies', () => {
  const reconciler = createTileflowReconciler();
  let computations = 0;
  const annotations = [{id: 'a'}];
  const compute = (value: unknown) =>
    reconciler.memo('prepared', [value], () => {
      computations += 1;
      return {value};
    });

  const first = compute(annotations);
  assert.equal(compute(annotations), first);
  assert.equal(computations, 1);
  assert.notEqual(compute([{id: 'a'}]), first);
  assert.equal(computations, 2);
});

test('stable keeps a structurally equal value, so inline options do not rebuild the map', () => {
  const reconciler = createTileflowReconciler();
  const transformRequest = () => undefined;
  const first = reconciler.stable('mapOptions', {maxZoom: 18, transformRequest});

  assert.equal(reconciler.stable('mapOptions', {maxZoom: 18, transformRequest}), first);
  assert.notEqual(reconciler.stable('mapOptions', {maxZoom: 19, transformRequest}), first);
  // A new function is a new option.
  const second = reconciler.stable('mapOptions', {maxZoom: 19, transformRequest});
  assert.notEqual(
    reconciler.stable('mapOptions', {maxZoom: 19, transformRequest: () => 1}),
    second,
  );
});

test('option equivalence compares plain data by contents and everything else by identity', () => {
  assert.equal(areEquivalentTileflowOptionValues([1, {a: [2]}], [1, {a: [2]}]), true);
  assert.equal(areEquivalentTileflowOptionValues({a: 1}, {a: 1, b: undefined}), false);
  assert.equal(areEquivalentTileflowOptionValues(new Date(0), new Date(0)), false);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const other: Record<string, unknown> = {};
  other.self = other;
  assert.equal(areEquivalentTileflowOptionValues(cyclic, other), true);
});
