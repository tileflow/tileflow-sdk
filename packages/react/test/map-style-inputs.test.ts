import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTileflowMapStyleInputs,
  validateTileflowMapStyleInputs,
} from '../src/map-style-inputs';

const style = {layers: [], sources: {}, version: 8};

test('accepts both documented discriminated sources', () => {
  for (const source of [
    {kind: 'tileflow', map: 'madrid'},
    {kind: 'tileflow', manifestUrl: '/custom/manifest.json', map: 'madrid'},
    {kind: 'maplibre', style},
    {kind: 'maplibre', style: 'https://api.example.test/style.json'},
  ]) {
    assert.deepEqual(validateTileflowMapStyleInputs({source}), {ok: true});
  }
});

test('rejects missing and malformed sources for JavaScript callers', () => {
  for (const source of [
    undefined,
    {},
    {kind: 'tileflow'},
    {kind: 'maplibre'},
    {kind: 'config', config: {}},
  ]) {
    const validation = validateTileflowMapStyleInputs({source});
    assert.equal(validation.ok, false);
  }

  assert.throws(
    () => assertTileflowMapStyleInputs({}),
    (error: unknown) =>
      error instanceof TypeError && /Invalid Tileflow <Map> source/.test(error.message),
  );
});
