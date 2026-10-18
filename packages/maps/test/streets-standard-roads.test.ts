import {
  Color,
  createPropertyExpression,
  featureFilter,
  type LineLayerSpecification,
  latest as styleSpec,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {resolveTileflowTheme} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';
import {standardRoadReference as reference} from './streets-standard-road-fixture';

const themes = {
  'default-dawn': 'dawn',
  'default-day': 'light',
  'default-dusk': 'dusk',
  'default-night': 'dark',
  'faded-dawn': 'dawn-faded',
  'faded-day': 'faded',
  'faded-dusk': 'dusk-faded',
  'faded-night': 'dark-faded',
  'monochrome-dawn': 'dawn-monochrome',
  'monochrome-day': 'monochrome',
  'monochrome-dusk': 'dusk-monochrome',
  'monochrome-night': 'dark-monochrome',
} as const;

const ids = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));

function closeColor(actual: unknown, expected: readonly number[], context: string) {
  const color = typeof actual === 'string' ? Color.parse(actual) : actual;
  assert.ok(color instanceof Color, `${context}: expected a color`);
  assert.equal(color.a, 1, `${context}: casing opacity is handled separately`);
  for (const [index, channel] of (['r', 'g', 'b'] as const).entries()) {
    assert.ok(
      Math.abs(color[channel] * 255 - expected[index]!) <= 0.501,
      `${context}: ${color.toString()} must match the independently lit reference`,
    );
  }
}

function lineColor(
  layer: LineLayerSpecification,
  zoom: number,
  properties: Record<string, unknown>,
) {
  const result = createPropertyExpression(
    layer.paint?.['line-color'],
    styleSpec.paint_line['line-color'],
  );
  assert.equal(result.result, 'success', `${layer.id}: color expression must validate`);
  if (result.result !== 'success') throw new Error('Invalid line color');
  return result.value.evaluate({zoom}, {type: 2, properties});
}

for (const [profile, theme] of Object.entries(themes)) {
  test(`Streets ${theme} matches independently lit borders and keeps the HD zoom handoff`, () => {
    const expected = reference.profiles[profile as keyof typeof themes].roles;
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    for (const [token, role] of [
      ['roads.default.casing', 'generic'],
      ['roads.city.casing', 'generic'],
      ['roads.city.tunnelCasing', 'generic'],
      ['roads.motorway.casing', 'motorway'],
      ['roads.trunk.casing', 'trunk'],
      ['roads.detail.casing', 'hd'],
      ['roads.path.casing', 'path'],
    ] as const) {
      closeColor(colors[token], expected[role].unshadowedRGB, `${theme} ${token}`);
    }
    const {style, inspection} = createStyleWithInspection(streets, {
      theme,
      preparedAssets: {models: streetsPreparedModels, icons: {ids, sprite: '/test/sprite'}},
    });
    const casing = (structure: string, roadClass: string, zoom: number, subclass?: string) => {
      const properties = {class: roadClass, brunnel: structure, ...(subclass ? {subclass} : {})};
      const layers = style.layers.filter(
        (layer): layer is LineLayerSpecification =>
          layer.type === 'line' &&
          layer.id.startsWith(`tileflow-road-${structure}-`) &&
          layer.id.endsWith('-casing') &&
          (layer.minzoom ?? 0) <= zoom &&
          (layer.maxzoom ?? 24) > zoom &&
          featureFilter(layer.filter).filter({zoom}, {type: 2, properties}),
      );
      assert.equal(layers.length, 1, `${theme} ${structure} ${roadClass} at z${zoom}`);
      return lineColor(layers[0]!, zoom, properties);
    };
    for (const structure of ['surface', 'bridge', 'tunnel']) {
      for (const roadClass of [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'minor',
        'service',
        'track',
      ]) {
        for (const zoom of [18, 23.9]) {
          closeColor(
            casing(structure, roadClass, zoom),
            expected.hd.unshadowedRGB,
            `${theme} ${structure} ${roadClass} z${zoom}`,
          );
        }
      }
      for (const subclass of ['path', 'footway', 'cycleway', 'pedestrian', 'steps']) {
        closeColor(
          casing(structure, 'path', 18, subclass),
          expected.path.unshadowedRGB,
          `${theme} ${structure} ${subclass}`,
        );
      }
    }
    for (const roadClass of ['motorway', 'trunk', 'primary'] as const) {
      const role = roadClass === 'primary' ? 'generic' : roadClass;
      for (const zoom of [14.5, 14.99]) {
        closeColor(
          casing('tunnel', roadClass, zoom),
          expected[role].unshadowedRGB,
          `${theme} ${roadClass} below HD`,
        );
      }
      closeColor(
        casing('tunnel', roadClass, 15),
        expected.hd.unshadowedRGB,
        `${theme} ${roadClass} HD starts at z15`,
      );
    }
    const roundabout = style.layers.find((layer) => layer.id === 'tileflow-road-circular-casing');
    assert.ok(roundabout?.type === 'circle');
    closeColor(
      roundabout.paint?.['circle-stroke-color'],
      expected.hd.unshadowedRGB,
      `${theme} roundabout border`,
    );
    for (const phase of ['fill', 'casing'] as const) {
      const target = `roads.roundabouts.${phase}`;
      const diagnostic = inspection.layers.find(({contributions}) =>
        contributions.some((contribution) => contribution.target === target),
      );
      const layer = style.layers.find(({id}) => id === diagnostic?.id);
      assert.ok(layer?.type === 'circle');
      const radius = createPropertyExpression(
        layer.paint?.['circle-radius'],
        styleSpec.paint_circle['circle-radius'],
      );
      const width = createPropertyExpression(
        layer.paint?.['circle-stroke-width'],
        styleSpec.paint_circle['circle-stroke-width'],
      );
      assert.equal(radius.result, 'success');
      assert.equal(width.result, 'success');
      if (radius.result !== 'success' || width.result !== 'success')
        throw new Error('Invalid ring geometry');
      const border = phase === 'casing' ? 0.5 : 0;
      const fallbackWidthAt = (level: number) =>
        3 * (1 + ((1.35 ** (level - 15) - 1) / (1.35 ** 7 - 1)) * 1.2);
      for (let level = 15; level <= 24; level += 0.25) {
        const metric = {
          type: 1,
          properties: {
            class: 'minor',
            radius_px_z15: 10.458,
            radius_m: 18.9,
            inner_radius_m: 16.2,
            outer_radius_m: 21,
          },
        };
        const scale =
          (metric.properties.radius_px_z15 * 2 ** (level - 15)) / metric.properties.radius_m;
        const inner = radius.value.evaluate({zoom: level}, metric as never);
        const stroke = width.value.evaluate({zoom: level}, metric as never);
        assert.ok(
          Math.abs(inner - (16.2 * scale - border)) < 1e-8,
          `${theme} ${phase} metric inner z${level}`,
        );
        assert.ok(
          Math.abs(inner + stroke - (21 * scale + border)) < 1e-8,
          `${theme} ${phase} metric outer z${level}`,
        );
        const fallback = {type: 1, properties: {class: 'minor', radius_px_z15: 20}};
        const lower = Math.floor(level);
        const widthAtLower = fallbackWidthAt(lower);
        const fallbackWidth =
          widthAtLower +
          (fallbackWidthAt(Math.min(24, lower + 1)) - widthAtLower) * (2 ** (level - lower) - 1);
        assert.ok(
          Math.abs(
            width.value.evaluate({zoom: level}, fallback as never) - fallbackWidth - border * 2,
          ) < 1e-8,
          `${theme} ${phase} fallback width z${level}`,
        );
        assert.ok(
          Math.abs(
            radius.value.evaluate({zoom: level}, fallback as never) -
              (20 * 2 ** (level - 15) - fallbackWidth / 2 - border),
          ) < 1e-8,
          `${theme} ${phase} fallback radius z${level}`,
        );
      }
    }
    for (const structure of ['surface', 'bridge', 'tunnel']) {
      const targetPrefix =
        /^roads\.classes\.(motorway|trunk|primary|secondary|tertiary|minor|service|track)\./u;
      const indices = (phase: 'fill' | 'rampFill') =>
        inspection.layers
          .filter(({contributions}) =>
            contributions.some(
              ({target}) => targetPrefix.test(target) && target.endsWith(`.${structure}.${phase}`),
            ),
          )
          .map(({index}) => index);
      const ramps = indices('rampFill');
      const receivers = indices('fill');
      assert.ok(
        ramps.length && receivers.length,
        `${theme} ${structure} public road targets exist`,
      );
      assert.ok(
        Math.max(...ramps) < Math.min(...receivers),
        `${theme} ${structure} links precede their receiving carriageways`,
      );
    }
  });
}
