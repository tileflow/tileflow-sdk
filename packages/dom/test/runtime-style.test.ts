import assert from 'node:assert/strict';
import test from 'node:test';
import {TileflowRuntimeStyleError} from '@tileflow/core/browser';
import {createMapControllerOwner} from '../src/runtime-style';

const source = {type: 'geojson', data: {type: 'FeatureCollection', features: []}};

test('a new renderer rejects the old queue without letting stale cleanup retire the new one', async () => {
  const owner = createMapControllerOwner();
  const initial = owner.ref.addSource('initial', source);
  const rejected = assert.rejects(initial, {code: 'disposed'});
  const previous = owner.begin();
  owner.reset();
  await rejected;

  let settled = false;
  const next = owner.ref.addSource('next', source).finally(() => {
    settled = true;
  });
  const retired = assert.rejects(next, {code: 'disposed'});
  owner.retire(previous);
  await Promise.resolve();
  assert.equal(settled, false);
  owner.dispose();
  await retired;
});

test('initial failure rejects queued work and a new initialization gets its own queue', async () => {
  const owner = createMapControllerOwner();
  const pending = owner.ref.addSource('points', source);
  const failed = assert.rejects(pending, {code: 'resourceFailed'});
  owner.fail(new TileflowRuntimeStyleError('resourceFailed'));
  await failed;
  owner.prepare();
  const next = owner.ref.addSource('points', source);
  const retired = assert.rejects(next, {code: 'disposed'});
  owner.dispose();
  await retired;
});

test('development effect replay keeps queued work until the actual unmount', async () => {
  const owner = createMapControllerOwner();
  const release = owner.activate();
  let settled = false;
  const pending = owner.ref.addSource('points', source).finally(() => {
    settled = true;
  });
  const retired = assert.rejects(pending, {code: 'disposed'});
  release();
  const releaseReplay = owner.activate();
  await Promise.resolve();
  assert.equal(settled, false);
  releaseReplay();
  await retired;
});
