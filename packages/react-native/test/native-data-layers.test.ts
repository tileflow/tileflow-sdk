import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import type {ReactElement} from 'react';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {clusterOverlay, geojsonSource, heatmapOverlay} from '@tileflow/core/native';
import {planNativeDataLayers} from '../src/native-data-layers-plan';

const data = {features: [], type: 'FeatureCollection'} as const;
const style = {
  layers: [
    {id: 'background', type: 'background'},
    {id: 'labels', layout: {'text-font': ['Noto Sans Regular']}, source: 'places', type: 'symbol'},
  ],
  metadata: {
    'tileflow:overlay-placement-manifest': {
      anchors: {'above-labels': null, 'below-labels': 'labels'},
    },
  },
  sources: {places: {data, type: 'geojson'}, world: {type: 'vector', url: 'https://x.test'}},
};
const stores = clusterOverlay({id: 'stores', placement: 'below-labels', source: 'stores'});

test('plans runtime sources with their overlays, placement and the map label font', () => {
  const plan = planNativeDataLayers({
    dataOverlays: {stores},
    dataSources: {stores: geojsonSource({cluster: true, clusterRadius: 40, data})},
    style,
  });

  assert.deepEqual(plan.diagnostics, []);
  const [source] = plan.sources;
  assert.equal(source?.id, 'stores');
  assert.equal(source?.adopted, false);
  assert.deepEqual(source?.definition, {cluster: true, clusterRadius: 40});
  assert.deepEqual(source?.clusterLayers, ['stores-clusters']);
  assert.deepEqual(source?.pointLayers, ['stores-points']);
  assert.deepEqual(
    source?.layers.map(({beforeId, id}) => [id, beforeId]),
    [
      ['stores-clusters', 'labels'],
      ['stores-cluster-count', 'labels'],
      ['stores-points', 'labels'],
    ],
  );
  assert.deepEqual((source?.layers[1]?.layout as Record<string, unknown>)['text-font'], [
    'Noto Sans Regular',
  ]);
});

test('fills a compiled source without overriding its options or redrawing compiled layers', () => {
  const plan = planNativeDataLayers({
    dataOverlays: {stores: {...stores, source: 'places'}},
    dataSources: {places: geojsonSource({cluster: true, data})},
    style: {
      ...style,
      layers: [
        ...style.layers,
        {
          id: 'stores-clusters',
          metadata: {'tileflow:cluster': {expandOnClick: false, role: 'cluster'}},
          source: 'places',
          type: 'circle',
        },
      ],
    },
  });

  const [source] = plan.sources;
  assert.equal(source?.adopted, true);
  assert.deepEqual(source?.definition, {});
  assert.equal(source?.expandOnClick, false);
  assert.deepEqual(
    source?.layers.map(({id}) => id),
    ['stores-cluster-count', 'stores-points'],
  );
});

test('adopts a compiled clustering source so a tap can expand it with no runtime props', () => {
  const plan = planNativeDataLayers({
    style: {
      ...style,
      layers: [
        ...style.layers,
        {
          id: 'c',
          metadata: {'tileflow:cluster': {expandOnClick: true, role: 'cluster'}},
          source: 'places',
          type: 'circle',
        },
      ],
    },
  });

  assert.deepEqual(
    plan.sources.map(({adopted, clusterLayers, data: value, id}) => ({
      adopted,
      clusterLayers,
      data: value,
      id,
    })),
    [{adopted: true, clusterLayers: ['c'], data, id: 'places'}],
  );
});

test('draws a heatmap over a vector style source and reports what cannot be drawn', () => {
  const plan = planNativeDataLayers({
    dataOverlays: {
      demand: heatmapOverlay({id: 'demand', placement: 'below-labels', source: 'world'}),
      lost: heatmapOverlay({id: 'lost', placement: 'below-labels', source: 'missing'}),
    },
    dataSources: {world: geojsonSource({data})},
    style,
  });

  assert.deepEqual(plan.sources, []);
  assert.deepEqual(
    plan.layers.map(({id, source}) => [id, source]),
    [['demand', 'world']],
  );
  assert.deepEqual(
    plan.diagnostics.map(({path}) => path),
    ['/dataSources/world', '/dataOverlays/lost/source'],
  );
});

test('a style with no label font skips the count and says why', () => {
  const plan = planNativeDataLayers({
    dataOverlays: {stores},
    dataSources: {stores: geojsonSource({cluster: true, data})},
    style: {layers: [], sources: {}},
  });

  assert.equal(plan.diagnostics.length, 1);
  assert.deepEqual(
    plan.sources[0]?.layers.map(({id}) => id),
    ['stores-clusters', 'stores-points'],
  );
});

test('a cluster button activates once and exposes one accessible element', async () => {
  const source = await readFile(new URL('../src/native-data-layers.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = {
    exports: {} as {
      NativeClusterMarker: (props: Record<string, unknown>) => ReactElement<Record<string, any>>;
    },
  };
  const require = (id: string): unknown => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@maplibre/maplibre-react-native') {
      return {GeoJSONSource: 'GeoJSONSource', Layer: 'Layer', Marker: 'NativeMarker'};
    }
    if (id === 'react-native') return {Pressable: 'NativePressable', Text: 'NativeText'};
    throw new Error(`Unexpected dependency: ${id}`);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);

  let presses = 0;
  let stopped = 0;
  const marker = module.exports.NativeClusterMarker({
    cluster: {clusterId: 7, coordinate: [1, 2], label: '3', pointCount: 3},
    label: '3 places',
    onPress: () => presses++,
  });
  const button = marker.props.children as ReactElement<Record<string, any>>;

  assert.equal(marker.props.accessible, true);
  assert.equal(marker.props.accessibilityRole, 'button');
  assert.equal(marker.props.accessibilityLabel, '3 places');
  assert.equal(button.props.accessible, false);
  button.props.onPress({stopPropagation: () => stopped++});
  assert.deepEqual([presses, stopped], [1, 1]);
  marker.props.onAccessibilityTap();
  assert.equal(presses, 2);
});
