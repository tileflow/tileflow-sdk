import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTileflowNativeManifestUrl,
  resolveTileflowNativeResourceUrl,
  TileflowNativeUrlError,
} from '../src/native.js';

const documentUrl = 'https://maps.example.test/manifest.json';
const templateHosts = ['%7Bz%7D.example.test', '%7bz%7d.example.test', '｛z｝.example.test'];

for (const host of templateHosts) {
  test(`rejects placeholders revealed by hostname normalization: ${host}`, () => {
    const url = `https://${host}/tiles.json`;
    for (const [field, operation] of [
      ['manifestUrl', () => resolveTileflowNativeManifestUrl(url)],
      ['documentUrl', () => resolveTileflowNativeResourceUrl('/style.json', {documentUrl: url})],
      ['resourceUrl', () => resolveTileflowNativeResourceUrl(url, {documentUrl})],
      ['resourceUrl', () => resolveTileflowNativeResourceUrl(url, {documentUrl, template: 'tile'})],
    ] as const) {
      assert.throws(operation, (error: unknown) => {
        assert.ok(error instanceof TileflowNativeUrlError);
        assert.equal(error.code, 'NATIVE_URL_TEMPLATE_INVALID');
        assert.equal(error.field, field);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  });
}

for (const host of ['%2A.example.test', '＊.example.test', ...templateHosts]) {
  test(`rejects a non-literal development hostname after normalization: ${host}`, () => {
    const options = {developmentOrigin: `http://${host}`};
    for (const operation of [
      () => resolveTileflowNativeManifestUrl(documentUrl, options),
      () => resolveTileflowNativeResourceUrl('/style.json', {documentUrl, ...options}),
    ]) {
      assert.throws(operation, (error: unknown) => {
        assert.ok(error instanceof TileflowNativeUrlError);
        assert.equal(error.code, 'NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID');
        assert.equal(error.field, 'developmentOrigin');
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  });
}

test('preserves ordinary escaped and internationalized hostnames', () => {
  assert.equal(
    resolveTileflowNativeManifestUrl('https://m%61ps.example.test/manifest.json'),
    documentUrl,
  );
  assert.equal(
    resolveTileflowNativeResourceUrl('https://bücher.example.test/{z}', {
      documentUrl,
      template: 'tile',
    }),
    'https://xn--bcher-kva.example.test/{z}',
  );
  assert.equal(
    resolveTileflowNativeManifestUrl('http://bücher.example.test/manifest.json', {
      developmentOrigin: 'http://xn--bcher-kva.example.test',
    }),
    'http://xn--bcher-kva.example.test/manifest.json',
  );
});
