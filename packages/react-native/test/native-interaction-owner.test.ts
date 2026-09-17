import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionEvent, TileflowInteractionState} from '@tileflow/interactions';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {barrier, poiBinding, poiFeature, queryFixture, touch} from './native-interaction-fixture';

const marker = (id = 'one') => ({
  id,
  kind: 'marker',
  ariaLabel: 'Place',
  coordinate: [1, 2],
  popup: {content: {kind: 'text', text: 'Details'}},
});

test('uncontrolled touch activation commits one popup and explicit close uses the portable reducer', () => {
  const states: TileflowInteractionState[] = [];
  const events: TileflowInteractionEvent[] = [];
  const owner = createNativeInteractionOwner(
    {annotations: [marker()]},
    {
      onInteractionStateChange: (state) => states.push(state),
      onInteractionEvent: (event) => events.push(event),
    },
  );
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(owner.getSnapshot().state, {popup: {kind: 'annotation', id: 'one'}});
  assert.equal(owner.getSnapshot().popup?.target.kind, 'annotation');
  assert.deepEqual(
    events.map((event) => event.type),
    ['target:activate', 'popup:open'],
  );
  assert.equal(events[0]?.inputModality, 'touch');
  assert.equal(states.length, 1);
  owner.close();
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  assert.equal(owner.getSnapshot().popup, null);
  assert.equal(states.length, 2);
  assert.equal(events.at(-1)?.type, 'popup:close');
  owner.close();
  assert.equal(states.length, 2);
  owner.dispose();
});

test('controlled requests do not commit before supplied state, and callback replacement is inert', () => {
  const requests: TileflowInteractionState[] = [];
  const annotations = [marker()];
  const closed = {popup: null};
  const owner = createNativeInteractionOwner(
    {annotations, interactionState: closed},
    {
      onInteractionStateChange: (state) => requests.push(state),
    },
  );
  const before = owner.getSnapshot();
  owner.setCallbacks({onInteractionStateChange: (state) => requests.push(state)});
  assert.equal(owner.getSnapshot(), before);
  owner.activateAnnotation('one', 'touch');
  assert.equal(owner.getSnapshot().state, before.state);
  assert.equal(owner.getSnapshot().popup, null);
  assert.deepEqual(requests[0], {popup: {kind: 'annotation', id: 'one'}});
  owner.update({annotations, interactionState: requests[0]});
  assert.equal(owner.getSnapshot().popup?.target.kind, 'annotation');
  const open = owner.getSnapshot().state;
  owner.close();
  assert.equal(owner.getSnapshot().state, open);
  assert.ok(owner.getSnapshot().popup);
  owner.update({annotations, interactionState: requests[1]});
  assert.equal(owner.getSnapshot().popup, null);
  assert.equal(requests.length, 2);
  owner.dispose();
});

test('invalid documents and ownership switches retain committed values without partial host changes', () => {
  const owner = createNativeInteractionOwner({annotations: [marker()]});
  owner.activateAnnotation('one', 'touch');
  const before = owner.getSnapshot();
  owner.update({annotations: [marker(), marker()], interactionState: {popup: null}});
  assert.equal(owner.getSnapshot().annotations, before.annotations);
  assert.equal(owner.getSnapshot().state, before.state);
  assert.deepEqual(owner.getSnapshot().plan.remove, []);
  assert.deepEqual(owner.getSnapshot().plan.create, []);
  assert.deepEqual(owner.getSnapshot().plan.update, []);
  assert.ok(owner.getSnapshot().diagnostics.some((value) => value.code === 'INVALID_DOCUMENT'));
  assert.ok(
    owner.getSnapshot().diagnostics.some((value) => value.code === 'DUPLICATE_ANNOTATION_ID'),
  );
  owner.dispose();
});

test('annotation and active binding removal close stale popup state, including a controlled pending close', () => {
  const requests: TileflowInteractionState[] = [];
  const annotations = [marker()];
  const owner = createNativeInteractionOwner(
    {annotations, defaultInteractionState: {popup: {kind: 'annotation', id: 'one'}}},
    {
      onInteractionStateChange: (state) => requests.push(state),
    },
  );
  assert.ok(owner.getSnapshot().popup);
  owner.update({annotations: []});
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  assert.equal(owner.getSnapshot().diagnostics.at(-1)?.code, 'STALE_TARGET');
  assert.deepEqual(owner.getSnapshot().plan.remove, ['one']);
  owner.dispose();

  const binding = {
    id: 'annotation-details',
    target: {kind: 'annotation', id: 'one'},
    popup: {content: {kind: 'text', text: 'Bound'}},
  };
  const open: TileflowInteractionState = {popup: {kind: 'annotation', id: 'one'}};
  const controlled = createNativeInteractionOwner(
    {annotations, interactions: [binding], interactionState: open},
    {
      onInteractionStateChange: (state) => requests.push(state),
    },
  );
  assert.equal(controlled.getSnapshot().popup?.target.bindingId, binding.id);
  controlled.update({annotations, interactions: [], interactionState: open});
  assert.deepEqual(controlled.getSnapshot().state, open);
  assert.equal(controlled.getSnapshot().popup, null);
  assert.equal(controlled.getSnapshot().diagnostics.at(-1)?.code, 'STALE_TARGET');
  const count = requests.length;
  controlled.update({annotations, interactions: [], interactionState: open});
  assert.equal(requests.length, count);
  controlled.dispose();
});

test('semantic touch emits bounded targets and requires stable identity only for durable popup requests', async () => {
  const events: TileflowInteractionEvent[] = [];
  const native = queryFixture();
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding]},
    {onInteractionEvent: (event) => events.push(event)},
  );
  owner.replaceStyle(native.lease);
  native.setFeatures([poiFeature(null)]);
  await owner.activateTouch(touch);
  assert.equal(events[0]?.type, 'target:activate');
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  assert.equal(owner.getSnapshot().diagnostics.at(-1)?.code, 'UNSTABLE_FEATURE_IDENTITY');
  native.setFeatures([poiFeature(0)]);
  await owner.activateTouch(touch);
  assert.deepEqual(owner.getSnapshot().state, {
    popup: {kind: 'semantic-feature', domain: 'poi', featureId: 0},
  });
  assert.equal(owner.getSnapshot().popup?.target.kind, 'semantic-feature');
  assert.equal(events.at(-1)?.type, 'popup:open');
  owner.update({
    interactions: [
      {...poiBinding, target: {kind: 'semantic-feature', domain: 'poi', categories: ['lodging']}},
    ],
  });
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  assert.equal(owner.getSnapshot().diagnostics.at(-1)?.code, 'STALE_TARGET');
  owner.dispose();
});

test('style replacement invalidates open semantic targets and never reuses pending native results', async () => {
  const first = queryFixture();
  first.setFeatures([poiFeature(1)]);
  const owner = createNativeInteractionOwner({interactions: [poiBinding]});
  owner.replaceStyle(first.lease);
  await owner.activateTouch(touch);
  assert.ok(owner.getSnapshot().popup);
  const late = barrier<unknown>();
  first.setQuery(() => ({result: late.promise, cancel() {}}));
  const pending = owner.activateTouch(touch);
  owner.replaceStyle(queryFixture().lease);
  await pending;
  assert.equal(owner.getSnapshot().popup, null);
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  late.resolve({request: first.requests.at(-1), features: [poiFeature(2)]});
  await Promise.resolve();
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  owner.dispose();
});

test('two owners and disposal isolate state, query generations, callbacks and annotation plans', async () => {
  const native = queryFixture();
  const secondNative = queryFixture();
  const late = barrier<unknown>();
  native.setQuery(() => ({result: late.promise, cancel() {}}));
  secondNative.setFeatures([poiFeature('two')]);
  let notifications = 0;
  const first = createNativeInteractionOwner({annotations: [marker()], interactions: [poiBinding]});
  const second = createNativeInteractionOwner({
    annotations: [marker()],
    interactions: [poiBinding],
  });
  first.subscribe(() => {
    notifications++;
  });
  first.replaceStyle(native.lease);
  second.replaceStyle(secondNative.lease);
  const pending = first.activateTouch(touch);
  await second.activateTouch(touch);
  first.dispose();
  first.dispose();
  await pending;
  const count = notifications;
  late.resolve({request: native.requests[0], features: [poiFeature('late')]});
  await Promise.resolve();
  assert.equal(notifications, count);
  assert.deepEqual(first.getSnapshot().state, {popup: null});
  assert.deepEqual(first.getSnapshot().plan.remove, ['one']);
  assert.deepEqual(second.getSnapshot().state, {
    popup: {kind: 'semantic-feature', domain: 'poi', featureId: 'two'},
  });
  second.dispose();
});

test('observer failures do not own lifetime and observer reentrancy cannot open a removed target', () => {
  const owner = createNativeInteractionOwner(
    {annotations: [marker()]},
    {
      onInteractionEvent() {
        throw new Error('private');
      },
      onInteractionStateChange() {
        return Promise.reject(new Error('private'));
      },
    },
  );
  owner.subscribe(() => {
    throw new Error('private');
  });
  owner.activateAnnotation('one', 'touch');
  assert.ok(owner.getSnapshot().popup);
  assert.doesNotMatch(JSON.stringify(owner.getSnapshot().diagnostics), /private/u);
  owner.close();
  owner.setCallbacks({
    onInteractionEvent(event) {
      if (event.type === 'target:activate') owner.update({annotations: []});
    },
  });
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  assert.deepEqual(owner.getSnapshot().annotations, []);
  owner.dispose();
});
