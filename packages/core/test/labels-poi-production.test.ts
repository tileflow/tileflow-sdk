import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {labels, openMapTiles, poi, resolveTileflowData, roads, vectorTiles} from '../src/index';
import {compileLabels} from '../src/modules/labels/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
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

function styleFor(contributions: readonly TileflowLayerContribution[]) {
  return {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://example.test/sprite',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions),
  };
}

test('POI labels clear their own icons while preserving normal collision and coupling', () => {
  const uncoupled = compilePoi(
    poi({
      categories: ['food-drink'],
      density: 3,
      icons: true,
      labels: true,
      placement: {coupleIconAndLabel: false},
    }),
    context,
  );
  const icon = uncoupled.find((entry) => entry.layer.id === 'tileflow-poi-food-drink-icon')?.layer;
  const label = uncoupled.find(
    (entry) => entry.layer.id === 'tileflow-poi-food-drink-label',
  )?.layer;
  const iconLayout = icon?.layout as Record<string, unknown>;
  const labelLayout = label?.layout as Record<string, unknown>;

  assert.deepEqual(
    uncoupled.map((entry) => entry.layer.id),
    ['tileflow-poi-food-drink-icon', 'tileflow-poi-food-drink-label'],
  );
  assert.equal(iconLayout['icon-allow-overlap'], undefined);
  assert.equal(iconLayout['icon-ignore-placement'], undefined);
  assert.equal(iconLayout['icon-optional'], true);
  assert.equal(labelLayout['text-allow-overlap'], false);
  assert.equal(labelLayout['text-ignore-placement'], undefined);
  assert.equal(labelLayout['text-radial-offset'], 1.1);
  assert.deepEqual(labelLayout['text-variable-anchor'], ['top', 'bottom', 'right', 'left']);

  const coupled = compilePoi(
    poi({
      categories: ['food-drink'],
      density: 3,
      icons: true,
      labels: true,
      placement: {coupleIconAndLabel: true},
    }),
    context,
  );
  const coupledLayout = coupled[0]?.layer.layout as Record<string, unknown>;

  assert.deepEqual(
    coupled.map((entry) => entry.layer.id),
    ['tileflow-poi-food-drink'],
  );
  assert.ok(coupledLayout['icon-image']);
  assert.ok(coupledLayout['text-field']);
  assert.equal(coupledLayout['icon-optional'], false);
  assert.equal(coupledLayout['text-radial-offset'], 1.1);

  const explicitlyPlaced = compilePoi(
    poi({
      categories: ['food-drink'],
      icons: true,
      labels: true,
      styles: {'food-drink': {text: {offset: [0, 2]}}},
    }),
    context,
  );
  const explicitLabel = explicitlyPlaced.find(
    (entry) => entry.layer.id === 'tileflow-poi-food-drink-label',
  )?.layer.layout as Record<string, unknown>;
  assert.deepEqual(explicitLabel['text-offset'], [0, 2]);
  assert.equal(explicitLabel['text-radial-offset'], undefined);
  assert.equal(explicitLabel['text-variable-anchor'], undefined);

  assert.deepEqual(validateStyleMin(styleFor(uncoupled)), []);
  assert.deepEqual(validateStyleMin(styleFor(coupled)), []);
  assert.deepEqual(validateStyleMin(styleFor(explicitlyPlaced)), []);
});

test('POI and geographic labels share the requested language and bound English fallback', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          name: 'local_label',
          nameEnglish: 'english_label',
          nameLatin: 'latin_label',
        },
      }),
      url: '/tiles.json',
    }),
  );
  const localizedContext = {...context, data};
  const geographic = compileLabels(
    labels({language: 'fr', places: 'major', roads: 'none', shields: 'none', water: 'none'}),
    roads({detail: 'none'}),
    localizedContext,
  );
  const points = compilePoi(
    poi({categories: ['food-drink'], icons: false, labels: true}),
    localizedContext,
    'fr',
  );
  const cityField = (
    geographic.find((entry) => entry.layer.id === 'tileflow-label-place-city')?.layer
      .layout as Record<string, unknown>
  )['text-field'];
  const poiField = (points[0]?.layer.layout as Record<string, unknown>)['text-field'];

  assert.deepEqual(poiField, cityField);
  assert.deepEqual(cityField, [
    'coalesce',
    ['get', 'name:fr'],
    ['get', 'latin_label'],
    ['get', 'local_label'],
  ]);

  const english = compilePoi(
    poi({categories: ['food-drink'], icons: false, labels: true}),
    localizedContext,
    'en',
  );
  const englishField = (english[0]?.layer.layout as Record<string, unknown>)['text-field'];
  assert.match(JSON.stringify(englishField), /english_label/);
  assert.doesNotMatch(JSON.stringify(englishField), /name:en/);
  assert.deepEqual(validateStyleMin(styleFor([...geographic, ...points])), []);
});

test('place labels apply ranked zoom hierarchy, capital priority, and extended source classes', () => {
  const contributions = compileLabels(
    labels({
      junctions: false,
      places: 'all',
      roads: 'none',
      shields: 'none',
      water: 'none',
    }),
    roads({detail: 'none'}),
    context,
  );
  const layer = (id: string) => contributions.find((entry) => entry.layer.id === id)?.layer;
  const city = layer('tileflow-label-place-city');
  const town = layer('tileflow-label-place-town');
  const state = layer('tileflow-label-place-state');
  const neighborhood = layer('tileflow-label-place-neighborhood');
  const other = layer('tileflow-label-place-other');

  assert.equal(city?.minzoom, 2);
  assert.equal(city?.maxzoom, 15);
  assert.equal(town?.minzoom, 7);
  assert.equal(town?.maxzoom, 14);
  assert.match(JSON.stringify(city?.filter), /capital/);
  assert.match(JSON.stringify(city?.filter), /rank/);
  assert.match(JSON.stringify(city?.filter), /zoom/);
  assert.match(JSON.stringify(city?.layout?.['symbol-sort-key']), /capital/);
  assert.match(JSON.stringify(state?.filter), /aboriginal_lands/);
  assert.match(JSON.stringify(neighborhood?.filter), /borough/);
  assert.match(JSON.stringify(other?.filter), /island/);
  assert.match(JSON.stringify(other?.filter), /strait/);
  assert.match(JSON.stringify(other?.filter), /isolated_dwelling/);
  assert.equal(other?.minzoom, 6);
  assert.equal(other?.maxzoom, 16);
  assert.deepEqual(validateStyleMin(styleFor(contributions)), []);
});

test('shields and junctions use geometry-safe filters and localized junction names', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          class: 'kind',
          name: 'local_label',
          nameLatin: 'latin_label',
          ref: 'route_ref',
          shieldKind: 'shield_family',
          shieldLineLengthMeters: 'shield_line_length',
          shieldRank: 'shield_rank',
          shieldText: 'shield_text',
          shieldTextColor: 'shield_ink',
          subclass: 'detail',
        },
        layers: {roadName: 'road_labels', roadShield: 'road_shields'},
      }),
      url: '/tiles.json',
    }),
  );
  const contributions = compileLabels(
    labels({
      junctions: true,
      language: 'es',
      places: 'none',
      roads: 'none',
      shields: 'all',
      water: 'none',
    }),
    roads({detail: 'all'}),
    {...context, data},
  );
  const overview = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-shield-overview',
  )?.layer;
  const detail = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-shield-detail',
  )?.layer;
  const junction = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-junction',
  )?.layer;

  assert.match(JSON.stringify(overview?.filter), /Point/);
  assert.match(JSON.stringify(detail?.filter), /LineString/);
  assert.match(JSON.stringify(overview?.filter), /shield_family/);
  assert.match(JSON.stringify(detail?.layout?.['text-field']), /to-string/);
  assert.match(JSON.stringify(detail?.layout?.['text-field']), /shield_text/);
  assert.match(JSON.stringify(junction?.filter), /Point/);
  assert.match(JSON.stringify(junction?.layout?.['text-field']), /name:es/);
  assert.match(JSON.stringify(junction?.layout?.['text-field']), /latin_label/);
  assert.equal(junction?.minzoom, 13);
  assert.equal(junction?.maxzoom, 18);
  assert.deepEqual(validateStyleMin(styleFor(contributions)), []);
});
