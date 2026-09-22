import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionEvent} from '@tileflow/interactions';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {barrier, poiBinding, poiFeature, queryFixture, touch} from './native-interaction-fixture';

const marker = (id = 'one') => ({
  id,
  kind: 'marker',
  ariaLabel: 'Place',
  coordinate: [1, 2],
  popup: {content: {kind: 'text', text: 'Web-only details'}},
});

test('annotation activation is a single portable event with no selection state', () => {
  const events: TileflowInteractionEvent[] = [];
  const owner = createNativeInteractionOwner(
    {annotations: [marker()]},
    {onInteractionEvent: (event) => events.push(event)},
  );
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(
    events.map((event) => event.type),
    ['target:activate'],
  );
  assert.equal(events[0]?.inputModality, 'touch');
  assert.equal(events[0]?.target.kind, 'annotation');
  assert.equal('state' in owner.getSnapshot(), false);
  assert.equal('popup' in owner.getSnapshot(), false);
  owner.dispose();
});

test('invalid collections preserve the last valid marker plan', () => {
  const owner = createNativeInteractionOwner({annotations: [marker()]});
  const before = owner.getSnapshot();
  owner.update({annotations: [marker(), marker()]});
  assert.equal(owner.getSnapshot().annotations, before.annotations);
  assert.deepEqual(owner.getSnapshot().plan.remove, []);
  assert.deepEqual(owner.getSnapshot().plan.create, []);
  assert.deepEqual(owner.getSnapshot().plan.update, []);
  assert.ok(
    owner.getSnapshot().diagnostics.some((value) => value.code === 'DUPLICATE_ANNOTATION_ID'),
  );
  owner.dispose();
});

test('semantic activation does not require a durable feature ID or popup metadata', async () => {
  const events: TileflowInteractionEvent[] = [];
  const native = queryFixture();
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding]},
    {onInteractionEvent: (event) => events.push(event)},
  );
  owner.replaceStyle(native.lease);
  native.setFeatures([poiFeature(null)]);
  await owner.activateTouch(touch);
  native.setFeatures([poiFeature(0)]);
  await owner.activateTouch(touch);
  assert.deepEqual(
    events.map((event) => event.type),
    ['target:activate', 'target:activate'],
  );
  assert.equal(events[0]?.target.kind, 'semantic-feature');
  assert.equal(events[1]?.target.kind, 'semantic-feature');
  assert.equal(
    owner.getSnapshot().diagnostics.some((value) => value.code === 'UNSTABLE_FEATURE_IDENTITY'),
    false,
  );
  owner.dispose();
});

test('style replacement retires pending semantic results', async () => {
  const first = queryFixture();
  const late = barrier<unknown>();
  first.setQuery(() => ({result: late.promise, cancel() {}}));
  const events: TileflowInteractionEvent[] = [];
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding]},
    {onInteractionEvent: (event) => events.push(event)},
  );
  owner.replaceStyle(first.lease);
  const pending = owner.activateTouch(touch);
  owner.replaceStyle(queryFixture().lease);
  await pending;
  late.resolve({request: first.requests.at(-1), features: [poiFeature(2)]});
  await Promise.resolve();
  assert.deepEqual(events, []);
  owner.dispose();
});

test('owners isolate queries, callbacks and disposal', async () => {
  const firstNative = queryFixture();
  const secondNative = queryFixture();
  const late = barrier<unknown>();
  firstNative.setQuery(() => ({result: late.promise, cancel() {}}));
  secondNative.setFeatures([poiFeature('two')]);
  const firstEvents: TileflowInteractionEvent[] = [];
  const secondEvents: TileflowInteractionEvent[] = [];
  const first = createNativeInteractionOwner(
    {annotations: [marker()], interactions: [poiBinding]},
    {onInteractionEvent: (event) => firstEvents.push(event)},
  );
  const second = createNativeInteractionOwner(
    {annotations: [marker()], interactions: [poiBinding]},
    {onInteractionEvent: (event) => secondEvents.push(event)},
  );
  first.replaceStyle(firstNative.lease);
  second.replaceStyle(secondNative.lease);
  const pending = first.activateTouch(touch);
  await second.activateTouch(touch);
  first.dispose();
  first.dispose();
  await pending;
  late.resolve({request: firstNative.requests[0], features: [poiFeature('late')]});
  await Promise.resolve();
  assert.deepEqual(firstEvents, []);
  assert.equal(secondEvents.length, 1);
  assert.deepEqual(first.getSnapshot().plan.remove, ['one']);
  second.dispose();
});

test('observer failures and reentrant removal cannot activate a removed target', () => {
  const owner = createNativeInteractionOwner(
    {annotations: [marker()]},
    {
      onInteractionEvent() {
        throw new Error('private');
      },
    },
  );
  owner.subscribe(() => {
    throw new Error('private');
  });
  assert.doesNotThrow(() => owner.activateAnnotation('one', 'touch'));
  owner.setCallbacks({
    onInteractionEvent() {
      owner.update({annotations: []});
    },
  });
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(owner.getSnapshot().annotations, []);
  assert.doesNotMatch(JSON.stringify(owner.getSnapshot().diagnostics), /private/u);
  owner.dispose();
});
