import {
  Color,
  createPropertyExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  inferTileflowDataRequirements,
  openMapTiles,
  readTileflowBuildings3D,
  readTileflowStreetLights,
  readTileflowVegetation3D,
  resolveMap,
  vectorTiles,
} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {
  baedeker,
  baedekerFonts,
  baedekerIcons,
  blueprint,
  blueprintIcons,
  civica,
  civicaFonts,
  civicaIcons,
  ferraris,
  ferrarisIcons,
  harad,
  haradIcons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  siegfriedThemes,
  soundings,
  soundingsIcons,
  streets,
  streetsIcons,
  streetsThemes,
} from '../src';
import {streetsPoiImageIds} from './streets-poi-fixture';

const officialIconIds = [
  'baedeker-hachures',
  'baedeker-orchard',
  'baedeker-paper-grain',
  'baedeker-park-stipple',
  'baedeker-residential',
  'baedeker-sand',
  'baedeker-water-lines',
  'baedeker-wetland',
  'civica-industrial-hatch',
  'civica-orchard',
  'civica-paper-grain',
  'civica-park-groves',
  'civica-poi-airport',
  'civica-poi-civic-star',
  'civica-poi-dot',
  'civica-poi-food',
  'civica-poi-garden',
  'civica-poi-hospital',
  'civica-poi-lodging',
  'civica-poi-monument',
  'civica-poi-museum',
  'civica-poi-shopping',
  'civica-poi-transit',
  'civica-water-lines',
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

  'oneway',
  'parking',
  'road-shield-circle-neutral',
  'road-shield-rectangle-blue',
  'road-shield-rectangle-green',
  'road-shield-rectangle-neutral',
  'road-shield-rectangle-orange',
  'road-shield-rectangle-red',
  'road-shield-rectangle-yellow',
  'blueprint-grid',
  'blueprint-building-hatch',
  'blueprint-landscape-hatch',
  'blueprint-poi-node',
  'blueprint-water-hatch',
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
  ...streetsPoiImageIds,
] as const;
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
const blueprintIconIds = [
  'blueprint-grid',
  'blueprint-building-hatch',
  'blueprint-landscape-hatch',
  'blueprint-poi-node',
  'blueprint-water-hatch',
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
const officialGlyphsUrl =
  'https://api.tileflow.dev/base/33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3/glyphs/{fontstack}/{range}.pbf';

function preparedAssets(id: string) {
  return {icons: {ids: officialIconIds, sprite: `/tileflow/icons/${id}/sprite`}};
}

function compileOfficialMap(map: Parameters<typeof resolveMap>[0], theme?: string) {
  return createStyle(map, {
    preparedAssets: preparedAssets(map.id),
    theme,
  });
}

test('official World styles avoid fields absent from the V1 release contract', () => {
  for (const [map, fields] of [
    [streets, {building: ['has_parts'], transportation: ['clearance_extra_px_z15']}],

    [blueprint, {building: ['height', 'name']}],
  ] as const) {
    const requirements = inferTileflowDataRequirements(compileOfficialMap(map));
    for (const [layer, absentFields] of Object.entries(fields)) {
      const required = requirements.sourceLayers.find(({id}) => id === layer);
      assert.ok(required, `${map.id} must still render ${layer}`);
      for (const field of absentFields) {
        assert.equal(
          required.fields.some(({name}) => name === field),
          false,
          `${map.id} requires unpublished ${layer}.${field}`,
        );
      }
    }
  }
});

function compiledTargets(compiled: ReturnType<typeof createStyleWithInspection>): Set<string> {
  return new Set(
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.map((contribution) => contribution.target),
    ),
  );
}

function compiledLayerForTarget(
  compiled: ReturnType<typeof createStyleWithInspection>,
  target: string,
) {
  const inspected = compiled.inspection.layers.find(({contributions}) =>
    contributions.some((contribution) => contribution.target === target),
  );
  return inspected ? compiled.style.layers[inspected.index] : undefined;
}

test('exports every official map as an independent standalone semantic map', async () => {
  const officialMaps = {
    baedeker,
    civica,

    ferraris,
    harad,

    blueprint: blueprint,
    siegfried,
    soundings,
    streets,
  } as const;
  const officialMapSources = new Set(Object.keys(officialMaps));

  for (const [id, map] of Object.entries(officialMaps)) {
    assert.equal('root' in map, false);
    assert.equal('extends' in map, false, `${id} imports another official map`);

    const resolved = resolveMap(map);
    assert.equal(resolved.id, id);
    assert.equal(resolved.version, 1);
    assert.equal('extends' in resolved, false);
    assert.equal('basemap' in resolved, false);
    assert.equal('root' in resolved, false);

    const sourceName = id;
    const source = await readFile(
      new URL(`../src/official/${sourceName}.ts`, import.meta.url),
      'utf8',
    );
    assert.match(source, /\bdefineMap\s*\(/u, `${id} is not authored as a standalone map`);
    if (['civica', 'blueprint'].includes(id)) {
      assert.match(source, /\bwithRenderStack\s*\(/u, `${id} lost its semantic render stack`);
      assert.match(source, /\bfield\s*\(/u, `${id} lost its schema-bound field references`);
      assert.doesNotMatch(
        source,
        /@tileflow\/core\/recipe|\b(?:addModuleLayer|defineModuleEffects|patchModuleLayer|semanticField|semanticLayer)\b/u,
        `${id} regressed to the legacy raw-effects surface`,
      );
    }
    for (const match of source.matchAll(/\bfrom\s+['"]\.\/([^'"]+)['"]/gu)) {
      const importedModule = match[1]!.replace(/\.(?:js|ts)$/u, '');
      assert.equal(
        officialMapSources.has(importedModule),
        false,
        `${id} imports official map ${importedModule}`,
      );
    }
  }
});

test('deep-freezes only the exported official map singletons', () => {
  for (const map of [streets, baedeker, civica, ferraris, harad, siegfried, soundings, blueprint]) {
    assertDeepFrozen(map);
  }

  assert.throws(() => {
    (streets as {name: string}).name = 'Mutated Streets';
  }, TypeError);
  assert.throws(() => {
    (streets as {extends: typeof ferraris}).extends = ferraris;
  }, TypeError);
  assert.throws(() => {
    (streets.themes!.dark.typography as {font: string}).font = 'Unpinned Font';
  }, TypeError);

  const applicationMap = defineMap({
    id: 'application-map',
    name: 'Application map',
    version: 1,
    extends: streets,
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
  assert.equal('extends' in streets, false);
  assert.equal(streets.name, 'Streets');
});

test('official maps declare their expected icon and typography providers', () => {
  const resolvedBaedeker = resolveMap(baedeker);
  const resolvedCivica = resolveMap(civica);
  const resolvedStreets = resolveMap(streets);
  const resolvedFerraris = resolveMap(ferraris);
  const resolvedHarad = resolveMap(harad);
  const resolvedBlueprint = resolveMap(blueprint);
  const resolvedSiegfried = resolveMap(siegfried);
  const resolvedSoundings = resolveMap(soundings);

  assert.deepEqual(resolvedBaedeker.icons, [baedekerIcons]);
  assert.deepEqual(resolvedCivica.icons, [civicaIcons]);
  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedFerraris.icons, [ferrarisIcons]);
  assert.deepEqual(resolvedHarad.icons, [haradIcons]);
  assert.deepEqual(resolvedBlueprint.icons, [blueprintIcons]);
  assert.deepEqual(resolvedSiegfried.icons, [siegfriedIcons]);
  assert.deepEqual(resolvedSoundings.icons, [soundingsIcons]);
  assert.deepEqual(resolvedBaedeker.fonts, [baedekerFonts]);
  assert.deepEqual(resolvedSiegfried.fonts, [siegfriedFonts]);
  assert.equal(resolvedBaedeker.glyphs, undefined);
  assert.equal(resolvedSiegfried.glyphs, undefined);
  assert.deepEqual(resolvedStreets.glyphs, {
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'],
    kind: 'url',
    url: officialGlyphsUrl,
  });
  assert.deepEqual(resolvedCivica.fonts, [civicaFonts]);
  assert.equal(resolvedCivica.glyphs, undefined);
  for (const map of [resolvedFerraris, resolvedHarad, resolvedSoundings, resolvedBlueprint]) {
    assert.deepEqual(map.glyphs, {
      fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
      kind: 'url',
      url: officialGlyphsUrl,
    });
  }
  assert.equal(resolvedBaedeker.themes.light.typography?.font, 'Cormorant Garamond Regular');
  assert.equal(
    resolvedBaedeker.themes.light.typography?.places?.font,
    'Cormorant Garamond SemiBold',
  );
  assert.equal(resolvedFerraris.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedHarad.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedSiegfried.themes.light.typography?.font, 'Cormorant Garamond Regular');
  assert.equal(resolvedSiegfried.themes.dark.typography?.font, 'Cormorant Garamond Regular');
  assert.equal(resolvedSiegfried.defaultTheme, 'light');
  assert.deepEqual(resolvedSiegfried.systemThemes, {light: 'light', dark: 'dark'});
  assert.equal(siegfriedThemes.light.colorScheme, 'light');
  assert.equal(siegfriedThemes.dark.colorScheme, 'dark');
  assert.equal(resolvedSoundings.themes.light.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedBlueprint.themes.blueprint.typography?.font, 'Noto Sans Regular');
  assert.equal(resolvedBlueprint.themes.blueprint.typography?.places?.font, 'Noto Sans Bold');
});

test('Baedeker is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(baedeker);
  assert.equal('extends' in baedeker, false);
  assert.equal('root' in resolved, false);
  assert.deepEqual(resolved.icons, [baedekerIcons]);

  const compiled = createStyleWithInspection(baedeker, {
    preparedAssets: {
      icons: {ids: baedekerPatternIds, sprite: '/tileflow/icons/baedeker/sprite'},
    },
  });
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
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
});

test('Ferraris is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(ferraris);
  assert.equal(ferraris.name, '1777');
  assert.equal('extends' in ferraris, false);
  assert.equal('root' in resolved, false);
  assert.deepEqual(resolved.icons, [ferrarisIcons]);

  const compiled = createStyleWithInspection(ferraris, {
    preparedAssets: {
      icons: {ids: ferrarisPatternIds, sprite: '/tileflow/icons/ferraris/sprite'},
    },
  });
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...ferrarisPatternIds]);

  const targets = compiledTargets(compiled);
  for (const target of [
    'land.render.farmlandTexture',
    'land.render.heathTexture',
    'land.render.orchardTexture',
    'land.render.sandTexture',
    'land.render.wetlandTexture',
    'land.render.woodTexture',
    'land.render.residentialTexture',
    'water.render.ripples',
    'water.render.intermittentRipples',
    'buildings.render.printShadow',
  ]) {
    assert.equal(targets.has(target), true, `Missing Ferraris render target ${target}`);
  }
});

test('Härad is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(harad);
  assert.equal('extends' in harad, false);
  assert.equal('root' in resolved, false);
  assert.deepEqual(resolved.icons, [haradIcons]);

  const compiled = createStyleWithInspection(harad, {
    preparedAssets: {
      icons: {ids: haradPatternIds, sprite: '/tileflow/icons/harad/sprite'},
    },
  });
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...haradPatternIds]);

  const targets = compiledTargets(compiled);
  for (const target of [
    'land.render.arableTexture',
    'land.render.coniferTexture',
    'land.render.deciduousTexture',
    'land.render.orchardTexture',
    'land.render.sandTexture',
    'land.render.wetlandTexture',
    'land.render.settlementTexture',
    'land.render.fieldBoundaries',
    'water.render.printLines',
    'water.render.intermittentPrintLines',
  ]) {
    assert.equal(targets.has(target), true, `Missing Härad render target ${target}`);
  }
  const layerIds = new Set(style.layers.map((layer) => layer.id));
  assert.equal(layerIds.has('harad-building-ink-shadow'), false);
});

test('Soundings is self-contained and references only its bathymetric-map artwork', () => {
  const resolved = resolveMap(soundings);
  assert.equal('extends' in soundings, false);
  assert.equal('root' in soundings, false);
  assert.deepEqual(resolved.icons, [soundingsIcons]);

  const compiled = createStyleWithInspection(soundings, {
    preparedAssets: {
      icons: {ids: soundingsIconIds, sprite: '/tileflow/icons/soundings/sprite'},
    },
  });
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:map'], 'soundings');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(style.sprite, '/tileflow/icons/soundings/sprite');
  assert.deepEqual(validateStyleMin(style as never), []);

  const targets = compiledTargets(compiled);
  for (const target of [
    'water.render.pierOutline',
    'water.render.pierDeck',
    'water.render.chartDots',
    'water.render.intermittentChartDots',
    'transit.render.ferryLabels',
  ]) {
    assert.equal(targets.has(target), true, `Missing Soundings render target ${target}`);
  }

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

test('Blueprint is self-contained and references exactly its blueprint assets', () => {
  const resolved = resolveMap(blueprint);
  assert.equal('extends' in blueprint, false);
  assert.equal('root' in resolved, false);
  assert.deepEqual(resolved.icons, [blueprintIcons]);

  const compiled = createStyleWithInspection(blueprint, {
    preparedAssets: {
      icons: {
        ids: blueprintIconIds,
        sprite: '/tileflow/icons/blueprint/sprite',
      },
    },
  });
  assert.equal(compiled.style.metadata?.['tileflow:extends'], undefined);
  const serialized = JSON.stringify(compiled.style);
  for (const id of blueprintIconIds) {
    assert.match(serialized, new RegExp(`"${id}"`, 'u'), `Missing blueprint asset ${id}`);
  }
  assert.deepEqual(validateStyleMin(compiled.style as never), []);
});

test('all official maps compile directly after their packaged sprite is prepared', () => {
  for (const [id, map] of Object.entries({
    baedeker,
    civica,

    ferraris,
    harad,

    blueprint: blueprint,
    siegfried,
    soundings,
    streets,
  })) {
    const style = compileOfficialMap(map);
    assert.equal(style.metadata?.['tileflow:map'], id);
    assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
    assert.equal(style.sprite, `/tileflow/icons/${id}/sprite`);
    assert.equal(
      style.glyphs,
      id === 'baedeker' || id === 'civica' || id === 'siegfried' ? undefined : officialGlyphsUrl,
    );
    assert.ok(
      style.layers.length > (id === 'soundings' ? 50 : 100),
      `${id} compiled an unexpectedly incomplete layer stack`,
    );
  }
});

test('Streets-family road caps follow overview and structural reference geometry', () => {
  for (const [mapId, map] of Object.entries({streets})) {
    const style = compileOfficialMap(map);
    const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

    for (const roadClass of ['minor', 'primary', 'motorway']) {
      for (const phase of ['casing', 'fill']) {
        for (const structure of ['surface', 'bridge', 'tunnel']) {
          const layer = style.layers.find(
            (l) =>
              l.id.startsWith(`tileflow-road-${structure}-`) &&
              l.id.endsWith(`-${phase}`) &&
              (l.minzoom ?? 0) <= 18 &&
              (l.maxzoom ?? 25) > 18 &&
              featureFilter(l.filter as never).filter({zoom: 18}, {
                type: 2,
                properties: {class: roadClass, brunnel: structure},
              } as never),
          );
          const id = `${structure}-${roadClass}-${phase}`;
          assert.ok(layer, `Missing compiled ${mapId} road cohort ${id}`);
          assert.deepEqual(
            layer.layout?.['line-cap'] ?? 'butt',
            structure === 'surface'
              ? ['step', ['zoom'], 'butt', 14, 'round']
              : structure === 'bridge' && phase === 'fill'
                ? 'round'
                : 'butt',
            `${mapId} ${id} uses incorrect reference caps`,
          );
        }
      }
    }

    for (const structure of ['surface', 'tunnel', 'bridge']) {
      for (const phase of ['casing', 'fill']) {
        const id = `tileflow-road-${structure}-steps-${phase}`;
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
        const id = `tileflow-road-tunnel-${roadClass}-${phase}`;
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
      byId.get('tileflow-road-tunnel-cycleway-shadow')?.layout?.['line-cap'],
      'butt',
      `${mapId} tunnel cycleway underlay extends beyond its portal`,
    );
  }
});

test('official road maps avoid seam-prone caps on ordinary surface and bridge segments', () => {
  for (const [mapId, map] of Object.entries({
    streets,

    baedeker,
    civica,

    ferraris,
    harad,
    siegfried,
    blueprint: blueprint,
  })) {
    const style = compileOfficialMap(map);
    const ordinaryRoadLayers = style.layers.filter(
      (layer) =>
        layer.type === 'line' &&
        /^tileflow-road-(?:surface|bridge)-/u.test(layer.id) &&
        !layer.id.includes('-steps-'),
    );
    assert.ok(ordinaryRoadLayers.length > 0, `${mapId} compiled no ordinary road lines`);
    for (const layer of ordinaryRoadLayers) {
      if (
        mapId === 'streets' &&
        layer.id.startsWith('tileflow-road-bridge-') &&
        layer.id.endsWith('-casing')
      )
        continue;
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
      /^tileflow-road-(?:surface|bridge|tunnel)-/u.test(layer.id),
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
        canopy: false,
        globalLandcover: false,
        tree: false,
      },
    }),
    tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  });

  for (const [id, map] of Object.entries({
    baedeker,
    civica,

    ferraris,
    harad,

    blueprint: blueprint,
    siegfried,
    soundings,
    streets,
  })) {
    const derived = defineMap({id: `${id}-generic`, version: 1, extends: map, data});
    const style = createStyle(derived, {preparedAssets: preparedAssets(id)});
    const layerIds = new Set(style.layers.map((layer) => layer.id));

    assert.equal(
      layerIds.has('tileflow-bathymetry'),
      id === 'soundings',
      `${id} emitted unexpected bathymetry selection`,
    );
    if (id === 'soundings') {
      assert.equal(
        style.layers.find((layer) => layer.id === 'tileflow-bathymetry')?.source,
        'tileflow-bathymetry',
      );
    }
    assert.equal(
      layerIds.has('tileflow-global-landcover'),
      false,
      `${id} emitted global landcover`,
    );
    assert.deepEqual(validateStyleMin(style as never), [], `${id} emitted an invalid style`);
  }
});

test('official maps emit only exact declared font-face stacks', () => {
  const expected = {
    baedeker: new Set([
      JSON.stringify(['Cormorant Garamond Italic']),
      JSON.stringify(['Cormorant Garamond Regular']),
      JSON.stringify(['Cormorant Garamond SemiBold']),
    ]),
    civica: new Set([
      JSON.stringify(['DM Serif Text Regular']),
      JSON.stringify(['DM Serif Text Regular', 'Noto Sans Regular']),
      JSON.stringify(['DM Serif Text Italic', 'Noto Sans Regular']),
      JSON.stringify(['Barlow Semi Condensed Regular']),
      JSON.stringify(['Barlow Semi Condensed Regular', 'Noto Sans Regular']),
      JSON.stringify(['Barlow Semi Condensed SemiBold']),
      JSON.stringify(['Barlow Semi Condensed SemiBold', 'Noto Sans Regular']),
    ]),

    ferraris: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    harad: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),

    blueprint: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    siegfried: new Set([
      JSON.stringify(['Cormorant Garamond Italic']),
      JSON.stringify(['Cormorant Garamond Regular']),
      JSON.stringify(['Cormorant Garamond SemiBold']),
    ]),
    soundings: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    streets: new Set([
      JSON.stringify(['Noto Sans Regular']),
      JSON.stringify(['Noto Sans Bold']),
      JSON.stringify(['Noto Sans Italic']),
    ]),
  } as const;

  for (const [id, map] of Object.entries({
    baedeker,
    civica,

    ferraris,
    harad,

    blueprint: blueprint,
    siegfried,
    soundings,
    streets,
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
    'tileflow-global-landcover',
    'tileflow-landcover',
    'tileflow-landcover-protected',
    'tileflow-landuse-recreation',
    'tileflow-landuse-recreation-outline',
  ]) {
    assert.equal(ids.has(id), true, `Missing compiled green layer ${id}`);
  }
  for (const id of [
    'tileflow-landcover-meadow-detail',
    'tileflow-landcover-park-detail',
    'tileflow-landuse-recreation-detail',
    'tileflow-landuse-recreation-detail-outline',
    'tileflow-landcover-legacy-park',
  ]) {
    assert.equal(ids.has(id), false, `Unexpected legacy green layer ${id}`);
  }

  const globalLandcover = style.layers.find(({id}) => id === 'tileflow-global-landcover');
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
    1,
    10.5,
    0.55,
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
    ['baedeker', baedeker, ['#E8DABD', '#9DC8CC']],
    ['civica', civica, ['#F7F3E8', '#B4C8D9']],

    ['harad', harad, ['#C4DED5', '#E1B23B']],

    ['blueprint', blueprint, ['#061D35', '#EEF3EA']],
    ['siegfried', siegfried, ['#F0EBE0', '#A96C4D']],
    ['streets-dark', streets, ['#2D3043', '#18223B']],
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
  const compiled = createStyleWithInspection(streets, {
    preparedAssets: preparedAssets(streets.id),
  });
  const {style} = compiled;
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  const layerForTarget = (target: string) => {
    const id = compiled.inspection.layers.find((layer) =>
      layer.contributions.some((contribution) => contribution.target === target),
    )?.id;
    return byId.get(id ?? '');
  };

  for (const target of [
    'buildings.render.shadowSoft',
    'buildings.render.shadowCore',
    'buildings.render.extrusion',
  ]) {
    const layer = layerForTarget(target);
    assert.ok(layer, `Streets lost runtime-toggle target ${target}`);
    assert.equal(layer.layout?.visibility, 'none');
    assert.equal(layer.metadata?.['tileflow:3d-toggle'], 'building');
  }

  const trees = byId.get('tileflow-vegetation-trees');
  assert.ok(trees, 'Streets lost its individual-tree layer');
  assert.equal(trees.type, 'circle');
  assert.equal(trees.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(trees.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');
  // The 3D trees' description, bound to the style's own source and source layers.
  const vegetation = readTileflowVegetation3D(style.metadata);
  assert.ok(vegetation, 'Streets lost its 3D tree description');
  assert.equal(vegetation.source, trees.source);
  assert.equal(vegetation.layers.tree, trees['source-layer']);
  assert.equal(vegetation.fields.leafType, 'leaf_type');
  assert.equal(vegetation.colors.broadleaf.length, 4);
  assert.equal(vegetation.colors.palm.length, 3);
  assert.deepEqual(vegetation.regions, []);
  // Core's 3D buildings take the colour of Streets' 3D building pass; its street lights are declared.
  const buildings3D = readTileflowBuildings3D(style.metadata);
  assert.ok(buildings3D, 'Streets lost its 3D buildings description');
  const extrusion = byId.get('tileflow-buildings-render-extrusion');
  assert.equal(buildings3D.color, extrusion?.paint?.['fill-extrusion-color']);
  assert.equal(buildings3D.layers.building, extrusion?.['source-layer']);
  assert.equal(buildings3D.windows, false);
  const lights = readTileflowStreetLights(style.metadata);
  assert.ok(lights, 'Streets lost its street lights description');
  assert.equal(lights.estimate, 'lit');
  assert.equal(lights.source, trees.source);

  const businessArea = layerForTarget('land.render.businessArea');
  assert.ok(businessArea, 'Streets lost its business land-use surface');
  assert.equal(businessArea.type, 'fill');
  assert.match(JSON.stringify(businessArea.filter), /business_area/u);
});

test('Streets consumes canonical producer-ranked POI and reserves house numbers for detail', () => {
  const resolved = resolveMap(streets);
  assert.notEqual(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.labels?.collisionPriority, 'navigation');
  assert.notEqual(resolved.modules?.poi?.enabled, false);
  assert.equal(resolved.modules?.poi?.color, 'category');
  assert.equal(resolved.modules?.poi?.placement?.coupleIconAndLabel, true);
  assert.equal(resolved.modules?.poi?.density, 3);
  assert.deepEqual(resolved.modules?.poi?.categories, [
    'transport',
    'food-drink',
    'lodging',
    'retail',
    'arts-entertainment',
    'landmark',
    'park-nature',
    'medical',
    'education',
    'public-services',
    'sport-leisure',
    'religion',
    'visitor-amenity',
  ]);
  assert.equal(resolved.modules?.poi?.placement?.iconPadding, 3);
  assert.equal(resolved.modules?.poi?.placement?.textPadding, 3);
  assert.equal(resolved.modules?.poi?.placement?.order, 'importance');
  assert.equal(resolved.modules?.poi?.placement?.prominentRank, 1);
  // One density for every category, and no category waits for a later zoom: World's ranks
  // decide what each category shows.
  for (const style of Object.values(resolved.modules?.poi?.styles ?? {})) {
    assert.equal('density' in (style ?? {}), false);
    assert.equal(style?.minZoom, undefined);
  }

  const style = compileOfficialMap(streets);
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  assert.equal(byId.get('tileflow-addresses-labels')?.minzoom, 17);
  assert.equal(byId.has('tileflow-parking-symbol-disc'), false);
  assert.equal(byId.has('tileflow-parking-symbol-label'), false);

  const expectedPoiTextColors = {
    'arts-entertainment': '#F042B6',
    education: '#916130',
    'food-drink': '#F57A00',
    landmark: '#F042B6',
    lodging: '#664CE6',
    medical: '#F53D3D',
    'park-nature': '#267915',
    'public-services': '#586E84',
    religion: '#586E84',
    retail: '#2D87E1',
    'sport-leisure': '#1891AA',
    transport: '#3359CC',
    'visitor-amenity': '#586E84',
  } as const;
  // Every category is placed in World's importance order: one layer for the most important
  // ranks, placed before street and place names, and one for the rest.
  assert.deepEqual(
    style.layers.filter(({id}) => id.startsWith('tileflow-poi')).map(({id}) => id),
    ['tileflow-poi', 'tileflow-poi-prominent'],
  );
  const layerIds = style.layers.map(({id}) => id);
  assert.ok(
    layerIds.indexOf('tileflow-poi-prominent') > layerIds.indexOf('tileflow-label-place-city'),
  );
  assert.ok(layerIds.indexOf('tileflow-poi') < layerIds.indexOf('tileflow-label-place-city'));
  for (const [id, ranks] of [
    ['tileflow-poi', '>'],
    ['tileflow-poi-prominent', '<='],
  ] as const) {
    const layer = byId.get(id);
    assert.ok(layer, `Streets lost POI layer ${id}`);
    assert.equal(layer.minzoom, 0);
    assert.equal(layer.layout?.['icon-optional'], false);
    // A disc needs its name; parking and toilets are drawn as a disc alone.
    assert.equal(layer.layout?.['text-optional'], false);
    assert.match(JSON.stringify(layer.layout?.['text-field']), /"public_restroom"\],""/u);
    assert.equal(layer.layout?.['text-anchor'], 'top');
    assert.deepEqual(layer.layout?.['text-offset'], [0, 0.8]);
    assert.deepEqual(layer.layout?.['symbol-sort-key'], [
      '+',
      ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
      ['to-number', ['get', 'size_rank'], 17],
    ]);
    const filter = layer.filter as unknown[];
    assert.deepEqual(filter[1], [
      'match',
      ['get', 'category'],
      [...(resolved.modules?.poi?.categories ?? [])],
      true,
      false,
    ]);
    assert.doesNotMatch(JSON.stringify(filter), /"class"|"subclass"|"rank"/u);
    assert.deepEqual(filter[4], [
      '<=',
      ['to-number', ['get', 'filter_rank'], 6],
      ['+', ['step', ['zoom'], 0, 16, 1, 17, 2], 3],
    ]);
    assert.deepEqual(filter.at(-1), [ranks, ['to-number', ['get', 'filter_rank'], 6], 1]);
    assert.equal(layer.paint?.['text-halo-color'], '#FFFFFF');
    const textColor = createPropertyExpression(
      layer.paint?.['text-color'],
      latest.paint_symbol['text-color'] as never,
    );
    assert.equal(textColor.result, 'success');
    for (const [category, color] of Object.entries(expectedPoiTextColors)) {
      assert.equal(
        String(
          (textColor.value as {evaluate: (...args: unknown[]) => unknown}).evaluate(
            {zoom: 16},
            {type: 1, properties: {category}},
          ),
        ),
        String(Color.parse(color)),
        category,
      );
    }
  }

  // Pictograms follow World's transport mode and type before falling back to the category.
  const image = createPropertyExpression(
    byId.get('tileflow-poi')?.layout?.['icon-image'],
    latest.layout_symbol['icon-image'] as never,
  );
  assert.equal(image.result, 'success');
  const pictogram = (properties: Record<string, string>) =>
    String(
      (image.value as {evaluate: (...args: unknown[]) => unknown}).evaluate(
        {zoom: 16},
        {type: 1, properties},
      ),
    );
  for (const [properties, expected] of [
    [{category: 'transport', mode: 'subway', type: 'public_transit_facility'}, 'major-transit'],
    [{category: 'transport', mode: 'train', type: 'train_station'}, 'rail'],
    [{category: 'transport', mode: 'tram', type: 'tram_stop'}, 'rail-light'],
    [{category: 'transport', mode: 'bus', type: 'bus_stop'}, 'bus'],
    [{category: 'transport', mode: 'ferry', type: 'ferry_terminal'}, 'ferry'],
    [{category: 'transport', mode: 'aerialway', type: 'ground_transport_facility'}, 'aerialway'],
    [{category: 'transport', type: 'airport'}, 'airport'],
    [{category: 'food-drink', type: 'bar'}, 'bar'],
    [{category: 'food-drink', type: 'cafe'}, 'coffee'],
    [{category: 'food-drink', type: 'restaurant'}, 'food'],
    [{category: 'arts-entertainment', type: 'museum'}, 'culture'],
    [{category: 'arts-entertainment', type: 'art_gallery'}, 'art-gallery'],
    [{category: 'retail', type: 'vehicle_dealer'}, 'car'],
    [{category: 'retail', type: 'specialty_store'}, 'shopping'],
    [{category: 'religion', type: 'christian_place_of_worship'}, 'christian'],
    [{category: 'visitor-amenity', type: 'public_restroom'}, 'toilet'],
    [{category: 'visitor-amenity', type: 'parking'}, 'parking'],
    [{category: 'park-nature', type: 'park'}, 'nature'],
  ] as const) {
    assert.equal(pictogram(properties), expected, JSON.stringify(properties));
  }
  assert.deepEqual(validateStyleMin(style as never), []);
});
