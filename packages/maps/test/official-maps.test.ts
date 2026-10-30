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
  refine,
  reset,
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
  map1777,
  map1777Fonts,
  map1777Icons,
  siegfried,
  siegfriedFonts,
  siegfriedIcons,
  siegfriedThemes,
  soundings,
  soundingsIcons,
  streets,
  streetsFonts,
  streetsIcons,
  streetsThemes,
} from '../src';
import {streetsPreparedModels, streetsTreeIconIds} from './streets-assets';
import {streetsPoiImageIds} from './streets-poi-fixture';
import {standardCartographyReference as colorReference} from './streets-standard-cartography-fixture';

const officialIconIds = [
  ...streetsTreeIconIds,
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
  'map-1777-crop-cross',
  'map-1777-crop-hatch',
  'map-1777-crop-lines',
  'map-1777-heath',
  'map-1777-orchard',
  'map-1777-paper-grain',
  'map-1777-residential',
  'map-1777-sand',
  'map-1777-water-ripples',
  'map-1777-wetland',
  'map-1777-woodland',
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
  'soundings-boat-hoist',
  'soundings-boatyard',
  'soundings-buoy-cardinal',
  'soundings-buoy-pillar',
  'soundings-buoy-port',
  'soundings-buoy-starboard',
  'soundings-distance-mark',
  'soundings-facility',
  'soundings-fuel-station',
  'soundings-harbor',
  'soundings-light-flare',
  'soundings-lighthouse',
  'soundings-marina',
  'soundings-notice',
  'soundings-notice-information',
  'soundings-notice-prohibition',
  'soundings-notice-recommendation',
  'soundings-notice-regulation',
  'soundings-notice-restriction',
  'soundings-paper-grain',
  'soundings-pump-out',
  'soundings-rock-awash',
  'soundings-slipway',
  'soundings-visitor-berth',
  'soundings-water-dots',
  'soundings-water-tap',
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
const map1777PatternIds = [
  'map-1777-crop-cross',
  'map-1777-crop-hatch',
  'map-1777-crop-lines',
  'map-1777-heath',
  'map-1777-orchard',
  'map-1777-paper-grain',
  'map-1777-residential',
  'map-1777-sand',
  'map-1777-water-ripples',
  'map-1777-wetland',
  'map-1777-woodland',
] as const;
const soundingsIconIds = [
  'soundings-boat-hoist',
  'soundings-boatyard',
  'soundings-buoy-cardinal',
  'soundings-buoy-pillar',
  'soundings-buoy-port',
  'soundings-buoy-starboard',
  'soundings-distance-mark',
  'soundings-facility',
  'soundings-fuel-station',
  'soundings-harbor',
  'soundings-light-flare',
  'soundings-lighthouse',
  'soundings-marina',
  'soundings-notice',
  'soundings-notice-information',
  'soundings-notice-prohibition',
  'soundings-notice-recommendation',
  'soundings-notice-regulation',
  'soundings-notice-restriction',
  'soundings-paper-grain',
  'soundings-pump-out',
  'soundings-rock-awash',
  'soundings-slipway',
  'soundings-visitor-berth',
  'soundings-water-dots',
  'soundings-water-tap',
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
  return {
    models: streetsPreparedModels,
    icons: {ids: officialIconIds, sprite: `/tileflow/icons/${id}/sprite`},
  };
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

    'map-1777': map1777,
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
  for (const map of [streets, baedeker, civica, map1777, siegfried, soundings, blueprint]) {
    assertDeepFrozen(map);
  }

  assert.throws(() => {
    (streets as {name: string}).name = 'Mutated Streets';
  }, TypeError);
  assert.throws(() => {
    (streets as {extends: typeof map1777}).extends = map1777;
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
  const resolvedMap1777 = resolveMap(map1777);
  const resolvedBlueprint = resolveMap(blueprint);
  const resolvedSiegfried = resolveMap(siegfried);
  const resolvedSoundings = resolveMap(soundings);

  assert.deepEqual(resolvedBaedeker.icons, [baedekerIcons]);
  assert.deepEqual(resolvedCivica.icons, [civicaIcons]);
  assert.deepEqual(resolvedStreets.icons, [streetsIcons]);
  assert.deepEqual(resolvedMap1777.icons, [map1777Icons]);
  assert.deepEqual(resolvedMap1777.fonts, [map1777Fonts]);
  assert.equal(resolvedMap1777.glyphs, undefined);
  assert.deepEqual(resolvedBlueprint.icons, [blueprintIcons]);
  assert.deepEqual(resolvedSiegfried.icons, [siegfriedIcons]);
  assert.deepEqual(resolvedSoundings.icons, [soundingsIcons]);
  assert.deepEqual(resolvedBaedeker.fonts, [baedekerFonts]);
  assert.deepEqual(resolvedSiegfried.fonts, [siegfriedFonts]);
  assert.equal(resolvedBaedeker.glyphs, undefined);
  assert.equal(resolvedSiegfried.glyphs, undefined);
  assert.deepEqual(resolvedStreets.fonts, [streetsFonts]);
  assert.equal(resolvedStreets.glyphs, undefined);
  assert.deepEqual(resolvedCivica.fonts, [civicaFonts]);
  assert.equal(resolvedCivica.glyphs, undefined);
  for (const map of [resolvedSoundings, resolvedBlueprint]) {
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
  assert.equal(resolvedMap1777.themes.light.typography?.font, 'Cormorant Garamond Regular');
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

test('1777 is self-contained and references exactly its package-owned patterns', () => {
  const resolved = resolveMap(map1777);
  assert.equal(map1777.name, '1777');
  assert.equal('extends' in map1777, false);
  assert.equal('root' in resolved, false);
  assert.deepEqual(resolved.icons, [map1777Icons]);

  const compiled = createStyleWithInspection(map1777, {
    preparedAssets: {
      icons: {ids: map1777PatternIds, sprite: '/tileflow/icons/map-1777/sprite'},
    },
  });
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern')
          ? [...JSON.stringify(value).matchAll(/"(map-1777-[a-z-]+)"/g)].map((match) => match[1])
          : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), map1777PatternIds);

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
    assert.equal(targets.has(target), true, `Missing 1777 render target ${target}`);
  }
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
  // Chart patterns and the Nautical point symbols come only from the Soundings directory.
  for (const id of [
    'soundings-boat-hoist',
    'soundings-boatyard',
    'soundings-buoy-cardinal',
    'soundings-buoy-pillar',
    'soundings-buoy-port',
    'soundings-buoy-starboard',
    'soundings-distance-mark',
    'soundings-facility',
    'soundings-fuel-station',
    'soundings-harbor',
    'soundings-light-flare',
    'soundings-lighthouse',
    'soundings-marina',
    'soundings-notice',
    'soundings-notice-information',
    'soundings-notice-prohibition',
    'soundings-notice-recommendation',
    'soundings-notice-regulation',
    'soundings-notice-restriction',
    'soundings-paper-grain',
    'soundings-pump-out',
    'soundings-slipway',
    'soundings-visitor-berth',
    'soundings-water-dots',
    'soundings-water-tap',
    'soundings-wreck',
  ]) {
    assert.match(serialized, new RegExp(`"${id}"`, 'u'), `Soundings does not reference ${id}`);
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

    'map-1777': map1777,
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
      ['baedeker', 'civica', 'map-1777', 'siegfried', 'streets'].includes(id)
        ? undefined
        : officialGlyphsUrl,
    );
    assert.ok(
      style.layers.length > (id === 'soundings' ? 50 : 100),
      `${id} compiled an unexpectedly incomplete layer stack`,
    );
  }
});

test('Streets access restrictions preserve each road class fill and casing colors', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compileOfficialMap(streets, theme);
    for (const zoom of [16.5, 18.37]) {
      for (const roadClass of ['trunk', 'motorway', 'service']) {
        const properties = {class: roadClass, surface: 'paved', oneway: 1};
        for (const phase of ['fill', 'casing']) {
          const layer = style.layers.find(
            (candidate) =>
              candidate.type === 'line' &&
              candidate.id.startsWith('tileflow-road-surface-') &&
              candidate.id.endsWith(`-${phase}`) &&
              (candidate.minzoom ?? 0) <= zoom &&
              (candidate.maxzoom ?? 24) > zoom &&
              featureFilter(candidate.filter as never).filter({zoom}, {
                type: 2,
                properties,
              } as never),
          );
          assert.ok(layer, `${theme}: missing ${roadClass} ${phase} at z${zoom}`);
          const color = createPropertyExpression(
            layer.paint?.['line-color'],
            latest.paint_line['line-color'] as never,
          );
          assert.equal(color.result, 'success');
          if (color.result !== 'success') throw new Error('Road color expression did not compile');
          const baseline = String(color.value.evaluate({zoom}, {type: 2, properties} as never));
          for (const access of ['no', 'private']) {
            const restricted = {type: 2, properties: {...properties, access}};
            assert.equal(
              featureFilter(layer.filter as never).filter({zoom}, restricted as never),
              true,
              `${theme}: restricted ${roadClass} remains in the same physical layer`,
            );
            assert.equal(
              String(color.value.evaluate({zoom}, restricted as never)),
              baseline,
              `${theme}: ${roadClass} ${phase} with access=${access} must preserve its class color at z${zoom}`,
            );
          }
        }
      }
    }
  }
});

test('Streets highway links retain class colors below receiving carriageways', () => {
  for (const theme of ['light', 'dawn', 'dusk', 'dark'] as const) {
    const {style, inspection} = createStyleWithInspection(streets, {
      preparedAssets: preparedAssets(streets.id),
      theme,
    });
    for (const zoom of [17.509138, 18.37]) {
      for (const structure of ['surface', 'bridge', 'tunnel']) {
        const fillFor = (roadClass: string, ramp: number) => {
          const feature = {
            type: 2,
            properties: {class: roadClass, brunnel: structure, ramp, oneway: 1, surface: 'paved'},
          } as never;
          const fillTargets = new Set([
            `roads.classes.${roadClass}.${structure}.fill`,
            `roads.classes.${roadClass}.${structure}.rampFill`,
          ]);
          const layers = inspection.layers
            .filter(({contributions}) => contributions.some(({target}) => fillTargets.has(target)))
            .map(({index}) => style.layers[index]!)
            .filter(
              (layer) =>
                (layer.minzoom ?? 0) <= zoom &&
                (layer.maxzoom ?? 24) > zoom &&
                featureFilter(layer.filter as never).filter({zoom}, feature),
            );
          assert.equal(layers.length, 1, `${theme}: one ${structure} ${roadClass} fill`);
          const layer = layers[0]!;
          const expression = createPropertyExpression(
            layer.paint?.['line-color'],
            latest.paint_line['line-color'] as never,
          );
          assert.equal(expression.result, 'success');
          if (expression.result !== 'success') throw new Error('Invalid road color expression');
          return {layer, color: String(expression.value.evaluate({zoom}, feature))};
        };
        const receiving = fillFor('primary', 0);
        for (const roadClass of ['motorway', 'trunk']) {
          const ramp = fillFor(roadClass, 1);
          assert.equal(ramp.color, fillFor(roadClass, 0).color, 'Links keep their class color');
          if (theme === 'light' && structure !== 'tunnel') {
            assert.equal(ramp.color, receiving.color, 'Day main roads share the darker swatch');
            assert.notEqual(ramp.color, fillFor('secondary', 0).color);
          } else {
            assert.notEqual(
              ramp.color,
              receiving.color,
              'Highway links remain distinct from streets',
            );
          }
          if (structure !== 'tunnel') {
            assert.ok(
              style.layers.indexOf(ramp.layer) < style.layers.indexOf(receiving.layer),
              `${theme}: ${structure} ${roadClass} ramp endpoint must be covered by the receiving fill`,
            );
          }
        }
      }
    }
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

    'map-1777': map1777,
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
        (mapId === 'streets' || mapId === 'map-1777') &&
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

    'map-1777': map1777,
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

    'map-1777': new Set(
      [
        'Cormorant Garamond Regular',
        'Cormorant Garamond SemiBold',
        'Cormorant Garamond Italic',
      ].map((font) => JSON.stringify([font])),
    ),

    blueprint: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    siegfried: new Set([
      JSON.stringify(['Cormorant Garamond Italic']),
      JSON.stringify(['Cormorant Garamond Regular']),
      JSON.stringify(['Cormorant Garamond SemiBold']),
    ]),
    soundings: new Set([JSON.stringify(['Noto Sans Regular']), JSON.stringify(['Noto Sans Bold'])]),
    streets: new Set([
      JSON.stringify(['DINish Medium', 'Noto Sans Regular']),
      JSON.stringify(['DINish Bold', 'Noto Sans Regular']),
      JSON.stringify(['Noto Sans Regular']),
      JSON.stringify(['Noto Sans Bold']),
      JSON.stringify(['Noto Sans Italic']),
    ]),
  } as const;

  for (const [id, map] of Object.entries({
    baedeker,
    civica,

    'map-1777': map1777,
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
  const {style, inspection} = createStyleWithInspection(streets, {
    preparedAssets: preparedAssets(streets.id),
  });
  const ids = new Set(style.layers.map(({id}) => id));
  const targetIndex = (target: string) => {
    const layer = inspection.layers.find(({contributions}) =>
      contributions.some((contribution) => contribution.target === target),
    );
    assert.ok(layer, `Missing compiled green target ${target}`);
    return layer.index;
  };
  for (const target of [
    'land.globalLandcover',
    'land.landcover.grass.fill',
    'land.landcover.meadow.fill',
    'land.landcover.protected.fill',
    'land.landcover.urbanPark.fill',
    'land.landuse.recreation.fill',
    'land.landuse.recreation.outline',
    'land.landuse.parking.fill',
  ]) {
    targetIndex(target);
  }
  for (const detail of ['grass', 'meadow', 'scrub', 'flowerbed']) {
    const position = targetIndex(`land.landcover.${detail}.fill`);
    for (const park of ['protected', 'urbanPark']) {
      assert.ok(position > targetIndex(`land.landcover.${park}.fill`));
    }
    assert.ok(position < targetIndex('land.landuse.recreation.fill'));
    assert.ok(position < targetIndex('land.landuse.parking.fill'));
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

test('Streets road labels retain class thresholds and readable text below buildings and POIs', () => {
  const expectations = [
    ['motorway', 'motorway', undefined, 10, 9, 16, 0.15],
    ['trunk', 'trunk', undefined, 10, 9, 16, 0.15],
    ['primary', 'primary', undefined, 12, 9, 16, 0.15],
    ['secondary', 'secondary', undefined, 12, 9, 16, 0.15],
    ['tertiary', 'tertiary', undefined, 13, 9, 16, 0.15],
    ['minor', 'minor', undefined, 13, 8, 14, 0.15],
    ['service', 'service', undefined, 15, 6.5, 13, 0.15],
    ['track', 'track', undefined, 15, 6.5, 13, 0.15],
    ['pathway', 'path', 'path', 15, 6.5, 13, 0.01],
    ['footway', 'path', 'footway', 15, 6.5, 13, 0.01],
    ['cycleway', 'path', 'cycleway', 15, 6.5, 13, 0.01],
    ['steps', 'path', 'steps', 15, 6.5, 13, 0.01],
    ['pedestrian', 'path', 'pedestrian', 12, 9, 14, 0.01],
  ] as const;
  const resolved = resolveMap(streets);
  assert.equal(resolved.modules.labels?.roadPlacement, 'ground');
  assert.equal(resolved.modules.labels?.roadGrouping, 'network');
  assert.equal(resolved.modules.labels?.roads, 'all');
  assert.deepEqual(
    [...resolved.modules.labels!.roadClasses!].sort(),
    expectations.map(([roadClass]) => roadClass).sort(),
  );
  for (const [theme, reference] of [
    ['light', 'default-day'],
    ['dawn', 'default-dawn'],
    ['dusk', 'default-dusk'],
    ['dark', 'default-night'],
  ] as const) {
    const {style, inspection} = createStyleWithInspection(streets, {
      preparedAssets: preparedAssets(streets.id),
      theme,
    });
    const roadLayers = inspection.layers.filter(({contributions}) =>
      contributions.some(({target}) => target.startsWith('labels.roads.')),
    );
    assert.equal(roadLayers.length, 2, 'roads and pedestrian paths each share placement');
    const nativeTargets = new Set(
      roadLayers.flatMap(({contributions}) =>
        contributions
          .filter(({target}) => target.startsWith('labels.roads.'))
          .map(({target}) => target),
      ),
    );
    assert.deepEqual(
      [...nativeTargets].sort(),
      expectations.map(([roadClass]) => `labels.roads.${roadClass}`).sort(),
    );
    assert.ok(
      !inspection.layers.some(({contributions}) =>
        contributions.some(({target}) => target.startsWith('labels.render.street')),
      ),
    );
    const footprintIndex = inspection.layers.find(({contributions}) =>
      contributions.some(({target}) => target === 'buildings.flat.fill'),
    )!.index;
    const buildingIndex = style.layers.findIndex(
      ({id}) => id === 'tileflow-buildings-render-extrusion',
    );
    const destinationIndex = style.layers.findIndex(({id}) => id === 'tileflow-poi');
    assert.ok(destinationIndex > buildingIndex);
    for (const layer of roadLayers) {
      assert.ok(layer.index > footprintIndex, `${theme}: flat footprints cannot clip street names`);
      assert.ok(layer.index < buildingIndex, `${theme}: buildings hide street names`);
      assert.ok(
        layer.index < destinationIndex,
        `${theme}: destinations win street-name collisions`,
      );
    }
    const physical = roadLayers.map(({index}) => style.layers[index]!);
    const active = (properties: Record<string, unknown>, zoom: number) =>
      physical.filter(
        (layer) =>
          (layer.minzoom ?? 0) <= zoom &&
          (layer.maxzoom ?? 24) > zoom &&
          featureFilter(layer.filter as never).filter({zoom}, {type: 2, properties} as never),
      );
    // Dense overview grids retain the main thoroughfare before parallel local streets;
    // the extra screen padding must be gone by neighbourhood zoom.
    for (const zoom of [13, 14, 17]) {
      const properties = {name: 'A road', class: 'primary'};
      const network = active(properties, zoom)[0]!;
      const evaluateLayout = (key: 'text-padding' | 'symbol-sort-key', roadClass: string) => {
        const parsed = createPropertyExpression(
          network.layout?.[key],
          latest.layout_symbol[key] as never,
        );
        assert.equal(parsed.result, 'success');
        if (parsed.result !== 'success') throw new Error(`Invalid ${key}`);
        return parsed.value.evaluate({zoom}, {
          type: 2,
          properties: {...properties, class: roadClass},
        } as never);
      };
      assert.ok(
        evaluateLayout('symbol-sort-key', 'primary') < evaluateLayout('symbol-sort-key', 'minor'),
      );
      assert.equal(
        evaluateLayout('symbol-sort-key', 'primary'),
        evaluateLayout('symbol-sort-key', 'primary_construction'),
      );
      assert.equal(evaluateLayout('text-padding', 'primary'), zoom === 13 ? 5 : 1);
    }
    for (const [
      roadClass,
      sourceClass,
      subclass,
      minZoom,
      startSize,
      endSize,
      letterSpacing,
    ] of expectations) {
      const properties = {
        name: 'Local street',
        class: sourceClass,
        ...(subclass ? {subclass} : {}),
      };
      assert.equal(
        active(properties, minZoom - 0.01).length,
        0,
        `${theme}: ${roadClass} starts at z${minZoom}`,
      );
      assert.equal(
        active(properties, minZoom).length,
        1,
        `${theme}: ${roadClass} is visible at its threshold`,
      );
      for (const zoom of [16.25, 18]) {
        const matching = active(properties, zoom);
        assert.equal(matching.length, 1, `${theme}: one ${roadClass} street name at z${zoom}`);
        const layer = matching[0]!;
        const evaluate = (property: string, group: 'layout' | 'paint') => {
          const expression = createPropertyExpression(
            layer[group]?.[property],
            (group === 'layout' ? latest.layout_symbol : latest.paint_symbol)[
              property as never
            ] as never,
          );
          assert.equal(expression.result, 'success', `${theme}: ${property}`);
          if (expression.result !== 'success') throw new Error(`Invalid ${property}`);
          return expression.value.evaluate({zoom}, {type: 2, properties} as never);
        };
        const expectedSize = startSize + (endSize - startSize) * ((zoom - 10) / 8);
        assert.ok(Math.abs(Number(evaluate('text-size', 'layout')) - expectedSize) < 1e-6);
        assert.equal(evaluate('text-letter-spacing', 'layout'), letterSpacing);
        assert.equal(
          evaluate('symbol-spacing', 'layout'),
          zoom < 17 ? 300 + (zoom - 15) * 50 : 400 + (zoom - 17) * 25,
        );
        assert.equal(evaluate('text-transform', 'layout'), 'uppercase');
        assert.equal(evaluate('text-pitch-alignment', 'layout'), 'viewport');
        assert.equal(evaluate('text-rotation-alignment', 'layout'), 'map');
        assert.equal(evaluate('text-halo-width', 'paint'), 1);
        assert.equal(
          String(evaluate('text-color', 'paint')),
          String(Color.parse(colorReference.colors[reference]['labels.road'])),
        );
        assert.equal(
          String(evaluate('text-halo-color', 'paint')),
          String(Color.parse(colorReference.colors[reference]['labels.roadHalo'])),
        );
      }
      const construction = {...properties, class: `${sourceClass}_construction`};
      assert.equal(
        active(construction, 18).length,
        1,
        `${theme}: ${roadClass} construction stays in the native class`,
      );
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
      assert.equal(
        active({name: 'Path', class: 'path', subclass}, 18).length,
        1,
        `${theme}: path classes stay disjoint`,
      );
    }
  }
});

test('non-Streets official maps do not use Streets surface colors', () => {
  const compile = compileOfficialMap;
  const streetsSurfaceSignatures = ['#AEDBFC', '#B7E2AC', '#C2E8B3', '#D5E8D0', '#E0ECD8'];

  for (const [id, map, ownSignatures] of [
    ['baedeker', baedeker, ['#E8DABD', '#9DC8CC']],
    ['civica', civica, ['#F7F3E8', '#B4C8D9']],

    ['blueprint', blueprint, ['#061D35', '#EEF3EA']],
    ['siegfried', siegfried, ['#F0EBE0', '#A96C4D']],
    ['streets-dark', streets, ['#2B2F43', '#12233B']],
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
  // Core's 3D buildings take the colour of Streets' 3D building pass; street lights stay off.
  const buildings3D = readTileflowBuildings3D(style.metadata);
  assert.ok(buildings3D, 'Streets lost its 3D buildings description');
  const extrusion = byId.get('tileflow-buildings-render-extrusion');
  assert.deepEqual(buildings3D.color, extrusion?.paint?.['fill-extrusion-color']);
  assert.equal(buildings3D.layers.building, extrusion?.['source-layer']);
  assert.equal(buildings3D.windows, false);
  assert.equal(buildings3D.verticalGradient, true);
  assert.equal(buildings3D.edgeRadius, 1.5);
  assert.equal(buildings3D.lighting, 'sun');
  assert.equal(buildings3D.shadows, true);
  assert.equal(buildings3D.occlusion, true);
  // Tileflow's landmarks stand on Streets' Tileflow World buildings.
  assert.match(buildings3D.landmarks?.url ?? '', /\/landmarks\/tiles\.json$/u);
  assert.equal(readTileflowStreetLights(style.metadata), undefined);

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
  assert.equal(resolved.modules?.poi?.density, 2);
  assert.equal(resolved.modules?.poi?.detailZoom, 18);
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
  // Category thresholds use World ranks; styles do not impose category-wide zoom gates.
  for (const style of Object.values(resolved.modules?.poi?.styles ?? {})) {
    assert.equal('density' in (style ?? {}), false);
    assert.equal(style?.minZoom, undefined);
  }

  const style = compileOfficialMap(streets);
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  assert.equal(byId.get('tileflow-addresses-labels')?.minzoom, 17);
  for (const id of ['tileflow-addresses-labels', 'tileflow-poi']) {
    assert.equal(
      (byId.get(id)?.metadata as Record<string, unknown>)?.['tileflow:label-perspective'],
      undefined,
    );
  }
  assert.equal(byId.has('tileflow-parking-symbol-disc'), false);
  assert.equal(byId.has('tileflow-parking-symbol-label'), false);

  const expectedPoiTextColors = Object.fromEntries(
    Object.entries(colorReference.colors['default-day'])
      .filter(
        ([role]) =>
          role.startsWith('poi.') && !['poi.halo', 'poi.icon', 'poi.label'].includes(role),
      )
      .map(([role, color]) => [role.slice(4), color]),
  );
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
    // Category/zoom eligibility is evaluated in streets-dark.test.ts; this check covers
    // the shared rank contract and placement tier without fixing the expression shape.
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

test('Streets buildings switch to native extrusions only without the flat render stack', () => {
  const extend = (buildings: Parameters<typeof refine>[0]) =>
    defineMap({
      id: 'streets-extrusions',
      version: 1,
      extends: streets,
      modules: {buildings: refine(buildings)},
    });
  assert.throws(() => compileOfficialMap(extend({mode: '3d'}), 'light'), {
    code: 'unknown-refinement-target',
    message:
      /targets buildings\.flat\.fill, which buildings draws only in mode 'flat'.*refine\(\{mode: '3d', renderStack: reset\(\)\}\)/u,
  });

  const layerIds = compileOfficialMap(extend({mode: '3d', renderStack: reset()}), 'light')
    .layers.map(({id}) => id)
    .filter((id) => id.startsWith('tileflow-buildings'));
  assert.deepEqual(layerIds, ['tileflow-buildings-3d']);
});

test('Streets colours the water, vegetation and wood parts of models in every theme', () => {
  for (const theme of Object.keys(streetsThemes)) {
    const style = compileOfficialMap(streets, theme);
    const buildings = readTileflowBuildings3D(style.metadata);
    const trees = readTileflowVegetation3D(style.metadata);
    assert.ok(buildings?.modelColors);
    assert.ok(trees);

    assert.equal(buildings.modelColors.wood, trees.colors.bark);
    assert.equal(buildings.modelColors.vegetation, trees.colors.broadleaf[1]);
    assert.ok(Color.parse(buildings.modelColors.water!));
    assert.equal(
      buildings.modelColors.water,
      resolveMap(streets).themes[theme]!.tokens.color['hydro.water'],
    );
    assert.equal(buildings.modelLighting?.unclassified?.emissiveStrength, 0);
    assert.equal(
      buildings.modelColors.glass,
      resolveMap(streets).themes[theme]!.tokens.color['buildings.modelGlass'],
    );
  }
});
