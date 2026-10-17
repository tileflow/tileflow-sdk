import {createExpression, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bathymetry,
  createStyle,
  disable,
  expr,
  field,
  inferTileflowSourceRequirements,
  labels,
  parseTileflowMap,
  water,
} from '../src';
import {extendStreets} from './map-fixture';

function candidate(language = 'local') {
  const options = {
    contours: {maxZoom: 15},
    labels: {maxZoom: 15},
    url: 'http://127.0.0.1:4888/bathymetry/tiles.json',
    vectorLayers: {contours: true, landforms: true, waterNames: true},
  };
  const waterOptions = {
    bathymetry: {maxZoom: 15, opacity: 0.8},
    bathymetryLandforms: {maxZoom: 15},
    bathymetryWaterNames: {maxZoom: 15},
  };

  return extendStreets({
    marine: {bathymetry: bathymetry(options), nautical: false},
    modules: {labels: labels({language}), poi: disable(), water: water(waterOptions)},
  });
}

function evaluate(value: unknown, properties: Record<string, unknown>, zoom = 12, type = 1) {
  const compiled = createExpression(value as never);
  assert.equal(compiled.result, 'success', JSON.stringify(compiled.value));
  if (compiled.result !== 'success') throw new Error('Invalid expression');

  return compiled.value.evaluate({zoom}, {properties, type: type as 1 | 2 | 3});
}

test('declared contours consume depth lines and reject clipped polygon edges', () => {
  const map = candidate();
  assert.deepEqual(parseTileflowMap(map).marine, map.marine);
  const style = createStyle(map);
  const contours = style.layers.find(({id}) => id === 'tileflow-bathymetry-contours')!;
  const labels = style.layers.find(({id}) => id === 'tileflow-bathymetry-labels')!;

  assert.equal(contours['source-layer'], 'bathymetry_contour');
  assert.equal(labels['source-layer'], 'bathymetry_contour');
  assert.equal(contours.maxzoom, 15);
  assert.equal(labels.maxzoom, 15);
  assert.equal(evaluate(contours.filter, {depth: -200}, 12, 2), true);
  assert.equal(evaluate(contours.filter, {depth: -200}, 12, 3), false);
  assert.equal(evaluate(contours.filter, {min_depth: -200}, 12, 3), false);
  assert.equal(evaluate(contours.filter, {depth: 0}, 12, 2), false);
  assert.equal(evaluate(labels.layout?.['text-field'], {depth: -200}, 12, 2), '200');
  assert.equal(labels.layout?.['symbol-placement'], 'line');
  assert.deepEqual(validateStyleMin(style as never), []);

  const requirements = inferTileflowSourceRequirements(style).sources['tileflow-bathymetry']!;
  assert.deepEqual(
    requirements.sourceLayers
      .find(({id}) => id === 'bathymetry_contour')
      ?.fields.map(({name}) => name),
    ['depth'],
  );
});

test('named Bathymetry geometries honor language, nominal zooms and collision placement', () => {
  const style = createStyle(candidate('es'));
  const properties = {
    class: 'basin',
    id: 'gebco:alboran-basin',
    max_zoom: 14,
    min_zoom: 9,
    name: 'Alboran Basin',
    'name:es': 'Cuenca de Alborán',
    sort_key: 2,
  };

  for (const [id, sourceLayer] of [
    ['tileflow-bathymetry-landforms', 'seafloor_landform'],
    ['tileflow-bathymetry-water-names', 'water_name'],
  ]) {
    const layer = style.layers.find((entry) => entry.id === id)!;
    assert.ok(layer, `${id} exists`);
    assert.equal(layer['source-layer'], sourceLayer);
    assert.equal(layer.source, 'tileflow-bathymetry');
    assert.equal(evaluate(layer.layout?.['text-field'], properties), 'Cuenca de Alborán');
    assert.equal(
      evaluate(layer.layout?.['text-field'], {...properties, 'name:es': ''}),
      'Alboran Basin',
    );
    assert.equal(
      evaluate(layer.layout?.['text-field'], {...properties, 'name:es': null}),
      'Alboran Basin',
    );
    assert.equal(evaluate(layer.filter, properties, 8), false);
    assert.equal(evaluate(layer.filter, properties, 9), true);
    assert.equal(evaluate(layer.filter, properties, 13.99), true);
    assert.equal(evaluate(layer.filter, properties, 14), false);
    const fractionalRange = {...properties, min_zoom: 7.6, max_zoom: 10.6};
    assert.equal(evaluate(layer.filter, fractionalRange, 7), false);
    assert.equal(evaluate(layer.filter, fractionalRange, 8), true);
    assert.equal(evaluate(layer.filter, fractionalRange, 10), true);
    assert.equal(evaluate(layer.filter, fractionalRange, 11), false);
    assert.equal(evaluate(layer.filter, {name: 'Name without zoom metadata'}), true);
    assert.equal(evaluate(layer.filter, {...properties, name: '', 'name:es': ''}), false);
    assert.equal(evaluate(layer.filter, properties, 12, 2), true);
    assert.equal(evaluate(layer.filter, properties, 12, 3), true);
    assert.equal(layer.layout?.['text-allow-overlap'], false);
    assert.equal(layer.layout?.['text-ignore-placement'], false);
    assert.equal(evaluate(layer.layout?.['symbol-sort-key'], properties), 2);
  }

  const local = createStyle(candidate());
  assert.equal(
    evaluate(
      local.layers.find(({id}) => id === 'tileflow-bathymetry-landforms')?.layout?.['text-field'],
      properties,
    ),
    'Alboran Basin',
  );
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('optional layers stay explicit and legacy bands retain their geometry and depth field', () => {
  const style = createStyle(
    extendStreets({
      marine: {
        bathymetry: bathymetry({
          contours: {},
          labels: {},
          vectorLayers: {contours: false, landforms: false, waterNames: false},
        }),
        nautical: false,
      },
      modules: {
        poi: disable(),
        water: water({bathymetryLandforms: {}, bathymetryWaterNames: {}}),
      },
    }),
  );
  const contours = style.layers.find(({id}) => id === 'tileflow-bathymetry-contours')!;
  const labels = style.layers.find(({id}) => id === 'tileflow-bathymetry-labels')!;

  assert.equal(contours['source-layer'], 'bathymetry');
  assert.equal(labels['source-layer'], 'bathymetry');
  assert.equal(evaluate(contours.filter, {min_depth: -200}, 9, 3), true);
  assert.equal(evaluate(labels.layout?.['text-field'], {min_depth: -200}, 9, 3), '200');
  assert.equal(contours.maxzoom, 10);
  assert.equal(labels.maxzoom, 10);
  assert.equal(
    style.layers.some(
      (layer) =>
        layer.source === 'tileflow-bathymetry' &&
        ['seafloor_landform', 'water_name'].includes(String(layer['source-layer'])),
    ),
    false,
  );
});

test('declared contour layers retain custom text expressions and never infer a fallback', () => {
  const style = createStyle(
    extendStreets({
      marine: {
        bathymetry: bathymetry({
          contours: {},
          labels: {text: {field: 'Product label'}},
          vectorLayers: {contours: true},
        }),
        nautical: false,
      },
      modules: {
        poi: disable(),
        water: water({bathymetryLabels: {text: {field: 'Module label'}}}),
      },
    }),
  );
  const contour = style.layers.find(({id}) => id === 'tileflow-bathymetry-contours')!;
  const labels = style.layers.find(({id}) => id === 'tileflow-bathymetry-labels')!;

  assert.equal(contour['source-layer'], 'bathymetry_contour');
  assert.equal(labels['source-layer'], 'bathymetry_contour');
  assert.equal(labels.layout?.['text-field'], 'Module label');
  assert.equal(evaluate(contour.filter, {min_depth: -200}, 9, 3), false);

  assert.throws(
    () =>
      parseTileflowMap(
        extendStreets({
          marine: {
            bathymetry: {...bathymetry(), vectorLayers: {contours: 'auto'}},
            nautical: false,
          },
        }) as never,
      ),
    /Invalid input/u,
  );
});

test('public contour-depth expressions validate and bind to the auxiliary depth field', () => {
  const map = extendStreets({
    marine: {
      bathymetry: bathymetry({vectorLayers: {contours: true}}),
      nautical: false,
    },
    modules: {
      poi: disable(),
      water: water({
        bathymetryLabels: {
          text: {
            field: expr.concat(
              expr.toString(expr.abs(expr.toNumber(expr.get(field('bathymetryContourDepth')), 0))),
              ' m',
            ),
          },
        },
      }),
    },
  });

  assert.doesNotThrow(() => parseTileflowMap(map));
  const style = createStyle(map);
  const layer = style.layers.find(({id}) => id === 'tileflow-bathymetry-labels')!;
  assert.equal(evaluate(layer.layout?.['text-field'], {depth: -200}, 12, 2), '200 m');
  assert.equal(layer['source-layer'], 'bathymetry_contour');
  const primary = inferTileflowSourceRequirements(style).sources.tileflow!;
  assert.equal(
    primary.sourceLayers.some(({fields}) => fields.some(({name}) => name === 'depth')),
    false,
  );
});
