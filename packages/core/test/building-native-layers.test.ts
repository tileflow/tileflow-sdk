import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowNativeBuildingsLayerId} from '../src/building-layer-ids';
import {createBuildingNativeLayers} from '../src/building-native-layers-browser';

test('native buildings show during loading and restore the style visibility afterwards', () => {
  const layer = {id: tileflowNativeBuildingsLayerId};
  let visibility = 'none';
  const map = {
    getLayer: () => layer,
    getLayoutProperty: () => visibility,
    setLayoutProperty: (_id: string, _property: string, value: unknown) => {
      visibility = String(value);
    },
  };
  const native = createBuildingNativeLayers(map);
  native.setVisible(true);
  assert.equal(visibility, 'visible');
  native.setVisible(false);
  assert.equal(visibility, 'none');
  native.setVisible(true);
  assert.equal(visibility, 'visible');
  native.restore();
  assert.equal(visibility, 'none');
});

test('restoring a native layer never changes a replacement from a new style', () => {
  let layer = {id: tileflowNativeBuildingsLayerId};
  let visibility = 'none';
  const map = {
    getLayer: () => layer,
    getLayoutProperty: () => visibility,
    setLayoutProperty: (_id: string, _property: string, value: unknown) => {
      visibility = String(value);
    },
  };
  const native = createBuildingNativeLayers(map);
  native.setVisible(true);
  layer = {id: tileflowNativeBuildingsLayerId};
  visibility = 'none';
  native.restore();
  assert.equal(visibility, 'none');
  native.setVisible(true);
  assert.equal(visibility, 'visible');
  native.restore();
  assert.equal(visibility, 'none');
});
