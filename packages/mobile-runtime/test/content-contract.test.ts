import assert from 'node:assert/strict';
import test from 'node:test';
import {contentSchema} from '../src/content-contract';

const feature = {
  type: 'Feature',
  properties: {name: 'Saved place'},
  geometry: {type: 'Point', coordinates: [-3.7, 40.42]},
};
const overlay = {
  id: 'selection',
  kind: 'circle',
  data: {type: 'FeatureCollection', features: [feature]},
};

test('application content accepts GeoJSON and rejects duplicate or unbounded content', () => {
  assert.equal(contentSchema.safeParse({annotations: [], overlays: [overlay]}).success, true);
  for (const overlays of [
    [overlay, overlay],
    [{...overlay, id: '../style'}],
    [{...overlay, size: 65}],
    [{...overlay, color: 'url(https://example.org/tracker)'}],
    [{...overlay, data: {...overlay.data, features: Array(2001).fill(feature)}}],
  ])
    assert.equal(contentSchema.safeParse({annotations: [], overlays}).success, false);
});

test('malformed geometries fail before touching the renderer', () => {
  for (const geometry of [
    {type: 'Point', coordinates: [181, 0]},
    {type: 'Point', coordinates: [0, NaN]},
    {type: 'LineString', coordinates: [[0, 0]]},
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    },
    {type: 'GeometryCollection', geometries: []},
  ]) {
    assert.equal(
      contentSchema.safeParse({
        annotations: [],
        overlays: [
          {
            ...overlay,
            data: {...overlay.data, features: [{...feature, geometry}]},
          },
        ],
      }).success,
      false,
    );
  }
});
