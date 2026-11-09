// Prints a digest of what a PMTiles archive means: header fields, metadata, tile addressing and
// decoded tiles. Two archives with the same digest differ at most in how blocks were compressed.
// Usage: node compare-archives.mjs <archive>...
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

function readDirectory(bytes) {
  const data = gunzipSync(bytes);
  let cursor = 0;
  const varint = () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = data[cursor];
      cursor += 1;
      value += (byte & 0x7f) * shift;
      if (byte < 0x80) return value;
      shift *= 128;
    }
  };
  const entries = Array.from({length: varint()}, () => ({}));
  let tileId = 0;
  for (const entry of entries) entry.tileId = tileId += varint();
  for (const entry of entries) entry.runLength = varint();
  for (const entry of entries) entry.length = varint();
  entries.forEach((entry, index) => {
    const stored = varint();
    entry.offset =
      stored === 0 ? entries[index - 1].offset + entries[index - 1].length : stored - 1;
  });
  return entries;
}

function fingerprint(path) {
  const archive = readFileSync(path);
  const bigint = (position) => Number(archive.readBigUInt64LE(position));
  const hash = createHash('sha256');
  hash.update(archive.subarray(96, 127));
  hash.update(gunzipSync(archive.subarray(bigint(24), bigint(24) + bigint(32))));
  const leafStart = bigint(40);
  const dataStart = bigint(56);
  let tiles = 0;
  const visit = (entries) => {
    for (const entry of entries) {
      if (entry.runLength === 0) {
        const start = leafStart + entry.offset;
        visit(readDirectory(archive.subarray(start, start + entry.length)));
        continue;
      }
      tiles += 1;
      hash.update(`${entry.tileId}/${entry.runLength}:`);
      const start = dataStart + entry.offset;
      hash.update(gunzipSync(archive.subarray(start, start + entry.length)));
    }
  };
  visit(readDirectory(archive.subarray(bigint(8), bigint(8) + bigint(16))));
  return {bytes: archive.length, digest: hash.digest('hex'), path, tiles};
}

for (const path of process.argv.slice(2)) console.log(JSON.stringify(fingerprint(path)));
