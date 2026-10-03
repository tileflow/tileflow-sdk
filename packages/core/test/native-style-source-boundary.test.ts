import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowNativeSourceController} from '../src/native';
import {snapshotNativeDirectStyle} from '../src/native-direct-style';
import {validateTileflowRuntimeSource} from '../src/runtime';

const style = {version: 8 as const, name: 'Fixture', sources: {}, layers: []};

test('private style snapshots do not depend on or widen the public Map source contract', async () => {
  const snapshot = snapshotNativeDirectStyle(style, {});
  assert.deepEqual(snapshot, style);
  assert.notEqual(snapshot, style);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(Object.isFrozen(style), false);

  let acquisitions = 0;
  const controller = createTileflowNativeSourceController({
    acquire() {
      acquisitions++;
      throw new Error('Unexpected manifest acquisition.');
    },
  });
  try {
    for (const source of [
      {kind: 'maplibre', style},
      {style},
      {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json', style},
    ]) {
      assert.equal(validateTileflowRuntimeSource(source).ok, false);
      await controller.replace(source as never);
      assert.equal(controller.state?.status, 'error');
    }
    assert.equal(acquisitions, 0);
  } finally {
    controller.dispose();
  }
});

test('private style URLs retain exact native network policy and secret-free failures', () => {
  assert.equal(
    snapshotNativeDirectStyle('https://maps.example.test:443/a/../style.json', {}),
    'https://maps.example.test/style.json',
  );
  assert.equal(
    snapshotNativeDirectStyle('http://127.0.0.1:8765/style.json', {
      developmentOrigin: 'http://127.0.0.1:8765',
    }),
    'http://127.0.0.1:8765/style.json',
  );
  for (const value of [
    '',
    '/style.json',
    'http://maps.example.test/style.json',
    'https://user:private@maps.example.test/style.json',
    'https://maps.example.test/style.json#private',
  ]) {
    assert.throws(
      () => snapshotNativeDirectStyle(value, {}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.cause, undefined);
        assert.equal(String(error).includes('private'), false);
        assert.equal(JSON.stringify(error).includes('private'), false);
        return true;
      },
    );
  }
});
