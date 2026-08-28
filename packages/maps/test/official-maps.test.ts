import {featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  matrixFonts,
  matrixIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  siegfriedThemes,
  soundings,
  soundingsIcons,
  streets,
  streetsIcons,
  streetsThemes,
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
  'siegfried-dark-forest',
  'siegfried-dark-glacier',
  'siegfried-dark-gravel',
  'siegfried-dark-orchard',
  'siegfried-dark-paper-grain',
  'siegfried-dark-rock',
  'siegfried-dark-scree',
  'siegfried-dark-water-lines',
  'siegfried-dark-wetland',
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
  'siegfried-dark-forest',
  'siegfried-dark-glacier',
  'siegfried-dark-gravel',
  'siegfried-dark-orchard',
  'siegfried-dark-paper-grain',
  'siegfried-dark-rock',
  'siegfried-dark-scree',
  'siegfried-dark-water-lines',
  'siegfried-dark-wetland',
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

function compileOfficialMap(map: Parameters<typeof resolveMap>[0], theme?: string) {
  return createStyle(map, {
    preparedAssets: preparedAssets(map.id),
    theme,
  });
}

test('exports every official map as an independent compiler root', async () => {
  const officialMaps = {
    cyberpunk,
    ferraris,
    harad,
    matrix,
    siegfried,
    soundings,
    streets,
    verdant,
  } as const;
  const officialMapIds = new Set(Object.keys(officialMaps));

  for (const [id, map] of Object.entries(officialMaps)) {
    assert.deepEqual(map.root, {compiler: 'streets', compilerVersion: 1});
    assert.equal('extends' in map, false, `${id} imports another official map`);

    const resolved = resolveMap(map);
    assert.equal(resolved.id, id);
    assert.equal(resolved.version, 1);
    assert.equal('extends' in resolved, false);
    assert.equal('basemap' in resolved, false);
    assert.equal(resolved.root.compiler, 'streets');

    const source = await readFile(new URL(`../src/official/${id}.ts`, import.meta.url), 'utf8');
    assert.match(source, /\bdefineRootMap\s*\(/u, `${id} is not authored as a root`);
    for (const match of source.matchAll(/\bfrom\s+['"]\.\/([^'"]+)['"]/gu)) {
      const importedModule = match[1]!.replace(/\.(?:js|ts)$/u, '');
      assert.equal(
        officialMapIds.has(importedModule),
        false,
        `${id} imports official map ${importedModule}`,
      );
    }
  }
});

test('deep-freezes only the exported official map singletons', () => {
  for (const map of [streets, ferraris, harad, siegfried, soundings, cyberpunk, matrix, verdant]) {
    assertDeepFrozen(map);
  }

  assert.throws(() => {
    (streets as {name: string}).name = 'Mutated Streets';
  }, TypeError);
  assert.throws(() => {
    (cyberpunk as {extends: typeof ferraris}).extends = ferraris;
  }, TypeError);
  assert.throws(() => {
    (cyberpunk.themes!.dark.typography as {font: string}).font = 'Unpinned Font';
  }, TypeError);

  const applicationMap = defineMap({
    id: 'application-map',
    name: 'Application map',
    version: 1,
    extends: cyberpunk,
    themes: {
      dark: {
        ...streetsThemes.dark,
        id: 'application-dark',
        typography: {...streetsThemes.dark.typography, font: 'Oxanium SemiBold'},
      },
    },
    defaultTheme: 'dark',
  });
  assert.equal(Object.isFrozen(applicationMap), false);
  assert.equal(Reflect.set(applicationMap, 'name', 'Renamed application map'), true);
  assert.equal(Reflect.set(applicationMap.themes.dark.typography, 'font', 'Oxanium Medium'), true);

  const resolved = resolveMap(applicationMap);
  assert.equal(resolved.name, 'Renamed application map');
  assert.equal(resolved.themes.dark.typography?.font, 'Oxanium Medium');
  assert.equal('extends' in cyberpunk, false);
  assert.equal(cyberpunk.name, 'Cyberpunk');
});

test('official maps declare their expected icon and typography providers', () => {
  const resolvedStreets = resolveMap(streets);
  const resolvedCyberpunk = resolveMap(cyberpunk);
  const resolvedFerraris = resolveMap(ferraris);
  const resolvedHarad = resolveMap(harad);
  const resolvedMatrix = resolveMap(matrix);
  const resolvedSiegfried = resolveMap(siegfried);
  const resolvedSoundings = resolveMap(soundings);
  const resolvedVerdant = resolveMap(verdant);

  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedCyberpunk.icons, [cyberpunkIcons]);
  assert.deepEqual(resolvedFerraris.icons, [ferrarisIcons]);
  assert.deepEqual(resolvedHarad.icons, [haradIcons]);
  assert.deepEqual(resolvedMatrix.icons, [matrixIcons]);
  assert.deepEqual(resolvedSiegfried.icons, [siegfriedIcons]);
  assert.deepEqual(resolvedSoundings.icons, [soundingsIcons]);
  assert.deepEqual(resolvedVerdant.icons, [verdantIcons]);
  assert.deepEqual(resolvedCyberpunk.fonts, [cyberpunkFonts]);
  assert.deepEqual(resolvedMatrix.fonts, [matrixFonts]);
  assert.deepEqual(resolvedSiegfried.fonts, [siegfriedFonts]);
  assert.equal(resolvedCyberpunk.glyphs, undefined);
  assert.equal(resolvedMatrix.glyphs, undefined);
  assert.equal(resolvedSiegfried.glyphs, undefined);
  assert.deepEqual(resolvedStreets.glyphs, {
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    kind: 'url',
    url: officialGlyphsUrl,
  });
  assert.deepEqual(resolvedFerraris.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedHarad.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedSoundings.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(verdant.glyphs, resolvedStreets.glyphs);
  assert.deepEqual(resolvedVerdant.glyphs, resolvedStreets.glyphs);
  assert.equal(resolvedCyberpunk.themes.dark.typography?.font, 'Oxanium Medium');
  assert.equal(resolvedFerraris.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedMatrix.themes.dark.typography?.font, 'Oxanium Medium');
  assert.equal(resolvedHarad.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedSiegfried.themes.light.typography?.font, 'Cormorant Garamond Regular');
  assert.equal(resolvedSiegfried.themes.dark.typography?.font, 'Cormorant Garamond Regular');
  assert.equal(resolvedSiegfried.defaultTheme, 'light');
  assert.deepEqual(resolvedSiegfried.systemThemes, {light: 'light', dark: 'dark'});
  assert.equal(siegfriedThemes.light.colorScheme, 'light');
  assert.equal(siegfriedThemes.dark.colorScheme, 'dark');
  assert.equal(resolvedSoundings.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedVerdant.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedVerdant.themes.light.typography?.places?.font, 'Noto Sans Bold');
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

test('Soundings is self-contained and references only its bathymetric-map artwork', () => {
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
  for (const id of ['soundings-paper-grain', 'soundings-water-dots']) {
    assert.match(serialized, new RegExp(`"${id}"`, 'u'), `Soundings does not reference ${id}`);
  }
  assert.doesNotMatch(serialized, /"soundings-harbor"/u);
  for (const id of [
    'soundings-buoy-cardinal',
    'soundings-buoy-port',
    'soundings-buoy-starboard',
    'soundings-light-flare',
    'soundings-lighthouse',
    'soundings-rock-awash',
    'soundings-wreck',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(`"${id}"`, 'u'), `${id} leaked into Soundings`);
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

test('Streets-family maps overlap ordinary road endpoints without extending structural endpoints', () => {
  const structuralButtCap = [
    'any',
    ['==', ['get', 'brunnel'], 'tunnel'],
    ['==', ['get', 'class'], 'steps'],
    ['==', ['get', 'subclass'], 'steps'],
  ];
  const controlledSurfaceButtCap = [
    'all',
    ['match', ['get', 'brunnel'], ['tunnel', 'bridge'], false, true],
    ['==', ['get', 'foot'], 'no'],
    [
      'match',
      ['get', 'class'],
      [
        'motorway',
        'trunk',
        'primary',
        'motorway_construction',
        'trunk_construction',
        'primary_construction',
      ],
      true,
      false,
    ],
  ];
  const expectedCap = [
    'step',
    ['zoom'],
    ['case', structuralButtCap, 'butt', 'round'],
    17,
    [
      'case',
      [
        'any',
        structuralButtCap,
        controlledSurfaceButtCap,
        ['>', ['to-number', ['coalesce', ['get', 'clearance_extra_px_z15'], 0], 0], 0],
      ],
      'butt',
      'round',
    ],
  ];

  for (const [mapId, map] of Object.entries({streets, cyberpunk, matrix})) {
    const style = compileOfficialMap(map);
    const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

    for (const cohort of ['local', 'arterial', 'major']) {
      for (const phase of ['casing', 'fill']) {
        for (const structure of ['surface', 'bridge', 'tunnel']) {
          const id = `streets-road-${structure}-highzoom-${cohort}-${phase}`;
          const layer = byId.get(id);
          assert.ok(layer, `Missing compiled ${mapId} road cohort ${id}`);
          assert.deepEqual(
            layer.layout?.['line-cap'],
            expectedCap,
            `${mapId} ${id} regressed to seam-prone caps`,
          );
        }
      }
    }

    for (const structure of ['surface', 'tunnel', 'bridge']) {
      for (const phase of ['casing', 'fill']) {
        const id = `streets-road-${structure}-steps-${phase}`;
        const layer = byId.get(id);
        assert.ok(layer, `Missing compiled ${mapId} steps layer ${id}`);
        assert.equal(
          layer.layout?.['line-cap'],
          'butt',
          `${mapId} ${id} extends structural endpoints`,
        );
      }
    }

    for (const roadClass of ['pathway', 'footway', 'cycleway', 'pedestrian']) {
      for (const phase of ['casing', 'fill']) {
        const id = `streets-road-tunnel-${roadClass}-${phase}`;
        const layer = byId.get(id);
        assert.ok(layer, `Missing compiled ${mapId} tunnel path ${id}`);
        assert.equal(
          layer.layout?.['line-cap'],
          'butt',
          `${mapId} ${id} extends beyond its portal`,
        );
      }
    }
    assert.equal(
      byId.get('streets-road-tunnel-cycleway-shadow')?.layout?.['line-cap'],
      'butt',
      `${mapId} tunnel cycleway underlay extends beyond its portal`,
    );
  }
});

test('official road maps avoid seam-prone caps on ordinary surface and bridge segments', () => {
  for (const [mapId, map] of Object.entries({
    streets,
    cyberpunk,
    matrix,
    ferraris,
    harad,
    siegfried,
    verdant,
  })) {
    const style = compileOfficialMap(map);
    const ordinaryRoadLayers = style.layers.filter(
      (layer) =>
        layer.type === 'line' &&
        /^streets-road-(?:surface|bridge)-/u.test(layer.id) &&
        !layer.id.includes('-steps-'),
    );
    assert.ok(ordinaryRoadLayers.length > 0, `${mapId} compiled no ordinary road lines`);
    for (const layer of ordinaryRoadLayers) {
      assert.notEqual(
        layer.layout?.['line-cap'],
        undefined,
        `${mapId} ${layer.id} uses default butt`,
      );
      assert.notEqual(layer.layout?.['line-cap'], 'butt', `${mapId} ${layer.id} uses literal butt`);
    }
  }

  const soundingsStyle = compileOfficialMap(soundings);
  assert.equal(
    soundingsStyle.layers.some((layer) =>
      /^streets-road-(?:surface|bridge|tunnel)-/u.test(layer.id),
    ),
    false,
    'Soundings unexpectedly enabled road geometry',
  );
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
    verdant,
  })) {
    const derived = defineMap({id: `${id}-generic`, version: 1, extends: map, data});
    const style = createStyle(derived, {preparedAssets: preparedAssets(id)});
    const layerIds = new Set(style.layers.map((layer) => layer.id));

    assert.equal(
      layerIds.has('streets-bathymetry'),
      id === 'soundings',
      `${id} emitted unexpected bathymetry selection`,
    );
    if (id === 'soundings') {
      assert.equal(
        style.layers.find((layer) => layer.id === 'streets-bathymetry')?.source,
        'tileflow-bathymetry',
      );
    }
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
    1,
    5,
    1,
    7,
    1,
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
  const streetsSurfaceSignatures = ['#AEDBFC', '#B7E2AC', '#C2E8B3', '#D5E8D0', '#E0ECD8'];

  for (const [id, map, ownSignatures] of [
    ['cyberpunk', cyberpunk, ['#071E31', '#0D2828']],
    ['harad', harad, ['#C4DED5', '#E1B23B']],
    ['matrix', matrix, ['#010704', '#63F77B']],
    ['siegfried', siegfried, ['#F0EBE0', '#A96C4D']],
    ['streets-dark', streets, ['#2D3043', '#18223B']],
    ['verdant', verdant, ['#B8DDE7', '#C8DCC4']],
  ] as const) {
    const serialized = JSON.stringify(
      compile(map, id === 'streets-dark' ? 'dark' : undefined),
    ).toUpperCase();
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

test('Streets consumes canonical producer-ranked POI and omits house-number noise', () => {
  const resolved = resolveMap(streets);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.poi?.enabled, true);
  assert.equal(resolved.modules?.poi?.color, 'category');
  assert.equal(resolved.modules?.poi?.placement?.coupleIconAndLabel, true);
  assert.equal(resolved.modules?.poi?.density, 3);
  assert.deepEqual(resolved.modules?.poi?.categories, [
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
  ]);

  const style = compileOfficialMap(streets);
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  assert.equal(byId.has('streets-addresses-labels'), false);
  assert.equal(byId.has('streets-parking-symbol-disc'), false);
  assert.equal(byId.has('streets-parking-symbol-label'), false);

  const expectedPoiTextColors = {
    'arts-entertainment': '#B85CA4',
    education: '#777876',
    'food-drink': '#D7892C',
    landmark: '#B85CA4',
    lodging: '#806DC4',
    medical: '#C95E6B',
    'park-nature': '#4C9478',
    'public-services': '#777876',
    religion: '#B85CA4',
    retail: '#4C9478',
    'sport-leisure': '#4C9478',
    transport: '#5C74D6',
    'visitor-amenity': '#777876',
  } as const;
  for (const category of resolved.modules?.poi?.categories ?? []) {
    const id = `streets-poi-${category}`;
    const layer = byId.get(id);
    assert.ok(layer, `Streets lost coupled POI layer ${id}`);
    assert.equal(byId.has(`${id}-marker`), false);
    assert.equal(byId.has(`${id}-icon`), false);
    assert.equal(byId.has(`${id}-label`), false);
    assert.equal(layer.layout?.['icon-optional'], false);
    assert.equal(layer.layout?.['text-optional'], true);
    assert.deepEqual(layer.layout?.['text-variable-anchor'], ['top', 'bottom', 'right', 'left']);
    assert.deepEqual(layer.layout?.['symbol-sort-key'], [
      '+',
      ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
      ['to-number', ['get', 'size_rank'], 17],
    ]);
    assert.match(JSON.stringify(layer.filter), /"category"/u);
    assert.match(JSON.stringify(layer.filter), /"filter_rank"/u);
    assert.match(JSON.stringify(layer.filter), /"size_rank"/u);
    assert.doesNotMatch(JSON.stringify(layer.filter), /"class"|"subclass"|"rank"/u);
    assert.equal(layer.paint?.['text-color'], expectedPoiTextColors[category]);
    assert.equal(layer.paint?.['text-halo-color'], '#FFFFFF');
  }

  const transportIcon = JSON.stringify(byId.get('streets-poi-transport')?.layout?.['icon-image']);
  assert.match(transportIcon, /"icon"/u);
  assert.match(transportIcon, /major-transit/u);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('Cyberpunk HUD consumes canonical POI density and size ranks', () => {
  const resolved = resolveMap(cyberpunk);
  assert.equal(resolved.modules?.poi?.density, 2);
  assert.deepEqual(resolved.modules?.poi?.categories, ['transport', 'arts-entertainment']);

  const style = createStyle(cyberpunk, {
    preparedAssets: preparedAssets('cyberpunk'),
  });
  const ring = style.layers.find(({id}) => id === 'cyberpunk-destination-scan-ring');
  const core = style.layers.find(({id}) => id === 'cyberpunk-destination-beacon-core');
  const brackets = style.layers.find(({id}) => id === 'cyberpunk-destination-target-brackets');
  const culture = style.layers.find(({id}) => id === 'streets-poi-arts-entertainment-label');

  assert.ok(ring, 'Cyberpunk lost its destination scan ring');
  assert.ok(core, 'Cyberpunk lost its destination beacon core');
  assert.ok(brackets, 'Cyberpunk lost its destination target brackets');
  assert.deepEqual(ring?.filter, core?.filter);
  assert.deepEqual(brackets?.filter, core?.filter);
  const filter = JSON.stringify(core?.filter);
  for (const signal of ['filter_rank', 'size_rank']) {
    assert.match(filter, new RegExp(signal.replaceAll('[', '\\[').replaceAll(']', '\\]')));
  }
  assert.doesNotMatch(filter, /"class"|"subclass"|"rank"/u);
  assert.equal(brackets?.layout?.['icon-allow-overlap'], false);
  assert.equal(brackets?.layout?.['icon-ignore-placement'], false);
  assert.equal(brackets?.layout?.['text-allow-overlap'], false);
  assert.ok(brackets?.layout?.['symbol-sort-key']);
  assert.match(JSON.stringify(culture?.filter), /filter_rank/u);

  const matches = (zoom: number, properties: Record<string, unknown>) =>
    featureFilter(core?.filter as never).filter({zoom}, {type: 1, properties} as never);
  assert.equal(matches(14, {category: 'landmark', filter_rank: 0, size_rank: 0}), true);
  assert.equal(matches(14, {category: 'transport', filter_rank: 2, size_rank: 16}), true);
  assert.equal(matches(20, {category: 'transport', filter_rank: 3, size_rank: 16}), false);
  assert.equal(matches(20, {category: 'transport', filter_rank: 2, size_rank: 17}), false);
  assert.equal(matches(20, {category: 'transport', rank: 1}), false);
  assert.deepEqual(validateStyleMin(style as never), []);
});
