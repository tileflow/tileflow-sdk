import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, disable, roads} from '../src';
import {
  placeTileflowStreetLights,
  readTileflowStreetLights,
  tileflowStreetLightBytes,
  type TileflowStreetLightLayers,
  tileflowStreetLightsMetadataKey,
} from '../src/street-lights';
import {
  createTileflowStreetLights,
  tileflowStreetLightsLayerId,
} from '../src/street-lights-browser';
import type {TileflowRoadStreetLightStyle} from '../src/types';
import type {TileflowTileLayer} from '../src/vector-tile-decode';
import {extendStreets} from './map-fixture';

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

function fakeMap(metadata: Record<string, unknown> = {}) {
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
    getStyle: () => ({metadata, layers: [{id: 'labels', type: 'symbol'}]}),
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

test('standalone street lights reuse metadata until the style changes', () => {
  const map = fakeMap();
  let reads = 0;
  let metadata: Record<string, unknown> = {};
  map.getStyle = () => {
    reads += 1;
    return {metadata, layers: [{id: 'labels', type: 'symbol'}]};
  };
  const lights = createTileflowStreetLights({map});
  assert.equal(lights.stats.declared, false);
  const initialReads = reads;
  for (let frame = 0; frame < 120; frame += 1) assert.equal(lights.stats.declared, false);
  assert.equal(reads, initialReads);
  metadata = {
    [tileflowStreetLightsMetadataKey]: {
      version: 1,
      source: 'tileflow',
      layers: {streetFurniture: 'street_furniture', transportation: 'transportation'},
    },
  };
  map.listeners.get('styledata')?.forEach((listener) => listener());
  assert.equal(lights.stats.declared, true);
  const updatedReads = reads;
  for (let frame = 0; frame < 120; frame += 1) assert.equal(lights.stats.declared, true);
  assert.equal(reads, updatedReads);
  lights.dispose();
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('the lights follow the sun, put their layer on the map and leave cleanly', () => {
  const map = fakeMap();
  let brightness = 0.5;
  const sun = () => ({brightness}) as never;
  const lights = createTileflowStreetLights({map, controller: {getSun: sun}, enabled: true});
  assert.ok(map.layers.has(tileflowStreetLightsLayerId));
  assert.equal(lights.on, 0);
  brightness = 0.02;
  assert.equal(lights.on, 1);
  assert.deepEqual(lights.stats, {declared: false, tiles: 0, lamps: 0, mapped: 0, estimated: 0});
  lights.dispose();
  assert.equal(map.layers.has(tileflowStreetLightsLayerId), false);
  for (const set of map.listeners.values()) assert.equal(set.size, 0);
});

test('compiled SDK maps publish street lights only after an explicit opt-in', () => {
  const compile = (streetLights?: TileflowRoadStreetLightStyle) =>
    createStyle(extendStreets({modules: {poi: disable(), roads: roads({streetLights})}}));
  for (const settings of [undefined, {enabled: false}, {intensity: 0.7}])
    assert.equal(readTileflowStreetLights(compile(settings).metadata), undefined);
  const optedIn = readTileflowStreetLights(
    compile({enabled: true, estimate: 'none', intensity: 0.7}).metadata,
  );
  assert.ok(optedIn);
  assert.equal(optedIn.source, 'tileflow');
  assert.equal(optedIn.layers.streetFurniture, 'street_furniture');
  assert.equal(optedIn.estimate, 'none');
  assert.equal(optedIn.intensity, 0.7);
});

test('missing metadata keeps the runtime off even at night without mounting a layer', () => {
  const map = fakeMap();
  const lights = createTileflowStreetLights({
    map,
    controller: {getSun: () => ({brightness: 0}) as never},
  });
  assert.equal(lights.on, 0);
  assert.equal(map.layers.size, 0);
  assert.deepEqual(lights.stats, {declared: false, tiles: 0, lamps: 0, mapped: 0, estimated: 0});
  lights.dispose();
  for (const listeners of map.listeners.values()) assert.equal(listeners.size, 0);
});

test('compiled opt-in mounts at night and metadata removal switches the runtime off', () => {
  const compiled = createStyle(
    extendStreets({
      modules: {poi: disable(), roads: roads({streetLights: {enabled: true}})},
    }),
  );
  const metadata = {...compiled.metadata};
  const map = fakeMap(metadata);
  const controller = {getSun: () => ({brightness: 0}) as never};
  const lights = createTileflowStreetLights({map, controller});
  assert.equal(lights.on, 1);
  assert.ok(map.layers.has(tileflowStreetLightsLayerId));
  assert.equal(lights.stats.declared, true);
  delete metadata[tileflowStreetLightsMetadataKey];
  for (const listener of map.listeners.get('styledata') ?? []) listener();
  assert.equal(lights.on, 0);
  assert.equal(map.layers.size, 0);
  lights.dispose();

  const overriddenMap = fakeMap({...compiled.metadata});
  const overridden = createTileflowStreetLights({map: overriddenMap, controller, enabled: false});
  assert.equal(overridden.on, 0);
  assert.equal(overriddenMap.layers.size, 0);
  overridden.dispose();
});

test('street light options are validated', () => {
  assert.throws(() => createTileflowStreetLights({map: fakeMap(), minzoom: -1}), RangeError);
  assert.throws(() => createTileflowStreetLights({map: fakeMap(), maxTiles: 65}), RangeError);
});

test('the street lights design is read only in a known version and shape', () => {
  const described = {
    version: 1,
    source: 'tileflow',
    layers: {streetFurniture: 'street_furniture', transportation: 'transportation'},
    estimate: 'everywhere',
    color: 'not a colour',
    intensity: 1.5,
  };
  const read = readTileflowStreetLights({[tileflowStreetLightsMetadataKey]: described})!;
  assert.equal(read.estimate, 'lit');
  assert.equal(read.color, '#ffcf8f');
  assert.equal(read.intensity, 1.5);
  assert.equal(read.layers.sidewalk, undefined);
  assert.equal(
    readTileflowStreetLights({[tileflowStreetLightsMetadataKey]: {...described, version: 2}}),
    undefined,
  );
});
