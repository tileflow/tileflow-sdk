import assert from 'node:assert/strict';
import test from 'node:test';
import {contentSchema} from '../src/content-contract';
import {parseRequest, protocol} from '../src/protocol';

const data = {id: 'AAAAAAAAAAAAAAAAAAAAAA', byteLength: 120, sha256: 'a'.repeat(64)};
let sequence = 0;
const parses = (method: string, payload: unknown) => {
  try {
    parseRequest(
      JSON.stringify({
        protocolVersion: protocol.version,
        instanceId: 'view-a',
        generation: 1,
        requestId: String(++sequence),
        command: {method, payload},
      }),
    );
    return true;
  } catch {
    return false;
  }
};

test('every protocol method has a command the runtime parses', () => {
  const samples: Record<string, unknown> = {
    setViewMode: {viewMode: '3d', duration: 800},
    setSun: {sun: {azimuth: 135, altitude: 30}},
    setEmphasis: {emphasis: {recede: {roads: 0.5}, labels: 0.4, keep: data}},
    setStyleState: {name: 'traffic', value: 0.5},
    getRouteInks: null,
    setBoundaryValues: {values: {joinBy: 'id', rows: data}},
    setImages: {images: [{name: 'pin', data, variants: {dark: data}}]},
    setDepthMarkers: {
      markers: [{id: 'a', coordinate: {longitude: 2, latitude: 41}, image: 'pin', size: [24, 32]}],
    },
    animateLineProgress: {layers: ['route-line'], to: {end: 1}, duration: 60_000},
    playShot: {
      keyframes: [
        {at: 0, camera: {longitude: 2, latitude: 41, zoom: 12}},
        {at: 4000, camera: {longitude: 2.1, latitude: 41, zoom: 15, pitch: 85}},
      ],
    },
    stopAnimation: {animation: 'a1'},
  };
  for (const [method, payload] of Object.entries(samples))
    assert.equal(parses(method, payload), true, method);
  assert.ok(Object.keys(samples).every((method) => protocol.methods.includes(method as never)));
});

test('scene requests outside their contract are refused before they reach the map', () => {
  const refused: [string, unknown][] = [
    ['setViewMode', {viewMode: 'globe'}],
    ['setViewMode', {viewMode: '3d', duration: 5001}],
    ['setSun', {sun: {azimuth: 0, altitude: 91}}],
    ['setSun', {sun: {azimuth: 0}}],
    ['setSun', {sun: {date: Number.MAX_VALUE}}],
    ['setSun', {sun: {date: 0, location: {longitude: 181, latitude: 0}}}],
    // A keep area never travels inline.
    ['setEmphasis', {emphasis: {keep: {type: 'Polygon', coordinates: []}}}],
    ['setEmphasis', {emphasis: {recede: {Roads: 0.5}}}],
    ['setEmphasis', {emphasis: {labels: 2}}],
    ['setStyleState', {name: ' padded', value: 1}],
    ['setStyleState', {name: 'state', value: {nested: true}}],
    ['setStyleState', {name: 'state', value: 'x'.repeat(1025)}],
    ['setBoundaryValues', {values: {joinBy: 'iso_3166_1', rows: data}}],
    ['setBoundaryValues', {values: {joinBy: 'id', rows: [[1, 2]]}}],
    ['setBoundaryValues', {values: null, state: 'feature state'}],
    [
      'setImages',
      {
        images: [
          {name: 'pin', data},
          {name: 'pin', data},
        ],
      },
    ],
    ['setImages', {images: [{name: '../pin', data}]}],
    ['setImages', {images: [{name: 'pin', data, pixelRatio: 8}]}],
    [
      'setDepthMarkers',
      {markers: [{id: 'a', coordinate: {longitude: 2, latitude: 41}, image: 'pin', size: [24]}]},
    ],
    ['animateLineProgress', {layers: [], to: {}, duration: 0}],
    ['animateLineProgress', {layers: ['route'], to: {end: 2}, duration: 0}],
    ['animateLineProgress', {layers: ['route'], to: {}, duration: 60_001}],
    [
      'playShot',
      {
        keyframes: [
          {at: 100, camera: {longitude: 2, latitude: 41, zoom: 12}},
          {at: 400, camera: {longitude: 2, latitude: 41, zoom: 12}},
        ],
      },
    ],
    [
      'playShot',
      {
        keyframes: [
          {at: 0, camera: {longitude: 2, latitude: 41, zoom: 12}},
          {at: 0, camera: {longitude: 2, latitude: 41, zoom: 12}},
        ],
      },
    ],
    ['stopAnimation', {animation: '1'}],
  ];
  for (const [method, payload] of refused)
    assert.equal(parses(method, payload), false, `${method} ${JSON.stringify(payload)}`);
});

test('renderer options default as on the web and vegetation follows the map by default', () => {
  const initialize = parseRequest(
    JSON.stringify({
      protocolVersion: protocol.version,
      instanceId: 'view-a',
      generation: 1,
      requestId: String(++sequence),
      command: {
        method: 'initialize',
        payload: {source: {map: 'city', manifestUrl: 'https://example.com/manifest.json'}},
      },
    }),
  ).command;
  assert.equal(initialize.method, 'initialize');
  if (initialize.method !== 'initialize') return;
  assert.deepEqual(initialize.payload.renderer, {antialias: true, validateStyle: false});
  assert.equal(initialize.payload.options.vegetation, null);
});

test('only lines take progress, and only lines on the ground show through 3D content', () => {
  const overlay = {id: 'route', kind: 'line', data};
  const valid = (value: object) =>
    contentSchema.safeParse({annotations: [], overlays: [{...overlay, ...value}]}).success;
  assert.equal(valid({ink: 'line', placement: 'ground', occludedOpacity: 0.4}), true);
  assert.equal(valid({progress: {end: 0.5, light: null, highlight: '#ffffff'}}), true);
  assert.equal(valid({kind: 'fill', progress: {end: 0.5}}), false);
  assert.equal(valid({occludedOpacity: 0.4}), false, 'a line on top is never hidden');
  assert.equal(valid({kind: 'fill', placement: 'ground', occludedOpacity: 0.4}), false);
  assert.equal(valid({ink: 'halo'}), false);
  assert.equal(valid({progress: {highlight: 'white'}}), false);
});
