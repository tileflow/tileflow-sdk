import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDiagnostics,
  type DiagnosticLabelSample,
  type DiagnosticsOptions,
  sampleDiagnosticLabels,
} from '../src/inspector/diagnostics/checks';
import {diagnosticFingerprint} from '../src/inspector/diagnostics/model';

const style = (layers: unknown[] = []): StyleSpecification =>
  ({
    version: 8,
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
    sources: {map: {type: 'vector', url: 'https://example.com/tiles.json'}},
    layers,
  }) as StyleSpecification;
const line = (id: string, width = 2) => ({
  id,
  type: 'line',
  source: 'map',
  'source-layer': 'roads',
  paint: {'line-width': width, 'line-color': '#123456'},
});
const symbol = (id: string, icon: unknown = 'hospital') => ({
  id,
  type: 'symbol',
  source: 'map',
  'source-layer': 'poi',
  layout: {'icon-image': icon},
});
const collect = (layers: unknown[], options: Partial<DiagnosticsOptions> = {}) =>
  collectDiagnostics({style: style(layers), zoom: 14, styleReady: true, ...options});

test('transitional styles do not report broken references during replacement', () => {
  assert.deepEqual(collect([{...line('roads'), source: 'missing'}], {styleReady: false}), []);
});

test('valid custom runtime layers, observer flags and internal overlays are excluded', () => {
  const configured = {
    ...style([
      line('roads'),
      {id: 'trees', type: 'custom', renderingMode: '3d'},
      {id: '__tileflow-inspector-outline', type: 'invalid'},
    ]),
    collectResourceTiming: true,
    sources: {
      map: {type: 'vector', url: 'https://example.com/tiles.json', collectResourceTiming: true},
    },
  } as unknown as StyleSpecification;
  assert.deepEqual(collect([], {style: configured}), []);
});

test('real invalid style properties include their exact rule target', () => {
  const findings = collect([{...line('roads'), paint: {'line-width': 'wide'}}]);
  const finding = findings.find((entry) => entry.check === 'invalid-style-rule');
  assert.equal(finding?.kind, 'problem');
  assert.deepEqual(finding?.target, {layer: 'roads', section: 'paint', property: 'line-width'});
  assert.match(finding?.summary ?? '', /number expected/);
});

test('missing source and empty zoom interval are concrete configuration problems', () => {
  const findings = collect([{...line('roads'), source: 'absent', minzoom: 10, maxzoom: 10}]);
  assert.equal(findings.filter((entry) => entry.check === 'broken-style-reference').length, 1);
  assert.equal(findings.filter((entry) => entry.check === 'empty-zoom-range').length, 1);
  assert.ok(findings.every((entry) => entry.kind === 'problem'));
});

test('valid empty map, filters and deliberately different casing rules do not produce warnings', () => {
  assert.deepEqual(collect([]), []);
  assert.deepEqual(
    collect([
      {...line('casing', 5), filter: ['==', ['get', 'kind'], 'minor']},
      {...line('fill', 2), filter: ['==', ['get', 'kind'], 'minor']},
    ]),
    [],
  );
});

test('missing icon waits for a settled observed request and image registration', () => {
  const layers = [symbol('poi')];
  assert.deepEqual(collect(layers, {availableImages: []}), []);
  assert.deepEqual(
    collect(layers, {availableImages: [], missingImages: [{id: 'hospital', settled: false}]}),
    [],
  );
  assert.deepEqual(
    collect(layers, {
      availableImages: ['hospital'],
      missingImages: [{id: 'hospital', settled: true}],
    }),
    [],
  );
  const findings = collect(layers, {
    availableImages: [],
    missingImages: [{id: 'hospital', settled: true}],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'missing-icon');
  assert.deepEqual(findings[0].target, {layer: 'poi', section: 'layout', property: 'icon-image'});
});

test('optional image fallback candidates, inactive layers and stale IDs are not missing-icon problems', () => {
  const options = {availableImages: ['fallback'], missingImages: [{id: 'hospital', settled: true}]};
  for (const layer of [
    symbol('poi', ['coalesce', ['image', 'hospital'], ['image', 'fallback']]),
    {...symbol('poi'), minzoom: 18},
    {...symbol('poi'), layout: {'icon-image': 'hospital', visibility: 'none'}},
    symbol('poi', 'new-icon'),
  ])
    assert.equal(
      collect([layer], options).filter((finding) => finding.check === 'missing-icon').length,
      0,
    );
});

test('one unavailable icon groups repeated requests and required references', () => {
  const findings = collect([symbol('poi'), {...symbol('important'), minzoom: 12}], {
    availableImages: [],
    missingImages: [
      {id: 'hospital', settled: true},
      {id: 'hospital', settled: true},
    ],
  }).filter((finding) => finding.check === 'missing-icon');
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].layers, ['poi', 'important']);
});

test('exact repeated rules are review suggestions, not measured wasted draw calls', () => {
  const second = {
    ...line('duplicate'),
    paint: {'line-color': '#123456', 'line-width': 2},
    metadata: {owner: 'another'},
  };
  const finding = collect([line('original'), second]).find(
    (entry) => entry.check === 'repeated-rendering-rules',
  );
  assert.equal(finding?.kind, 'review');
  assert.deepEqual(finding?.layers, ['original', 'duplicate']);
  assert.match(finding?.limitations.join(' ') ?? '', /does not prove/);
  assert.equal(
    collect([line('original'), {...second, minzoom: 10}]).filter(
      (entry) => entry.check === 'repeated-rendering-rules',
    ).length,
    0,
  );
});

test('large stack reports eligibility and actual provenance without inferred module names', () => {
  const layers = Array.from({length: 500}, (_, i) => line(`layer-${i}`, i + 1));
  const findings = collect(layers, {
    provenance: {
      layers: [{id: 'layer-0', contributions: [{owner: 'authored-module', target: 'surface'}]}],
    },
  });
  const finding = findings.find((entry) => entry.check === 'large-layer-stack');
  assert.equal(finding?.kind, 'review');
  assert.equal(finding?.evidence.find((entry) => entry.label === 'Declared layers')?.value, 500);
  assert.equal(
    finding?.evidence.find((entry) => entry.label === 'Module: authored-module')?.value,
    1,
  );
  assert.equal(
    finding?.evidence.find((entry) => entry.label === 'Module: Unattributed')?.value,
    499,
  );
  assert.equal(collect(layers.map((layer) => ({...layer, minzoom: 18}))).length, 0);
});

test('very large maps disclose the bounded per-rule inspection while counting the whole stack', () => {
  const layers = Array.from({length: 2100}, (_, i) => line(`layer-${i}`, i + 1));
  const finding = collect(layers).find((entry) => entry.check === 'large-layer-stack');
  assert.equal(finding?.evidence.find((entry) => entry.label === 'Declared layers')?.value, 2100);
  assert.match(finding?.limitations.join(' ') ?? '', /first 2000.*all 2100/);
});

test('finding identity survives checks while dismissal fingerprint changes after a relevant edit', () => {
  const first = collect([line('a'), line('b')])[0];
  const again = collect([line('a'), line('b')])[0];
  const changed = collect([line('a', 4), line('b', 4)])[0];
  assert.equal(first.id, again.id);
  assert.equal(first.fingerprint, again.fingerprint);
  assert.equal(first.id, changed.id);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.equal(diagnosticFingerprint({a: 1, b: 2}), diagnosticFingerprint({b: 2, a: 1}));
});

function labelMap(
  overrides: Record<string, unknown> = {},
  features?: MapGeoJSONFeature[],
): MapLibreMap {
  const layer = {...symbol('labels'), layout: {'text-field': ['get', 'name']}};
  const properties: Record<string, unknown> = {
    'text-field': ['get', 'name'],
    'text-color': '#999999',
    'text-halo-color': '#aaaaaa',
    'text-halo-width': 1.5,
    'text-halo-blur': 0,
    'text-opacity': 1,
    'text-size': 12,
    ...overrides,
  };
  const feature = {
    id: 1,
    source: 'map',
    sourceLayer: 'poi',
    properties: {name: 'Station'},
    layer,
    geometry: {type: 'Point', coordinates: [1, 2]},
  };
  return {
    getCenter: () => ({lng: 1, lat: 2}),
    getZoom: () => 14,
    getBearing: () => 0,
    getPitch: () => 0,
    getFeatureState: () => ({}),
    getPaintProperty: (_layer: string, name: string) => properties[name],
    getLayoutProperty: (_layer: string, name: string) => properties[name],
    getStyle: () =>
      style(
        [
          ...new Map(
            (features ?? [feature]).map((entry) => [entry.layer.id, entry.layer]),
          ).values(),
        ].map((entry) => ({
          ...entry,
          layout: {...entry.layout, 'text-field': properties['text-field']},
        })),
      ),
    queryRenderedFeatures: () => features ?? [feature],
  } as unknown as MapLibreMap;
}

test('contrast uses evaluated opaque halo colors and points back to the view and exact property', () => {
  const labels = sampleDiagnosticLabels(labelMap());
  assert.equal(labels.length, 1);
  assert.ok(labels[0].ratio > 1 && labels[0].ratio < 3);
  assert.deepEqual(labels[0].coordinate, [1, 2]);
  const finding = collect([], {labels})[0];
  assert.equal(finding.check, 'low-text-contrast');
  assert.equal(finding.kind, 'review');
  assert.deepEqual(finding.target, {layer: 'labels', section: 'paint', property: 'text-color'});
  assert.equal(finding.samples?.[0].camera?.zoom, 14);
});

test('label query excludes unrelated geometry, hidden layers, out-of-zoom layers and internal overlays', () => {
  const map = labelMap();
  const labels = (id: string) => ({...symbol(id), layout: {'text-field': ['get', 'name']}});
  const configured = style([
    line('roads'),
    labels('visible'),
    {...labels('hidden'), layout: {'text-field': ['get', 'name'], visibility: 'none'}},
    {...labels('too-close'), minzoom: 15},
    {...labels('too-far'), maxzoom: 14},
    labels('__tileflow-inspector-label'),
    symbol('icons-only'),
  ]);
  map.getStyle = () => configured;
  let queries = 0;
  map.queryRenderedFeatures = ((_geometry: unknown, options: {layers: string[]}) => {
    queries++;
    assert.deepEqual(options.layers, ['visible']);
    return [];
  }) as MapLibreMap['queryRenderedFeatures'];
  assert.deepEqual(sampleDiagnosticLabels(map), []);
  assert.equal(queries, 1);
});

test('maps without eligible text layers do not query rendered geometry', () => {
  const map = labelMap();
  map.getStyle = () =>
    style([
      line('roads'),
      symbol('icons-only'),
      {...symbol('outside'), minzoom: 20, layout: {'text-field': 'Outside'}},
    ]);
  map.queryRenderedFeatures = () => {
    assert.fail('No rendered query is needed without an eligible text layer');
  };
  assert.deepEqual(sampleDiagnosticLabels(map), []);
});

test('unknown, transparent, blurred and formatted colors do not turn into contrast findings', () => {
  for (const override of [
    {'text-halo-color': 'rgba(0,0,0,0.5)'},
    {'text-color': 'rgba(0,0,0,0.5)'},
    {'text-halo-width': 0},
    {'text-halo-blur': 1},
    {'text-opacity': 0.5},
    {'text-size': 0},
    {'text-color': ['to-color', ['get', 'missing']]},
    {'text-field': ['format', 'Station', {'text-color': '#fff'}]},
  ])
    assert.deepEqual(sampleDiagnosticLabels(labelMap(override)), []);
});

test('high contrast is silent and repeated affected samples form one finding per layer', () => {
  assert.deepEqual(
    collect([], {
      labels: sampleDiagnosticLabels(
        labelMap({'text-color': '#000000', 'text-halo-color': '#ffffff'}),
      ),
    }),
    [],
  );
  const sample = sampleDiagnosticLabels(labelMap())[0];
  const labels: DiagnosticLabelSample[] = [sample, {...sample, featureId: 2, text: 'Road'}];
  const findings = collect([], {labels});
  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.find((entry) => entry.label === 'Affected samples')?.value, 2);
  assert.equal(findings[0].samples?.length, 2);
});

test('bounded label sampling shares the budget across layers and deduplicates tile fragments', () => {
  const feature = (layer: string, id: number) =>
    ({
      id,
      source: 'map',
      sourceLayer: 'poi',
      properties: {name: `${layer}-${id}`},
      layer: symbol(layer),
      geometry: {type: 'Point', coordinates: [1, 2]},
    }) as unknown as MapGeoJSONFeature;
  const features = [
    ...Array.from({length: 150}, (_, i) => feature('dense', i)),
    feature('sparse', 1),
    feature('sparse', 1),
  ];
  const labels = sampleDiagnosticLabels(labelMap({}, features), 3);
  assert.deepEqual(
    labels.map((entry) => entry.layer),
    ['dense', 'sparse', 'dense'],
  );
  assert.equal(
    sampleDiagnosticLabels(labelMap({}, [feature('same', 1), feature('same', 1)]), 40).length,
    1,
  );
  assert.equal(sampleDiagnosticLabels(labelMap({}, features), 1000).length, 100);
  assert.equal(sampleDiagnosticLabels(labelMap({}, features), 0).length, 0);
});
