import {Color, createPropertyExpression, latest} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildings,
  createStyle,
  createStyleResult,
  defineMap,
  defineTheme,
  disable,
  labels,
  poi,
  roads,
  tileflowAuthoringManifest,
  tileflowRequiredThemeColorRoles,
} from '../src';
import {extendStreets, testLightTheme} from './map-fixture';

test('explains actual color derivations and default policies without changing Style JSON', () => {
  const map = extendStreets({modules: {poi: disable()}});
  const result = createStyleResult(map, {inspection: true});
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  assert.deepEqual(result.style, createStyle(map));
  const decisions = result.report.decisions!;
  assert.equal(new Set(decisions.map(({path}) => path)).size, decisions.length);
  const wood = decisions.find(({path}) => path.endsWith('tokens.color.landcover.wood'))!;
  assert.equal(wood.source, 'derived');
  const woodLayerId = result.report.provenance!.layers.find(({contributions}) =>
    contributions.some(({target}) => target === 'land.landcover.wood.fill'),
  )!.id;
  const paint = result.style.layers.find(({id}) => id === woodLayerId)!.paint!;
  const color = createPropertyExpression(paint['fill-color'], latest.paint_fill['fill-color']);
  assert.equal(color.result, 'success');
  if (color.result === 'success') {
    assert.equal(
      String(Color.parse(String(wood.value))),
      String(color.value.evaluate({zoom: 17}, {type: 3, properties: {class: 'wood'}} as never)),
    );
  }
  assert.match(wood.override, /tokens.color\["landcover.wood"\]/u);
  const radius = decisions.find(({path}) => path.endsWith('threeDimensional.edgeRadius'))!;
  assert.equal(radius.source, 'default');
  assert.equal(radius.value, 0.8);
  assert.equal(
    decisions.find(({path}) => path.endsWith('labels.roadPlacement'))?.value,
    'foreground',
  );
  assert.equal(
    JSON.stringify(result.style).includes('color-roles-and-selected-module-policies'),
    false,
  );
});

test('reports explicit and inherited opt-outs, and lets a theme replace a derived color', () => {
  const theme = defineTheme(testLightTheme, {
    id: 'graphic',
    version: 1,
    colorScheme: 'light',
    tokens: {color: {'landcover.wood': '#FF0077'}},
  });
  const base = extendStreets({
    themes: {graphic: theme},
    defaultTheme: 'graphic',
    modules: {
      poi: disable(),
      roads: roads({rampOrder: 'by-class'}),
      labels: labels({roadPlacement: 'ground'}),
      buildings: buildings({threeDimensional: {edgeRadius: 0, shadows: false, occlusion: false}}),
    },
  });
  const map = defineMap({id: 'graphic-child', version: 1, extends: base});
  const result = createStyleResult(map);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  const decisions = result.report.decisions!;
  for (const [path, value] of [
    ['modules.roads.rampOrder', 'by-class'],
    ['modules.labels.roadPlacement', 'ground'],
    ['modules.buildings.threeDimensional.edgeRadius', 0],
    ['modules.buildings.threeDimensional.shadows', false],
    ['modules.buildings.threeDimensional.occlusion', false],
  ] as const) {
    const decision = decisions.find((entry) => entry.path === path)!;
    assert.equal(decision.source, 'map');
    assert.equal(decision.value, value);
  }
  const wood = decisions.find(({path}) => path.endsWith('tokens.color.landcover.wood'))!;
  assert.equal(wood.source, 'theme');
  assert.equal(wood.value, '#FF0077');
});

test('omits policies for disabled modules and publishes the exact minimal palette contract', () => {
  const result = createStyleResult(
    extendStreets({
      modules: {
        poi: disable(),
        roads: disable(),
        labels: disable(),
        buildings: disable(),
      },
    }),
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  assert.ok(result.report.decisions!.every(({path}) => path.startsWith('themes.')));
  assert.deepEqual(
    tileflowAuthoringManifest.themes.requiredColorRoles,
    tileflowRequiredThemeColorRoles,
  );
  assert.equal(tileflowRequiredThemeColorRoles.length, 12);
  for (const role of tileflowRequiredThemeColorRoles)
    assert.ok(role in testLightTheme.tokens.color);
});

test('POI decisions describe compiled defaults and explicit independent placement', () => {
  for (const independent of [false, true]) {
    const map = extendStreets({
      modules: {
        poi: poi({
          categories: ['food-drink'],
          ...(independent ? {density: 4, placement: {coupleIconAndLabel: false}} : {}),
        }),
      },
    });
    const result = createStyleResult(map, {
      preparedAssets: {icons: {ids: ['food'], sprite: '/tileflow/test/sprite'}},
    });
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    if (!result.ok) continue;
    const coupling = result.report.decisions!.find(
      ({path}) => path === 'modules.poi.placement.coupleIconAndLabel',
    )!;
    assert.equal(coupling.source, independent ? 'map' : 'default');
    assert.equal(coupling.value, !independent);
    const layer = result.style.layers.find(
      ({id}) => id === (independent ? 'tileflow-poi-label' : 'tileflow-poi'),
    )!;
    assert.ok(layer);
    assert.equal(layer.layout?.['text-optional'], independent);
    const density = result.report.decisions!.find(({path}) => path === 'modules.poi.density')!;
    assert.equal(density.value, independent ? 4 : 2);
  }
});
