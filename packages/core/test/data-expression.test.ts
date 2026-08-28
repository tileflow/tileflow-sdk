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
  assert.throws(() => expr.var<number>(''), /non-empty variable name/u);
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
