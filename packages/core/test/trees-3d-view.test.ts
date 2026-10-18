import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowTreeView} from '../src/trees-3d-view';

test('trees and their shadows share density, mesh detail and camera reach', () => {
  // At the equator the centre is exactly on the corner of z15 tile 16384/16384.
  const camera = {lng: 0, lat: 0, zoom: 16, pitch: 0, tileZoom: 15};
  const view = tileflowTreeView(camera);
  assert.deepEqual(view.tile(16384, 16384), {rank: 12, level: 'near'});
  assert.equal(
    view.tile(16386, 16384),
    undefined,
    'a tile outside the reach casts no phantom trees',
  );
  const close = tileflowTreeView({...camera, zoom: 19});
  assert.deepEqual(close.tile(16384, 16384), {rank: 15, level: 'near'});
  assert.notEqual(view.key, close.key, 'zoom changes invalidate shadow density');
  assert.notEqual(view.key, tileflowTreeView({...camera, pitch: 60}).key);
  assert.notEqual(view.key, tileflowTreeView({...camera, lng: 0.001}).key);
});

test('trees use the distant mesh and fewer instances near the end of the fade', () => {
  // Put the centre 800 m west of a tile at zoom 16, where the reach ends at 900 m.
  const view = tileflowTreeView({
    lng: (-800 / 40_075_016.686) * 360,
    lat: 0,
    zoom: 16,
    pitch: 0,
    tileZoom: 15,
  });
  const selection = view.tile(16384, 16384)!;
  assert.equal(selection.level, 'far');
  assert.ok(selection.rank < 12);
  assert.ok(selection.rank >= 2);
  assert.equal(view.tile(16385, 16384), undefined);
});
