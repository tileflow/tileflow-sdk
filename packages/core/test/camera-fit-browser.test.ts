import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTileflowCameraFit} from '../src/camera-fit-browser';

const marker = (id: string, coordinate: [number, number]) => ({coordinate, id});

test('shows given bounds in either form', () => {
  const flat = resolveTileflowCameraFit({bounds: [-4, 40, -3, 41]});
  const nested = resolveTileflowCameraFit({
    bounds: [
      [-4, 40],
      [-3, 41],
    ],
  });
  assert.deepEqual(flat.fit?.bounds, [
    [-4, 40],
    [-3, 41],
  ]);
  assert.deepEqual(nested, flat);
});

test('keeps the options of bounds as given, and the key changes with them', () => {
  const base = resolveTileflowCameraFit({bounds: [-4, 40, -3, 41]});
  const padded = resolveTileflowCameraFit({
    bounds: [-4, 40, -3, 41],
    fitBoundsOptions: {padding: 24},
  });
  assert.deepEqual(base.fit?.options, {});
  assert.deepEqual(padded.fit?.options, {padding: 24});
  assert.notEqual(base.key, padded.key);
});

test('refuses bounds that are not degrees and says what is expected', () => {
  for (const bounds of [
    [1, 2, 3],
    [-4, 40, -3, 100],
    [-4, 41, -3, 40],
    [-4, Number.NaN, -3, 41],
    'nope',
  ]) {
    const result = resolveTileflowCameraFit({bounds: bounds as never});
    assert.equal(result.fit, undefined);
    assert.match(result.error ?? '', /\[west, south, east, north\]/u);
  }
});

test('fits annotations with padding and a maximum zoom, and bounds win over them', () => {
  const annotations = [
    marker('a', [-3.7, 40.4]),
    marker('b', [-3.6, 40.5]),
    marker('c', [-3.8, 40.3]),
  ];
  const fit = resolveTileflowCameraFit({annotations, fitAnnotations: true});
  assert.deepEqual(fit.fit?.bounds, [
    [-3.8, 40.3],
    [-3.6, 40.5],
  ]);
  assert.deepEqual(fit.fit?.options, {maxZoom: 15, padding: 48});
  assert.deepEqual(
    resolveTileflowCameraFit({annotations, fitAnnotations: {maxZoom: 12, padding: 8}}).fit?.options,
    {maxZoom: 12, padding: 8},
  );
  assert.deepEqual(
    resolveTileflowCameraFit({annotations, bounds: [0, 0, 1, 1], fitAnnotations: true}).fit?.bounds,
    [
      [0, 0],
      [1, 1],
    ],
  );
});

test('fits nothing without annotations, and moves only when the annotations move', () => {
  assert.deepEqual(resolveTileflowCameraFit({annotations: [], fitAnnotations: true}), {key: ''});
  assert.deepEqual(resolveTileflowCameraFit({annotations: [marker('a', [0, 0])]}), {key: ''});
  const first = resolveTileflowCameraFit({
    annotations: [marker('a', [1, 2])],
    fitAnnotations: true,
  });
  const same = resolveTileflowCameraFit({annotations: [marker('z', [1, 2])], fitAnnotations: true});
  const moved = resolveTileflowCameraFit({
    annotations: [marker('a', [1, 2.5])],
    fitAnnotations: true,
  });
  assert.equal(first.key, same.key);
  assert.notEqual(first.key, moved.key);
});
