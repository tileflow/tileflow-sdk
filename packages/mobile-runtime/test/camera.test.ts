import assert from 'node:assert/strict';
import test from 'node:test';
import {type CameraMap, createCameraController, cubicBezier, normalizeBounds} from '../src/camera';
import {moveCameraSchema} from '../src/camera-contract';
import {ProtocolError} from '../src/errors';
import {cameraReason} from '../src/events';

type Listener = (event: Record<string, unknown>) => void;
type Pose = {lng: number; lat: number; zoom: number; bearing: number; pitch: number};

/**
 * A map with MapLibre's movement semantics: a new movement or `stop()` ends the animation in
 * progress, which then fires `moveend` with that animation's event data.
 */
function fakeMap() {
  const listeners = new Map<string, Set<Listener>>();
  const pose: Pose = {lng: -3.7, lat: 40.42, zoom: 13, bearing: 0, pitch: 0};
  let animation:
    | {target: Partial<Pose>; easing: (t: number) => number; data: Record<string, unknown>}
    | undefined;
  let gesture = false;
  const paddings: unknown[] = [];
  const corner = {style: {} as Record<string, string>};
  const fire = (name: string, data: Record<string, unknown> = {}) => {
    for (const listener of listeners.get(name) ?? []) listener({type: name, ...data});
  };
  const pick = (options: Record<string, unknown>): Partial<Pose> => {
    const center = options.center as [number, number] | undefined;
    return {
      ...(center ? {lng: center[0], lat: center[1]} : {}),
      ...(options.zoom === undefined ? {} : {zoom: options.zoom as number}),
      ...(options.bearing === undefined ? {} : {bearing: options.bearing as number}),
      ...(options.pitch === undefined ? {} : {pitch: options.pitch as number}),
    };
  };
  const stop = () => {
    const ending = animation;
    animation = undefined;
    if (ending) fire('moveend', ending.data);
  };
  const jump = (options: Record<string, unknown>, data: Record<string, unknown> = {}) => {
    stop();
    fire('movestart', data);
    Object.assign(pose, pick(options));
    fire('move', data);
    fire('moveend', data);
  };
  const animate = (options: Record<string, unknown>, data: Record<string, unknown> = {}) => {
    stop();
    if (options.duration === 0) return jump(options, data);
    fire('movestart', data);
    animation = {target: pick(options), easing: options.easing as (t: number) => number, data};
  };
  const map = {
    on: (name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    jumpTo: jump,
    easeTo: animate,
    flyTo: animate,
    stop,
    getCenter: () => ({lng: pose.lng, lat: pose.lat, wrap: () => ({lng: pose.lng, lat: pose.lat})}),
    getZoom: () => pose.zoom,
    getBearing: () => pose.bearing,
    getPitch: () => pose.pitch,
    getBounds: () => ({getWest: () => 170, getSouth: -10, getEast: () => 190, getNorth: () => 10}),
    // Padding that covers the view leaves no room to fit anything.
    cameraForBounds: (
      bounds: [[number, number], [number, number]],
      options: {padding: {top?: number}},
    ) =>
      (options.padding.top ?? 0) >= 5000
        ? undefined
        : {
            center: {
              lng: (bounds[0][0] + bounds[1][0]) / 2,
              lat: (bounds[0][1] + bounds[1][1]) / 2,
            },
            zoom: 12,
            bearing: 0,
          },
    setPadding: (padding: unknown, data: Record<string, unknown>) => {
      paddings.push(padding);
      jump({}, data);
    },
    isMoving: () => animation !== undefined || gesture,
    setMinZoom: () => map,
    setMaxZoom: () => map,
    setMinPitch: () => map,
    setMaxPitch: () => map,
    setMaxBounds: () => map,
    getContainer: () => ({querySelector: () => corner}),
    addControl: () => map,
    removeControl: () => map,
  };
  return {
    map: map as unknown as CameraMap,
    pose,
    paddings,
    corner,
    /** Runs the animation in progress to `t`, ending it at 1. */
    frame(t: number) {
      if (!animation) return;
      animation.easing(t);
      if (t >= 1) {
        Object.assign(pose, animation.target);
        stop();
      } else fire('move', animation.data);
    },
    /** A person takes over: MapLibre stops the animation and moves the camera itself. */
    grab() {
      gesture = true;
      stop();
      fire('movestart', {originalEvent: {}});
      fire('move', {originalEvent: {}});
    },
    release() {
      gesture = false;
      fire('moveend', {originalEvent: {}});
    },
  };
}

function controller() {
  const fake = fakeMap();
  const events: [string, Record<string, unknown>][] = [];
  const camera = createCameraController(fake.map, {
    emit: (event, produce) => events.push([event, produce() as Record<string, unknown>]),
    wants: () => true,
    frame: (callback) => {
      callback();
      return 1;
    },
    cancelFrame: () => {},
  });
  return {...fake, camera, events};
}

const move = (value: unknown) => moveCameraSchema.parse(value);
const target = (zoom: number) => ({center: {longitude: -3.69, latitude: 40.43}, zoom});

test('a jump finishes at once and an animation when it reaches its target', async () => {
  const {camera, events, frame} = controller();
  const jumped = await camera.move(
    move({target: target(14), animation: {type: 'jump'}}),
    new AbortController().signal,
  );
  assert.equal(jumped.completion, 'finished');
  assert.equal(jumped.camera.zoom, 14);
  const easing = camera.move(
    move({target: target(15), animation: {type: 'ease', duration: 500}}),
    new AbortController().signal,
  );
  frame(0.5);
  frame(1);
  const eased = await easing;
  assert.equal(eased.completion, 'finished');
  assert.equal(eased.camera.zoom, 15);
  assert.deepEqual(
    [...new Set(events.map(([, result]) => result.reason))],
    ['api'],
    'every movement the application asked for has the api reason',
  );
});

test('a later movement or stop cancels a movement and a gesture interrupts it', async () => {
  const {camera, frame, grab, release, events} = controller();
  const signal = new AbortController().signal;
  const first = camera.move(move({target: target(16), animation: {type: 'fly'}}), signal);
  frame(0.2);
  const second = camera.move(
    move({target: target(12), animation: {type: 'ease', duration: 300}}),
    signal,
  );
  assert.equal((await first).completion, 'cancelled');
  camera.stop();
  assert.equal((await second).completion, 'cancelled');

  const third = camera.move(
    move({target: target(15), animation: {type: 'ease', duration: 300}}),
    signal,
  );
  frame(0.3);
  events.length = 0;
  grab();
  assert.equal((await third).completion, 'interrupted');
  release();
  assert.equal(events.at(-1)?.[0], 'cameraMoveEnded');
  assert.equal(events.at(-1)?.[1].reason, 'gesture');
});

test('cancelling the request stops the movement', async () => {
  const {camera, frame, pose} = controller();
  const abort = new AbortController();
  const moving = camera.move(
    move({target: target(18), animation: {type: 'ease', duration: 300}}),
    abort.signal,
  );
  frame(0.1);
  abort.abort();
  const result = await moving;
  assert.equal(result.completion, 'cancelled');
  assert.equal(pose.zoom, 13);
});

test('fitting bounds moves to the camera that frames them, or fails without moving', async () => {
  const {camera} = controller();
  const bounds = {west: 170, south: -10, east: -170, north: 10};
  const fitted = camera.cameraForBounds({bounds});
  assert.equal(fitted?.longitude, 180, 'bounds crossing the antimeridian are fitted across it');
  const result = await camera.move(
    move({fit: {bounds, pitch: 40}, animation: {type: 'jump'}}),
    new AbortController().signal,
  );
  assert.equal(result.camera.pitch, 40);
  assert.throws(
    () =>
      camera.move(
        move({
          fit: {bounds, padding: {top: 5000, left: 0, bottom: 0, right: 0}},
          animation: {type: 'jump'},
        }),
        new AbortController().signal,
      ),
    (error) => error instanceof ProtocolError && error.code === 'invalidRequest',
  );
  assert.throws(() => move({target: target(3), fit: {bounds}, animation: {type: 'jump'}}));
});

test('insets wait for a movement in progress, then centre the camera on the rest of the view', async () => {
  const {camera, frame, paddings, corner} = controller();
  const moving = camera.move(
    move({target: target(15), animation: {type: 'ease', duration: 300}}),
    new AbortController().signal,
  );
  camera.setInsets({top: 20, left: 0, bottom: 300, right: 0});
  assert.deepEqual(paddings, [], 'changing the padding would stop the movement');
  assert.equal(corner.style.bottom, '300px', 'the attribution moves out of the covered edge');
  frame(1);
  assert.equal((await moving).completion, 'finished');
  await Promise.resolve();
  assert.deepEqual(paddings, [{top: 20, left: 0, bottom: 300, right: 0}]);
});

test('easing curves and bounds helpers', () => {
  const linear = cubicBezier([0, 0, 1, 1]);
  const standard = cubicBezier([0.25, 0.1, 0.25, 1]);
  for (const x of [0, 0.25, 0.5, 1]) assert.ok(Math.abs(linear(x) - x) < 1e-5);
  assert.ok(standard(0.5) > 0.75 && standard(0.5) < 0.85);
  assert.equal(standard(1), 1);
  assert.deepEqual(normalizeBounds(170, -10, 190, 10), {
    west: 170,
    south: -10,
    east: -170,
    north: 10,
  });
  assert.deepEqual(normalizeBounds(-200, -10, 200, 10), {
    west: -180,
    south: -10,
    east: 180,
    north: 10,
  });
  assert.deepEqual(normalizeBounds(-370, -10, -350, 10), {
    west: -10,
    south: -10,
    east: 10,
    north: 10,
  });
  assert.equal(cameraReason({tileflowReason: 'gesture'}), 'gesture');
});
