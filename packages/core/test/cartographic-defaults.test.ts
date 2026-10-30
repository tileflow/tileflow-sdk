import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addresses,
  buildings,
  createStyle,
  createStyleResult,
  defineMap,
  disable,
  labels,
  land,
  openMapTiles,
  parseTileflowMap,
  poi,
  refine,
  refineRenderTarget,
  reset,
  resolveTileflowData,
  roads,
  tileflowWorldV1Schema,
  vectorTiles,
  withRenderStack,
} from '../src';
import {compileRenderStack} from '../src/cartography/render-stack';
import {compileAddresses} from '../src/modules/addresses/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {resolveLabels} from '../src/modules/labels';
import {compileLabels} from '../src/modules/labels/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
import {resolveColors} from '../src/themes';
import {applyCompiledRenderStacks, assembleTileflowLayers} from './layer-ir-fixture';
import {extendStreets} from './map-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Regular'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

function indexOf(layers: readonly {id: string}[], id: string) {
  const index = layers.findIndex((layer) => layer.id === id);
  assert.notEqual(index, -1, `Expected ${id}`);
  return index;
}

test('explicit ground details cover parks while parking and recreation stay visible', () => {
  for (const schema of [openMapTiles(), tileflowWorldV1Schema()]) {
    const data = resolveTileflowData(
      vectorTiles({attribution: 'Test', schema, url: 'https://example.test/tiles.json'}),
    );
    const layers = assembleTileflowLayers(compileLand(undefined, {...context, data}));
    const parks = ['tileflow-landcover-protected', 'tileflow-landcover-urbanPark'];
    if (data.schema.semantics.parkLayer === 'mixed') parks.push('tileflow-landcover-legacy-park');
    for (const detail of ['grass', 'meadow', 'scrub', 'flowerbed']) {
      const detailIndex = indexOf(layers, `tileflow-landcover-${detail}`);
      for (const park of parks) assert.ok(detailIndex > indexOf(layers, park));
      assert.ok(indexOf(layers, 'tileflow-landuse-parking') > detailIndex);
      assert.ok(indexOf(layers, 'tileflow-landuse-recreation') > detailIndex);
    }
  }
});

test('a thematic map can place park tint above mapped details using existing targets', () => {
  const custom = withRenderStack(land(), {
    parkTint: refineRenderTarget({
      target: 'land.landcover.urbanPark.fill',
      placement: 'above-land',
    }),
  });
  const base = assembleTileflowLayers(compileLand(custom, context));
  const layers = applyCompiledRenderStacks(base, compileRenderStack(custom, context.data));
  assert.ok(
    indexOf(layers, 'tileflow-landcover-urbanPark') > indexOf(layers, 'tileflow-landuse-parking'),
  );
  assert.ok(
    indexOf(layers, 'tileflow-landcover-urbanPark') >
      indexOf(layers, 'tileflow-landuse-recreation'),
  );
  assert.equal(compileLand({...land(), enabled: false}, context).length, 0);
  const withoutGrass = compileLand(land({landcover: {grass: {fill: {visible: false}}}}), context);
  assert.ok(!withoutGrass.some(({target}) => target === 'land.landcover.grass.fill'));
});

test('road placement keeps foreground behavior by default and moves only street names', () => {
  assert.equal(resolveLabels(labels()).roadPlacement, 'foreground');
  assert.equal(resolveLabels(labels()).roads, 'streets');
  for (const roadPlacement of ['foreground', 'ground'] as const) {
    const names = compileLabels(
      labels({roadPlacement, collisionPriority: 'navigation'}),
      roads(),
      context,
    );
    const layers = assembleTileflowLayers([
      ...names,
      ...compileBuildings(buildings({mode: '3d'}), context),
      ...compilePoi(poi({categories: ['food-drink'], icons: false}), context),
    ]);
    const street = indexOf(layers, 'tileflow-label-road-primary');
    const building = indexOf(layers, 'tileflow-buildings-3d');
    const destination = indexOf(layers, 'tileflow-poi-label');
    assert.equal(street < building, roadPlacement === 'ground');
    assert.equal(street < destination, roadPlacement === 'ground');
    assert.ok(indexOf(layers, 'tileflow-label-road-shield-detail') > building);
    const layout = layers[street]!.layout as Record<string, unknown>;
    assert.equal(layout['text-pitch-alignment'], roadPlacement === 'ground' ? 'map' : undefined);
    assert.equal(layout['text-allow-overlap'], false);
    assert.deepEqual(
      (layers[street]!.metadata as Record<string, unknown>)?.['tileflow:road-label-placement'],
      roadPlacement === 'ground' ? {version: 1, mode: 'ground'} : undefined,
    );
    assert.deepEqual(
      validateStyleMin({
        version: 8,
        glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
        sources: {tileflow: {type: 'vector', url: 'https://example.test/tiles.json'}},
        layers,
      }),
      [],
    );
  }
});

test('flat building footprints cannot clip ground street names', () => {
  const layers = assembleTileflowLayers([
    ...compileLabels(labels({roadPlacement: 'ground'}), roads(), context),
    ...compileBuildings(buildings({mode: '2d'}), context),
  ]);
  const street = indexOf(layers, 'tileflow-label-road-primary');
  assert.ok(street > indexOf(layers, 'tileflow-buildings-fill'));
  assert.ok(street > indexOf(layers, 'tileflow-buildings-fill-outline'));
});

test('ground names retain language, class hierarchy, filters, and authored text overrides', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: 'Test',
      schema: openMapTiles({fields: {name: 'local', nameEnglish: 'english', nameLatin: 'latin'}}),
      url: 'https://example.test/tiles.json',
    }),
  );
  const roadConfig = roads({detail: 'all', extras: {paths: true}});
  for (const collisionPriority of ['balanced', 'navigation'] as const) {
    const options = {
      language: 'en',
      roads: 'all',
      collisionPriority,
      styles: {roads: {primary: {text: {pitchAlignment: 'viewport', size: 19}}}},
    } as const;
    const foreground = compileLabels(labels(options), roadConfig, {...context, data});
    const ground = compileLabels(labels({...options, roadPlacement: 'ground'}), roadConfig, {
      ...context,
      data,
    });
    assert.deepEqual(
      ground.map(({target}) => target),
      foreground.map(({target}) => target),
    );
    for (const entry of ground.filter(({target}) => target.startsWith('labels.roads.'))) {
      const original = foreground.find(({target}) => target === entry.target)!;
      assert.deepEqual(entry.layer.filter, original.layer.filter);
      const layout = entry.layer.layout as Record<string, unknown>;
      assert.deepEqual(layout['text-field'], [
        'coalesce',
        ['get', 'english'],
        ['get', 'latin'],
        ['get', 'local'],
      ]);
      if (entry.target === 'labels.roads.primary') {
        assert.equal(layout['text-pitch-alignment'], 'viewport');
        assert.equal(layout['text-size'], 19);
      }
    }
  }
});

test('explicit render refinements override ground placement and the public schema accepts it', () => {
  const configured = withRenderStack(labels({roadPlacement: 'ground'}), {
    primaryForeground: refineRenderTarget({
      target: 'labels.roads.primary',
      placement: 'above-labels',
    }),
  });
  const base = assembleTileflowLayers([
    ...compileLabels(configured, roads(), context),
    ...compileBuildings(buildings(), context),
  ]);
  const moved = applyCompiledRenderStacks(base, compileRenderStack(configured, context.data));
  assert.ok(
    indexOf(moved, 'tileflow-label-road-primary') > indexOf(moved, 'tileflow-buildings-fill'),
  );
  assert.equal(
    (moved[indexOf(moved, 'tileflow-label-road-primary')]!.metadata as Record<string, unknown>)?.[
      'tileflow:road-label-placement'
    ],
    undefined,
    'explicit placement must not be overridden by the browser controller',
  );
  const map = extendStreets({modules: {labels: labels({roadPlacement: 'ground'}), poi: disable()}});
  assert.equal(parseTileflowMap(map).modules.labels?.roadPlacement, 'ground');
  assert.ok(createStyle(map).layers.length > 0);
  for (const replacement of [
    labels(),
    refine({roadPlacement: 'foreground' as const}),
    refine({roadPlacement: reset()}),
  ]) {
    const variant = parseTileflowMap(
      defineMap({
        id: 'foreground-variant',
        version: 1,
        extends: map,
        modules: {labels: replacement},
      }),
    );
    assert.equal(resolveLabels(variant.modules.labels).roadPlacement, 'foreground');
  }
  const withoutBuildings = defineMap({
    id: 'ground-without-buildings',
    version: 1,
    extends: map,
    modules: {buildings: disable()},
  });
  assert.ok(createStyle(withoutBuildings).layers.length > 0);
  assert.throws(() =>
    parseTileflowMap(
      extendStreets({
        modules: {
          labels: {type: 'labels', roadPlacement: 'rooftop'} as never,
        },
      }),
    ),
  );
});

test('balanced labels retain orientation and street detail before house numbers', () => {
  for (const collisionPriority of ['balanced', 'navigation'] as const) {
    const compiled = assembleTileflowLayers([
      ...compileLabels(labels({roads: 'all', collisionPriority}), roads({detail: 'all'}), context),
      ...compilePoi(poi({categories: ['food-drink']}), context),
      ...compileAddresses(undefined, context),
    ]);
    const at = (id: string) => indexOf(compiled, id);
    const destination = at('tileflow-poi');
    assert.ok(at('tileflow-label-place-city') > destination);
    assert.ok(at('tileflow-label-road-shield-detail') > destination);
    assert.ok(at('tileflow-label-road-primary') > destination);
    for (const roadClass of ['secondary', 'tertiary']) {
      const road = at(`tileflow-label-road-${roadClass}`);
      assert.ok(road > destination);
      assert.equal(compiled[road]!.minzoom, 13, 'priority must retain zoom eligibility');
    }
    assert.equal(at('tileflow-label-road-minor') > destination, collisionPriority === 'navigation');
    assert.ok(at('tileflow-label-road-minor') > at('tileflow-addresses-labels'));
    assert.ok(destination > at('tileflow-addresses-labels'));
  }
});

test('default POIs place icon and name together, with an explicit independent alternative', () => {
  const combined = compilePoi(poi({categories: ['food-drink']}), context);
  assert.equal(combined.length, 1);
  const layout = combined[0]!.layer.layout as Record<string, unknown>;
  assert.equal(layout['icon-optional'], false);
  assert.equal(layout['text-optional'], false);
  assert.equal(layout['text-padding'], 3);
  assert.deepEqual(layout['text-variable-anchor'], ['top', 'bottom', 'right', 'left']);
  const independent = compilePoi(
    poi({categories: ['food-drink'], placement: {coupleIconAndLabel: false}}),
    context,
  );
  assert.equal(independent.length, 2);
  assert.ok(independent.some(({layer}) => layer.layout?.['text-field'] === undefined));
  assert.ok(independent.some(({layer}) => layer.layout?.['icon-image'] === undefined));
});

test('physical planning retains the default hierarchy across merged road classes', () => {
  const result = createStyleResult(
    extendStreets({
      modules: {
        labels: labels({roads: 'all'}),
        roads: roads({detail: 'all'}),
        poi: poi({categories: ['food-drink']}),
        addresses: addresses(),
      },
    }),
    {inspection: true, preparedAssets: {icons: {ids: ['food'], sprite: '/tileflow/test/sprite'}}},
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  const at = (target: string) => {
    const layer = result.report.provenance!.layers.find(({contributions}) =>
      contributions.some((entry) => entry.target === target),
    );
    assert.ok(layer, target);
    return indexOf(result.style.layers, layer.id);
  };
  assert.ok(at('labels.places.city') > at('poi'));
  assert.ok(at('labels.roads.primary') > at('poi'));
  assert.ok(at('poi') > at('labels.roads.minor'));
  assert.ok(at('labels.roads.minor') > at('addresses.labels'));
});
