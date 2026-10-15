import {
  Color,
  createPropertyExpression,
  featureFilter,
  latest as styleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, resolveMap, resolveTileflowTheme} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {streets, streetsIcons, streetsThemes} from '../src';
import {streetsPreparedModels, streetsTreeIconIds} from './streets-assets';
import {streetsPoiImageIds} from './streets-poi-fixture';

const streetsIconIds = [
  ...streetsTreeIconIds,
  'coffee',
  'nature',
  'sport',
  'worship',
  'coffee-dark',
  'culture-dark',
  'education-dark',
  'food-dark',
  'health-dark',
  'lodging-dark',
  'major-transit-dark',
  'parking-dark',
  'services-dark',
  'shopping-dark',
  'nature-dark',
  'worship-dark',
  'sport-dark',
  'crosswalk',
  'culture',
  'education',
  'food',
  'health',
  'lodging',
  'major-transit',
  'oneway',
  'parking',
  'road-shield-circle-neutral',
  'road-shield-rectangle-blue',
  'road-shield-rectangle-green',
  'road-shield-rectangle-neutral',
  'road-shield-rectangle-orange',
  'road-shield-rectangle-red',
  'road-shield-rectangle-yellow',
  'services',
  'shopping',
  'sidewalk-dot',
  'sidewalk-dot-dark',
  ...streetsPoiImageIds,
] as const;

const preparedAssets = {
  preparedAssets: {
    models: streetsPreparedModels,
    icons: {
      ids: streetsIconIds,
      sprite: '/tileflow/test/streets-dark/sprite',
    },
  },
} as const;

// Symmetric physical-output review for the complete Standard-day calibration.
const approvedLightStyleColors = new Set([
  '#000000',
  '#1891AA',
  '#3359CC',
  '#F2F2F2',
  '#A6AB91',
  '#727B64',
  '#15AFFA59',
  '#29B5FD59',
  '#1B1D27',
  '#267915',
  '#2682D9',
  '#479CEB',
  '#404040',
  '#2D87E1',
  '#5A88A9',
  '#5C74D6',
  '#626361',
  '#586E84',
  '#67AD73',
  '#6D6E6C',
  '#729B78',
  '#6ECEFE59',
  '#664CE6',
  '#81A880',
  '#83AD83',
  '#8B8E99',
  '#8C8178',
  '#8D9EAE',
  '#8E909D',
  '#8F91AA',
  '#918878',
  '#91B68B',
  '#91BA8D',
  '#916130',
  '#98DCFE',
  '#99DDFF59',
  '#9EA9C4',
  '#A1C99B',
  '#A1B0C4',
  '#A3A6C2',
  '#AED7A5',
  '#AFD4A7',
  '#A7DFA0',
  '#B3EAAD',
  '#F042B6',
  '#BDB7B1',
  '#BEC5D8',
  '#BFE6AE',
  '#C1EFBE',
  '#C2E7B5',
  '#C6C8D4',
  '#C8C8CF',
  '#F53D3D',
  '#CCE5C6',
  '#CE9298',
  '#CE9698',
  '#D1C7C7',
  '#D2EEC6',
  '#D2F0C2',
  '#D3F1C5',
  '#D4F0C5',
  '#BEC8D6',
  '#D5E8D0',
  '#E2F3D1',
  '#F57A00',
  '#D7E9DE',
  '#C2EEBE',
  '#E0CDA5',
  '#DEE0E8',
  '#E4E1E5',
  '#EEE4DA',
  '#E8E8F0',
  '#E9E6E7',
  '#E9E8ED',
  '#EFECEF',
  '#ECE4D2',
  '#EEE0DF',
  '#F0ECC6',
  '#EFEADD',
  '#F2F0EB',
  '#F5F0EF',
  '#F5F1F0',
  '#F4F7F8',
  '#F8F6F8',
  '#FBEDE2',
  // The light of Core's street lights for lamps whose data gives no colour.
  '#FFCF8F',
  '#FFFFFF',
  'RGBA(0, 0, 0, 0)',
  'RGBA(0, 0, 0, 0.06)',
  'RGBA(244, 240, 239, 0.72)',
  // Default route inks, published in the style's metadata for application routes.
  '#1E3A8A',
  '#2563EB',
  '#94A3B8',
  '#DBEAFE',
]);

// This is the final compiler output, not only the authoring palette. It intentionally
// includes Core-derived blends and the unreachable #000000 expression fallback so any
// new physical color requires an explicit dark-map review.
const approvedDarkStyleColors = new Set([
  '#252D36',
  '#576374',
  '#101827',
  '#B6A783',
  '#89B871',
  '#94BCE3',
  '#9DAAB0',
  '#000000',
  '#081022A8',
  '#0B1328A8',
  '#0F162CA8',
  '#121522',
  '#13192F',
  '#13192FA8',
  '#18223B',
  '#1B1D27',
  '#252839',
  '#2A314B',
  '#2C2E3D',
  '#2D3043',
  '#303344',
  '#304139',
  '#33474A',
  '#343646',
  '#34453F',
  '#35473F',
  '#373A46',
  '#373B49',
  '#374440',
  '#384A40',
  '#393B49',
  '#394842',
  '#3A3C49',
  '#3A4550',
  '#3B4943',
  '#3D414D',
  '#3D5047',
  '#3E4B47',
  '#405348',
  '#434247',
  '#453D48',
  '#45424E',
  '#454956',
  '#454A59',
  '#45534D',
  '#45594E',
  '#46564D',
  '#485650',
  '#4C505E',
  '#4D5D54',
  '#4D6255',
  '#4E5260',
  '#505264',
  '#505462',
  '#52483D',
  '#52503E',
  '#525664',
  '#555867',
  '#565A68',
  '#5B5D70',
  '#5F6475',
  '#5F9169',
  '#636779',
  '#63756A',
  '#6F7188',
  '#70768A',
  '#76586D',
  '#777B89',
  '#7C7F8C',
  '#8296E6',
  '#8799BE',
  '#8F9098',
  '#9A6177',
  '#9FB6D0',
  '#A6A7AC',
  '#AA94DA',
  '#C786BC',
  '#D0D0D6',
  '#D8BD65',
  '#DC7C89',
  // The light of Core's street lights for lamps whose data gives no colour.
  '#FFCF8F',
  '#FFFFFF',
  'RGBA(0, 0, 0, 0)',
  'RGBA(37, 40, 57, 0.82)',
  'RGBA(255, 255, 255, 0.06)',
  // Default route inks, published in the style's metadata for application routes.
  '#0B1220',
  '#60A5FA',
  '#64748B',
  '#EFF6FF',
]);

function compile(theme: 'light' | 'dark') {
  return createStyle(streets, {...preparedAssets, theme});
}

function compileInspected(theme: 'light' | 'dark') {
  return createStyleWithInspection(streets, {...preparedAssets, theme});
}

function requireLayer(style: ReturnType<typeof compile>, id: string) {
  const layer = style.layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `Missing compiled layer ${id}`);
  return layer;
}

function collectColorLiterals(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^(?:#[0-9a-f]+|hsla?\(|rgba?\()/iu.test(value)) output.push(value.toUpperCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectColorLiterals(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectColorLiterals(item, output);
    }
  }
  return output;
}

function relativeLuminance(color: string): number {
  assert.match(color, /^#[0-9a-f]{6}$/iu);
  const channels = color
    .slice(1)
    .match(/.{2}/gu)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  assert.ok(channels);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

test('Streets exposes complete light and dark themes on one map identity', () => {
  const resolvedStreets = resolveMap(streets);
  assert.equal(resolvedStreets.id, 'streets');
  assert.equal('root' in resolvedStreets, false);
  assert.equal(resolvedStreets.defaultTheme, 'light');
  assert.deepEqual(resolvedStreets.systemThemes, {light: 'light', dark: 'dark'});
  assert.deepEqual(Object.keys(resolvedStreets.themes), ['light', 'dark']);
  assert.equal(streetsThemes.light.colorScheme, 'light');
  assert.equal(streetsThemes.dark.colorScheme, 'dark');
  assert.equal(streetsThemes.light.id, 'streets-light');
  assert.equal(streetsThemes.dark.id, 'streets-dark');
  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.equal(resolvedStreets.modules?.labels?.shields, 'major');
  assert.equal(
    resolveTileflowTheme(streetsThemes.light).tokens.image['roads.sidewalkPattern'],
    'sidewalk-dot',
  );
  assert.equal(
    resolveTileflowTheme(streetsThemes.dark).tokens.image['roads.sidewalkPattern'],
    'sidewalk-dot-dark',
  );
  const expectedShieldImages = {
    'roads.shield.circleNeutral': 'road-shield-circle-neutral',
    'roads.shield.rectangleBlue': 'road-shield-rectangle-blue',
    'roads.shield.rectangleGreen': 'road-shield-rectangle-green',
    'roads.shield.rectangleNeutral': 'road-shield-rectangle-neutral',
    'roads.shield.rectangleOrange': 'road-shield-rectangle-orange',
    'roads.shield.rectangleRed': 'road-shield-rectangle-red',
    'roads.shield.rectangleYellow': 'road-shield-rectangle-yellow',
  } as const;
  for (const theme of [streetsThemes.light, streetsThemes.dark]) {
    const resolvedTheme = resolveTileflowTheme(theme);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(resolvedTheme.tokens.image).filter(([name]) =>
          name.startsWith('roads.shield.'),
        ),
      ),
      expectedShieldImages,
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(resolvedTheme.tokens.color).filter(([name]) =>
          name.startsWith('labels.shield.'),
        ),
      ),
      {'labels.shield.dark': '#1B1D27', 'labels.shield.light': '#FFFFFF'},
    );
  }
  assert.deepEqual(resolveTileflowTheme(streetsThemes.dark).lighting, {
    anchor: 'viewport',
    color: '#9FB6D0',
    intensity: 0.08,
    position: [1.15, 210, 30],
  });

  const style = compile('dark');
  assert.equal(style.metadata?.['tileflow:map'], 'streets');
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:theme'], 'dark');
  assert.equal(style.metadata?.['tileflow:colorScheme'], 'dark');
  assert.equal(style.sprite, '/tileflow/test/streets-dark/sprite');
  const overviewShield = requireLayer(style, 'tileflow-label-road-shield-overview');
  const detailShield = requireLayer(style, 'tileflow-label-road-shield-detail');
  assert.equal(overviewShield['source-layer'], 'transportation_shield');
  assert.equal(overviewShield.layout?.['symbol-placement'], 'point');
  assert.equal(overviewShield.minzoom, 6);
  assert.equal(overviewShield.maxzoom, 11);
  assert.equal(detailShield['source-layer'], 'transportation_name');
  assert.equal(detailShield.layout?.['symbol-placement'], 'line');
  assert.equal(detailShield.minzoom, 11);
  assert.deepEqual(detailShield.layout?.['symbol-spacing'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    400,
    14,
    600,
  ]);
  for (const shield of [overviewShield, detailShield]) {
    assert.deepEqual(shield.layout?.['icon-image'], [
      'match',
      ['get', 'shield_kind'],
      'circle-neutral',
      'road-shield-circle-neutral',
      'default',
      'road-shield-rectangle-neutral',
      'rectangle-blue',
      'road-shield-rectangle-blue',
      'rectangle-green',
      'road-shield-rectangle-green',
      'rectangle-neutral',
      'road-shield-rectangle-neutral',
      'rectangle-orange',
      'road-shield-rectangle-orange',
      'rectangle-red',
      'road-shield-rectangle-red',
      'rectangle-yellow',
      'road-shield-rectangle-yellow',
      'road-shield-rectangle-neutral',
    ]);
    assert.equal(shield.layout?.['icon-text-fit'], 'width');
    assert.deepEqual(shield.layout?.['icon-text-fit-padding'], [0, 4, 0, 4]);
    assert.equal(shield.layout?.['icon-rotation-alignment'], 'viewport');
    assert.equal(shield.layout?.['icon-pitch-alignment'], 'viewport');
    assert.equal(shield.layout?.['icon-padding'], 2);
    assert.equal(shield.layout?.['text-rotation-alignment'], 'viewport');
    assert.equal(shield.layout?.['text-pitch-alignment'], 'viewport');
    assert.equal(shield.layout?.['text-padding'], 2);
    assert.deepEqual(shield.layout?.['text-field'], ['to-string', ['get', 'shield_text']]);
    assert.equal(shield.layout?.['icon-optional'], false);
    assert.equal(shield.layout?.['text-optional'], false);
    assert.equal(shield.layout?.['text-size'], 9);
    assert.equal(shield.layout?.['text-letter-spacing'], 0.05);
    assert.deepEqual(shield.paint?.['text-color'], [
      'match',
      ['get', 'shield_text_color'],
      'dark',
      '#1B1D27',
      'light',
      '#FFFFFF',
      '#1B1D27',
    ]);
  }
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('Streets Dark preserves Streets geometry, ordering, visibility, and label behavior', () => {
  const light = compile('light');
  const dark = compile('dark');
  const structuralContract = (layer: (typeof light.layers)[number]) => ({
    filter: layer.filter,
    id: layer.id,
    layout: JSON.parse(JSON.stringify(layer.layout ?? {}).replace(/-dark(?=")/gu, '')),
    maxzoom: layer.maxzoom,
    minzoom: layer.minzoom,
    source: layer.source,
    sourceLayer: layer['source-layer'],
    type: layer.type,
  });

  assert.deepEqual(dark.layers.map(structuralContract), light.layers.map(structuralContract));
  assert.deepEqual(dark.metadata?.['tileflow:modules'], light.metadata?.['tileflow:modules']);
  assert.deepEqual(dark.sources, light.sources);
  assert.equal(dark.glyphs, light.glyphs);
});

test('Streets Dark recolors every color-bearing Streets layer without major light leakage', () => {
  const light = compile('light');
  const dark = compile('dark');
  let recoloredLayerCount = 0;

  for (const [index, lightLayer] of light.layers.entries()) {
    const darkLayer = dark.layers[index];
    const sourceColors = collectColorLiterals(lightLayer.paint).filter(
      (color) => color !== 'RGBA(0, 0, 0, 0)',
    );
    if (sourceColors.length === 0) continue;
    assert.notDeepEqual(
      darkLayer.paint,
      lightLayer.paint,
      `${lightLayer.id} retained its complete light paint`,
    );
    recoloredLayerCount += 1;
  }
  assert.ok(recoloredLayerCount > 140, `Only ${recoloredLayerCount} layers were recolored`);

  assert.deepEqual(
    new Set(collectColorLiterals(light)),
    approvedLightStyleColors,
    'The final Streets Light style introduced an unreviewed physical color',
  );

  assert.equal(requireLayer(dark, 'tileflow-background').paint?.['background-color'], '#2D3043');
  assert.match(
    JSON.stringify(requireLayer(dark, 'tileflow-water').paint?.['fill-color']),
    /#13192F[\s\S]+#18223B/u,
  );
  assert.equal(requireLayer(dark, 'tileflow-buildings-fill').paint?.['fill-color'], '#2C2E3D');
  assert.equal(
    requireLayer(dark, 'tileflow-buildings-render-extrusion').paint?.['fill-extrusion-color'],
    '#343646',
  );
  assert.equal(
    requireLayer(dark, 'tileflow-land-render-businessArea').paint?.['fill-color'],
    '#45424E',
  );

  const serialized = JSON.stringify(dark).toUpperCase();
  for (const lightSignature of [
    '#505050',
    '#98DCFE',
    '#9EA9C4',
    '#B3EAAD',
    '#BEC5D8',
    '#D49399',
    '#D5E8D0',
    '#EFEADD',
    '#F5F1F0',
    '#F7F6F4',
    '#FBEDE2',
  ]) {
    assert.equal(
      serialized.includes(lightSignature),
      false,
      `Streets Dark leaked light palette color ${lightSignature}`,
    );
  }

  assert.deepEqual(
    new Set(collectColorLiterals(dark)),
    approvedDarkStyleColors,
    'The final Streets Dark style introduced an unreviewed physical color',
  );
});

test('Streets Dark keeps a legible road hierarchy and high-contrast key labels', () => {
  const style = compile('dark');
  const ordinaryRoad = '#636779';
  const ordinaryTunnel = '#525664';
  const trunkRoad = '#6F7188';
  const motorwayRoad = '#70768A';

  assert.match(
    JSON.stringify(requireLayer(style, 'tileflow-road-bridge-minor-fill').paint),
    /#636779/u,
  );
  assert.equal(
    requireLayer(style, 'tileflow-road-tunnel-minor-fill').paint?.['line-color'],
    ordinaryTunnel,
  );
  assert.match(
    JSON.stringify(requireLayer(style, 'tileflow-road-bridge-trunk-fill').paint),
    /#6F7188/u,
  );
  assert.match(
    JSON.stringify(requireLayer(style, 'tileflow-road-bridge-motorway-fill').paint),
    /#70768A/u,
  );
  assert.ok(relativeLuminance(ordinaryTunnel) < relativeLuminance(ordinaryRoad));
  assert.ok(relativeLuminance(ordinaryRoad) < relativeLuminance(trunkRoad));
  assert.ok(relativeLuminance(trunkRoad) < relativeLuminance(motorwayRoad));

  const cityLabel = requireLayer(style, 'tileflow-label-place-city');
  assert.match(JSON.stringify(cityLabel.paint?.['text-color']), /#A6A7AC/u);
  assert.equal(cityLabel.paint?.['text-halo-color'], '#252839');
  const waterLabel = requireLayer(style, 'tileflow-label-water-ocean');
  assert.equal(waterLabel.paint?.['text-color'], '#8799BE');

  const roadLabel = requireLayer(style, 'tileflow-labels-render-streetMinor');
  assert.equal(roadLabel.paint?.['text-halo-color'], '#252839');
  assert.equal(roadLabel.paint?.['text-halo-width'], 1);

  for (const [name, foreground, background] of [
    ['place label on land', '#A6A7AC', '#2D3043'],
    ['water label on water', '#8799BE', '#18223B'],
    ['road label against its halo', '#D0D0D6', '#252839'],
  ] as const) {
    assert.ok(contrastRatio(foreground, background) >= 4.5, `${name} fell below 4.5:1 contrast`);
  }
  assert.ok(
    contrastRatio('#D0D0D6', ordinaryRoad) >= 3,
    'road label ink lost Mapbox Standard night separation from the carriageway',
  );
});

test('Streets uses blue road decks with darker casings at street detail', () => {
  const expected = {
    light: {casing: '#9EA9C4', deck: '#BEC5D8'},
    dark: {casing: '#454A59', deck: '#636779'},
  } as const;

  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const casingFor = (structure: string, roadClass: string) => {
      const layer = style.layers.find(
        (l) =>
          l.id.startsWith(`tileflow-road-${structure}-`) &&
          l.id.endsWith('-casing') &&
          (l.minzoom ?? 0) <= 17.97 &&
          (l.maxzoom ?? 25) > 17.97 &&
          featureFilter(l.filter as never).filter({zoom: 17.97}, {
            type: 2,
            properties: {class: roadClass, brunnel: structure},
          } as never),
      );
      assert.ok(layer);
      return layer;
    };
    const surfaceCasing = casingFor('surface', 'minor');
    const bridgeCasing = casingFor('bridge', 'minor');
    const bridgeDeck = requireLayer(style, 'tileflow-road-bridge-minor-fill');

    assert.match(
      JSON.stringify(surfaceCasing.paint?.['line-color']),
      new RegExp(expected[theme].casing),
    );
    assert.match(
      JSON.stringify(bridgeCasing.paint?.['line-color']),
      new RegExp(expected[theme].casing),
    );
    assert.match(
      JSON.stringify(bridgeDeck.paint?.['line-color']),
      new RegExp(expected[theme].deck),
    );
    assert.ok(
      relativeLuminance(expected[theme].casing) < relativeLuminance(expected[theme].deck),
      `${theme} casing must remain darker than its road deck`,
    );

    for (const layer of [surfaceCasing, bridgeCasing]) {
      assert.equal(
        layer.paint?.['line-dasharray'],
        undefined,
        'Continuous borders must avoid the SDF dash shader, including its [1, 0] fallback',
      );
      const gap = createPropertyExpression(
        layer.paint?.['line-gap-width'],
        styleSpec.paint_line['line-gap-width'],
      );
      assert.equal(gap.result, 'success');
      if (gap.result !== 'success') throw new Error('Invalid road gap');
      assert.equal(
        gap.value.evaluate({zoom: 17.97}, {type: 2, properties: {class: 'minor'}} as never),
        0.5 + ((20 - 0.5) * (1.5 ** (17.97 - 12) - 1)) / (1.5 ** 6 - 1),
        'The casing gap follows the street carriageway at fractional zooms',
      );
    }

    for (const roadClass of ['minor', 'primary', 'motorway']) {
      const tunnel = casingFor('tunnel', roadClass);
      assert.deepEqual(tunnel.paint?.['line-dasharray'], [3, 3]);
    }

    for (const roadClass of ['footway', 'pedestrian', 'pathway']) {
      for (const structure of ['surface', 'bridge']) {
        const layer = requireLayer(style, `tileflow-road-${structure}-${roadClass}-casing`);
        assert.equal(layer.paint?.['line-dasharray'], undefined, `${roadClass} has a solid edge`);
      }
    }

    const construction = {type: 2, properties: {class: 'minor_construction'}} as never;
    const opacity = createPropertyExpression(
      surfaceCasing.paint?.['line-opacity'],
      styleSpec.paint_line['line-opacity'],
    );
    assert.equal(opacity.result, 'success');
    if (opacity.result === 'success')
      assert.equal(opacity.value.evaluate({zoom: 18}, construction), 0);
  }
});

test('Streets roundabouts retain metric edges and open approach joins throughout zoom', () => {
  const properties = {
    class: 'minor',
    radius_px_z15: 10.458,
    radius_m: 18.9,
    inner_radius_m: 16.2,
    outer_radius_m: 21,
  };
  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const fill = requireLayer(style, 'tileflow-road-circular-fill');
    const casing = requireLayer(style, 'tileflow-road-circular-casing');
    for (const [layer, border] of [
      [fill, 0],
      [casing, 0.5],
    ] as const) {
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
      for (let z = 15; z <= 24; z += 0.25) {
        const feature = {type: 1, properties} as never;
        const inner = radius.value.evaluate({zoom: z}, feature) as number;
        const outer = inner + (width.value.evaluate({zoom: z}, feature) as number);
        const pixelsPerMeter = (properties.radius_px_z15 * 2 ** (z - 15)) / properties.radius_m;
        assert.ok(
          Math.abs(inner - (16.2 * pixelsPerMeter - border)) < 1e-8,
          `${theme} inner edge at z${z}`,
        );
        assert.ok(
          Math.abs(outer - (21 * pixelsPerMeter + border)) < 1e-8,
          `${theme} outer edge at z${z}`,
        );
      }
    }
    for (const layer of style.layers) {
      if (layer.id.startsWith('tileflow-road-surface-') && layer.id.endsWith('-fill')) {
        assert.ok(
          style.layers.indexOf(casing) < style.layers.indexOf(layer),
          `${theme}: no casing across an approach`,
        );
      }
      if (layer.id.startsWith('tileflow-road-bridge-')) {
        assert.ok(
          style.layers.indexOf(fill) < style.layers.indexOf(layer),
          `${theme}: bridges above roundabouts`,
        );
      }
    }
  }
});

// Measurements from Mapbox Standard default/day, 2D, HD roads disabled,
// retrieved 2026-10-14. The tables intentionally live outside the style helpers.
// Check compiled class eligibility as well as widths: a correct width on a
// hidden layer, or an extra overview casing, must not pass this regression.
test('Streets matches reference carriageways and casing thresholds from z0 through z24', () => {
  const style = compile('light');
  const reference = {
    motorway: {start: 3, widths: [0.8, 3.2, 30, 300]},
    trunk: {start: 3, widths: [0.8, 3.2, 30, 300]},
    primary: {start: 6, widths: [0.8, 3, 28, 280]},
    secondary: {start: 8, widths: [0, 2.2, 26, 260]},
    tertiary: {start: 8, widths: [0, 2.2, 26, 260]},
    minor: {start: 12, widths: [0, 0.5, 20, 200]},
    service: {start: 15, widths: [0, 0, 10, 100]},
    track: {start: 15, widths: [0, 0, 10, 100]},
  };
  const interpolate = (z: number, stops: number[], values: number[]) => {
    if (z <= stops[0]!) return values[0]!;
    for (let i = 1; i < stops.length; i++) {
      if (z <= stops[i]!) {
        const t = (1.5 ** (z - stops[i - 1]!) - 1) / (1.5 ** (stops[i]! - stops[i - 1]!) - 1);
        return values[i - 1]! + t * (values[i]! - values[i - 1]!);
      }
    }
    return values.at(-1)!;
  };
  const layers = style.layers
    .filter((l) => l.id.startsWith('tileflow-road-surface-'))
    .map((l) => ({
      layer: l,
      accepts: featureFilter(l.filter as never).filter,
      width: createPropertyExpression(
        l.paint?.['line-width'] ?? 0,
        styleSpec.paint_line['line-width'],
      ),
      gap: createPropertyExpression(
        l.paint?.['line-gap-width'] ?? 0,
        styleSpec.paint_line['line-gap-width'],
      ),
    }));
  const zooms = [
    ...Array.from({length: 97}, (_, i) => i / 4),
    2.99,
    3.01,
    5.99,
    6.01,
    7.99,
    8.01,
    11.99,
    12.01,
    13.99,
    14.01,
    14.99,
    15.01,
    15.99,
    16.01,
    17.97,
    17.99,
    18.01,
    21.99,
    22.01,
  ];
  for (const [roadClass, ref] of Object.entries(reference)) {
    const supportsRamp = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(
      roadClass,
    );
    for (const flags of [{}, {expressway: 1}, ...(supportsRamp ? [{ramp: 1}] : [])]) {
      const ramp = 'ramp' in flags;
      const feature = {type: 2, properties: {class: roadClass, oneway: 1, ...flags}} as never;
      const widths = ramp
        ? ['motorway', 'trunk'].includes(roadClass)
          ? [0, 0.8, 20, 200]
          : [0, 0.4, 18, 180]
        : ref.widths;
      for (const z of zooms) {
        const matching = (phase: string) =>
          layers.filter(
            ({layer, accepts}) =>
              layer.id.endsWith(`-${phase}`) &&
              (layer.minzoom ?? 0) <= z &&
              (layer.maxzoom ?? 25) > z &&
              accepts({zoom: z}, feature),
          );
        const fills = matching('fill');
        assert.equal(
          fills.length,
          z >= Math.max(ref.start, ramp ? 12 : 0) ? 1 : 0,
          `${roadClass} ${JSON.stringify(flags)} fill eligibility z${z}`,
        );
        const casings = matching('casing');
        const casingStart = ['service', 'track'].includes(roadClass) ? 16 : 15;
        assert.equal(
          casings.length,
          z >= casingStart ? 1 : 0,
          `${roadClass} casing eligibility z${z}`,
        );
        const expected = interpolate(z, [3, 12, 18, 22], widths);
        for (const fill of fills) {
          assert.equal(fill.width.result, 'success');
          if (fill.width.result === 'success')
            assert.ok(
              Math.abs(Number(fill.width.value.evaluate({zoom: z}, feature)) - expected) < 1e-6,
              `${roadClass} fill z${z}`,
            );
        }
        for (const casing of casings) {
          assert.equal(casing.width.result, 'success');
          assert.equal(casing.gap.result, 'success');
          const major = !ramp && ['motorway', 'trunk', 'primary'].includes(roadClass);
          if (casing.width.result === 'success')
            assert.ok(
              Math.abs(
                Number(casing.width.value.evaluate({zoom: z}, feature)) -
                  interpolate(z, [14, 22], [major ? 1 : 0.8, 2]),
              ) < 1e-6,
              `${roadClass} casing z${z}`,
            );
          if (casing.gap.result === 'success')
            assert.ok(
              Math.abs(Number(casing.gap.value.evaluate({zoom: z}, feature)) - expected) < 1e-6,
              `${roadClass} gap z${z}`,
            );
        }
      }
    }
  }
});

test('Streets keeps available districts when source ranks change between tile zooms', () => {
  for (const theme of ['light', 'dark'] as const) {
    const layer = requireLayer(compile(theme), 'tileflow-label-place-neighborhood');
    const filter = featureFilter(layer.filter as never).filter;
    const accepts = (zoom: number, name: string, rank: number, placeClass = 'suburb') =>
      filter({zoom}, {type: 'Point', properties: {name, rank, class: placeClass}} as never);

    // World tiles observed at this camera give Manhattan a different rank at
    // each zoom. Zooming in must not discard a district that was already visible.
    assert.equal(accepts(12, 'Manhattan', 11), true);
    assert.equal(accepts(13, 'Manhattan', 30), true);
    assert.equal(accepts(14, 'East Village', 28, 'neighbourhood'), true);
    assert.equal(accepts(14, 'Greenwich Village', 41, 'neighbourhood'), true);

    // Keep the overview density gate and the place-family boundary intact.
    assert.equal(accepts(11, 'Overview district', 18), true);
    assert.equal(accepts(11, 'Minor district', 30), false);
    assert.equal(accepts(13, 'New York', 1, 'city'), false);
  }
});

test('Streets restores Mapbox-scale contrast at city overview and building detail', () => {
  const {style, inspection} = compileInspected('light');
  const countryBoundary = requireLayer(style, 'tileflow-boundary-admin2');
  const regionalBoundary = requireLayer(style, 'tileflow-boundary-admin4');
  assert.equal(countryBoundary.paint?.['line-color'], '#CE9298');
  assert.deepEqual(countryBoundary.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    0.8,
    6,
    1.35,
    12,
    2.1,
  ]);
  assert.equal(regionalBoundary.paint?.['line-color'], '#CE9698');
  assert.deepEqual(regionalBoundary.paint?.['line-dasharray'], [3, 2]);
  assert.deepEqual(regionalBoundary.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    0.7,
    6,
    1.2,
    12,
    1.8,
  ]);

  const countryLabel = requireLayer(style, 'tileflow-label-place-country');
  const cityLabel = requireLayer(style, 'tileflow-label-place-city');
  assert.equal(countryLabel.paint?.['text-color'], '#000000');
  assert.deepEqual(cityLabel.layout?.['text-font'], ['Noto Sans Regular']);
  assert.equal(cityLabel.layout?.['text-padding'], 1);
  assert.equal(cityLabel.maxzoom, 15);
  assert.deepEqual(cityLabel.layout?.['text-variable-anchor'], ['right']);
  assert.match(JSON.stringify(countryLabel.layout?.['text-size']), /,9,\["step"/u);
  assert.match(JSON.stringify(cityLabel.layout?.['text-size']), /,6,\["step"/u);
  assert.match(JSON.stringify(cityLabel.paint?.['text-color']), /#000000/u);

  for (const family of ['town', 'village'] as const) {
    const settlement = requireLayer(style, `tileflow-label-place-${family}`);
    assert.equal(settlement.maxzoom, 13);
    assert.equal(settlement.paint?.['text-color'], '#000000');
    assert.deepEqual(settlement.layout?.['text-font'], ['Noto Sans Regular']);
    assert.deepEqual(settlement.layout?.['text-variable-anchor'], [
      'left',
      'right',
      'top',
      'bottom',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
    assert.match(JSON.stringify(settlement.layout?.['text-radial-offset']), /,8,0/u);
  }

  const neighborhood = requireLayer(style, 'tileflow-label-place-neighborhood');
  assert.equal(neighborhood.minzoom, 10);
  assert.equal(neighborhood.maxzoom, 15);
  assert.equal(neighborhood.layout?.['text-transform'], 'uppercase');
  assert.equal(neighborhood.layout?.['text-padding'], 3);
  assert.deepEqual(neighborhood.layout?.['text-font'], ['Noto Sans Regular']);
  assert.match(JSON.stringify(neighborhood.filter), /,18/u);
  assert.match(JSON.stringify(neighborhood.layout?.['text-size']), /,11,\["match"/u);

  for (const [roadClass, color] of [
    ['primary', '#BEC5D8'],
    ['secondary', '#BEC5D8'],
    ['tertiary', '#BEC5D8'],
    ['minor', '#BEC5D8'],
  ] as const) {
    const layer = requireLayer(style, `tileflow-road-surface-${roadClass}-fill`);
    assert.match(JSON.stringify(layer.paint?.['line-color']), new RegExp(color));
  }

  const residential = inspection.layers.find((layer) =>
    layer.contributions.some(({target}) => target === 'land.landuse.residential.fill'),
  );
  assert.ok(residential);
  assert.match(
    JSON.stringify(requireLayer(style, residential.id).paint?.['fill-color']),
    /"residential"\],"#F5F0EF"/u,
  );
  assert.equal(
    requireLayer(style, 'tileflow-land-render-businessArea').paint?.['fill-color'],
    '#FBEDE2',
  );
  const buildingFill = requireLayer(style, 'tileflow-buildings-fill');
  assert.equal(buildingFill.paint?.['fill-color'], '#EFEADD');
  assert.equal(buildingFill.minzoom, 14.25);
  assert.deepEqual(buildingFill.paint?.['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    14.25,
    0,
    14.75,
    0.5,
    15,
    1,
  ]);
  const outlines = requireLayer(style, 'tileflow-buildings-fill-outline');
  assert.equal(outlines.paint?.['line-color'], '#E0CDA5');
  assert.deepEqual(outlines.paint?.['line-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    14.5,
    0,
    15,
    0.6,
    16,
    0.82,
    17,
    0.96,
    18,
    1,
  ]);
  assert.deepEqual(outlines.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    14.5,
    0.25,
    15,
    0.4,
    16,
    0.65,
    17,
    0.9,
    20,
    1,
  ]);

  const flatShadow = requireLayer(style, 'tileflow-buildings-render-flatShadow');
  assert.equal(flatShadow.paint?.['line-color'], '#BDB7B1');
  assert.equal(flatShadow.paint?.['line-blur'], 2);
  assert.deepEqual(flatShadow.paint?.['line-translate'], [0.5, 0.75]);
  assert.deepEqual(flatShadow.paint?.['line-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15.5,
    0,
    16,
    0.03,
    18,
    0.08,
    20,
    0.1,
  ]);
  assert.deepEqual(flatShadow.paint?.['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15.5,
    0.5,
    16,
    1,
    18,
    3,
    20,
    4,
  ]);
});

test('Streets keeps explicit lawns visible above overlapping park surfaces', () => {
  for (const theme of ['light', 'dark'] as const) {
    const {inspection} = compileInspected(theme);
    const indexOf = (target: string) => {
      const layer = inspection.layers.find((candidate) =>
        candidate.contributions.some((contribution) => contribution.target === target),
      );
      assert.ok(layer, `Missing surface ${target}`);
      return layer.index;
    };
    for (const detail of ['grass', 'meadow']) {
      for (const base of [
        'land.landcover.urbanPark.fill',
        'land.landcover.recreationGround.fill',
        'land.landuse.recreation.fill',
      ]) {
        assert.ok(indexOf(`land.landcover.${detail}.fill`) > indexOf(base));
      }
      assert.ok(indexOf(`land.landcover.${detail}.fill`) < indexOf('buildings.flat.fill'));
    }
  }
});

test('Streets parking surfaces cover vegetation but remain below roads', () => {
  for (const theme of ['light', 'dark'] as const) {
    const {inspection, style} = compileInspected(theme);
    const parking = requireLayer(style, 'tileflow-landuse-parking');
    const outline = requireLayer(style, 'tileflow-landuse-parking-outline');
    const fillIndex = style.layers.indexOf(parking);
    const outlineIndex = style.layers.indexOf(outline);
    assert.equal(parking.paint?.['fill-opacity'], 1);
    assert.equal(parking.minzoom, 15);
    assert.ok(outlineIndex > fillIndex);
    for (const layer of inspection.layers) {
      if (
        layer.contributions.some(
          ({target}) =>
            target.startsWith('land.landcover.') || target === 'land.landuse.recreation.fill',
        )
      ) {
        assert.ok(layer.index < fillIndex, `${layer.id} must not cover parking`);
      }
    }
    const firstRoad = style.layers.findIndex(
      (layer) => layer.metadata?.['tileflow:domain'] === 'roads',
    );
    assert.ok(outlineIndex < firstRoad);
    const accepts = featureFilter(parking.filter as never).filter;
    assert.equal(accepts({zoom: 17}, {type: 3, properties: {class: 'parking'}}), true);
    assert.equal(accepts({zoom: 17}, {type: 3, properties: {class: 'wood'}}), false);
  }
});

test('Streets contact shadows only shade raised buildings that meet the ground', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const extrusionIndex = style.layers.findIndex(
      (layer) => layer.id === 'tileflow-buildings-render-extrusion',
    );
    for (const role of ['shadowSoft', 'shadowCore']) {
      const layer = requireLayer(style, `tileflow-buildings-render-${role}`);
      const filter = featureFilter(layer.filter as never).filter;
      const accepts = (properties: Record<string, unknown>) =>
        filter({zoom: 18}, {type: 3, properties} as never);
      assert.equal(accepts({}), true);
      assert.equal(accepts({render_height: 12}), true);
      assert.equal(accepts({render_height: '12', render_min_height: '0'}), true);
      assert.equal(accepts({render_height: 12, render_min_height: 4}), false);
      assert.equal(accepts({render_height: 0}), false);
      for (const hide_3d of [true, 1, '1']) assert.equal(accepts({hide_3d}), false);
      assert.equal(layer.layout?.visibility, 'none');
      assert.equal(layer.metadata?.['tileflow:3d-toggle'], 'building');
      assert.ok(style.layers.indexOf(layer) < extrusionIndex);
      assert.equal(layer.paint?.['line-translate'], undefined);
      const opacity = createPropertyExpression(
        layer.paint?.['line-opacity'],
        styleSpec.paint_line['line-opacity'],
      );
      assert.equal(opacity.result, 'success');
      if (opacity.result === 'success') {
        assert.equal(opacity.value.evaluate({zoom: layer.minzoom!}), 0);
        assert.ok(opacity.value.evaluate({zoom: layer.minzoom! + 0.01}) < 0.005);
      }
    }
  }
});

test('Streets Dark retains every public render-stack contribution and refinement', () => {
  const light = compileInspected('light');
  const dark = compileInspected('dark');
  const semanticContributions = (compiled: typeof light) =>
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.flatMap((contribution) =>
        contribution.operations.length > 0
          ? [
              {
                operations: contribution.operations,
                owner: contribution.owner,
                target: contribution.target,
              },
            ]
          : [],
      ),
    );

  assert.deepEqual(semanticContributions(dark), semanticContributions(light));

  const darkContributions = dark.inspection.layers.flatMap((layer) =>
    layer.contributions.map((contribution) => ({...contribution, layerId: layer.id})),
  );
  const addedTargets = [
    'boundaries.render.admin2Background',
    'boundaries.render.admin4Background',
    'boundaries.render.admin6',
    'land.render.businessArea',
    'buildings.render.shadowSoft',
    'buildings.render.shadowCore',
    'buildings.render.extrusion',
    'labels.render.settlementMarker',
  ];
  for (const target of addedTargets) {
    const contribution = darkContributions.find((candidate) => candidate.target === target);
    assert.ok(contribution, `Missing public render target ${target}`);
    assert.deepEqual(contribution.operations, [{kind: 'pass', owner: contribution.owner, target}]);
    assert.ok(dark.style.layers.some((layer) => layer.id === contribution.layerId));
  }

  const pathTargets = ['pathway', 'footway', 'steps', 'pedestrian'].flatMap((roadClass) =>
    ['surface', 'bridge'].flatMap((structure) =>
      ['fill', 'casing'].map((phase) => `roads.classes.${roadClass}.${structure}.${phase}`),
    ),
  );
  const refinedTargets = [
    ...pathTargets,
    'roads.oneWayMarkers',
    'labels.places.country',
    'labels.places.state',
    'labels.places.city',
    'labels.places.town',
    'labels.places.village',
    'labels.places.neighborhood',
  ];
  for (const target of refinedTargets) {
    const contribution = darkContributions.find((candidate) => candidate.target === target);
    assert.ok(contribution, `Missing refined semantic target ${target}`);
    assert.ok(
      contribution.operations.some(
        (operation) => operation.kind === 'refinement' && operation.target === target,
      ),
      `Missing public refinement provenance for ${target}`,
    );
  }
});

test('Streets Dark keeps canonical POI category colors with themed sprites and identical ranked placement', () => {
  const light = compile('light');
  const dark = compile('dark');
  const categories = [
    'visitor-amenity',
    'retail',
    'food-drink',
    'sport-leisure',
    'religion',
    'public-services',
    'education',
    'medical',
    'lodging',
    'arts-entertainment',
    'park-nature',
    'landmark',
    'transport',
  ] as const;
  const darkCategoryColors = {
    'arts-entertainment': '#C786BC',
    education: '#B6A783',
    'food-drink': '#D8BD65',
    landmark: '#C786BC',
    lodging: '#AA94DA',
    medical: '#DC7C89',
    'park-nature': '#89B871',
    'public-services': '#8F9098',
    religion: '#9DAAB0',
    retail: '#94BCE3',
    'sport-leisure': '#89B871',
    transport: '#8296E6',
    'visitor-amenity': '#8F9098',
  } as const;

  assert.equal(
    dark.layers.some(({id}) => id === 'tileflow-addresses-labels'),
    true,
  );
  // Every category shares one importance order: the prominent tier and the rest.
  assert.deepEqual(
    dark.layers.filter(({id}) => id.startsWith('tileflow-poi')).map(({id}) => id),
    ['tileflow-poi', 'tileflow-poi-prominent'],
  );
  for (const id of ['tileflow-poi', 'tileflow-poi-prominent']) {
    const lightLayer = requireLayer(light, id);
    const darkLayer = requireLayer(dark, id);
    assert.notDeepEqual(darkLayer.layout?.['icon-image'], lightLayer.layout?.['icon-image']);
    assert.deepEqual(
      JSON.parse(JSON.stringify(darkLayer.layout?.['icon-image']).replace(/-dark(?=")/gu, '')),
      lightLayer.layout?.['icon-image'],
    );
    assert.deepEqual(darkLayer.layout?.['symbol-sort-key'], [
      '+',
      ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
      ['to-number', ['get', 'size_rank'], 17],
    ]);
    assert.equal(lightLayer.layout?.['icon-size'], 1);
    assert.deepEqual(lightLayer.layout?.['text-font'], ['Noto Sans Regular']);
    assert.deepEqual(darkLayer.layout?.['text-font'], lightLayer.layout?.['text-font']);
    assert.deepEqual(darkLayer.layout?.['icon-size'], lightLayer.layout?.['icon-size']);
    const textColor = createPropertyExpression(
      darkLayer.paint?.['text-color'],
      styleSpec.paint_symbol['text-color'] as never,
    );
    assert.equal(textColor.result, 'success');
    for (const category of categories) {
      assert.equal(
        String(
          (textColor.value as {evaluate: (...args: unknown[]) => unknown}).evaluate(
            {zoom: 16},
            {type: 1, properties: {category}},
          ),
        ),
        String(Color.parse(darkCategoryColors[category])),
        category,
      );
    }
    assert.equal(darkLayer.paint?.['text-halo-color'], '#252839');
  }
});

test('Streets keeps ferries subordinate and limits attributed hillshade to regional zooms', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const relief = requireLayer(style, 'tileflow-terrain-hillshade');
    assert.equal(relief.type, 'hillshade');
    assert.equal(relief.minzoom, 5);
    assert.equal(relief.maxzoom, 14);
    assert.equal(relief.paint?.['hillshade-exaggeration'], 0.23);
    const source = style.sources['tileflow-terrain'] as Record<string, unknown>;
    assert.equal(source.type, 'raster-dem');
    assert.equal(source.encoding, 'terrarium');
    assert.equal(source.url, 'https://tiles.mapterhorn.com/tilejson.json');
    assert.match(String(source.attribution), /mapterhorn.com\/attribution/u);
    assert.equal(style.terrain, undefined);
    const ferry = style.layers.find(({id}) => id.includes('ferry') && !id.includes('label'));
    assert.ok(ferry);
    assert.equal(ferry.minzoom, 8);
    assert.deepEqual(ferry.paint?.['line-opacity'], [
      'interpolate',
      ['linear'],
      ['zoom'],
      8,
      0,
      17,
      1,
    ]);
    assert.deepEqual(ferry.paint?.['line-dasharray'], [
      'step',
      ['zoom'],
      ['literal', [1, 0]],
      13,
      ['literal', [12, 4]],
    ]);
    assert.deepEqual(ferry.paint?.['line-width'], [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      14,
      0.5,
      20,
      1,
    ]);
    const label = style.layers.find(({id}) => id.includes('ferry') && id.includes('label'));
    assert.ok(label);
    assert.equal(label['source-layer'], 'transportation_name');
    assert.equal(label.minzoom, 15);
    assert.equal(label.layout?.['symbol-placement'], 'line');
    assert.equal(label.layout?.['text-transform'], 'uppercase');
    assert.equal(label.paint?.['text-color'], theme === 'light' ? '#2682D9' : '#8799BE');
    assert.equal(label.paint?.['text-halo-color'], theme === 'light' ? '#98DCFE' : '#18223B');
    const accepts = (properties: Record<string, string>) =>
      featureFilter(label.filter as never).filter({zoom: 16}, {type: 2, properties});
    for (const properties of [{class: 'ferry'}, {class: 'transit', subclass: 'ferry'}]) {
      assert.equal(accepts({...properties, name: 'Paulus Hook – Pier 11'}), true);
    }
    assert.equal(accepts({class: 'primary', name: 'Battery Place'}), false);
    assert.equal(accepts({class: 'ferry', name: ''}), false);
  }
});

// Compare evaluated output at the zoom boundaries, not only expression shapes.
function labelNumber(
  layer: ReturnType<typeof requireLayer>,
  property: string,
  z: number,
  properties = {},
) {
  const specification = styleSpec.layout_symbol[property as keyof typeof styleSpec.layout_symbol];
  const compiled = createPropertyExpression(layer.layout?.[property], specification);
  assert.equal(compiled.result, 'success', `${layer.id}.${property}`);
  if (compiled.result !== 'success') throw new Error('Invalid label expression');
  return compiled.value.evaluate({zoom: z}, {type: 1, properties});
}

test('Streets label scales follow the reference hierarchy across overview and street zooms', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const country = requireLayer(style, 'tileflow-label-place-country');
    const city = requireLayer(style, 'tileflow-label-place-city');
    const district = requireLayer(style, 'tileflow-label-place-neighborhood');
    assert.equal(labelNumber(country, 'text-size', 1, {rank: 2}), 11);
    assert.equal(labelNumber(country, 'text-size', 9, {rank: 2}), 22);
    assert.equal(labelNumber(country, 'text-size', 9, {rank: 4}), 19);
    assert.equal(labelNumber(country, 'text-size', 9, {rank: 5}), 17);
    assert.equal(country.paint?.['text-halo-width'], 1.25);
    assert.equal(labelNumber(city, 'text-size', 6, {rank: 2}), 18);
    assert.equal(labelNumber(city, 'text-size', 6, {rank: 6}), 16);
    assert.equal(labelNumber(city, 'text-size', 15, {rank: 10}), 20);
    assert.equal(labelNumber(district, 'text-size', 11, {class: 'suburb'}), 12);
    assert.equal(labelNumber(district, 'text-size', 15, {class: 'suburb'}), 16);
    assert.equal(labelNumber(district, 'text-size', 15, {class: 'neighbourhood'}), 15);
    assert.equal(district.paint?.['text-halo-width'], 1.3);
    assert.equal(district.paint?.['text-halo-blur'], 0);
    assert.deepEqual(requireLayer(style, 'tileflow-label-place-state').layout?.['text-font'], [
      'Noto Sans Bold',
    ]);
    for (const layer of style.layers.filter(
      (l) =>
        l.id.startsWith('tileflow-labels-render-street') &&
        l.layout?.['symbol-placement'] === 'line' &&
        l.layout?.['text-letter-spacing'] === 0.15,
    )) {
      assert.equal(layer.paint?.['text-halo-width'], 1);
      for (let z = 0; z <= 24; z += 0.25) {
        const size = labelNumber(layer, 'text-size', z);
        assert.ok(size >= 6.5 && size <= 16, `${layer.id} at z${z}: ${size}`);
      }
    }
    const numbers = requireLayer(style, 'tileflow-addresses-labels');
    assert.equal(numbers.minzoom, 17);
    assert.equal(numbers.layout?.['text-padding'], 20);
    assert.equal(labelNumber(numbers, 'text-size', 18), 11);
    assert.equal(labelNumber(numbers, 'text-size', 20), 13);
  }
});

test('Streets street names stay on the ground below buildings while destinations stay above', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const buildings = requireLayer(style, 'tileflow-buildings-render-extrusion');
    const names = style.layers.filter((layer) =>
      layer.id.startsWith('tileflow-labels-render-street'),
    );
    assert.equal(names.length, 7);
    const buildingIndex = style.layers.indexOf(buildings);
    const roadSurfaceIndex = style.layers.findLastIndex(
      (layer) => layer.metadata?.['tileflow:domain'] === 'roads',
    );
    for (const layer of names) {
      assert.ok(
        style.layers.indexOf(layer) > roadSurfaceIndex,
        `${layer.id} must cover road markings`,
      );
      assert.ok(
        style.layers.indexOf(layer) < buildingIndex,
        `${layer.id} must be occluded by buildings`,
      );
      assert.equal(layer.layout?.['symbol-placement'], 'line');
      assert.equal(layer.layout?.['text-pitch-alignment'], 'map');
      assert.equal(layer.layout?.['text-rotation-alignment'], 'map');
      assert.notEqual(layer.layout?.visibility, 'none');
      assert.equal(layer.layout?.['text-allow-overlap'] ?? false, false);
    }
    for (const id of [
      'tileflow-poi',
      'tileflow-poi-prominent',
      'tileflow-label-road-shield-detail',
    ]) {
      assert.ok(
        style.layers.indexOf(requireLayer(style, id)) > buildingIndex,
        `${id} must remain in the foreground`,
      );
    }
    const accepts = (properties: Record<string, unknown>) =>
      names.filter((layer) =>
        featureFilter(layer.filter as never).filter({zoom: 18}, {type: 2, properties}),
      );
    for (const roadClass of [
      'motorway',
      'trunk',
      'primary',
      'secondary',
      'tertiary',
      'minor',
      'residential',
      'unclassified',
      'service',
      'busway',
      'bus_guideway',
      'minor_construction',
    ]) {
      assert.equal(accepts({name: 'Main Street', class: roadClass}).length, 1, roadClass);
    }
    for (const subclass of [
      'path',
      'bridleway',
      'corridor',
      'footway',
      'cycleway',
      'steps',
      'pedestrian',
    ]) {
      assert.equal(accepts({name: 'Park path', class: 'path', subclass}).length, 1, subclass);
      assert.equal(
        accepts({name: 'Park path', class: 'path_construction', subclass}).length,
        1,
        subclass,
      );
    }
    for (const properties of [
      {class: 'minor'},
      {name: 'Ferry', class: 'ferry'},
      {name: 'Track', class: 'track'},
    ]) {
      assert.equal(accepts(properties).length, 0);
    }
    assert.equal(
      style.layers.some((layer) => layer.id === 'tileflow-label-road-minor'),
      false,
    );
  }
});

test('Streets places every POI category by World rank and density without anonymous clutter', () => {
  const style = compile('light');
  const ordinary = requireLayer(style, 'tileflow-poi');
  const prominent = requireLayer(style, 'tileflow-poi-prominent');
  const accepts = (
    layer: ReturnType<typeof requireLayer>,
    z: number,
    properties: Record<string, unknown>,
  ) => featureFilter(layer.filter as never).filter({zoom: z}, {type: 1, properties});
  const park = {category: 'park-nature', name: 'Park', filter_rank: 2, size_rank: 0};
  assert.equal(accepts(ordinary, 15, park), true);
  const {name: _name, ...unnamedPark} = park;
  const {filter_rank: _rank, ...unrankedPark} = park;
  assert.equal(accepts(ordinary, 15, unnamedPark), false);
  assert.equal(accepts(ordinary, 15, unrankedPark), false);
  assert.equal(accepts(ordinary, 15, {...park, size_rank: 17}), false);
  // One density for every category: rank 3 from World's last POI zoom, every rank from z17.
  const ordinaryLandmark = {category: 'landmark', name: 'Building', filter_rank: 3, size_rank: 16};
  assert.equal(accepts(ordinary, 15, ordinaryLandmark), true);
  const smallBusiness = {category: 'food-drink', name: 'Cafe', filter_rank: 5, size_rank: 16};
  assert.equal(accepts(ordinary, 16, smallBusiness), false);
  assert.equal(accepts(ordinary, 17, smallBusiness), true);
  // World's two most important ranks are placed before street and place names.
  const louvre = {category: 'arts-entertainment', name: 'Musée', filter_rank: 0, size_rank: 0};
  assert.equal(accepts(prominent, 14, louvre), true);
  assert.equal(accepts(ordinary, 14, louvre), false);
  assert.equal(accepts(prominent, 14, park), false);
  // Parking and toilets explain themselves and need no name.
  assert.equal(
    accepts(ordinary, 17, {
      category: 'visitor-amenity',
      type: 'parking',
      filter_rank: 4,
      size_rank: 9,
    }),
    true,
  );
  const parkLabel = {category: 'park-nature', filter_rank: 1, size_rank: 0};
  assert.equal(labelNumber(prominent, 'text-size', 15, parkLabel), 13);
  assert.equal(labelNumber(prominent, 'text-size', 17, parkLabel), 18);
  assert.equal(
    labelNumber(ordinary, 'text-size', 20, {category: 'food-drink', filter_rank: 3, size_rank: 16}),
    13,
  );
  assert.equal(
    labelNumber(ordinary, 'text-size', 17, {category: 'transport', filter_rank: 0, size_rank: 0}),
    13,
  );
  assert.equal(labelNumber(ordinary, 'text-padding', 16), 6);
  assert.equal(labelNumber(ordinary, 'text-padding', 17), 4);
});

test('Streets water uses a declared hosted italic face without a heavy halo', () => {
  const style = compile('light');
  for (const layer of style.layers.filter((l) => l.id.startsWith('tileflow-label-water-'))) {
    assert.deepEqual(layer.layout?.['text-font'], ['Noto Sans Italic']);
    assert.equal(layer.paint?.['text-halo-width'], 0);
  }
  const resolved = resolveMap(streets);
  assert.ok(resolved.glyphs?.fontStacks?.includes('Noto Sans Italic'));
});
