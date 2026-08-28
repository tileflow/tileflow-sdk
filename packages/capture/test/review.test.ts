import assert from 'node:assert/strict';
import test from 'node:test';
import {PNG} from 'pngjs';
import {
  normalizeTileflowCaptureScene,
  serializeCanonicalJson,
  sha256Hex,
  type TileflowCaptureScene,
} from '@tileflow/core';
import {
  compareTileflowCapturesForReview,
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  createTileflowVisualReviewDocument,
  tileflowVisualArtifactLimits,
  tileflowVisualReviewLimits,
  type TileflowCapture,
  type TileflowCaptureDataInput,
  type TileflowVisualReviewCapture,
  type TileflowVisualReviewDefinition,
  TileflowVisualReviewError,
} from '../src/index';
import {validateTileflowVisualReviewPngByteLengths} from '../src/review';

const dataIdentity: TileflowCaptureDataInput = {
  archiveSha256: 'd'.repeat(64),
  contractSha256: 'e'.repeat(64),
  dataContractSha256: 'f'.repeat(64),
  descriptorSha256: 'c'.repeat(64),
  kind: 'tileflow-world',
  product: 'world-v1',
  releaseId: 'world-v1-review-fixture',
  schema: 'openmaptiles',
  schemaVersion: 1,
  sourceId: 'tileflow',
};

test('compares deliberate map, theme, and style variants without creating baseline semantics', async () => {
  const left = await createReviewCapture({
    color: [26, 84, 52, 255],
    definition: mapDefinition('harad', 'paper'),
    scene: 'harad-review',
    styleSha256: '1'.repeat(64),
  });
  const right = await createReviewCapture({
    color: [174, 68, 51, 255],
    definition: mapDefinition('ferraris', 'historic'),
    scene: 'ferraris-review',
    styleSha256: '2'.repeat(64),
  });

  const comparison = await compareTileflowCapturesForReview(left, right);

  assert.equal(comparison.kind, 'style-review');
  assert.equal(comparison.status, 'comparable');
  assert.equal(comparison.frameMatch, true);
  assert.equal(comparison.dimensionsMatch, true);
  assert.equal(comparison.rendererMatch, true);
  assert.equal(comparison.dataMatch, true);
  assert.equal(comparison.left.scene.map, 'harad');
  assert.equal(comparison.left.scene.theme, 'paper');
  assert.equal(comparison.right.scene.map, 'ferraris');
  assert.equal(comparison.right.scene.theme, 'historic');
  assert.equal(comparison.left.style.sha256, '1'.repeat(64));
  assert.equal(comparison.right.style.sha256, '2'.repeat(64));
  assert.equal(comparison.exact?.ratio, 1);
  assert.equal(comparison.perceptual?.ratio, 1);
  assert.ok(comparison.diffPng);
  assert.match(comparison.warnings.join('\n'), /do not approve.*baseline/i);

  const document = createTileflowVisualReviewDocument(comparison);
  assert.equal('diffPng' in document, false);
  assert.equal(JSON.stringify(document).includes('diffPng'), false);

  const withoutDiff = await compareTileflowCapturesForReview(left, right, {
    includeDiff: false,
  });
  assert.equal(withoutDiff.status, 'comparable');
  assert.ok(withoutDiff.exact);
  assert.equal(withoutDiff.diffPng, undefined);
});

test('reports right-minus-left appearance metrics for one physical review region', async () => {
  const left = await createReviewCapture({
    color: [255, 255, 255, 255],
    definition: mapDefinition('left-map', 'day'),
    scene: 'left-review',
  });
  const right = await createReviewCapture({
    color: [0, 0, 0, 255],
    definition: mapDefinition('right-map', 'night'),
    scene: 'right-review',
  });
  const comparison = await compareTileflowCapturesForReview(left, right, {
    includeDiff: false,
    region: {x: 4, y: 5, width: 8, height: 6},
  });

  assert.deepEqual(comparison.appearance?.region, {x: 4, y: 5, width: 8, height: 6});
  assert.equal(comparison.appearance?.left.linearLuminance.mean, 1);
  assert.equal(comparison.appearance?.right.linearLuminance.mean, 0);
  assert.equal(comparison.appearance?.rightMinusLeft.linearLuminance.mean, -1);
  assert.equal(comparison.appearance?.rightMinusLeft.oklabLightness.mean, -1);
  assert.equal(comparison.appearance?.rightMinusLeft.oklabChroma.mean, 0);
  assert.equal(comparison.appearance?.rightMinusLeft.edgeDensity, 0);
  assert.equal(comparison.appearance?.rightMinusLeft.localContrast, 0);

  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(left, right, {
        region: {x: 64, y: 0, width: 1, height: 1},
      }),
    isReviewError(/positive integer rectangle.*physical PNG bounds/i),
  );
});

test('rejects definitions, PNG bytes, and capture metadata that do not match schema-v4 receipts', async () => {
  const left = await createReviewCapture({
    color: [10, 20, 30, 255],
    definition: mapDefinition('left-map', 'day'),
    scene: 'left-review',
  });
  const right = await createReviewCapture({
    color: [40, 50, 60, 255],
    definition: mapDefinition('right-map', 'night'),
    scene: 'right-review',
  });
  const wrongDefinition: TileflowVisualReviewCapture = {
    ...right,
    definition: {
      ...right.definition,
      camera: {...right.definition.camera, zoom: 9},
    } as TileflowVisualReviewDefinition,
  };

  await assert.rejects(
    () => compareTileflowCapturesForReview(left, wrongDefinition),
    isReviewError(/definition does not match/i),
  );

  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(left, {
        ...right,
        definition: {
          ...right.definition,
          executableHint: 'never',
        } as TileflowVisualReviewDefinition,
      }),
    isReviewError(/definition is invalid|exact normalized shape/i),
  );

  const wrongPng = new Uint8Array(right.capture.png);
  wrongPng[wrongPng.byteLength - 1] ^= 1;
  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(left, {
        ...right,
        capture: {...right.capture, png: wrongPng},
      }),
    isReviewError(/PNG.*(?:does not match|decoded safely)/i),
  );

  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(left, {
        ...right,
        capture: {...right.capture, map: 'spoofed-map'},
      }),
    isReviewError(/metadata does not match/i),
  );

  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(left, {
        ...right,
        capture: {
          ...right.capture,
          receipt: {
            ...right.capture.receipt,
            unsupported: 'never',
          } as unknown as TileflowCapture['receipt'],
        },
      }),
    isReviewError(/receipt is invalid/i),
  );
});

test('withholds pixel evidence for frame, dimension, runtime, and exact-data mismatches', async () => {
  const commonLeft = await createReviewCapture({
    color: [10, 20, 30, 255],
    definition: mapDefinition('left-map', 'day'),
    scene: 'left-review',
  });

  const frameMismatch = await compareTileflowCapturesForReview(
    commonLeft,
    await createReviewCapture({
      color: [40, 50, 60, 255],
      definition: mapDefinition('right-map', 'night', 8),
      scene: 'right-review',
    }),
  );
  assertIncomparable(frameMismatch, 'frame-mismatch');

  const applicationDefinition = normalizeDefinition({
    map: 'application-map',
    theme: 'day',
    camera: {type: 'center', center: [2, 41], zoom: 7},
    viewport: {width: 64, height: 64, dpr: 1},
    target: {
      kind: 'application',
      path: '/review',
      captureId: 'review-map',
      frame: 'map',
    },
  });
  const dimensionMismatch = await compareTileflowCapturesForReview(
    await createReviewCapture({
      color: [10, 20, 30, 255],
      definition: applicationDefinition,
      scene: 'application-left',
    }),
    await createReviewCapture({
      color: [40, 50, 60, 255],
      cssWidth: 80,
      definition: applicationDefinition,
      scene: 'application-right',
    }),
  );
  assertIncomparable(dimensionMismatch, 'dimensions-mismatch');

  const runtimeMismatch = await compareTileflowCapturesForReview(
    commonLeft,
    await createReviewCapture({
      color: [40, 50, 60, 255],
      definition: mapDefinition('right-map', 'night'),
      rendererVersion: 'different-runtime',
      scene: 'right-review',
    }),
  );
  assertIncomparable(runtimeMismatch, 'runtime-mismatch');

  const differentData: TileflowCaptureDataInput = {
    ...dataIdentity,
    descriptorSha256: '9'.repeat(64),
    releaseId: 'world-v1-other-review-fixture',
  };
  const dataMismatch = await compareTileflowCapturesForReview(
    commonLeft,
    await createReviewCapture({
      color: [40, 50, 60, 255],
      data: differentData,
      definition: mapDefinition('right-map', 'night'),
      scene: 'right-review',
    }),
  );
  assertIncomparable(dataMismatch, 'data-mismatch');

  const invalidIncompatible = await createReviewCapture({
    color: [40, 50, 60, 255],
    definition: mapDefinition('invalid-frame-map', 'night', 9),
    scene: 'invalid-frame-review',
  });
  const corruptPng = new Uint8Array(invalidIncompatible.capture.png);
  corruptPng[corruptPng.byteLength - 1] ^= 1;
  const corruptSha256 = await sha256Hex(corruptPng);
  invalidIncompatible.capture.png = corruptPng;
  invalidIncompatible.capture.sha256 = corruptSha256;
  invalidIncompatible.capture.receipt = {
    ...invalidIncompatible.capture.receipt,
    image: {...invalidIncompatible.capture.receipt.image, sha256: corruptSha256},
  };
  await assert.rejects(
    () => compareTileflowCapturesForReview(commonLeft, invalidIncompatible),
    isReviewError(/right PNG could not be decoded safely/i),
  );
});

test('snapshots plain capture inputs once and rejects executable or non-plain wrappers', async () => {
  const claimed = await createReviewCapture({
    color: [10, 20, 30, 255],
    definition: mapDefinition('claimed-map', 'day'),
    scene: 'claimed-review',
  });
  const right = await createReviewCapture({
    color: [240, 230, 220, 255],
    definition: mapDefinition('right-map', 'night'),
    scene: 'right-review',
  });
  const substituted = await createReviewCapture({
    color: [240, 230, 220, 255],
    data: {
      ...dataIdentity,
      descriptorSha256: '9'.repeat(64),
      releaseId: 'world-v1-substituted-review-fixture',
    },
    definition: mapDefinition('substituted-map', 'night'),
    scene: 'substituted-review',
  });

  const pending = compareTileflowCapturesForReview(claimed, right, {includeDiff: false});
  claimed.capture.png = substituted.capture.png;
  claimed.capture.receipt = substituted.capture.receipt;
  const comparison = await pending;
  assert.equal(comparison.status, 'comparable');
  assert.equal(comparison.dataMatch, true);
  assert.equal(comparison.exact?.ratio, 1);
  assert.equal(comparison.left.image.sha256 === substituted.capture.sha256, false);

  let pngReads = 0;
  const accessorCapture = {...right.capture};
  Object.defineProperty(accessorCapture, 'png', {
    enumerable: true,
    get() {
      pngReads += 1;
      return right.capture.png;
    },
  });
  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(claimed, {
        capture: accessorCapture,
        definition: right.definition,
      }),
    isReviewError(/accessor|plain data/i),
  );
  assert.equal(pngReads, 0);

  const inheritedCapture = Object.assign(Object.create({executable: true}), right.capture);
  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(claimed, {
        capture: inheritedCapture,
        definition: right.definition,
      }),
    isReviewError(/custom prototype/i),
  );

  let proxyTraps = 0;
  const proxiedCapture = new Proxy(
    {...right.capture},
    {
      getOwnPropertyDescriptor() {
        proxyTraps += 1;
        return undefined;
      },
    },
  );
  await assert.rejects(
    () =>
      compareTileflowCapturesForReview(claimed, {
        capture: proxiedCapture,
        definition: right.definition,
      }),
    isReviewError(/executable proxy/i),
  );
  assert.equal(proxyTraps, 0);
});

test('uses only target kind and frame for application frame compatibility', async () => {
  const leftDefinition = normalizeDefinition({
    map: 'left-application-map',
    theme: 'day',
    camera: {type: 'center', center: [2, 41], zoom: 7},
    viewport: {width: 64, height: 64, dpr: 1},
    target: {
      kind: 'application',
      path: '/left-route?panel=one',
      captureId: 'left-map',
      frame: 'map',
    },
  });
  const rightDefinition = normalizeDefinition({
    map: 'right-application-map',
    theme: 'night',
    camera: {type: 'center', center: [2, 41], zoom: 7},
    viewport: {width: 64, height: 64, dpr: 1},
    target: {
      kind: 'application',
      path: '/right-route?panel=two',
      selector: '[data-review-map="right"]',
      frame: 'map',
    },
  });
  const comparison = await compareTileflowCapturesForReview(
    await createReviewCapture({
      color: [10, 20, 30, 255],
      definition: leftDefinition,
      scene: 'application-route-left',
    }),
    await createReviewCapture({
      color: [40, 50, 60, 255],
      definition: rightDefinition,
      scene: 'application-route-right',
    }),
    {includeDiff: false},
  );

  assert.equal(comparison.status, 'comparable');
  assert.equal(comparison.frameMatch, true);
  assert.deepEqual(comparison.left.frame.target, {kind: 'application', frame: 'map'});
  assert.deepEqual(comparison.right.frame.target, {kind: 'application', frame: 'map'});
  assert.equal(JSON.stringify(comparison).includes('/left-route'), false);
  assert.equal(JSON.stringify(comparison).includes('/right-route'), false);
});

test('does not allocate or encode a diff unless compatible callers request it', async () => {
  const left = await createReviewCapture({
    color: [10, 20, 30, 255],
    definition: mapDefinition('left-map', 'day'),
    scene: 'left-review',
  });
  const right = await createReviewCapture({
    color: [40, 50, 60, 255],
    definition: mapDefinition('right-map', 'night'),
    scene: 'right-review',
  });
  const runtimeMismatch = await createReviewCapture({
    color: [40, 50, 60, 255],
    definition: mapDefinition('runtime-map', 'night'),
    rendererVersion: 'different-runtime',
    scene: 'runtime-review',
  });
  const originalWrite = PNG.sync.write;
  let writes = 0;
  PNG.sync.write = ((...arguments_: Parameters<typeof PNG.sync.write>) => {
    writes += 1;
    return originalWrite(...arguments_);
  }) as typeof PNG.sync.write;
  try {
    const withoutDiff = await compareTileflowCapturesForReview(left, right, {includeDiff: false});
    assert.ok(withoutDiff.exact);
    assert.equal(withoutDiff.diffPng, undefined);
    assert.equal(writes, 0);

    const incompatible = await compareTileflowCapturesForReview(left, runtimeMismatch, {
      includeDiff: true,
    });
    assertIncomparable(incompatible, 'runtime-mismatch');
    assert.equal(writes, 0);
  } finally {
    PNG.sync.write = originalWrite;
  }
});

test('preflights individual and aggregate PNG byte limits without allocating oversized fixtures', () => {
  const maximum = tileflowVisualArtifactLimits.maximumPngBytes;
  assert.equal(tileflowVisualReviewLimits.maximumAggregatePngBytes, maximum);
  assert.throws(
    () => validateTileflowVisualReviewPngByteLengths(maximum + 1, 0),
    isReviewError(/left PNG exceeds/i),
  );
  assert.throws(
    () => validateTileflowVisualReviewPngByteLengths(maximum, 1),
    isReviewError(/aggregate/i),
  );
});

function mapDefinition(map: string, theme: string, zoom = 7): TileflowVisualReviewDefinition {
  return normalizeDefinition({
    map,
    theme,
    camera: {type: 'center', center: [2, 41], zoom},
    viewport: {width: 64, height: 64, dpr: 1},
    target: {kind: 'map'},
  });
}

function normalizeDefinition(
  definition: TileflowCaptureScene & {theme: string},
): TileflowVisualReviewDefinition {
  const normalized = normalizeTileflowCaptureScene(definition);
  assert.ok(normalized.theme);
  return {...normalized, theme: normalized.theme};
}

async function createReviewCapture(options: {
  color: [number, number, number, number];
  cssHeight?: number;
  cssWidth?: number;
  data?: TileflowCaptureDataInput;
  definition: TileflowVisualReviewDefinition;
  networkDependent?: boolean;
  rendererVersion?: string;
  scene: string;
  styleSha256?: string;
}): Promise<TileflowVisualReviewCapture> {
  const width = options.cssWidth ?? options.definition.viewport.width;
  const height = options.cssHeight ?? options.definition.viewport.height;
  const dpr = options.definition.viewport.dpr;
  const png = createPng(width * dpr, height * dpr, options.color);
  const renderer = createTileflowCaptureRendererIdentity();
  if (options.rendererVersion) renderer.chromiumVersion = options.rendererVersion;
  const networkDependent = options.networkDependent ?? false;
  const sceneSha256 = await sha256Hex(serializeCanonicalJson(options.definition));
  const styleSha256 = options.styleSha256 ?? 'b'.repeat(64);
  const receipt = createTileflowCaptureReceipt({
    data: options.data ?? dataIdentity,
    dpr,
    height,
    map: options.definition.map,
    theme: options.definition.theme,
    networkDependent,
    pngSha256: await sha256Hex(png),
    renderer,
    scene: options.scene,
    sceneSha256,
    styleSha256,
    target: options.definition.target.kind,
    width,
  });
  const capture: TileflowCapture = {
    scene: receipt.scene.name,
    map: receipt.scene.map,
    theme: receipt.scene.theme,
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
  return {capture, definition: options.definition};
}

function createPng(
  width: number,
  height: number,
  fill: [number, number, number, number],
): Uint8Array {
  const image = new PNG({height, width});
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    image.data.set(fill, offset);
  }
  return new Uint8Array(PNG.sync.write(image, {colorType: 6, filterType: 4, inputColorType: 6}));
}

function assertIncomparable(
  comparison: Awaited<ReturnType<typeof compareTileflowCapturesForReview>>,
  status: Exclude<typeof comparison.status, 'comparable'>,
): void {
  assert.equal(comparison.status, status);
  assert.equal(comparison.exact, null);
  assert.equal(comparison.perceptual, null);
  assert.equal(comparison.meanAbsoluteChannelDifference, null);
  assert.equal(comparison.appearance, null);
  assert.equal(comparison.diffPng, undefined);
  assert.match(comparison.warnings.join('\n'), /not computed/i);
}

function isReviewError(pattern: RegExp): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof TileflowVisualReviewError);
    assert.equal(error.code, 'VISUAL_REVIEW_INVALID');
    assert.match(error.message, pattern);
    return true;
  };
}
