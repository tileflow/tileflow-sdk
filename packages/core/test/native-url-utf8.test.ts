import assert from 'node:assert/strict';
import test from 'node:test';
import {TextDecoder, TextEncoder} from 'node:util';
import {
  nativeUrlCodecMaximumLength,
  utf8DecodeWithoutBOM,
  utf8Encode,
} from '../src/native-url-utf8';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {ignoreBOM: true});

function checkString(value: string): void {
  const bytes = encoder.encode(value);
  assert.deepEqual(utf8Encode(value), bytes);
  assert.equal(utf8DecodeWithoutBOM(bytes), decoder.decode(bytes));
}

function checkBytes(bytes: Uint8Array): void {
  assert.equal(utf8DecodeWithoutBOM(bytes), decoder.decode(bytes), Array.from(bytes).join(','));
}

test('encodes and decodes every Unicode scalar in bounded batches', () => {
  let batch = '';
  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    batch += String.fromCodePoint(point);
    if (batch.length >= 4096) {
      checkString(batch);
      batch = '';
    }
  }
  checkString(batch);
});

test('replaces every isolated UTF-16 surrogate and preserves adjacent valid pairs', () => {
  for (let unit = 0xd800; unit <= 0xdfff; unit++) {
    for (const value of [
      String.fromCharCode(unit),
      `a${String.fromCharCode(unit)}b`,
      `\ud800${String.fromCharCode(unit)}\udfff`,
      `${String.fromCharCode(unit)}\ud800A\udc00`,
    ]) {
      checkString(value);
    }
  }
  for (const value of [
    '',
    '\ufeff',
    '\ufeffa\ufeff',
    '\u0000',
    'é',
    'e\u0301',
    '日本語',
    'مثال',
    'a\ud800\ud800b\udc00\udc00c',
    '😀/💩?a=𐀀',
  ])
    checkString(value);
});

test('matches non-fatal UTF-8 decoding for every byte and every two-byte sequence', () => {
  for (let first = 0; first < 256; first++) {
    checkBytes(Uint8Array.of(first));
    for (let second = 0; second < 256; second++) checkBytes(Uint8Array.of(first, second));
  }
});

test('preserves BOMs and reprocesses invalid continuation bytes rather than hiding delimiters', () => {
  const cases = [
    [0xef, 0xbb, 0xbf],
    [0xef, 0xbb, 0xbf, 0x61, 0xef, 0xbb, 0xbf],
    [0xef, 0xbb],
    [0xc0, 0xaf],
    [0xe0, 0x80, 0xaf],
    [0xf0, 0x80, 0x80, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xf0, 0x9f, 0x92],
    [0xe1, 0x80, 0x2f],
    [0xe0, 0x9f, 0x40],
    [0xf0, 0x8f, 0x3a],
    [0xe1, 0xc2, 0xa9],
    [0xc2, 0x22],
    [0xf4, 0x8f, 0xbf, 0xbf],
  ];
  for (const bytes of cases) checkBytes(Uint8Array.from(bytes));
  assert.equal(utf8DecodeWithoutBOM(Uint8Array.of(0xef, 0xbb, 0xbf)), '\ufeff');
  assert.equal(utf8DecodeWithoutBOM(Uint8Array.of(0xe1, 0x80, 0x2f)), '\ufffd/');
});

test('covers three- and four-byte boundary states and deterministic mixed input', () => {
  const boundaries = [
    0, 0x2f, 0x3a, 0x40, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xdf, 0xe0, 0xf0, 0xff,
  ];
  for (let lead = 0xe0; lead <= 0xf4; lead++) {
    for (const a of boundaries)
      for (const b of boundaries) {
        checkBytes(Uint8Array.of(lead, a, b));
        for (const c of boundaries) checkBytes(Uint8Array.of(lead, a, b, c));
      }
  }
  let state = 0x12345678;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  for (let sample = 0; sample < 4096; sample++) {
    const bytes = new Uint8Array(next() % 64);
    for (let index = 0; index < bytes.length; index++) bytes[index] = next() >>> 24;
    checkBytes(bytes);
  }
});

test('respects view offsets and bounded codec work without mutating input', () => {
  const bytes = Uint8Array.of(0xff, 0xef, 0xbb, 0xbf, 0xc2, 0xa9, 0xff);
  const before = bytes.slice();
  assert.equal(utf8DecodeWithoutBOM(bytes.subarray(1, 6)), '\ufeff©');
  assert.deepEqual(bytes, before);
  const maximum = nativeUrlCodecMaximumLength;
  assert.equal(maximum, 65_536);
  assert.equal(utf8Encode('a'.repeat(maximum)).length, maximum);
  assert.equal(utf8DecodeWithoutBOM(new Uint8Array(maximum)).length, maximum);
  for (const operation of [
    () => utf8Encode('a'.repeat(maximum + 1)),
    () => utf8DecodeWithoutBOM(new Uint8Array(maximum + 1)),
  ]) {
    assert.throws(operation, {
      name: 'RangeError',
      message: 'Native URL codec input exceeds its limit.',
    });
  }
});
