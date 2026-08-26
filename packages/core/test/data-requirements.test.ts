import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferTileflowDataRequirements,
  validateTileflowDataCompatibility,
} from '../src/data/requirements';
import type {MapLibreStyle} from '../src/types';

test('infers only effective source layers and fields from finalized style expressions', () => {
  const requirements = inferTileflowDataRequirements(style());
  assert.deepEqual(requirements, {
    complete: true,
    dynamicAccesses: [],
    schemaVersion: 1,
    sourceId: 'tileflow',
    sourceLayers: [
      {fields: [{name: 'class'}, {name: 'hide_3d'}], id: 'building'},
      {fields: [{name: 'class'}, {name: 'name'}, {name: 'rank'}], id: 'poi'},
    ],
  });
});

test('manual requirements only add non-inferable facts and may require observed field types', () => {
  const requirements = inferTileflowDataRequirements(style(), {
    additional: [{fields: [{name: 'render_height', type: 'Number'}], id: 'building'}],
  });
  const issues = validateTileflowDataCompatibility(requirements, {
    sourceLayers: [
      {
        fields: [
          {name: 'class', type: 'String'},
          {name: 'hide_3d', type: 'Boolean'},
          {name: 'render_height', type: 'String'},
        ],
        id: 'building',
      },
      {
        fields: [
          {name: 'class', type: 'String'},
          {name: 'name', type: 'String'},
        ],
        id: 'poi',
      },
    ],
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['field-type-mismatch', 'field-missing'],
  );
});

test('missing layers and dynamic field expressions fail compatibility explicitly', () => {
  const input = style();
  input.layers[0]!.filter = ['has', ['concat', 'na', 'me']] as never;
  const requirements = inferTileflowDataRequirements(input);
  assert.equal(requirements.complete, false);
  assert.deepEqual(
    validateTileflowDataCompatibility(requirements, {sourceLayers: []}).map((issue) => issue.code),
    ['dynamic-field-access', 'source-layer-missing', 'source-layer-missing'],
  );
});

function style(): MapLibreStyle {
  return {
    version: 8,
    sources: {tileflow: {type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf']}},
    layers: [
      {
        id: 'poi',
        type: 'symbol',
        source: 'tileflow',
        'source-layer': 'poi',
        filter: ['all', ['has', 'name'], ['==', ['get', 'class'], 'cafe']],
        layout: {'text-field': ['get', 'name']},
        paint: {'text-opacity': ['step', ['get', 'rank'], 1, 4, 0]},
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'tileflow',
        'source-layer': 'building',
        filter: ['all', ['==', ['get', 'class'], 'commercial'], ['!', ['has', 'hide_3d']]],
      },
      {
        id: 'external',
        type: 'circle',
        source: 'other',
        'source-layer': 'ignored',
        paint: {'circle-radius': ['get', 'not-a-world-requirement']},
      },
    ],
  } as MapLibreStyle;
}
