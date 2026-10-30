import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachTileflowNauticalLights,
  type TileflowNauticalLightsMap,
} from '../src/nautical-lights-browser';
import {
  readTileflowNauticalLights,
  tileflowNauticalLightStates,
  tileflowNauticalLightsMetadataKey,
} from '../src/nautical-lights';

const {colour, intensity} = tileflowNauticalLightStates;
const declaration = {
  layers: ['tileflow-nautical-lights'],
  source: 'tileflow-nautical',
  sourceLayer: 'light',
  version: 1,
};
// Fl(2) 10s is 1+(2)+1+(6); Q is 0.3+(0.7); F never changes.
const flashing = {character: 'Fl', group: '2', period_s: 10};
const quick = {character: 'Q'};

type Feature = {id?: unknown; properties?: Record<string, unknown>};

function fixture(options: {features?: Feature[]; reducedMotion?: boolean; zoom?: number} = {}) {
  const events = new Map<string, Set<(event?: unknown) => void>>();
  const documentEvents = new Map<string, Set<() => void>>();
  const motionListeners = new Set<() => void>();
  const timers = new Map<number, {at: number; callback: () => void}>();
  const states = new Map<unknown, Record<string, number>>();
  const writes: Array<{id: unknown; state: Record<string, number>}> = [];
  let timerId = 0;
  let now = 0;
  const media = {
    matches: options.reducedMotion ?? false,
    addEventListener(_type: string, listener: () => void) {
      motionListeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      motionListeners.delete(listener);
    },
  };
  const browser = {
    clearTimeout(id: number) {
      timers.delete(id);
    },
    matchMedia: () => media,
    performance: {now: () => now},
    setTimeout(callback: () => void, delay: number) {
      timers.set(++timerId, {at: now + delay, callback});
      return timerId;
    },
  };
  const document = {
    defaultView: browser,
    visibilityState: 'visible',
    addEventListener(type: string, listener: () => void) {
      if (!documentEvents.has(type)) documentEvents.set(type, new Set());
      documentEvents.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      documentEvents.get(type)?.delete(listener);
    },
  };
  const state = {
    features: options.features ?? [
      {id: 1, properties: flashing},
      {id: 2, properties: flashing},
      {id: 3, properties: quick},
      {id: 4, properties: {character: 'F'}},
    ],
    layerVisibility: 'visible' as string | undefined,
    metadata: {[tileflowNauticalLightsMetadataKey]: declaration} as unknown,
    queries: 0,
    source: {type: 'vector'} as unknown,
    zoom: options.zoom ?? 12,
  };
  const map = {
    getContainer: () => ({ownerDocument: document}),
    getLayer: (id: string) =>
      (readTileflowNauticalLights(state.metadata)?.layers ?? []).includes(id)
        ? {minzoom: 6}
        : undefined,
    getLayoutProperty: () => state.layerVisibility,
    getSource: () => state.source,
    getStyle: () => ({metadata: state.metadata}),
    getZoom: () => state.zoom,
    off(event: string, listener: (event?: unknown) => void) {
      events.get(event)?.delete(listener);
    },
    on(event: string, listener: (event?: unknown) => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(listener);
    },
    queryRenderedFeatures(query: {layers: string[]}) {
      assert.deepEqual(query.layers, declaration.layers);
      state.queries += 1;
      return state.features;
    },
    removeFeatureState(target: {id: unknown; source: string; sourceLayer: string}, key?: string) {
      assert.equal(target.source, declaration.source);
      assert.equal(target.sourceLayer, declaration.sourceLayer);
      const current = states.get(target.id);
      if (!current) return;
      if (key) delete current[key];
      if (!key || Object.keys(current).length === 0) states.delete(target.id);
    },
    setFeatureState(target: {id: unknown}, value: Record<string, number>) {
      writes.push({id: target.id, state: {...value}});
      states.set(target.id, {...states.get(target.id), ...value});
    },
  };
  return {
    document,
    events,
    map: map as unknown as TileflowNauticalLightsMap,
    media,
    state,
    states,
    timers,
    writes,
    emit(event: string, payload?: unknown) {
      for (const listener of [...(events.get(event) ?? [])]) listener(payload);
    },
    setVisibility(value: 'hidden' | 'visible') {
      document.visibilityState = value;
      for (const listener of [...(documentEvents.get('visibilitychange') ?? [])]) listener();
    },
    setReducedMotion(value: boolean) {
      media.matches = value;
      for (const listener of [...motionListeners]) listener();
    },
    /** Runs the next pending timer at its time; returns its delay. */
    advance() {
      assert.equal(timers.size, 1, 'one timer is pending');
      const [[id, timer]] = [...timers];
      timers.delete(id);
      const delay = timer.at - now;
      now = timer.at;
      timer.callback();
      return delay;
    },
    get now() {
      return now;
    },
    listenerCount() {
      let count = motionListeners.size;
      for (const listeners of [...events.values(), ...documentEvents.values()]) {
        count += listeners.size;
      }
      return count;
    },
  };
}

const lit = (value: number) => ({[colour]: 0, [intensity]: value});

test('reads only a bounded, well-formed light declaration', () => {
  assert.deepEqual(
    readTileflowNauticalLights({[tileflowNauticalLightsMetadataKey]: declaration}),
    declaration,
  );
  for (const value of [
    undefined,
    {...declaration, version: 2},
    {...declaration, layers: []},
    {...declaration, layers: ['a', 'a']},
    {...declaration, layers: Array.from({length: 17}, (_, index) => `layer-${index}`)},
    {...declaration, source: '../tiles'},
    {...declaration, sourceLayer: ''},
  ]) {
    assert.equal(
      readTileflowNauticalLights({[tileflowNauticalLightsMetadataKey]: value}),
      undefined,
      JSON.stringify(value),
    );
  }
});

test('writes each light phase and wakes only for the next change', () => {
  const f = fixture();
  const dispose = attachTileflowNauticalLights(f.map);
  // Every rhythmic light gets its phase; the fixed light is never written.
  assert.deepEqual(Object.fromEntries(f.states), {1: lit(1), 2: lit(1), 3: lit(1)});
  assert.equal(f.timers.size, 1);

  // Q changes after 0.3 s, before Fl(2)'s first flash ends.
  f.writes.length = 0;
  assert.equal(Math.round(f.advance()), 275);
  assert.deepEqual(f.writes, [{id: 3, state: lit(0)}]);

  // The quick light shines again at 1 s, when Fl(2) enters its first eclipse.
  f.writes.length = 0;
  f.advance();
  assert.deepEqual(
    f.writes.map(({id}) => id),
    [1, 2, 3],
  );
  assert.deepEqual(Object.fromEntries(f.states), {1: lit(0), 2: lit(0), 3: lit(1)});

  dispose();
  assert.equal(f.states.size, 0, 'every light returns to steady');
  assert.equal(f.timers.size, 0);
  assert.equal(f.listenerCount(), 0);
});

test('rescans after the camera or the light tiles change and restores lights out of view', () => {
  const f = fixture();
  const dispose = attachTileflowNauticalLights(f.map);
  const queries = f.state.queries;
  f.emit('idle');
  assert.equal(f.state.queries, queries, 'an idle map without changes is not queried again');

  f.state.features = [{id: 3, properties: quick}];
  f.emit('moveend');
  f.emit('idle');
  assert.equal(f.state.queries, queries + 1);
  assert.deepEqual([...f.states.keys()], [3]);

  f.state.features = [...f.state.features, {id: 5, properties: quick}];
  f.emit('sourcedata', {sourceId: 'other'});
  f.emit('idle');
  assert.equal(f.state.queries, queries + 1, 'other sources do not trigger a scan');
  f.emit('sourcedata', {sourceId: 'tileflow-nautical'});
  f.emit('idle');
  assert.deepEqual([...f.states.keys()].sort(), [3, 5]);
  dispose();
});

test('stays idle without visible light layers or rhythms', () => {
  const below = fixture({zoom: 5});
  const disposeBelow = attachTileflowNauticalLights(below.map);
  assert.equal(below.state.queries, 0, 'light layers are hidden below their minimum zoom');
  assert.equal(below.timers.size, 0);
  // Zooming in starts the lights.
  below.state.zoom = 12;
  below.emit('moveend');
  below.emit('idle');
  assert.equal(below.timers.size, 1);
  // A hidden layer stops them again and returns them to steady.
  below.state.layerVisibility = 'none';
  below.emit('moveend');
  below.emit('idle');
  assert.equal(below.timers.size, 0);
  assert.equal(below.states.size, 0);
  disposeBelow();

  const steady = fixture({
    features: [
      {id: 1, properties: {character: 'F'}},
      // Lights without a feature ID cannot carry state.
      {properties: flashing},
    ],
  });
  const disposeSteady = attachTileflowNauticalLights(steady.map);
  assert.equal(steady.timers.size, 0);
  assert.equal(steady.writes.length, 0);
  disposeSteady();
});

test('promoted provenance IDs identify lights, and one shared by two rhythms stays steady', () => {
  const f = fixture({
    features: [
      {id: 'osm:node/1', properties: flashing},
      {id: 'osm:node/1', properties: quick},
      // The same light drawn in two tiles is one feature.
      {id: 'osm:node/2#1', properties: quick},
      {id: 'osm:node/2#1', properties: quick},
    ],
  });
  const dispose = attachTileflowNauticalLights(f.map);
  assert.deepEqual([...f.states.keys()], ['osm:node/2#1']);
  dispose();
});

test('pauses while the page is hidden', () => {
  const f = fixture();
  const dispose = attachTileflowNauticalLights(f.map);
  f.setVisibility('hidden');
  assert.equal(f.timers.size, 0);
  f.emit('moveend');
  f.emit('idle');
  assert.equal(f.timers.size, 0, 'no scan or update runs while hidden');
  const writes = f.writes.length;
  f.setVisibility('visible');
  assert.equal(f.timers.size, 1);
  assert.ok(f.writes.length >= writes);
  dispose();
});

test('reduced motion keeps every light steady and follows the preference', () => {
  const f = fixture({reducedMotion: true});
  const dispose = attachTileflowNauticalLights(f.map);
  f.emit('idle');
  assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0);

  f.setReducedMotion(false);
  assert.equal(f.states.size, 3);
  assert.equal(f.timers.size, 1);

  f.setReducedMotion(true);
  assert.equal(f.states.size, 0, 'lights return to steady at once');
  assert.equal(f.timers.size, 0);
  dispose();
});

test('follows style replacements and releases everything when the map is removed', () => {
  const f = fixture();
  attachTileflowNauticalLights(f.map);
  assert.equal(f.timers.size, 1);

  // A style without a light declaration stops the lights.
  f.state.metadata = {};
  f.emit('style.load');
  assert.equal(f.timers.size, 0);
  f.states.clear();
  f.emit('idle');
  assert.equal(f.timers.size, 0);
  assert.equal(f.writes.length, 3);

  f.state.metadata = {[tileflowNauticalLightsMetadataKey]: declaration};
  f.emit('styledata');
  f.emit('idle');
  assert.equal(f.timers.size, 1);
  assert.equal(f.states.size, 3);

  f.emit('remove');
  assert.equal(f.states.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.listenerCount(), 0);
});

test('waits for a style whose source is not ready', () => {
  const f = fixture();
  f.state.source = undefined;
  const dispose = attachTileflowNauticalLights(f.map);
  assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0);
  f.state.source = {type: 'vector'};
  f.emit('sourcedata', {sourceId: 'tileflow-nautical'});
  f.emit('idle');
  assert.equal(f.states.size, 3);
  dispose();
});
