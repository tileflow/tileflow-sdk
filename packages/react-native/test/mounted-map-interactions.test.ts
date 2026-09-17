import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  TileflowAnnotation,
  TileflowInteractionEvent,
  TileflowInteractionState,
} from '@tileflow/interactions';
import {
  createMountedMapInteractions,
  type NativeInteractionHost,
} from '../src/mounted-map-interactions';
import {createNativeInteractionStyleOwner} from '../src/native-interaction-style';
import {barrier, poiBinding, poiStyle, touch} from './native-interaction-fixture';

const annotation: TileflowAnnotation = {
  id: 'place',
  kind: 'marker',
  coordinate: [1, 2],
  ariaLabel: 'Place',
  data: {capacity: 12},
  popup: {content: {kind: 'text', text: 'Application-owned content'}},
};
function fixture(query: NativeInteractionHost['query'] = async () => []) {
  const style = poiStyle();
  style.layers.reverse();
  for (const layer of style.metadata['tileflow:interaction-manifest'].domains.poi.layers)
    layer.priority = style.layers.findIndex((physical) => physical.id === layer.layerId);
  const proof = createNativeInteractionStyleOwner(() => undefined);
  proof.publish('map-a', 'style_1', style, () => true);
  const owner = createMountedMapInteractions(proof.get, () => undefined);
  const host: NativeInteractionHost = {key: 'map-a', style, current: () => true, query};
  owner.bind(host);
  return {owner, proof, host, style};
}

test('one marker activation survives both native bubbling orders and suppresses semantic activation', async () => {
  let queries = 0;
  const f = fixture(async () => {
    queries++;
    return [];
  });
  const events: TileflowInteractionEvent[] = [];
  f.owner.update({
    annotations: [annotation],
    interactions: [poiBinding],
    onInteractionEvent: (event) => events.push(event),
  });
  const current = f.owner.getSnapshot()!.annotations[0]!;
  f.owner.beginTouch();
  f.owner.claimMarker(current);
  await f.owner.mapPress(touch);
  f.owner.markerPress(current);
  f.owner.markerPress(current);
  await f.owner.mapPress(touch);
  assert.equal(events.filter((event) => event.type === 'target:activate').length, 1);
  assert.equal(queries, 0);
  f.owner.beginTouch();
  const earlyMap = f.owner.mapPress(touch);
  f.owner.markerPress(current);
  await earlyMap;
  assert.equal(events.filter((event) => event.type === 'target:activate').length, 2);
});

test('callbacks update without replacing ownership; retained IDs keep host plans and removed callbacks are inert', () => {
  const f = fixture();
  const first: unknown[] = [],
    second: TileflowInteractionEvent[] = [];
  f.owner.update({annotations: [annotation], onInteractionEvent: (event) => first.push(event)});
  const old = f.owner.getSnapshot()!.annotations[0]!;
  f.owner.update({annotations: [annotation], onInteractionEvent: (event) => second.push(event)});
  assert.equal(f.owner.getSnapshot()!.annotations[0], old);
  f.owner.beginTouch();
  f.owner.markerPress(old);
  assert.equal(first.length, 0);
  assert.equal(second.filter((event) => event.type === 'target:activate').length, 1);
  f.owner.update({annotations: [{...annotation, coordinate: [3, 4], data: {capacity: 20}}]});
  assert.equal(f.owner.getSnapshot()!.annotations[0]!.id, old.id);
  assert.notEqual(f.owner.getSnapshot()!.annotations[0], old);
  f.owner.beginTouch();
  f.owner.markerPress(old);
  f.owner.update({annotations: []});
  assert.equal(f.owner.getSnapshot()!.annotations.length, 0);
  f.owner.markerPress(old);
});

test('controlled state is initialized from the first props and requests rather than owns selection', () => {
  const f = fixture();
  const changes: TileflowInteractionState[] = [];
  const props = {
    annotations: [annotation],
    interactionState: {popup: null},
    onInteractionStateChange: (state: TileflowInteractionState) => changes.push(state),
  };
  f.owner.update(props);
  assert.equal(f.owner.getSnapshot()!.ownership, 'controlled');
  f.owner.beginTouch();
  f.owner.markerPress(f.owner.getSnapshot()!.annotations[0]!);
  assert.equal(f.owner.getSnapshot()!.state.popup, null);
  assert.equal(changes.length, 1);
  f.owner.update({...props, interactionState: changes[0]!});
  assert.deepEqual(f.owner.getSnapshot()!.state.popup, {kind: 'annotation', id: 'place'});
});

test('invalid replacements retain detached last-valid data and bounded diagnostics', () => {
  const f = fixture();
  const diagnostics: unknown[] = [];
  f.owner.update({
    annotations: [annotation],
    onInteractionDiagnostic: (value) => diagnostics.push(value),
  });
  const valid = f.owner.getSnapshot()!.annotations;
  f.owner.update({
    annotations: [annotation, annotation],
    onInteractionDiagnostic: (value) => diagnostics.push(value),
  });
  assert.equal(f.owner.getSnapshot()!.annotations, valid);
  assert.ok(diagnostics.length);
  assert.equal(Object.isFrozen(valid[0]!.data), true);
});

test('new touch cancels semantic work without clearing an existing portable selection', async () => {
  const pending = barrier<unknown>();
  const f = fixture(() => pending.promise);
  f.owner.update({annotations: [annotation], interactions: [poiBinding]});
  f.owner.beginTouch();
  f.owner.markerPress(f.owner.getSnapshot()!.annotations[0]!);
  const state = f.owner.getSnapshot()!.state;
  f.owner.beginTouch();
  const query = f.owner.mapPress(touch);
  await Promise.resolve();
  f.owner.beginTouch();
  await query;
  assert.equal(f.owner.getSnapshot()!.state, state);
  pending.resolve([]);
});

test('theme/source proof replacement and background make late results inert', async () => {
  for (const retire of ['theme', 'source', 'background', 'unmount'] as const) {
    const pending = barrier<unknown>();
    const f = fixture(() => pending.promise);
    const events: unknown[] = [];
    f.owner.update({interactions: [poiBinding], onInteractionEvent: (event) => events.push(event)});
    f.owner.beginTouch();
    const query = f.owner.mapPress(touch);
    await Promise.resolve();
    if (retire === 'background') f.owner.background();
    else if (retire === 'unmount') f.owner.dispose();
    else {
      f.proof.retire();
      f.proof.publish(retire === 'source' ? 'map-b' : 'map-a', 'style_2', f.style, () => true);
      f.owner.sync();
    }
    await query;
    pending.resolve([{type: 'Feature', id: 1, properties: {name: 'Late'}}]);
    await Promise.resolve();
    assert.equal(events.length, 0);
  }
});

test('two maps have isolated state, callbacks, touch claims and retirement', async () => {
  const left = fixture(),
    right = fixture();
  const events: unknown[] = [];
  left.owner.update({annotations: [annotation]});
  right.owner.update({
    annotations: [annotation],
    onInteractionEvent: (event) => events.push(event),
  });
  left.owner.beginTouch();
  left.owner.claimMarker(left.owner.getSnapshot()!.annotations[0]!);
  left.owner.dispose();
  right.owner.beginTouch();
  right.owner.markerPress(right.owner.getSnapshot()!.annotations[0]!);
  assert.ok(events.length);
  assert.deepEqual(right.owner.getSnapshot()!.state.popup, {kind: 'annotation', id: 'place'});
});

test('observer failures never escape the mounted interaction boundary', async () => {
  const f = fixture();
  f.owner.update({
    annotations: [annotation],
    onInteractionEvent() {
      throw new Error('private');
    },
    onInteractionStateChange: async () => {
      throw new Error('private');
    },
  });
  f.owner.beginTouch();
  assert.doesNotThrow(() => f.owner.markerPress(f.owner.getSnapshot()!.annotations[0]!));
  await Promise.resolve();
  f.owner.dispose();
});
