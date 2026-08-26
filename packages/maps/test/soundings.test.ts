import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyle, defineMap, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
import {soundings, soundingsIcons} from '../src';

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

const preparedAssets = {
  icons: {ids: soundingsIconIds, sprite: '/tileflow/icons/soundings/sprite'},
} as const;

test('Soundings is a frozen independent root with only its own asset directory', async () => {
  assert.equal(Object.isFrozen(soundings), true);
  assert.deepEqual(soundings.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal('extends' in soundings, false);
  assert.deepEqual(resolveMap(soundings).icons, [soundingsIcons]);

  const source = await readFile(new URL('../src/official/soundings.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineRootMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:\s*streets\b/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
});

test('Soundings compiles a focused nautical chart from Tileflow World V1', () => {
  const style = createStyle(soundings, {preparedAssets});
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));

  assert.equal(style.metadata?.['tileflow:map'], 'soundings');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
  assert.equal(style.sprite, '/tileflow/icons/soundings/sprite');
  assert.deepEqual(validateStyleMin(style as never), []);

  assert.equal(byId.get('streets-background')?.paint?.['background-color'], '#EADDB9');
  assert.equal(
    byId.get('streets-background')?.paint?.['background-pattern'],
    'soundings-paper-grain',
  );
  assert.equal(byId.get('streets-water')?.paint?.['fill-color'], '#F7FBF8');

  for (const pattern of [
    /^streets-road-/u,
    /^streets-buildings?-/u,
    /^streets-address/u,
    /^streets-aeroway/u,
    /^streets-transit-(?:rail|cableway)/u,
  ]) {
    assert.equal(
      style.layers.some(({id}) => pattern.test(id)),
      false,
      `Soundings emitted excluded terrestrial layer family ${pattern.source}`,
    );
  }

  const bathymetry = byId.get('streets-bathymetry');
  const bathymetryContours = byId.get('streets-bathymetry-contours');
  const bathymetryLabels = byId.get('streets-bathymetry-labels');
  assert.ok(bathymetry);
  assert.equal(bathymetry['source-layer'], 'bathymetry');
  assert.match(JSON.stringify(bathymetry.paint?.['fill-color']), /#BBDDDC/u);
  assert.match(JSON.stringify(bathymetry.paint?.['fill-color']), /#F8FAF5/u);
  assert.ok(bathymetryContours);
  assert.equal(bathymetryContours['source-layer'], 'bathymetry');
  assert.equal(bathymetryContours.paint?.['line-color'], '#466F73');
  assert.deepEqual(bathymetryContours.paint?.['line-dasharray'], [4, 2]);
  assert.match(JSON.stringify(bathymetryContours.filter), /min_depth/u);
  assert.match(JSON.stringify(bathymetryContours.filter), /"<"/u);
  assert.ok(bathymetryLabels);
  assert.equal(bathymetryLabels['source-layer'], 'bathymetry');
  assert.equal(bathymetryLabels.layout?.['symbol-placement'], 'line');
  assert.equal(bathymetryLabels.layout?.['symbol-spacing'], 320);
  assert.match(JSON.stringify(bathymetryLabels.layout?.['text-field']), /min_depth/u);
  assert.match(JSON.stringify(bathymetryLabels.layout?.['text-field']), /200–1 000 m/u);

  const pierOutline = byId.get('soundings-pier-outline');
  const pierDeck = byId.get('soundings-pier-deck');
  assert.equal(pierOutline?.['source-layer'], 'transportation');
  assert.equal(pierOutline?.paint?.['line-color'], '#263D3F');
  assert.match(JSON.stringify(pierOutline?.filter), /pier/u);
  assert.equal(pierDeck?.['source-layer'], 'transportation');
  assert.equal(pierDeck?.paint?.['line-color'], '#EADDB9');

  const ferryLabels = byId.get('soundings-ferry-route-labels');
  assert.equal(ferryLabels?.['source-layer'], 'transportation_name');
  assert.equal(ferryLabels?.layout?.['symbol-placement'], 'line');
  assert.equal(ferryLabels?.layout?.['text-field']?.[1], 'name');
  assert.match(JSON.stringify(ferryLabels?.filter), /ferry/u);

  assert.equal(
    byId.get('soundings-water-dots-pattern')?.paint?.['fill-pattern'],
    'soundings-water-dots',
  );
  assert.equal(
    byId.get('soundings-water-intermittent-dots-pattern')?.paint?.['fill-pattern'],
    'soundings-water-dots',
  );

  for (const id of [
    'streets-boundary-maritime',
    'streets-boundary-disputed',
    'streets-boundary-disputed-maritime',
  ]) {
    assert.equal(byId.get(id)?.paint?.['line-color'], '#B12A73', `${id} lost technical magenta`);
  }
  assert.equal(byId.get('streets-transit-ferry')?.paint?.['line-color'], '#466F73');
  assert.deepEqual(byId.get('streets-transit-ferry')?.paint?.['line-dasharray'], [7, 2, 1, 2]);

  assert.equal(byId.has('streets-poi-ferry-terminal-icon'), false);
  assert.equal(byId.get('streets-poi-ferry-terminal-marker')?.paint?.['circle-color'], '#B12A73');
  assert.ok(byId.get('streets-poi-ferry-terminal-label'));

  const nauticalIcons = {
    'streets-poi-buoy-cardinal-icon': 'soundings-buoy-cardinal',
    'streets-poi-buoy-port-icon': 'soundings-buoy-port',
    'streets-poi-buoy-starboard-icon': 'soundings-buoy-starboard',
    'streets-poi-harbor-icon': 'soundings-harbor',
    'streets-poi-light-icon': 'soundings-light-flare',
    'streets-poi-lighthouse-icon': 'soundings-lighthouse',
    'streets-poi-rock-awash-icon': 'soundings-rock-awash',
    'streets-poi-wreck-icon': 'soundings-wreck',
  } as const;
  for (const [layerId, iconId] of Object.entries(nauticalIcons)) {
    const layer = byId.get(layerId);
    assert.ok(layer, `Soundings lost nautical POI layer ${layerId}`);
    assert.equal(layer.layout?.['icon-image'], iconId);
  }
  for (const id of [
    'streets-poi-buoy-cardinal-icon',
    'streets-poi-buoy-port-icon',
    'streets-poi-buoy-starboard-icon',
  ]) {
    assert.equal(byId.get(id)?.paint?.['icon-color'], '#263D3F', `${id} inferred an IALA colour`);
  }
});

test('Soundings degrades cleanly on generic OpenMapTiles without bathymetry', () => {
  const data = vectorTiles({
    attribution: 'Generic OpenMapTiles fixture',
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
  const generic = defineMap({id: 'soundings-generic', version: 1, extends: soundings, data});
  const style = createStyle(generic, {preparedAssets});
  const ids = new Set(style.layers.map(({id}) => id));

  assert.equal(ids.has('streets-bathymetry'), false);
  assert.equal(ids.has('streets-bathymetry-contours'), false);
  assert.equal(ids.has('streets-bathymetry-labels'), false);
  assert.equal(ids.has('streets-water'), true);
  assert.equal(ids.has('streets-water-intermittent'), true);
  assert.equal(ids.has('soundings-water-dots-pattern'), true);
  assert.equal(ids.has('soundings-water-intermittent-dots-pattern'), true);
  assert.equal(ids.has('soundings-pier-outline'), true);
  assert.equal(ids.has('soundings-pier-deck'), true);
  assert.equal(ids.has('soundings-ferry-route-labels'), true);
  assert.deepEqual(validateStyleMin(style as never), []);
});
