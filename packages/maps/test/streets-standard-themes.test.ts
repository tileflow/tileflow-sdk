import {
  Color,
  createPropertyExpression,
  latest as styleSpec,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, resolveTileflowTheme} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';
import {standardCartographyReference as reference} from './streets-standard-cartography-fixture';

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

const iconIds = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));

function color(value: unknown): Color {
  const parsed = typeof value === 'string' ? Color.parse(value) : value;
  assert.ok(parsed instanceof Color, `Expected a resolved color, got ${String(value)}`);
  return parsed;
}

// Default day uses its own city hierarchy and detailed carriageway swatches.
function expectedColor(theme: string, role: string, referenceColor: string): string {
  if (theme !== 'light') return referenceColor;
  if (role === 'roads.city.primary') return '#D5DBDF';
  if (role === 'roads.city.secondary') return '#DEE3E6';
  if (role === 'roads.city.tertiary') return '#E3E7E9';
  if (role === 'roads.city.minor') return '#DDE2E5';
  if (/^roads\.(major|motorway|trunk|primary)$/.test(role)) return '#AAB9C9';
  if (/^roads\.(default|minor|secondary|tertiary|bridge)$/.test(role)) return '#BDCCD9';
  return referenceColor;
}

function closeToObserved(actual: unknown, expected: string, context: string) {
  const actualColor = color(actual);
  const expectedColor = color(expected);
  assert.equal(actualColor.a, 1, `${context}: flat surface must remain opaque`);
  for (const channel of ['r', 'g', 'b'] as const) {
    const delta = Math.abs(actualColor[channel] - expectedColor[channel]) * 255;
    assert.ok(
      delta <= reference.sampling.channelTolerance + 1e-6,
      `${context}: ${actualColor} differs from observed ${expected} in ${channel} by ${delta.toFixed(2)}`,
    );
  }
}

for (const [referenceName, theme] of Object.entries(themes)) {
  test(`Streets ${theme} retains calibrated ${referenceName} surfaces and authored road colors`, () => {
    const expected = reference.measurements[referenceName as keyof typeof themes];
    const resolved = resolveTileflowTheme(streetsThemes[theme]);
    const colors = resolved.tokens.color;
    for (const [role, sample] of [
      ['buildings.fill', 'building'],
      ['surface.building', 'building'],
      ['surface.background', 'land'],
      ['surface.land', 'land'],
      ['landuse.commercial', 'commercial'],
      ['landuse.businessCorridor', 'commercial'],
      ['roads.default', 'road'],
      ['roads.minor', 'road'],
      ['landcover.greenspace', 'green'],
      ['landcover.urbanPark', 'green'],
      ['landuse.recreation', 'sport'],
    ] as const) {
      closeToObserved(
        colors[role],
        expectedColor(theme, role, expected[sample]),
        `${theme} ${role}`,
      );
    }

    const style = createStyle(streets, {
      theme,
      preparedAssets: {
        icons: {ids: iconIds, sprite: '/test/standard-themes/sprite'},
        models: streetsPreparedModels,
      },
    });
    for (const [id, property, sample] of [
      ['tileflow-background', 'background-color', 'land'],
      ['tileflow-buildings-fill', 'fill-color', 'building'],
      ['tileflow-land-render-businessArea', 'fill-color', 'commercial'],
    ] as const) {
      const layer = style.layers.find((candidate) => candidate.id === id);
      assert.ok(layer, `Missing ${id}`);
      closeToObserved(
        property === 'background-color'
          ? evaluatePaint(
              layer.paint?.[property],
              styleSpec.paint_background[property],
              reference.camera.zoom,
            )
          : layer.paint?.[property as keyof typeof layer.paint],
        expected[sample],
        `${theme} ${id}`,
      );
    }

    const road = style.layers.find((layer) => layer.id === 'tileflow-road-surface-minor-fill');
    assert.ok(road && road.type === 'line', 'Missing compiled minor road');
    const roadColor = createPropertyExpression(
      road.paint?.['line-color'],
      styleSpec.paint_line['line-color'],
    );
    assert.equal(roadColor.result, 'success');
    if (roadColor.result !== 'success') throw new Error('Invalid road color expression');
    closeToObserved(
      roadColor.value.evaluate({zoom: reference.camera.zoom}, {
        type: 2,
        properties: {class: 'minor'},
      } as never),
      expectedColor(theme, 'roads.default', expected.road),
      `${theme} road at reference zoom`,
    );

    const extrusion = style.layers.find(
      (layer) => layer.id === 'tileflow-buildings-render-extrusion',
    );
    assert.ok(extrusion && extrusion.type === 'fill-extrusion', 'Missing compiled extrusion');
    const input = color(extrusion.paint?.['fill-extrusion-color']);
    const lighting = style.light;
    assert.ok(
      lighting?.position && lighting.intensity !== undefined,
      'Missing authored roof light',
    );
    assert.equal(lighting.anchor, 'map', `${theme}: calibrated light remains map anchored`);
    // Scene-sun lighting normalizes an unshadowed roof to its authored colour.
    // The independent capture remains the reference when the lighting model changes.
    assert.equal((style.metadata?.['tileflow:buildings'] as {lighting?: string})?.lighting, 'sun');
    assert.ok(resolved.sun, 'Missing the authored scene sun');
    closeToObserved(
      input,
      reference.roofs.observations[referenceName as keyof typeof themes].color,
      `${theme} calibrated unshadowed roof`,
    );

    const dark = /-(?:dusk|night)$/.test(referenceName);
    assert.equal(resolved.colorScheme, dark ? 'dark' : 'light', `${theme}: foreground scheme`);
    assert.equal(style.metadata?.['tileflow:colorScheme'], dark ? 'dark' : 'light');
    const foreground = color(colors['labels.road']);
    const background = color(colors['surface.background']);
    const brightness = (value: Color) => value.r + value.g + value.b;
    assert.ok(
      dark
        ? brightness(foreground) > brightness(background)
        : brightness(foreground) < brightness(background),
      `${theme}: road lettering must remain separated from the surface`,
    );
  });
}

test('Streets retains reference colors with its default day road palette in all twelve presets', () => {
  for (const [name, theme] of Object.entries(themes)) {
    const expected = reference.colors[name as keyof typeof themes];
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    for (const [role, sample] of Object.entries(expected)) {
      assert.equal(colors[role], expectedColor(theme, role, sample), `${theme}: ${role}`);
    }
    // Check the reference's actual GPU observations independently of formula rounding.
    for (const sample of reference.gpu[name as keyof typeof themes]) {
      closeToObserved(
        colors[sample.name],
        expectedColor(
          theme,
          sample.name,
          `#${sample.rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
        ),
        `${theme}: GPU ${sample.name}`,
      );
    }
  }
});

function evaluatePaint(
  value: unknown,
  property: Parameters<typeof createPropertyExpression>[1],
  zoom: number,
) {
  const result = createPropertyExpression(value, property);
  assert.equal(result.result, 'success');
  if (result.result !== 'success') throw new Error('Invalid paint expression');
  return result.value.evaluate({zoom});
}

test('Streets preset calibration preserves translucent surfaces and fixed road-sign ink', () => {
  for (const [referenceName, theme] of Object.entries(themes)) {
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    const dark = /-(?:dusk|night)$/.test(referenceName);
    for (const depth of ['m0', 'm200', 'm2000', 'm7000']) {
      assert.ok(
        Math.abs(color(colors[`hydro.depth.${depth}`]).a - 0.35) < 1e-6,
        `${theme}: ${depth} alpha`,
      );
    }
    assert.equal(color(colors['roads.sidewalk.surface']).a, 0.06, `${theme}: sidewalk alpha`);
    assert.equal(
      color(colors['labels.waterHalo']).a,
      dark ? 0.82 : 0.72,
      `${theme}: water halo alpha`,
    );
    assert.equal(
      String(colors['labels.shield.dark']).toUpperCase(),
      '#1B1D27',
      `${theme}: dark sign ink`,
    );
    assert.equal(
      String(colors['labels.shield.light']).toUpperCase(),
      '#FFFFFF',
      `${theme}: light sign ink`,
    );
  }
});

test('Streets evaluates water and ground lighting at their independent zoom handoffs', () => {
  for (const [profile, theme] of Object.entries(themes)) {
    const expected = reference.colors[profile as keyof typeof themes];
    const style = createStyle(streets, {
      theme,
      preparedAssets: {
        icons: {ids: iconIds, sprite: '/test/sprite'},
        models: streetsPreparedModels,
      },
    });
    const water = style.layers.find((layer) => layer.id === 'tileflow-water');
    const ground = style.layers.find((layer) => layer.id === 'tileflow-background');
    assert.ok(water && water.type === 'fill' && ground && ground.type === 'background');
    for (const [z, role] of [
      [0, 'hydro.water.overview'],
      [5, 'hydro.water.overview'],
      [7, 'hydro.water.regional'],
      [13, 'hydro.water.regional'],
      [14, 'hydro.water'],
      [22, 'hydro.water'],
    ] as const) {
      closeToObserved(
        evaluatePaint(water.paint?.['fill-color'], styleSpec.paint_fill['fill-color'], z),
        expected[role],
        `${theme} water z${z}`,
      );
    }
    for (const [z, role] of [
      [0, 'surface.background.overview'],
      [13, 'surface.background.overview'],
      [14, 'surface.background'],
      [22, 'surface.background'],
    ] as const) {
      closeToObserved(
        evaluatePaint(
          ground.paint?.['background-color'],
          styleSpec.paint_background['background-color'],
          z,
        ),
        expected[role],
        `${theme} land z${z}`,
      );
    }
  }
});
