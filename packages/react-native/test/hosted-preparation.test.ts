import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostedNativePreparationGuard} from '../src/hosted-preparation';
import {directSourceFixture, hostedSourceFixture} from './hosted-source-fixture';

test('manifest recovery is bounded per explicit selection and does not replace identity', () => {
  const guard = createHostedNativePreparationGuard();
  guard.select();
  guard.validate(hostedSourceFixture());
  assert.equal(guard.retryManifest(), true);
  assert.equal(guard.retryManifest(), false);
  guard.validate(hostedSourceFixture({version: 8}));
  assert.equal(
    guard.retryManifest(),
    false,
    'A refetched manifest cannot replenish the retry budget.',
  );
  guard.select();
  assert.equal(guard.retryManifest(), true);
  assert.equal(guard.retryManifest(), false);
});

test('retained sessions cannot follow Map, origin, mode or deployment regression', () => {
  const guard = createHostedNativePreparationGuard();
  guard.validate(hostedSourceFixture({version: 8}));
  for (const source of [
    hostedSourceFixture({mapId: 'map_ponmlkjihgfedcba', version: 8}),
    hostedSourceFixture({apiOrigin: 'https://other.example', version: 8}),
    hostedSourceFixture({version: 7}),
    directSourceFixture(),
  ])
    assert.throws(() => guard.validate(source));
  assert.doesNotThrow(() => guard.validate(hostedSourceFixture({version: 8})));
  assert.doesNotThrow(() => guard.validate(hostedSourceFixture({version: 9})));
});

test('direct sources neither get an implicit Hosted session nor a Hosted reload', () => {
  const guard = createHostedNativePreparationGuard();
  guard.validate(directSourceFixture());
  assert.equal(guard.retryManifest(), false);
  assert.throws(() => guard.validate(hostedSourceFixture()));
  const other = createHostedNativePreparationGuard();
  other.validate(hostedSourceFixture());
  assert.equal(other.retryManifest(), true);
  assert.equal(guard.retryManifest(), false);
});
