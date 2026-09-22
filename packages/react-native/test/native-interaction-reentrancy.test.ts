import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeInteractionOwner} from '../src/native-interaction-owner';
import {createNativePoiAdapter} from '../src/native-interaction-poi';
import {barrier, poiBinding, poiFeature, queryFixture, touch} from './native-interaction-fixture';

test('a native cancel callback that starts a newer query cannot be overwritten by the cancelled caller', async () => {
  const adapter = createNativePoiAdapter();
  const native = queryFixture();
  adapter.replaceStyle(native.lease);
  const raw = barrier<unknown>();
  let replacement: ReturnType<typeof adapter.queryTouch> | undefined;
  native.setQuery(() => ({
    result: raw.promise,
    cancel() {
      native.setQuery((request) => ({
        result: Promise.resolve({request, features: [poiFeature('newest')]}),
        cancel() {},
      }));
      replacement = adapter.queryTouch(touch, [poiBinding]);
    },
  }));
  const old = adapter.queryTouch(touch, [poiBinding]);
  const superseded = adapter.queryTouch(touch, [poiBinding]);
  assert.equal((await old).status, 'stale');
  assert.equal((await superseded).status, 'stale');
  assert.ok(replacement);
  const current = await replacement;
  assert.equal(current.status, 'match');
  if (current.status !== 'match') assert.fail();
  assert.equal(current.match.target.feature.id, 'newest');
  raw.resolve({request: native.requests[0], features: [poiFeature('old')]});
  adapter.dispose();
});

test('a style lease can retire reentrantly during ownership inspection without exposing native errors', async () => {
  const adapter = createNativePoiAdapter();
  const native = queryFixture();
  let retire = false;
  adapter.replaceStyle({
    ...native.lease,
    isCurrent() {
      if (retire) adapter.replaceStyle();
      return true;
    },
  });
  native.setFeatures([poiFeature(1)]);
  const match = await adapter.queryTouch(touch, [poiBinding]);
  assert.equal(match.status, 'match');
  if (match.status !== 'match') assert.fail();
  retire = true;
  assert.equal(adapter.supports(match.match.target), false);
  adapter.dispose();
});

test('throwing current-style inspection is a structured diagnostic rather than a leaked native exception', async () => {
  const adapter = createNativePoiAdapter();
  const native = queryFixture();
  let broken = false;
  adapter.replaceStyle({
    ...native.lease,
    isCurrent() {
      if (broken) throw new Error('private configured values');
      return true;
    },
  });
  const raw = barrier<unknown>();
  native.setQuery(() => ({result: raw.promise, cancel() {}}));
  const pending = adapter.queryTouch(touch, [poiBinding]);
  broken = true;
  raw.resolve({request: native.requests[0], features: [poiFeature(1)]});
  const result = await pending;
  assert.equal(result.status, 'error');
  assert.equal(result.diagnostics[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
  assert.doesNotMatch(JSON.stringify(result), /configured|private/u);
  adapter.dispose();
});

test('semantic activation cannot survive source retirement', async () => {
  const events: unknown[] = [];
  const native = queryFixture();
  native.setFeatures([poiFeature('feature')]);
  const owner = createNativeInteractionOwner(
    {interactions: [poiBinding]},
    {onInteractionEvent: (event) => events.push(event)},
  );
  owner.replaceStyle(native.lease);
  await owner.activateTouch(touch);
  assert.equal(events.length, 1);
  const pending = barrier<unknown>();
  native.setQuery(() => ({result: pending.promise, cancel() {}}));
  const query = owner.activateTouch(touch);
  owner.retireSource();
  await query;
  pending.resolve({request: native.requests.at(-1), features: [poiFeature('late')]});
  assert.equal(events.length, 1);
  assert.equal(owner.getSnapshot().disposed, true);
});

test('hostile input replacement cannot overwrite a newer owner reconciliation', () => {
  const owner = createNativeInteractionOwner();
  const raw = new Proxy(
    {},
    {
      getPrototypeOf() {
        owner.update({
          annotations: [{id: 'newest', kind: 'marker', ariaLabel: 'New', coordinate: [1, 2]}],
        });
        throw new Error('private');
      },
    },
  );
  owner.update(raw);
  assert.equal(owner.getSnapshot().annotations[0]?.id, 'newest');
  assert.deepEqual(owner.getSnapshot().diagnostics, []);
  owner.dispose();
});

test('an activation observer can start a newer touch without a stale follow-up', async () => {
  const native = queryFixture();
  native.setFeatures([poiFeature('first')]);
  const owner = createNativeInteractionOwner({interactions: [poiBinding]});
  owner.replaceStyle(native.lease);
  const later = barrier<unknown>();
  const ids: Array<string | number | undefined> = [];
  let replacement: Promise<void> | undefined;
  owner.setCallbacks({
    onInteractionEvent(event) {
      if (event.target.kind === 'semantic-feature') ids.push(event.target.feature.id);
      if (event.type !== 'target:activate' || replacement) return;
      native.setQuery(() => ({result: later.promise, cancel() {}}));
      replacement = owner.activateTouch(touch);
    },
  });
  await owner.activateTouch(touch);
  assert.ok(replacement);
  later.resolve({request: native.requests.at(-1), features: [poiFeature('second')]});
  await replacement;
  assert.deepEqual(ids, ['first', 'second']);
  owner.dispose();
});
