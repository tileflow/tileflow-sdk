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
import {streetsRoadCasingProfiles} from '../src/official/streets-road-colors';
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
  test(`Streets ${theme} compiles authored borders and keeps the HD zoom handoff`, () => {
    const measured = reference.profiles[profile as keyof typeof themes].roles;
    let expected =
      theme === 'light'
        ? {
            generic: {unshadowedRGB: [141, 176, 188]},
            motorway: {unshadowedRGB: [117, 154, 166]},
            trunk: {unshadowedRGB: [98, 147, 163]},
            hd: {unshadowedRGB: [138, 167, 176]},
            path: {unshadowedRGB: [201, 201, 193]},
          }
        : measured;
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    for (const [role, value] of Object.entries(
      streetsRoadCasingProfiles[profile as keyof typeof themes],
    ))
      closeColor(
        value,
        measured[role as keyof typeof measured].unshadowedRGB,
        `${profile} reference ${role}`,
      );
    if (/^(?:dawn|dusk|dark)(?:-|$)/.test(theme)) {
      const sample = (role: string) => {
        const color = Color.parse(colors[role])!;
        return {unshadowedRGB: [color.r * 255, color.g * 255, color.b * 255]};
      };
      expected = {
        generic: sample('roads.default.casing'),
        motorway: sample('roads.motorway.casing'),
        trunk: sample('roads.trunk.casing'),
        hd: sample('roads.detail.casing'),
        path: sample('roads.path.casing'),
      };
    }
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
    const casing = (structure: string, roadClass: string, zoom: number, type?: string) => {
      const properties = {class: roadClass, structure, ...(type ? {type} : {})};
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
        'street',
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
      for (const [roadClass, type] of [
        ['path', 'path'],
        ['path', 'footway'],
        ['path', 'cycleway'],
        ['pedestrian', undefined],
        ['path', 'steps'],
      ] as const) {
        closeColor(
          casing(structure, roadClass, 18, type),
          expected.path.unshadowedRGB,
          `${theme} ${structure} ${type ?? roadClass}`,
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
