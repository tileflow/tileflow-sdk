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
  'health',
  'lodging',
  'major-transit',
  'oneway',
  'services',
  'shopping',
  'sidewalk-dot',
  'verdant-crop-rows',
  'verdant-sidewalk',
  'verdant-wetland-ripples',
  'verdant-wood-stipple',
  'verdant-xylem',
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
  assert.equal('extends' in ferraris, false);
  assert.equal(cyberpunk.extends, streets);
  assert.equal(streetsDark.extends, streets);
  assert.equal(verdant.extends, streets);

  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
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
  for (const map of [streets, ferraris, streetsDark, cyberpunk, verdant]) {
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
  const resolvedVerdant = resolveMap(verdant);

  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedStreetsDark.icons, [streetsIcons, streetsDarkIcons]);
  assert.deepEqual(resolvedCyberpunk.icons, [streetsIcons, cyberpunkIcons]);
  assert.deepEqual(resolvedFerraris.icons, [ferrarisIcons]);
  assert.deepEqual(resolvedVerdant.icons, [streetsIcons, verdantIcons]);
  assert.deepEqual(resolvedCyberpunk.fonts, [cyberpunkFonts]);
  assert.equal(resolvedCyberpunk.glyphs, undefined);
  assert.deepEqual(resolvedStreets.glyphs, {
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    kind: 'url',
    url: officialGlyphsUrl,
  });
  assert.deepEqual(resolvedStreetsDark.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedFerraris.glyphs, resolvedStreets.glyphs);
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

test('all official maps compile directly after their packaged sprite is prepared', () => {
  for (const [id, map] of Object.entries({
    cyberpunk,
    ferraris,
    streets,
    'streets-dark': streetsDark,
    verdant,
  })) {
    const style = compileOfficialMap(map);
    assert.equal(style.metadata?.['tileflow:map'], id);
    assert.equal(style.metadata?.['tileflow:root'], 'streets');
    assert.equal(style.sprite, `/tileflow/icons/${id}/sprite`);
    assert.equal(style.glyphs, id === 'cyberpunk' ? undefined : officialGlyphsUrl);
    assert.ok(style.layers.length > 100);
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

test('derived official maps do not inherit Streets surface colors', () => {
  const compile = compileOfficialMap;
  const streetsSurfaceSignatures = ['#99DDFF', '#B3EBAD', '#C2EFBE', '#CCE2CA', '#D3F1C6'];

  for (const [id, map, ownSignatures] of [
    ['cyberpunk', cyberpunk, ['#071E31', '#0D2828']],
    ['streets-dark', streetsDark, ['#151E2D', '#10324B']],
    ['verdant', verdant, ['#B2E1DC', '#C4E8B2']],
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
