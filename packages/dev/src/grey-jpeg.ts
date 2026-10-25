// A small baseline JPEG encoder for one-channel images: the standard luminance quantisation table
// scaled by quality as libjpeg scales it, and Huffman tables fitted to each image. Synchronous, so model
// preparation can call it; deterministic, so prepared files keep their hashes.

const zigzag = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// ITU T.81 Annex K: luminance quantisation, in natural order.
const luminance = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

type Codes = {code: number[]; size: number[]};

function huffman(counts: readonly number[], symbols: readonly number[]): Codes {
  const out: Codes = {code: [], size: []};
  let code = 0,
    k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]!; i++) {
      out.code[symbols[k]!] = code;
      out.size[symbols[k]!] = length;
      code++;
      k++;
    }
    code <<= 1;
  }
  return out;
}

// Cosines of the 8-point DCT, cos((2x + 1) u π / 16), with the orthonormal scale folded in.
const basis = Array.from({length: 64}, (_, i) => {
  const u = i >> 3,
    x = i & 7;
  return (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

/** A baseline JPEG of one 8-bit channel, rows from the top; quality 1 to 100 as libjpeg uses it. */
export function encodeGreyJpeg(
  pixels: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Uint8Array {
  if (!(width > 0 && height > 0 && width <= 65_535 && height <= 65_535))
    throw new RangeError('A JPEG is 1 to 65,535 pixels on each side.');
  if (pixels.length !== width * height) throw new RangeError('One byte a pixel is required.');
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  const table = luminance.map((value) =>
    Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))),
  );

  // First pass: quantised coefficients as Huffman symbols and their extra bits.
  const symbols: number[] = []; // (table << 8) | symbol, table 0 for DC and 1 for AC
  const extra: number[] = []; // (value << 5) | size, size zero for none
  const frequencies = [new Array<number>(257).fill(0), new Array<number>(257).fill(0)];
  const emit = (table: 0 | 1, symbol: number, value = 0, size = 0) => {
    symbols.push((table << 8) | symbol);
    extra.push(size ? ((value < 0 ? value + (1 << size) - 1 : value) << 5) | size : 0);
    frequencies[table]![symbol]! += 1;
  };
  const magnitude = (value: number) => {
    let size = 0;
    for (let v = Math.abs(value); v > 0; v >>= 1) size++;
    return size;
  };
  const block = new Float64Array(64);
  const row = new Float64Array(64);
  const coefficients = new Int32Array(64);
  let previous = 0;
  for (let by = 0; by < height; by += 8)
    for (let bx = 0; bx < width; bx += 8) {
      // Edge blocks repeat their last row and column, so padding adds no false edge.
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          block[y * 8 + x] =
            pixels[Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)]! - 128;
      for (let y = 0; y < 8; y++)
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let x = 0; x < 8; x++) sum += block[y * 8 + x]! * basis[u * 8 + x]!;
          row[y * 8 + u] = sum;
        }
      for (let v = 0; v < 8; v++)
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let y = 0; y < 8; y++) sum += row[y * 8 + u]! * basis[v * 8 + y]!;
          coefficients[v * 8 + u] = Math.round(sum / table[v * 8 + u]!);
        }
      const dc = coefficients[0]! - previous;
      previous = coefficients[0]!;
      const dcSize = magnitude(dc);
      emit(0, dcSize, dc, dcSize);
      let zeros = 0;
      for (let k = 1; k < 64; k++) {
        const value = coefficients[zigzag[k]!]!;
        if (value === 0) {
          zeros++;
          continue;
        }
        for (; zeros > 15; zeros -= 16) emit(1, 0xf0);
        const size = magnitude(value);
        emit(1, (zeros << 4) | size, value, size);
        zeros = 0;
      }
      if (zeros > 0) emit(1, 0x00);
    }

  // Huffman tables fitted to this image's symbols.
  const tables = frequencies.map(optimalTable);
  const codes = tables.map(({counts, values}) => huffman(counts, values));

  const out: number[] = [];
  const word = (value: number) => out.push((value >> 8) & 0xff, value & 0xff);
  word(0xffd8);
  word(0xffdb);
  word(67);
  out.push(0, ...zigzag.map((at) => table[at]!));
  word(0xffc0);
  word(11);
  out.push(8);
  word(height);
  word(width);
  out.push(1, 1, 0x11, 0);
  for (const [index, {counts, values}] of tables.entries()) {
    word(0xffc4);
    word(3 + 16 + values.length);
    out.push(index << 4, ...counts, ...values);
  }
  word(0xffda);
  word(8);
  out.push(1, 1, 0x00, 0, 63, 0);

  // Entropy-coded data, with a zero after every 0xFF byte.
  let bits = 0,
    count = 0;
  const put = (code: number, size: number) => {
    bits = (bits << size) | (code & ((1 << size) - 1));
    count += size;
    while (count >= 8) {
      const byte = (bits >> (count - 8)) & 0xff;
      out.push(byte);
      if (byte === 0xff) out.push(0);
      count -= 8;
    }
    bits &= (1 << count) - 1;
  };
  for (let i = 0; i < symbols.length; i++) {
    const own = codes[symbols[i]! >> 8]!;
    const symbol = symbols[i]! & 0xff;
    put(own.code[symbol]!, own.size[symbol]!);
    const size = extra[i]! & 31;
    if (size) put(extra[i]! >> 5, size);
  }
  if (count > 0) put(0x7f, 8 - count);
  word(0xffd9);
  return Uint8Array.from(out);
}

// ITU T.81 Annex K.2: code lengths from frequencies, limited to 16 bits, with a reserved
// all-ones code so no real code is made only of ones.
function optimalTable(frequencies: readonly number[]): {counts: number[]; values: number[]} {
  const freq = [...frequencies];
  freq[256] = 1;
  const codesize = new Array<number>(257).fill(0);
  const others = new Array<number>(257).fill(-1);
  for (;;) {
    let v1 = -1,
      v2 = -1;
    for (let i = 0; i <= 256; i++) if (freq[i]! > 0 && (v1 < 0 || freq[i]! <= freq[v1]!)) v1 = i;
    for (let i = 0; i <= 256; i++)
      if (freq[i]! > 0 && i !== v1 && (v2 < 0 || freq[i]! <= freq[v2]!)) v2 = i;
    if (v2 < 0) break;
    freq[v1]! += freq[v2]!;
    freq[v2] = 0;
    for (codesize[v1]!++; others[v1]! >= 0; codesize[v1]!++) v1 = others[v1]!;
    others[v1] = v2;
    for (codesize[v2]!++; others[v2]! >= 0; codesize[v2]!++) v2 = others[v2]!;
  }
  const bits = new Array<number>(33).fill(0);
  for (let i = 0; i <= 256; i++) if (codesize[i]) bits[codesize[i]!]!++;
  for (let i = 32; i > 16; i--)
    while (bits[i]! > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i]! -= 2;
      bits[i - 1]!++;
      bits[j + 1]! += 2;
      bits[j]!--;
    }
  let last = 16;
  while (bits[last] === 0) last--;
  bits[last]!--; // drop the reserved code
  const values: number[] = [];
  for (let length = 1; length <= 32; length++)
    for (let symbol = 0; symbol < 256; symbol++)
      if (codesize[symbol] === length) values.push(symbol);
  return {counts: bits.slice(1, 17), values};
}
