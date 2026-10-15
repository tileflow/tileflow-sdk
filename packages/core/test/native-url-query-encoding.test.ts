import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {nativeUrlCodecMaximumLength, percentEncodeAfterEncoding} from '../src/native-url-utf8';

const require = createRequire(import.meta.url);
const providerRequire = createRequire(require.resolve('whatwg-url/package.json'));
const upstream = providerRequire('@exodus/bytes/whatwg.js') as {
  percentEncodeAfterEncoding: (encoding: string, input: string, set: string) => string;
};

for (const set of [' "#<>', ' "#\'<>']) {
  test(`matches the upstream UTF-8 query encoder for ${JSON.stringify(set)}`, () => {
    const inputs = [
      '',
      'a b+c%20d&e=f/?#"<>\'',
      '\ufeff日本語😀a\ud800b\udc00',
      Array.from({length: 256}, (_, index) => String.fromCharCode(index)).join(''),
    ];
    for (const input of inputs) {
      assert.equal(
        percentEncodeAfterEncoding('utf-8', input, set),
        upstream.percentEncodeAfterEncoding('utf-8', input, set),
      );
    }
  });
}

test('matches upstream for every Unicode scalar in bounded batches', () => {
  let input = '';
  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    input += String.fromCodePoint(point);
    if (input.length >= 4096 || point === 0x10ffff) {
      assert.equal(
        percentEncodeAfterEncoding('utf-8', input, ' "#\'<>'),
        upstream.percentEncodeAfterEncoding('utf-8', input, ' "#\'<>'),
      );
      input = '';
    }
  }
});

test('rejects legacy encodings and bounds query encoding work', () => {
  for (const encoding of ['windows-1252', 'shift_jis', 'UTF-8', '']) {
    assert.throws(() => percentEncodeAfterEncoding(encoding, 'private', ' "#<>'), {
      name: 'TypeError',
      message: 'Native URL queries require UTF-8.',
    });
  }
  assert.equal(
    percentEncodeAfterEncoding('utf-8', 'a'.repeat(nativeUrlCodecMaximumLength), ' "#<>').length,
    nativeUrlCodecMaximumLength,
  );
  assert.throws(
    () => percentEncodeAfterEncoding('utf-8', 'a'.repeat(nativeUrlCodecMaximumLength + 1), ' "#<>'),
    {name: 'RangeError'},
  );
});
