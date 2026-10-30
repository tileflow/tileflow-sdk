import assert from 'node:assert/strict';
import test from 'node:test';
import {geoJSONProblem} from '../src/geojson';

const collection = (features: unknown[], extra: object = {}) => ({
  type: 'FeatureCollection',
  features,
  ...extra,
});
const feature = (geometry: unknown, extra: object = {}) => ({
  type: 'Feature',
  geometry,
  properties: {},
  ...extra,
});
const ring = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

test('application GeoJSON follows the renderer contract', () => {
  for (const valid of [
    collection([], {bbox: [0, 0, 1, 1]}),
    collection([
      feature(
        {type: 'Polygon', bbox: [0, 0, 1, 1], coordinates: [ring]},
        {id: 7, bbox: [0, 0, 1, 1], properties: {name: 'Park', tags: ['a']}},
      ),
    ]),
    collection([{type: 'Feature', geometry: null, properties: null}]),
    collection([feature({type: 'Point', coordinates: [-3.7, 40.42, 650]})]),
    collection([feature({type: 'MultiPoint', coordinates: []})]),
    collection([feature({type: 'MultiPolygon', coordinates: [[ring], [ring, ring]]})]),
    collection([
      feature({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    ]),
  ])
    assert.equal(geoJSONProblem(valid), undefined, JSON.stringify(valid));
});

test('malformed GeoJSON is rejected with the path of its first problem', () => {
  const cases: [unknown, string][] = [
    [[], '$.type'],
    [{type: 'Feature'}, '$.type'],
    [collection([], {crs: {}}), '$'],
    [collection([], {bbox: [0, 0, 1]}), '$.bbox'],
    [{type: 'FeatureCollection', features: {}}, '$.features'],
    [collection([feature({type: 'GeometryCollection', geometries: []})]), '$.features[0].geometry'],
    [
      collection([feature({type: 'Point', coordinates: [181, 0]})]),
      '$.features[0].geometry.coordinates',
    ],
    [
      collection([feature({type: 'Point', coordinates: [0, Number.NaN]})]),
      '$.features[0].geometry.coordinates',
    ],
    [
      collection([feature({type: 'LineString', coordinates: [[0, 0]]})]),
      '$.features[0].geometry.coordinates',
    ],
    [
      collection([feature({type: 'Polygon', coordinates: [ring.slice(0, 4)]})]),
      '$.features[0].geometry.coordinates',
    ],
    [
      collection([{type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}}]),
      '$.features[0]',
    ],
    [collection([feature(null, {id: 1.5})]), '$.features[0].id'],
    [collection([feature(null, {properties: []})]), '$.features[0].properties'],
    [collection([feature(null, {properties: {['k'.repeat(129)]: 1}})]), '$.features[0].properties'],
    [
      collection([feature(null), feature({type: 'Point', coordinates: [0]})]),
      '$.features[1].geometry.coordinates',
    ],
  ];
  for (const [value, path] of cases)
    assert.equal(geoJSONProblem(value), path, JSON.stringify(value));
  let deep: unknown = 1;
  for (let index = 0; index < 70; index += 1) deep = [deep];
  assert.equal(
    geoJSONProblem(collection([feature(null, {properties: {deep}})])),
    '$.features[0].properties',
  );
});

test('size is bounded by bytes, not by feature or position counts', () => {
  const positions = Array.from({length: 200_000}, (_, index) => [
    -180 + (index % 3600) / 10,
    -80 + (index % 1600) / 10,
  ]);
  const started = performance.now();
  assert.equal(
    geoJSONProblem(
      collection([
        feature({type: 'LineString', coordinates: positions}),
        ...positions.slice(0, 50_000).map((coordinates) => feature({type: 'Point', coordinates})),
      ]),
    ),
    undefined,
  );
  assert.ok(performance.now() - started < 1000, 'Validation is not linear.');
});
