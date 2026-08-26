import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareTileflowReactInteractionBindings} from '../src/interaction-bindings';

test('validates and normalizes semantic POI bindings before runtime reconciliation', () => {
  const prepared = prepareTileflowReactInteractionBindings([
    {
      id: 'poi-card',
      popup: {content: {kind: 'view', name: 'poi-card'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
      tooltip: {content: {field: 'name', kind: 'field'}},
    },
  ]);

  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.diagnostics, []);
  if (prepared.ok) {
    assert.equal(prepared.bindings[0]?.target.kind, 'semantic-feature');
  }
});

test('fails validation atomically instead of exposing partial bindings', () => {
  const prepared = prepareTileflowReactInteractionBindings([
    {
      id: 'duplicate',
      popup: {content: {kind: 'text', text: 'First'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
    },
    {
      id: 'duplicate',
      popup: {content: {kind: 'text', text: 'Second'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
    },
  ]);

  assert.equal(prepared.ok, false);
  assert.equal('bindings' in prepared, false);
  assert.equal(prepared.diagnostics[0]?.code, 'INVALID_DOCUMENT');
});
