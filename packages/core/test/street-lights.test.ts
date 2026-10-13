import assert from 'node:assert/strict';
import test from 'node:test';
import {
  placeTileflowStreetLights,
  tileflowStreetLightBytes,
  type TileflowStreetLightLayers,
} from '../src/street-lights';
import {
  createTileflowStreetLights,
  tileflowStreetLightsLayerId,
} from '../src/street-lights-browser';
import type {TileflowTileLayer} from '../src/vector-tile-decode';

// Tiles of 4096 units and 4096 metres: a unit is a metre.
const options = {tileMetres: 4096};

function lampsOf(placement: ReturnType<typeof placeTileflowStreetLights>) {
  if (!placement) return [];
  const lamps = [];
  for (let at = 0; at < placement.lamps.length; at += tileflowStreetLightBytes) {
    const view = new DataView(placement.lamps.buffer, placement.lamps.byteOffset + at);
    lamps.push({
      // In metres, from the renderer's 8192 units.
      x: view.getUint16(0, true) / 2,
      y: view.getUint16(2, true) / 2,
      height: view.getUint16(4, true) / 10,
      reach: view.getUint8(6),
      mapped: (view.getUint8(7) & 1) === 1,
      coloured: (view.getUint8(7) & 2) === 2,
      colour: [view.getUint8(8), view.getUint8(9), view.getUint8(10)],
    });
  }
  return lamps;
}

function layer(
  features: {
    type: 'Point' | 'LineString' | 'Polygon';
    geometry: number[][];
    properties?: Record<string, string | number | boolean>;
  }[],
): TileflowTileLayer {
  return {
    extent: 4096,
    features: features.map((feature) => ({properties: {}, ...feature})),
  };
}

const lamp = (x: number, y: number, properties: Record<string, string | number> = {}) => ({
  type: 'Point' as const,
  geometry: [[x, y]],
  properties: {class: 'street', subclass: 'street_lamp', ...properties},
});
const street = (properties: Record<string, string | boolean>, y = 2000) => ({
  type: 'LineString' as const,
  geometry: [[1000, y, 3000, y]],
  properties,
});

test('mapped lamps shine where they stand, with their height and the colour of their type', () => {
  const placement = placeTileflowStreetLights(
    {
      streetFurniture: layer([
        lamp(100, 200, {height: 9, lamp_type: 'high_pressure_sodium'}),
        lamp(300, 200, {lamp_mount: 'wall', light_colour: 'white'}),
        lamp(500, 200),
        // In the tile's buffer: the next tile draws it.
        lamp(-20, 200),
        {type: 'Point', geometry: [[700, 200]], properties: {subclass: 'bench'}},
      ]),
    },
    options,
  );
  assert.ok(placement);
  assert.equal(placement.mapped, 3);
  assert.equal(placement.estimated, 0);
  const [sodium, wall, plain] = lampsOf(placement);
  assert.deepEqual([sodium!.x, sodium!.y, sodium!.height], [100, 200, 9]);
  assert.ok(sodium!.mapped && sodium!.coloured);
  assert.deepEqual(sodium!.colour, [255, 166, 77]);
  assert.equal(wall!.height, 4.5);
  assert.ok(wall!.coloured);
  assert.equal(plain!.height, 7);
  assert.equal(plain!.coloured, false);
});

test('by default light is estimated only along streets and pavements mapped as lit', () => {
  const layers: TileflowStreetLightLayers = {
    transportation: layer([
      street({class: 'minor'}, 1000),
      street({class: 'minor', lit: true}, 2000),
      street({class: 'primary', lit: false}, 3000),
    ]),
    sidewalks: layer([
      {
        type: 'Polygon',
        geometry: [[1000, 3500, 1200, 3500, 1200, 3503, 1000, 3503, 1000, 3500]],
        properties: {class: 'sidewalk', lit: 'yes'},
      },
    ]),
  };
  const lamps = lampsOf(placeTileflowStreetLights(layers, options));
  assert.ok(lamps.length > 0);
  assert.ok(lamps.every((point) => !point.mapped));
  // Along the lit street, near its middle, and along the lit pavement; none along the others.
  const near = (y: number, within: number) =>
    lamps.filter((point) => Math.abs(point.y - y) <= within);
  assert.ok(near(2000, 3).length >= 60);
  assert.ok(near(3500, 5).length >= 5);
  assert.equal(near(1000, 10).length, 0);
  assert.equal(near(3000, 15).length, 0);
});

test('streets the data says nothing about take light only on request, never when mapped unlit', () => {
  const layers = {
    transportation: layer([
      street({class: 'minor'}, 1000),
      street({class: 'primary', lit: false}, 3000),
    ]),
  };
  assert.equal(placeTileflowStreetLights(layers, options), undefined);
  const lamps = lampsOf(placeTileflowStreetLights(layers, {...options, estimate: 'streets'}));
  assert.ok(lamps.some((point) => Math.abs(point.y - 1000) < 5));
  assert.ok(lamps.every((point) => Math.abs(point.y - 3000) > 15));
  assert.equal(
    placeTileflowStreetLights(
      {...layers, streetFurniture: layer([lamp(4000, 4000)])},
      {...options, estimate: 'none'},
    )?.estimated,
    0,
  );
});

test('estimated light keeps clear of mapped lamps, and a well-mapped tile is left to its data', () => {
  const mappedLamps = layer([lamp(2000, 1000)]);
  const lamps = lampsOf(
    placeTileflowStreetLights(
      {streetFurniture: mappedLamps, transportation: layer([street({class: 'minor'}, 1000)])},
      {...options, estimate: 'streets'},
    ),
  );
  assert.ok(
    lamps
      .filter((point) => !point.mapped)
      .every((point) => Math.hypot(point.x - 2000, point.y - 1000) >= 18),
  );
  // Two kilometres of street with a lamp every 30 metres maps them all: unmapped streets stay dark.
  const many = layer(
    Array.from({length: 67}, (_, index) => lamp(1000 + index * 30, 1000)).concat(
      Array.from({length: 67}, (_, index) => lamp(1000 + index * 30, 2000)),
    ),
  );
  const placement = placeTileflowStreetLights(
    {
      streetFurniture: many,
      transportation: layer([street({class: 'minor'}, 1000), street({class: 'minor'}, 2000)]),
    },
    {...options, estimate: 'streets'},
  );
  assert.equal(placement?.estimated, 0);
});

function fakeMap() {
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Set<string>();
  return {
    layers,
    listeners,
    addLayer(added: {id: string}) {
      layers.add(added.id);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle: () => ({layers: [{id: 'labels', type: 'symbol'}]}),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    triggerRepaint() {},
  };
}

test('the lights follow the sun, put their layer on the map and leave cleanly', () => {
  const map = fakeMap();
  let brightness = 0.5;
  const sun = () => ({brightness}) as never;
  const lights = createTileflowStreetLights({map, controller: {getSun: sun}});
  assert.ok(map.layers.has(tileflowStreetLightsLayerId));
  assert.equal(lights.on, 0);
  brightness = 0.02;
  assert.equal(lights.on, 1);
  assert.deepEqual(lights.stats, {tiles: 0, lamps: 0, mapped: 0, estimated: 0});
  lights.dispose();
  assert.equal(map.layers.has(tileflowStreetLightsLayerId), false);
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('street light options are validated', () => {
  assert.throws(() => createTileflowStreetLights({map: fakeMap(), minzoom: -1}), RangeError);
  assert.throws(() => createTileflowStreetLights({map: fakeMap(), maxTiles: 65}), RangeError);
  assert.throws(() => createTileflowStreetLights({map: fakeMap(), intensity: 3}), RangeError);
  assert.throws(
    () => createTileflowStreetLights({map: fakeMap(), color: 'not a colour'}),
    RangeError,
  );
  assert.throws(
    () => createTileflowStreetLights({map: fakeMap(), estimate: 'everywhere' as never}),
    RangeError,
  );
});
