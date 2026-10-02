import assert from 'node:assert/strict';
import test from 'node:test';
import {applyTileflowIconCapabilities} from '../src/cartography/icon-capabilities';
import {expression} from '../src/cartography/values';
import {createStyle, fixed, poi} from '../src/index';
import {extendStreets} from './map-fixture';

const sdf = {
  representation: 'sdf' as const,
  defaults: {color: '#c43d35', haloColor: '#ffffff', haloWidth: 0, haloBlur: 0},
};

function compile(image?: unknown, appearances: Record<string, unknown> = {health: sdf}) {
  return createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['medical'],
          labels: true,
          icons: true,
          placement: {coupleIconAndLabel: true},
          ...(image === undefined ? {} : {styles: {medical: {icon: {image: image as never}}}}),
        }),
      },
    }),
    {preparedAssets: {icons: {ids: ['health', 'brand'], sprite: '/sprite', appearances} as never}},
  );
}

test('rejects a dynamic POI selection across SDF and RGBA, including its fallback', () => {
  assert.throws(
    () => compile(),
    (error: unknown) => {
      assert.equal((error as {code: string}).code, 'TF_ICON_REPRESENTATION_MIXED');
      assert.match((error as Error).message, /tileflow-poi-medical/);
      return true;
    },
  );
});

test('rejects explicit mixed image branches and representation-changing overrides', () => {
  const image = expression<string>([
    'step',
    ['zoom'],
    fixed('health', {reason: 'Low zoom icon'}),
    17,
    fixed('brand', {reason: 'High zoom icon'}),
  ]);
  assert.throws(() => compile(image), /SDF.*RGBA/);
  assert.doesNotThrow(() => compile(image, {}));
});

test('a mixed package allows a proven homogeneous selection without splitting layers', () => {
  const style = compile(fixed('health', {reason: 'Invariant image'}));
  const layers = style.layers.filter((layer) => layer.id.startsWith('tileflow-poi'));
  assert.deepEqual(
    layers.map((layer) => layer.id),
    ['tileflow-poi-medical'],
  );
  assert.ok(layers[0]?.layout?.['text-field']);
  assert.equal(layers[0]?.paint?.['icon-color'], '#c43d35');
  assert.equal(layers[0]?.paint?.['icon-halo-width'], 0);
});

test('default paint follows the resolved image fallback and preserves authored overrides', () => {
  const style = compile(undefined, {
    health: sdf,
    brand: {...sdf, defaults: {...sdf.defaults, color: '#123456'}},
  });
  const layer = style.layers.find((layer) => layer.id === 'tileflow-poi-medical')!;
  assert.ok(Array.isArray(layer.paint?.['icon-color']));
  assert.match(JSON.stringify(layer.paint?.['icon-color']), /health|c43d35/);
  assert.doesNotThrow(() => compile(fixed('health', {reason: 'Invariant image'})));
});

test('legacy RGBA-only prepared assets retain the existing image expression and paint', () => {
  const style = compile(undefined, {});
  const layer = style.layers.find((layer) => layer.id === 'tileflow-poi-medical')!;
  assert.equal(layer.paint?.['icon-color'], undefined);
  assert.equal((layer.layout?.['icon-image'] as unknown[])[0], 'case');
});

test('rejects SDF patterns and halo expressions that can exceed the distance-field guard', () => {
  const icons = {ids: ['health'], appearances: {health: sdf}};
  const layer = {
    id: 'symbols',
    type: 'symbol',
    source: 'points',
    layout: {'icon-image': 'health'},
    paint: {'icon-halo-width': ['get', 'width']},
  };
  assert.throws(
    () => applyTileflowIconCapabilities({version: 8, sources: {}, layers: [layer]}, icons),
    /halo.*bound/i,
  );
  layer.paint['icon-halo-width'] = ['min', 2, ['max', 0, ['get', 'width']]];
  assert.doesNotThrow(() =>
    applyTileflowIconCapabilities({version: 8, sources: {}, layers: [layer]}, icons),
  );
  assert.throws(
    () =>
      applyTileflowIconCapabilities(
        {
          version: 8,
          sources: {},
          layers: [{id: 'pattern', type: 'fill', paint: {'fill-pattern': 'health'}}],
        },
        icons,
      ),
    /SDF.*pattern/i,
  );
});

test('rejects SDF images used as building extrusion patterns', () => {
  assert.throws(
    () =>
      applyTileflowIconCapabilities(
        {
          version: 8,
          sources: {},
          layers: [
            {id: 'buildings', type: 'fill-extrusion', paint: {'fill-extrusion-pattern': 'health'}},
          ],
        },
        {ids: ['health'], appearances: {health: sdf}},
      ),
    {code: 'TF_ICON_PATTERN_SDF'},
  );
});

test('a fixed-color pattern named constructor remains valid in a mixed package', () => {
  assert.doesNotThrow(() =>
    applyTileflowIconCapabilities(
      {
        version: 8,
        sources: {},
        layers: [{id: 'pattern', type: 'fill', paint: {'fill-pattern': 'constructor'}}],
      },
      {ids: ['health', 'constructor'], appearances: {health: sdf}},
    ),
  );
});

test('rejects legacy selectors that bypass expression-based SDF selection and defaults', () => {
  for (const image of ['{icon}', {property: 'kind', stops: [['medical', 'health']]}]) {
    const style = {
      version: 8,
      sources: {},
      layers: [{id: 'symbols', type: 'symbol', layout: {'icon-image': image}}],
    };
    assert.throws(
      () =>
        applyTileflowIconCapabilities(style, {
          ids: ['health', 'brand'],
          appearances: {health: sdf},
        }),
      {code: 'TF_ICON_SELECTION_UNPROVEN'},
    );
    assert.throws(
      () => applyTileflowIconCapabilities(style, {ids: ['health'], appearances: {health: sdf}}),
      {code: 'TF_ICON_SELECTION_UNPROVEN'},
    );
    assert.doesNotThrow(() =>
      applyTileflowIconCapabilities(style, {ids: ['health'], appearances: {}}),
    );
  }
});

test('native text fitting keeps the existing semantic layer and authored label placement', () => {
  const style = createStyle(
    extendStreets({
      modules: {
        poi: poi({
          categories: ['medical'],
          placement: {coupleIconAndLabel: true},
          styles: {
            medical: {
              icon: {
                image: fixed('health', {reason: 'Text background'}),
                textFit: 'both',
                textFitPadding: [4, 6, 4, 6],
              },
              text: {anchor: 'center', offset: [0, 0]},
            },
          },
        }),
      },
    }),
    {preparedAssets: {icons: {ids: ['health'], sprite: '/sprite', appearances: {health: sdf}}}},
  );
  const layer = style.layers.find((layer) => layer.id === 'tileflow-poi-medical')!;
  assert.equal(layer.layout?.['icon-text-fit'], 'both');
  assert.deepEqual(layer.layout?.['icon-text-fit-padding'], [4, 6, 4, 6]);
  assert.equal(layer.layout?.['text-anchor'], 'center');
  assert.deepEqual(layer.layout?.['text-offset'], [0, 0]);
  assert.equal(style.layers.filter((layer) => layer.id.startsWith('tileflow-poi')).length, 1);
});
