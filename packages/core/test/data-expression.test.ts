import {expression as maplibreExpression} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {expr, field} from '../src';
import {validateTileflowDataExpression} from '../src/cartography/data-expression';
import {bindSemanticReferences} from '../src/cartography/semantic-bindings';
import {openMapTiles, resolveTileflowData} from '../src/data';

const data = resolveTileflowData({
  attribution: 'Expression test',
  schema: openMapTiles({fields: {class: 'kind_fixture', rank: 'rank_fixture'}}),
  type: 'vector-tiles',
  url: 'https://example.test/data.json',
});

test('typed expression builders retain semantic fields until binding and lower exactly', () => {
  const value = expr.case(
    [
      {
        when: expr.any(
          expr.eq(expr.get(field('class')), 'motorway'),
          expr.gt(expr.toNumber(expr.get(field('rank')), 99), 5),
        ),
        value: expr.interpolate(
          {kind: 'cubic-bezier', x1: 0.42, y1: 0, x2: 1, y2: 1},
          expr.zoom(),
          [
            [4, 2],
            [12, 8],
          ],
        ),
      },
    ],
    expr.step(expr.zoom(), 1, [
      [6, 3],
      [10, 5],
    ]),
  );

  assert.deepEqual(bindSemanticReferences(value, data), {
    kind: 'expression',
    value: [
      'case',
      [
        'any',
        ['==', ['get', 'kind_fixture'], 'motorway'],
        ['>', ['to-number', ['get', 'rank_fixture'], 99], 5],
      ],
      ['interpolate', ['cubic-bezier', 0.42, 0, 1, 1], ['zoom'], 4, 2, 12, 8],
      ['step', ['zoom'], 1, 6, 3, 10, 5],
    ],
  });
});

test('arrays are always literal values and stop builders fail closed', () => {
  assert.deepEqual(expr.coalesce(expr.literal([2, 1]), [1, 0]), {
    kind: 'expression',
    value: ['coalesce', ['literal', [2, 1]], ['literal', [1, 0]]],
  });
  assert.throws(
    () =>
      expr.step(expr.zoom(), 0, [
        [8, 1],
        [8, 2],
      ]),
    /strictly increasing/u,
  );
});

test('numeric aggregation builders preserve exact MapLibre operator structure', () => {
  assert.deepEqual(expr.divide(12, 3).value, ['/', 12, 3]);
  assert.deepEqual(expr.min(4, 3, 2).value, ['min', 4, 3, 2]);
  assert.deepEqual(expr.max(4, 3, 2).value, ['max', 4, 3, 2]);
});

test('feature identity and remainder remain portable closed expressions', () => {
  const identity = expr.id();
  const bucket = expr.modulo(expr.abs(expr.toNumber(identity, 0)), 7);

  assert.deepEqual(identity.value, ['id']);
  assert.deepEqual(bucket.value, ['%', ['abs', ['to-number', ['id'], 0]], 7]);
  assert.deepEqual(validateTileflowDataExpression(bucket.value), []);
  assert.deepEqual(bindSemanticReferences(bucket, data), bucket);

  assert.match(validateTileflowDataExpression(['id', 1])[0]?.message ?? '', /expects 0 arguments/u);
  assert.match(validateTileflowDataExpression(['%', 1])[0]?.message ?? '', /expects 2 arguments/u);
});

test('numeric identity mixing varies empty-property points without camera or mutable state', () => {
  const modulus = 1_000_003;
  const first = expr.modulo(
    expr.multiply(expr.modulo(expr.abs(expr.toNumber(expr.id(), 0)), modulus), 73_771),
    modulus,
  );
  const mixed = expr.modulo(expr.multiply(first, 73_771), modulus);
  const compiled = maplibreExpression.createExpression(mixed.value);

  assert.equal(compiled.result, 'success');
  if (compiled.result !== 'success') return;

  const ids = Array.from({length: 64}, (_, index) => 125_190_355_951 + index * 10);
  const values = ids.map((id) => {
    const feature = {id, type: 1 as const, properties: {}};
    const value = compiled.value.evaluate({zoom: 15}, feature);

    assert.equal(value, compiled.value.evaluate({zoom: 19}, feature));
    assert.equal(value, compiled.value.evaluate({zoom: 15}, {...feature}));
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value < modulus);

    return Math.floor((value / modulus) * 6);
  });

  assert.equal(new Set(values).size, 6);
  assert.equal(compiled.value.evaluate({zoom: 15}, {type: 1, properties: {}}), 0);
});

test('feature state, boolean assertions, and scoped variables lower without raw arrays', () => {
  const tier = expr.let(
    'tier',
    expr.toNumber(expr.get(field('rank')), 0),
    expr.case(
      [
        {
          when: expr.toBoolean(expr.featureState('active'), false),
          value: expr.add(expr.var<number>('tier'), 1),
        },
      ],
      expr.var<number>('tier'),
    ),
  );

  assert.deepEqual(bindSemanticReferences(tier, data), {
    kind: 'expression',
    value: [
      'let',
      'tier',
      ['to-number', ['get', 'rank_fixture'], 0],
      [
        'case',
        ['boolean', ['feature-state', 'active'], false],
        ['+', ['var', 'tier'], 1],
        ['var', 'tier'],
      ],
    ],
  });
  assert.throws(() => expr.featureState('  '), /non-empty state key/u);
  assert.throws(() => expr.globalState(''), /non-empty state key/u);
  assert.throws(() => expr.var<number>(''), /non-empty variable name/u);
});

test('global state reads a style-wide value an application sets at runtime', () => {
  const plate = expr.case(
    [{when: expr.toBoolean(expr.globalState('selection'), false), value: 'quiet'}],
    'accent',
  );

  assert.deepEqual(bindSemanticReferences(plate, data), {
    kind: 'expression',
    value: ['case', ['boolean', ['global-state', 'selection'], false], 'quiet', 'accent'],
  });
  assert.deepEqual(validateTileflowDataExpression(['global-state', 'selection']), []);
  assert.equal(validateTileflowDataExpression(['global-state', '']).length, 1);
});

test('serialized expressions reject physical fields, unknown operators, and unbound variables', () => {
  assert.deepEqual(validateTileflowDataExpression(expr.get(field('class')).value), []);

  assert.match(
    validateTileflowDataExpression(['get', 'class'])[0]?.message ?? '',
    /semantic field/u,
  );
  assert.match(
    validateTileflowDataExpression(['paint-the-map', 1])[0]?.message ?? '',
    /unsupported Tileflow expression operator/iu,
  );
  assert.match(
    validateTileflowDataExpression(['var', 'missing'])[0]?.message ?? '',
    /unknown expression variable/iu,
  );
});

test('match builders reject ambiguous labels before compilation', () => {
  assert.throws(
    () =>
      expr.match(
        'kind',
        [
          {labels: ['road'], value: 1},
          {labels: ['road'], value: 2},
        ],
        0,
      ),
    /labels must be unique/u,
  );
  assert.throws(() => expr.match('kind', [{labels: [], value: 1}], 0), /must not be empty/u);
});
