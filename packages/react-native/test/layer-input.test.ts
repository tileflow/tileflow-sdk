import assert from 'node:assert/strict';
import test from 'node:test';
import {layerStyle} from '../src/layer-input';

test('generated styles retain expressions and distinguish paint from layout', () => {
  const color = ['case', ['boolean', ['feature-state', 'selected'], false], '#f00', '#00f'];
  assert.deepEqual(
    layerStyle('circle', {
      circleColor: color,
      circleSortKey: ['get', 'rank'],
      circleColorTransition: {duration: 240},
    }),
    {
      paint: {'circle-color': color, 'circle-color-transition': {duration: 240}},
      layout: {'circle-sort-key': ['get', 'rank']},
    },
  );
  assert.throws(() => layerStyle('circle', {textField: 'invalid'}), {code: 'invalidRequest'});
});
