import {tileflowWebmElementIds as id} from '../src/webm';

/** One parsed EBML element; master elements also carry their children. */
export type EbmlElement = {
  id: number;
  /** Offset of the element's ID in the parsed buffer. */
  offset: number;
  /** Offset of the element's data in the parsed buffer. */
  dataOffset: number;
  size: number;
  data: Uint8Array;
  children: EbmlElement[];
};

const masterIds = new Set<number>([
  id.ebml,
  id.segment,
  id.seekHead,
  id.seek,
  id.info,
  id.tracks,
  id.trackEntry,
  id.video,
  id.cluster,
  id.cues,
  id.cuePoint,
  id.cueTrackPositions,
]);

/** Reads EBML elements with known sizes, failing on any size that overruns its parent. */
export function readEbml(bytes: Uint8Array, start = 0, end = bytes.byteLength): EbmlElement[] {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const elementId = readVariableInteger(bytes, offset, true);
    const size = readVariableInteger(bytes, offset + elementId.length, false);
    const dataOffset = offset + elementId.length + size.length;
    if (dataOffset + size.value > end) throw new RangeError('EBML element overruns its parent.');
    elements.push({
      id: elementId.value,
      offset,
      dataOffset,
      size: size.value,
      data: bytes.subarray(dataOffset, dataOffset + size.value),
      children: masterIds.has(elementId.value)
        ? readEbml(bytes, dataOffset, dataOffset + size.value)
        : [],
    });
    offset = dataOffset + size.value;
  }
  return elements;
}

export function readVariableInteger(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): {length: number; value: number} {
  const first = bytes[offset];
  if (first === undefined || first === 0) throw new RangeError('Invalid EBML integer.');
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length += 1;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index]!;
  }
  return {length, value};
}

export function readUnsigned(element: EbmlElement): number {
  return element.data.reduce((value, byte) => value * 256 + byte, 0);
}

export function readString(element: EbmlElement): string {
  return new TextDecoder().decode(element.data);
}

export function readFloat(element: EbmlElement): number {
  const view = new DataView(element.data.buffer, element.data.byteOffset, element.data.byteLength);
  return element.data.byteLength === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

export function child(element: EbmlElement, elementId: number): EbmlElement {
  const found = element.children.find((candidate) => candidate.id === elementId);
  if (!found) throw new Error(`Missing EBML element 0x${elementId.toString(16)}.`);
  return found;
}

export function children(element: EbmlElement, elementId: number): EbmlElement[] {
  return element.children.filter((candidate) => candidate.id === elementId);
}

/** Track number, relative timestamp, key-frame flag, and frame data of one SimpleBlock. */
export function readSimpleBlock(element: EbmlElement): {
  data: Uint8Array;
  key: boolean;
  relativeTimestamp: number;
  track: number;
} {
  const track = readVariableInteger(element.data, 0, false);
  const view = new DataView(element.data.buffer, element.data.byteOffset, element.data.byteLength);
  return {
    track: track.value,
    relativeTimestamp: view.getInt16(track.length),
    key: (element.data[track.length + 2]! & 0x80) !== 0,
    data: element.data.subarray(track.length + 3),
  };
}
