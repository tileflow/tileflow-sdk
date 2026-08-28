import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, expression, fixed, land, poi, water} from '../src';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {
  addModuleLayer,
  internalModuleEffects,
  semanticLayer,
} from '../src/cartography/module-effects';
import {extendStreets} from './map-fixture';

const compileTestMap = (design: Parameters<typeof extendStreets>[0] = {}) =>
  createStyle(
    extendStreets({
      ...design,
      modules: {poi: poi({enabled: false}), ...design.modules},
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

test('optimizer-generated IDs remain unique in the final style', () => {
  const style = compileTestMap();
  assert.equal(new Set(style.layers.map(({id}) => id)).size, style.layers.length);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('createStyle rejects an unthemed dynamic color expression before finalization', () => {
  assert.throws(
    () =>
      compileTestMap({
        modules: {
          water: water({bodies: {fill: {color: expression<string>(['get'])}}}),
        },
      }),
    /theme audit failed/u,
  );
});

test('style metadata lists only enabled modules', () => {
  const style = compileTestMap({
    modules: {water: water({enabled: false})},
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
  const layout = input.property === 'icon-image' ? {[input.property]: input.value} : undefined;
  const paint = input.property === 'icon-image' ? undefined : {[input.property]: input.value};
  const type =
    input.property === 'icon-image'
      ? 'symbol'
      : input.property === 'background-pattern'
        ? 'background'
        : input.property === 'fill-extrusion-pattern'
          ? 'fill-extrusion'
          : input.property === 'line-pattern'
            ? 'line'
            : 'fill';
  const layer = {
    id: `image-reference-${input.property}`,
    type,
    ...(type === 'background'
      ? {}
      : {source: 'tileflow', 'source-layer': semanticLayer('landuse')}),
    ...(layout ? {layout} : {}),
    ...(paint ? {paint} : {}),
  };

  return createStyle(
    extendStreets({
      modules: {land: land({})},
      ...internalModuleEffects([
        addModuleLayer('land', `land.effects.${input.property}`, layer, {after: 'land.background'}),
      ]),
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
      [
        'match',
        ['get', 'kind'],
        'a',
        fixed('known', {reason: 'Static image-expression fixture.'}),
        fixed('missing-match', {reason: 'Static image-expression fixture.'}),
      ],
    ],
    [
      'case',
      [
        'case',
        ['boolean', ['get', 'active'], false],
        fixed('missing-case', {reason: 'Static image-expression fixture.'}),
        fixed('known', {reason: 'Static image-expression fixture.'}),
      ],
    ],
    [
      'step',
      [
        'step',
        ['zoom'],
        fixed('known', {reason: 'Static image-expression fixture.'}),
        10,
        fixed('missing-step', {reason: 'Static image-expression fixture.'}),
      ],
    ],
    [
      'interpolate',
      [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        fixed('known', {reason: 'Static image-expression fixture.'}),
        10,
        fixed('missing-interpolate', {reason: 'Static image-expression fixture.'}),
      ],
    ],
    [
      'image',
      [
        'coalesce',
        ['image', fixed('known', {reason: 'Static image-expression fixture.'})],
        ['image', fixed('missing-image', {reason: 'Static image-expression fixture.'})],
      ],
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
        value: [
          'concat',
          fixed('icon-', {reason: 'Dynamic image-expression validation fixture.'}),
          ['get', 'kind'],
        ],
      }),
    /theme audit failed/u,
  );
});
