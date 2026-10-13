import type {TileflowShotEncodedChunk, TileflowShotVideoCodec} from './shot-encoder';

export type TileflowWebmInput = {
  chunks: readonly TileflowShotEncodedChunk[];
  codec: TileflowShotVideoCodec;
  /** Playback length in milliseconds. */
  durationMs: number;
  fps: number;
  /** Physical frame height in pixels. */
  height: number;
  /** Physical frame width in pixels. */
  width: number;
};

/** Matroska element IDs, including their length-marker bits. */
export const tileflowWebmElementIds = Object.freeze({
  ebml: 0x1a45dfa3,
  ebmlVersion: 0x4286,
  ebmlReadVersion: 0x42f7,
  ebmlMaxIdLength: 0x42f2,
  ebmlMaxSizeLength: 0x42f3,
  docType: 0x4282,
  docTypeVersion: 0x4287,
  docTypeReadVersion: 0x4285,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  duration: 0x4489,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackUid: 0x73c5,
  trackType: 0x83,
  flagLacing: 0x9c,
  defaultDuration: 0x23e383,
  codecId: 0x86,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
});

const id = tileflowWebmElementIds;
const maximumRelativeTimestamp = 32_767;

/**
 * Writes one video track to a WebM file with known sizes: an EBML header and a Segment holding a
 * SeekHead, Info (1 ms timestamps and the duration), Tracks, Clusters of SimpleBlocks that each
 * start at a key frame, and Cues that index those clusters for seeking.
 */
export function writeTileflowWebm(input: TileflowWebmInput): Uint8Array {
  if (input.chunks.length === 0 || !input.chunks[0]!.key) {
    throw new RangeError('A WebM video must start with a key frame.');
  }

  const header = element(id.ebml, [
    unsignedElement(id.ebmlVersion, 1),
    unsignedElement(id.ebmlReadVersion, 1),
    unsignedElement(id.ebmlMaxIdLength, 4),
    unsignedElement(id.ebmlMaxSizeLength, 8),
    stringElement(id.docType, 'webm'),
    unsignedElement(id.docTypeVersion, 4),
    unsignedElement(id.docTypeReadVersion, 2),
  ]);
  const info = element(id.info, [
    unsignedElement(id.timestampScale, 1_000_000),
    floatElement(id.duration, input.durationMs),
    stringElement(id.muxingApp, 'Tileflow'),
    stringElement(id.writingApp, 'Tileflow'),
  ]);
  const tracks = element(id.tracks, [
    element(id.trackEntry, [
      unsignedElement(id.trackNumber, 1),
      unsignedElement(id.trackUid, 1),
      unsignedElement(id.trackType, 1),
      unsignedElement(id.flagLacing, 0),
      unsignedElement(id.defaultDuration, Math.round(1e9 / input.fps)),
      stringElement(id.codecId, input.codec === 'vp9' ? 'V_VP9' : 'V_VP8'),
      element(id.video, [
        unsignedElement(id.pixelWidth, input.width),
        unsignedElement(id.pixelHeight, input.height),
      ]),
    ]),
  ]);

  const clusters: Array<{bytes: Uint8Array; timestamp: number}> = [];
  let current: {blocks: Uint8Array[]; timestamp: number} | undefined;
  const closeCluster = () => {
    if (!current) return;
    clusters.push({
      bytes: element(id.cluster, [
        unsignedElement(id.timestamp, current.timestamp),
        ...current.blocks,
      ]),
      timestamp: current.timestamp,
    });
    current = undefined;
  };
  for (const chunk of input.chunks) {
    const timestamp = Math.round(chunk.timestamp / 1_000);
    if (!current || chunk.key || timestamp - current.timestamp > maximumRelativeTimestamp) {
      closeCluster();
      current = {blocks: [], timestamp};
    }
    current.blocks.push(simpleBlock(timestamp - current.timestamp, chunk.key, chunk.data));
  }
  closeCluster();

  // Seek positions use eight bytes, so the SeekHead size does not depend on the positions.
  const seekHeadSize = seekHead([0, 0, 0]).byteLength;
  const infoPosition = seekHeadSize;
  const tracksPosition = infoPosition + info.byteLength;
  let position = tracksPosition + tracks.byteLength;
  const cuePoints: Uint8Array[] = [];
  for (const cluster of clusters) {
    cuePoints.push(
      element(id.cuePoint, [
        unsignedElement(id.cueTime, cluster.timestamp),
        element(id.cueTrackPositions, [
          unsignedElement(id.cueTrack, 1),
          unsignedElement(id.cueClusterPosition, position),
        ]),
      ]),
    );
    position += cluster.bytes.byteLength;
  }
  const cuesPosition = position;
  const segment = element(id.segment, [
    seekHead([infoPosition, tracksPosition, cuesPosition]),
    info,
    tracks,
    ...clusters.map((cluster) => cluster.bytes),
    element(id.cues, cuePoints),
  ]);
  return concat([header, segment]);
}

function seekHead([info, tracks, cues]: readonly [number, number, number]): Uint8Array {
  const seek = (target: number, offset: number) =>
    element(id.seek, [
      binaryElement(id.seekId, elementIdBytes(target)),
      element(id.seekPosition, [fixedUnsigned(offset, 8)]),
    ]);
  return element(id.seekHead, [seek(id.info, info), seek(id.tracks, tracks), seek(id.cues, cues)]);
}

function simpleBlock(relativeTimestamp: number, key: boolean, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = 0x81; // Track number 1 as a one-byte variable-size integer.
  new DataView(header.buffer).setInt16(1, relativeTimestamp);
  header[3] = key ? 0x80 : 0x00;
  return binaryElement(id.simpleBlock, concat([header, data]));
}

function element(elementId: number, children: readonly Uint8Array[]): Uint8Array {
  return binaryElement(elementId, concat(children));
}

function binaryElement(elementId: number, data: Uint8Array): Uint8Array {
  return concat([elementIdBytes(elementId), sizeBytes(data.byteLength), data]);
}

function unsignedElement(elementId: number, value: number): Uint8Array {
  return binaryElement(elementId, minimalUnsigned(value));
}

function stringElement(elementId: number, value: string): Uint8Array {
  return binaryElement(elementId, new TextEncoder().encode(value));
}

function floatElement(elementId: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return binaryElement(elementId, bytes);
}

function elementIdBytes(elementId: number): Uint8Array {
  const length = elementId >= 0x1000000 ? 4 : elementId >= 0x10000 ? 3 : elementId >= 0x100 ? 2 : 1;
  return fixedUnsigned(elementId, length);
}

/** An EBML element size in the fewest bytes; the all-ones value of each length is reserved. */
function sizeBytes(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid EBML element size.');
  let length = 1;
  while (length < 8 && size >= 2 ** (7 * length) - 1) length += 1;
  if (size >= 2 ** (7 * length) - 1) throw new RangeError('EBML element is too large.');
  const bytes = fixedUnsigned(size, length);
  bytes[0] = (bytes[0] ?? 0) | (1 << (8 - length));
  return bytes;
}

function minimalUnsigned(value: number): Uint8Array {
  let length = 1;
  while (length < 8 && value >= 2 ** (8 * length)) length += 1;
  return fixedUnsigned(value, length);
}

function fixedUnsigned(value: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid EBML integer.');
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
