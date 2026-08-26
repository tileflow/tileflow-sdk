import {featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineMap, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
import {
  cyberpunk,
  cyberpunkFonts,
  cyberpunkIcons,
  ferraris,
  ferrarisIcons,
  harad,
  haradIcons,
  matrix,
  matrixIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  soundings,
  soundingsIcons,
  streets,
  streetsDark,
  streetsDarkIcons,
  streetsIcons,
  verdant,
  verdantIcons,
} from '../src';

const officialIconIds = [
  'coffee',
  'crosswalk',
  'culture',
  'cyber-circuit',
  'cyber-data-grid',
  'cyber-target-brackets',
  'education',
  'ferraris-crop-hatch',
  'ferraris-heath',
  'ferraris-orchard',
  'ferraris-paper-grain',
  'ferraris-residential',
  'ferraris-sand',
  'ferraris-water-ripples',
  'ferraris-wetland',
  'ferraris-woodland',
  'food',
  'harad-arable',
  'harad-conifer',
  'harad-deciduous',
  'harad-orchard',
  'harad-paper-grain',
  'harad-sand',
  'harad-settlement',
  'harad-water-lines',
  'harad-wetland',
  'health',
  'lodging',
  'major-transit',
  'matrix-crt-scanlines',
  'matrix-data-grid',
  'matrix-poi-node',
  'oneway',
  'services',
  'shopping',
  'sidewalk-dot',
  'siegfried-forest',
  'siegfried-glacier',
  'siegfried-gravel',
  'siegfried-orchard',
  'siegfried-paper-grain',
  'siegfried-rock',
  'siegfried-scree',
  'siegfried-water-lines',
  'siegfried-wetland',
  'soundings-buoy-cardinal',
  'soundings-buoy-port',
  'soundings-buoy-starboard',
  'soundings-harbor',
  'soundings-light-flare',
  'soundings-lighthouse',
  'soundings-paper-grain',
  'soundings-rock-awash',
  'soundings-water-dots',
  'soundings-wreck',
  'verdant-field-hatch',
  'verdant-forest-canopy',
  'verdant-heath-tufts',
  'verdant-meadow-tufts',
  'verdant-orchard',
  'verdant-paper-fiber',
  'verdant-residential-hatch',
  'verdant-scree',
  'verdant-water-lines',
  'verdant-wetland-reeds',
] as const;
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
const haradPatternIds = [
  'harad-arable',
  'harad-conifer',
  'harad-deciduous',
  'harad-orchard',
  'harad-paper-grain',
  'harad-sand',
  'harad-settlement',
  'harad-water-lines',
  'harad-wetland',
] as const;
const soundingsIconIds = [
  'soundings-buoy-cardinal',
  'soundings-buoy-port',
  'soundings-buoy-starboard',
  'soundings-harbor',
  'soundings-light-flare',
  'soundings-lighthouse',
  'soundings-paper-grain',
  'soundings-rock-awash',
  'soundings-water-dots',
  'soundings-wreck',
] as const;
const siegfriedPatternIds = [
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
const verdantIconIds = [
  'coffee',
  'crosswalk',
  'culture',
  'education',
  'food',
  'health',
  'lodging',
  'major-transit',
  'services',
  'shopping',
  'verdant-field-hatch',
  'verdant-forest-canopy',
  'verdant-heath-tufts',
  'verdant-meadow-tufts',
  'verdant-orchard',
  'verdant-paper-fiber',
  'verdant-residential-hatch',
  'verdant-scree',
  'verdant-water-lines',
  'verdant-wetland-reeds',
] as const;
const verdantPatternIds = [
  'verdant-field-hatch',
  'verdant-forest-canopy',
  'verdant-heath-tufts',
  'verdant-meadow-tufts',
  'verdant-orchard',
  'verdant-paper-fiber',
  'verdant-residential-hatch',
  'verdant-scree',
  'verdant-water-lines',
  'verdant-wetland-reeds',
] as const;
const officialGlyphsUrl = 'https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf';

function preparedAssets(id: string) {
  return {icons: {ids: officialIconIds, sprite: `/tileflow/icons/${id}/sprite`}};
}

function compileOfficialMap(map: Parameters<typeof resolveMap>[0]) {
  return createStyle(map, {
    preparedAssets: preparedAssets(map.id),
  });
}

test('exports independent roots and ordinary Streets-derived variants', () => {
  assert.deepEqual(streets.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(ferraris.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(harad.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(siegfried.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(soundings.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(verdant.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal('extends' in ferraris, false);
  assert.equal('extends' in harad, false);
  assert.equal('extends' in siegfried, false);
  assert.equal('extends' in soundings, false);
  assert.equal('extends' in verdant, false);
  assert.equal(cyberpunk.extends, streets);
  assert.equal(matrix.extends, cyberpunk);
  assert.equal(streetsDark.extends, streets);

  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
    harad,
    matrix,
    siegfried,
    soundings,
    streets,
    'streets-dark': streetsDark,
    verdant,
  })) {
    const resolved = resolveMap(map);
    assert.equal(resolved.id, id);
    assert.equal(resolved.version, 1);
    assert.equal('extends' in resolved, false);
    assert.equal('basemap' in resolved, false);
    assert.equal(resolved.root.compiler, 'streets');
  }
});

test('deep-freezes only the exported official map singletons', () => {
  for (const map of [
    streets,
    ferraris,
    harad,
    siegfried,
    soundings,
    streetsDark,
    cyberpunk,
    matrix,
    verdant,
  ]) {
    assertDeepFrozen(map);
  }

  assert.throws(() => {
    (streets as {name: string}).name = 'Mutated Streets';
  }, TypeError);
  assert.throws(() => {
    (cyberpunk as {extends: typeof ferraris}).extends = ferraris;
  }, TypeError);
  assert.throws(() => {
    (cyberpunk.theme!.typography as {font: string}).font = 'Unpinned Font';
  }, TypeError);

  const applicationMap = defineMap({
    id: 'application-map',
    name: 'Application map',
    version: 1,
    extends: cyberpunk,
    theme: {typography: {font: 'Oxanium SemiBold'}},
  });
  assert.equal(Object.isFrozen(applicationMap), false);
  assert.equal(Reflect.set(applicationMap, 'name', 'Renamed application map'), true);
  assert.equal(Reflect.set(applicationMap.theme.typography, 'font', 'Oxanium Medium'), true);

  const resolved = resolveMap(applicationMap);
  assert.equal(resolved.name, 'Renamed application map');
  assert.equal(
    typeof resolved.theme === 'object' ? resolved.theme.typography?.font : undefined,
    'Oxanium Medium',
  );
  assert.equal(cyberpunk.extends, streets);
  assert.equal(cyberpunk.name, 'Cyberpunk');
});

test('official maps declare their expected icon and typography providers', () => {
  const resolvedStreets = resolveMap(streets);
  const resolvedStreetsDark = resolveMap(streetsDark);
  const resolvedCyberpunk = resolveMap(cyberpunk);
  const resolvedFerraris = resolveMap(ferraris);
  const resolvedHarad = resolveMap(harad);
  const resolvedMatrix = resolveMap(matrix);
  const resolvedSiegfried = resolveMap(siegfried);
  const resolvedSoundings = resolveMap(soundings);
  const resolvedVerdant = resolveMap(verdant);

  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedStreetsDark.icons, [streetsIcons, streetsDarkIcons]);
  assert.deepEqual(resolvedCyberpunk.icons, [streetsIcons, cyberpunkIcons]);
  assert.deepEqual(resolvedFerraris.icons, [ferrarisIcons]);
  assert.deepEqual(resolvedHarad.icons, [haradIcons]);
  assert.deepEqual(resolvedMatrix.icons, [streetsIcons, matrixIcons]);
  assert.deepEqual(resolvedSiegfried.icons, [siegfriedIcons]);
  assert.deepEqual(resolvedSoundings.icons, [soundingsIcons]);
  assert.deepEqual(resolvedVerdant.icons, [verdantIcons]);
  assert.deepEqual(resolvedCyberpunk.fonts, [cyberpunkFonts]);
  assert.deepEqual(resolvedMatrix.fonts, [cyberpunkFonts]);
  assert.deepEqual(resolvedSiegfried.fonts, [siegfriedFonts]);
  assert.equal(resolvedCyberpunk.glyphs, undefined);
  assert.equal(resolvedMatrix.glyphs, undefined);
  assert.equal(resolvedSiegfried.glyphs, undefined);
  assert.deepEqual(resolvedStreets.glyphs, {
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    kind: 'url',
    url: officialGlyphsUrl,
  });
  assert.deepEqual(resolvedStreetsDark.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedFerraris.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedHarad.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedSoundings.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(verdant.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedVerdant.glyphs, resolvedStreets.glyphs);
  assert.equal(
    typeof resolvedCyberpunk.theme === 'object'
      ? resolvedCyberpunk.theme.typography?.font
      : undefined,
    'Oxanium Medium',
  );
  assert.equal(
    typeof resolvedFerraris.theme === 'object'
      ? resolvedFerraris.theme.typography?.font
      : undefined,
    'Noto Sans Regular',
  );
  assert.equal(
    typeof resolvedMatrix.theme === 'object' ? resolvedMatrix.theme.typography?.font : undefined,
    'Oxanium Medium',
  );
  assert.equal(
    typeof resolvedHarad.theme === 'object' ? resolvedHarad.theme.typography?.font : undefined,
    'Noto Sans Regular',
  );
  assert.equal(
    typeof resolvedSiegfried.theme === 'object'
      ? resolvedSiegfried.theme.typography?.font
      : undefined,
    'Cormorant Garamond Regular',
  );
  assert.equal(
    typeof resolvedSoundings.theme === 'object'
      ? resolvedSoundings.theme.typography?.font
      : undefined,
    'Noto Sans Regular',
  );
  assert.equal(
    typeof resolvedVerdant.theme === 'object' ? resolvedVerdant.theme.typography?.font : undefined,
    'Noto Sans Regular',
  );
  assert.equal(
    typeof resolvedVerdant.theme === 'object'
      ? resolvedVerdant.theme.typography?.places?.font
      : undefined,
    'Noto Sans Bold',
  );
});

test('Ferraris is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(ferraris);
  assert.equal('extends' in ferraris, false);
  assert.equal(resolved.root.compiler, 'streets');
  assert.deepEqual(resolved.icons, [ferrarisIcons]);

  const style = createStyle(ferraris, {
    preparedAssets: {
      icons: {ids: ferrarisPatternIds, sprite: '/tileflow/icons/ferraris/sprite'},
    },
  });
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...ferrarisPatternIds]);

  const layerIds = new Set(style.layers.map((layer) => layer.id));
  for (const id of [
    'ferraris-landcover-farmland-pattern',
    'ferraris-landcover-heath-pattern',
    'ferraris-landcover-orchard-pattern',
    'ferraris-landcover-sand-pattern',
    'ferraris-landcover-wetland-pattern',
    'ferraris-landcover-wood-pattern',
    'ferraris-landuse-residential-pattern',
    'ferraris-water-ripples-pattern',
    'ferraris-water-intermittent-ripples-pattern',
    'ferraris-building-print-shadow',
  ]) {
    assert.equal(layerIds.has(id), true, `Missing Ferraris effect layer ${id}`);
  }
});

test('Härad is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(harad);
  assert.equal('extends' in harad, false);
  assert.equal(resolved.root.compiler, 'streets');
  assert.deepEqual(resolved.icons, [haradIcons]);

  const style = createStyle(harad, {
    preparedAssets: {
      icons: {ids: haradPatternIds, sprite: '/tileflow/icons/harad/sprite'},
    },
  });
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...haradPatternIds]);

  const layerIds = new Set(style.layers.map((layer) => layer.id));
  for (const id of [
    'harad-landcover-arable-pattern',
    'harad-landcover-conifer-pattern',
    'harad-landcover-deciduous-pattern',
    'harad-landcover-orchard-pattern',
    'harad-landcover-sand-pattern',
    'harad-landcover-wetland-pattern',
    'harad-landuse-settlement-pattern',
    'harad-field-boundaries',
    'harad-water-lines-pattern',
    'harad-water-intermittent-lines-pattern',
  ]) {
    assert.equal(layerIds.has(id), true, `Missing Härad effect layer ${id}`);
  }
  assert.equal(layerIds.has('harad-building-ink-shadow'), false);
});

test('Soundings is self-contained and references its package-owned nautical symbols', () => {
  const resolved = resolveMap(soundings);
  assert.equal('extends' in soundings, false);
  assert.deepEqual(soundings.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(resolved.icons, [soundingsIcons]);

  const style = createStyle(soundings, {
    preparedAssets: {
      icons: {ids: soundingsIconIds, sprite: '/tileflow/icons/soundings/sprite'},
    },
  });
  assert.equal(style.metadata?.['tileflow:map'], 'soundings');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
  assert.equal(style.sprite, '/tileflow/icons/soundings/sprite');
  assert.deepEqual(validateStyleMin(style as never), []);

  const serialized = JSON.stringify(style);
  for (const id of soundingsIconIds) {
    assert.match(serialized, new RegExp(`"${id}"`, 'u'), `Soundings does not reference ${id}`);
  }
});

test('Verdant is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(verdant);
  assert.equal('extends' in verdant, false);
  assert.deepEqual(verdant.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(resolved.icons, [verdantIcons]);

  const style = createStyle(verdant, {
    preparedAssets: {
      icons: {ids: verdantIconIds, sprite: '/tileflow/icons/verdant/sprite'},
    },
  });
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
  assert.deepEqual(validateStyleMin(style as never), []);

  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...verdantPatternIds]);

  const layerIds = new Set(style.layers.map((layer) => layer.id));
  for (const id of [
    'verdant-landcover-farmland-pattern',
    'verdant-landcover-scrub-pattern',
    'verdant-landcover-meadow-pattern',
    'verdant-landcover-orchard-pattern',
    'verdant-landcover-rock-pattern',
    'verdant-landcover-wetland-pattern',
    'verdant-landcover-wood-pattern',
    'verdant-landuse-residential-pattern',
    'verdant-water-lines-pattern',
    'verdant-water-intermittent-lines-pattern',
    'verdant-building-print-shadow',
    'verdant-trail-emphasis',
    'verdant-landscape-label',
  ]) {
    assert.equal(layerIds.has(id), true, `Missing Verdant effect layer ${id}`);
  }
});

test('all official maps compile directly after their packaged sprite is prepared', () => {
  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
    harad,
    matrix,
    siegfried,
    soundings,
    streets,
    'streets-dark': streetsDark,
    verdant,
  })) {
    const style = compileOfficialMap(map);
    assert.equal(style.metadata?.['tileflow:map'], id);
    assert.equal(style.metadata?.['tileflow:root'], 'streets');
    assert.equal(style.sprite, `/tileflow/icons/${id}/sprite`);
    assert.equal(
      style.glyphs,
      id === 'cyberpunk' || id === 'matrix' || id === 'siegfried' ? undefined : officialGlyphsUrl,
    );
    assert.ok(
      style.layers.length > (id === 'soundings' ? 50 : 100),
      `${id} compiled an unexpectedly incomplete layer stack`,
    );
  }
});

test('official maps compile against generic OpenMapTiles without optional capabilities', () => {
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

  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
    harad,
    matrix,
    siegfried,
    soundings,
    streets,
    'streets-dark': streetsDark,
    verdant,
  })) {
    const derived = defineMap({id: `${id}-generic`, version: 1, extends: map, data});
    const style = createStyle(derived, {preparedAssets: preparedAssets(id)});
    const layerIds = new Set(style.layers.map((layer) => layer.id));

    assert.equal(layerIds.has('streets-bathymetry'), false, `${id} emitted bathymetry`);
    assert.equal(layerIds.has('streets-global-landcover'), false, `${id} emitted global landcover`);
    assert.deepEqual(validateStyleMin(style as never), [], `${id} emitted an invalid style`);
  }
});

test('official maps emit only exact declared font-face stacks', () => {
  const expected = {
    cyberpunk: new Set([JSON.stringify(['Oxanium Medium']), JSON.stringify(['Oxanium SemiBold'])]),
    ferraris: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    harad: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    matrix: new Set([JSON.stringify(['Oxanium Medium']), JSON.stringify(['Oxanium SemiBold'])]),
    siegfried: new Set([
      JSON.stringify(['Cormorant Garamond Italic']),
      JSON.stringify(['Cormorant Garamond Regular']),
      JSON.stringify(['Cormorant Garamond SemiBold']),
    ]),
    soundings: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    streets: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    'streets-dark': new Set([
      JSON.stringify(['Noto Sans Regular']),
      JSON.stringify(['Noto Sans Bold']),
    ]),
    verdant: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
  } as const;

  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
    harad,
    matrix,
    siegfried,
    soundings,
    streets,
    'streets-dark': streetsDark,
    verdant,
  })) {
    const actual = new Set(
      compileOfficialMap(map).layers.flatMap((layer) => {
        const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
        return Array.isArray(font) ? [JSON.stringify(font)] : [];
      }),
    );
    assert.deepEqual(actual, expected[id as keyof typeof expected], `${id} font stacks drifted`);
  }
});

function assertDeepFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertDeepFrozen(descriptor.value, visited);
  }
}

test('Streets green surfaces are typed and contain no legacy raw detail layers', () => {
  const style = compileOfficialMap(streets);
  const ids = new Set(style.layers.map(({id}) => id));

  for (const id of [
    'streets-global-landcover',
    'streets-landcover',
    'streets-landcover-protected',
    'streets-landuse-recreation',
    'streets-landuse-recreation-outline',
  ]) {
    assert.equal(ids.has(id), true, `Missing compiled green layer ${id}`);
  }
  for (const id of [
    'streets-landcover-meadow-detail',
    'streets-landcover-park-detail',
    'streets-landuse-recreation-detail',
    'streets-landuse-recreation-detail-outline',
    'streets-landcover-legacy-park',
  ]) {
    assert.equal(ids.has(id), false, `Unexpected legacy green layer ${id}`);
  }

  const globalLandcover = style.layers.find(({id}) => id === 'streets-global-landcover');
  assert.equal(globalLandcover?.['source-layer'], 'globallandcover');
  assert.equal(globalLandcover?.maxzoom, 11);
  assert.deepEqual((globalLandcover?.paint as Record<string, unknown>)['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    0.95,
    5,
    0.9,
    7,
    0.9,
    8,
    0.85,
    9,
    0.78,
    10,
    0.75,
    10.5,
    0.5,
    10.75,
    0.25,
    11,
    0,
  ]);
});

test('non-Streets official maps do not use Streets surface colors', () => {
  const compile = compileOfficialMap;
  const streetsSurfaceSignatures = ['#99DDFF', '#B3EBAD', '#C2EFBE', '#CCE2CA', '#D3F1C6'];

  for (const [id, map, ownSignatures] of [
    ['cyberpunk', cyberpunk, ['#071E31', '#0D2828']],
    ['harad', harad, ['#C4DED5', '#E1B23B']],
    ['matrix', matrix, ['#010704', '#63F77B']],
    ['siegfried', siegfried, ['#F0EBE0', '#A96C4D']],
    ['streets-dark', streetsDark, ['#151E2D', '#10324B']],
    ['verdant', verdant, ['#B8DDE7', '#C8DCC4']],
  ] as const) {
    const serialized = JSON.stringify(compile(map)).toUpperCase();
    for (const signature of ownSignatures) {
      assert.ok(serialized.includes(signature), `${id} lost its own surface color ${signature}`);
    }
    for (const signature of streetsSurfaceSignatures) {
      assert.equal(
        serialized.includes(signature),
        false,
        `${id} inherited Streets surface color ${signature}`,
      );
    }
  }
});

test('Streets keeps its runtime-toggle geometry and business surface in the compiled style', () => {
  const style = compileOfficialMap(streets);
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

  for (const id of [
    'streets-buildings-3d-shadow-soft',
    'streets-buildings-3d-shadow-core',
    'streets-buildings-3d',
  ]) {
    const layer = byId.get(id);
    assert.ok(layer, `Streets lost runtime-toggle layer ${id}`);
    assert.equal(layer.layout?.visibility, 'none');
    assert.equal(layer.metadata?.['tileflow:3d-toggle'], 'building');
  }

  const trees = byId.get('streets-vegetation-trees');
  assert.ok(trees, 'Streets lost its individual-tree layer');
  assert.equal(trees.type, 'circle');
  assert.equal(trees.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(trees.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');

  const businessArea = byId.get('streets-landuse-business-area');
  assert.ok(businessArea, 'Streets lost its business land-use surface');
  assert.equal(businessArea.type, 'fill');
  assert.match(JSON.stringify(businessArea.filter), /business_area/u);
});

test('Cyberpunk reveals HUD destinations progressively and lets collisions prioritize them', () => {
  const resolved = resolveMap(cyberpunk);
  assert.deepEqual(resolved.modules?.poi?.maxRank, {
    interpolation: 'step',
    kind: 'zoom',
    stops: [
      [15, 14],
      [17, 120],
      [18, 240],
      [19, 500],
      [20, 750],
      [21, 999],
    ],
  });

  const style = createStyle(cyberpunk, {
    preparedAssets: preparedAssets('cyberpunk'),
  });
  const ring = style.layers.find(({id}) => id === 'cyberpunk-destination-scan-ring');
  const core = style.layers.find(({id}) => id === 'cyberpunk-destination-beacon-core');
  const brackets = style.layers.find(({id}) => id === 'cyberpunk-destination-target-brackets');
  const culture = style.layers.find(({id}) => id === 'streets-poi-culture-label');

  assert.ok(ring, 'Cyberpunk lost its destination scan ring');
  assert.ok(core, 'Cyberpunk lost its destination beacon core');
  assert.ok(brackets, 'Cyberpunk lost its destination target brackets');
  assert.deepEqual(ring?.filter, core?.filter);
  assert.deepEqual(brackets?.filter, core?.filter);
  const filter = JSON.stringify(core?.filter);
  for (const signal of ['importance_tier', 'rank', 'theme_park', 'artwork', '["zoom"]']) {
    assert.match(filter, new RegExp(signal.replaceAll('[', '\\[').replaceAll(']', '\\]')));
  }
  assert.match(filter, /16.*14.*17.*120.*18.*240.*19.*500.*20.*750.*21.*999/);
  assert.equal(brackets?.layout?.['icon-allow-overlap'], false);
  assert.equal(brackets?.layout?.['icon-ignore-placement'], false);
  assert.equal(brackets?.layout?.['text-allow-overlap'], false);
  assert.ok(brackets?.layout?.['symbol-sort-key']);
  assert.match(JSON.stringify(culture?.filter), /14.*17.*120.*18.*240.*19.*500.*20.*750.*21.*999/);

  const matches = (zoom: number, properties: Record<string, unknown>) =>
    featureFilter(core?.filter as never).filter({zoom}, {type: 1, properties} as never);
  assert.equal(matches(14, {importance_tier: 4, rank: 999}), true);
  assert.equal(matches(14, {importance_tier: 3, rank: 1}), false);
  assert.equal(matches(15, {importance_tier: 3, rank: 999}), true);
  assert.equal(matches(16, {importance_tier: 2, rank: 14}), true);
  assert.equal(matches(16, {importance_tier: 2, rank: 15}), false);
  assert.equal(matches(17, {importance_tier: 2, rank: 120}), true);
  assert.equal(matches(17, {importance_tier: 2, rank: 121}), false);
  assert.equal(matches(18, {importance_tier: 1, rank: 14}), true);
  assert.equal(matches(18, {importance_tier: 1, rank: 15}), false);
  assert.equal(matches(15, {class: 'theme_park', rank: 999}), true);
  assert.equal(matches(17, {importance_tier: 2, rank: 1, subclass: 'artwork'}), false);
  assert.equal(matches(18, {importance_tier: 2, rank: 1, subclass: 'artwork'}), true);
  assert.equal(matches(22, {class: 'restaurant', rank: 1}), false);
  assert.deepEqual(validateStyleMin(style as never), []);
});
