import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowMapReference} from '../src/map-reference.js';

class Renderer {
  ready = false;
  style = {version: 8, sources: {} as Record<string, unknown>, layers: [] as {id: string}[]};
  listeners = new Map<string, Set<() => void>>();
  getStyle() {
    return this.style;
  }
  isStyleLoaded() {
    return this.ready;
  }
  getSource(id: string) {
    return this.style.sources[id];
  }
  getLayer(id: string) {
    return this.style.layers.find((layer) => layer.id === id);
  }
  addSource(id: string, source: unknown) {
    this.style.sources[id] = source;
  }
  removeSource(id: string) {
    delete this.style.sources[id];
  }
  addLayer(layer: {id: string}, before?: string) {
    const at = before
      ? this.style.layers.findIndex((value) => value.id === before)
      : this.style.layers.length;
    this.style.layers.splice(at, 0, layer);
  }
  moveLayer(id: string, before?: string) {
    const layer = this.getLayer(id)!;
    this.removeLayer(id);
    this.addLayer(layer, before);
  }
  removeLayer(id: string) {
    this.style.layers = this.style.layers.filter((layer) => layer.id !== id);
  }
  on(event: string, listener: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }
  load() {
    this.ready = true;
    for (const listener of this.listeners.get('style.load') ?? []) listener();
  }
}

const source = {type: 'geojson', data: {type: 'FeatureCollection', features: []}};

test('keeps calls queued through initial preparation and exposes all five operations', async () => {
  const owner = createTileflowMapReference(false);
  const reference = owner.reference;
  const added = reference.addSource('points', source);
  const layer = reference.addLayer({id: 'dots', type: 'circle', source: 'points'});
  owner.start(false);
  const map = new Renderer();
  owner.current.attach(map);
  assert.equal(map.getSource('points'), undefined);
  map.load();
  await Promise.all([added, layer]);
  assert.ok(map.getLayer('dots'));
  await reference.moveLayer('dots', {slotIndex: 0});
  await reference.removeLayer('dots');
  await reference.removeSource('points');
  assert.equal(map.getLayer('dots'), undefined);
  assert.equal(map.getSource('points'), undefined);
  owner.dispose();
});

test('retires pending work before replacing the renderer and never transfers resources', async () => {
  const owner = createTileflowMapReference(false);
  const old = new Renderer();
  owner.current.attach(old);
  const rejected = assert.rejects(owner.reference.addSource('old', source), {code: 'disposed'});
  owner.start(false, true);
  await rejected;
  assert.ok([...old.listeners.values()].every((listeners) => listeners.size === 0));
  const replacement = new Renderer();
  replacement.ready = true;
  owner.current.attach(replacement);
  await owner.reference.addSource('new', source);
  old.load();
  assert.equal(old.getSource('old'), undefined);
  assert.equal(replacement.getSource('old'), undefined);
  assert.ok(replacement.getSource('new'));
  owner.dispose();
  assert.equal(replacement.getSource('new'), undefined);
  owner.start(false, true);
  await assert.rejects(owner.reference.addSource('late', source), {code: 'disposed'});
});

test('image mode and fatal initialization fail promptly and a new generation can recover', async () => {
  const owner = createTileflowMapReference(true);
  await assert.rejects(owner.reference.addSource('points', source), (error) => {
    assert.equal((error as {code: string}).code, 'invalidRequest');
    assert.equal((error as {context: {reason: string}}).context.reason, 'unsupportedMode');
    return true;
  });
  owner.start(false, true);
  const failure = new Error('Initial style unavailable');
  const rejected = assert.rejects(
    owner.reference.addSource('points', source),
    (error) => error === failure,
  );
  owner.fail(failure);
  await rejected;
  await assert.rejects(owner.reference.removeSource('points'), (error) => error === failure);
  owner.start(false, true);
  const map = new Renderer();
  map.ready = true;
  owner.current.attach(map);
  await owner.reference.addSource('points', source);
  owner.dispose();
});
