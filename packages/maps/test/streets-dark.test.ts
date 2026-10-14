import {featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, resolveMap, resolveTileflowTheme} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {streets, streetsIcons, streetsThemes} from '../src';

const streetsIconIds = [
  'coffee',
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
] as const;

const preparedAssets = {
  preparedAssets: {
    icons: {
      ids: streetsIconIds,
      sprite: '/tileflow/test/streets-dark/sprite',
    },
  },
} as const;

// Reviewed physical colors for the Streets v12 light palette and coordinated night theme.
const approvedLightStyleColors = new Set([
  '#000000',
  '#15AFFA59',
  '#1B1D27',
  '#1E3A8A',
  '#242624',
  '#2563EB',
  '#268F15',
  '#29B5FD59',
  '#303230',
  '#31ADC4',
  '#333333',
  '#4682A8',
  '#4995DF',
  '#557BC4',
  '#5A88A9',
  '#5C74D6',
  '#666666',
  '#6666CC',
  '#667C9E',
  '#6ECEFE59',
  '#777777',
  '#7979D2',
  '#8A756B',
  '#8B8E99',
  '#8E909D',
  '#94A3B8',
  '#99DDFF',
  '#99DDFF59',
  '#A05FE3',
  '#A46D37',
  '#ACDE9FCC',
  '#AED7A5',
  '#B8AEA8',
  '#B8EBAD',
  '#BDDFAF',
  '#BEDFAE99',
  '#BFE6AE',
  '#C0E8B5',
  '#C8C8CF',
  '#CDEBC6',
  '#CFC8C4',
  '#CFEFB9',
  '#D2CAC4',
  '#D4EBF7',
  '#D68D05',
  '#D7E9DE',
  '#D9D3CE',
  '#D9EFD066',
  '#D9EFD099',
  '#DBEAFE',
  '#DED6D1',
  '#DF4949',
  '#E0E2EB',
  '#E35FB7',
  '#E5C951',
  '#E99F56',
  '#E9E6E7',
  '#E9E8ED',
  '#EBE1D8',
  '#ECE8E4',
  '#F0E6D1',
  '#F0ECC6',
  '#F2F0EB',
  '#F4F0EF',
  '#F5E0E0',
  '#F5F2F0',
  '#F7E36E',
  '#F7F2E3',
  '#FBF0BA',
  '#FFB366',
  '#FFE0BF',
  '#FFFFFF',
  'RGBA(0, 0, 0, 0)',
  'RGBA(255, 255, 255, 0.7)',
]);

// This is the final compiler output, not only the authoring palette. It intentionally
// includes Core-derived blends and the unreachable #000000 expression fallback so any
// new physical color requires an explicit dark-map review.
const approvedDarkStyleColors = new Set([
  '#000000',
  '#081022A8',
  '#0B1220',
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
  '#33474A',
  '#343646',
  '#34453F',
  '#373A46',
  '#373B49',
  '#374440',
  '#393B49',
  '#394842',
  '#3A3C49',
  '#3A4550',
  '#3B4943',
  '#3D414D',
  '#3E4B47',
  '#434247',
  '#453D48',
  '#45424E',
  '#454956',
  '#454A59',
  '#45534D',
  '#46564D',
  '#485650',
  '#4C505E',
  '#4D5852',
  '#4D5D54',
  '#4E5260',
  '#505264',
  '#505462',
  '#52503E',
  '#525664',
  '#555867',
  '#565A68',
  '#5B5D70',
  '#5F6475',
  '#5F9169',
  '#60A5FA',
  '#636779',
  '#63756A',
  '#64748B',
  '#6F7188',
  '#70768A',
  '#76586D',
  '#76B59A',
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
  '#D69A58',
  '#DC7C89',
  '#EFF6FF',
  '#FFFFFF',
  'RGBA(0, 0, 0, 0)',
  'RGBA(37, 40, 57, 0.82)',
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
    layout: layer.layout,
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

  assert.match(
    JSON.stringify(requireLayer(dark, 'tileflow-background').paint?.['background-color']),
    /#2D3043/u,
  );
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
    '#ADB3C3',
    '#B1EAAC',
    '#BEC5D8',
    '#D49399',
    '#D5E8D0',
    '#F3E9DF',
    '#F4F0EF',
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

  const roadLabel = requireLayer(style, 'tileflow-label-road-minor');
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

test('Streets keeps road decks separate from darker casings at close zooms', () => {
  const expected = {
    light: {casing: '#D9D3CE', deck: '#FFFFFF'},
    dark: {casing: '#454A59', deck: '#636779'},
  } as const;

  for (const theme of ['light', 'dark'] as const) {
    const style = compile(theme);
    const surfaceCasing = requireLayer(style, 'tileflow-road-surface-highzoom-local-casing');
    const bridgeCasing = requireLayer(style, 'tileflow-road-bridge-highzoom-local-casing');
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
      const width = layer.paint?.['line-width'];
      assert.ok(Array.isArray(width));
      assert.deepEqual(width.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 6]);
      assert.equal(width[5], 12);
      assert.equal(width[7], 15);
      assert.equal(width[9], 18);
      assert.equal(width[11], 22);
      for (const [outputIndex, expectedWidth] of [
        [4, 0.4],
        [6, 0.55],
        [8, 0.75],
        [10, 1],
        [12, 1.5],
      ] as const) {
        const output = width[outputIndex];
        assert.ok(Array.isArray(output));
        assert.equal(output.at(-1), expectedWidth);
      }
    }

    for (const family of ['local', 'arterial', 'major']) {
      const tunnel = requireLayer(style, `tileflow-road-tunnel-highzoom-${family}-casing`);
      assert.deepEqual(tunnel.paint?.['line-dasharray'], [3, 3]);
    }
  }
});

test('Streets v12 hierarchy separates highways, buildings, destinations, and pedestrian ground', () => {
  const style = compile('light');
  for (const structure of ['surface', 'bridge', 'tunnel']) {
    const motorway = requireLayer(style, `tileflow-road-${structure}-motorway-fill`);
    const trunk = requireLayer(style, `tileflow-road-${structure}-trunk-fill`);
    const minor = requireLayer(style, `tileflow-road-${structure}-minor-fill`);
    assert.match(
      JSON.stringify(motorway.paint?.['line-color']),
      structure === 'tunnel' ? /#FFE0BF/u : /#FFB366/u,
    );
    assert.match(
      JSON.stringify(trunk.paint?.['line-color']),
      structure === 'tunnel' ? /#FBF0BA/u : /#F7E36E/u,
    );
    assert.match(
      JSON.stringify(minor.paint?.['line-color']),
      structure === 'tunnel' ? /#F5F2F0/u : /#FFFFFF/u,
    );
  }
  assert.equal(requireLayer(style, 'tileflow-boundary-admin2').paint?.['line-color'], '#6666CC');
  assert.equal(requireLayer(style, 'tileflow-boundary-admin4').paint?.['line-color'], '#7979D2');
  for (const family of ['city', 'town', 'village']) {
    assert.equal(requireLayer(style, `tileflow-label-place-${family}`).maxzoom, 13);
  }
  const country = requireLayer(style, 'tileflow-label-place-country');
  assert.match(JSON.stringify(country.filter), /"rank"/u);
  assert.deepEqual(country.layout?.['text-font'], ['Noto Sans Regular']);
  const neighborhood = requireLayer(style, 'tileflow-label-place-neighborhood');
  assert.equal(neighborhood.maxzoom, 15);
  assert.deepEqual(neighborhood.layout?.['text-font'], ['Noto Sans Regular']);
  const roadLabels = style.layers.filter(
    (layer) =>
      layer.id.startsWith('tileflow-label-road-') &&
      layer.type === 'symbol' &&
      !layer.id.includes('shield') &&
      !layer.id.endsWith('junction'),
  );
  assert.ok(roadLabels.length > 0);
  for (const layer of roadLabels) {
    if (!layer.layout?.['text-field']) continue;
    assert.equal(layer.layout?.['text-transform'], 'none');
    assert.equal(layer.layout?.['text-letter-spacing'], 0.01);
  }
  const buildings = requireLayer(style, 'tileflow-buildings-fill');
  assert.equal(buildings.paint?.['fill-color'], '#DED6D1');
  assert.equal(buildings.minzoom, 15);
  assert.deepEqual(buildings.paint?.['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0,
    16,
    1,
  ]);
  assert.ok(
    contrastRatio('#FFFFFF', '#DED6D1') > 1.4,
    'Footprints must separate white streets from blocks',
  );
  const pedestrian = requireLayer(style, 'tileflow-road-pedestrian-area');
  const paving = requireLayer(style, 'tileflow-roads-render-pedestrianPattern');
  const pavingFilter = featureFilter(paving.filter as never);
  const pedestrianFilter = featureFilter(pedestrian.filter as never);
  for (const type of [1, 2, 3] as const) {
    for (const roadClass of ['path', 'path_construction', 'minor', 'pier']) {
      for (const subclass of ['pedestrian', 'footway', 'cycleway']) {
        const feature = {type, properties: {class: roadClass, subclass}};
        assert.equal(
          pavingFilter.filter({zoom: 17}, feature),
          pedestrianFilter.filter({zoom: 17}, feature),
          'Paving must preserve the pedestrian polygon guard',
        );
      }
    }
  }
  assert.equal(paving['source-layer'], pedestrian['source-layer']);
  assert.equal(paving.minzoom, 16);
  assert.equal(paving.paint?.['fill-pattern'], 'sidewalk-dot');
  assert.equal(requireLayer(style, 'tileflow-sidewalk-pattern').minzoom, 16);
  assert.equal(requireLayer(style, 'tileflow-addresses-labels').minzoom, 17);
  assert.equal(style.terrain, undefined);
  assert.equal(style.sky, undefined, 'Atmosphere stays opt-in for Mercator and native consumers');
  assert.deepEqual(
    requireLayer(style, 'tileflow-label-place-city').layout?.['text-variable-anchor'],
    ['right'],
  );
  assert.equal(
    style.layers.some((layer) => layer.id === 'tileflow-vegetation-trees'),
    false,
  );
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

test('Streets Dark keeps canonical POI category colors around the same ranked sprites', () => {
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
    education: '#8F9098',
    'food-drink': '#D69A58',
    landmark: '#C786BC',
    lodging: '#AA94DA',
    medical: '#DC7C89',
    'park-nature': '#76B59A',
    'public-services': '#8F9098',
    religion: '#C786BC',
    retail: '#76B59A',
    'sport-leisure': '#76B59A',
    transport: '#8296E6',
    'visitor-amenity': '#8F9098',
  } as const;

  assert.equal(
    dark.layers.some(({id}) => id === 'tileflow-addresses-labels'),
    true,
  );
  for (const category of categories) {
    const id = `tileflow-poi-${category}`;
    const lightLayer = requireLayer(light, id);
    const darkLayer = requireLayer(dark, id);
    assert.deepEqual(darkLayer.layout?.['icon-image'], lightLayer.layout?.['icon-image']);
    assert.deepEqual(darkLayer.layout?.['symbol-sort-key'], [
      '+',
      ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
      ['to-number', ['get', 'size_rank'], 17],
    ]);
    assert.deepEqual(lightLayer.layout?.['icon-size'], [
      'interpolate',
      ['linear'],
      ['zoom'],
      12,
      0.68,
      17,
      0.76,
    ]);
    assert.deepEqual(darkLayer.layout?.['icon-size'], lightLayer.layout?.['icon-size']);
    assert.equal(darkLayer.paint?.['text-color'], darkCategoryColors[category]);
    assert.equal(darkLayer.paint?.['text-halo-color'], '#252839');
  }
});
