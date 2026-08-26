import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aeroways,
  boundaries,
  buildings,
  createStyle,
  labels,
  land,
  poi,
  roads,
  transit,
  water,
  zoom,
} from '../src/index';
import {extendStreets} from './map-fixture';

const streetsPreparedAssets = {
  icons: {
    ids: [
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
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

const compileTestMap = (design: Parameters<typeof extendStreets>[0] = {}) =>
  createStyle(extendStreets(design), {preparedAssets: streetsPreparedAssets});

const variants = [
  {name: 'defaults', modules: undefined},
  {
    name: 'detailed light',
    modules: {
      aeroways: aeroways(),
      boundaries: boundaries(),
      buildings: buildings({mode: 'flat'}),
      labels: labels({places: 'all', roads: 'all', water: 'all'}),
      land: land(),
      poi: poi({
        icons: 'full',
        labels: 'full',
        maxRank: zoom.step([
          [12, 14],
          [16, 80],
          [19, 500],
        ]),
        preset: 'full',
        styles: {
          food: {
            icon: {haloColor: '#ffffff', haloWidth: 1, keepUpright: true},
            marker: {pitchAlignment: 'map', pitchScale: 'viewport', radius: 3},
          },
        },
      }),
      roads: roads({detail: 'all', extras: {paths: true}, hierarchy: 'strong'}),
      transit: transit(),
      water: water(),
    },
  },
  {
    name: 'exact dark',
    theme: {mode: 'dark' as const},
    modules: {
      roads: roads({
        classes: {
          primary: {
            surface: {
              fill: {
                color: '#f0b35d',
                width: zoom.linear([
                  [7, 0.6],
                  [12, 2.4],
                  [16, 8],
                ]),
              },
            },
          },
        },
      }),
      labels: labels({
        styles: {
          places: {
            city: {
              priority: 80,
              text: {
                haloWidth: 2,
                keepUpright: true,
                maxAngle: 40,
                radialOffset: 1,
                size: zoom.step([
                  [4, 11],
                  [8, 16],
                ]),
                variableAnchors: ['top', 'bottom'],
              },
            },
          },
        },
      }),
      water: water({bodies: {fill: {color: '#17384d'}}}),
    },
  },
] as const;

for (const variant of variants) {
  test(`emits a MapLibre-valid Streets style: ${variant.name}`, () => {
    const style = compileTestMap({
      ...(variant.theme ? {theme: variant.theme} : {}),
      ...(variant.modules ? {modules: variant.modules} : {}),
    });
    assert.deepEqual(validateStyleMin(style), []);
    assert.ok(style.layers.length > 100);
  });
}

test('disabled domains are deliberately absent rather than silently replaced', () => {
  const style = compileTestMap({
    modules: {
      buildings: buildings({enabled: false}),
      poi: poi({enabled: false}),
      roads: roads({enabled: false}),
      transit: transit({enabled: false}),
    },
  });

  assert.equal(
    style.layers.some((layer) => layer.id.startsWith('streets-buildings-')),
    false,
  );
  assert.equal(
    style.layers.some((layer) => layer.id.startsWith('streets-poi-')),
    false,
  );
  assert.equal(
    style.layers.some(
      (layer) => layer.id.startsWith('streets-road-') || layer.id.startsWith('streets-label-road-'),
    ),
    false,
  );
  assert.equal(
    style.layers.some((layer) => layer.id.startsWith('streets-label-place-')),
    true,
  );
  assert.equal(
    style.layers.some((layer) => layer.id.startsWith('streets-transit-')),
    false,
  );
  assert.deepEqual(validateStyleMin(style), []);
});

test('binds individual trees for the runtime 3d vegetation renderer', () => {
  const style = compileTestMap();
  const trees = style.layers.find((layer) => layer.id === 'streets-vegetation-trees');
  const treeIndex = style.layers.findIndex((layer) => layer.id === 'streets-vegetation-trees');
  const buildingIndex = style.layers.findIndex((layer) => layer.id === 'streets-buildings-fill');
  const roadIndex = style.layers.findIndex((layer) => layer.id === 'streets-road-oneway');
  const roadLabelIndex = style.layers.findIndex((layer) =>
    layer.id.startsWith('streets-label-road-'),
  );
  const labelIndex = style.layers.findIndex((layer) => layer.id.startsWith('streets-label-place-'));

  assert.equal(trees?.type, 'circle');
  assert.equal(trees?.['source-layer'], 'tree');
  assert.equal(trees?.minzoom, 16);
  assert.equal(trees?.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(trees?.metadata?.['tileflow:tree-species-field'], 'species');
  assert.equal(trees?.metadata?.['tileflow:tree-leaf-type-field'], 'leaf_type');
  assert.ok(roadIndex < buildingIndex);
  assert.ok(roadLabelIndex < buildingIndex);
  assert.ok(buildingIndex < treeIndex);
  assert.ok(treeIndex < labelIndex);
});
