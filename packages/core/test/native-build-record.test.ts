import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNativeBuildRecord,
  tileflowNativeBuildRecordSchema,
  type TileflowNativeStyleTransformation,
} from '../src/native-build-record';

function transformation(theme = 'light'): TileflowNativeStyleTransformation {
  return {
    map: 'main',
    theme,
    inputStyleSha256: 'a'.repeat(64),
    loweredStyleSha256: 'b'.repeat(64),
    inputLayers: 3,
    outputLayers: 4,
    projection: 'globe-to-mercator',
    removedLayers: [],
    insertedLayers: [],
    layers: [{inputLayer: 1, outputStart: 1, outputCount: 2, properties: ['line-cap']}],
    symbolOverlap: [{inputLayer: 2, properties: ['icon-overlap', 'text-overlap']}],
    degradations: ['globe', 'sky'],
  };
}

/** Layer 0 removed, a layer inserted first, layer 1 split in two: 4 inputs become 5 outputs. */
function degraded(): TileflowNativeStyleTransformation {
  return {
    ...transformation(),
    inputLayers: 4,
    outputLayers: 5,
    removedLayers: [0],
    insertedLayers: [0],
    layers: [{inputLayer: 1, outputStart: 1, outputCount: 2, properties: ['line-dasharray']}],
    symbolOverlap: [{inputLayer: 3, properties: ['text-overlap']}],
    degradations: ['deviceContours:contours', 'scene3d'],
  };
}

test('binds the native-v1 preparation ABI and exact transformation scope in a strict v3 record', () => {
  const record = createTileflowNativeBuildRecord('c'.repeat(64), [transformation()]);
  assert.equal(record.schemaVersion, 3);
  assert.equal(record.preparationVersion, 'native-lowering-v2');
  assert.deepEqual(record.engines, {android: '13.7.1', ios: '7.0.0'});
  assert.equal(record.validation, 'static-artifacts');
  assert.deepEqual(record.transformations, [transformation()]);
  assert.deepEqual(tileflowNativeBuildRecordSchema.parse(record), record);
  for (const invalid of [
    {...record, schemaVersion: 2},
    {...record, preparationVersion: 'native-lowering-v1'},
    {...record, rendererExecuted: true},
    {...record, transformations: [{...transformation(), outputLayers: 5}]},
    {...record, transformations: [{...transformation(), projection: 'adaptive'}]},
    {
      ...record,
      transformations: [
        {
          ...transformation(),
          layers: [{inputLayer: 1, outputStart: 2, outputCount: 2, properties: ['line-cap']}],
        },
      ],
    },
    {
      ...record,
      transformations: [
        {
          ...transformation(),
          layers: [
            {inputLayer: 1, outputStart: 1, outputCount: 2, properties: ['line-cap', 'line-cap']},
          ],
        },
      ],
    },
    {...record, transformations: [transformation(), transformation()]},
    {...record, transformations: [{...transformation(), symbolOverlap: undefined}]},
    {...record, transformations: [{...transformation(), degradations: ['sky', 'globe']}]},
    {...record, transformations: [{...transformation(), removedLayers: undefined}]},
    // A removed layer cannot also be split, and spans follow removed and inserted layers.
    {...record, transformations: [{...degraded(), removedLayers: [1]}]},
    {...record, transformations: [{...degraded(), insertedLayers: [1]}]},
    {...record, transformations: [{...degraded(), insertedLayers: []}]},
    {...record, transformations: [{...degraded(), removedLayers: [0, 0]}]},
    {...record, transformations: [{...degraded(), insertedLayers: [5]}]},
    {
      ...record,
      transformations: [
        {...degraded(), symbolOverlap: [{inputLayer: 0, properties: ['text-overlap']}]},
      ],
    },
    ...[
      // Unordered, outside the style, on a partitioned line layer, or with unknown properties.
      [
        {inputLayer: 2, properties: ['icon-overlap']},
        {inputLayer: 0, properties: ['text-overlap']},
      ],
      [{inputLayer: 3, properties: ['icon-overlap']}],
      [{inputLayer: 1, properties: ['icon-overlap']}],
      [{inputLayer: 2, properties: ['text-overlap', 'icon-overlap']}],
      [{inputLayer: 2, properties: ['line-cap']}],
    ].map((symbolOverlap) => ({
      ...record,
      transformations: [{...transformation(), symbolOverlap}],
    })),
  ])
    assert.equal(tileflowNativeBuildRecordSchema.safeParse(invalid).success, false);
  const removedAndInserted = createTileflowNativeBuildRecord('c'.repeat(64), [degraded()]);
  assert.deepEqual(removedAndInserted.transformations, [degraded()]);
});

test('orders style receipts deterministically without mutating callers or conflating hashes', () => {
  const rows = [transformation('light'), transformation('dark')];
  const before = JSON.stringify(rows);
  const record = createTileflowNativeBuildRecord('c'.repeat(64), rows);
  assert.deepEqual(
    record.transformations.map(({theme}) => theme),
    ['dark', 'light'],
  );
  assert.equal(JSON.stringify(rows), before);
  assert.equal(record.buildManifestSha256, 'c'.repeat(64));
  assert.notEqual(
    record.transformations[0]!.inputStyleSha256,
    record.transformations[0]!.loweredStyleSha256,
  );
});
