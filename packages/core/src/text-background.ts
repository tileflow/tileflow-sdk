/**
 * Line-fitted text backgrounds through derived glyph stacks.
 *
 * MapLibre paints an SDF text halo wherever a glyph's distance value lies between the halo edge,
 * `(6 - haloWidth / fontScale) / 8`, and the fill edge at 0.75. A derived glyph keeps its source
 * advance and distance field, and also carries a rectangular cell encoded at distance 0.5. With
 * `text-halo-width` equal to `text-size / 6`, the halo edge sits at 0.25, so the halo pass paints
 * exactly those cells: every shaped line receives one strip fitted to its own width. Shaping, line
 * breaking, collision, anchors and fading remain the renderer's, and no renderer change is needed.
 *
 * Cells overlap their neighbours, which keeps strips seamless but requires an opaque colour.
 *
 * Glyph units are MapLibre's 24px em. x is relative to a glyph's pen position and y to the line
 * origin before MapLibre's -17 shaping offset; bitmap row 0, including the 3px border, sits at
 * y = -20 - top.
 */

/** Metrics a derived stack bakes into its glyphs. Every value is in ems. */
export type TileflowLineBackgroundMetrics = {
  /** Must equal the layer's constant `text-letter-spacing`. */
  letterSpacing: number;
  /** Must equal the layer's constant `text-line-height`; rows are exactly this tall. */
  lineHeight: number;
  /** Strip extension beyond the first and last glyph of each line. */
  padding: number;
};

export type TileflowLineBackgroundFontStack = {
  metrics: TileflowLineBackgroundMetrics;
  source: string;
};

export const tileflowLineBackgroundDefaults: Readonly<TileflowLineBackgroundMetrics> =
  Object.freeze({
    letterSpacing: 0,
    lineHeight: 1.2,
    padding: 0.33,
  });

export const tileflowLineBackgroundLimits = Object.freeze({
  letterSpacing: Object.freeze({max: 0.5, min: 0}),
  lineHeight: Object.freeze({max: 3, min: 0.8}),
  padding: Object.freeze({max: 1, min: 0}),
});

/** `text-halo-width` per unit of `text-size` that places the halo edge on the derived cells. */
export const tileflowLineBackgroundHaloRatio = 1 / 6;

const STACK_PATTERN = /^(.+) lines-v1-t(\d{1,3})-l(\d{3,4})-p(\d{1,4})$/u;
const SOURCE_PATTERN = /^[\p{L}\p{N} _.-]+$/u;
const MAX_STACK_LENGTH = 256;
const BORDER = 3;
const TOP_OF_BITMAP = -20;
const STRIP_CENTER = 0.5;
const CELL_VALUE = 128;
const CELL_EDGE = 64;
const CELL_SLOPE = 64;
const CELL_OVERLAP = 0.75;
const MAX_GLYPH_SIDE = 255;

function thousandths(value: number): number {
  return Math.round(value * 1000);
}

/** Rounds metrics to the thousandths a stack name encodes and checks their ranges. */
export function normalizeTileflowLineBackgroundMetrics(
  metrics: Partial<TileflowLineBackgroundMetrics> = {},
): TileflowLineBackgroundMetrics {
  const resolved = {...tileflowLineBackgroundDefaults, ...metrics};
  const normalized = {} as TileflowLineBackgroundMetrics;
  for (const key of ['letterSpacing', 'lineHeight', 'padding'] as const) {
    const value = resolved[key];
    const {max, min} = tileflowLineBackgroundLimits[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(
        `Line-fitted text background ${key} must be a constant number from ${min} to ${max} ems.`,
      );
    }
    normalized[key] = thousandths(value) / 1000;
  }
  return normalized;
}

/** Names the derived stack for one source stack: `<source> lines-v1-t<ls>-l<lh>-p<pad>`. */
export function createTileflowLineBackgroundFontStack(
  source: string,
  metrics: Partial<TileflowLineBackgroundMetrics> = {},
): string {
  if (!SOURCE_PATTERN.test(source) || source !== source.trim()) {
    throw new TypeError(
      `Line-fitted text backgrounds need one exact font stack of letters, numbers, spaces, ` +
        `underscores, dots or hyphens; received "${source}".`,
    );
  }
  if (parseTileflowLineBackgroundFontStack(source)) {
    throw new TypeError(`Font stack "${source}" is already a line-fitted background stack.`);
  }
  const {letterSpacing, lineHeight, padding} = normalizeTileflowLineBackgroundMetrics(metrics);
  const stack =
    `${source} lines-v1-t${thousandths(letterSpacing)}` +
    `-l${thousandths(lineHeight)}-p${thousandths(padding)}`;
  if (stack.length > MAX_STACK_LENGTH) {
    throw new RangeError(
      `Line-fitted text background font stack exceeds ${MAX_STACK_LENGTH} characters.`,
    );
  }
  return stack;
}

/** Recognizes a derived stack name; returns undefined for ordinary or out-of-range names. */
export function parseTileflowLineBackgroundFontStack(
  stack: string,
): TileflowLineBackgroundFontStack | undefined {
  const match = STACK_PATTERN.exec(stack);
  if (!match || stack.length > MAX_STACK_LENGTH || !SOURCE_PATTERN.test(match[1]!))
    return undefined;
  const metrics = {
    letterSpacing: Number(match[2]) / 1000,
    lineHeight: Number(match[3]) / 1000,
    padding: Number(match[4]) / 1000,
  };
  try {
    const normalized = normalizeTileflowLineBackgroundMetrics(metrics);
    // Only the canonical spelling is a derived stack, so caches cannot alias.
    if (
      `lines-v1-t${thousandths(normalized.letterSpacing)}-l${thousandths(normalized.lineHeight)}` +
        `-p${thousandths(normalized.padding)}` !==
      stack.slice(match[1]!.length + 1)
    ) {
      return undefined;
    }
    return {metrics: normalized, source: match[1]!};
  } catch {
    return undefined;
  }
}

/**
 * Scales a lowered MapLibre `text-size` value to the matching `text-halo-width`. Zoom curves keep
 * their stops, because `zoom` may only be the input of a top-level `interpolate` or `step`.
 */
export function scaleTileflowTextSizeForLineBackground(size: unknown): unknown {
  const ratio = tileflowLineBackgroundHaloRatio;
  const scale = (output: unknown) =>
    typeof output === 'number' ? output * ratio : ['*', ratio, output];
  if (size === undefined) return 16 * ratio;
  if (typeof size === 'number') return size * ratio;
  if (Array.isArray(size) && size[0] === 'interpolate' && isZoomInput(size[2])) {
    return size.map((entry, index) => (index >= 4 && index % 2 === 0 ? scale(entry) : entry));
  }
  if (Array.isArray(size) && size[0] === 'step' && isZoomInput(size[1])) {
    return size.map((entry, index) =>
      index === 2 || (index >= 4 && index % 2 === 0) ? scale(entry) : entry,
    );
  }
  return ['*', ratio, size];
}

function isZoomInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

type Glyph = {
  advance: number;
  bitmap: Uint8Array;
  height: number;
  id: number;
  left: number;
  top: number;
  width: number;
};

type GlyphStack = {glyphs: Glyph[]; name: string; range: string};

/**
 * Derives one MapLibre glyph PBF range. Every glyph keeps its id, advance and distance field and
 * gains the background cell; the range and stack names are preserved.
 */
export function deriveTileflowLineBackgroundGlyphs(
  range: Uint8Array,
  metrics: Partial<TileflowLineBackgroundMetrics> = {},
): Uint8Array {
  const normalized = normalizeTileflowLineBackgroundMetrics(metrics);
  const stacks = decodeGlyphStacks(range);
  return encodeGlyphStacks(
    stacks.map((stack) => ({
      ...stack,
      glyphs: stack.glyphs.map((glyph) => deriveGlyph(glyph, normalized)),
    })),
  );
}

function deriveGlyph(glyph: Glyph, metrics: TileflowLineBackgroundMetrics): Glyph {
  const letterSpacing = metrics.letterSpacing * 24;
  const padding = metrics.padding * 24;
  const height = metrics.lineHeight * 24;
  const cell = {
    x0: -letterSpacing / 2 - padding - CELL_OVERLAP,
    x1: glyph.advance + letterSpacing / 2 + padding + CELL_OVERLAP,
    y0: STRIP_CENTER - height / 2 - CELL_OVERLAP,
    y1: STRIP_CENTER + height / 2 + CELL_OVERLAP,
  };
  const ramp = Math.ceil(CELL_EDGE / CELL_SLOPE) + 1;
  const hasBitmap = glyph.width > 0 && glyph.height > 0 && glyph.bitmap.length > 0;
  const sourceWidth = glyph.width + 2 * BORDER;
  const sourceHeight = glyph.height + 2 * BORDER;
  const sourceX = glyph.left - BORDER;
  const sourceY = TOP_OF_BITMAP - glyph.top;
  if (hasBitmap && glyph.bitmap.length !== sourceWidth * sourceHeight) {
    throw new RangeError(`Glyph ${glyph.id} has a bitmap that does not match its metrics.`);
  }

  let x0 = Math.floor(cell.x0 - ramp);
  let x1 = Math.ceil(cell.x1 + ramp);
  let y0 = Math.floor(cell.y0 - ramp);
  let y1 = Math.ceil(cell.y1 + ramp);
  if (hasBitmap) {
    x0 = Math.min(x0, sourceX);
    x1 = Math.max(x1, sourceX + sourceWidth);
    y0 = Math.min(y0, sourceY);
    y1 = Math.max(y1, sourceY + sourceHeight);
  }
  const width = x1 - x0;
  const rows = y1 - y0;
  if (width - 2 * BORDER > MAX_GLYPH_SIDE || rows - 2 * BORDER > MAX_GLYPH_SIDE) {
    throw new RangeError(`Glyph ${glyph.id} would exceed the derived glyph size limit.`);
  }

  const bitmap = new Uint8Array(width * rows);
  for (let row = 0; row < rows; row++) {
    const y = y0 + row + 0.5;
    for (let column = 0; column < width; column++) {
      const x = x0 + column + 0.5;
      // Chebyshev distance to the cell boundary (positive inside) keeps square corners.
      const distance = Math.min(x - cell.x0, cell.x1 - x, y - cell.y0, cell.y1 - y);
      const background = Math.min(CELL_VALUE, Math.max(0, CELL_EDGE + CELL_SLOPE * distance));
      let letter = 0;
      if (hasBitmap) {
        const sourceColumn = x0 + column - sourceX;
        const sourceRow = y0 + row - sourceY;
        if (
          sourceColumn >= 0 &&
          sourceColumn < sourceWidth &&
          sourceRow >= 0 &&
          sourceRow < sourceHeight
        ) {
          letter = glyph.bitmap[sourceRow * sourceWidth + sourceColumn]!;
        }
      }
      bitmap[row * width + column] = Math.round(Math.max(letter, background));
    }
  }

  return {
    advance: glyph.advance,
    bitmap,
    height: rows - 2 * BORDER,
    id: glyph.id,
    left: x0 + BORDER,
    top: TOP_OF_BITMAP - y0,
    width: width - 2 * BORDER,
  };
}

// glyphs.proto: glyphs { repeated fontstack stacks = 1 }
// fontstack { string name = 1; string range = 2; repeated glyph glyphs = 3 }
// glyph { uint32 id = 1; bytes bitmap = 2; uint32 width = 3; uint32 height = 4;
//         sint32 left = 5; sint32 top = 6; uint32 advance = 7 }

class GlyphReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}

  fields(read: (tag: number, reader: GlyphReader) => boolean): void {
    while (this.position < this.bytes.length) {
      const key = this.varint();
      if (!read(Math.floor(key / 8), this)) this.skip(key % 8);
    }
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (this.position >= this.bytes.length || shift > 49) {
        throw new RangeError('Invalid glyph PBF varint.');
      }
      byte = this.bytes[this.position++]!;
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  signed(): number {
    const value = this.varint();
    return value % 2 === 1 ? (value + 1) / -2 : value / 2;
  }

  message(): Uint8Array {
    const length = this.varint();
    const end = this.position + length;
    if (end > this.bytes.length) throw new RangeError('Truncated glyph PBF field.');
    const value = this.bytes.subarray(this.position, end);
    this.position = end;
    return value;
  }

  private skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.position += 8;
    else if (wire === 2) this.message();
    else if (wire === 5) this.position += 4;
    else throw new RangeError(`Unsupported glyph PBF wire type ${wire}.`);
    if (this.position > this.bytes.length) throw new RangeError('Truncated glyph PBF field.');
  }
}

function decodeGlyphStacks(bytes: Uint8Array): GlyphStack[] {
  const stacks: GlyphStack[] = [];
  const text = new TextDecoder();
  new GlyphReader(bytes).fields((tag, reader) => {
    if (tag !== 1) return false;
    const stack: GlyphStack = {glyphs: [], name: '', range: ''};
    new GlyphReader(reader.message()).fields((stackTag, stackReader) => {
      if (stackTag === 1) stack.name = text.decode(stackReader.message());
      else if (stackTag === 2) stack.range = text.decode(stackReader.message());
      else if (stackTag === 3) stack.glyphs.push(decodeGlyph(stackReader.message()));
      else return false;
      return true;
    });
    stacks.push(stack);
    return true;
  });
  return stacks;
}

function decodeGlyph(bytes: Uint8Array): Glyph {
  const glyph: Glyph = {
    advance: 0,
    bitmap: new Uint8Array(0),
    height: 0,
    id: 0,
    left: 0,
    top: 0,
    width: 0,
  };
  new GlyphReader(bytes).fields((tag, reader) => {
    if (tag === 1) glyph.id = reader.varint();
    else if (tag === 2) glyph.bitmap = reader.message().slice();
    else if (tag === 3) glyph.width = reader.varint();
    else if (tag === 4) glyph.height = reader.varint();
    else if (tag === 5) glyph.left = reader.signed();
    else if (tag === 6) glyph.top = reader.signed();
    else if (tag === 7) glyph.advance = reader.varint();
    else return false;
    return true;
  });
  return glyph;
}

class GlyphWriter {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  varint(value: number): void {
    const bytes: number[] = [];
    let remaining = value;
    while (remaining >= 0x80) {
      bytes.push((remaining % 0x80) | 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    bytes.push(remaining);
    this.raw(Uint8Array.from(bytes));
  }

  signed(value: number): void {
    this.varint(value < 0 ? -2 * value - 1 : 2 * value);
  }

  key(tag: number, wire: number): void {
    this.varint(tag * 8 + wire);
  }

  message(tag: number, bytes: Uint8Array): void {
    this.key(tag, 2);
    this.varint(bytes.length);
    this.raw(bytes);
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  private raw(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }
}

function encodeGlyphStacks(stacks: readonly GlyphStack[]): Uint8Array {
  const text = new TextEncoder();
  const root = new GlyphWriter();
  for (const stack of stacks) {
    const writer = new GlyphWriter();
    writer.message(1, text.encode(stack.name));
    writer.message(2, text.encode(stack.range));
    for (const glyph of stack.glyphs) {
      const glyphWriter = new GlyphWriter();
      glyphWriter.key(1, 0);
      glyphWriter.varint(glyph.id);
      if (glyph.bitmap.length > 0) glyphWriter.message(2, glyph.bitmap);
      glyphWriter.key(3, 0);
      glyphWriter.varint(glyph.width);
      glyphWriter.key(4, 0);
      glyphWriter.varint(glyph.height);
      glyphWriter.key(5, 0);
      glyphWriter.signed(glyph.left);
      glyphWriter.key(6, 0);
      glyphWriter.signed(glyph.top);
      glyphWriter.key(7, 0);
      glyphWriter.varint(glyph.advance);
      writer.message(3, glyphWriter.finish());
    }
    root.message(1, writer.finish());
  }
  return root.finish();
}
