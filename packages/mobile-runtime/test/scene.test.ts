import assert from 'node:assert/strict';
import test from 'node:test';
import type {DataReference} from '../src/data';
import {ProtocolError} from '../src/protocol';
import {boundaryRows, createMapScene, type DecodedImage, emphasisArea} from '../src/scene';

const reference = (name: string, byteLength = 10): DataReference => ({
  id: `${name}`.padEnd(22, 'A'),
  byteLength,
  sha256: Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64),
});
const never = new AbortController().signal;
const inks = {
  line: '#2563eb',
  casing: '#1e3a8a',
  core: '#dbeafe',
  glow: '#2563eb',
  alternative: '#94a3b8',
  glowOpacity: 0.16,
  coreOpacity: 0,
};

function fixture(payloads: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const reads: string[] = [];
  const decodes: string[] = [];
  const images = new Map<string, {render: (context: {theme: string}) => unknown}>();
  const markers = new Map<number, Record<string, unknown>>();
  let markerSequence = 0;
  const boundaries: {options: unknown; values: unknown[]; disposed: boolean}[] = [];
  let result: {status: 'applied' | 'failed'; error?: Error} = {status: 'applied'};
  let inksChanged = 0;
  const scene = createMapScene({
    themes: {
      getRouteInks: () => inks,
      registerImage: (name, image) => {
        calls.push(['registerImage', name, image.width, image.height, image.pixelRatio]);
        images.set(name, image as never);
        return {refresh() {}, dispose: () => void images.delete(name)};
      },
      setSun: async (sun, options) => (calls.push(['setSun', sun, options]), result),
      setEmphasis: async (emphasis, options) => (
        calls.push(['setEmphasis', emphasis, options]),
        result
      ),
      setState: async (name, value, options) => (
        calls.push(['setState', name, value, options]),
        result
      ),
    },
    attachment: {
      setViewMode: (...args) => void calls.push(['setViewMode', ...args]),
      setVegetation: (visible) => void calls.push(['setVegetation', visible]),
    },
    read: async (data) => {
      reads.push(data.id);
      const value = payloads[data.id];
      return new Uint8Array(
        Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
      ) as Uint8Array<ArrayBuffer>;
    },
    decode: async (bytes): Promise<DecodedImage> => {
      const text = Buffer.from(bytes).toString();
      decodes.push(text);
      if (text === 'broken') throw new Error('not an image');
      const [width, height] = text.split('x').map(Number) as [number, number];
      return {width, height, pixels: new Uint8ClampedArray([width]), texture: {text} as never};
    },
    boundaries: (options) => {
      const record = {options, values: [] as unknown[], disposed: false};
      boundaries.push(record);
      return {
        set: (values) => {
          if (values.joinBy === 'ref') throw new Error('Boundaries feature-state is keyed by id.');
          record.values.push(values);
        },
        clear() {},
        dispose: () => void (record.disposed = true),
      };
    },
    depthMarkers: () => ({
      add: (marker) => {
        const id = ++markerSequence;
        markers.set(id, {...marker});
        return {
          update: (change) => void markers.set(id, {...markers.get(id), ...change}),
          remove: () => void markers.delete(id),
        };
      },
      dispose: () => markers.clear(),
    }),
    inksChanged: () => void (inksChanged += 1),
  });
  return {
    scene,
    calls,
    reads,
    decodes,
    images,
    markers,
    boundaries,
    fail: (error: Error) => void (result = {status: 'failed', error}),
    inksChanged: () => inksChanged,
  };
}

const refusal = async (promise: Promise<unknown> | (() => unknown), reason?: string) => {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    assert.ok(error instanceof ProtocolError, String(error));
    assert.equal(error.code, 'invalidRequest');
    if (reason) assert.equal(error.context?.reason, reason);
    return;
  }
  assert.fail('The request was accepted.');
};

test('a view mode change with a duration makes the buildings rise; without one it is immediate', () => {
  const {scene, calls} = fixture();
  scene.setViewMode({viewMode: '3d', duration: 800});
  scene.setViewMode({viewMode: '2d', duration: 0});
  scene.setVegetation(null);
  assert.deepEqual(calls, [
    ['setViewMode', '3d', {transition: {duration: 800, mode: 'grow'}}],
    ['setViewMode', '2d', undefined],
    ['setVegetation', undefined],
  ]);
});

test('the sun goes to Core by direction, by date and place, or back to the themes', async () => {
  const {scene, calls, fail} = fixture();
  await scene.setSun({sun: {azimuth: 120, altitude: 25}, duration: 450});
  await scene.setSun({
    sun: {date: 1_700_000_000_000, location: {longitude: 2, latitude: 41}},
    duration: 0,
  });
  await scene.setSun({sun: {date: 1_700_000_000_000}, duration: 0});
  await scene.setSun({sun: null, duration: 0});
  assert.deepEqual(
    calls.map((call) => call[1]),
    [
      {azimuth: 120, altitude: 25},
      {date: 1_700_000_000_000, location: [2, 41]},
      {date: 1_700_000_000_000},
      undefined,
    ],
  );
  assert.deepEqual(calls[0]![2], {transition: {duration: 450}});
  fail(new TypeError('A sun altitude must be a number of degrees from -90 to 90.'));
  await refusal(scene.setSun({sun: {azimuth: 0, altitude: 0}, duration: 0}));
  fail(new Error('The map was removed.'));
  await assert.rejects(scene.setSun({sun: null, duration: 0}), {code: 'rendererFailed'});
});

test('an emphasis keep area arrives on the data channel and must be a polygon', async () => {
  const square = [
    [
      [2, 41],
      [2.1, 41],
      [2.1, 41.1],
      [2, 41],
    ],
  ];
  const {scene, calls, reads} = fixture({
    [reference('area').id]: {type: 'Polygon', coordinates: square},
    [reference('line').id]: {type: 'LineString', coordinates: square[0]},
  });
  await scene.setEmphasis(
    {emphasis: {recede: {roads: 0.6}, labels: 0.3, keep: reference('area')}, duration: 300},
    never,
  );
  assert.deepEqual(calls[0]![1], {
    recede: {roads: 0.6},
    labels: 0.3,
    keep: {type: 'Polygon', coordinates: square},
  });
  await scene.setEmphasis({emphasis: null, duration: 0}, never);
  assert.equal(calls[1]![1], undefined);
  await refusal(scene.setEmphasis({emphasis: {keep: reference('line')}, duration: 0}, never));
  assert.equal(reads.length, 2);
  assert.equal(emphasisArea({type: 'MultiPolygon', coordinates: [square]})?.type, 'MultiPolygon');
  assert.equal(
    emphasisArea({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    }),
    undefined,
  );
  assert.equal(
    emphasisArea({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 95],
          [0, 0],
        ],
      ],
    }),
    undefined,
  );
});

test('a style state reaches Core and the layers drawn in route inks follow it', async () => {
  const {scene, calls, inksChanged} = fixture();
  assert.deepEqual(await scene.setStyleState({name: 'traffic', value: 0.5, duration: 250}), {
    status: 'applied',
  });
  assert.deepEqual(calls[0], ['setState', 'traffic', 0.5, {transition: {duration: 250}}]);
  assert.equal(inksChanged(), 1);
  assert.deepEqual(scene.routeInks(), inks);
});

test('Boundaries rows are parsed from the data channel and replace the previous values', async () => {
  const rows = reference('rows');
  const refs = reference('refs');
  const bad = reference('bad');
  const {scene, boundaries} = fixture({
    [rows.id]: [
      [1, 4.5],
      [2, 'high'],
      [3, null],
    ],
    [refs.id]: [['ES-MD', 1]],
    [bad.id]: [[-1, 2]],
  });
  await scene.setBoundaryValues(
    {values: {joinBy: 'id', rows}, family: 'boundaries', labels: false, state: 'value'},
    never,
  );
  await scene.setBoundaryValues(
    {values: {joinBy: 'id', rows}, family: 'boundaries', labels: false, state: 'value'},
    never,
  );
  assert.equal(boundaries.length, 1, 'the same options keep their controller');
  assert.deepEqual(boundaries[0]!.values[0], {
    joinBy: 'id',
    rows: [
      {key: 1, value: 4.5},
      {key: 2, value: 'high'},
      {key: 3, value: null},
    ],
  });
  await scene.setBoundaryValues(
    {values: {joinBy: 'id', rows}, family: 'boundaries', labels: true, state: 'share'},
    never,
  );
  assert.equal(boundaries[0]!.disposed, true);
  assert.deepEqual(boundaries[1]!.options, {family: 'boundaries', labels: true, state: 'share'});
  await refusal(
    scene.setBoundaryValues(
      {values: {joinBy: 'id', rows: bad}, family: 'boundaries', labels: true, state: 'share'},
      never,
    ),
  );
  // The map promotes no `ref`: Core refuses the rows and the request fails as the caller's.
  await refusal(
    scene.setBoundaryValues(
      {values: {joinBy: 'ref', rows: refs}, family: 'boundaries', labels: true, state: 'share'},
      never,
    ),
  );
  await scene.setBoundaryValues(
    {values: null, family: 'boundaries', labels: false, state: 'value'},
    never,
  );
  assert.equal(boundaries[1]!.disposed, true);
  assert.deepEqual(boundaryRows([['a', 1]], 'ref'), [{key: 'a', value: 1}]);
  assert.equal(boundaryRows([['a', 1]], 'id'), undefined);
  assert.equal(boundaryRows([[1, {nested: true}]], 'id'), undefined);
});

test('application images register once, follow the theme and refuse mismatched variants', async () => {
  const pin = reference('pin');
  const dark = reference('dark');
  const small = reference('small');
  const broken = reference('broken');
  const {scene, calls, decodes, images, markers} = fixture({
    [pin.id]: '24x32',
    [dark.id]: '24x32',
    [small.id]: '8x8',
    [broken.id]: 'broken',
  });
  await scene.setImages(
    {images: [{name: 'pin', data: pin, pixelRatio: 2, variants: {dark}}]},
    never,
  );
  assert.deepEqual(calls, [['registerImage', 'pin', 24, 32, 2]]);
  const render = images.get('pin')!.render;
  assert.notEqual(render({theme: 'light'}), render({theme: 'dark'}));
  scene.setDepthMarkers({
    markers: [
      {
        id: 'cafe',
        coordinate: {longitude: 2, latitude: 41},
        image: 'pin',
        size: [24, 32],
        alignment: 'screen',
        anchor: 'bottom',
        rotation: 0,
        altitude: 0,
        opacity: 1,
        occlude: true,
      },
    ],
  });
  assert.equal(markers.size, 1);
  // The same images again are neither read, decoded nor registered.
  await scene.setImages(
    {images: [{name: 'pin', data: pin, pixelRatio: 2, variants: {dark}}]},
    never,
  );
  assert.equal(decodes.length, 2);
  assert.equal(calls.length, 1);
  await refusal(
    scene.setImages(
      {images: [{name: 'pin', data: pin, pixelRatio: 2, variants: {dark: small}}]},
      never,
    ),
    'invalidImage',
  );
  await refusal(
    scene.setImages({images: [{name: 'other', data: broken, pixelRatio: 1}]}, never),
    'invalidImage',
  );
  assert.ok(images.has('pin'), 'a refused request leaves the images as they were');
  await scene.setImages({images: []}, never);
  assert.equal(images.size, 0);
  assert.equal(markers.size, 0, 'markers showing a removed image go with it');
});

test('depth markers are reconciled by id and must name an image the map holds', async () => {
  const pin = reference('pin');
  const {scene, markers} = fixture({[pin.id]: '24x32'});
  const marker = {
    id: 'a',
    coordinate: {longitude: 2, latitude: 41},
    image: 'pin',
    size: [24, 32] as [number, number],
    alignment: 'screen' as const,
    anchor: 'center' as const,
    rotation: 0,
    altitude: 0,
    opacity: 1,
    occlude: true,
  };
  await refusal(() => scene.setDepthMarkers({markers: [marker]}));
  await scene.setImages({images: [{name: 'pin', data: pin, pixelRatio: 1}]}, never);
  scene.setDepthMarkers({markers: [marker, {...marker, id: 'b'}]});
  assert.equal(markers.size, 2);
  scene.setDepthMarkers({markers: [{...marker, altitude: 30, opacity: 0.5}]});
  assert.equal(markers.size, 1);
  const [only] = markers.values();
  assert.equal(only!.altitude, 30);
  assert.deepEqual(only!.lngLat, [2, 41]);
  scene.dispose();
  assert.equal(markers.size, 0);
});
