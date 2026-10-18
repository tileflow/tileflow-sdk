import {
  createPropertyExpression,
  featureFilter,
  latest,
  type LineLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createStyle,
  readTileflowBuildings3D,
  readTileflowStreetLights,
  readTileflowSunPreset,
  readTileflowVegetation3D,
  readTileflowVegetationDisplay,
  resolveTileflowTheme,
  resolveTileflowVegetationRepresentation,
} from '@tileflow/core';
import {map1777} from '../src';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/map-1777/icons/', import.meta.url)).map((file) =>
      file.replace(/(?:\.pattern)?\.svg$/, ''),
    ),
    sprite: '/test/map-1777/sprite',
  },
};
const style = createStyle(map1777, {preparedAssets});

test('1777 offers only Default with four complete time-of-day palettes', () => {
  assert.deepEqual(Object.keys(map1777.themes!).sort(), ['dark', 'dawn', 'dusk', 'light']);
  assert.deepEqual(map1777.timeOfDay, {
    light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'},
  });
  assert.deepEqual(map1777.systemThemes, {light: 'light', dark: 'dark'});
  const skies = new Set();
  const papers = new Set();
  for (const moment of ['dawn', 'day', 'dusk', 'night'] as const) {
    const concrete = map1777.timeOfDay!.light[moment]!;
    const selected = createStyle(map1777, {theme: 'light', timeOfDay: moment, preparedAssets});
    assert.deepEqual(selected, createStyle(map1777, {theme: concrete, preparedAssets}));
    const theme = resolveTileflowTheme(map1777.themes![concrete]);
    const sun = readTileflowSunPreset(selected.metadata)!;
    skies.add(`${sun.azimuth}/${sun.altitude}`);
    papers.add(theme.tokens.color['surface.background']);
    assert.deepEqual(selected.light?.position, [1.15, sun.azimuth, 90 - sun.altitude]);
    assert.equal(selected.light?.anchor, 'map');
    assert.ok(sun.shadowIntensity > 0 && sun.altitude > 0);
    const buildings = readTileflowBuildings3D(selected.metadata)!;
    assert.equal(buildings.color, theme.tokens.color['buildings.fill']);
    assert.equal(buildings.shadows, true);
    assert.equal(buildings.occlusion, true);
    assert.equal(buildings.windows, false);
    assert.equal(buildings.nightLight, 0);
    assert.equal(readTileflowStreetLights(selected.metadata), undefined);
    assert.deepEqual(
      selected.layers.map(({id, type}) => ({id, type})),
      style.layers.map(({id, type}) => ({id, type})),
      'Appearance changes preserve the drawing order and 3D toggles',
    );
  }
  assert.equal(skies.size, 4);
  assert.equal(papers.size, 4);
});

test('1777 patterns use their own palette and opaque backgrounds match the map', () => {
  const usedPatterns = new Set<string>();
  for (const [name, definition] of Object.entries(map1777.themes!)) {
    const theme = resolveTileflowTheme(definition);
    const ids = [...new Set(Object.values(theme.tokens.image))];
    assert.equal(ids.length, 11, name);
    for (const id of ids) {
      assert.ok(!usedPatterns.has(id), `${name} must not reuse a daylight plate`);
      usedPatterns.add(id);
      const svg = readFileSync(
        new URL(`../assets/map-1777/icons/${id}.pattern.svg`, import.meta.url),
        'utf8',
      );
      if (id.endsWith('paper-grain') || id.endsWith('water-ripples')) {
        const background = svg.match(/<rect[^>]*fill="(#[\da-f]{6})"/i)?.[1];
        assert.equal(
          background,
          theme.tokens.color[id.endsWith('paper-grain') ? 'surface.background' : 'hydro.water'],
        );
      }
    }
  }
  assert.equal(usedPatterns.size, 44);
});

test('1777 water washes cover river axes while retaining small and intermittent streams', () => {
  for (const theme of ['light', 'dawn', 'dusk', 'dark']) {
    const selected = createStyle(map1777, {theme, preparedAssets});
    const position = (id: string) => {
      const index = selected.layers.findIndex((layer) => layer.id === id);
      assert.notEqual(index, -1, `${theme}: ${id}`);
      return index;
    };
    const body = position('tileflow-water');
    const fill = selected.layers[body];
    assert.ok(fill?.type === 'fill');
    assert.equal(fill.paint?.['fill-opacity'], 1, 'River axes must not show through the wash');
    for (const waterway of ['canal', 'other', 'river', 'stream']) {
      const lines = selected.layers.filter(
        (layer): layer is LineLayerSpecification =>
          layer.type === 'line' && layer.id.startsWith(`tileflow-waterway-${waterway}`),
      );
      assert.ok(lines.length > 0);
      for (const layer of lines) assert.ok(position(layer.id) < body);
      for (const intermittent of [0, 1]) {
        assert.ok(
          lines.some((layer) =>
            featureFilter(layer.filter).filter(
              {zoom: 17},
              {
                type: 2,
                properties: {class: waterway === 'other' ? 'ditch' : waterway, intermittent},
              },
            ),
          ),
          `${theme}: ${waterway} with intermittent=${intermittent} remains mapped`,
        );
      }
    }
    const wash = position('tileflow-water-render-bankWash');
    const outline = position('tileflow-water-outline');
    assert.ok(
      wash < outline && outline < body,
      'Opaque water must cover shared polygon edges at confluences, leaving exterior bank ink',
    );
    const bank = selected.layers[wash];
    assert.ok(bank?.type === 'line');
    assert.equal(
      featureFilter(bank.filter).filter({zoom: 17}, {type: 3, properties: {intermittent: 1}}),
      false,
      'Seasonal water must not acquire a permanent bank wash',
    );
  }
});

test('1777 raises opaque red buildings with map-anchored light and shared shadows', () => {
  const design = readTileflowBuildings3D(style.metadata);
  const sun = readTileflowSunPreset(style.metadata);
  assert.ok(design && sun);
  assert.equal(design.color, '#BE5A50');
  assert.equal(design.lighting, 'sun');
  assert.equal(design.shadows, true);
  assert.equal(design.occlusion, true);
  assert.ok(design.edges > 0 && design.edgeColor);
  assert.ok(sun.altitude > 0 && sun.shadowIntensity > 0);
  assert.equal(style.light?.anchor, 'map');
  assert.deepEqual(style.light?.position, [1.15, sun.azimuth, 90 - sun.altitude]);
  assert.equal(design.nightLight, 0);
  assert.equal(design.windows, false);
  assert.equal(readTileflowStreetLights(style.metadata), undefined);

  const extrusion = style.layers.find(
    (layer) => layer.id === 'tileflow-buildings-render-extrusion',
  );
  assert.ok(extrusion?.type === 'fill-extrusion');
  assert.equal(extrusion.paint?.['fill-extrusion-opacity'], 1);
  assert.equal(extrusion.layout?.visibility, 'none', 'The printed view remains the initial view');
  assert.equal(extrusion.metadata?.['tileflow:3d-toggle'], 'building');
  const filter = featureFilter(extrusion.filter);
  for (const hidden of [true, 1, '1']) {
    assert.equal(filter.filter({zoom: 17}, {type: 3, properties: {hide_3d: hidden}}), false);
  }
  assert.equal(filter.filter({zoom: 17}, {type: 3, properties: {}}), true);
  const height = createPropertyExpression(
    extrusion.paint?.['fill-extrusion-height'],
    latest['paint_fill-extrusion']['fill-extrusion-height'],
  );
  const base = createPropertyExpression(
    extrusion.paint?.['fill-extrusion-base'],
    latest['paint_fill-extrusion']['fill-extrusion-base'],
  );
  assert.equal(height.result, 'success');
  assert.equal(base.result, 'success');
  if (height.result !== 'success' || base.result !== 'success') return;
  for (const [properties, expectedHeight, expectedBase] of [
    [{}, 5, 0],
    [{render_height: 24, render_min_height: 8}, 24, 8],
    [{render_height: -2, render_min_height: -4}, 0, 0],
    [{render_height: 8, render_min_height: 20}, 8, 8],
  ] as const) {
    assert.equal(height.value.evaluate({zoom: 17}, {type: 3, properties}), expectedHeight);
    assert.equal(base.value.evaluate({zoom: 17}, {type: 3, properties}), expectedBase);
  }
});

test('1777 keeps its printed trees in 2D and supplies olive illustrated trees in 3D', () => {
  const policy = readTileflowVegetationDisplay(style.metadata);
  const trees = readTileflowVegetation3D(style.metadata);
  assert.ok(policy && trees);
  assert.equal(trees.finish, 'toon');
  assert.ok(trees.colors.broadleaf.includes('#9FB583'));
  assert.ok(
    !style.layers.some(
      (layer) => layer.id.startsWith('tileflow-vegetation-') && layer.type === 'symbol',
    ),
    'Mapped 2D/3D trees must not be duplicated by pictorial sprites',
  );
  assert.equal(
    resolveTileflowVegetationRepresentation(policy, {viewMode: '2d', supports3D: true}),
    'flat',
  );
  assert.equal(
    resolveTileflowVegetationRepresentation(policy, {viewMode: '3d', supports3D: true}),
    '3d',
  );
  assert.equal(
    resolveTileflowVegetationRepresentation(policy, {viewMode: '3d', supports3D: false}),
    'flat',
  );
  assert.equal(
    resolveTileflowVegetationRepresentation(policy, {
      viewMode: '3d',
      supports3D: true,
      visible: false,
    }),
    'none',
  );
});

test('1777 places plazas below garden patterns and keeps transport surfaces off the land', () => {
  const position = (id: string) => {
    const index = style.layers.findIndex((layer) => layer.id === id);
    assert.notEqual(index, -1, id);
    return index;
  };
  const plaza = position('tileflow-road-pedestrian-area');
  const outline = position('tileflow-road-pedestrian-area-outline');
  assert.ok(position('tileflow-land-render-residentialTexture') < plaza);
  assert.ok(plaza < outline);
  for (const id of [
    'tileflow-landcover-urbanPark',
    'tileflow-landcover-flowerbed',
    'tileflow-land-render-woodTexture',
  ]) {
    assert.ok(outline < position(id), `${id} must not be paved over`);
  }
  for (const layer of style.layers.filter((layer) => /road-(?:pier|area)(?:-|$)/.test(layer.id))) {
    assert.equal(layer.layout?.visibility, 'none');
  }
  const tunnel = position('tileflow-road-tunnel-primary-fill');
  const surface = position('tileflow-road-surface-primary-fill');
  const bridge = position('tileflow-road-bridge-primary-fill');
  assert.ok(tunnel < surface && surface < bridge);
  assert.ok(bridge < position('tileflow-buildings-render-extrusion'));
  assert.ok(
    position('tileflow-labels-render-roadPrimary') <
      position('tileflow-buildings-render-extrusion'),
  );
  const roadName = style.layers[position('tileflow-labels-render-roadPrimary')];
  assert.ok(roadName?.type === 'symbol');
  assert.equal(roadName.layout?.['text-pitch-alignment'], 'map');
});

test('1777 keeps small streets and paths continuous with thin dashed tunnel borders', () => {
  const road = style.layers.find(
    (layer): layer is LineLayerSpecification =>
      layer.type === 'line' && layer.id === 'tileflow-road-surface-minor-fill',
  );
  assert.ok(road);
  for (const zoom of [15, 17, 19]) {
    for (const properties of [
      {class: 'minor'},
      {class: 'minor', access: 'no'},
      {class: 'minor', indoor: 1},
      {class: 'minor', surface: 'unpaved'},
    ]) {
      assert.ok(featureFilter(road.filter).filter({zoom}, {type: 2, properties}));
      const dash = road.paint?.['line-dasharray'];
      if (dash) {
        const expression = createPropertyExpression(
          typeof dash[0] === 'number' ? ['literal', dash] : dash,
          latest.paint_line['line-dasharray'],
        );
        assert.equal(expression.result, 'success');
        if (expression.result === 'success') {
          assert.deepEqual(expression.value.evaluate({zoom}, {type: 2, properties}), [1, 0]);
        }
      }
    }
  }
  const path = style.layers.find((layer) => layer.id === 'tileflow-road-surface-footway-fill');
  assert.ok(path?.type === 'line');
  assert.equal(path.layout?.['line-cap'], 'round');
  const pathDash = path.paint?.['line-dasharray'];
  if (pathDash) {
    const compiled = createPropertyExpression(pathDash, latest.paint_line['line-dasharray']);
    assert.equal(compiled.result, 'success');
    if (compiled.result === 'success') {
      assert.deepEqual(compiled.value.evaluate({zoom: 18}, {type: 2, properties: {}}), [1, 0]);
    }
  }
  const tunnel = style.layers.find((layer) => layer.id === 'tileflow-road-tunnel-primary-casing');
  assert.ok(tunnel?.type === 'line');
  assert.ok(tunnel.paint?.['line-gap-width'], 'Tunnel hatching must leave the carriageway clear');
  const bridge = style.layers.find((layer) => layer.id === 'tileflow-road-bridge-primary-casing');
  assert.ok(bridge?.type === 'line');
  assert.equal(bridge.layout?.['line-cap'], 'butt');
});

test('1777 gives each mapped field a stable hatch and recolors every plate at night', () => {
  for (const [theme, prefix] of [
    ['light', 'map-1777-'],
    ['dark', 'map-1777-night-'],
  ] as const) {
    const selected = createStyle(map1777, {theme, preparedAssets});
    const layer = selected.layers.find(
      (entry) => entry.id === 'tileflow-land-render-farmlandTexture',
    );
    assert.ok(layer?.type === 'fill');
    const pattern = createPropertyExpression(
      layer.paint?.['fill-pattern'],
      latest.paint_fill['fill-pattern'],
    );
    assert.equal(pattern.result, 'success');
    if (pattern.result !== 'success') return;
    for (const [id, suffix] of [
      [0, 'crop-hatch'],
      [1, 'crop-cross'],
      [2, 'crop-lines'],
      [4, 'crop-cross'],
    ] as const) {
      const feature = {id, type: 3 as const, properties: {class: 'farmland'}};
      for (const zoom of [10, 15, 18]) {
        assert.equal(pattern.value.evaluate({zoom}, feature).name, `${prefix}${suffix}`);
      }
    }
    assert.equal(
      pattern.value.evaluate({zoom: 15}, {type: 3, properties: {class: 'farmland'}}).name,
      `${prefix}crop-hatch`,
    );
  }
});
