import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {createNativeInteractionQuery} from '../src/native-interaction-query';
import {poiBinding, poiStyle, touch} from './native-interaction-fixture';

function fixture() {
  const style = poiStyle();
  style.layers.reverse();
  for (const layer of style.metadata['tileflow:interaction-manifest'].domains.poi.layers)
    layer.priority = style.layers.findIndex((physical) => physical.id === layer.layerId);
  const port = () =>
    createNativeInteractionQuery(
      style,
      () => true,
      async () => [{type: 'Feature', id: 1, properties: {name: 'Place'}}],
    );
  return {style, port};
}

test('renewal validates the same style without replaying activation and retires the old lease', async () => {
  const f = fixture();
  const events: unknown[] = [];
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding]},
    {
      onInteractionEvent: (event) => events.push(event),
    },
  );
  const old = f.port();
  owner.replaceStyle(old.lease);
  await owner.activateTouch(touch);
  const snapshot = owner.getSnapshot();
  assert.equal(events.length, 1);
  const count = events.length;
  const next = f.port();
  assert.equal(owner.renewTouchLease(next.lease), true);
  old.retire();
  assert.equal(old.lease.isCurrent(), false);
  assert.equal(next.lease.isCurrent(), true);
  assert.equal(owner.getSnapshot(), snapshot);
  assert.equal(events.length, count);
  owner.dispose();
});

test('touch renewal cannot accept a different style object or a retired backing owner', () => {
  const f = fixture();
  const owner = createNativeInteractionOwner({interactions: [poiBinding]});
  const old = f.port();
  owner.replaceStyle(old.lease);
  const other = createNativeInteractionQuery(
    {...f.style},
    () => true,
    async () => [],
  );
  assert.equal(owner.renewTouchLease(other.lease), false);
  old.retire();
  assert.equal(owner.renewTouchLease(f.port().lease), false);
  owner.dispose();
});

test('renewal still applies the full semantic manifest validator', () => {
  const f = fixture();
  const owner = createNativeInteractionOwner({interactions: [poiBinding]});
  owner.replaceStyle(f.port().lease);
  // Real finalized styles are frozen; a forged mutable private port must still fail closed.
  f.style.metadata['tileflow:interaction-manifest'].version = 99;
  // Renewal reports lease installation independently from semantic availability so annotation
  // markers keep working on styles without semantic metadata.
  assert.equal(owner.renewTouchLease(f.port().lease), true);
  assert.equal(owner.getSnapshot().diagnostics[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
  owner.dispose();
});
