import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {createSemanticDataView} from '../src/cartography/semantic-bindings';
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

function styleFor(
  contributions: readonly TileflowLayerContribution[],
  data?: ReturnType<typeof resolveTileflowData>,
) {
  return {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://example.test/sprite',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions, data),
  };
}

/** Compile against other data as a map does: through World names, lowered by the data's adapter. */
function semanticContext(data: ReturnType<typeof resolveTileflowData>) {
  return {...context, data: createSemanticDataView(data)};
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
  const icon = uncoupled.find((entry) => entry.layer.id === 'tileflow-poi-icon')?.layer;
  const label = uncoupled.find((entry) => entry.layer.id === 'tileflow-poi-label')?.layer;
  const iconLayout = icon?.layout as Record<string, unknown>;
  const labelLayout = label?.layout as Record<string, unknown>;

  assert.deepEqual(
    uncoupled.map((entry) => entry.layer.id),
    ['tileflow-poi-icon', 'tileflow-poi-label'],
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
    ['tileflow-poi'],
  );
  assert.ok(coupledLayout['icon-image']);
  assert.ok(coupledLayout['text-field']);
  // A coupled POI is its pictogram and its name: neither is placed without the other.
  assert.equal(coupledLayout['icon-optional'], false);
  assert.equal(coupledLayout['text-optional'], false);
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
  const explicitLabel = explicitlyPlaced.find((entry) => entry.layer.id === 'tileflow-poi')?.layer
    .layout as Record<string, unknown>;
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
  const localizedContext = semanticContext(data);
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
  const textField = (contributions: readonly TileflowLayerContribution[], id: string): unknown => {
    const layer = assembleTileflowLayers(contributions, data).find((entry) => entry.id === id);
    return (layer?.layout as Record<string, unknown> | undefined)?.['text-field'];
  };
  const cityField = textField(geographic, 'tileflow-label-place-city');
  const poiField = textField(points, 'tileflow-poi-label');

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
  const englishField = textField(english, 'tileflow-poi-label');
  assert.match(JSON.stringify(englishField), /english_label/);
  assert.doesNotMatch(JSON.stringify(englishField), /name:en/);
  assert.deepEqual(validateStyleMin(styleFor([...geographic, ...points], data)), []);
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
  // World's territories include OpenMapTiles' aboriginal lands; straits are natural labels.
  assert.match(JSON.stringify(state?.filter), /territory/);
  assert.match(JSON.stringify(neighborhood?.filter), /borough/);
  assert.match(JSON.stringify(other?.filter), /island/);
  assert.match(JSON.stringify(other?.filter), /isolated_dwelling/);
  assert.equal(other?.minzoom, 6);
  assert.equal(other?.maxzoom, 16);
  const water = compileLabels(
    labels({junctions: false, places: 'none', roads: 'none', shields: 'none', water: 'major'}),
    roads({detail: 'none'}),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-label-water-other')?.layer;
  assert.match(JSON.stringify(water?.filter), /strait/);
  assert.deepEqual(validateStyleMin(styleFor(contributions)), []);
});

test('shields and junctions use geometry-safe filters and localized junction names', () => {
  const request = labels({
    junctions: true,
    language: 'es',
    places: 'none',
    roads: 'none',
    shields: 'all',
    water: 'none',
  });
  const contributions = compileLabels(request, roads({detail: 'all'}), context);
  const layers = assembleTileflowLayers(contributions);
  const layer = (id: string) => layers.find((entry) => entry.id === id);
  const overview = layer('tileflow-label-road-shield-overview');
  const detail = layer('tileflow-label-road-shield-detail');
  const junction = layer('tileflow-label-road-junction');

  assert.equal(overview?.['source-layer'], 'road_shield');
  assert.equal(detail?.['source-layer'], 'road_label');
  assert.match(JSON.stringify(overview?.filter), /Point/);
  assert.match(JSON.stringify(detail?.filter), /LineString/);
  assert.match(JSON.stringify(overview?.filter), /shield_kind/);
  assert.match(JSON.stringify(detail?.layout?.['text-field']), /to-string/);
  assert.match(JSON.stringify(detail?.layout?.['text-field']), /shield_text/);
  assert.match(JSON.stringify(junction?.filter), /Point/);
  assert.match(JSON.stringify(junction?.layout?.['text-field']), /name_es/);
  assert.match(JSON.stringify(junction?.layout?.['text-field']), /name_latin/);
  assert.equal(junction?.minzoom, 13);
  assert.equal(junction?.maxzoom, 18);
  assert.deepEqual(validateStyleMin(styleFor(contributions)), []);

  // OpenMapTiles names junctions in its own fields and has no shield layer: shields follow lines.
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          class: 'kind',
          name: 'local_label',
          nameLatin: 'latin_label',
          ref: 'route_ref',
          subclass: 'detail',
        },
        layers: {roadName: 'road_labels'},
      }),
      url: '/tiles.json',
    }),
  );
  const remapped = compileLabels(request, roads({detail: 'all'}), semanticContext(data));
  const remappedLayers = assembleTileflowLayers(remapped, data);
  const remappedLayer = (id: string) => remappedLayers.find((entry) => entry.id === id);
  const remappedDetail = remappedLayer('tileflow-label-road-shield-detail');
  const remappedJunction = remappedLayer('tileflow-label-road-junction');

  assert.equal(remappedLayer('tileflow-label-road-shield-overview'), undefined);
  assert.equal(remappedDetail?.['source-layer'], 'road_labels');
  assert.match(JSON.stringify(remappedDetail?.filter), /LineString/);
  assert.deepEqual(remappedDetail?.layout?.['text-field'], ['to-string', ['get', 'route_ref']]);
  assert.equal(remappedJunction?.['source-layer'], 'road_labels');
  assert.match(JSON.stringify(remappedJunction?.filter), /Point/);
  assert.match(JSON.stringify(remappedJunction?.filter), /"detail"/);
  assert.match(JSON.stringify(remappedJunction?.layout?.['text-field']), /name:es/);
  assert.match(JSON.stringify(remappedJunction?.layout?.['text-field']), /latin_label/);
  assert.match(JSON.stringify(remappedJunction?.layout?.['text-field']), /route_ref/);
  assert.deepEqual(validateStyleMin(styleFor(remapped, data)), []);
});
