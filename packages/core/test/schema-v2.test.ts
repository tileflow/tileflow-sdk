import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTileflowMap, parseTileflowProject, roads, streets, validateConfig} from '../src';

test('accepts the canonical Streets project shape', () => {
  const project = {
    maps: {
      madrid: {
        basemap: streets(),
        modules: {roads: roads({hierarchy: 'strong'})},
      },
    },
  };

  assert.deepEqual(parseTileflowProject(project), project);
  assert.deepEqual(validateConfig(project), {valid: true, messages: []});
});

test('rejects every removed renderer and data path with its exact location', () => {
  const removed = [
    [{renderer: 'generated'}, 'renderer'],
    [{tileset: 'world'}, 'tileset'],
    [{tiles: ['https://tiles.example/{z}/{x}/{y}.pbf']}, 'tiles'],
    [{colors: {water: '#fff'}}, 'colors'],
    [{roads: 'standard'}, 'roads'],
  ] as const;

  for (const [legacy, path] of removed) {
    const result = validateConfig({basemap: streets(), ...legacy});
    assert.equal(result.valid, false);
    assert.ok(
      result.messages.some((message) => message.path === path),
      JSON.stringify(result),
    );
  }
});

test('requires streets() and keyed modules', () => {
  assert.throws(() => parseTileflowMap({}), /basemap/);
  assert.throws(
    () => parseTileflowMap({basemap: {type: 'osm'}, modules: []}),
    /basemap\.type|modules/,
  );
  assert.throws(() => parseTileflowMap({basemap: streets(), modules: [roads()]}), /modules/);
});

test('rejects unknown semantic controls instead of ignoring them', () => {
  assert.throws(
    () =>
      parseTileflowMap({
        basemap: streets(),
        modules: {roads: {...roads(), magicWidth: 12}},
      }),
    /modules\.roads/,
  );
});

test('rejects unsafe and unresolved project references', () => {
  assert.throws(
    () => parseTileflowProject({maps: {madrid: {basemap: streets(), theme: 'missing'}}}),
    /maps\.madrid\.theme/,
  );
  assert.throws(
    () => parseTileflowProject(Object.create({maps: {madrid: {basemap: streets()}}})),
    /inherited properties/,
  );
});
