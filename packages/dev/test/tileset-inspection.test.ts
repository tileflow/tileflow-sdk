import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {inspectTileflowPmtiles, inspectTileflowPmtilesForLocalUse} from '../src/tileset-inspection';

const vectorTile = Buffer.from(
  'GqkBeAIKA3BvaSiAIBIVCAcSCAAAAQECAgMDGAEiBQmAIIAgEhUICBIIAAQBBQIGAwcYASIFCbA7sDsaBG5hbWUaBWNsYXNzGgRyYW5rGgZzZWNyZXQiDgoMQ2VudHJhbCBjYWZlIgYKBGNhZmUiAigDIg8KDURPX05PVF9FWFBPU0UiCQoHT3V0c2lkZSIGCgRzaG9wIgIoCSIQCg5PVVRTSURFX1NFQ1JFVA==',
  'base64',
);

test('inspects authoritative PMTiles metadata and labels bounded MVT observations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-'));
  const archivePath = join(directory, 'stores.pmtiles');
  await writeFile(
    archivePath,
    createPmtiles({
      attribution: 'Store data © Example',
      vector_layers: [
        {
          fields: {class: 'String', name: 'String', rank: 'Number'},
          id: 'poi',
          maxzoom: 0,
          minzoom: 0,
        },
      ],
    }),
  );

  const first = await inspectTileflowPmtiles(archivePath, {includeValues: ['class']});
  const second = await inspectTileflowPmtiles(archivePath, {includeValues: ['class']});
  assert.deepEqual(second, first);
  assert.deepEqual(first, {
    schemaVersion: 1,
    contract: {
      authority: 'pmtiles-header-and-tilejson-v1',
      attribution: 'Store data © Example',
      bounds: [-180, -85, 180, 85],
      center: [0, 0, 0],
      counts: {addressedTiles: 1, declaredTileContents: 1, tileEntries: 1},
      maxzoom: 0,
      minzoom: 0,
      sourceLayersDeclared: true,
      sourceLayers: [
        {
          fieldsDeclared: true,
          fields: [
            {name: 'class', type: 'String'},
            {name: 'name', type: 'String'},
            {name: 'rank', type: 'Number'},
          ],
          id: 'poi',
          maxzoom: 0,
          minzoom: 0,
        },
      ],
      tileType: 'mvt',
    },
    observation: {
      authority: 'bounded-mvt-sample-v1',
      featuresRead: 2,
      includedValueFields: ['class'],
      limits: {
        maxBytes: 24_000_000,
        maxDistinctValuesPerField: 256,
        maxFeatures: 20_000,
        maxIncludedValueFields: 32,
        maxTiles: 8,
        maxValueLength: 256,
        maxValuesPerField: 16,
      },
      sourceLayers: [
        {
          featuresRead: 2,
          fields: [
            {
              distinctValuesObserved: 2,
              distinctValuesTruncated: false,
              featuresMissing: 0,
              featuresPresent: 2,
              name: 'class',
              observedValues: [
                {count: 1, value: 'cafe'},
                {count: 1, value: 'shop'},
              ],
              observedValuesTruncated: false,
              types: ['String'],
            },
            {
              distinctValuesObserved: 2,
              distinctValuesTruncated: false,
              featuresMissing: 0,
              featuresPresent: 2,
              name: 'name',
              types: ['String'],
            },
            {
              distinctValuesObserved: 2,
              distinctValuesTruncated: false,
              featuresMissing: 0,
              featuresPresent: 2,
              name: 'rank',
              numericRange: {max: 9, min: 3},
              types: ['Number'],
            },
            {
              distinctValuesObserved: 2,
              distinctValuesTruncated: false,
              featuresMissing: 0,
              featuresPresent: 2,
              name: 'secret',
              types: ['String'],
            },
          ],
          geometryTypes: ['Point'],
          id: 'poi',
        },
      ],
      tiles: [{x: 0, y: 0, z: 0}],
      tilesRead: 1,
      truncated: false,
    },
    warnings: [],
  });
  assert.doesNotMatch(
    JSON.stringify(first),
    /DO_NOT_EXPOSE|OUTSIDE_SECRET|tileflow-tileset-inspect/u,
  );
  const withoutValues = await inspectTileflowPmtiles(archivePath);
  assert.deepEqual(withoutValues.observation?.includedValueFields, []);
  assert.equal(JSON.stringify(withoutValues).includes('observedValues'), false);
  t.diagnostic(`inspection contract contains ${first.contract.sourceLayers.length} source layer`);
});

test('keeps missing metadata and empty samples explicit instead of inventing schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-empty-'));
  const archivePath = join(directory, 'empty-metadata.pmtiles');
  await writeFile(archivePath, createPmtiles({}, new Uint8Array([0])));

  const inspection = await inspectTileflowPmtiles(archivePath, {sample: false});
  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.contract.sourceLayersDeclared, false);
  assert.deepEqual(inspection.contract.sourceLayers, []);
  assert.equal(inspection.observation, undefined);
  assert.deepEqual(inspection.warnings, [
    {
      code: 'TF_TILESET_SOURCE_LAYERS_UNDECLARED',
      message:
        'PMTiles metadata does not declare vector_layers; source-layer compatibility cannot be proven.',
      path: 'contract.sourceLayers',
    },
  ]);
  await assert.rejects(
    inspectTileflowPmtiles(archivePath, {includeValues: ['status'], sample: false}),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & {code?: string; path?: string}).code ===
        'TF_TILESET_INSPECTION_OPTIONS_INVALID' &&
      (error as Error & {path?: string}).path === 'includeValues',
  );
  await assert.rejects(
    inspectTileflowPmtiles(archivePath, {maximumDirectoryDepth: 0, sample: false}),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & {code?: string; path?: string}).code ===
        'TF_TILESET_INSPECTION_OPTIONS_INVALID' &&
      (error as Error & {path?: string}).path === 'maximumDirectoryDepth',
  );
});

test('rejects PMTiles headers that Hosted cannot publish', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-header-'));
  const archivePath = join(directory, 'invalid-header.pmtiles');
  const archive = createPmtiles({});
  new DataView(archive.buffer).setUint8(101, 27);
  await writeFile(archivePath, archive);

  await assert.rejects(
    inspectTileflowPmtiles(archivePath, {sample: false}),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & {code?: string}).code === 'TF_TILESET_ARCHIVE_INVALID',
  );
});

test('validates every leaf directory entry against archive bounds and rejects cycles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-directory-'));
  const archivePath = join(directory, 'invalid-directory.pmtiles');

  const wrongCounters = createPmtiles({});
  setUint64(new DataView(wrongCounters.buffer), 72, 2);
  for (const archive of [
    createLeafPmtiles('tile-out-of-bounds'),
    createLeafPmtiles('cycle'),
    createLeafPmtiles('outside-parent'),
    createNonClusteredContentsDeclaredClustered(),
    wrongCounters,
  ]) {
    await writeFile(archivePath, archive);
    await assert.rejects(
      inspectTileflowPmtiles(archivePath, {sample: false}),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & {code?: string}).code === 'TF_TILESET_ARCHIVE_INVALID',
    );
  }
});

test('local inspection stops at the root directory while explicit inspection remains exhaustive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-local-inspect-'));
  const archivePath = join(directory, 'deep-cycle.pmtiles');
  await writeFile(archivePath, createLeafPmtiles('cycle'));

  const local = await inspectTileflowPmtilesForLocalUse(archivePath);

  assert.equal(local.contract.tileType, 'mvt');
  assert.equal(local.contract.sourceLayersDeclared, false);
  await assert.rejects(
    inspectTileflowPmtiles(archivePath, {sample: false}),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & {code?: string}).code === 'TF_TILESET_ARCHIVE_INVALID',
  );
});

test('normalizes the same authoritative field types as Hosted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-types-'));
  const archivePath = join(directory, 'field-types.pmtiles');
  await writeFile(
    archivePath,
    createPmtiles({
      vector_layers: [{fields: {active: 'bool', capacity: 'float', label: 'text'}, id: 'features'}],
    }),
  );

  const inspection = await inspectTileflowPmtiles(archivePath, {sample: false});

  assert.deepEqual(inspection.contract.sourceLayers[0]?.fields, [
    {name: 'active', type: 'Boolean'},
    {name: 'capacity', type: 'Number'},
    {name: 'label', type: 'String'},
  ]);
});

test('treats declared tile-content count as non-authoritative', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-content-count-'));
  const archivePath = join(directory, 'content-count.pmtiles');
  const archive = createPmtiles({});
  setUint64(new DataView(archive.buffer), 72, 0);
  setUint64(new DataView(archive.buffer), 80, 0);
  setUint64(new DataView(archive.buffer), 88, 0);
  await writeFile(archivePath, archive);

  const inspection = await inspectTileflowPmtiles(archivePath, {sample: false});

  assert.deepEqual(inspection.contract.counts, {
    addressedTiles: 1,
    declaredTileContents: null,
    tileEntries: 1,
  });
});

test('accepts MapLibre Tile archives as vector data without pretending to sample MVT', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-mlt-'));
  const archivePath = join(directory, 'features.pmtiles');
  const archive = createPmtiles({vector_layers: [{fields: {}, id: 'features'}]});
  new DataView(archive.buffer).setUint8(99, 6);
  await writeFile(archivePath, archive);

  const inspection = await inspectTileflowPmtiles(archivePath);

  assert.equal(inspection.contract.tileType, 'mlt');
  assert.equal(inspection.observation, undefined);
});

test('accepts non-overlapping PMTiles sections in any spec-v3 physical order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-order-'));
  const archivePath = join(directory, 'reordered.pmtiles');
  await writeFile(archivePath, createReorderedPmtiles());

  const inspection = await inspectTileflowPmtiles(archivePath, {sample: false});

  assert.equal(inspection.contract.tileType, 'mvt');
  assert.equal(inspection.contract.counts.addressedTiles, 1);
});

test('sampling is determined by structural limits rather than wall-clock timing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-inspect-clock-'));
  const archivePath = join(directory, 'clock.pmtiles');
  await writeFile(
    archivePath,
    createPmtiles({vector_layers: [{fields: {class: 'String'}, id: 'poi'}]}),
  );
  let now = 0;
  t.mock.method(performance, 'now', () => {
    now += 3_000;
    return now;
  });

  const inspection = await inspectTileflowPmtiles(archivePath);

  assert.equal(inspection.observation?.featuresRead, 2);
});

function createPmtiles(metadata: Record<string, unknown>, tile: Uint8Array = vectorTile) {
  const headerLength = 127;
  const directory = new Uint8Array([1, 0, 1, ...encodeVarint(tile.byteLength), 1]);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(
    headerLength + directory.byteLength + metadataBytes.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadataBytes.byteLength;

  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, directory.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadataBytes.byteLength);
  setUint64(view, 40, tileOffset);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, 1);
  setUint64(view, 80, 1);
  setUint64(view, 88, 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, 0);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  bytes.set(directory, rootOffset);
  bytes.set(metadataBytes, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function createLeafPmtiles(kind: 'cycle' | 'outside-parent' | 'tile-out-of-bounds') {
  const headerLength = 127;
  const leaf = new Uint8Array(
    kind === 'cycle'
      ? [1, 0, 0, 5, 1]
      : kind === 'outside-parent'
        ? [1, 1, 1, 1, 1]
        : [1, 0, 1, 1, 3],
  );
  const root = new Uint8Array(
    kind === 'outside-parent'
      ? [2, 0, 1, 0, 1, leaf.byteLength, 1, 1, 1]
      : [1, 0, 0, leaf.byteLength, 1],
  );
  const metadata = new TextEncoder().encode('{}');
  const tile = new Uint8Array([0]);
  const bytes = new Uint8Array(
    headerLength + root.byteLength + metadata.byteLength + leaf.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + root.byteLength;
  const leafOffset = metadataOffset + metadata.byteLength;
  const tileOffset = leafOffset + leaf.byteLength;

  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, root.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadata.byteLength);
  setUint64(view, 40, leafOffset);
  setUint64(view, 48, leaf.byteLength);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, kind === 'outside-parent' ? 2 : 1);
  setUint64(view, 80, kind === 'outside-parent' ? 2 : 1);
  setUint64(view, 88, kind === 'outside-parent' ? 2 : 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, 0);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  bytes.set(root, rootOffset);
  bytes.set(metadata, metadataOffset);
  bytes.set(leaf, leafOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function createReorderedPmtiles() {
  const headerLength = 127;
  const root = new Uint8Array([1, 0, 1, 1, 1]);
  const tile = new Uint8Array([0]);
  const metadata = new TextEncoder().encode('{}');
  const bytes = new Uint8Array(
    headerLength + root.byteLength + tile.byteLength + metadata.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const tileOffset = rootOffset + root.byteLength;
  const metadataOffset = tileOffset + tile.byteLength;
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, root.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadata.byteLength);
  setUint64(view, 40, metadataOffset + metadata.byteLength);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, 1);
  setUint64(view, 80, 1);
  setUint64(view, 88, 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  bytes.set(root, rootOffset);
  bytes.set(tile, tileOffset);
  bytes.set(metadata, metadataOffset);
  return bytes;
}

function createNonClusteredContentsDeclaredClustered() {
  const source = createPmtiles({});
  const bytes = new Uint8Array(source.byteLength + 1);
  bytes.set(source);
  const view = new DataView(bytes.buffer);
  const rootOffset = 127;
  bytes[rootOffset + 4] = 2;
  setUint64(view, 64, 2);
  return bytes;
}

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let remainder = value;
  while (remainder >= 128) {
    bytes.push((remainder & 0x7f) | 0x80);
    remainder = Math.floor(remainder / 128);
  }
  bytes.push(remainder);
  return bytes;
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}
