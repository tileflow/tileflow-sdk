import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  disable,
  expr,
  field,
  fixed,
  land,
  renderPass,
  water,
  withRenderStack,
} from '../src';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {extendStreets} from './map-fixture';

const compileTestMap = (design: Parameters<typeof extendStreets>[0] = {}) =>
  createStyle(
    extendStreets({
      ...design,
      modules: {poi: disable(), ...design.modules},
    }),
  );

test('final styles are valid and free of compiler provenance metadata', () => {
  const style = compileTestMap();
  for (const compiledLayer of style.layers) {
    const metadata = compiledLayer.metadata as Record<string, unknown> | undefined;
    for (const key of Object.values(tileflowCompilerMetadataKeys)) {
      assert.equal(metadata?.[key], undefined);
    }
  }
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('physical-planner IDs remain unique in the final style', () => {
  const style = compileTestMap();
  assert.equal(new Set(style.layers.map(({id}) => id)).size, style.layers.length);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('createStyle rejects an unthemed dynamic color expression before finalization', () => {
  assert.throws(
    () =>
      compileTestMap({
        modules: {
          water: water({bodies: {fill: {color: expr.get(field('name'))}}}),
        },
      }),
    /theme audit failed/u,
  );
});

test('style metadata lists only enabled modules', () => {
  const style = compileTestMap({
    modules: {water: disable()},
  });

  assert.equal((style.metadata?.['tileflow:modules'] as string[]).includes('water'), false);
});

const preparedImageFixture = {
  icons: {ids: ['known'], sprite: '/tileflow/test/images/sprite'},
} as const;

function compileImageReferenceLayer(input: {
  property:
    | 'background-pattern'
    | 'fill-extrusion-pattern'
    | 'fill-pattern'
    | 'icon-image'
    | 'line-pattern';
  value: unknown;
}) {
  const renderer =
    input.property === 'icon-image'
      ? 'symbol'
      : input.property === 'background-pattern'
        ? 'background'
        : input.property === 'fill-extrusion-pattern'
          ? 'extrusion'
          : input.property === 'line-pattern'
            ? 'line'
            : 'fill';
  const style =
    input.property === 'icon-image' ? {icon: {image: input.value}} : {pattern: input.value};

  return createStyle(
    extendStreets({
      modules: {
        land: withRenderStack(land({}), {
          imageReference: renderPass({
            attachTo: 'land.background',
            ...(renderer === 'background' ? {} : {feature: 'landuse'}),
            phase: 'overlay',
            renderer,
            style: style as never,
          }),
        }),
      },
    }),
    {preparedAssets: preparedImageFixture},
  );
}

test('closes every MapLibre image property against the prepared sprite', () => {
  for (const property of [
    'icon-image',
    'background-pattern',
    'fill-pattern',
    'line-pattern',
    'fill-extrusion-pattern',
  ] as const) {
    assert.throws(
      () =>
        compileImageReferenceLayer({
          property,
          value: fixed(`missing-${property}`, {reason: 'Missing-image validation fixture.'}),
        }),
      new RegExp(`missing-${property}`),
    );
  }
});

test('enumerates every static branch of image expressions and rejects unthemed dynamic names', () => {
  for (const [operator, value] of [
    [
      'match',
      expr.match(
        expr.get(field('class')),
        [
          {
            labels: 'a',
            value: fixed('known', {reason: 'Static image-expression fixture.'}),
          },
        ],
        fixed('missing-match', {reason: 'Static image-expression fixture.'}),
      ),
    ],
    [
      'case',
      expr.case(
        [
          {
            value: fixed('missing-case', {reason: 'Static image-expression fixture.'}),
            when: expr.toBoolean(expr.get(field('hasBusiness')), false),
          },
        ],
        fixed('known', {reason: 'Static image-expression fixture.'}),
      ),
    ],
    [
      'step',
      expr.step(expr.zoom(), fixed('known', {reason: 'Static image-expression fixture.'}), [
        [10, fixed('missing-step', {reason: 'Static image-expression fixture.'})],
      ]),
    ],
    [
      'interpolate',
      expr.interpolate({kind: 'linear'}, expr.zoom(), [
        [0, fixed('known', {reason: 'Static image-expression fixture.'})],
        [10, fixed('missing-interpolate', {reason: 'Static image-expression fixture.'})],
      ]),
    ],
    [
      'image',
      expr.coalesce(
        fixed('known', {reason: 'Static image-expression fixture.'}),
        fixed('missing-image', {reason: 'Static image-expression fixture.'}),
      ),
    ],
  ] as const) {
    assert.throws(
      () => compileImageReferenceLayer({property: 'icon-image', value}),
      new RegExp(`missing-${operator}`),
    );
  }

  assert.throws(
    () =>
      compileImageReferenceLayer({
        property: 'icon-image',
        value: expr.concat(
          fixed('icon-', {reason: 'Dynamic image-expression validation fixture.'}),
          expr.toString(expr.get(field('class'))),
        ),
      }),
    /theme audit failed/u,
  );
});
