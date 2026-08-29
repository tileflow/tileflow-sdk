import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyle, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {baedeker, baedekerFonts, baedekerIcons, ferraris} from '../src';

const baedekerPatternIds = [
  'baedeker-hachures',
  'baedeker-orchard',
  'baedeker-paper-grain',
  'baedeker-park-stipple',
  'baedeker-residential',
  'baedeker-sand',
  'baedeker-water-lines',
  'baedeker-wetland',
] as const;

const preparedAssets = {
  icons: {ids: baedekerPatternIds, sprite: '/tileflow/icons/baedeker/sprite'},
} as const;

const ferrarisPatternIds = [
  'ferraris-crop-hatch',
  'ferraris-heath',
  'ferraris-orchard',
  'ferraris-paper-grain',
  'ferraris-residential',
  'ferraris-sand',
  'ferraris-water-ripples',
  'ferraris-wetland',
  'ferraris-woodland',
] as const;

test('Baedeker is a deeply frozen standalone map with only its own assets', async () => {
  assert.equal(baedeker.id, 'baedeker');
  assert.equal(baedeker.name, 'Baedeker');
  assert.equal('root' in baedeker, false);
  assert.equal('extends' in baedeker, false);
  assertDeepFrozen(baedeker);

  const source = await readFile(new URL('../src/official/baedeker.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineMap\s*\(/u);
  assert.doesNotMatch(
    source,
    /from\s+['"]\.\/(?:cyberpunk|ferraris|harad|matrix|siegfried|soundings|streets|verdant)['"]/u,
  );
  assert.doesNotMatch(source, /\bextends\s*:/u);
  assert.doesNotMatch(
    source,
    /@tileflow\/core\/recipe|defineModuleEffects|semanticField|semanticLayer/u,
  );

  const resolved = resolveMap(baedeker);
  assert.deepEqual(resolved.icons, [baedekerIcons]);
  assert.deepEqual(resolved.fonts, [baedekerFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.poi?.type, 'poi');
  assert.equal(resolved.modules?.poi?.icons, false);
  assert.equal(resolved.modules?.poi?.labels, true);
  assert.deepEqual(resolved.modules?.poi?.categories, [
    'transport',
    'landmark',
    'lodging',
    'religion',
    'arts-entertainment',
    'public-services',
  ]);
  assert.equal(resolved.modules?.labels?.junctions, false);
  assert.equal(resolved.modules?.labels?.shields, 'none');
  assert.equal(resolved.modules?.roads?.oneWayMarkers, false);
  assert.deepEqual(resolved.view, {
    bearing: 0,
    center: [12.4964, 41.9028],
    pitch: 0,
    zoom: 15.25,
  });
});

test('Baedeker compiles its exact pattern vocabulary and semantic travel-atlas stack', () => {
  const compiled = createStyleWithInspection(baedeker, {preparedAssets});
  const {style} = compiled;

  assert.equal(style.metadata?.['tileflow:map'], 'baedeker');
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.sprite, '/tileflow/icons/baedeker/sprite');
  assert.equal(style.glyphs, undefined);
  assert.deepEqual(validateStyleMin(style as never), []);

  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...baedekerPatternIds]);

  const targets = compiledTargets(compiled);
  for (const target of [
    'buildings.render.engravedBlocks',
    'land.render.rockHachures',
    'land.render.scrubHachures',
    'land.render.orchardTexture',
    'land.render.sandTexture',
    'land.render.wetlandTexture',
    'land.render.parkStipple',
    'land.render.woodStipple',
    'land.render.residentialTexture',
    'water.render.printLines',
    'water.render.intermittentPrintLines',
  ]) {
    assert.equal(targets.has(target), true, `Missing Baedeker render target ${target}`);
  }
  assert.equal(targets.has('buildings.render.printShadow'), false);

  const layerIds = new Set(style.layers.map(({id}) => id));
  for (const id of ['tileflow-addresses', 'tileflow-bathymetry', 'tileflow-road-oneway']) {
    assert.equal(layerIds.has(id), false, `Baedeker emitted modern detail layer ${id}`);
  }
  for (const category of [
    'transport',
    'landmark',
    'lodging',
    'religion',
    'arts-entertainment',
    'public-services',
  ]) {
    assert.equal(layerIds.has(`tileflow-poi-${category}-label`), true);
    assert.equal(layerIds.has(`tileflow-poi-${category}-icon`), false);
  }
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-buildings-fill')?.paint?.['fill-color'],
    '#D89270',
  );
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-buildings-render-engravedBlocks')?.paint?.[
      'fill-pattern'
    ],
    'baedeker-residential',
  );
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-road-surface-primary-fill')?.paint?.['line-color'],
    '#F1E4CA',
  );
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-road-surface-primary-casing')?.paint?.[
      'line-color'
    ],
    '#A95842',
  );
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-transit-rail-surface')?.paint?.['line-color'],
    '#211E1D',
  );
  assert.equal(
    style.layers.find(({id}) => id === 'tileflow-water')?.paint?.['fill-color'],
    '#9DC8CC',
  );
  assert.deepEqual(
    style.layers.find(({id}) => id === 'tileflow-label-road-minor')?.layout?.['text-font'],
    ['Cormorant Garamond Italic'],
  );
  assert.deepEqual(
    style.layers.find(({id}) => id === 'tileflow-label-place-city')?.layout?.['text-font'],
    ['Cormorant Garamond SemiBold'],
  );
});

test('Baedeker compiles Mapterhorn contours without enabling raster terrain or hillshade', () => {
  const style = createStyle(baedeker, {preparedAssets});
  const source = style.sources['baedeker-contours'];
  const ids = style.layers.map(({id}) => id);

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
  const contourUrl = new URL(String((source?.tiles as string[] | undefined)?.[0]));
  assert.equal(contourUrl.protocol, 'tileflow-contour:');
  assert.equal(
    contourUrl.searchParams.get('thresholds'),
    '8:200,1000;10:100,500;12:50,250;14:25,100',
  );

  for (const id of [
    'tileflow-terrain-contour-minor',
    'tileflow-terrain-contour-index',
    'tileflow-terrain-contour-labels',
  ]) {
    assert.ok(ids.includes(id), `Missing contour layer ${id}`);
  }
  const contourIndex = ids.indexOf('tileflow-terrain-contour-minor');
  assert.ok(contourIndex > ids.indexOf('tileflow-background'));
  assert.ok(contourIndex < ids.indexOf('tileflow-water'));
  assert.ok(contourIndex < ids.findIndex((id) => id.startsWith('tileflow-road-')));
  assert.ok(contourIndex < ids.indexOf('tileflow-label-place-city'));

  const contourLabels = style.layers.find(({id}) => id === 'tileflow-terrain-contour-labels');
  assert.deepEqual(contourLabels?.layout?.['text-font'], ['Cormorant Garamond Regular']);
});

test('Baedeker publishes exactly eight original intrinsic-size patterns', async () => {
  assert.deepEqual(
    (await readdir(new URL('../assets/baedeker/icons/', import.meta.url))).sort(),
    baedekerPatternIds.map((id) => `${id}.pattern.svg`),
  );
});

test('Baedeker emits only its three packaged Cormorant faces', () => {
  const style = createStyle(baedeker, {preparedAssets});
  const faces = new Set(
    style.layers.flatMap((layer) => {
      const font = layer.layout?.['text-font'];
      return Array.isArray(font) ? font : [];
    }),
  );

  assert.deepEqual(
    faces,
    new Set([
      'Cormorant Garamond Italic',
      'Cormorant Garamond Regular',
      'Cormorant Garamond SemiBold',
    ]),
  );
});

test('Baedeker keeps a distinct engraved travel-plan grammar from Ferraris', () => {
  const baedekerStyle = createStyle(baedeker, {preparedAssets});
  const ferrarisStyle = createStyle(ferraris, {
    preparedAssets: {
      icons: {ids: ferrarisPatternIds, sprite: '/tileflow/icons/ferraris/sprite'},
    },
  });
  const baedekerById = new Map(baedekerStyle.layers.map((layer) => [layer.id, layer]));
  const ferrarisById = new Map(ferrarisStyle.layers.map((layer) => [layer.id, layer]));

  assert.ok(baedekerById.has('tileflow-buildings-render-engravedBlocks'));
  assert.equal(baedekerById.has('tileflow-buildings-render-printShadow'), false);
  assert.equal(ferrarisById.has('tileflow-buildings-render-printShadow'), true);
  assert.equal(ferrarisById.has('tileflow-buildings-render-engravedBlocks'), false);
  assert.notDeepEqual(
    baedekerById.get('tileflow-buildings-fill')?.paint?.['fill-opacity'],
    ferrarisById.get('tileflow-buildings-fill')?.paint?.['fill-opacity'],
  );
  assert.deepEqual(baedekerById.get('tileflow-label-road-minor')?.layout?.['text-font'], [
    'Cormorant Garamond Italic',
  ]);
  assert.deepEqual(ferrarisById.get('tileflow-label-road-minor')?.layout?.['text-font'], [
    'Noto Sans Regular',
  ]);
  assert.equal(baedekerById.has('tileflow-poi-transport-label'), true);
  assert.equal(ferrarisById.has('tileflow-poi-transport-label'), false);
  assert.notEqual(
    baedekerById.get('tileflow-water')?.paint?.['fill-color'],
    ferrarisById.get('tileflow-water')?.paint?.['fill-color'],
  );
});

test('Baedeker stays valid against generic OpenMapTiles without optional capabilities', () => {
  const data = vectorTiles({
    attribution: 'Fixture data',
    schema: openMapTiles({
      capabilities: {
        bathymetry: false,
        businessCorridor: false,
        globalLandcover: false,
        tree: false,
      },
    }),
    tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  });
  const style = createStyle({...baedeker, data}, {preparedAssets});
  const layerIds = new Set(style.layers.map(({id}) => id));

  assert.equal(layerIds.has('tileflow-bathymetry'), false);
  assert.equal(layerIds.has('tileflow-global-landcover'), false);
  assert.ok(style.sources['baedeker-contours']);
  assert.deepEqual(validateStyleMin(style as never), []);
});

function compiledTargets(
  compiled: ReturnType<typeof createStyleWithInspection>,
): ReadonlySet<string> {
  return new Set(
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.map((contribution) => contribution.target),
    ),
  );
}

function assertDeepFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertDeepFrozen(descriptor.value, visited);
  }
}
