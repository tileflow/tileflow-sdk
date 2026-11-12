import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowNativeBuildingsLayerId} from '../src/building-layer-ids';
import {createBuildingNativeLayers} from '../src/building-native-layers-browser';
import {tileflowNativeBuildingsFilter, tileflowStandInArea} from '../src/building-stand-ins';

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

test('native buildings leave out the stand-ins before they show, and restore the authored filter', () => {
  const layer = {id: tileflowNativeBuildingsLayerId};
  const authored = ['!=', ['get', 'extrude'], false];
  let visibility = 'none';
  let filter: unknown = authored;
  const writes: string[] = [];
  const map = {
    getLayer: () => layer,
    getLayoutProperty: () => visibility,
    setLayoutProperty: (_id: string, _property: string, value: unknown) => {
      visibility = String(value);
      writes.push(`visibility ${visibility}`);
    },
    getFilter: () => filter,
    setFilter: (_id: string, value: unknown) => {
      filter = value;
      writes.push('filter');
    },
  };
  const area = tileflowStandInArea([
    {placement: {at: [2.2945, 48.8583], heading: 0}, footprint: [[-80, -80, 80, -80, 0, 80]]},
  ]);
  const native = createBuildingNativeLayers(map);
  native.setStandIns(area);
  native.setVisible(true);
  // The filter changes first, so the layer never draws what it leaves out.
  assert.deepEqual(writes, ['filter', 'visibility visible']);
  assert.deepEqual(filter, tileflowNativeBuildingsFilter(authored, area));
  // Hidden, the layer keeps its filter until it shows again.
  native.setVisible(false);
  native.setStandIns(undefined);
  assert.deepEqual(filter, tileflowNativeBuildingsFilter(authored, area));
  native.setVisible(true);
  assert.equal(filter, authored);
  native.setStandIns(area);
  assert.deepEqual(filter, tileflowNativeBuildingsFilter(authored, area));
  native.restore();
  assert.equal(filter, authored);
  assert.equal(visibility, 'none');
});

test('after its filter changes, the native extrusion shows only once its source has read its tiles again', () => {
  // Tiles read before the change still hold the buildings the filter now leaves out.
  const layer = {id: tileflowNativeBuildingsLayerId, source: 'tileflow'};
  const listeners = new Set<() => void>();
  let visibility = 'none';
  let filter: unknown;
  let loaded = true;
  const map = {
    getLayer: () => layer,
    getLayoutProperty: () => visibility,
    setLayoutProperty: (_id: string, _property: string, value: unknown) => {
      visibility = String(value);
    },
    getFilter: () => filter,
    setFilter: (_id: string, value: unknown) => {
      filter = value;
      // The map starts reading its tiles again on the next frame.
    },
    isSourceLoaded: () => loaded,
    on: (_event: 'render', listener: () => void) => listeners.add(listener),
    off: (_event: 'render', listener: () => void) => listeners.delete(listener),
    triggerRepaint() {},
  };
  const frame = () => {
    for (const listener of [...listeners]) listener();
  };
  const area = tileflowStandInArea([
    {placement: {at: [2.2945, 48.8583], heading: 0}, footprint: [[-80, -80, 80, -80, 0, 80]]},
  ]);
  const native = createBuildingNativeLayers(map);
  native.setVisible(false);
  native.setStandIns(area);
  native.setVisible(true);
  assert.equal(visibility, 'none');
  frame();
  loaded = false;
  frame();
  native.setVisible(true);
  assert.equal(visibility, 'none', 'its tiles are still being read');
  loaded = true;
  frame();
  assert.equal(visibility, 'visible');
  assert.equal(listeners.size, 0);
  // Drawing, it keeps its tiles until the map swaps in the ones read again.
  native.setStandIns(undefined);
  assert.equal(visibility, 'visible');
  assert.equal(filter, undefined);
  // Hidden while its tiles are read, it stays hidden when they are.
  native.setVisible(false);
  native.setStandIns(area);
  native.setVisible(true);
  native.setVisible(false);
  frame();
  frame();
  assert.equal(visibility, 'none');
  native.restore();
  assert.equal(filter, undefined);
});
