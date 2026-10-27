import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoundaryFeatureState} from '@tileflow/core/native';
import {
  createNativeBoundaryFeatureStateOwner,
  type NativeBoundarySource,
} from '../src/native-boundary-feature-state-owner';

const sourceId = 'tileflow-boundaries';
const settle = () => new Promise((resolve) => setImmediate(resolve));

function manual() {
  const queued: {run: () => void; delayMs: number}[] = [];
  return {
    queued,
    schedule(run: () => void, delayMs: number) {
      const entry = {run, delayMs};
      queued.push(entry);
      return () => queued.splice(queued.indexOf(entry), 1);
    },
  };
}
const style = (promoteId?: string) => ({
  sources: {[sourceId]: {type: 'vector', tiles: ['https://t/{z}/{x}/{y}.pbf'], promoteId}},
});

function fakeSource(failWrites: boolean | (() => boolean) = false) {
  const writes: string[] = [];
  const source: NativeBoundarySource = {
    async setFeatureState({id, sourceLayer}, state) {
      writes.push(`set ${sourceLayer}:${id}=${JSON.stringify(state)}`);
      if (typeof failWrites === 'function' ? failWrites() : failWrites)
        throw new Error('source_not_attached');
    },
    async removeFeatureState(feature: {id?: string | number; sourceLayer: string}, key?: string) {
      writes.push(`remove ${feature.sourceLayer}:${feature.id}.${key}`);
    },
  };
  return {source, writes};
}

test('values wait for the loaded style and its adopted source, then follow every reload', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId);
  const controller = createBoundaryFeatureState(owner.map, {labels: true});
  const {source, writes} = fakeSource();
  const light = style();
  owner.setStyle(light, false);
  controller.set({joinBy: 'id', rows: [{key: 7, value: 3}]});
  assert.deepEqual(writes, []);

  owner.setStyle(light, true);
  owner.setSource(source);
  assert.deepEqual(writes, ['set boundary_area:7={"value":3}', 'set boundary_label:7={"value":3}']);

  // A theme change replaces the style; MapLibre drops feature-state with it.
  writes.length = 0;
  const dark = style();
  owner.setStyle(dark, false);
  controller.set({joinBy: 'id', rows: [{key: 7, value: 4}]});
  assert.deepEqual(writes, []);
  owner.setStyle(dark, true);
  assert.deepEqual(writes, ['set boundary_area:7={"value":4}', 'set boundary_label:7={"value":4}']);

  writes.length = 0;
  controller.set({joinBy: 'id', rows: []});
  assert.deepEqual(writes, ['remove boundary_area:7.value', 'remove boundary_label:7.value']);
});

test('a style that loads at once still receives every value again', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId);
  const controller = createBoundaryFeatureState(owner.map);
  const {source, writes} = fakeSource();
  owner.setSource(source);
  owner.setStyle(style(), true);
  controller.set({joinBy: 'id', rows: [{key: 1, value: 'a'}]});
  writes.length = 0;
  owner.setStyle(style(), true);
  assert.deepEqual(writes, ['set boundary_area:1={"value":"a"}']);
});

test('rows follow the style source key, and a style without the source receives nothing', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId, manual().schedule);
  const controller = createBoundaryFeatureState(owner.map);
  const {source, writes} = fakeSource(true);
  owner.setSource(source);
  owner.setStyle(style('ref'), true);
  assert.throws(() => controller.set({joinBy: 'id', rows: [{key: 1, value: 1}]}), /keyed by ref/u);
  // A rejected native write (a source detached by a reload) is not an application error.
  controller.set({joinBy: 'ref', rows: [{key: 'ES:INE:28079', value: 1}]});
  assert.deepEqual(writes, ['set boundary_area:ES:INE:28079={"value":1}']);

  writes.length = 0;
  owner.setStyle({sources: {}}, true);
  assert.equal(owner.map.getSource(sourceId), undefined);
  controller.clear();
  assert.deepEqual(writes, []);
});

test('writes rejected before MapLibre adopts the source are all sent again, with a bounded backoff', async () => {
  const timers = manual();
  const owner = createNativeBoundaryFeatureStateOwner(sourceId, timers.schedule);
  const controller = createBoundaryFeatureState(owner.map);
  let attached = false;
  const {source, writes} = fakeSource(() => !attached);
  controller.set({
    joinBy: 'id',
    rows: [
      {key: 1, value: 2},
      {key: 2, value: 8},
    ],
  });
  owner.setStyle(style(), true);
  owner.setSource(source);
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(
    timers.queued.map(({delayMs}) => delayMs),
    [16],
  );

  attached = true;
  writes.length = 0;
  timers.queued.shift()!.run();
  await settle();
  assert.deepEqual(writes, ['set boundary_area:1={"value":2}', 'set boundary_area:2={"value":8}']);
  assert.deepEqual(timers.queued, []);

  // A source that never adopts stops after the last delay.
  attached = false;
  owner.setStyle(style(), true);
  const delays: number[] = [];
  for (let step = 0; step < 10; step += 1) {
    await settle();
    const next = timers.queued.shift();
    if (!next) break;
    delays.push(next.delayMs);
    next.run();
  }
  assert.deepEqual(delays, [16, 50, 150, 400, 1000]);
});
