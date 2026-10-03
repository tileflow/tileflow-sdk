/** Private, non-streaming UTF-8 codec. No ambient Encoding API or global installation. */
export const nativeUrlCodecMaximumLength = 65_536;

function checkLength(length: number): void {
  if (length > nativeUrlCodecMaximumLength) {
    throw new RangeError('Native URL codec input exceeds its limit.');
  }
}

/** TextEncoder's replacement semantics for a string of UTF-16 code units. */
export function utf8Encode(input: string): Uint8Array {
  checkLength(input.length);
  const output = new Uint8Array(input.length * 3);
  let offset = 0;
  for (let index = 0; index < input.length; index++) {
    let point = input.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + next - 0xdc00;
        index++;
      } else point = 0xfffd;
    } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;

    if (point <= 0x7f) output[offset++] = point;
    else if (point <= 0x7ff) {
      output[offset++] = 0xc0 | (point >>> 6);
      output[offset++] = 0x80 | (point & 0x3f);
    } else if (point <= 0xffff) {
      output[offset++] = 0xe0 | (point >>> 12);
      output[offset++] = 0x80 | ((point >>> 6) & 0x3f);
      output[offset++] = 0x80 | (point & 0x3f);
    } else {
      output[offset++] = 0xf0 | (point >>> 18);
      output[offset++] = 0x80 | ((point >>> 12) & 0x3f);
      output[offset++] = 0x80 | ((point >>> 6) & 0x3f);
      output[offset++] = 0x80 | (point & 0x3f);
    }
  }
  return output.slice(0, offset);
}

/** TextDecoder('utf-8', {ignoreBOM:true}): replace errors and preserve every BOM. */
export function utf8DecodeWithoutBOM(input: Uint8Array): string {
  checkLength(input.byteLength);
  const output: string[] = [];
  let point = 0;
  let needed = 0;
  let seen = 0;
  let lower = 0x80;
  let upper = 0xbf;

  for (let index = 0; index < input.byteLength; index++) {
    const byte = input[index]!;
    if (needed === 0) {
      if (byte <= 0x7f) output.push(String.fromCharCode(byte));
      else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        point = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        needed = 2;
        point = byte & 0x0f;
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        needed = 3;
        point = byte & 0x07;
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
      } else output.push('\ufffd');
      continue;
    }

    if (byte < lower || byte > upper) {
      point = needed = seen = 0;
      lower = 0x80;
      upper = 0xbf;
      output.push('\ufffd');
      // Reprocess the offending byte as a new lead; ASCII delimiters must not disappear.
      index--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    point = (point << 6) | (byte & 0x3f);
    if (++seen === needed) {
      output.push(String.fromCodePoint(point));
      point = needed = seen = 0;
    }
  }
  if (needed !== 0) output.push('\ufffd');
  return output.join('');
}
