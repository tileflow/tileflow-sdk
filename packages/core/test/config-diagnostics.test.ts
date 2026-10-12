import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildings,
  createStyle,
  createStyleResult,
  expr,
  fixed,
  labels,
  renderPass,
  token,
  withRenderStack,
  zoom,
} from '../src';
import {authoringCallSite} from '../src/cartography/data-expression';
import {field} from '../src/cartography/semantic-bindings';
import {extendStreets} from './map-fixture';

const icons = [
  'coffee',
  'crosswalk',
  'culture',
  'education',
  'food',
  'health',
  'lodging',
  'major-transit',
  'oneway',
  'services',
  'shopping',
  'sidewalk-dot',
];
const options = {preparedAssets: {icons: {ids: icons, sprite: '/tileflow/test/streets/sprite'}}};
const tall = expr.gt(expr.get(field('renderHeight')), 20);

function compileError(map: ReturnType<typeof extendStreets>): string {
  try {
    createStyle(map, options);
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail('Expected the map to be rejected');
}

function labelPass(style: Record<string, unknown>) {
  return extendStreets({
    modules: {
      labels: withRenderStack(labels(), {
        names: renderPass({
          feature: 'poi',
          placement: 'below-labels',
          renderer: 'symbol',
          style: style as never,
        }),
      }),
    },
  });
}

test('a render pass error names the nested property instead of the pass', () => {
  const message = compileError(labelPass({minZoom: '15', text: {field: expr.get(field('name'))}}));
  assert.match(
    message,
    /modules\.labels\.renderStack\.names\.style\.minZoom: Invalid input: expected number, received string/,
  );
});

test('fixed() on a structural property says the property is structural', () => {
  const message = compileError(labelPass({text: {field: fixed('{name}', {reason: 'Plain name'})}}));
  assert.match(message, /renderStack\.names\.style\.text\.field: This property is structural\./);
  assert.match(message, /apply only to visual properties/);
});

test('a fixed operand inside a visual expression asks for a plain value', () => {
  const message = compileError(
    extendStreets({
      modules: {
        buildings: buildings({
          flat: {
            fill: {
              color: expr.case(
                [
                  {
                    when: expr.gt(expr.get(field('renderHeight')), fixed(20, {reason: 'Towers'})),
                    value: token.color('surface.building'),
                  },
                ],
                token.color('surface.land'),
              ),
            },
          },
        }),
      },
    }),
  );
  assert.match(message, /Expected a fixed color value, received a fixed number\./);
  assert.match(message, /conditions and other operands take plain values/);
  assert.match(message, /Write 20 instead of fixed\(20\)\./);
});

test('module styles accept the expression forms refinements accept', () => {
  assert.doesNotThrow(() =>
    createStyle(
      extendStreets({
        modules: {
          buildings: buildings({
            flat: {
              fill: {
                color: expr.case(
                  [{when: tall, value: token.color('surface.building')}],
                  token.color('surface.land'),
                ),
              },
            },
          }),
        },
      }),
      options,
    ),
  );
});

test('an expression limit names the received count and the call site', () => {
  const branches = Array.from({length: 34}, (_, index) => ({labels: `c${index}`, value: index}));
  assert.throws(
    () =>
      expr.match(
        expr.get(field('class')),
        branches as unknown as Parameters<typeof expr.match>[1],
        0,
      ),
    (error: Error) => {
      assert.match(error.message, /^expr\.match received 34 branches; it supports at most 16\./);
      assert.match(error.message, /nested expr\.match groups/);
      assert.match(error.message, /Called at .*config-diagnostics\.test\.ts:\d+:\d+\.$/);
      return true;
    },
  );
});

test('the authoring call site is the first frame outside the throwing file', () => {
  const stack = [
    'Error',
    '    at limitError (/sdk/dist/chunk.js:10:5)',
    '    at match (/sdk/dist/chunk.js:20:7)',
    '    at /work/map/tileflow.config.ts:42:3',
    '    at Module._compile (node:internal/modules/cjs/loader:1:1)',
  ].join('\n');
  assert.equal(authoringCallSite(stack), '/work/map/tileflow.config.ts:42:3');
  assert.equal(
    authoringCallSite(
      ['Error', '    at f (file:///sdk/a.js:1:1)', '    at g (/sdk/a.js:2:2)'].join('\n'),
    ),
    undefined,
  );
});

test('a layout step at a fractional zoom is reported with its semantic target', () => {
  const result = createStyleResult(
    labelPass({
      text: {
        field: expr.get(field('name')),
        font: token.font('default'),
        size: zoom.step([
          [0, fixed(12, {reason: 'Small names'})],
          [17.5, fixed(14, {reason: 'Street names'})],
        ]),
      },
    }),
    options,
  );
  assert.equal(result.ok, true);
  const warning = result.diagnostics.find(({code}) => code === 'TF_LAYOUT_FRACTIONAL_ZOOM_STEP');
  assert.deepEqual(warning && {...warning, message: undefined}, {
    code: 'TF_LAYOUT_FRACTIONAL_ZOOM_STEP',
    domain: 'labels',
    message: undefined,
    path: 'layers.tileflow-labels-render-names.layout.text-size',
    phase: 'lowering',
    severity: 'warning',
    suggestion: 'Step at whole zooms, or move the change to a paint property or a zoom range.',
    target: 'labels.render.names',
  });
  assert.match(warning!.message, /steps at zoom 17\.5; .* takes effect at zoom 18\./);
});

test('layout steps at whole zooms and paint steps raise no zoom warning', () => {
  const result = createStyleResult(
    labelPass({
      text: {
        color: zoom.step([
          [0, token.color('labels.primary')],
          [16.5, token.color('labels.muted')],
        ]),
        field: expr.get(field('name')),
        font: token.font('default'),
        size: zoom.step([
          [0, fixed(12, {reason: 'Small names'})],
          [17, fixed(14, {reason: 'Street names'})],
        ]),
      },
    }),
    options,
  );
  assert.equal(result.ok, true);
  assert.ok(!result.diagnostics.some(({code}) => code === 'TF_LAYOUT_FRACTIONAL_ZOOM_STEP'));
});
