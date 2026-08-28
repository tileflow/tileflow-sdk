import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {addresses, createStyle, fixed, labels, landforms, openMapTiles, vectorTiles} from '../src';
import {extendStreets} from './map-fixture';

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

const compileTestMap = (design: Parameters<typeof extendStreets>[0] = {}) =>
  createStyle(extendStreets(design), {preparedAssets: streetsPreparedAssets});

test('default semantic modules render standard house numbers and named landforms', () => {
  const style = compileTestMap();
  const address = style.layers.find(({id}) => id === 'tileflow-addresses-labels');
  const peak = style.layers.find(({id}) => id === 'tileflow-landforms');
  const modules = style.metadata?.['tileflow:modules'] as string[];

  assert.equal(address?.['source-layer'], 'housenumber');
  assert.equal(peak?.['source-layer'], 'mountain_peak');
  assert.ok(modules.includes('addresses'));
  assert.ok(modules.includes('landforms'));
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('address, landform, language, capital, and elevation bindings are remappable', () => {
  const style = compileTestMap({
    data: vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          capital: 'is_capital',
          class: 'kind',
          elevation: 'height_m',
          houseNumber: 'street_no',
          iata: 'airport_code',
          icao: 'icao_code',
          name: 'local_label',
          nameEnglish: 'english_label',
          rank: 'importance',
        },
        layers: {houseNumber: 'address_points', mountainPeak: 'named_relief'},
      }),
      url: '/tiles.json',
    }),
    modules: {labels: labels({aerodromeCodes: 'all', language: 'en'})},
  });
  const address = style.layers.find(({id}) => id === 'tileflow-addresses-labels');
  const peak = style.layers.find(({id}) => id === 'tileflow-landforms');
  const city = style.layers.find(({id}) => id === 'tileflow-label-place-city');
  const aerodrome = style.layers.find(({id}) => id === 'tileflow-label-aerodrome');

  assert.equal(address?.['source-layer'], 'address_points');
  assert.match(JSON.stringify(address), /street_no/);
  assert.equal(peak?.['source-layer'], 'named_relief');
  assert.match(JSON.stringify(peak), /english_label/);
  assert.match(JSON.stringify(peak), /height_m/);
  assert.match(JSON.stringify(peak), /importance/);
  assert.match(JSON.stringify(city), /is_capital/);
  assert.match(JSON.stringify(aerodrome), /airport_code/);
  assert.match(JSON.stringify(aerodrome), /icao_code/);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('new semantic modules can be styled or disabled without raw layer IDs', () => {
  const style = compileTestMap({
    modules: {
      addresses: addresses({
        labels: {
          minZoom: 18,
          text: {color: fixed('#334455', {reason: 'Exact fixture override.'})},
        },
      }),
      landforms: landforms({
        classes: {
          cliff: {visible: false},
          peak: {text: {color: fixed('#553311', {reason: 'Exact fixture override.'})}},
        },
        elevation: false,
      }),
    },
  });
  const address = style.layers.find(({id}) => id === 'tileflow-addresses-labels');
  const peak = style.layers.find(({id}) => id === 'tileflow-landform-peak');

  assert.equal(address?.minzoom, 18);
  assert.equal((address?.paint as Record<string, unknown>)['text-color'], '#334455');
  assert.equal(
    style.layers.some(({id}) => id === 'tileflow-landform-cliff'),
    false,
  );
  assert.doesNotMatch(JSON.stringify(peak), /elevation|ele|height_m/);
  assert.deepEqual(validateStyleMin(style as never), []);
});
