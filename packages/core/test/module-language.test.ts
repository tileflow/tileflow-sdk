import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  labels,
  land,
  landforms,
  poi,
  roads,
  streets,
  tileflowMapSchema,
  transit,
  vegetation,
  water,
  zoom,
} from '../src';
import {tileflowStreetsModuleNames, tileflowStreetsRecipe} from '../src/basemaps/streets';
import {mergeTileflowDesign} from '../src/cartography/merge';

test('creates serializable requests for every Streets domain', () => {
  const requests = {
    addresses: addresses({labels: {text: {size: 10}}}),
    land: land({landuse: {commercial: {fill: {color: '#eee'}}}}),
    landforms: landforms({elevation: true}),
    water: water({bodies: {fill: {color: '#ace'}}}),
    buildings: buildings({mode: '3d'}),
    labels: labels({places: 'major'}),
    vegetation: vegetation({mode: '3d'}),
    boundaries: boundaries({admin2: {width: 2}}),
    poi: poi({preset: 'minimal'}),
    roads: roads({detail: 'major'}),
    transit: transit({rail: {surface: {dash: [2, 1]}}}),
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
  assert.equal(requests.addresses.type, 'addresses');
  assert.equal(requests.land.type, 'land');
  assert.equal(requests.landforms.type, 'landforms');
  assert.equal(requests.water.type, 'water');
  assert.equal(requests.buildings.type, 'buildings');
  assert.equal(requests.labels.type, 'labels');
  assert.equal(requests.vegetation.type, 'vegetation');
  assert.equal(requests.boundaries.type, 'boundaries');
  assert.equal(requests.poi.type, 'poi');
  assert.equal(requests.roads.type, 'roads');
  assert.equal(requests.transit.type, 'transit');
  assert.equal(requests.aeroways.type, 'aeroways');
});

test('keeps the Streets module recipe, type tags, and root schema in lockstep', () => {
  assert.deepEqual(Object.keys(tileflowStreetsRecipe.modules).sort(), tileflowStreetsModuleNames);

  for (const name of tileflowStreetsModuleNames) {
    const request = tileflowStreetsRecipe.modules[name];
    assert.equal(request.type, name);
    assert.equal(
      tileflowMapSchema.safeParse({basemap: streets(), modules: {[name]: request}}).success,
      true,
      `schema rejected Streets module ${name}`,
    );
  }
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
