import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {serializeCanonicalJson, type MapLibreStyle, type TileflowPoiCategory} from '@tileflow/core';
import {TileflowNativeCompatibilityError} from '@tileflow/core/native-profile';
import {lowerTileflowNativeCompiledStyles} from '../src/native-artifacts';
import {rebindNativeLayerReferences} from '../src/native-layer-references';

function poiEntry(layerId: string, priority: number, category: TileflowPoiCategory) {
  return {
    anchor: 'pointer-coordinate',
    category,
    layerId,
    priority,
    representation: 'marker',
    source: 'tileflow',
    sourceLayer: 'poi',
  };
}

function fixture(): MapLibreStyle {
  return {
    version: 8,
    name: 'Main',
    sources: {tileflow: {type: 'vector', url: 'https://tiles.example/tiles/world/tiles.json'}},
    metadata: {
      'tileflow:overlay-placement-manifest': {
        schemaVersion: 1,
        anchors: {
          'above-water': 'road',
          'below-roads': 'road',
          'above-roads': 'poi',
          'above-buildings': 'poi',
          'below-labels': 'poi',
          'above-labels': null,
        },
      },
      'tileflow:interaction-manifest': {
        version: 2,
        domains: {
          poi: {
            deduplication: {
              identity: ['source', 'source-layer', 'feature-id'],
              representationPriority: ['marker', 'icon', 'combined', 'label'],
            },
            fields: {
              category: 'class',
              filterRank: 'rank',
              icon: 'icon',
              name: 'name',
              sizeRank: 'rank',
              type: 'subclass',
            },
            hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
            identity: 'maplibre-feature-id-if-present',
            layers: [poiEntry('poi', 2, 'food-drink')],
          },
        },
      },
    },
    layers: [
      {id: 'background', type: 'background'},
      {
        id: 'road',
        type: 'line',
        source: 'tileflow',
        'source-layer': 'transportation',
        layout: {'line-cap': ['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']},
      },
      {id: 'poi', type: 'circle', source: 'tileflow', 'source-layer': 'poi'},
    ],
  };
}

function poiLayers(style: MapLibreStyle) {
  return (
    style.metadata as {
      'tileflow:interaction-manifest': {
        domains: {
          poi: {
            layers: {
              layerId: string;
              priority: number;
              source: string;
              sourceLayer: string;
            }[];
          };
        };
      };
    }
  )['tileflow:interaction-manifest'].domains.poi.layers;
}

function overlayAnchors(style: MapLibreStyle) {
  return (
    style.metadata as {
      'tileflow:overlay-placement-manifest': {anchors: Record<string, string | null>};
    }
  )['tileflow:overlay-placement-manifest'].anchors;
}

function indexOf(style: MapLibreStyle, id: string): number {
  return style.layers.findIndex((layer) => layer.id === id);
}

test('lowering a split line layer before POI layers moves every priority to its output index', () => {
  const original = fixture();
  original.layers.push(
    {
      id: 'rail',
      type: 'line',
      source: 'tileflow',
      'source-layer': 'transportation',
      paint: {
        'line-dasharray': [
          'case',
          ['==', ['get', 'class'], 'rail'],
          ['literal', [2, 1]],
          ['literal', [1, 0]],
        ],
      },
    },
    {id: 'poi-marker', type: 'circle', source: 'tileflow', 'source-layer': 'poi'},
  );
  poiLayers(original).push(poiEntry('poi-marker', 4, 'lodging'));
  Object.assign(overlayAnchors(original), {
    'above-buildings': 'rail',
    'below-labels': 'poi-marker',
  });
  const before = structuredClone(original);

  const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
  const output = lowered.styles.main!.light!;
  const [road, rail] = lowered.transformations[0]!.layers;
  assert.deepEqual(
    [road!.inputLayer, rail!.inputLayer],
    [1, 3],
    'Both line layers are split around the first POI layer.',
  );
  assert.ok(road!.outputCount > 1 && rail!.outputCount > 1);

  const priorities = poiLayers(output);
  assert.deepEqual(
    priorities.map(({layerId}) => layerId),
    ['poi', 'poi-marker'],
  );
  for (const {layerId, priority} of priorities) {
    assert.equal(priority, indexOf(output, layerId), layerId);
    assert.equal(output.layers[priority]!.id, layerId);
  }
  assert.equal(priorities[0]!.priority, 1 + road!.outputCount);
  assert.equal(priorities[1]!.priority, 2 + road!.outputCount + rail!.outputCount);

  // Anchors are insertion-before boundaries, so a split anchor names its first branch.
  assert.deepEqual(overlayAnchors(output), {
    'above-water': output.layers[road!.outputStart]!.id,
    'below-roads': output.layers[road!.outputStart]!.id,
    'above-roads': 'poi',
    'above-buildings': output.layers[rail!.outputStart]!.id,
    'below-labels': 'poi-marker',
    'above-labels': null,
  });
  for (const anchor of Object.values(overlayAnchors(output)))
    assert.ok(anchor === null || indexOf(output, anchor) >= 0, String(anchor));

  // The receipt binds the rebound style, and the compiled input stays untouched.
  assert.equal(
    lowered.transformations[0]!.loweredStyleSha256,
    createHash('sha256').update(serializeCanonicalJson(output)).digest('hex'),
  );
  assert.deepEqual(original, before);
});

test('lowered road branches keep overlay boundaries and POI topmost priorities current', () => {
  const original = fixture();
  const before = structuredClone(original);
  const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
  const candidate = lowered.styles.main!.light!;
  assert.ok(candidate.layers.length > original.layers.length);
  const loweredMetadata = structuredClone(candidate.metadata);
  const result = rebindNativeLayerReferences(
    original,
    candidate,
    lowered.transformations[0]!.layers,
  );
  assert.ok(result);
  assert.deepEqual(result, candidate, 'Rebinding the lowered style again is idempotent.');
  assert.deepEqual(candidate.metadata, loweredMetadata, 'The lowered input is not mutated.');
  assert.equal(result.layers, candidate.layers, 'Physical layers are returned unchanged.');
  const anchors = overlayAnchors(result);
  assert.equal(anchors['below-roads'], candidate.layers[1]!.id);
  assert.equal(anchors['above-roads'], 'poi');
  assert.equal(anchors['above-labels'], null);
  const poi = poiLayers(result)[0]!;
  assert.equal(poi.layerId, 'poi');
  assert.equal(poi.priority, indexOf(result, 'poi'));
  assert.equal(poi.source, 'tileflow');
  assert.deepEqual(original, before);
  assert.equal(poiLayers(original)[0]!.priority, 2, 'The compiled input keeps its priorities.');
});

test('lowering correspondence cannot silently borrow another layer or accept stale provenance', () => {
  const original = fixture();
  const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
  const candidate = lowered.styles.main!.light!;
  const changes = lowered.transformations[0]!.layers;
  assert.equal(rebindNativeLayerReferences(original, candidate, []), undefined);
  assert.equal(
    rebindNativeLayerReferences(
      original,
      {...candidate, layers: [...candidate.layers].reverse()},
      changes,
    ),
    undefined,
  );
  const stale = structuredClone(original);
  poiLayers(stale)[0]!.priority = 0;
  assert.equal(rebindNativeLayerReferences(stale, candidate, changes), undefined);
  for (const patch of [{source: 'other'}, {sourceLayer: 'transportation'}]) {
    const foreign = structuredClone(original);
    Object.assign(poiLayers(foreign)[0]!, patch);
    assert.equal(rebindNativeLayerReferences(foreign, candidate, changes), undefined);
  }
});

test('unprovable references fail native lowering with the style metadata pointer', () => {
  const stale = fixture();
  poiLayers(stale)[0]!.priority = 0;
  const missing = fixture();
  overlayAnchors(missing)['above-roads'] = 'removed';
  for (const style of [stale, missing]) {
    assert.throws(
      () => lowerTileflowNativeCompiledStyles({main: {light: style}}),
      (error: unknown) =>
        error instanceof TileflowNativeCompatibilityError &&
        error.issues.length === 1 &&
        error.issues[0]!.code === 'NATIVE_UNSUPPORTED_STYLE' &&
        error.issues[0]!.path === '/maps/main/themes/light/style/metadata',
    );
  }
});

test('unchanged styles keep their metadata and identities', () => {
  const original = fixture();
  const result = rebindNativeLayerReferences(original, structuredClone(original), []);
  assert.deepEqual(result, original);
  assert.notEqual(result, original);
});

test('ordered numeric spans are the only lowering correspondence', () => {
  const original = fixture();
  const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
  const changes = lowered.transformations[0]!.layers;
  const span = changes[0]!;
  assert.equal(span.inputLayer, 1);
  assert.equal(span.outputStart, 1);
  assert.ok(span.outputCount > 1);
  assert.deepEqual(span.properties, ['line-cap']);
  for (const invalid of [
    [{...span, inputLayer: 0}],
    [{...span, inputLayer: 99}],
    [{...span, outputStart: 0}],
    [{...span, outputStart: 2}],
    [{...span, outputCount: 0}],
    [{...span, outputCount: 33}],
    [{...span, outputCount: span.outputCount + 1}],
    [{...span, properties: []}],
    [span, span],
  ]) {
    assert.equal(
      rebindNativeLayerReferences(original, lowered.styles.main!.light!, invalid),
      undefined,
      JSON.stringify(invalid),
    );
  }
});

test('multiple expanded input spans preserve intervening POI identity and final priority', () => {
  const original = fixture();
  original.layers.push({...original.layers[1]!, id: 'road-after-poi'});
  const lowered = lowerTileflowNativeCompiledStyles({main: {light: original}});
  const spans = lowered.transformations[0]!.layers;
  assert.equal(spans.length, 2);
  assert.equal(spans[1]!.inputLayer, 3);
  assert.equal(spans[1]!.outputStart, 2 + spans[0]!.outputCount);
  assert.equal(poiLayers(lowered.styles.main!.light!)[0]!.priority, 1 + spans[0]!.outputCount);
  const result = rebindNativeLayerReferences(original, lowered.styles.main!.light!, spans);
  assert.ok(result);
  assert.equal(poiLayers(result)[0]!.priority, 1 + spans[0]!.outputCount);
  assert.equal(
    rebindNativeLayerReferences(original, lowered.styles.main!.light!, [...spans].reverse()),
    undefined,
  );
  const foreign = structuredClone(lowered.styles.main!.light!);
  foreign.layers[spans[0]!.outputStart]!.source = 'other';
  assert.equal(rebindNativeLayerReferences(original, foreign, spans), undefined);
});
