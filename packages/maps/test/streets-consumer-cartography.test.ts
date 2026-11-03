import {Color, createPropertyExpression, latest} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, defineMap} from '@tileflow/core';
import {streets} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  models: streetsPreparedModels,
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/sprite',
  },
};
const consumer = defineMap({id: 'streets-consumer', version: 1, extends: streets});

test('a consumer inherits the reviewed day palette and building contours without a style patch', () => {
  const style = createStyle(consumer, {theme: 'light', preparedAssets});
  const direct = createStyle(streets, {theme: 'light', preparedAssets});
  assert.deepEqual(style.layers, direct.layers);
  const color = (id: string, zoom: number, properties: Record<string, unknown> = {}) => {
    const layer = style.layers.find((entry) => entry.id === id);
    assert.ok(layer?.type === 'line');
    const result = createPropertyExpression(
      layer.paint?.['line-color'],
      latest.paint_line['line-color'],
    );
    assert.equal(result.result, 'success');
    if (result.result !== 'success') throw new Error('Invalid line color');
    return result.value.evaluate({zoom}, {type: 2, properties});
  };
  assert.deepEqual(
    color('tileflow-road-surface-motorway-fill', 16, {class: 'motorway'}),
    Color.parse('#A4BCC4'),
  );
  assert.deepEqual(
    color('tileflow-road-surface-secondary-fill', 16, {class: 'secondary'}),
    Color.parse('#B9CED5'),
  );
  assert.deepEqual(color('tileflow-road-surface-minor-casing', 16), Color.parse('#8AA7B0'));
  for (const building_tone of ['neutral', 'commercial'])
    assert.deepEqual(
      color('tileflow-buildings-fill-outline', 18, {building_tone}),
      Color.parse('#B9BFBA'),
    );
  const outline = style.layers.find((entry) => entry.id === 'tileflow-buildings-fill-outline');
  assert.ok(outline?.type === 'line');
  assert.equal(outline.minzoom, 16);
  assert.deepEqual(outline.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    0.35,
    16.5,
    0.5,
    18,
    0.65,
    20,
    0.8,
  ]);
  assert.deepEqual(outline.paint?.['line-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    16,
    0,
    16.5,
    0.4,
    18,
    0.58,
    20,
    0.68,
  ]);
});

test('regenerating inherited Streets preserves each overview background and shield spacing', () => {
  const backgrounds = {
    light: ['#F8F7F3', '#F5F0E5'],
    dawn: ['#FCDFC7', '#FBE2CE'],
    dusk: ['#565263', '#454053'],
    dark: ['#3F4354', '#2B2F43'],
    faded: ['#F8F6F5', '#F8F6F6'],
    monochrome: ['#FFFFFF', '#FFFFFF'],
    'dawn-faded': ['#FFEFDD', '#FEF1E1'],
    'dawn-monochrome': ['#F1F1F1', '#F3F3F3'],
    'dusk-faded': ['#6B6E80', '#5C5F72'],
    'dusk-monochrome': ['#5D5D5D', '#545454'],
    'dark-faded': ['#565C72', '#444B63'],
    'dark-monochrome': ['#323232', '#262626'],
  };
  for (const [theme, [overview, detail]] of Object.entries(backgrounds)) {
    const style = createStyle(consumer, {theme, preparedAssets});
    const background = style.layers.find((entry) => entry.type === 'background');
    assert.ok(background?.type === 'background');
    const result = createPropertyExpression(
      background.paint?.['background-color'],
      latest.paint_background['background-color'],
    );
    assert.equal(result.result, 'success');
    if (result.result !== 'success') throw new Error('Invalid background');
    assert.deepEqual(result.value.evaluate({zoom: 8}), Color.parse(overview), theme);
    assert.deepEqual(result.value.evaluate({zoom: 14}), Color.parse(detail), theme);
    assert.deepEqual(
      result.value.evaluate({zoom: 13}),
      Color.parse(theme === 'light' ? detail : overview),
      theme,
    );
    const shield = style.layers.find((entry) => entry.id === 'tileflow-label-road-shield-detail');
    assert.ok(shield?.type === 'symbol');
    assert.deepEqual(
      shield.layout?.['symbol-spacing'],
      [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        theme === 'light' ? 420 : 220,
        13,
        theme === 'light' ? 480 : 300,
        14,
        600,
      ],
      theme,
    );
  }
});
