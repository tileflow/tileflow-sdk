import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {assembleTileflowLayers} from '../src/cartography/graph';
import {
  aeroways,
  buildings,
  labels,
  openMapTiles,
  poi,
  resolveTileflowData,
  roads,
  vectorTiles,
  vegetation,
} from '../src/index';
import {compileAeroways} from '../src/modules/aeroways/compiler';
import {compileBoundaries} from '../src/modules/boundaries/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {compileLabels} from '../src/modules/labels/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
import {compileRoads} from '../src/modules/roads/compiler';
import {compileVegetation} from '../src/modules/vegetation/compiler';
import {resolveColors} from '../src/themes';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  typography: {
    font: 'Noto Sans',
    fontFamily: 'Noto Sans',
    weight: 'regular' as const,
    places: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'bold' as const},
    roads: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    water: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    poi: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
  },
};

function styleFor(contributions: readonly TileflowLayerContribution[]) {
  return {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions),
  };
}

test('vegetation emits ordered radius stops when minZoom is 20 or greater', () => {
  for (const minZoom of [20, 21, 24]) {
    const style = styleFor(compileVegetation(vegetation({minZoom}), context));
    const trees = style.layers.find((layer) => layer.id === 'streets-vegetation-trees');

    assert.equal(trees?.minzoom, minZoom);
    assert.deepEqual(validateStyleMin(style), []);
  }
});

test('route shields remain available when road-name labels are disabled', () => {
  const roadConfig = roads({detail: 'major'});
  const style = styleFor(
    compileLabels(labels({roads: 'none', shields: 'major'}), roadConfig, context),
  );

  assert.equal(
    style.layers.some(
      (layer) =>
        layer.id.startsWith('streets-label-road-') &&
        !layer.id.includes('shield') &&
        !layer.id.includes('junction'),
    ),
    false,
  );
  assert.ok(style.layers.some((layer) => layer.id === 'streets-label-road-shield'));
  assert.deepEqual(validateStyleMin(style), []);
});

test('English labels honor the remapped nameEnglish binding', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {nameEnglish: 'english_label'}}),
      url: '/tiles.json',
    }),
  );
  const style = styleFor(compileLabels(labels({language: 'en'}), undefined, {...context, data}));
  const place = style.layers.find((layer) => layer.id === 'streets-label-place-city');

  assert.match(JSON.stringify(place?.layout), /english_label/);
  assert.doesNotMatch(JSON.stringify(place?.layout), /name:en/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('POI compilation deduplicates categories, resolves overlaps, and supports high minZoom', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          class: 'kind',
          name: 'local_label',
          nameEnglish: 'english_label',
          nameLatin: 'latin_label',
          rank: 'importance',
          subclass: 'detail',
        },
      }),
      url: '/tiles.json',
    }),
  );
  const style = styleFor(
    compilePoi(
      poi({
        categories: ['alpha', 'alpha', 'beta'],
        classMapping: {alpha: ['shared', 'alpha'], beta: ['shared', 'beta']},
        density: 'sparse',
        icons: false,
        labels: 'full',
        minZoom: 20,
        preset: 'full',
      }),
      {...context, data},
    ),
  );
  const poiLayers = style.layers.filter((layer) => layer.id.startsWith('streets-poi-'));
  const beta = poiLayers.find((layer) => layer.id === 'streets-poi-beta-label');
  const serialized = JSON.stringify(poiLayers);

  assert.deepEqual(
    poiLayers.map((layer) => layer.id),
    ['streets-poi-alpha-label', 'streets-poi-beta-label'],
  );
  assert.equal(new Set(poiLayers.map((layer) => layer.id)).size, poiLayers.length);
  assert.equal(beta?.minzoom, 20);
  assert.match(JSON.stringify(beta?.filter), /shared/);
  assert.match(JSON.stringify(beta?.filter), /importance/);
  assert.match(JSON.stringify(beta?.filter), /to-number/);
  assert.match(serialized, /local_label/);
  assert.match(serialized, /english_label/);
  assert.match(serialized, /latin_label/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('one-way markers follow visible road detail and line geometry', () => {
  const style = styleFor(compileRoads(roads({detail: 'highways', oneWayMarkers: true}), context));
  const marker = style.layers.find((layer) => layer.id === 'streets-road-oneway');
  const filter = JSON.stringify(marker?.filter);

  assert.match(filter, /LineString/);
  assert.match(filter, /motorway/);
  assert.match(filter, /trunk/);
  assert.doesNotMatch(filter, /primary/);

  const noRoads = styleFor(compileRoads(roads({detail: 'none', oneWayMarkers: true}), context));
  assert.equal(
    noRoads.layers.some((layer) => layer.id === 'streets-road-oneway'),
    false,
  );
  assert.deepEqual(validateStyleMin(style), []);
});

test('road and aeroway line phases exclude polygon geometries', () => {
  const style = styleFor([
    ...compileAeroways(aeroways(), context),
    ...compileRoads(roads({detail: 'major'}), context),
  ]);
  const road = style.layers.find((layer) => layer.id === 'streets-road-surface-primary-fill');
  const runway = style.layers.find((layer) => layer.id === 'streets-aeroway-runway-fill');

  assert.match(JSON.stringify(road?.filter), /LineString/);
  assert.match(JSON.stringify(runway?.filter), /LineString/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('grass and scrub compiler filters are mutually exclusive', () => {
  const layers = compileLand(undefined, context);
  const grass = layers.find((entry) => entry.layer.id === 'streets-landcover-grass');
  const scrub = layers.find((entry) => entry.layer.id === 'streets-landcover-scrub');

  assert.match(JSON.stringify(grass?.layer.filter), /scrub/);
  assert.match(JSON.stringify(grass?.layer.filter), /"!"/);
  assert.match(JSON.stringify(scrub?.layer.filter), /scrub/);
  assert.doesNotMatch(JSON.stringify(scrub?.layer.filter), /"!"/);
});

test('administrative, disputed, and maritime boundary filters are disjoint', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {maritime: 'sea_boundary'}}),
      url: '/tiles.json',
    }),
  );
  const style = styleFor(compileBoundaries(undefined, {...context, data}));
  const admin2 = style.layers.find((layer) => layer.id === 'streets-boundary-admin2');
  const disputed = style.layers.find((layer) => layer.id === 'streets-boundary-disputed');
  const maritime = style.layers.find((layer) => layer.id === 'streets-boundary-maritime');

  assert.match(JSON.stringify(admin2?.filter), /disputed/);
  assert.match(JSON.stringify(admin2?.filter), /sea_boundary/);
  assert.match(JSON.stringify(admin2?.filter), /"!"/);
  assert.match(JSON.stringify(disputed?.filter), /sea_boundary/);
  assert.match(JSON.stringify(maritime?.filter), /sea_boundary/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('3d buildings use a conservative height and clamp their base to the height', () => {
  const style = styleFor(compileBuildings(buildings({mode: '3d'}), context));
  const layer = style.layers.find((candidate) => candidate.id === 'streets-buildings-3d');
  const serialized = JSON.stringify(layer);

  assert.match(serialized, /fill-extrusion-height/);
  assert.match(serialized, /fill-extrusion-base/);
  assert.match(serialized, /"min"/);
  assert.match(serialized, /,5/);
  assert.doesNotMatch(serialized, /\["get","height"\]/);
  assert.doesNotMatch(serialized, /\["get","min_height"\]/);
  assert.doesNotMatch(serialized, /,18/);
  assert.match(serialized, /"hide_3d"/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('optional source-layer capabilities do not emit permanently missing layers', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({capabilities: {globalLandcover: false, tree: false}}),
      url: '/tiles.json',
    }),
  );
  const layers = [
    ...compileLand(undefined, {...context, data}),
    ...compileVegetation(vegetation(), {...context, data}),
  ];

  assert.equal(
    layers.some(({layer}) => layer.id === 'streets-global-landcover'),
    false,
  );
  assert.equal(
    layers.some(({layer}) => layer.id === 'streets-vegetation-trees'),
    false,
  );
});
