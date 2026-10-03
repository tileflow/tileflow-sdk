import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeDiagnostic,
  tileflowNativePreparedStyleLimits,
  tileflowNativeProfileLimits,
  validateTileflowNativePreparedStyle,
  validateTileflowNativeStyle,
} from '../src/native-profile';

function paddedStyle(maximum: number, above = false) {
  // The style's empty containers and keys account for 11 nodes.
  return {
    version: 8,
    sources: {},
    layers: [],
    metadata: {
      padding: new Array(Math.floor((maximum - 11) / 2) + Number(above)).fill(0),
    },
  };
}
const budgetIssue = [createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE')];

test('raw style validation cannot opt into the prepared style budget', () => {
  const input = paddedStyle(160_000, true);
  assert.deepEqual(validateTileflowNativeStyle(input), budgetIssue);
  assert.deepEqual(validateTileflowNativePreparedStyle(input), []);
  // @ts-expect-error The raw validator has no stage override in its public options.
  assert.deepEqual(validateTileflowNativeStyle(input, {stage: 'prepared'}), budgetIssue);
});

test('prepared validation applies its fixed boundary and reports the same safe root pointer', () => {
  assert.equal(tileflowNativeProfileLimits.maximumNodes, 160_000);
  assert.equal(tileflowNativePreparedStyleLimits.maximumNodes, 540_000);
  assert.deepEqual(validateTileflowNativePreparedStyle(paddedStyle(540_000)), []);
  assert.deepEqual(validateTileflowNativePreparedStyle(paddedStyle(540_000, true)), budgetIssue);
});

test('the prepared validator does not lower or relax incompatible semantics', () => {
  const base = {version: 8, sources: {}, layers: []};
  for (const style of [
    {...base, projection: {type: 'globe'}},
    {...base, terrain: {source: 'dem'}},
    {...base, sources: {world: {type: 'vector', url: 'pmtiles://https://example.test/a.pmtiles'}}},
    {
      ...base,
      sources: {world: {type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf']}},
      layers: [
        {
          id: 'road',
          type: 'line',
          source: 'world',
          'source-layer': 'roads',
          layout: {'line-cap': ['get', 'cap']},
        },
      ],
    },
  ]) {
    const raw = validateTileflowNativeStyle(style);
    assert.ok(raw.length > 0);
    assert.deepEqual(validateTileflowNativePreparedStyle(style), raw);
  }
});

test('both validators preserve input and share diagnostic ordering', () => {
  const style = {version: 8, sources: {}, layers: [], pitch: 86, roll: 1};
  const before = JSON.stringify(style);
  const raw = validateTileflowNativeStyle(style);
  assert.deepEqual(validateTileflowNativePreparedStyle(style), raw);
  assert.deepEqual(
    raw.map(({path}) => path),
    ['/pitch', '/roll'],
  );
  assert.equal(JSON.stringify(style), before);
});
