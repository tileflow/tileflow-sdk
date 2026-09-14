import assert from 'node:assert/strict';
import test from 'node:test';
import {lowerNativeStyleRepresentation} from '../src/native-lowering';
import {auditNativeLowering, measureNativeJson} from './native-lowering-audit-fixture';

function input(cap: unknown) {
  return {
    version: 8, projection: {type: 'globe'},
    sources: {world: {type: 'vector', url: 'https://example.test/world.json'}},
    layers: [{id: 'road', type: 'line', source: 'world', 'source-layer': 'transportation',
      layout: {'line-cap': cap, 'line-sort-key': ['get', 'priority']},
      paint: {'line-color': '#abcdef', 'line-width': 3}, metadata: {fixture: true}},
    ],
  };
}

test('uses the profile node-count convention, including array keys, and UTF-8 byte lengths', () => {
  assert.deepEqual(measureNativeJson([0]), {nodes: 3, depth: 1, bytes: 3});
  assert.deepEqual(measureNativeJson({a: [0]}), {nodes: 5, depth: 2, bytes: 9});
  assert.equal(measureNativeJson({text: 'ñ'}).bytes, 13);
});

test('lists exact physical spans, copied payload and conservative draw-order indicators', () => {
  const source = input(['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']);
  const lowered = lowerNativeStyleRepresentation(source);
  const report = auditNativeLowering(source, lowered);
  assert.deepEqual(report.before, {...measureNativeJson(source), layers: 1});
  assert.deepEqual(report.after, {...measureNativeJson(lowered.style), layers: 2});
  assert.equal(report.layers.length, 1);
  const row = report.layers[0]!;
  assert.equal(row.id, 'road');
  assert.equal(row.inputLayer, 0);
  assert.equal(row.outputStart, 0);
  assert.equal(row.outputCount, 2);
  assert.deepEqual(row.sortKey, ['get', 'priority']);
  assert.equal(row.maximumConcurrentBranches, 2);
  assert.equal(row.featureOrder, 'not-proven');
  assert.equal(row.additionalCopiedNodes, row.retainedPayload.nodes);
  assert.deepEqual(row.branches.map(({id}) => id), ['road--native-v1-0', 'road--native-v1-1']);
  assert.deepEqual(auditNativeLowering(source, lowered), report);
});

test('distinguishes zoom-only replacement from simultaneous feature partitions', () => {
  const source = input(['step', ['zoom'], 'butt', 12, 'round']);
  const row = auditNativeLowering(source, lowerNativeStyleRepresentation(source)).layers[0]!;
  assert.equal(row.maximumConcurrentBranches, 1);
  assert.equal(row.featureOrder, 'no-simultaneous-branches');
  assert.deepEqual(row.branches.map(({minzoom, maxzoom}) => [minzoom, maxzoom]), [[0, 12], [12, 24]]);
});
