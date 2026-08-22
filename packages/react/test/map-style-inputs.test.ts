import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTileflowMapStyleInputs,
  validateTileflowMapStyleInputs,
} from '../src/map-style-inputs';

const style = {layers: [], sources: {}, version: 8};

test('accepts every documented Map style source shape', () => {
  for (const input of [
    {},
    {map: 'madrid'},
    {map: 'madrid', style},
    {map: 'madrid', styleUrl: 'https://api.example.test/style.json'},
    {map: 'madrid', styleBaseUrl: '/tileflow'},
    {style},
    {styleUrl: 'https://api.example.test/style.json'},
    {config: {}},
    {config: {}, themes: {}},
  ]) {
    assert.deepEqual(validateTileflowMapStyleInputs(input), {ok: true});
  }
});

test('rejects config combinations that the runtime used to ignore', () => {
  for (const [input, conflict] of [
    [{config: {}, map: 'madrid'}, 'map'],
    [{config: {}, style}, 'style'],
    [{config: {}, styleUrl: 'https://api.example.test/style.json'}, 'styleUrl'],
    [{config: {}, styleBaseUrl: '/tileflow'}, 'styleBaseUrl'],
  ] as const) {
    const validation = validateTileflowMapStyleInputs(input);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.match(validation.error, /config cannot be combined/);
      assert.match(validation.error, new RegExp(conflict));
    }
  }
});

test('rejects ambiguous explicit sources and dependent options without their owner', () => {
  const cases = [
    [{style, styleUrl: 'https://api.example.test/style.json'}, /mutually exclusive/],
    [{map: 'madrid', style, styleBaseUrl: '/tileflow'}, /mutually exclusive/],
    [{styleBaseUrl: '/tileflow'}, /requires map/],
    [{themes: {}}, /requires config/],
  ] as const;

  for (const [input, expected] of cases) {
    const validation = validateTileflowMapStyleInputs(input);
    assert.equal(validation.ok, false);
    if (!validation.ok) assert.match(validation.error, expected);
  }
});

test('the runtime assertion throws TypeError for JavaScript and any callers', () => {
  assert.throws(
    () => assertTileflowMapStyleInputs({config: {}, map: 'madrid'}),
    (error: unknown) =>
      error instanceof TypeError && /Invalid Tileflow <Map> style inputs/.test(error.message),
  );
});
