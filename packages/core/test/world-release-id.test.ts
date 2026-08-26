import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  isTileflowWorldReleaseId,
  tileflowWorldReleaseIdMaximumLength,
  tileflowWorldReleaseIdMinimumLength,
  tileflowWorldReleaseIdPatternSource,
  tileflowWorldReleaseIdSchema,
} from '../src';

type ConformanceVectors = {
  invalid: string[];
  maximumLength: number;
  minimumLength: number;
  pattern: string;
  schemaVersion: 1;
  valid: string[];
};

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/world-release-id-v1-vectors.json', import.meta.url), 'utf8'),
) as ConformanceVectors;

test('locks the canonical World V1 release ID contract and conformance vectors', () => {
  assert.equal(tileflowWorldReleaseIdPatternSource, vectors.pattern);
  assert.equal(tileflowWorldReleaseIdMinimumLength, vectors.minimumLength);
  assert.equal(tileflowWorldReleaseIdMaximumLength, vectors.maximumLength);

  for (const value of vectors.valid) {
    assert.equal(isTileflowWorldReleaseId(value), true, value);
    assert.equal(tileflowWorldReleaseIdSchema.safeParse(value).success, true, value);
  }
  for (const value of vectors.invalid) {
    assert.equal(isTileflowWorldReleaseId(value), false, value);
    assert.equal(tileflowWorldReleaseIdSchema.safeParse(value).success, false, value);
  }

  const maximum = `world-v1-${'a'.repeat(119)}`;
  assert.equal(maximum.length, vectors.maximumLength);
  assert.equal(isTileflowWorldReleaseId(maximum), true);
  assert.equal(isTileflowWorldReleaseId(`${maximum}a`), false);
});
