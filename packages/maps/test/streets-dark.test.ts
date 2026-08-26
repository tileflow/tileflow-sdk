import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, resolveMap} from '@tileflow/core';
import {getResolvedModuleEffects} from '@tileflow/core/recipe';
import {streets, streetsDark, streetsDarkIcons, streetsIcons} from '../src';

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
  'services',
  'shopping',
  'sidewalk-dot',
] as const;

const preparedAssets = {
  preparedAssets: {
    icons: {
      ids: streetsIconIds,
      sprite: '/tileflow/test/streets-dark/sprite',
    },
  },
} as const;

// This is the final compiler output, not only the authoring palette. It intentionally
// includes Core-derived blends and the unreachable #000000 expression fallback so any
// new physical color requires an explicit dark-map review.
const approvedDarkStyleColors = new Set([
  '#000000',
  '#05182AA8',
  '#070B12',
  '#071D32A8',
  '#09243AA8',
  '#0B1220',
  '#10324B',
  '#10324BA8',
  '#151E2D',
  '#18353A',
  '#1B2533',
  '#1B2F29',
  '#1F352A',
  '#202B3A',
  '#20382B',
  '#203A31',
  '#21382F',
  '#222B38',
  '#223341',
  '#253C2E',
  '#254034',
  '#263043',
  '#263449',
  '#263D2C',
  '#28313E',
  '#283548',
  '#284236',
  '#285033',
  '#294237',
  '#29452F',
  '#294934',
  '#2A3443',
  '#2B3544',
  '#2C3949',
  '#2D2929',
  '#2F4B3C',
  '#314A3C',
  '#315444',
  '#342E27',
  '#35435C',
  '#365441',
  '#38475D',
  '#3A3228',
  '#3A3326',
  '#3A4655',
  '#3A4657',
  '#3B485D',
  '#3C5B46',
  '#3D4B60',
  '#3D596F',
  '#3D806E',
  '#3F6C49',
  '#424E60',
  '#445267',
  '#45536A',
  '#465164',
  '#4C5A70',
  '#4F5B76',
  '#536177',
  '#55A86C',
  '#62718F',
  '#68778B',
  '#687993',
  '#75AFC4',
  '#80566C',
  '#8FA8FF',
  '#9A6177',
  '#9AA9B8',
  '#9FB6D0',
  '#CBD5E1',
  '#E8EDF3',
  'RGBA(0, 0, 0, 0)',
  'RGBA(11, 18, 32, 0.78)',
]);

function compile(map: Parameters<typeof createStyle>[0]) {
  return createStyle(map, preparedAssets);
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

test('Streets Dark is a dark Streets descendant with a reviewed icon override', () => {
  assert.equal(streetsDark.extends, streets);

  const resolvedStreets = resolveMap(streets);
  const resolvedDark = resolveMap(streetsDark);
  assert.equal(resolvedDark.id, 'streets-dark');
  assert.deepEqual(resolvedDark.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal(
    typeof resolvedDark.theme === 'object' ? resolvedDark.theme.mode : undefined,
    'dark',
  );
  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedDark.icons, [streetsIcons, streetsDarkIcons]);
  assert.deepEqual(resolvedDark.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedDark.light, {
    anchor: 'viewport',
    color: '#9FB6D0',
    intensity: 0.08,
    position: [1.15, 210, 30],
  });

  const style = compile(streetsDark);
  assert.equal(style.metadata?.['tileflow:map'], 'streets-dark');
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
  assert.deepEqual(style.metadata?.['tileflow:extends'], ['streets']);
  assert.equal(style.metadata?.['tileflow:variant'], 'dark');
  assert.equal(style.sprite, '/tileflow/test/streets-dark/sprite');
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('Streets Dark preserves Streets geometry, ordering, visibility, and label behavior', () => {
  const light = compile(streets);
  const dark = compile(streetsDark);
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
  const light = compile(streets);
  const dark = compile(streetsDark);
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

  assert.equal(requireLayer(dark, 'streets-background').paint?.['background-color'], '#151E2D');
  assert.equal(requireLayer(dark, 'streets-water').paint?.['fill-color'], '#10324B');
  assert.equal(requireLayer(dark, 'streets-buildings-fill').paint?.['fill-color'], '#202B3A');
  assert.equal(
    requireLayer(dark, 'streets-buildings-3d').paint?.['fill-extrusion-color'],
    '#283548',
  );
  assert.equal(
    requireLayer(dark, 'streets-landuse-business-area').paint?.['fill-color'],
    '#2D2929',
  );

  const serialized = JSON.stringify(dark).toUpperCase();
  for (const lightSignature of [
    '#3C3834',
    '#99DDFF',
    '#B3EBAD',
    '#BFC6D9',
    '#CCE2CA',
    '#DED7D3',
    '#F5F1F0',
    '#FF668C',
    '#FFFFFF',
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
  const style = compile(streetsDark);
  const ordinaryRoad = '#45536A';
  const ordinaryTunnel = '#3D4B60';
  const trunkRoad = '#62718F';
  const motorwayRoad = '#687993';

  assert.match(
    JSON.stringify(requireLayer(style, 'streets-road-bridge-minor-fill').paint),
    /#45536A/u,
  );
  assert.equal(
    requireLayer(style, 'streets-road-tunnel-minor-fill').paint?.['line-color'],
    ordinaryTunnel,
  );
  assert.match(
    JSON.stringify(requireLayer(style, 'streets-road-bridge-trunk-fill').paint),
    /#62718F/u,
  );
  assert.match(
    JSON.stringify(requireLayer(style, 'streets-road-bridge-motorway-fill').paint),
    /#687993/u,
  );
  assert.ok(relativeLuminance(ordinaryTunnel) < relativeLuminance(ordinaryRoad));
  assert.ok(relativeLuminance(ordinaryRoad) < relativeLuminance(trunkRoad));
  assert.ok(relativeLuminance(trunkRoad) < relativeLuminance(motorwayRoad));

  const cityLabel = requireLayer(style, 'streets-label-place-city');
  assert.match(JSON.stringify(cityLabel.paint?.['text-color']), /#E8EDF3/u);
  assert.equal(cityLabel.paint?.['text-halo-color'], '#0B1220');
  const waterLabel = requireLayer(style, 'streets-label-water-ocean');
  assert.equal(waterLabel.paint?.['text-color'], '#75AFC4');

  for (const [name, foreground, background] of [
    ['place label on land', '#E8EDF3', '#151E2D'],
    ['secondary label on land', '#CBD5E1', '#151E2D'],
    ['water label on water', '#75AFC4', '#10324B'],
    ['road label on an ordinary road', '#E8EDF3', ordinaryRoad],
  ] as const) {
    assert.ok(contrastRatio(foreground, background) >= 4.5, `${name} fell below 4.5:1 contrast`);
  }
});

test('Streets Dark retains every owner-scoped Streets effect while recoloring its payload', () => {
  const lightEffects = getResolvedModuleEffects(streets);
  const darkEffects = getResolvedModuleEffects(streetsDark);
  const identity = (effect: (typeof lightEffects)[number]) => ({
    kind: effect.kind,
    owner: effect.owner,
    placement: effect.kind === 'add' ? effect.placement : undefined,
    target: effect.target,
  });

  assert.deepEqual(darkEffects.map(identity), lightEffects.map(identity));
  assert.notDeepEqual(darkEffects, lightEffects);
  const targets = new Set(darkEffects.map((effect) => effect.target));
  for (const target of [
    'boundaries.admin2.background',
    'land.landuse.businessArea.fill',
    'buildings.effects.shadowSoft',
    'buildings.effects.shadowCore',
    'buildings.effects.extrusion',
    'labels.places.settlementMarker',
    'poi.parking.disc',
    'poi.parking.label',
    'roads.oneWayMarkers',
  ]) {
    assert.equal(targets.has(target), true, `Missing recolored effect ${target}`);
  }

  const styleIds = new Set(compile(streetsDark).layers.map((layer) => layer.id));
  for (const id of [
    'streets-boundary-admin2-background',
    'streets-landuse-business-area',
    'streets-buildings-3d-shadow-soft',
    'streets-buildings-3d-shadow-core',
    'streets-buildings-3d',
    'streets-label-place-settlement-marker',
  ]) {
    assert.equal(styleIds.has(id), true, `Missing compiled dark effect ${id}`);
  }
});
