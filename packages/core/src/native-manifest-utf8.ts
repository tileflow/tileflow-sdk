import {utf8DecodeWithoutBOM, nativeUrlCodecMaximumLength} from './native-url-utf8';

/** Byte count with TextEncoder replacement semantics, without allocating an encoded copy. */
export function nativeManifestUtf8ByteLength(input: string): number {
	let bytes = 0;
	for (let index = 0; index < input.length; index++) {
		const value = input.charCodeAt(index);
		if (value <= 0x7f) bytes++;
		else if (value <= 0x7ff) bytes += 2;
		else if (value >= 0xd800 && value <= 0xdbff && input.charCodeAt(index + 1) >= 0xdc00 && input.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4; index++;
		} else bytes += 3;
	}
	return bytes;
}

/** Validate first, then reuse the URL codec on code-point-aligned bounded slices. */
export function decodeNativeManifestUtf8(input: Uint8Array): string {
	let remaining = 0;
	let lower = 0x80;
	let upper = 0xbf;
	for (const byte of input) {
		if (remaining === 0) {
			if (byte <= 0x7f) continue;
			if (byte >= 0xc2 && byte <= 0xdf) remaining = 1;
			else if (byte >= 0xe0 && byte <= 0xef) {
				remaining = 2;
				if (byte === 0xe0) lower = 0xa0;
				if (byte === 0xed) upper = 0x9f;
			} else if (byte >= 0xf0 && byte <= 0xf4) {
				remaining = 3;
				if (byte === 0xf0) lower = 0x90;
				if (byte === 0xf4) upper = 0x8f;
			} else throw new TypeError('Invalid manifest UTF-8.');
		} else {
			if (byte < lower || byte > upper) throw new TypeError('Invalid manifest UTF-8.');
			remaining--;
			lower = 0x80; upper = 0xbf;
		}
	}
	if (remaining) throw new TypeError('Invalid manifest UTF-8.');
	const parts: string[] = [];
	let offset = 0;
	while (offset < input.byteLength) {
		let end = Math.min(offset + nativeUrlCodecMaximumLength, input.byteLength);
		while (end < input.byteLength && (input[end]! & 0xc0) === 0x80) end--;
		parts.push(utf8DecodeWithoutBOM(input.subarray(offset, end)));
		offset = end;
	}
	const text = parts.join('');
	// Match the canonical host reader's fatal TextDecoder default: strip one leading BOM.
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Limit structural work before JSON.parse and the canonical object/schema walk. */
export function hasBoundedNativeManifestDepth(text: string, maximumDepth: number): boolean {
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') quoted = false;
		} else if (character === '"') quoted = true;
		else if (character === '[' || character === '{') {
			if (++depth > maximumDepth) return false;
		} else if (character === ']' || character === '}') depth--;
	}
	return true;
}
