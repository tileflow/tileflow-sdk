import {expression as styleExpression} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {openMapTiles} from '../src';
import {foldMappedComparison, mappedValue} from '../src/cartography/mapped-comparisons';
import {openMapTilesAdapter} from '../src/data/openmaptiles';

const road = openMapTilesAdapter(openMapTiles()).adapter.layers.road![0]!.fields!;
const roadClass = mappedValue((road.class as {expression: unknown[]}).expression);
const roadType = mappedValue((road.type as {expression: unknown[]}).expression);

const classes = [
  'motorway',
  'primary',
  'minor',
  'service',
  'path',
  'busway',
  'bus_guideway',
  'transit',
  'primary_construction',
  'minor_construction',
  'path_construction',
];
const subclasses = [undefined, 'pedestrian', 'footway', 'rail', 'primary'];
const features = classes.flatMap((value) =>
  subclasses.map((subclass) => ({
    type: 2 as const,
    properties: {class: value, ...(subclass === undefined ? {} : {subclass})},
  })),
);

/** A World value read through the adapter, or null where the feature has none. */
function worldValue(accessor: unknown[], feature: (typeof features)[number]): unknown {
  try {
    return styleExpression
      .createExpression(accessor)
      .value.evaluateWithoutErrorHandling({zoom: 14}, feature);
  } catch {
    return null;
  }
}

function evaluate(value: unknown, feature: (typeof features)[number]): unknown {
  const parsed = styleExpression.createExpression(value);
  assert.equal(parsed.result, 'success', JSON.stringify(value));
  return parsed.value.evaluateWithoutErrorHandling({zoom: 14}, feature);
}

test('a comparison of a mapped road value reads the OpenMapTiles properties directly', () => {
  assert.deepEqual(foldMappedComparison(['==', roadClass, 'path']), [
    'match',
    ['get', 'class'],
    'path',
    ['match', ['get', 'subclass'], 'pedestrian', false, true],
    false,
  ]);
  for (const [accessor, values] of [
    [roadClass, ['street', 'path', 'pedestrian', 'construction', 'busway', 'service', 'transit']],
    [roadType, ['primary', 'street', 'path', 'footway', 'rail', 'pedestrian']],
  ] as const) {
    for (const value of values) {
      for (const operator of ['==', '!='] as const) {
        const folded = foldMappedComparison([operator, accessor, value]);
        for (const feature of features) {
          const equal = worldValue([...accessor], feature) === value;
          assert.equal(
            evaluate(folded, feature),
            operator === '==' ? equal : !equal,
            `${operator} ${value} ${JSON.stringify(feature.properties)}`,
          );
        }
      }
    }
  }
});

test('a match on a mapped value and its conjunctions fold into matches on the source property', () => {
  const colour = foldMappedComparison([
    'match',
    roadClass,
    ['street', 'service'],
    '#fff',
    'construction',
    '#ccc',
    '#000',
  ]);
  const underConstruction = foldMappedComparison([
    'all',
    foldMappedComparison(['==', roadClass, 'construction']),
    foldMappedComparison(['==', roadType, 'primary']),
  ]);
  // An OpenMapTiles class of plain `construction` would read as itself, its type as the subclass.
  assert.deepEqual(underConstruction, [
    'match',
    ['get', 'class'],
    'primary_construction',
    true,
    'construction',
    ['match', ['get', 'subclass'], 'primary', true, false],
    false,
  ]);
  for (const feature of features) {
    const value = worldValue([...roadClass], feature);
    assert.equal(
      evaluate(colour, feature),
      value === 'street' || value === 'service'
        ? '#fff'
        : value === 'construction'
          ? '#ccc'
          : '#000',
    );
    assert.equal(
      evaluate(underConstruction, feature),
      value === 'construction' && worldValue([...roadType], feature) === 'primary',
    );
  }
});

test('expressions without a mapped value are left as they are', () => {
  const plain = ['==', ['get', 'class'], 'path'];
  assert.equal(foldMappedComparison(plain), plain);
  const authored = ['==', ['match', ['get', 'class'], 'minor', 'street', 'other'], 'street'];
  assert.equal(foldMappedComparison(authored), authored);
  const conjunction = [
    'all',
    ['match', ['get', 'class'], ['city', 'town'], true, false],
    ['match', ['get', 'class'], ['town'], true, false],
  ];
  assert.equal(foldMappedComparison(conjunction), conjunction);
  const numeric = ['match', mappedValue(['match', ['get', 'rank'], 1, 2, 3]), 2, true, false];
  assert.equal(foldMappedComparison(numeric), numeric);
});
