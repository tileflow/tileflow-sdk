import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {addLayer, createStreetsStyle, patchLayer, streets, water} from '../src';

test('raw patches remain final, valid, and free of internal provenance metadata', () => {
  const style = createStreetsStyle({
    basemap: streets(),
    overrides: [
      patchLayer('streets-landcover-wood', {
        paint: {'fill-translate': [1, 1]},
      }),
    ],
  });
  const layer = style.layers.find(({id}) => id === 'streets-landcover-wood');

  assert.deepEqual((layer?.paint as Record<string, unknown>)['fill-translate'], [1, 1]);
  assert.equal(
    (layer?.metadata as Record<string, unknown> | undefined)?.['tileflow:rawOverride'],
    undefined,
  );
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('optimizer-generated IDs cannot collide with raw layers', () => {
  const style = createStreetsStyle({
    basemap: streets(),
    overrides: [
      addLayer(
        {id: 'streets-landcover', type: 'background', paint: {'background-color': '#fff'}},
        {after: 'streets-background'},
      ),
    ],
  });

  assert.equal(style.layers.filter(({id}) => id === 'streets-landcover').length, 1);
  assert.equal(new Set(style.layers.map(({id}) => id)).size, style.layers.length);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('compiled style rejects inverted raw zoom ranges', () => {
  assert.throws(
    () =>
      createStreetsStyle({
        basemap: streets(),
        overrides: [patchLayer('streets-water', {minzoom: 20, maxzoom: 10})],
      }),
    /requires minzoom <= maxzoom/,
  );
});

test('style metadata lists only enabled modules', () => {
  const style = createStreetsStyle({
    basemap: streets(),
    modules: {water: water({enabled: false})},
  });

  assert.equal((style.metadata?.['tileflow:modules'] as string[]).includes('water'), false);
});
