import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowWorldLayerFields} from '../src/data/tileflow-world-schema';

test('circular features expose optional road-network and path-status attributes', () => {
  assert.deepEqual(tileflowWorldLayerFields.circularFeature.network, {type: 'String'});
  assert.deepEqual(tileflowWorldLayerFields.circularFeature.official, {type: 'Number'});
});
