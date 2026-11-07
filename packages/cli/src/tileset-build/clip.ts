import {FeatureSpool, field, geometryType, headerWords} from './spool';

export type Box = Readonly<{maxX: number; maxY: number; minX: number; minY: number}>;

/** A geometry being rewritten: point coordinates and the point count of each part. */
class Geometry {
  coordinates = new Int32Array(4096);
  parts = new Int32Array(64);
  partCount = 0;
  pointCount = 0;

  reset(): void {
    this.partCount = 0;
    this.pointCount = 0;
  }

  push(x: number, y: number): void {
    if ((this.pointCount + 1) * 2 > this.coordinates.length) {
      const grown = new Int32Array(this.coordinates.length * 2);
      grown.set(this.coordinates);
      this.coordinates = grown;
    }
    this.coordinates[this.pointCount * 2] = x;
    this.coordinates[this.pointCount * 2 + 1] = y;
    this.pointCount += 1;
  }

  endPart(start: number, minimumPoints: number): void {
    const size = this.pointCount - start;
    if (size < minimumPoints) {
      this.pointCount = start;
      return;
    }
    if (this.partCount === this.parts.length) {
      const grown = new Int32Array(this.parts.length * 2);
      grown.set(this.parts);
      this.parts = grown;
    }
    this.parts[this.partCount] = size;
    this.partCount += 1;
  }
}

let current = new Geometry();
let next = new Geometry();

/** Copy one record into `target`, clipped to `box` when it crosses the edge. */
export function clipRecordInto(
  words: Int32Array,
  offset: number,
  box: Box,
  target: FeatureSpool,
): void {
  if (
    words[offset + field.maxX] < box.minX ||
    words[offset + field.minX] > box.maxX ||
    words[offset + field.maxY] < box.minY ||
    words[offset + field.minY] > box.maxY
  ) {
    return;
  }
  if (
    words[offset + field.minX] >= box.minX &&
    words[offset + field.maxX] <= box.maxX &&
    words[offset + field.minY] >= box.minY &&
    words[offset + field.maxY] <= box.maxY
  ) {
    target.append(words, offset, words[offset + field.words]);
    return;
  }

  const type = words[offset + field.type];
  const partCount = words[offset + field.parts];
  const pointCount = words[offset + field.points];
  const partsStart = offset + headerWords;
  const coordinatesStart = partsStart + partCount;

  current.reset();
  let cursor = coordinatesStart;
  for (let part = 0; part < partCount; part += 1) {
    const size = words[partsStart + part];
    const start = current.pointCount;
    for (let point = 0; point < size; point += 1) {
      current.push(words[cursor], words[cursor + 1]);
      cursor += 2;
    }
    current.endPart(start, 1);
  }

  clipAxis(type, 0, box.minX, 1);
  clipAxis(type, 0, box.maxX, -1);
  clipAxis(type, 1, box.minY, 1);
  clipAxis(type, 1, box.maxY, -1);
  if (current.partCount === 0) return;

  const propertyBytes = words[offset + field.propertyBytes];
  const propertyWords = Math.ceil(propertyBytes / 4);
  const size = headerWords + current.partCount + current.pointCount * 2 + propertyWords;
  const start = target.reserve(size);
  const output = target.words;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < current.pointCount; index += 1) {
    const x = current.coordinates[index * 2];
    const y = current.coordinates[index * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  output[start + field.words] = size;
  output[start + field.type] = type;
  output[start + field.minX] = minX;
  output[start + field.minY] = minY;
  output[start + field.maxX] = maxX;
  output[start + field.maxY] = maxY;
  output[start + field.parts] = current.partCount;
  output[start + field.points] = current.pointCount;
  output[start + field.propertyBytes] = propertyBytes;
  output[start + field.idLow] = words[offset + field.idLow];
  output[start + field.idHigh] = words[offset + field.idHigh];
  output.set(current.parts.subarray(0, current.partCount), start + headerWords);
  output.set(
    current.coordinates.subarray(0, current.pointCount * 2),
    start + headerWords + current.partCount,
  );
  output.set(
    words.subarray(
      coordinatesStart + pointCount * 2,
      coordinatesStart + pointCount * 2 + propertyWords,
    ),
    start + headerWords + current.partCount + current.pointCount * 2,
  );
}

/** Clip `current` against the half-plane `sign * (coordinate - bound) >= 0`, then swap. */
function clipAxis(type: number, axis: 0 | 1, bound: number, sign: 1 | -1): void {
  if (type === geometryType.point) clipPoints(axis, bound, sign);
  else if (type === geometryType.line) clipLines(axis, bound, sign);
  else clipRings(axis, bound, sign);
  const swap = current;
  current = next;
  next = swap;
}

function clipPoints(axis: 0 | 1, bound: number, sign: number): void {
  next.reset();
  const start = 0;
  for (let index = 0; index < current.pointCount; index += 1) {
    const x = current.coordinates[index * 2];
    const y = current.coordinates[index * 2 + 1];
    if (sign * ((axis === 0 ? x : y) - bound) >= 0) next.push(x, y);
  }
  next.endPart(start, 1);
}

function clipLines(axis: 0 | 1, bound: number, sign: number): void {
  next.reset();
  let cursor = 0;
  for (let part = 0; part < current.partCount; part += 1) {
    const size = current.parts[part];
    let start = next.pointCount;
    let previousX = 0;
    let previousY = 0;
    let previousInside = false;
    for (let index = 0; index < size; index += 1) {
      const x = current.coordinates[cursor * 2];
      const y = current.coordinates[cursor * 2 + 1];
      cursor += 1;
      const inside = sign * ((axis === 0 ? x : y) - bound) >= 0;
      if (index > 0 && inside !== previousInside) {
        pushCrossing(axis, bound, previousX, previousY, x, y);
        if (!inside) {
          next.endPart(start, 2);
          start = next.pointCount;
        }
      }
      if (inside) next.push(x, y);
      previousX = x;
      previousY = y;
      previousInside = inside;
    }
    next.endPart(start, 2);
  }
}

function clipRings(axis: 0 | 1, bound: number, sign: number): void {
  next.reset();
  let cursor = 0;
  for (let part = 0; part < current.partCount; part += 1) {
    const size = current.parts[part];
    const start = next.pointCount;
    let previousX = current.coordinates[(cursor + size - 1) * 2];
    let previousY = current.coordinates[(cursor + size - 1) * 2 + 1];
    let previousInside = sign * ((axis === 0 ? previousX : previousY) - bound) >= 0;
    for (let index = 0; index < size; index += 1) {
      const x = current.coordinates[cursor * 2];
      const y = current.coordinates[cursor * 2 + 1];
      cursor += 1;
      const inside = sign * ((axis === 0 ? x : y) - bound) >= 0;
      if (inside !== previousInside) pushCrossing(axis, bound, previousX, previousY, x, y);
      if (inside) next.push(x, y);
      previousX = x;
      previousY = y;
      previousInside = inside;
    }
    next.endPart(start, 3);
  }
}

function pushCrossing(
  axis: 0 | 1,
  bound: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  if (axis === 0) {
    next.push(bound, Math.round(fromY + ((bound - fromX) * (toY - fromY)) / (toX - fromX)));
  } else {
    next.push(Math.round(fromX + ((bound - fromY) * (toX - fromX)) / (toY - fromY)), bound);
  }
}
