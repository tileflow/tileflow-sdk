import {createPropertyExpression, latest, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyleWithInspection} from '@tileflow/core/build';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const ids = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));

for (const theme of Object.keys(streetsThemes)) {
  test(`Streets ${theme} resolves network symbols without leaking into unrelated POIs`, () => {
    const {style} = createStyleWithInspection(streets, {
      theme,
      preparedAssets: {models: streetsPreparedModels, icons: {ids, sprite: '/test/sprite'}},
    });
    assert.deepEqual(validateStyleMin(style as never), []);
    for (const id of ['tileflow-poi', 'tileflow-poi-prominent']) {
      const layer = style.layers.find((layer) => layer.id === id);
      assert.ok(layer?.type === 'symbol');
      const image = createPropertyExpression(
        layer.layout?.['icon-image'],
        latest.layout_symbol['icon-image'],
      );
      assert.equal(image.result, 'success');
      if (image.result !== 'success') throw new Error('Invalid icon expression');
      const evaluate = (properties: Record<string, string>) =>
        String(image.value.evaluate({zoom: 18}, {type: 1, properties}));
      for (const [network, symbol, mode] of [
        ['Metro de Madrid', 'transit-madrid-metro', 'subway'],
        ['Cercanías Madrid', 'transit-madrid-cercanias', 'train'],
        ['EMT Madrid', 'transit-madrid-emt', 'bus'],
      ]) {
        // The pinned World release carries network even where mode is absent.
        assert.equal(evaluate({category: 'transport', network: network!}), symbol);
        assert.equal(evaluate({category: 'transport', network: network!, mode: mode!}), symbol);
      }
      const generic = {category: 'transport', mode: 'subway', type: 'public_transit_facility'};
      for (const network of ['Metro de Barcelona', 'Metro', 'EMT', 'Cercanías Málaga', '']) {
        assert.equal(evaluate({...generic, network}), evaluate(generic));
      }
      assert.equal(evaluate({...generic, name: 'Metro de Madrid'}), evaluate(generic));
      const cafe = {category: 'food-drink', type: 'cafe'};
      assert.equal(evaluate({...cafe, network: 'Metro de Madrid'}), evaluate(cafe));
    }
  });
}
