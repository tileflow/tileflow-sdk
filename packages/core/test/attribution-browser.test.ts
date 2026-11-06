import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowAttributionControlOptions} from '../src/attribution-browser';

test('always keeps the attribution control open', () => {
  assert.deepEqual(tileflowAttributionControlOptions(), {compact: false});
  assert.deepEqual(tileflowAttributionControlOptions(false), {compact: false});
  assert.deepEqual(tileflowAttributionControlOptions({compact: true}), {compact: false});
});

test('preserves custom credits', () => {
  const options = {compact: true, customAttribution: ['Additional source', 'Additional provider']};
  assert.deepEqual(tileflowAttributionControlOptions(options), {...options, compact: false});
  assert.equal(options.compact, true);
});
