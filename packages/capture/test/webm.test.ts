import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowShotEncodedChunk} from '../src/shot-encoder';
import {tileflowWebmElementIds as id, writeTileflowWebm} from '../src/webm';
import {
  child,
  children,
  readEbml,
  readFloat,
  readSimpleBlock,
  readString,
  readUnsigned,
} from './webm-reader';

function chunks(count: number, fps: number, keyInterval: number): TileflowShotEncodedChunk[] {
  return Array.from({length: count}, (_, index) => ({
    data: Uint8Array.from([index % 256, 0xa5, index >> 8]),
    key: index % keyInterval === 0,
    timestamp: Math.round((index * 1e6) / fps),
  }));
}

test('writes an EBML header and one sized Segment with seek, info, tracks, clusters, and cues', () => {
  const input = chunks(90, 30, 30);
  const bytes = writeTileflowWebm({
    chunks: input,
    codec: 'vp9',
    durationMs: 3_000,
    fps: 30,
    height: 72,
    width: 128,
  });
  const [header, segment, ...rest] = readEbml(bytes);

  assert.equal(rest.length, 0);
  assert.equal(header!.id, id.ebml);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.equal(readUnsigned(child(header!, id.ebmlVersion)), 1);
  assert.equal(readUnsigned(child(header!, id.ebmlReadVersion)), 1);
  assert.equal(readUnsigned(child(header!, id.ebmlMaxIdLength)), 4);
  assert.equal(readUnsigned(child(header!, id.ebmlMaxSizeLength)), 8);
  assert.equal(readString(child(header!, id.docType)), 'webm');
  assert.equal(readUnsigned(child(header!, id.docTypeReadVersion)), 2);

  assert.equal(segment!.id, id.segment);
  assert.equal(segment!.dataOffset + segment!.size, bytes.byteLength);
  assert.deepEqual(
    segment!.children.map((element) => element.id),
    [id.seekHead, id.info, id.tracks, id.cluster, id.cluster, id.cluster, id.cues],
  );

  const info = child(segment!, id.info);
  assert.equal(readUnsigned(child(info, id.timestampScale)), 1_000_000);
  assert.equal(readFloat(child(info, id.duration)), 3_000);
  assert.equal(readString(child(info, id.muxingApp)), 'Tileflow');

  const track = child(child(segment!, id.tracks), id.trackEntry);
  assert.equal(readUnsigned(child(track, id.trackNumber)), 1);
  assert.equal(readUnsigned(child(track, id.trackType)), 1);
  assert.equal(readUnsigned(child(track, id.flagLacing)), 0);
  assert.equal(readUnsigned(child(track, id.defaultDuration)), 33_333_333);
  assert.equal(readString(child(track, id.codecId)), 'V_VP9');
  assert.equal(readUnsigned(child(child(track, id.video), id.pixelWidth)), 128);
  assert.equal(readUnsigned(child(child(track, id.video), id.pixelHeight)), 72);

  const clusters = children(segment!, id.cluster);
  assert.deepEqual(
    clusters.map((cluster) => readUnsigned(child(cluster, id.timestamp))),
    [0, 1_000, 2_000],
  );
  const blocks = clusters.flatMap((cluster) => {
    const timestamp = readUnsigned(child(cluster, id.timestamp));
    return children(cluster, id.simpleBlock).map((element) => ({
      ...readSimpleBlock(element),
      timestamp,
    }));
  });
  assert.equal(blocks.length, 90);
  blocks.forEach((block, index) => {
    assert.equal(block.track, 1);
    assert.equal(block.key, index % 30 === 0);
    assert.equal(block.timestamp + block.relativeTimestamp, Math.round((index * 1_000) / 30));
    assert.deepEqual(block.data, input[index]!.data);
  });

  const segmentStart = segment!.dataOffset;
  const cuePoints = children(child(segment!, id.cues), id.cuePoint);
  assert.deepEqual(
    cuePoints.map((point) => {
      const positions = child(point, id.cueTrackPositions);
      return {
        position: readUnsigned(child(positions, id.cueClusterPosition)),
        time: readUnsigned(child(point, id.cueTime)),
        track: readUnsigned(child(positions, id.cueTrack)),
      };
    }),
    clusters.map((cluster) => ({
      position: cluster.offset - segmentStart,
      time: readUnsigned(child(cluster, id.timestamp)),
      track: 1,
    })),
  );

  const seeks = children(child(segment!, id.seekHead), id.seek).map((seek) => ({
    id: readUnsigned(child(seek, id.seekId)),
    position: readUnsigned(child(seek, id.seekPosition)),
  }));
  assert.deepEqual(seeks, [
    {id: id.info, position: info.offset - segmentStart},
    {id: id.tracks, position: child(segment!, id.tracks).offset - segmentStart},
    {id: id.cues, position: child(segment!, id.cues).offset - segmentStart},
  ]);
});

test('names VP8 tracks and starts a cluster before a relative timestamp overflows', () => {
  const bytes = writeTileflowWebm({
    chunks: [
      {data: Uint8Array.of(1), key: true, timestamp: 0},
      {data: Uint8Array.of(2), key: false, timestamp: 32_767_000},
      {data: Uint8Array.of(3), key: false, timestamp: 32_768_000},
    ],
    codec: 'vp8',
    durationMs: 32_800,
    fps: 24,
    height: 64,
    width: 64,
  });
  const segment = readEbml(bytes)[1]!;
  const track = child(child(segment, id.tracks), id.trackEntry);
  assert.equal(readString(child(track, id.codecId)), 'V_VP8');
  assert.equal(readUnsigned(child(track, id.defaultDuration)), 41_666_667);

  const clusters = children(segment, id.cluster);
  assert.deepEqual(
    clusters.map((cluster) => ({
      blocks: children(cluster, id.simpleBlock).map(
        (element) => readSimpleBlock(element).relativeTimestamp,
      ),
      timestamp: readUnsigned(child(cluster, id.timestamp)),
    })),
    [
      {blocks: [0, 32_767], timestamp: 0},
      {blocks: [0], timestamp: 32_768},
    ],
  );
});

test('encodes element sizes around the reserved all-ones size values', () => {
  // A SimpleBlock adds four header bytes, so these reach element sizes 126/127 and 16382/16383.
  for (const size of [122, 123, 124, 16_378, 16_379, 16_380]) {
    const bytes = writeTileflowWebm({
      chunks: [{data: new Uint8Array(size), key: true, timestamp: 0}],
      codec: 'vp9',
      durationMs: 40,
      fps: 25,
      height: 64,
      width: 64,
    });
    const segment = readEbml(bytes)[1]!;
    const block = readSimpleBlock(child(child(segment, id.cluster), id.simpleBlock));
    assert.equal(block.data.byteLength, size);
  }
});

test('requires a video that starts with a key frame', () => {
  const input = {codec: 'vp9' as const, durationMs: 40, fps: 25, height: 64, width: 64};
  assert.throws(() => writeTileflowWebm({...input, chunks: []}), /key frame/);
  assert.throws(
    () =>
      writeTileflowWebm({...input, chunks: [{data: Uint8Array.of(1), key: false, timestamp: 0}]}),
    /key frame/,
  );
});
