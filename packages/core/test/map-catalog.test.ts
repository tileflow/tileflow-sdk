import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle} from '../src';
import {createManifest, createStyleFromCatalog} from '../src/build';
import {extendStreets} from './map-fixture';

const main = extendStreets({id: 'main'});
const project = {maps: {main}};
const streetsPreparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

test('compiles maps through the internal build catalog API', () => {
  const style = createStyle(main, {preparedAssets: streetsPreparedAssets});

  assert.equal(style.metadata?.['tileflow:map'], 'main');
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
  assert.deepEqual(
    createStyleFromCatalog(project, 'main', {preparedAssets: streetsPreparedAssets}),
    style,
  );
  assert.throws(() => createStyleFromCatalog(project, 'constructor' as never), /Unknown/);
});

test('creates manifest schema 3 without tile data plumbing', () => {
  assert.deepEqual(createManifest(project, {styleBaseUrl: 'https://styles.example/'}), {
    kind: 'self-hosted',
    version: 3,
    maps: {main: 'https://styles.example/styles/main.json'},
    styles: {main: 'https://styles.example/styles/main.json'},
  });
});

test('pure core compilation accepts only icon-directory arrays', () => {
  assert.throws(
    () => createStyle(extendStreets({icons: {builtin: 'cyberpunk'} as never})),
    /icons must be an array|Expected an array/u,
  );
  assert.throws(
    () => createStyle(extendStreets({icons: {source: './icons'} as never})),
    /icons must be an array|Expected an array/u,
  );
  assert.throws(
    () => createStyle(extendStreets({icons: './icons' as never})),
    /icons must be an array|Expected an array/u,
  );
});
