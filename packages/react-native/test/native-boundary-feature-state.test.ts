import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoundaryFeatureState} from '@tileflow/core/native';
import {
  createNativeBoundaryFeatureStateOwner,
  type NativeBoundarySource,
} from '../src/native-boundary-feature-state-owner';

const sourceId = 'tileflow-boundaries';
const style = (promoteId?: string) => ({
  sources: {[sourceId]: {type: 'vector', tiles: ['https://t/{z}/{x}/{y}.pbf'], promoteId}},
});

function fakeSource(failWrites = false) {
  const writes: string[] = [];
  const source: NativeBoundarySource = {
    async setFeatureState({id, sourceLayer}, state) {
      writes.push(`set ${sourceLayer}:${id}=${JSON.stringify(state)}`);
      if (failWrites) throw new Error('source_not_attached');
    },
    async removeFeatureState(feature: {id?: string | number; sourceLayer: string}, key?: string) {
      writes.push(`remove ${feature.sourceLayer}:${feature.id}.${key}`);
    },
  };
  return {source, writes};
}

test('values wait for the loaded style and its adopted source, then follow every reload', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId);
  const controller = createBoundaryFeatureState(owner.map, {labels: true});
  const {source, writes} = fakeSource();
  const light = style();
  owner.setStyle(light, false);
  controller.set({joinBy: 'id', rows: [{key: 7, value: 3}]});
  assert.deepEqual(writes, []);

  owner.setStyle(light, true);
  owner.setSource(source);
  assert.deepEqual(writes, ['set boundary_area:7={"value":3}', 'set boundary_label:7={"value":3}']);

  // A theme change replaces the style; MapLibre drops feature-state with it.
  writes.length = 0;
  const dark = style();
  owner.setStyle(dark, false);
  controller.set({joinBy: 'id', rows: [{key: 7, value: 4}]});
  assert.deepEqual(writes, []);
  owner.setStyle(dark, true);
  assert.deepEqual(writes, ['set boundary_area:7={"value":4}', 'set boundary_label:7={"value":4}']);

  writes.length = 0;
  controller.set({joinBy: 'id', rows: []});
  assert.deepEqual(writes, ['remove boundary_area:7.value', 'remove boundary_label:7.value']);
});

test('a style that loads at once still receives every value again', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId);
  const controller = createBoundaryFeatureState(owner.map);
  const {source, writes} = fakeSource();
  owner.setSource(source);
  owner.setStyle(style(), true);
  controller.set({joinBy: 'id', rows: [{key: 1, value: 'a'}]});
  writes.length = 0;
  owner.setStyle(style(), true);
  assert.deepEqual(writes, ['set boundary_area:1={"value":"a"}']);
});

test('rows follow the style source key, and a style without the source receives nothing', () => {
  const owner = createNativeBoundaryFeatureStateOwner(sourceId);
  const controller = createBoundaryFeatureState(owner.map);
  const {source, writes} = fakeSource(true);
  owner.setSource(source);
  owner.setStyle(style('ref'), true);
  assert.throws(() => controller.set({joinBy: 'id', rows: [{key: 1, value: 1}]}), /keyed by ref/u);
  // A rejected native write (a source detached by a reload) is not an application error.
  controller.set({joinBy: 'ref', rows: [{key: 'ES:INE:28079', value: 1}]});
  assert.deepEqual(writes, ['set boundary_area:ES:INE:28079={"value":1}']);

  writes.length = 0;
  owner.setStyle({sources: {}}, true);
  assert.equal(owner.map.getSource(sourceId), undefined);
  controller.clear();
  assert.deepEqual(writes, []);
});
