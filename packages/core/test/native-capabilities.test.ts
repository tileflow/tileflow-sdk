import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeDegradation,
  normalizeTileflowNativeDegradations,
  readTileflowNativeDegradations,
  tileflowNativeCapabilities,
  tileflowNativeDegradationSchema,
  tileflowNativeDegradationsMetadataKey,
  tileflowNativeFallbackSchema,
} from '../src/native-profile';

test('every capability names a known fallback, reason and detection', () => {
  for (const [feature, capability] of Object.entries(tileflowNativeCapabilities)) {
    assert.equal(
      tileflowNativeFallbackSchema.safeParse(capability.fallback).success,
      true,
      feature,
    );
    assert.ok(['artifact', 'runtime'].includes(capability.detection), feature);
    assert.ok(capability.description.endsWith('.'), feature);
  }
  // Degradations are information: none of them carries a status that could block a map.
  assert.ok(
    Object.values(tileflowNativeCapabilities).every((capability) => !('impact' in capability)),
  );
});

test('records are stable: IDs start with their capability and keep its reason', () => {
  const record = createTileflowNativeDegradation('deviceContours', {
    subject: 'relief-contours',
    layers: ['contours', 'contour-labels'],
  });
  assert.deepEqual(record, {
    id: 'deviceContours:relief-contours',
    feature: 'deviceContours',
    reason: 'web-runtime',
    fallback: 'none',
    layers: ['contours', 'contour-labels'],
  });
  assert.equal(createTileflowNativeDegradation('trees3d', {fallback: 'none'}).fallback, 'none');
  for (const invalid of [
    {...record, id: 'sky:relief-contours'},
    {...record, reason: 'engine-unsupported'},
    {...record, layers: ['contours', 'contours']},
    {...record, fallback: 'hidden'},
    {...record, extra: true},
  ])
    assert.equal(tileflowNativeDegradationSchema.safeParse(invalid).success, false);
});

test('normalization orders by ID and merges the layers of one ID', () => {
  const records = normalizeTileflowNativeDegradations([
    createTileflowNativeDegradation('sky'),
    createTileflowNativeDegradation('reliefResampling', {layers: ['b']}),
    createTileflowNativeDegradation('reliefResampling', {layers: ['a', 'b']}),
  ]);
  assert.deepEqual(
    records.map(({id, layers}) => [id, layers]),
    [
      ['reliefResampling', ['b', 'a']],
      ['sky', []],
    ],
  );
  assert.throws(() =>
    normalizeTileflowNativeDegradations([
      createTileflowNativeDegradation('trees3d', {fallback: 'flat'}),
      createTileflowNativeDegradation('trees3d', {fallback: 'none'}),
    ]),
  );
});

test('malformed degradation metadata reads as none', () => {
  const sky = createTileflowNativeDegradation('sky');
  assert.deepEqual(
    readTileflowNativeDegradations({[tileflowNativeDegradationsMetadataKey]: [sky]}),
    [sky],
  );
  for (const metadata of [
    undefined,
    [],
    {[tileflowNativeDegradationsMetadataKey]: 'sky'},
    {[tileflowNativeDegradationsMetadataKey]: [{...sky, feature: 'unknown'}]},
    {[tileflowNativeDegradationsMetadataKey]: [sky, sky]},
  ])
    assert.deepEqual(readTileflowNativeDegradations(metadata), []);
});
