import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {poiBinding, poiFeature, queryFixture, touch} from './native-interaction-fixture';

test('mobile activation emits only target events even when shared metadata includes popup content', async () => {
  const events: string[] = [];
  const native = queryFixture();
  native.setFeatures([poiFeature(1)]);
  const owner = createNativeInteractionOwner(
    {
      annotations: [
        {
          id: 'place',
          kind: 'marker',
          ariaLabel: 'Place',
          coordinate: [1, 2],
          popup: {content: {kind: 'text', text: 'Web-only presentation'}},
        },
      ],
      interactions: [poiBinding],
    },
    {
      onInteractionEvent: (event) => events.push(event.type),
    },
  );
  owner.replaceStyle(native.lease);
  owner.activateAnnotation('place', 'touch');
  await owner.activateTouch(touch);
  assert.deepEqual(events, ['target:activate', 'target:activate']);
  assert.equal('state' in owner.getSnapshot(), false);
  assert.equal('popup' in owner.getSnapshot(), false);
  owner.dispose();
});

test('binding identity is available without presentation metadata', () => {
  const ids: Array<string | undefined> = [];
  const owner = createNativeInteractionOwner(
    {
      annotations: [{id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [1, 2]}],
      interactions: [{id: 'activate', target: {kind: 'annotation', id: 'one'}}],
    },
    {onInteractionEvent: (event) => ids.push(event.bindingId)},
  );
  owner.activateAnnotation('one', 'touch');
  assert.deepEqual(ids, ['activate']);
  owner.dispose();
});

test('reentrant identical input reconciliation publishes one snapshot', () => {
  const owner = createNativeInteractionOwner();
  const input = {
    annotations: [{id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [1, 2]}],
  };
  let calls = 0;
  owner.subscribe(() => {
    calls++;
    assert.ok(calls <= 2);
    owner.update(input);
  });
  owner.update(input);
  assert.equal(calls, 1);
  owner.dispose();
});
