import {createExpression, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bathymetry,
  createStyle,
  defineMap,
  disable,
  labels,
  parseTileflowMap,
  refine,
  refineRenderTarget,
  water,
} from '../src';
import {extendStreets} from './map-fixture';

const geometryPlacement = {point: 'point', line: 'line', polygon: 'point'} as const;

function candidate(placementByGeometry: unknown = geometryPlacement, precise = true) {
  const style = {placement: 'line' as const, ...(placementByGeometry ? {placementByGeometry} : {})};

  return extendStreets({
    marine: {
      bathymetry: bathymetry({
        vectorLayers: {
          landforms: precise ? {zoomRanges: [{minZoom: 0, maxZoom: 24}]} : true,
          waterNames: precise ? {zoomRanges: [{minZoom: 7.6, maxZoom: 10}]} : true,
        },
      }),
      nautical: false,
    },
    modules: {
      poi: disable(),
      labels: labels({language: 'es'}),
      water: water({bathymetryLandforms: style as never, bathymetryWaterNames: style as never}),
    },
  });
}

function selected(layer: Record<string, unknown>, type: 1 | 2 | 3, zoom: number) {
  const result = createExpression(layer.filter as never);
  assert.equal(result.result, 'success');
  if (result.result !== 'success') throw new Error('Invalid filter');

  return (
    zoom >= Number(layer.minzoom ?? 0) &&
    zoom < Number(layer.maxzoom ?? 24) &&
    result.value.evaluate(
      {zoom},
      {type, properties: {name: 'Shared name', min_zoom: 7.6, max_zoom: 10}},
    )
  );
}

test('explicit geometry placement preserves point names and line placement in disjoint groups', () => {
  const map = candidate();
  assert.doesNotThrow(() => parseTileflowMap(map));
  const style = createStyle(map);
  const layers = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  assert.equal(layers.length, 2);

  for (const [type, placement] of [
    [1, 'point'],
    [2, 'line'],
    [3, 'point'],
  ] as const) {
    const matches = layers.filter((layer) => selected(layer, type, 7.6));
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.layout?.['symbol-placement'], placement);
    assert.equal(matches[0]?.layout?.['text-allow-overlap'], false);
    assert.equal(matches[0]?.layout?.['text-ignore-placement'], false);
    assert.equal(layers.filter((layer) => selected(layer, type, 7.5)).length, 0);
    assert.equal(layers.filter((layer) => selected(layer, type, 10)).length, 0);
  }
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('geometry placement also supports the simple source declaration without changing its range contract', () => {
  const style = createStyle(candidate(geometryPlacement, false));
  const layers = style.layers.filter(
    (layer) =>
      layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'seafloor_landform',
  );
  assert.equal(layers.length, 2);
  assert.equal(layers.filter((layer) => selected(layer, 1, 8)).length, 1);
  assert.equal(layers.filter((layer) => selected(layer, 2, 8)).length, 1);
});

test('legacy placement compiles unchanged without geometry opt-in', () => {
  const style = createStyle(candidate(false));
  const layers = style.layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  assert.equal(layers.length, 1);
  assert.equal(layers[0]?.id, 'tileflow-bathymetry-water-names-cohort-0');
  assert.equal(layers[0]?.layout?.['symbol-placement'], 'line');
});

test('geometry placement requires an exhaustive valid policy and rejects point-to-line placement', () => {
  for (const policy of [
    {},
    {point: 'point', line: 'line'},
    {point: 'line', line: 'line', polygon: 'point'},
    {...geometryPlacement, other: 'point'},
  ])
    assert.throws(() => parseTileflowMap(candidate(policy)));
});

test('module inheritance and exact render refinements compose with placement groups', () => {
  const map = defineMap({
    id: 'geometry-inheritance',
    version: 1,
    extends: candidate(),
    modules: {
      water: refine({bathymetryWaterNames: {text: {size: 13}}}),
    },
  });
  const styled = defineMap({
    id: 'geometry-refinement',
    version: 1,
    extends: map,
    modules: {
      water: refine({
        renderStack: {
          pointNames: refineRenderTarget({
            target: 'water.bathymetryWaterNames.placementPoint.cohort0',
            renderer: 'symbol',
            style: {text: {haloWidth: 2}},
          }),
          lineNames: refineRenderTarget({
            target: 'water.bathymetryWaterNames.placementLine.cohort0',
            renderer: 'symbol',
            style: {text: {haloWidth: 2}},
          }),
        },
      }),
    },
  });
  const layers = createStyle(styled).layers.filter(
    (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
  );
  assert.equal(layers.length, 2);
  assert.equal(new Set(layers.map((layer) => layer.id)).size, 2);
  for (const layer of layers) {
    assert.equal(layer.layout?.['text-size'], 13);
    assert.equal(layer.paint?.['text-halo-width'], 2);
  }
  for (const type of [1, 2, 3] as const)
    assert.equal(layers.filter((layer) => selected(layer, type, 8)).length, 1);
});

test('identical placements share one group and the full three-placement cohort budget has unique IDs', () => {
  const allPoint = createStyle(candidate({point: 'point', line: 'point', polygon: 'point'}));
  assert.equal(
    allPoint.layers.filter(
      (layer) => layer.source === 'tileflow-bathymetry' && layer['source-layer'] === 'water_name',
    ).length,
    1,
  );
  const ranges = Array.from({length: 128}, (_, index) => ({minZoom: index / 10, maxZoom: 24}));
  const policy = {point: 'point', line: 'line', polygon: 'line-center'} as const;
  const style = createStyle(
    extendStreets({
      marine: {
        bathymetry: bathymetry({
          vectorLayers: {landforms: {zoomRanges: ranges}, waterNames: {zoomRanges: ranges}},
        }),
        nautical: false,
      },
      modules: {
        poi: disable(),
        water: water({
          bathymetryLandforms: {placementByGeometry: policy},
          bathymetryWaterNames: {placementByGeometry: policy},
        }),
      },
    }),
  );
  const layers = style.layers.filter(
    (layer) =>
      layer.source === 'tileflow-bathymetry' &&
      ['water_name', 'seafloor_landform'].includes(String(layer['source-layer'])),
  );
  assert.equal(layers.length, 768);
  assert.equal(new Set(layers.map((layer) => layer.id)).size, 768);
  assert.deepEqual(validateStyleMin(style as never), []);
});
