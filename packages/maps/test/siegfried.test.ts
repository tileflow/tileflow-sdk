import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {createStyle, defineMap, resolveMap} from '@tileflow/core';
import {siegfried, siegfriedFonts, siegfriedIcons} from '../src';

const iconIds = [
  'siegfried-forest',
  'siegfried-glacier',
  'siegfried-gravel',
  'siegfried-orchard',
  'siegfried-paper-grain',
  'siegfried-rock',
  'siegfried-scree',
  'siegfried-water-lines',
  'siegfried-wetland',
] as const;

const fontNames = [
  'Cormorant Garamond Italic',
  'Cormorant Garamond Regular',
  'Cormorant Garamond SemiBold',
] as const;

function compileSiegfried() {
  return createStyle(siegfried, {
    preparedAssets: {
      icons: {ids: iconIds, sprite: '/tileflow/icons/siegfried/sprite'},
    },
  });
}

test('Siegfried is an autonomous root with only its own assets', async () => {
  const source = await readFile(new URL('../src/official/siegfried.ts', import.meta.url), 'utf8');
  const resolved = resolveMap(siegfried);

  assert.deepEqual(siegfried.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal('extends' in siegfried, false);
  assert.doesNotMatch(source, /from ['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /extends\s*:/u);
  assert.deepEqual(resolved.icons, [siegfriedIcons]);
  assert.deepEqual(resolved.fonts, [siegfriedFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.aeroways?.enabled, false);
  assert.equal(resolved.modules?.poi?.preset, 'none');
  assert.equal(resolved.modules?.roads?.oneWayMarkers, false);
  assert.equal(resolved.modules?.roads?.roundabouts?.casing?.visible, false);
  assert.equal(resolved.modules?.roads?.roundabouts?.fill?.visible, false);
  assert.equal(resolved.modules?.vegetation?.enabled, false);
});

test('Siegfried compiles contours without hillshade or 3D terrain', () => {
  const style = compileSiegfried();
  const source = style.sources['siegfried-contours'];
  const ids = style.layers.map(({id}) => id);
  const contourIds = [
    'streets-terrain-contour-minor',
    'streets-terrain-contour-index',
    'streets-terrain-contour-labels',
  ];

  assert.deepEqual(validateStyleMin(style as never), []);
  assert.equal(style.terrain, undefined);
  assert.equal(
    ids.some((id) => id.includes('hillshade')),
    false,
  );
  assert.equal(source?.type, 'vector');
  assert.equal(source?.minzoom, 8);
  assert.equal(source?.maxzoom, 14);
  assert.equal(
    source?.attribution,
    'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  );
  assert.match(String((source?.tiles as string[] | undefined)?.[0]), /^tileflow-contour:\/\//u);
  for (const id of contourIds) assert.ok(ids.includes(id), `Missing contour layer ${id}`);

  const contourIndex = ids.indexOf('streets-terrain-contour-minor');
  assert.ok(contourIndex > ids.indexOf('streets-background'));
  assert.ok(contourIndex < ids.indexOf('streets-water'));
  assert.ok(contourIndex < ids.findIndex((id) => id.startsWith('streets-road-')));
  assert.ok(contourIndex < ids.indexOf('streets-label-place-city'));
  assert.ok(ids.indexOf('streets-terrain-contour-labels') < ids.indexOf('siegfried-glacier-mask'));
  assert.ok(
    ids.indexOf('siegfried-glacier-mask') < ids.indexOf('siegfried-landcover-glacier-pattern'),
  );
  assert.ok(ids.indexOf('siegfried-landcover-glacier-pattern') < ids.indexOf('streets-water'));
  assert.equal(
    ids.some((id) => id.startsWith('streets-road-circular-')),
    false,
  );
  assert.equal(ids.includes('streets-vegetation-trees'), false);
});

test('Siegfried references every and only its nine engraved patterns', () => {
  const style = compileSiegfried();
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );

  assert.deepEqual([...patternIds].sort(), [...iconIds]);
  const layerIds = new Set(style.layers.map(({id}) => id));
  for (const id of [
    'siegfried-landcover-forest-pattern',
    'siegfried-landcover-glacier-pattern',
    'siegfried-landcover-gravel-pattern',
    'siegfried-landcover-orchard-pattern',
    'siegfried-landcover-rock-pattern',
    'siegfried-landcover-scree-pattern',
    'siegfried-landcover-wetland-pattern',
    'siegfried-water-lines-pattern',
    'siegfried-water-intermittent-lines-pattern',
  ]) {
    assert.ok(layerIds.has(id), `Missing Siegfried effect layer ${id}`);
  }

  const scree = style.layers.find(({id}) => id === 'siegfried-landcover-scree-pattern');
  const rock = style.layers.find(({id}) => id === 'siegfried-landcover-rock-pattern');
  assert.match(JSON.stringify(scree?.filter), /subclass/u);
  assert.match(JSON.stringify(scree?.filter), /scree/u);
  assert.match(JSON.stringify(rock?.filter), /\["scree","talus"\],false,true/u);
});

test('Siegfried keeps hydrography blue while engraving water names in black', () => {
  const style = compileSiegfried();
  const water = style.layers.find(({id}) => id === 'streets-water');
  const waterLabels = style.layers.filter(({id}) => id.startsWith('streets-label-water-'));

  assert.equal((water?.paint as Record<string, unknown>)['fill-color'], '#5D90D0');
  assert.ok(waterLabels.length >= 4);
  for (const label of waterLabels) {
    assert.equal(
      (label.paint as Record<string, unknown>)['text-color'],
      '#171713',
      `${label.id} should use black engraving ink`,
    );
  }
});

test('Siegfried removes landcover-backed glacier engraving when land is disabled', () => {
  const child = defineMap({
    id: 'siegfried-without-land',
    version: 1,
    extends: siegfried,
    modules: {land: {type: 'land', enabled: false}},
  });
  const style = createStyle(child, {
    preparedAssets: {icons: {ids: iconIds, sprite: '/tileflow/icons/siegfried/sprite'}},
  });
  const ids = new Set(style.layers.map(({id}) => id));

  assert.equal(ids.has('siegfried-glacier-mask'), false);
  assert.equal(ids.has('siegfried-landcover-glacier-pattern'), false);
  assert.equal(ids.has('siegfried-glacier-outline'), false);
});

test('Siegfried uses only its three inks and paper in Style and SVG sources', async () => {
  const allowed = new Set(['#000000', '#171713', '#5D90D0', '#A96C4D', '#F0EBE0']);
  const style = compileSiegfried();
  const renderedStyle = {
    light: style.light,
    layers: style.layers.map(({layout, paint}) => ({layout, paint})),
  };
  const styleColors = JSON.stringify(renderedStyle).match(/#[0-9A-F]{6}/giu) ?? [];
  assert.ok(styleColors.length > 40);
  for (const color of styleColors) {
    assert.ok(allowed.has(color.toUpperCase()), `Unexpected Siegfried Style colour ${color}`);
  }

  const iconsDirectory = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../assets/siegfried/icons',
  );
  const files = (await readdir(iconsDirectory)).filter((file) => file.endsWith('.svg')).sort();
  assert.deepEqual(
    files,
    iconIds.map((id) => `${id}.pattern.svg`),
  );
  for (const file of files) {
    const svg = await readFile(path.join(iconsDirectory, file), 'utf8');
    const colors = svg.match(/#[0-9A-F]{6}/giu) ?? [];
    assert.ok(colors.length > 0, `${file} has no explicit ink colour`);
    for (const color of colors) {
      assert.ok(allowed.has(color.toUpperCase()), `Unexpected colour ${color} in ${file}`);
    }
  }
});

test('Siegfried emits only the three packaged Cormorant faces', () => {
  const style = compileSiegfried();
  const actual = new Set(
    style.layers.flatMap((layer) => {
      const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
      return Array.isArray(font) && typeof font[0] === 'string' ? [font[0]] : [];
    }),
  );

  assert.deepEqual([...actual].sort(), [...fontNames]);
  assert.equal(style.glyphs, undefined);
});
