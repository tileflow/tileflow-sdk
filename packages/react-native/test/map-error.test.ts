import assert from 'node:assert/strict';
import test from 'node:test';
import {mapError} from '../src/map-error';

test('native position failures retain structured correction context', () => {
  const context = {
    reason: 'layerPositionConflict',
    operation: 'moveLayer',
    path: 'position.belowLayerId',
    layerId: 'route',
    referenceLayerId: 'labels',
    slot: 'above-roads',
    referenceSlot: 'above-labels',
    rule: 'sameSlot',
    corrections: [{code: 'alignSlot', message: 'Align the slots.'}],
  };
  const error = mapError(
    Object.assign(new Error('The layer position is invalid.'), {
      code: 'invalidRequest',
      userInfo: {code: 'invalidRequest', recoverable: false, context},
    }),
  );
  assert.equal(error.code, 'invalidRequest');
  assert.equal(error.recoverable, false);
  assert.deepEqual(error.context, context);
});
