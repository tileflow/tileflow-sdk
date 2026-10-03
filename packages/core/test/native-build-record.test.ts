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
    layers: [{inputLayer: 1, outputStart: 1, outputCount: 2, properties: ['line-cap']}],
  };
}

test('binds the native-v1 preparation ABI and exact transformation scope in a strict v2 record', () => {
  const record = createTileflowNativeBuildRecord('c'.repeat(64), [transformation()]);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.preparationVersion, 'native-lowering-v1');
  assert.equal(record.validation, 'static-artifacts');
  assert.deepEqual(record.transformations, [transformation()]);
  assert.deepEqual(tileflowNativeBuildRecordSchema.parse(record), record);
  for (const invalid of [
    {...record, schemaVersion: 1},
    {...record, preparationVersion: 'unknown'},
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
  ])
    assert.equal(tileflowNativeBuildRecordSchema.safeParse(invalid).success, false);
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
