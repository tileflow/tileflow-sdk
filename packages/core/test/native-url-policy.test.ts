import assert from 'node:assert/strict';
import test from 'node:test';
import {URL as NodeURL} from 'node:url';
import {createNativeUrlPolicy} from '../src/native-url-policy';
import {nativeUrlCodecMaximumLength} from '../src/native-url-utf8';

test('bounds protected placeholders even when the owner contains a long sentinel collision', () => {
  let largest = 0;
  const policy = createNativeUrlPolicy((value, base) => {
    largest = Math.max(largest, value.length, base?.length ?? 0);
    return base === undefined ? new NodeURL(value) : new NodeURL(value, base);
  });
  const documentUrl = `https://maps.example.test/__tileflow_native_template_${'_'.repeat(1800)}/style.json`;
  const reference = '/' + '{x}'.repeat(600);
  assert.equal(
    policy.resolveTileflowNativeResourceUrl(reference, {documentUrl, template: 'tile'}),
    'https://maps.example.test' + reference,
  );
  assert.ok(largest < 24_000);
  assert.ok(largest < nativeUrlCodecMaximumLength);
});

test('keeps the private host composition and public policy errors deterministic', () => {
  const policy = createNativeUrlPolicy((value, base) =>
    base === undefined ? new NodeURL(value) : new NodeURL(value, base),
  );
  const input = 'http://bücher.example.test:80/a/style.json';
  assert.equal(
    policy.resolveTileflowNativeManifestUrl(input, {
      developmentOrigin: 'http://xn--bcher-kva.example.test',
    }),
    'http://xn--bcher-kva.example.test/a/style.json',
  );
  assert.throws(
    () =>
      policy.resolveTileflowNativeResourceUrl('../sprite', {
        documentUrl: input,
        developmentOrigin: 'http://other.example.test',
      }),
    {name: 'TileflowNativeUrlError', code: 'NATIVE_URL_HTTPS_REQUIRED', field: 'documentUrl'},
  );
});
