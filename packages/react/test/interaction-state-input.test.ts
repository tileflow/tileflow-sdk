import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareTileflowReactInteractionState} from '../src/interaction-state-input';

test('normalizes valid controlled and uncontrolled interaction state', () => {
  const controlled = prepareTileflowReactInteractionState({popup: null}, undefined);
  const uncontrolled = prepareTileflowReactInteractionState(undefined, {popup: null});

  assert.equal(controlled.ok, true);
  assert.equal(controlled.controlled, true);
  assert.equal(uncontrolled.ok, true);
  assert.equal(uncontrolled.controlled, false);
});

test('rejects combined state ownership and malformed state without forwarding it', () => {
  const combined = prepareTileflowReactInteractionState({popup: null}, {popup: null});
  const malformed = prepareTileflowReactInteractionState(
    {popup: {id: '', kind: 'annotation'}},
    undefined,
  );

  assert.equal(combined.ok, false);
  assert.equal(combined.diagnostics[0]?.code, 'INVALID_DOCUMENT');
  assert.deepEqual(combined.state, {popup: null});
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0]?.path, '/interactionState/popup/id');
  assert.deepEqual(malformed.state, {popup: null});
});

test('rejects switching between controlled and uncontrolled ownership', () => {
  const switchedToControlled = prepareTileflowReactInteractionState(
    {popup: null},
    undefined,
    false,
  );
  const switchedToUncontrolled = prepareTileflowReactInteractionState(
    undefined,
    {popup: null},
    true,
  );

  assert.equal(switchedToControlled.ok, false);
  assert.match(switchedToControlled.diagnostics[0]?.message ?? '', /cannot switch/u);
  assert.equal(switchedToUncontrolled.ok, false);
  assert.match(switchedToUncontrolled.diagnostics[0]?.message ?? '', /cannot switch/u);
});
