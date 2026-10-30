import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineMap, disable, parseTileflowMap} from '../src';
import {readTileflowCamera, tileflowCameraMetadataKey} from '../src/camera';
import {extendStreets} from './map-fixture';

test('camera policy survives compilation and inheritance; false overrides a parent true', () => {
  const parent = extendStreets({camera: {adaptivePerspective: true}, modules: {poi: disable()}});
  const inherited = defineMap({id: 'camera-inherited', version: 1, extends: parent});
  const disabled = defineMap({
    id: 'camera-off',
    version: 1,
    extends: parent,
    camera: {adaptivePerspective: false},
  });
  for (const [map, expected] of [
    [parent, true],
    [inherited, true],
    [disabled, false],
  ] as const) {
    assert.equal(parseTileflowMap(map).camera?.adaptivePerspective, expected);
    assert.deepEqual(readTileflowCamera(createStyle(map).metadata), {
      adaptivePerspective: expected,
    });
  }
  assert.equal(
    createStyle(extendStreets({modules: {poi: disable()}})).metadata?.[tileflowCameraMetadataKey],
    undefined,
  );
  assert.throws(() =>
    parseTileflowMap({...parent, camera: {adaptivePerspective: 'true'}} as never),
  );
  assert.deepEqual(
    readTileflowCamera({'tileflow:camera': {version: 2, adaptivePerspective: true}}),
    {},
  );
});
