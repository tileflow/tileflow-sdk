import assert from 'node:assert/strict';
import test from 'node:test';
import {aeroways, boundaries, buildings, land, transit, water, zoom} from '../src';
import {mergeTileflowDesign} from '../src/cartography/merge';

test('creates serializable requests for every Streets domain', () => {
  const requests = {
    land: land({landuse: {commercial: {color: '#eee'}}}),
    water: water({bodies: {color: '#ace'}}),
    buildings: buildings({mode: '3d'}),
    boundaries: boundaries({admin2: {width: 2}}),
    transit: transit({rail: {dash: [2, 1]}}),
    aeroways: aeroways({
      runway: {
        fill: {
          width: zoom.linear([
            [8, 1],
            [16, 8],
          ]),
        },
      },
    }),
  };

  assert.doesNotThrow(() => JSON.stringify(requests));
  assert.equal(requests.land.type, 'land');
  assert.equal(requests.water.type, 'water');
  assert.equal(requests.buildings.type, 'buildings');
  assert.equal(requests.boundaries.type, 'boundaries');
  assert.equal(requests.transit.type, 'transit');
  assert.equal(requests.aeroways.type, 'aeroways');
});

test('merges partial module requests while replacing arrays and preserving zoom values atomically', () => {
  const resolved = mergeTileflowDesign(
    {
      enabled: true,
      rail: {
        color: '#333',
        dash: [1, 1],
        width: zoom.linear([
          [5, 0.5],
          [15, 3],
        ]),
      },
    },
    {rail: {color: '#111'}},
    {rail: {dash: [4, 2]}},
  );

  assert.deepEqual(resolved.rail.color, '#111');
  assert.deepEqual(resolved.rail.dash, [4, 2]);
  assert.deepEqual(
    resolved.rail.width,
    zoom.linear([
      [5, 0.5],
      [15, 3],
    ]),
  );
  assert.equal(resolved.enabled, true);
});
