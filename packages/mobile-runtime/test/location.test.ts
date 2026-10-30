import assert from 'node:assert/strict';
import test from 'node:test';
import {cameraReason} from '../src/events';
import {
  accuracyRadiusAtZoom0,
  bearingImage,
  createLocationController,
  interpolateAngle,
  interpolateFix,
  interpolatePosition,
  isLocationFrame,
  locationLayers,
  type LocationMap,
  locationSource,
  maximumGlideMs,
  shortestTurn,
} from '../src/location';
import {
  followRequestSchema,
  locationOptionsSchema,
  locationUpdateSchema,
} from '../src/location-contract';

type Feature = {geometry: {coordinates: [number, number]}; properties: Record<string, unknown>};
type Listener = () => void;

/** A map that records the puck's style, data and the camera frames that follow it. */
function fakeMap() {
  const listeners = new Map<string, Set<Listener>>();
  const dom = new Map<string, Set<Listener>>();
  const layers: string[] = ['background', 'roads'];
  const sources = new Map<string, {data: unknown; setData(data: unknown): void}>();
  const images = new Set<string>();
  const camera = {lng: 0, lat: 0, zoom: 3, bearing: 0, pitch: 0};
  const jumps: {target: Record<string, unknown>; data: unknown}[] = [];
  let styleLoaded = true;
  const map = {
    on: (name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off: (name: string, listener: Listener) => listeners.get(name)?.delete(listener),
    jumpTo: (target: Record<string, unknown>, data: unknown) => {
      jumps.push({target, data});
      const center = target.center as [number, number] | undefined;
      if (center) [camera.lng, camera.lat] = center;
      for (const key of ['zoom', 'bearing', 'pitch'] as const)
        if (typeof target[key] === 'number') camera[key] = target[key] as number;
    },
    getCenter: () => ({wrap: () => ({lng: camera.lng, lat: camera.lat})}),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    isStyleLoaded: () => styleLoaded,
    addSource: (id: string, spec: {data: unknown}) => {
      const source = {
        data: spec.data,
        setData(data: unknown) {
          source.data = data;
        },
      };
      sources.set(id, source);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: {id: string}) => layers.push(spec.id),
    getLayer: (id: string) => (layers.includes(id) ? {id} : undefined),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    moveLayer: (id: string) => {
      layers.splice(layers.indexOf(id), 1);
      layers.push(id);
    },
    getLayersOrder: () => [...layers],
    addImage: (id: string) => images.add(id),
    hasImage: (id: string) => images.has(id),
    getCanvasContainer: () => ({
      addEventListener: (name: string, listener: Listener) => {
        if (!dom.has(name)) dom.set(name, new Set());
        dom.get(name)!.add(listener);
      },
      removeEventListener: (name: string, listener: Listener) => dom.get(name)?.delete(listener),
    }),
  };
  return {
    map: map as unknown as LocationMap,
    layers,
    sources,
    images,
    camera,
    jumps,
    fire: (name: string) => {
      for (const listener of listeners.get(name) ?? []) listener();
    },
    input: (name: string) => {
      for (const listener of dom.get(name) ?? []) listener();
    },
    /** A theme replaces the style, and everything the application added with it. */
    replaceStyle() {
      layers.splice(0, layers.length, 'background', 'water');
      sources.clear();
      images.clear();
      styleLoaded = true;
    },
  };
}

/** A location controller on a fake map, with a clock and frames the test advances. */
function harness() {
  const fake = fakeMap();
  let now = 1000;
  const timers: {at: number; run: () => void; cancelled: boolean}[] = [];
  let frames: (() => void)[] = [];
  const events: {event: string; result: unknown}[] = [];
  const motion: boolean[] = [];
  const location = createLocationController(fake.map, {
    emit: (event, produce) => events.push({event, result: produce()}),
    motion: (moving) => motion.push(moving),
    clock: {
      now: () => now,
      schedule: (run, delay) => {
        const timer = {at: now + delay, run, cancelled: false};
        timers.push(timer);
        return timer;
      },
      cancel: (timer) => void ((timer as {cancelled: boolean}).cancelled = true),
    },
    frame: (callback) => {
      frames.push(callback);
      return callback;
    },
    cancelFrame: (handle) => {
      frames = frames.filter((frame) => frame !== handle);
    },
    bearingImage: () => ({width: 2, height: 2, data: new Uint8ClampedArray(16)}),
  });
  return {
    ...fake,
    location,
    events,
    motion,
    /** Moves the clock, runs due timers, then renders one frame. */
    advance(ms: number) {
      now += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= now) timer.run();
        else timers.push(timer);
      }
      const due = frames;
      frames = [];
      for (const frame of due) frame();
    },
    get pendingFrames() {
      return frames.length;
    },
    feature(): Feature | undefined {
      const data = fake.sources.get(locationSource)?.data as {features: Feature[]} | undefined;
      return data?.features[0];
    },
  };
}

const options = (overrides: Record<string, unknown> = {}) =>
  locationOptionsSchema.parse({enabled: true, ...overrides});
const fix = (longitude: number, latitude: number, extra: Record<string, unknown> = {}) =>
  locationUpdateSchema.parse({location: {longitude, latitude, ...extra}});

test('angles and positions glide along the shorter way, across north and the antimeridian', () => {
  assert.equal(shortestTurn(350, 10), 20);
  assert.equal(shortestTurn(10, 350), -20);
  assert.equal(shortestTurn(0, 180), 180);
  assert.equal(interpolateAngle(350, 10, 0.5), 0);
  assert.equal(interpolateAngle(90, 270, 0), 90);
  const across = interpolatePosition(
    {longitude: 179, latitude: 0},
    {longitude: -179, latitude: 0},
    0.5,
  );
  assert.equal(Math.abs(across.longitude), 180);
  assert.ok(Math.abs(across.latitude) < 1e-9);
  // Latitude glides in the map’s projection, so the puck moves evenly on the screen.
  const north = interpolatePosition({longitude: 0, latitude: 0}, {longitude: 0, latitude: 60}, 0.5);
  assert.ok(north.latitude > 35 && north.latitude < 36);
  const shown = interpolateFix(
    {longitude: 0, latitude: 0, accuracy: 10, course: 350},
    {longitude: 2, latitude: 0, accuracy: 30, course: 30},
    0.5,
  );
  assert.equal(shown.longitude, 1);
  assert.equal(shown.accuracy, 20);
  assert.equal(shown.course, 10);
  // A field the earlier fix lacks takes the later fix's value at once.
  assert.equal(
    interpolateFix({longitude: 0, latitude: 0}, {longitude: 0, latitude: 0, course: 90}, 0.1)
      .course,
    90,
  );
});

test('the accuracy radius converts metres to pixels at the fix latitude', () => {
  // 40,075 km over 512 pixels at zoom 0: 78,271.5 m per pixel on the equator.
  assert.ok(Math.abs(accuracyRadiusAtZoom0(78_271.517, 0) - 1) < 1e-6);
  // At 60° a pixel spans half the distance, so the same radius is twice as wide.
  assert.ok(Math.abs(accuracyRadiusAtZoom0(78_271.517, 60) - 2) < 1e-6);
});

test('the request contracts bound what a host can send', () => {
  assert.deepEqual(locationOptionsSchema.parse({}), {
    enabled: false,
    bearing: 'none',
    accuracy: true,
    staleAfterMs: 30_000,
  });
  assert.equal(fix(-3.7, 40.4).location?.age, 0);
  assert.equal(
    locationUpdateSchema.safeParse({location: {longitude: 200, latitude: 0}}).success,
    false,
  );
  assert.equal(locationUpdateSchema.safeParse({heading: {direction: 400}}).success, false);
  assert.equal(followRequestSchema.safeParse({mode: 'compass'}).success, false);
  assert.equal(followRequestSchema.parse({mode: 'course'}).duration, 0);
  assert.equal(cameraReason({tileflowReason: 'location', tileflowLocation: true}), 'location');
  assert.ok(isLocationFrame({tileflowLocation: true}));
});

test('the puck layer draws above the map, glides between fixes and survives a style change', () => {
  const run = harness();
  run.location.setOptions(options({bearing: 'course'}));
  // Nothing is drawn before the first fix, but the layers are ready on top of the style.
  assert.deepEqual(run.layers.slice(-3), [...locationLayers]);
  assert.ok(run.images.has(bearingImage));
  assert.equal(run.feature(), undefined);

  run.location.update(fix(0, 0, {accuracy: 10, course: 90}));
  assert.deepEqual(run.feature()?.geometry.coordinates, [0, 0]);
  assert.equal(run.feature()?.properties.bearing, 90);
  assert.ok((run.feature()?.properties.radius as number) > 0);

  // The next fix glides from what is shown for as long as the provider took to send it.
  run.advance(500);
  run.location.update(fix(0.001, 0, {accuracy: 10, course: 90}));
  run.advance(250);
  const halfway = run.feature()!.geometry.coordinates[0];
  assert.ok(halfway > 0.0004 && halfway < 0.0006, `glided to ${halfway}`);
  run.advance(250);
  assert.equal(run.feature()!.geometry.coordinates[0], 0.001);
  run.advance(16);
  assert.equal(run.pendingFrames, 0, 'frames stop once the puck settles');

  // A provider that is slower than the longest glide is followed that fast.
  run.advance(5000);
  run.location.update(fix(0.002, 0));
  run.advance(maximumGlideMs);
  assert.equal(run.feature()!.geometry.coordinates[0], 0.002);
  assert.equal(run.feature()!.properties.bearing, undefined, 'no course, no indicator');

  // Application layers added later stay below the puck.
  run.layers.push('application');
  run.fire('idle');
  assert.deepEqual(run.layers.slice(-3), [...locationLayers]);

  // A theme replaces the style; the puck returns with its last position.
  run.replaceStyle();
  run.fire('style.load');
  assert.deepEqual(run.layers.slice(-3), [...locationLayers]);
  assert.deepEqual(run.feature()?.geometry.coordinates, [0.002, 0]);

  // Without accuracy the circle has no radius; disabling removes the puck.
  run.location.setOptions(options({accuracy: false}));
  assert.equal(run.feature()!.properties.radius, 0);
  run.location.setOptions(options({enabled: false}));
  assert.equal(run.sources.has(locationSource), false);
  assert.ok(locationLayers.every((id) => !run.layers.includes(id)));
});

test('a fix older than the limit is drawn as stale until a newer fix arrives', () => {
  const run = harness();
  run.location.setOptions(options({staleAfterMs: 2000}));
  run.location.update(fix(1, 1, {age: 500}));
  assert.equal(run.feature()!.properties.stale, false);
  run.advance(1499);
  assert.equal(run.feature()!.properties.stale, false);
  run.advance(1);
  assert.equal(run.feature()!.properties.stale, true);
  run.location.update(fix(1, 1));
  assert.equal(run.feature()!.properties.stale, false);
  // A fix that arrives already too old is stale at once.
  run.location.update(fix(1, 1, {age: 5000}));
  assert.equal(run.feature()!.properties.stale, true);
  // Clearing the location hides the puck.
  run.location.update({location: null});
  assert.equal(run.feature(), undefined);
});

test('the heading turns the indicator the shorter way', () => {
  const run = harness();
  run.location.setOptions(options({bearing: 'heading'}));
  run.location.update({...fix(0, 0), heading: {direction: 350}});
  assert.equal(run.feature()!.properties.bearing, 350);
  run.location.update({heading: {direction: 10}});
  run.advance(125);
  assert.ok(Math.abs((run.feature()!.properties.bearing as number) - 0) < 1e-9);
  run.advance(125);
  assert.equal(run.feature()!.properties.bearing, 10);
});

test('following moves the camera with the puck and reports one movement per glide', () => {
  const run = harness();
  run.location.setOptions(options());
  // Following waits for the first fix, then zooms in to at least the requested level.
  run.location.follow(
    followRequestSchema.parse({mode: 'position', minimumZoom: 15, duration: 400}),
  );
  assert.equal(run.jumps.length, 0);
  run.location.update(fix(-3.7, 40.42));
  run.advance(200);
  assert.ok(run.camera.zoom > 3 && run.camera.zoom < 15);
  assert.ok(run.jumps.every((jump) => isLocationFrame(jump.data)));
  run.advance(200);
  assert.equal(run.camera.zoom, 15);
  assert.deepEqual([run.camera.lng, run.camera.lat], [-3.7, 40.42]);
  run.advance(16);
  assert.deepEqual(run.motion, [true, false]);

  // Each glide is one movement; the camera stays centred on the puck.
  run.advance(1000);
  run.location.update(fix(-3.699, 40.42));
  run.advance(500);
  assert.ok(run.camera.lng > -3.7 && run.camera.lng < -3.699);
  run.advance(500);
  run.advance(16);
  assert.equal(run.camera.lng, -3.699);
  assert.deepEqual(run.motion, [true, false, true, false]);
  assert.equal(run.camera.zoom, 15, 'following keeps the zoom a person chose');

  // The heading mode turns the camera with the device; the course mode with the travel.
  run.location.update({heading: {direction: 90}});
  run.location.follow(followRequestSchema.parse({mode: 'heading'}));
  run.advance(300);
  assert.equal(run.camera.bearing, 90);
  run.location.update(fix(-3.699, 40.421, {course: 0}));
  run.location.follow(followRequestSchema.parse({mode: 'course', duration: 0}));
  run.advance(1000);
  assert.equal(run.camera.bearing, 0);
  // The position mode can turn to a bearing, for example north, as it starts.
  run.location.update({heading: {direction: 180}});
  run.location.follow(followRequestSchema.parse({mode: 'position', bearing: 0, duration: 200}));
  run.advance(250);
  assert.equal(run.camera.bearing, 0);
  assert.deepEqual(run.events, [], 'the host’s own requests are not reported back');
});

test('a gesture ends following; a finger at rest holds the camera until it lifts', () => {
  const run = harness();
  run.location.setOptions(options());
  run.location.update(fix(10, 10));
  run.location.follow(followRequestSchema.parse({mode: 'position', revision: 4}));
  run.advance(16);
  assert.equal(run.location.mode, 'position');

  // A finger rests on the map: the puck glides, the camera waits for the gesture to start.
  run.input('pointerdown');
  const jumps = run.jumps.length;
  run.advance(500);
  run.location.update(fix(10.001, 10));
  run.advance(1000);
  assert.equal(run.jumps.length, jumps);
  assert.equal(run.feature()!.geometry.coordinates[0], 10.001);
  // A tap lifts the finger without a gesture: following resumes.
  run.input('pointerup');
  run.advance(16);
  assert.equal(run.camera.lng, 10.001);
  assert.equal(run.location.mode, 'position');

  // The gesture that starts moving the camera ends following and reports it.
  run.location.stopFollowing('gesture');
  assert.equal(run.location.mode, 'none');
  assert.deepEqual(run.events, [
    {event: 'followModeChanged', result: {mode: 'none', reason: 'gesture', revision: 4}},
  ]);
  run.location.update(fix(10.002, 10));
  run.advance(1000);
  assert.equal(run.camera.lng, 10.001, 'the camera no longer follows');
  // Ending following again reports nothing; a wheel is a gesture too.
  run.location.stopFollowing('api');
  run.location.follow(followRequestSchema.parse({mode: 'course'}));
  run.input('wheel');
  assert.equal(run.events.length, 2);
  assert.equal(run.location.mode, 'none');
});

test('a disposed controller draws and follows nothing more', () => {
  const run = harness();
  run.location.setOptions(options());
  run.location.update(fix(1, 1));
  run.location.follow(followRequestSchema.parse({mode: 'position'}));
  run.location.dispose();
  const jumps = run.jumps.length;
  run.advance(1000);
  assert.equal(run.jumps.length, jumps);
  assert.equal(run.pendingFrames, 0);
});
