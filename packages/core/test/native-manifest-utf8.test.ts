import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeNativeManifestUtf8, nativeManifestUtf8ByteLength, hasBoundedNativeManifestDepth} from '../src/native-manifest-utf8';

const decoder = new TextDecoder('utf-8', {fatal: true});

test('strict manifest decoding agrees with fatal TextDecoder for all one/two-byte inputs', () => {
	const check = (input: Uint8Array) => {
		let expected: string;
		try { expected = decoder.decode(input); }
		catch { assert.throws(() => decodeNativeManifestUtf8(input)); return; }
		assert.equal(decodeNativeManifestUtf8(input), expected);
	};
	for (let first = 0; first < 256; first++) {
		check(Uint8Array.of(first));
		for (let second = 0; second < 256; second++) check(Uint8Array.of(first, second));
	}
});

test('strict manifest decoding handles scalar boundaries, BOM, invalid and truncated multibyte inputs', () => {
	for (const value of ['', 'ASCII', '\ufefftext', '\ufeff\ufefftext', 'A🌍é漢', '\u0000\ud7ff\ue000', '\ud800', '\udc00']) {
		const encoded = new TextEncoder().encode(value);
		assert.equal(decodeNativeManifestUtf8(encoded), decoder.decode(encoded));
		assert.equal(nativeManifestUtf8ByteLength(value), encoded.byteLength);
	}
	for (const sequence of [[0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
		[0xf5, 0x80, 0x80, 0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x92], [0xe2, 0x28, 0xa1]]) {
		assert.throws(() => decodeNativeManifestUtf8(Uint8Array.from(sequence)));
	}
	for (let offset = 65_532; offset <= 65_539; offset++) {
		const value = ' '.repeat(offset) + '🌍漢é' + ' '.repeat(70_000);
		assert.equal(decodeNativeManifestUtf8(new TextEncoder().encode(value)), value);
	}
});

test('native byte counting agrees with TextEncoder across all Unicode scalars and isolated surrogates', () => {
	for (let start = 0; start <= 0x10ffff; start += 2048) {
		let text = '';
		for (let code = start; code < Math.min(start + 2048, 0x110000); code++) text += String.fromCodePoint(code);
		assert.equal(nativeManifestUtf8ByteLength(text), new TextEncoder().encode(text).byteLength);
	}
	for (let code = 0xd800; code <= 0xdfff; code++) {
		const text = String.fromCharCode(code) + 'x';
		assert.equal(nativeManifestUtf8ByteLength(text), new TextEncoder().encode(text).byteLength);
	}
});

test('the structural guard ignores quoted brackets and enforces the pre-parse depth ceiling', () => {
	assert.equal(hasBoundedNativeManifestDepth('['.repeat(64) + '0' + ']'.repeat(64), 64), true);
	assert.equal(hasBoundedNativeManifestDepth('['.repeat(65) + '0' + ']'.repeat(65), 64), false);
	assert.equal(hasBoundedNativeManifestDepth(JSON.stringify({text: '["\\'.repeat(1000)}), 64), true);
});
