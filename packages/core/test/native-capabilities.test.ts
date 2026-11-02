import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeDegradation,
  normalizeTileflowNativeDegradations,
  readTileflowNativeDegradations,
  resolveTileflowNativeCompatibility,
  tileflowNativeCapabilities,
  tileflowNativeDegradationSchema,
  tileflowNativeDegradationsMetadataKey,
  tileflowNativeFallbackSchema,
} from '../src/native-profile';

test('every capability names a known fallback, reason and impact', () => {
  for (const [feature, capability] of Object.entries(tileflowNativeCapabilities)) {
    assert.equal(
      tileflowNativeFallbackSchema.safeParse(capability.fallback).success,
      true,
      feature,
    );
    assert.ok(['presentation', 'content'].includes(capability.impact), feature);
    assert.ok(['artifact', 'runtime'].includes(capability.detection), feature);
    assert.ok(capability.description.endsWith('.'), feature);
  }
  // Only content that native maps leave out, with nothing in its place, decides compatibility.
  assert.deepEqual(
    Object.entries(tileflowNativeCapabilities)
      .filter(([, capability]) => capability.impact === 'content')
      .map(([feature]) => feature),
    ['deviceContours'],
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

test('a theme that loses content makes the whole map web only; presentation never does', () => {
  const presentation = [
    createTileflowNativeDegradation('globe'),
    createTileflowNativeDegradation('scene3d', {layers: ['extrusion']}),
    createTileflowNativeDegradation('trees3d', {fallback: 'none'}),
  ];
  assert.deepEqual(resolveTileflowNativeCompatibility({light: presentation, dark: presentation}), {
    status: 'compatible',
    reasons: [],
  });
  const contours = createTileflowNativeDegradation('deviceContours', {
    subject: 'contours',
    layers: ['contour-minor', 'contour-index'],
  });
  assert.deepEqual(
    resolveTileflowNativeCompatibility({light: [...presentation, contours], dark: presentation}),
    {
      status: 'web-only',
      reasons: [
        {
          feature: 'deviceContours',
          ids: ['deviceContours:contours'],
          themes: ['light'],
          layers: ['contour-index', 'contour-minor'],
        },
      ],
    },
  );
});
