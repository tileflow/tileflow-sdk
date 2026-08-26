import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialTileflowInteractionState,
  type TileflowInteractionTargetRef,
  tileflowInteractionTargetRefsEqual,
  reduceTileflowInteractionState,
} from '../src/index';

const annotationTarget = {id: 'property-42', kind: 'annotation'} as const;

test('opens and closes the single popup with pure state transitions', () => {
  const opened = reduceTileflowInteractionState(initialTileflowInteractionState, {
    target: annotationTarget,
    type: 'open-popup',
  });
  assert.deepEqual(opened, {popup: annotationTarget});
  assert.notEqual(opened, initialTileflowInteractionState);

  const closed = reduceTileflowInteractionState(opened, {type: 'close-popup'});
  assert.deepEqual(closed, {popup: null});
  assert.notEqual(closed, opened);
});

test('returns the same state for idempotent open and close actions', () => {
  const opened = {popup: annotationTarget};
  assert.equal(
    reduceTileflowInteractionState(opened, {
      target: {id: 'property-42', kind: 'annotation'},
      type: 'open-popup',
    }),
    opened,
  );
  assert.equal(
    reduceTileflowInteractionState(initialTileflowInteractionState, {type: 'close-popup'}),
    initialTileflowInteractionState,
  );
});

test('compares every target reference by its stable serialized identity', () => {
  const pairs: Array<[TileflowInteractionTargetRef, TileflowInteractionTargetRef]> = [
    [annotationTarget, {id: 'property-42', kind: 'annotation'}],
    [
      {domain: 'poi', featureId: 42, kind: 'semantic-feature'},
      {domain: 'poi', featureId: 42, kind: 'semantic-feature'},
    ],
    [
      {featureId: '42', kind: 'style-feature', layerId: 'pois'},
      {featureId: '42', kind: 'style-feature', layerId: 'pois'},
    ],
    [
      {coordinate: [-3.7, 40.4], kind: 'map'},
      {coordinate: [-3.7, 40.4], kind: 'map'},
    ],
  ];

  for (const [left, right] of pairs) {
    assert.equal(tileflowInteractionTargetRefsEqual(left, right), true);
  }
  assert.equal(
    tileflowInteractionTargetRefsEqual(
      {domain: 'poi', featureId: 42, kind: 'semantic-feature'},
      {domain: 'poi', featureId: '42', kind: 'semantic-feature'},
    ),
    false,
  );
  assert.equal(
    tileflowInteractionTargetRefsEqual(
      {id: '42', kind: 'annotation'},
      {coordinate: [42, 0], kind: 'map'},
    ),
    false,
  );
});
