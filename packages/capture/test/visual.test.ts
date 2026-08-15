import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
import {PNG} from 'pngjs';
import {sha256Hex, type TileflowDataIdentity} from '@tileflow/core';
import {
  analyzeTileflowCaptureReference,
  compareTileflowCaptureToBaseline,
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  createTileflowVisualComparisonDocument,
  createTileflowVisualReferenceAnalysisDocument,
  parseTileflowCaptureReceipt,
  serializeTileflowCaptureReceipt,
  serializeTileflowVisualComparison,
  type TileflowCapture,
  type TileflowCaptureReceipt,
} from '../src/index';

const dataIdentity: TileflowDataIdentity = {
  kind: 'tileflow-world',
  revision: '2026-06-07',
  schema: 'openmaptiles',
  schemaVersion: 1,
  sourceId: 'tileflow',
};

test('analyzes a bounded reference without treating it as a baseline', async () => {
  const actualPng = createPng(2, 2, [20, 40, 60, 255]);
  const referencePng = createPng(2, 2, [20, 40, 60, 255], [[1, 1, 255, 255, 255, 255]]);
  const analysis = await analyzeTileflowCaptureReference(
    await createCapture(actualPng, 2, 2),
    referencePng,
  );
  const repeated = await analyzeTileflowCaptureReference(
    await createCapture(actualPng, 2, 2),
    referencePng,
  );

  assert.equal(analysis.dimensionsMatch, true);
  assert.deepEqual(analysis.exact, {changedPixels: 1, totalPixels: 4, ratio: 0.25});
  assert.equal(analysis.perceptual?.changedPixels, 1);
  assert.equal(analysis.meanAbsoluteChannelDifference, 40.3125);
  assert.deepEqual(analysis.reference.palette, [
    {color: '#112244', count: 3, ratio: 0.75},
    {color: '#ffffff', count: 1, ratio: 0.25},
  ]);
  assert.deepEqual(analysis.actual.palette, [{color: '#112244', count: 4, ratio: 1}]);
  assert.deepEqual(analysis.diffPng, repeated.diffPng);
  assert.equal('diffPng' in createTileflowVisualReferenceAnalysisDocument(analysis), false);
});

test('analyzes different dimensions without inventing pixel metrics', async () => {
  const actualPng = createPng(2, 2, [20, 40, 60, 255]);
  const referencePng = createPng(3, 2, [20, 40, 60, 255]);
  const analysis = await analyzeTileflowCaptureReference(
    await createCapture(actualPng, 2, 2),
    referencePng,
  );

  assert.equal(analysis.dimensionsMatch, false);
  assert.equal(analysis.exact, null);
  assert.equal(analysis.perceptual, null);
  assert.equal(analysis.meanAbsoluteChannelDifference, null);
  assert.equal(analysis.diffPng, undefined);
  assert.match(analysis.warnings[0] ?? '', /dimensions differ/);
});

test('reports exact and perceptual equality with a transparent deterministic diff', async () => {
  const png = createPng(2, 2, [20, 40, 60, 255]);
  const actual = await createCapture(png, 2, 2);
  const comparison = await compareTileflowCaptureToBaseline(actual, {
    png,
    receipt: serializeTileflowCaptureReceipt(actual.receipt),
  });
  const repeated = await compareTileflowCaptureToBaseline(actual, {
    png,
    receipt: actual.receipt,
  });

  assert.equal(comparison.status, 'unchanged');
  assert.deepEqual(comparison.exact, {changedPixels: 0, totalPixels: 4, ratio: 0});
  assert.deepEqual(comparison.perceptual, {
    threshold: 0.1,
    changedPixels: 0,
    totalPixels: 4,
    ratio: 0,
  });
  assert.deepEqual(comparison.diffPng, repeated.diffPng);
  const decodedDiff = PNG.sync.read(Buffer.from(comparison.diffPng!));
  assert.equal(
    decodedDiff.data.every((channel) => channel === 0),
    true,
  );
  const document = createTileflowVisualComparisonDocument(comparison);
  assert.equal('diffPng' in document, false);
  assert.equal(serializeTileflowVisualComparison(comparison).includes('diffPng'), false);
});

test('reports one-pixel, perceptual-threshold, and broad changes separately', async () => {
  const baselinePng = createPng(2, 2, [0, 0, 0, 255]);
  const baselineReceipt = await createReceipt(baselinePng, 2, 2);
  const onePixelPng = createPng(2, 2, [0, 0, 0, 255], [[1, 0, 255, 255, 255, 255]]);
  const onePixel = await compareTileflowCaptureToBaseline(await createCapture(onePixelPng, 2, 2), {
    png: baselinePng,
    receipt: baselineReceipt,
  });

  assert.equal(onePixel.status, 'changed');
  assert.equal(onePixel.changeKind, 'pixels');
  assert.equal(onePixel.exact?.changedPixels, 1);
  assert.equal(onePixel.perceptual?.changedPixels, 1);
  const onePixelDiff = PNG.sync.read(Buffer.from(onePixel.diffPng!));
  assert.equal(countOpaquePixels(onePixelDiff.data), 1);

  const subtleBaseline = createPng(1, 1, [100, 100, 100, 255]);
  const subtleActual = createPng(1, 1, [101, 100, 100, 255]);
  const subtle = await compareTileflowCaptureToBaseline(await createCapture(subtleActual, 1, 1), {
    png: subtleBaseline,
    receipt: await createReceipt(subtleBaseline, 1, 1),
  });
  assert.equal(subtle.exact?.changedPixels, 1);
  assert.equal(subtle.perceptual?.changedPixels, 0);

  const broadPng = createPng(2, 2, [255, 255, 255, 255]);
  const broad = await compareTileflowCaptureToBaseline(await createCapture(broadPng, 2, 2), {
    png: baselinePng,
    receipt: baselineReceipt,
  });
  assert.equal(broad.exact?.changedPixels, 4);
  assert.equal(broad.exact?.ratio, 1);
});

test('classifies missing, dimension, scene, and runtime mismatches before pixel comparison', async () => {
  const actualPng = createPng(2, 2, [10, 20, 30, 255]);
  const actual = await createCapture(actualPng, 2, 2);
  const missing = await compareTileflowCaptureToBaseline(actual);
  assert.equal(missing.status, 'missing-baseline');
  assert.equal(missing.baseline, null);
  const remoteActual: TileflowCapture = {
    ...actual,
    networkDependent: true,
    receipt: {...actual.receipt, networkDependent: true},
  };
  const remote = await compareTileflowCaptureToBaseline(remoteActual);
  assert.match(remote.warnings[0] ?? '', /remote resources/);

  const widerPng = createPng(3, 2, [10, 20, 30, 255]);
  const dimensions = await compareTileflowCaptureToBaseline(actual, {
    png: widerPng,
    receipt: await createReceipt(widerPng, 3, 2),
  });
  assert.equal(dimensions.status, 'changed');
  assert.equal(dimensions.changeKind, 'dimensions');
  assert.equal(dimensions.dimensionsMatch, false);
  const dimensionDiff = PNG.sync.read(Buffer.from(dimensions.diffPng!));
  assert.equal(dimensionDiff.width, 3);
  assert.equal(dimensionDiff.height, 2);
  assert.equal(countOpaquePixels(dimensionDiff.data), 6);

  const sceneReceipt = await createReceipt(actualPng, 2, 2, {
    sceneSha256: 'd'.repeat(64),
  });
  const scene = await compareTileflowCaptureToBaseline(actual, {
    png: actualPng,
    receipt: sceneReceipt,
  });
  assert.equal(scene.status, 'scene-mismatch');
  assert.equal(scene.sceneMatch, false);

  const runtimeReceipt = await createReceipt(actualPng, 2, 2, {
    chromiumVersion: 'different-runtime',
  });
  const runtime = await compareTileflowCaptureToBaseline(actual, {
    png: actualPng,
    receipt: runtimeReceipt,
  });
  assert.equal(runtime.status, 'runtime-mismatch');
  assert.equal(runtime.rendererMatch, false);

  const pinnedActualReceipt = createTileflowCaptureReceipt({
    data: {...dataIdentity, revision: 'archive-a'},
    dpr: actual.dpr,
    height: actual.height,
    map: actual.map,
    networkDependent: actual.networkDependent,
    pngSha256: actual.sha256,
    renderer: actual.renderer,
    scene: actual.scene,
    sceneSha256: actual.sceneSha256,
    styleSha256: actual.styleSha256,
    target: actual.target,
    width: actual.width,
  });
  const pinnedActual = {...actual, receipt: pinnedActualReceipt};
  const pinnedBaseline = createTileflowCaptureReceipt({
    data: {...dataIdentity, revision: 'archive-b'},
    dpr: actual.dpr,
    height: actual.height,
    map: actual.map,
    networkDependent: actual.networkDependent,
    pngSha256: actual.sha256,
    renderer: actual.renderer,
    scene: actual.scene,
    sceneSha256: actual.sceneSha256,
    styleSha256: actual.styleSha256,
    target: actual.target,
    width: actual.width,
  });
  const sourceMismatch = await compareTileflowCaptureToBaseline(pinnedActual, {
    png: actualPng,
    receipt: pinnedBaseline,
  });
  assert.equal(sourceMismatch.status, 'scene-mismatch');
  assert.equal(sourceMismatch.sceneMatch, false);
});

test('rejects corrupt PNGs, inconsistent hashes, and executable or additive receipt shapes', async () => {
  const png = createPng(1, 1, [1, 2, 3, 255]);
  const actual = await createCapture(png, 1, 1);
  await assert.rejects(
    () =>
      compareTileflowCaptureToBaseline(actual, {
        png: new Uint8Array([1, 2, 3]),
        receipt: actual.receipt,
      }),
    /not a valid PNG|dimensions do not match/,
  );

  const wrongHash = structuredClone(actual.receipt);
  wrongHash.image.sha256 = 'f'.repeat(64);
  await assert.rejects(
    () => compareTileflowCaptureToBaseline(actual, {png, receipt: wrongHash}),
    /hash does not match/,
  );

  const corruptCrc = new Uint8Array(png);
  corruptCrc[corruptCrc.byteLength - 13] ^= 1;
  const corruptCrcReceipt = await createReceipt(corruptCrc, 1, 1, {
    chromiumVersion: 'mismatch',
  });
  await assert.rejects(
    () =>
      compareTileflowCaptureToBaseline(actual, {
        png: corruptCrc,
        receipt: corruptCrcReceipt,
      }),
    /decoded safely/,
  );

  assert.throws(() => parseTileflowCaptureReceipt('{"schemaVersion":2}'), /missing or unsupported/);
  assert.throws(
    () => parseTileflowCaptureReceipt(JSON.stringify({...actual.receipt, execute: 'never'})),
    /missing or unsupported/,
  );
  assert.throws(() => parseTileflowCaptureReceipt(' '.repeat(64 * 1024 + 1)), /byte limit/);
});

test('rejects interlaced baseline PNGs before pngjs can take its unbounded inflate path', async () => {
  const actualPng = createPng(1, 1, [1, 2, 3, 255]);
  const interlacedPng = createInterlacedPng([1, 2, 3, 255]);
  const actual = await createCapture(actualPng, 1, 1);
  const interlacedReceipt = await createReceipt(interlacedPng, 1, 1);

  await assert.rejects(
    () =>
      compareTileflowCaptureToBaseline(actual, {
        png: interlacedPng,
        receipt: interlacedReceipt,
      }),
    /interlaced/i,
  );
});

test('rejects bidirectional, non-ASCII, and path-like runtime identity spoofing', async () => {
  const png = createPng(1, 1, [1, 2, 3, 255]);
  const receipt = await createReceipt(png, 1, 1);

  for (const value of ['148.0\u202Etxt.exe', 'runtime/../../escape']) {
    const spoofed = structuredClone(receipt);
    spoofed.renderer.chromiumVersion = value;
    assert.throws(
      () => parseTileflowCaptureReceipt(serializeTileflowCaptureReceipt(spoofed)),
      /renderer\.chromiumVersion/,
    );
  }
});

test('rejects duplicate-key receipt JSON instead of accepting parser-dependent identity', async () => {
  const png = createPng(1, 1, [1, 2, 3, 255]);
  const receipt = await createReceipt(png, 1, 1);
  const canonical = serializeTileflowCaptureReceipt(receipt);
  const ambiguous = canonical.replace('"schemaVersion":2', '"schemaVersion":0,"schemaVersion":2');

  assert.throws(() => parseTileflowCaptureReceipt(ambiguous), /canonical|unsupported|duplicate/i);
});

async function createCapture(
  png: Uint8Array,
  physicalWidth: number,
  physicalHeight: number,
): Promise<TileflowCapture> {
  const receipt = await createReceipt(png, physicalWidth, physicalHeight);
  return {
    scene: receipt.scene.name,
    map: receipt.scene.map,
    target: receipt.scene.target,
    png,
    sha256: receipt.image.sha256,
    sceneSha256: receipt.scene.sha256,
    styleSha256: receipt.style.sha256,
    width: receipt.image.cssWidth,
    height: receipt.image.cssHeight,
    dpr: receipt.image.dpr,
    networkDependent: receipt.networkDependent,
    renderer: receipt.renderer,
    receipt,
    warnings: [],
  };
}

async function createReceipt(
  png: Uint8Array,
  physicalWidth: number,
  physicalHeight: number,
  overrides: {chromiumVersion?: string; sceneSha256?: string} = {},
): Promise<TileflowCaptureReceipt> {
  const renderer = createTileflowCaptureRendererIdentity();
  if (overrides.chromiumVersion) renderer.chromiumVersion = overrides.chromiumVersion;
  return createTileflowCaptureReceipt({
    data: dataIdentity,
    dpr: 1,
    height: physicalHeight,
    map: 'main',
    networkDependent: false,
    pngSha256: await sha256Hex(png),
    renderer,
    scene: 'proof',
    sceneSha256: overrides.sceneSha256 ?? 'a'.repeat(64),
    styleSha256: 'b'.repeat(64),
    target: 'map',
    width: physicalWidth,
  });
}

function createPng(
  width: number,
  height: number,
  fill: [number, number, number, number],
  pixels: Array<[number, number, number, number, number, number]> = [],
): Uint8Array {
  const image = new PNG({height, width});
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    image.data.set(fill, offset);
  }
  for (const [x, y, red, green, blue, alpha] of pixels) {
    image.data.set([red, green, blue, alpha], (y * width + x) * 4);
  }
  return new Uint8Array(PNG.sync.write(image, {colorType: 6, filterType: 4, inputColorType: 6}));
}

function createInterlacedPng(fill: [number, number, number, number]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const headerView = new DataView(ihdr.buffer);
  headerView.setUint32(0, 1);
  headerView.setUint32(4, 1);
  ihdr.set([8, 6, 0, 0, 1], 8);
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, ...fill])));
  const chunks = [
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array()),
  ];
  const length = signature.byteLength + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const png = new Uint8Array(length);
  png.set(signature);
  let offset = signature.byteLength;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return png;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)));
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function countOpaquePixels(data: Uint8Array): number {
  let count = 0;
  for (let offset = 3; offset < data.byteLength; offset += 4) {
    if (data[offset] !== 0) count += 1;
  }
  return count;
}
