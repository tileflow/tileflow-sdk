import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AnnotationMap,
  type AnnotationStyle,
  createAnnotationController,
  dragSlop,
  mapPositions,
  terrainCheckMs,
  wrapNear,
} from '../src/annotations';
import {annotationLayersSchema, trackedPointsSchema} from '../src/annotations-contract';
import {protocol} from '../src/protocol';

type Listener = (event?: unknown) => void;
type Pointer = {pointerId: number; isPrimary: boolean; clientX: number; clientY: number};

/**
 * A flat map where a location projects to ten CSS pixels per degree from the top-left corner, with
 * a container that dispatches pointer events, a frame queue and a clock.
 */
function harness(options: {wanted?: boolean; hits?: ReturnType<AnnotationStyle['hitTest']>} = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const dom = new Map<string, Listener[]>();
  const frames: (() => void)[] = [];
  const events: [string, Record<string, unknown>][] = [];
  const moves: [string, string | number, unknown][] = [];
  let time = 1_000;
  let pan = true;
  const occluded = new Set<number>();
  const terrainCovered = new Set<number>();
  const geometries = new Map<string, unknown>([
    ['pin', {type: 'Point', coordinates: [2, 3]}],
    [
      'line',
      {
        type: 'LineString',
        coordinates: [
          [1, 1],
          [3, 1],
        ],
      },
    ],
  ]);
  const map: AnnotationMap & {center: number} = {
    center: 0,
    on: (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off: (name, listener) => listeners.get(name)?.delete(listener),
    project: ([lng, lat]) => ({x: (lng - map.center) * 10 + 100, y: lat * 10}),
    unproject: ([x, y]) => ({lng: (x - 100) / 10 + map.center, lat: y / 10}),
    getCenter: () => ({lng: map.center, lat: 0}),
    getCanvasContainer: () =>
      ({
        addEventListener: (type: string, listener: Listener) =>
          dom.set(type, [...(dom.get(type) ?? []), listener]),
        getBoundingClientRect: () => ({left: 0, top: 0}),
        setPointerCapture: () => undefined,
      }) as unknown as HTMLElement,
    dragPan: {
      isEnabled: () => pan,
      enable: () => (pan = true),
      disable: () => (pan = false),
    },
    transform: {
      width: 400,
      height: 400,
      isLocationOccluded: (location, terrain) =>
        terrain ? terrainCovered.has(location.lat) : occluded.has(location.lat),
      isPointOnMapSurface: (point) => point.y >= 0,
    },
  };
  const style: AnnotationStyle = {
    hitTest: () => options.hits ?? [],
    featureGeometry: (_source, id) => geometries.get(String(id)) as never,
    moveFeature: (source, id, geometry) => {
      moves.push([source, id, geometry]);
      return true;
    },
  };
  const controller = createAnnotationController(map, {
    emit: (event, produce) => events.push([event, produce() as Record<string, unknown>]),
    wants: () => options.wanted ?? true,
    style: () => style,
    now: () => time,
    frame: (callback) => frames.push(callback),
    signal: new AbortController().signal,
  });
  return {
    map,
    controller,
    events,
    moves,
    occluded,
    terrainCovered,
    pan: () => pan,
    advance: (milliseconds: number) => (time += milliseconds),
    render: () => listeners.get('render')?.forEach((listener) => listener()),
    flush: () => frames.splice(0).forEach((callback) => callback()),
    pointer: (type: string, x: number, y: number, extra: Partial<Pointer> = {}) =>
      dom
        .get(type)
        ?.forEach((listener) =>
          listener({pointerId: 1, isPrimary: true, clientX: x, clientY: y, ...extra}),
        ),
  };
}

test('requests keep their limits', () => {
  assert.equal(
    trackedPointsSchema.safeParse({
      revision: 1,
      points: Array.from({length: protocol.limits.maximumTrackedPoints + 1}, () => [0, 0]),
    }).success,
    false,
  );
  assert.equal(trackedPointsSchema.safeParse({revision: 1, points: [[181, 0]]}).success, false);
  assert.equal(annotationLayersSchema.safeParse({layers: ['a', 'a']}).success, false);
  assert.equal(annotationLayersSchema.safeParse({layers: ['pins', 'routes']}).success, true);
});

test('longitudes wrap to the copy of the world nearest the centre', () => {
  assert.equal(wrapNear(-179, 179), 181);
  assert.equal(wrapNear(179, -179), -181);
  assert.equal(wrapNear(10, 0), 10);
  assert.deepEqual(
    mapPositions(
      {
        type: 'LineString',
        coordinates: [
          [1, 2, 30],
          [3, 4],
        ],
      },
      ([x, y, ...rest]) => [x! + 1, y!, ...rest],
    ),
    {
      type: 'LineString',
      coordinates: [
        [2, 2, 30],
        [4, 4],
      ],
    },
  );
});

test('tracked points report their positions once per frame that moves them', () => {
  const run = harness();
  run.controller.setTrackedPoints({
    revision: 3,
    points: [
      [1, 2],
      [2, 4],
      [3, -1],
    ],
  });
  // New points are reported on the next frame, even when the map draws none.
  assert.equal(run.events.length, 0);
  run.flush();
  assert.deepEqual(run.events, [
    ['trackedPointsMoved', {revision: 3, time: 1_000, positions: [110, 20, 120, 40, null, null]}],
  ]);
  // A frame that moves nothing reports nothing.
  run.render();
  assert.equal(run.events.length, 1);
  run.map.center = 0.5;
  run.advance(16);
  run.occluded.add(4);
  run.render();
  assert.deepEqual(run.events.at(-1), [
    'trackedPointsMoved',
    {revision: 3, time: 1_016, positions: [105, 20, null, null, null, null]},
  ]);
});

test('terrain hides points it covers, read at most every interval', () => {
  const run = harness();
  run.map.terrain = {};
  run.controller.setTrackedPoints({revision: 1, points: [[1, 2]]});
  run.flush();
  assert.deepEqual(run.events.at(-1)?.[1].positions, [110, 20]);
  run.terrainCovered.add(2);
  run.map.center = 0.1;
  run.render();
  // The terrain was read less than an interval ago; the point still shows where it is.
  assert.deepEqual(run.events.at(-1)?.[1].positions, [109, 20]);
  run.advance(terrainCheckMs);
  run.map.center = 0.2;
  run.render();
  assert.deepEqual(run.events.at(-1)?.[1].positions, [null, null]);
});

test('nothing is computed for a host that does not follow tracked points', () => {
  const run = harness({wanted: false});
  run.controller.setTrackedPoints({revision: 1, points: [[1, 2]]});
  run.flush();
  run.render();
  assert.deepEqual(run.events, []);
});

test('taps and long presses report annotations only on annotation layers', () => {
  const hit = {layer: 'pins', source: 'pins', id: 7, properties: {}};
  const run = harness({hits: [hit, {...hit, id: 'b'}]});
  assert.deepEqual(run.controller.hits({x: 1, y: 1}), []);
  run.controller.setLayers({layers: ['pins']});
  assert.deepEqual(run.controller.hits({x: 1, y: 1}), [
    {layer: 'pins', id: '7'},
    {layer: 'pins', id: 'b'},
  ]);
});

test('a pan that starts on a draggable annotation drags it, keeping it under the finger', () => {
  const run = harness({
    hits: [{layer: 'pins', source: 'pin-source', id: 'pin', properties: {draggable: true}}],
  });
  run.controller.setLayers({layers: ['pins']});
  // The pin at (2, 3) is at (120, 30); the finger takes it a little to the side.
  run.pointer('pointerdown', 122, 31);
  assert.equal(run.pan(), false);
  run.pointer('pointermove', 122 + dragSlop, 31);
  assert.equal(run.controller.dragging, false);
  assert.deepEqual(run.events, []);
  run.pointer('pointermove', 132, 41);
  assert.equal(run.controller.dragging, true);
  assert.deepEqual(run.moves.at(-1), ['pin-source', 'pin', {type: 'Point', coordinates: [3, 4]}]);
  assert.deepEqual(run.events.at(-1), [
    'annotationDragged',
    {
      phase: 'started',
      layer: 'pins',
      id: 'pin',
      geometry: {type: 'Point', coordinates: [3, 4]},
      point: {x: 132, y: 41},
    },
  ]);
  // Moves in one frame are reported once, with the latest position.
  run.pointer('pointermove', 142, 41);
  run.pointer('pointermove', 152, 51);
  run.flush();
  assert.deepEqual(
    run.events.map(([, payload]) => payload.phase),
    ['started', 'moved'],
  );
  assert.deepEqual(run.events.at(-1)?.[1].geometry, {type: 'Point', coordinates: [5, 5]});
  run.pointer('pointerup', 152, 51);
  assert.equal(run.pan(), true);
  assert.equal(run.controller.dragging, false);
  assert.equal(run.events.at(-1)?.[1].phase, 'ended');
});

test('every position of a dragged line moves with the finger', () => {
  const run = harness({
    hits: [{layer: 'routes', source: 'routes', id: 'line', properties: {draggable: true}}],
  });
  run.controller.setLayers({layers: ['routes']});
  run.pointer('pointerdown', 110, 10);
  run.pointer('pointermove', 130, 30);
  assert.deepEqual(run.moves.at(-1)?.[2], {
    type: 'LineString',
    coordinates: [
      [3, 3],
      [5, 3],
    ],
  });
});

test('presses that do not drag leave the map its pan', () => {
  const fixed = harness({hits: [{layer: 'pins', source: 'pins', id: 'pin', properties: {}}]});
  fixed.controller.setLayers({layers: ['pins']});
  fixed.pointer('pointerdown', 120, 30);
  assert.equal(fixed.pan(), true);
  fixed.pointer('pointermove', 150, 30);
  assert.deepEqual(fixed.moves, []);

  const draggable = harness({
    hits: [{layer: 'pins', source: 'pins', id: 'pin', properties: {draggable: true}}],
  });
  draggable.controller.setLayers({layers: ['pins']});
  // A second finger is not a drag; a tap gives the pan back without a drag.
  draggable.pointer('pointerdown', 120, 30, {isPrimary: false});
  assert.equal(draggable.pan(), true);
  draggable.pointer('pointerdown', 120, 30);
  draggable.pointer('pointerup', 120, 30);
  assert.equal(draggable.pan(), true);
  assert.deepEqual(draggable.events, []);
  // Removing the layer during a drag ends it.
  draggable.pointer('pointerdown', 120, 30);
  draggable.pointer('pointermove', 140, 30);
  draggable.controller.setLayers({layers: []});
  assert.equal(draggable.pan(), true);
  assert.equal(draggable.events.at(-1)?.[1].phase, 'ended');
});
