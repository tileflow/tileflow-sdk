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
  streets,
  transit,
  water,
  zoom,
} from '../src/index';

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
    theme: 'dark',
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
    const style = createStyle({
      basemap: streets(),
      ...(variant.theme ? {theme: variant.theme} : {}),
      ...(variant.modules ? {modules: variant.modules} : {}),
    });
    assert.deepEqual(validateStyleMin(style), []);
    assert.ok(style.layers.length > 100);
  });
}

test('disabled domains are deliberately absent rather than silently replaced', () => {
  const style = createStyle({
    basemap: streets(),
    modules: {
      buildings: buildings({enabled: false}),
      poi: poi({enabled: false}),
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
    style.layers.some((layer) => layer.id.startsWith('streets-transit-')),
    false,
  );
  assert.deepEqual(validateStyleMin(style), []);
});
