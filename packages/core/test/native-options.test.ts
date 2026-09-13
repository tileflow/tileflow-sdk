import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTileflowNativeManifestUrl,
  resolveTileflowNativeResourceUrl,
  TileflowNativeUrlError,
  type TileflowNativeUrlErrorCode,
  type TileflowNativeUrlField,
} from '../src/native.js';

const manifestUrl = 'https://maps.example.test/a';
const secret = 'do-not-print-options-input';

function expectOptionsError(
  operation: () => unknown,
  code: TileflowNativeUrlErrorCode,
  field: TileflowNativeUrlField,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof TileflowNativeUrlError);
    assert.ok(error instanceof TypeError);
    assert.equal(error.name, 'TileflowNativeUrlError');
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    assert.equal(error.cause, undefined);
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    assert.equal(error.stack?.includes(secret), false);
    return true;
  });
}

test('reports a missing resource options argument as an invalid document URL', () => {
  expectOptionsError(
    // @ts-expect-error Resource options remain required for TypeScript callers.
    () => resolveTileflowNativeResourceUrl('a'),
    'NATIVE_URL_INVALID',
    'documentUrl',
  );
});

test('reports undefined resource options as an invalid document URL', () => {
  expectOptionsError(
    // @ts-expect-error Explicit undefined does not supply the required document URL.
    () => resolveTileflowNativeResourceUrl('a', undefined),
    'NATIVE_URL_INVALID',
    'documentUrl',
  );
});

test('reports null resource options as an invalid document URL', () => {
  expectOptionsError(
    // @ts-expect-error JavaScript callers can pass null despite the object type.
    () => resolveTileflowNativeResourceUrl('a', null),
    'NATIVE_URL_INVALID',
    'documentUrl',
  );
});

test('reports null manifest options through the development-origin field', () => {
  expectOptionsError(
    // @ts-expect-error Omitted options are supported, but null is not an options object.
    () => resolveTileflowNativeManifestUrl(manifestUrl, null),
    'NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID',
    'developmentOrigin',
  );
});

test('keeps missing document fields consistent with missing resource options', () => {
  expectOptionsError(
    // @ts-expect-error Resource options must still declare documentUrl.
    () => resolveTileflowNativeResourceUrl('a', {}),
    'NATIVE_URL_INVALID',
    'documentUrl',
  );
});

for (const [label, options] of [
  ['string', secret],
  ['number', 42],
  ['boolean', false],
  ['array', [secret]],
] as const) {
  test(`rejects ${label} options without echoing their contents`, () => {
    expectOptionsError(
      // @ts-expect-error Exercise runtime input without widening the public signature.
      () => resolveTileflowNativeResourceUrl(`a?key=${secret}`, options),
      'NATIVE_URL_INVALID',
      'documentUrl',
    );
    expectOptionsError(
      // @ts-expect-error Exercise runtime input without widening the public signature.
      () => resolveTileflowNativeManifestUrl(`${manifestUrl}?key=${secret}`, options),
      'NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID',
      'developmentOrigin',
    );
  });
}

test('preserves default manifest options and valid frozen options', () => {
  assert.equal(resolveTileflowNativeManifestUrl(manifestUrl), manifestUrl);
  assert.equal(resolveTileflowNativeManifestUrl(manifestUrl, undefined), manifestUrl);
  assert.equal(resolveTileflowNativeManifestUrl(manifestUrl, Object.freeze({})), manifestUrl);
  const options = Object.freeze({documentUrl: manifestUrl});
  assert.equal(
    resolveTileflowNativeResourceUrl('style.json', options),
    'https://maps.example.test/style.json',
  );
  assert.deepEqual(options, {documentUrl: manifestUrl});
});
