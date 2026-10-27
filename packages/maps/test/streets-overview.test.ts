import {
  Color,
  createPropertyExpression,
  featureFilter,
  latest,
  type LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const ids = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));

function roadLayers(theme: string) {
  return createStyle(streets, {
    theme,
    preparedAssets: {models: streetsPreparedModels, icons: {ids, sprite: '/test/sprite'}},
  }).layers.filter(
    (layer): layer is LineLayerSpecification =>
      layer.type === 'line' &&
      layer.id.startsWith('tileflow-road-') &&
      /-(fill|rampFill)$/.test(layer.id),
  );
}

function paint(
  layer: LineLayerSpecification,
  key: keyof typeof latest.paint_line,
  zoom: number,
  properties: Record<string, unknown>,
) {
  const result = createPropertyExpression(layer.paint?.[key], latest.paint_line[key]);
  assert.equal(result.result, 'success');
  if (result.result !== 'success') throw new Error('Invalid road paint');
  return result.value.evaluate({zoom}, {type: 2, properties});
}

test('overview routes stay continuous across structures and have exactly one fill at the handoff', () => {
  const starts = {
    motorway: 3,
    trunk: 3,
    primary: 6,
    secondary: 8,
    tertiary: 8,
    minor: 12,
    residential: 12,
    unclassified: 12,
  };
  for (const theme of Object.keys(streetsThemes)) {
    const layers = roadLayers(theme).map((layer) => ({
      layer,
      accepts: featureFilter(layer.filter).filter,
    }));
    for (const [roadClass, start] of Object.entries(starts)) {
      const hasLinks = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(
        roadClass,
      );
      for (const ramp of hasLinks ? [0, 1] : [0]) {
        for (const brunnel of ['none', 'bridge', 'tunnel']) {
          const properties = {class: roadClass, brunnel, ramp};
          for (const zoom of [3.5, 4.99, 5, 5.01, 6, 8, 11.99, 12, 12.99, 13, 13.01, 14.99, 15]) {
            const active = layers.filter(
              ({layer, accepts}) =>
                zoom >= (layer.minzoom ?? 0) &&
                zoom < (layer.maxzoom ?? 24) &&
                accepts({zoom}, {type: 2, properties}),
            );
            const expected = zoom >= Math.max(start, ramp ? 12 : 0) ? 1 : 0;
            assert.equal(
              active.length,
              expected,
              `${theme} ${roadClass} ${brunnel} ramp=${ramp} z${zoom}`,
            );
            for (const {layer} of active) {
              assert.ok(paint(layer, 'line-width', zoom, properties) > 0);
              assert.ok(paint(layer, 'line-opacity', zoom, properties) > 0);
            }
          }
        }
      }
    }
  }
});

test('day overviews separate avenues from highways without erasing the local grid', () => {
  const layers = roadLayers('light');
  const surface = (roadClass: string) => {
    const layer = layers.find((l) => l.id === `tileflow-road-surface-${roadClass}-fill`);
    assert.ok(layer);
    return layer;
  };
  const width = (roadClass: string, zoom: number) =>
    Number(paint(surface(roadClass), 'line-width', zoom, {class: roadClass}));
  for (const zoom of [12, 13, 14]) {
    assert.ok(width('primary', zoom) < width('motorway', zoom) * 0.75);
    assert.ok(width('secondary', zoom) < width('primary', zoom));
    assert.ok(width('tertiary', zoom) < width('secondary', zoom));
    assert.ok(width('minor', zoom) >= 0.7);
    assert.ok(width('minor', zoom) < width('tertiary', zoom));
  }
  for (const roadClass of ['primary', 'secondary', 'tertiary', 'minor']) {
    const layer = surface(roadClass);
    for (const ramp of [0, 1]) {
      const candidate = ramp
        ? layers.find((l) => l.id === `tileflow-road-surface-${roadClass}-rampFill`)
        : layer;
      assert.ok(candidate);
      for (const zoom of [12, 12.5, 13]) {
        const paved = paint(candidate, 'line-color', zoom, {
          class: roadClass,
          ramp,
          surface: 'paved',
        });
        const unpaved = paint(candidate, 'line-color', zoom, {
          class: roadClass,
          ramp,
          surface: 'unpaved',
        });
        assert.deepEqual(
          unpaved,
          paved,
          `${roadClass} ramp=${ramp} must retain its city hierarchy`,
        );
      }
    }
    if (roadClass !== 'minor') {
      const regional = paint(layer, 'line-color', 10, {class: roadClass}) as Color;
      const city = paint(layer, 'line-color', 12, {class: roadClass}) as Color;
      assert.ok(
        regional.r + regional.g + regional.b < city.r + city.g + city.b,
        `${roadClass}: regional links need more contrast than the city texture`,
      );
    }
  }
});
