import {featureFilter, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {createSemanticDataView} from '../src/cartography/semantic-bindings';
import {
  aeroways,
  buildings,
  labels,
  openMapTiles,
  poi,
  type ResolvedTileflowData,
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
import {assembleTileflowLayers} from './layer-ir-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Bold'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

function styleFor(
  contributions: readonly TileflowLayerContribution[],
  data?: ResolvedTileflowData,
) {
  return {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions, data),
  };
}

/** A compile context that reads `data` through World's names, lowered by `styleFor`. */
function semanticContext(data: ResolvedTileflowData) {
  return {...context, data: createSemanticDataView(data)};
}

test('vegetation emits ordered radius stops when minZoom is 20 or greater', () => {
  for (const minZoom of [20, 21, 24]) {
    const style = styleFor(compileVegetation(vegetation({flat: {minZoom}}), context));
    const trees = style.layers.find((layer) => layer.id === 'tileflow-vegetation-trees');

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
        layer.id.startsWith('tileflow-label-road-') &&
        !layer.id.includes('shield') &&
        !layer.id.includes('junction'),
    ),
    false,
  );
  assert.ok(style.layers.some((layer) => layer.id === 'tileflow-label-road-shield-overview'));
  assert.ok(style.layers.some((layer) => layer.id === 'tileflow-label-road-shield-detail'));
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
  const style = styleFor(
    compileLabels(labels({language: 'en'}), undefined, semanticContext(data)),
    data,
  );
  const place = style.layers.find((layer) => layer.id === 'tileflow-label-place-city');

  assert.match(JSON.stringify(place?.layout), /english_label/);
  assert.doesNotMatch(JSON.stringify(place?.layout), /name:en/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('POI compilation deduplicates canonical categories and honors remapped fields', () => {
  const config = poi({
    categories: ['food-drink', 'food-drink', 'transport'],
    density: 2,
    icons: false,
    labels: true,
    minZoom: 20,
  });
  const style = styleFor(compilePoi(config, context));
  const poiLayers = style.layers.filter((layer) => layer.id.startsWith('tileflow-poi'));
  const transport = poiLayers.find((layer) => layer.id === 'tileflow-poi-label');

  assert.deepEqual(
    poiLayers.map((layer) => layer.id),
    ['tileflow-poi-label'],
  );
  assert.deepEqual((transport?.filter as unknown[])[1], [
    'match',
    ['get', 'class'],
    ['food-drink', 'transport'],
    true,
    false,
  ]);
  assert.equal(new Set(poiLayers.map((layer) => layer.id)).size, poiLayers.length);
  assert.equal(transport?.minzoom, 20);
  assert.match(JSON.stringify(transport?.filter), /"filterrank"/);
  assert.match(JSON.stringify(transport?.filter), /"sizerank"/);
  assert.match(JSON.stringify(transport?.filter), /to-number/);
  assert.deepEqual(validateStyleMin(style), []);

  // OpenMapTiles' names and rank, by the properties the data binds them to.
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          name: 'local_label',
          nameEnglish: 'english_label',
          nameLatin: 'latin_label',
          rank: 'poi_rank',
        },
      }),
      url: '/tiles.json',
    }),
  );
  const remapped = styleFor(compilePoi(config, semanticContext(data)), data);
  const remappedLayer = remapped.layers.find((layer) => layer.id === 'tileflow-poi-label');
  const serialized = JSON.stringify(remapped.layers);

  assert.equal(remappedLayer?.['source-layer'], 'poi');
  assert.match(JSON.stringify(remappedLayer?.filter), /poi_rank/);
  assert.match(serialized, /local_label/);
  assert.match(serialized, /english_label/);
  assert.match(serialized, /latin_label/);
  assert.deepEqual(validateStyleMin(remapped), []);
});

test('one-way markers follow visible road detail and line geometry', () => {
  const style = styleFor(compileRoads(roads({detail: 'highways', oneWayMarkers: true}), context));
  const marker = style.layers.find((layer) => layer.id === 'tileflow-road-oneway');
  const filter = JSON.stringify(marker?.filter);

  assert.match(filter, /LineString/);
  assert.match(filter, /motorway/);
  assert.match(filter, /trunk/);
  assert.doesNotMatch(filter, /primary/);

  const noRoads = styleFor(compileRoads(roads({detail: 'none', oneWayMarkers: true}), context));
  assert.equal(
    noRoads.layers.some((layer) => layer.id === 'tileflow-road-oneway'),
    false,
  );
  assert.deepEqual(validateStyleMin(style), []);
});

test('road and aeroway line phases exclude polygon geometries', () => {
  const style = styleFor([
    ...compileAeroways(aeroways(), context),
    ...compileRoads(roads({detail: 'major'}), context),
  ]);
  const road = style.layers.find((layer) => layer.id === 'tileflow-road-surface-primary-fill');
  const runway = style.layers.find((layer) => layer.id === 'tileflow-aeroway-runway-fill');

  assert.match(JSON.stringify(road?.filter), /LineString/);
  assert.match(JSON.stringify(runway?.filter), /LineString/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('grass and scrub compiler filters are mutually exclusive', () => {
  const layers = compileLand(undefined, context);
  const filterOf = (id: string) =>
    featureFilter(layers.find((entry) => entry.layer.id === id)?.layer.filter as never);
  const grass = filterOf('tileflow-landcover-grass');
  const scrub = filterOf('tileflow-landcover-scrub');
  const matches = (filter: typeof grass, properties: object) =>
    filter.filter({zoom: 14}, {type: 3, properties} as never);

  for (const properties of [{class: 'grass'}, {class: 'golf'}]) {
    assert.equal(matches(grass, properties), true, JSON.stringify(properties));
    assert.equal(matches(scrub, properties), false, JSON.stringify(properties));
  }
  for (const properties of [{class: 'scrub'}, {class: 'scrub', type: 'heath'}]) {
    assert.equal(matches(scrub, properties), true, JSON.stringify(properties));
    assert.equal(matches(grass, properties), false, JSON.stringify(properties));
  }
});

test('administrative, disputed, and maritime boundary filters are disjoint', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {maritime: 'sea_boundary'}}),
      url: '/tiles.json',
    }),
  );
  const style = styleFor(compileBoundaries(undefined, semanticContext(data)), data);
  const admin2 = style.layers.find((layer) => layer.id === 'tileflow-boundary-admin2');
  const disputed = style.layers.find((layer) => layer.id === 'tileflow-boundary-disputed');
  const maritime = style.layers.find((layer) => layer.id === 'tileflow-boundary-maritime');

  assert.match(JSON.stringify(admin2?.filter), /disputed/);
  assert.match(JSON.stringify(admin2?.filter), /sea_boundary/);
  assert.match(JSON.stringify(admin2?.filter), /"!"/);
  assert.match(JSON.stringify(disputed?.filter), /sea_boundary/);
  assert.match(JSON.stringify(maritime?.filter), /sea_boundary/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('3d buildings use a conservative height and clamp their base to the height', () => {
  const style = styleFor(compileBuildings(buildings({mode: '3d'}), context));
  const layer = style.layers.find(
    (candidate) => candidate.id === 'tileflow-buildings-native-extrusion',
  );
  const serialized = JSON.stringify(layer);

  assert.match(serialized, /fill-extrusion-height/);
  assert.match(serialized, /fill-extrusion-base/);
  assert.match(serialized, /"min"/);
  assert.match(serialized, /,5/);
  assert.match(serialized, /\["get","height"\]/);
  assert.match(serialized, /\["get","min_height"\]/);
  assert.doesNotMatch(serialized, /render_height/);
  assert.doesNotMatch(serialized, /,18/);
  assert.match(serialized, /"extrude"/);
  assert.deepEqual(validateStyleMin(style), []);
});

test('optional source-layer capabilities do not emit permanently missing layers', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      // OpenMapTiles has neither World's global landcover nor its trees.
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const layers = [
    ...compileLand(undefined, {...context, data}),
    ...compileVegetation(vegetation(), {...context, data}),
  ];

  assert.equal(
    layers.some(({layer}) => layer.id === 'tileflow-global-landcover'),
    false,
  );
  assert.equal(
    layers.some(({layer}) => layer.id === 'tileflow-vegetation-trees'),
    false,
  );
});
