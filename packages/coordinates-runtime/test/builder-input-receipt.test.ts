import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CoordinatesBuilderInputError,
  verifyCoordinatesBuilderInputReceipt,
  type CoordinatesBuilderInput,
} from '../src/builder-input';

const input = {
  inputId: `cbi_${'a'.repeat(64)}`,
  adapter: {
    sourceDigest: 'b'.repeat(64),
    sourceRevision: 'c'.repeat(40),
  },
  runtimePackage: {
    archive: {sha256: 'd'.repeat(64)},
    integrity:
      'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    name: '@tileflow/coordinates-runtime',
    version: '0.1.0-alpha.1',
  },
} as CoordinatesBuilderInput;

const receipt = {
  schemaVersion: 1,
  kind: 'tileflow-coordinates-builder-input-release-receipt',
  sourceRevision: input.adapter.sourceRevision,
  builderInput: {
    id: input.inputId,
    sourceDigest: input.adapter.sourceDigest,
    runtimePackage: {
      archiveSha256: input.runtimePackage.archive.sha256,
      integrity: input.runtimePackage.integrity,
      name: input.runtimePackage.name,
      version: input.runtimePackage.version,
    },
  },
};

test('requires a trusted expected input identity and a matching SDK release receipt', () => {
  assert.doesNotThrow(() =>
    verifyCoordinatesBuilderInputReceipt({
      expectedInputId: input.inputId,
      input,
      receipt,
    }),
  );

  for (const candidate of [
    {expectedInputId: `cbi_${'e'.repeat(64)}`, receipt},
    {
      expectedInputId: input.inputId,
      receipt: {...receipt, sourceRevision: 'f'.repeat(40)},
    },
    {
      expectedInputId: input.inputId,
      receipt: {
        ...receipt,
        builderInput: {
          ...receipt.builderInput,
          runtimePackage: {...receipt.builderInput.runtimePackage, archiveSha256: '0'.repeat(64)},
        },
      },
    },
  ]) {
    assert.throws(
      () => verifyCoordinatesBuilderInputReceipt({...candidate, input}),
      (error: unknown) =>
        error instanceof CoordinatesBuilderInputError &&
        ['BUILDER_INPUT_EXPECTED_ID_MISMATCH', 'BUILDER_INPUT_RECEIPT_MISMATCH'].includes(
          error.code,
        ),
    );
  }
});
