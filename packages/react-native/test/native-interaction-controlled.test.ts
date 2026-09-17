import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowInteractionState} from '@tileflow/interactions';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {poiBinding, poiFeature, queryFixture, touch} from './native-interaction-fixture';

const annotation = {
  id: 'one',
  kind: 'marker',
  ariaLabel: 'Place',
  coordinate: [1, 2],
  popup: {content: {kind: 'text', text: 'Details'}},
};

test('an unacknowledged controlled semantic replacement preserves the committed popup', async () => {
  const requests: TileflowInteractionState[] = [];
  const native = queryFixture();
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding], interactionState: {popup: null}},
    {
      onInteractionStateChange: (state) => requests.push(state),
    },
  );
  owner.replaceStyle(native.lease);
  native.setFeatures([poiFeature('first')]);
  await owner.activateTouch(touch);
  owner.update({interactions: [poiBinding], interactionState: requests[0]});
  const committed = owner.getSnapshot().state;
  native.setFeatures([poiFeature('second')]);
  await owner.activateTouch(touch);
  owner.update({interactions: [poiBinding], interactionState: committed});
  assert.equal(owner.getSnapshot().state, committed);
  const popup = owner.getSnapshot().popup;
  assert.equal(popup?.target.kind, 'semantic-feature');
  if (popup?.target.kind !== 'semantic-feature') assert.fail();
  assert.equal(popup.target.feature.id, 'first');
  assert.equal(requests.length, 2);
  assert.deepEqual(owner.getSnapshot().diagnostics, []);
  owner.update({interactions: [poiBinding], interactionState: requests[1]});
  const replacement = owner.getSnapshot().popup;
  if (replacement?.target.kind !== 'semantic-feature') assert.fail();
  assert.equal(replacement.target.feature.id, 'second');
  owner.dispose();
});

test('acknowledging a stale controlled close releases the previous binding identity', () => {
  const binding = {
    id: 'details',
    target: {kind: 'annotation', id: 'one'},
    popup: {content: {kind: 'text', text: 'Bound details'}},
  };
  const open: TileflowInteractionState = {popup: {kind: 'annotation', id: 'one'}};
  const owner = createNativeInteractionOwner({
    annotations: [annotation],
    interactions: [binding],
    interactionState: open,
  });
  owner.update({annotations: [annotation], interactions: [], interactionState: open});
  assert.equal(owner.getSnapshot().popup, null);
  owner.update({annotations: [annotation], interactionState: {popup: null}});
  owner.update({annotations: [annotation], interactionState: open});
  assert.equal(owner.getSnapshot().popup?.target.kind, 'annotation');
  assert.equal(owner.getSnapshot().popup?.target.bindingId, undefined);
  assert.deepEqual(owner.getSnapshot().diagnostics, []);
  owner.dispose();
});

test('reentrant identical input reconciliation does not repeatedly publish the same state', () => {
  const owner = createNativeInteractionOwner();
  const input = {annotations: [annotation]};
  let calls = 0;
  owner.subscribe(() => {
    calls++;
    assert.ok(calls <= 2);
    if (calls <= 2) owner.update(input);
  });
  owner.update(input);
  assert.equal(calls, 1);
  owner.dispose();
});

test('annotation bindings without popup content still identify touch activation', () => {
  const ids: Array<string | undefined> = [];
  const owner = createNativeInteractionOwner(
    {
      annotations: [{id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [1, 2]}],
      interactions: [{id: 'activate', target: {kind: 'annotation', id: 'one'}}],
    },
    {
      onInteractionEvent: (event) => {
        ids.push(event.bindingId);
      },
    },
  );
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(ids, ['activate']);
  assert.deepEqual(owner.getSnapshot().state, {popup: null});
  owner.dispose();
});
