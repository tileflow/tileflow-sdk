import {field, geometryType, headerWords} from './spool';

export const tileExtent = 4096;
export const tileBufferUnits = 64;
const extentBits = 12;
const markSize = 2;

/** Append-only byte buffer with the protobuf primitives vector tiles need. */
class ByteWriter {
  bytes = new Uint8Array(4096);
  length = 0;

  #ensure(size: number): void {
    if (this.length + size <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + size));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }

  byte(value: number): void {
    this.#ensure(1);
    this.bytes[this.length] = value;
    this.length += 1;
  }

  varint(value: number): void {
    this.#ensure(10);
    while (value >= 0x80) {
      this.bytes[this.length] = (value % 0x80) | 0x80;
      this.length += 1;
      value = Math.floor(value / 0x80);
    }
    this.bytes[this.length] = value;
    this.length += 1;
  }

  raw(source: Uint8Array, start: number, end: number): void {
    this.#ensure(end - start);
    this.bytes.set(source.subarray(start, end), this.length);
    this.length += end - start;
  }

  string(value: string): void {
    const encoded = Buffer.from(value, 'utf8');
    this.varint(encoded.length);
    this.raw(encoded, 0, encoded.length);
  }

  reset(): void {
    this.length = 0;
  }
}

export function varintLength(value: number): number {
  let length = 1;
  while (value >= 0x80) {
    length += 1;
    value = Math.floor(value / 0x80);
  }
  return length;
}

/** Encodes one single-layer vector tile; instances are reused to avoid per-tile allocation. */
export class TileEncoder {
  readonly #features = new ByteWriter();
  readonly #tags = new ByteWriter();
  readonly #geometry = new ByteWriter();
  readonly #values = new ByteWriter();
  readonly #output = new ByteWriter();
  readonly #keyIndex: Int32Array;
  /** Open-addressing table of value indexes, so interning allocates nothing per feature. */
  #valueSlots = new Int32Array(1 << 12).fill(-1);
  #valueStarts: number[] = [];
  #valueLengths: number[] = [];
  #usedKeys: number[] = [];
  #shift = 0;
  #originX = 0;
  #originY = 0;
  #tolerance = 0;
  #minimumArea = 0;
  #keepCollapsedLines = false;
  #scratch = new Int32Array(8192);
  #keep = new Uint8Array(4096);
  #stack: number[] = [];
  featureCount = 0;

  constructor(
    private readonly layer: string,
    private readonly keys: readonly string[],
  ) {
    this.#keyIndex = new Int32Array(keys.length).fill(-1);
  }

  /** The number of bytes `finish` would need, ignoring the small key and header overhead. */
  get approximateBytes(): number {
    return this.#features.length + this.#values.length;
  }

  begin(
    z: number,
    x: number,
    y: number,
    options: {keepCollapsedLines: boolean; minimumArea: number; tolerance: number},
  ): void {
    this.#features.reset();
    this.#values.reset();
    if (this.#valueStarts.length > 0) this.#valueSlots.fill(-1);
    this.#valueStarts.length = 0;
    this.#valueLengths.length = 0;
    for (const key of this.#usedKeys) this.#keyIndex[key] = -1;
    this.#usedKeys = [];
    this.featureCount = 0;
    this.#shift = 31 - z - extentBits;
    this.#originX = x * 2 ** (31 - z);
    this.#originY = y * 2 ** (31 - z);
    this.#tolerance = options.tolerance;
    this.#minimumArea = options.minimumArea;
    this.#keepCollapsedLines = options.keepCollapsedLines;
  }

  /** Add one record. Returns false when its geometry collapses at this zoom and has no mark. */
  add(words: Int32Array, offset: number): boolean {
    this.#geometry.reset();
    const type = words[offset + field.type];
    const partCount = words[offset + field.parts];
    const pointCount = words[offset + field.points];
    const partsStart = offset + headerWords;
    const coordinatesStart = partsStart + partCount;
    const encoded =
      type === geometryType.point
        ? this.#encodePoints(words, coordinatesStart, pointCount)
        : this.#encodeParts(type, words, partsStart, partCount, coordinatesStart);
    if (!encoded) return false;

    this.#tags.reset();
    this.#encodeTags(words, coordinatesStart + pointCount * 2, words[offset + field.propertyBytes]);

    const id = idOf(words, offset);
    const body =
      (id > 0 ? 1 + varintLength(id - 1) : 0) +
      (this.#tags.length > 0 ? 1 + varintLength(this.#tags.length) + this.#tags.length : 0) +
      2 +
      1 +
      varintLength(this.#geometry.length) +
      this.#geometry.length;
    const features = this.#features;
    features.byte(0x12);
    features.varint(body);
    if (id > 0) {
      features.byte(0x08);
      features.varint(id - 1);
    }
    if (this.#tags.length > 0) {
      features.byte(0x12);
      features.varint(this.#tags.length);
      features.raw(this.#tags.bytes, 0, this.#tags.length);
    }
    features.byte(0x18);
    features.byte(type);
    features.byte(0x22);
    features.varint(this.#geometry.length);
    features.raw(this.#geometry.bytes, 0, this.#geometry.length);
    this.featureCount += 1;
    return true;
  }

  finish(): Uint8Array {
    const output = this.#output;
    output.reset();
    const keySection = new ByteWriter();
    for (const key of this.#usedKeys) {
      keySection.byte(0x1a);
      keySection.string(this.keys[key]);
    }
    const name = Buffer.from(this.layer, 'utf8');
    const layerLength =
      2 +
      1 +
      varintLength(name.length) +
      name.length +
      this.#features.length +
      keySection.length +
      this.#values.length +
      3;
    output.byte(0x1a);
    output.varint(layerLength);
    output.byte(0x78);
    output.byte(2);
    output.byte(0x0a);
    output.varint(name.length);
    output.raw(name, 0, name.length);
    output.raw(this.#features.bytes, 0, this.#features.length);
    output.raw(keySection.bytes, 0, keySection.length);
    output.raw(this.#values.bytes, 0, this.#values.length);
    output.byte(0x28);
    output.varint(tileExtent);
    return output.bytes.slice(0, output.length);
  }

  #encodeTags(words: Int32Array, start: number, byteLength: number): void {
    if (byteLength === 0) return;
    const bytes = new Uint8Array(words.buffer, words.byteOffset + start * 4, byteLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, byteLength);
    let cursor = 0;
    while (cursor < byteLength) {
      const key = view.getUint16(cursor, true);
      const length = view.getUint32(cursor + 2, true);
      cursor += 6;
      let keyIndex = this.#keyIndex[key];
      if (keyIndex < 0) {
        keyIndex = this.#usedKeys.length;
        this.#keyIndex[key] = keyIndex;
        this.#usedKeys.push(key);
      }
      const valueIndex = this.#internValue(bytes, cursor, length);
      this.#tags.varint(keyIndex);
      this.#tags.varint(valueIndex);
      cursor += length;
    }
  }

  /** Attribute values are spooled as encoded Value messages, so interning needs no decoding. */
  #internValue(bytes: Uint8Array, start: number, length: number): number {
    let hash = 0x811c9dc5;
    for (let index = start; index < start + length; index += 1) {
      hash = Math.imul(hash ^ bytes[index], 0x01000193);
    }
    const mask = this.#valueSlots.length - 1;
    let slot = hash & mask;
    for (;;) {
      const candidate = this.#valueSlots[slot];
      if (candidate < 0) break;
      if (this.#sameValue(candidate, bytes, start, length)) return candidate;
      slot = (slot + 1) & mask;
    }
    const index = this.#valueStarts.length;
    this.#valueSlots[slot] = index;
    this.#values.byte(0x22);
    this.#values.varint(length);
    this.#valueStarts.push(this.#values.length);
    this.#valueLengths.push(length);
    this.#values.raw(bytes, start, start + length);
    if ((index + 1) * 2 > this.#valueSlots.length) this.#growValueSlots();
    return index;
  }

  #sameValue(index: number, bytes: Uint8Array, start: number, length: number): boolean {
    if (this.#valueLengths[index] !== length) return false;
    const stored = this.#values.bytes;
    const offset = this.#valueStarts[index];
    for (let cursor = 0; cursor < length; cursor += 1) {
      if (stored[offset + cursor] !== bytes[start + cursor]) return false;
    }
    return true;
  }

  #growValueSlots(): void {
    const slots = new Int32Array(this.#valueSlots.length * 2).fill(-1);
    const mask = slots.length - 1;
    const stored = this.#values.bytes;
    for (let index = 0; index < this.#valueStarts.length; index += 1) {
      const start = this.#valueStarts[index];
      let hash = 0x811c9dc5;
      for (let cursor = start; cursor < start + this.#valueLengths[index]; cursor += 1) {
        hash = Math.imul(hash ^ stored[cursor], 0x01000193);
      }
      let slot = hash & mask;
      while (slots[slot] >= 0) slot = (slot + 1) & mask;
      slots[slot] = index;
    }
    this.#valueSlots = slots;
  }

  #encodePoints(words: Int32Array, start: number, count: number): boolean {
    const geometry = this.#geometry;
    geometry.varint(((count << 3) | 1) >>> 0);
    let lastX = 0;
    let lastY = 0;
    for (let index = 0; index < count; index += 1) {
      const x = this.#tileX(words[start + index * 2]);
      const y = this.#tileY(words[start + index * 2 + 1]);
      geometry.varint(zigzag(x - lastX));
      geometry.varint(zigzag(y - lastY));
      lastX = x;
      lastY = y;
    }
    return true;
  }

  #encodeParts(
    type: number,
    words: Int32Array,
    partsStart: number,
    partCount: number,
    coordinatesStart: number,
  ): boolean {
    const polygon = type === geometryType.polygon;
    const minimumPoints = polygon ? 3 : 2;
    const geometry = this.#geometry;
    let cursor = coordinatesStart;
    let lastX = 0;
    let lastY = 0;
    let exteriorKept = false;
    for (let part = 0; part < partCount; part += 1) {
      const size = words[partsStart + part];
      const count = this.#projectPart(words, cursor, size, polygon);
      cursor += size * 2;
      if (polygon) {
        const area = count < 3 ? 0 : doubledArea(this.#scratch, count);
        const exterior = area > 0;
        // A hole cannot outlive its exterior, and winding that flipped under rounding is noise.
        if (area === 0 || (!exterior && !exteriorKept)) continue;
        if (Math.abs(area) < this.#minimumArea) {
          if (exterior) exteriorKept = false;
          continue;
        }
        if (exterior) exteriorKept = true;
      } else if (count < minimumPoints) {
        continue;
      }

      const scratch = this.#scratch;
      geometry.varint(9);
      geometry.varint(zigzag(scratch[0] - lastX));
      geometry.varint(zigzag(scratch[1] - lastY));
      lastX = scratch[0];
      lastY = scratch[1];
      geometry.varint((((count - 1) << 3) | 2) >>> 0);
      for (let index = 1; index < count; index += 1) {
        const x = scratch[index * 2];
        const y = scratch[index * 2 + 1];
        geometry.varint(zigzag(x - lastX));
        geometry.varint(zigzag(y - lastY));
        lastX = x;
        lastY = y;
      }
      if (polygon) geometry.varint(15);
    }
    if (geometry.length > 0) return true;
    if (!polygon && !this.#keepCollapsedLines) return false;
    this.#encodeMark(
      polygon,
      this.#tileX(words[coordinatesStart]),
      this.#tileY(words[coordinatesStart + 1]),
    );
    return true;
  }

  /** The smallest visible shape, so that a feature too small for this zoom does not disappear. */
  #encodeMark(polygon: boolean, x: number, y: number): void {
    const geometry = this.#geometry;
    geometry.varint(9);
    geometry.varint(zigzag(x));
    geometry.varint(zigzag(y));
    if (polygon) {
      geometry.varint(((3 << 3) | 2) >>> 0);
      for (const [dx, dy] of [
        [markSize, 0],
        [0, markSize],
        [-markSize, 0],
      ]) {
        geometry.varint(zigzag(dx));
        geometry.varint(zigzag(dy));
      }
      geometry.varint(15);
    } else {
      geometry.varint(10);
      geometry.varint(zigzag(markSize));
      geometry.varint(zigzag(0));
    }
  }

  /** Project one part to tile units, drop repeats and simplify. Returns the kept point count. */
  #projectPart(words: Int32Array, start: number, size: number, ring: boolean): number {
    if (size * 2 > this.#scratch.length) {
      this.#scratch = new Int32Array(size * 4);
      this.#keep = new Uint8Array(size * 2);
    }
    const scratch = this.#scratch;
    let count = 0;
    for (let index = 0; index < size; index += 1) {
      const x = this.#tileX(words[start + index * 2]);
      const y = this.#tileY(words[start + index * 2 + 1]);
      if (count > 0 && scratch[count * 2 - 2] === x && scratch[count * 2 - 1] === y) continue;
      scratch[count * 2] = x;
      scratch[count * 2 + 1] = y;
      count += 1;
    }
    if (ring) {
      while (
        count > 1 &&
        scratch[0] === scratch[count * 2 - 2] &&
        scratch[1] === scratch[count * 2 - 1]
      ) {
        count -= 1;
      }
    }
    if (this.#tolerance === 0 || count < 3) return count;
    return this.#simplify(count, ring);
  }

  /** Douglas-Peucker. Rings keep their first point and the point farthest from it. */
  #simplify(count: number, ring: boolean): number {
    const scratch = this.#scratch;
    const keep = this.#keep;
    keep.fill(0, 0, count + 1);
    const tolerance = this.#tolerance * this.#tolerance;
    const stack = this.#stack;
    let last = count - 1;
    keep[0] = 1;
    keep[last] = 1;
    if (ring) {
      let farthest = 1;
      let distance = -1;
      for (let index = 1; index < count; index += 1) {
        const dx = scratch[index * 2] - scratch[0];
        const dy = scratch[index * 2 + 1] - scratch[1];
        if (dx * dx + dy * dy > distance) {
          distance = dx * dx + dy * dy;
          farthest = index;
        }
      }
      keep[last] = 0;
      keep[farthest] = 1;
      stack.push(farthest, last + 1);
      last = farthest;
    }
    stack.push(0, last);
    while (stack.length > 0) {
      const end = stack.pop()!;
      const start = stack.pop()!;
      if (end - start < 2) continue;
      const ax = scratch[start * 2];
      const ay = scratch[start * 2 + 1];
      const closing = end === count;
      const bx = scratch[(closing ? 0 : end) * 2];
      const by = scratch[(closing ? 0 : end) * 2 + 1];
      let farthest = -1;
      let distance = tolerance;
      for (let index = start + 1; index < end; index += 1) {
        const value = segmentDistanceSquared(
          scratch[index * 2],
          scratch[index * 2 + 1],
          ax,
          ay,
          bx,
          by,
        );
        if (value > distance) {
          distance = value;
          farthest = index;
        }
      }
      if (farthest >= 0) {
        keep[farthest] = 1;
        stack.push(start, farthest, farthest, end);
      }
    }
    let kept = 0;
    for (let index = 0; index < count; index += 1) {
      if (keep[index] === 0) continue;
      scratch[kept * 2] = scratch[index * 2];
      scratch[kept * 2 + 1] = scratch[index * 2 + 1];
      kept += 1;
    }
    return kept;
  }

  #tileX(value: number): number {
    return roundShift(value - this.#originX, this.#shift);
  }

  #tileY(value: number): number {
    return roundShift(value - this.#originY, this.#shift);
  }
}

function idOf(words: Int32Array, offset: number): number {
  return (words[offset + field.idHigh] >>> 0) * 2 ** 32 + (words[offset + field.idLow] >>> 0);
}

function roundShift(value: number, shift: number): number {
  return Math.round(value / 2 ** shift);
}

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/** Twice the signed area; positive for exterior rings in y-down tile coordinates. */
function doubledArea(points: Int32Array, count: number): number {
  let area = 0;
  let previousX = points[(count - 1) * 2];
  let previousY = points[(count - 1) * 2 + 1];
  for (let index = 0; index < count; index += 1) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    area += previousX * y - x * previousY;
    previousX = x;
    previousY = y;
  }
  return area;
}

function segmentDistanceSquared(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let dx = bx - ax;
  let dy = by - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      ax = bx;
      ay = by;
    } else if (t > 0) {
      ax += dx * t;
      ay += dy * t;
    }
  }
  dx = x - ax;
  dy = y - ay;
  return dx * dx + dy * dy;
}
