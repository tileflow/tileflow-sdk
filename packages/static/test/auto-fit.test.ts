import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileStaticOverlays,
  createRenderManifest,
  createStaticMap,
  hashStaticSceneRequest,
  marker,
  prepareStaticMapRequest,
  StaticMapRequestError,
  staticMapRequestErrorResponseSchema,
  validateStaticRenderManifest,
  validateStaticScene,
} from '../src/index';

const baseAutoScene = {
  camera: {type: 'auto' as const},
  map: 'main',
  overlays: [
    {
      coordinate: [0, 0] as [number, number],
      type: 'marker' as const,
    },
  ],
  size: {height: 300, width: 400},
  theme: 'light',
};

test('normalizes auto-fit defaults and equivalent padding spellings canonically', async () => {
  const implicit = validateStaticScene(baseAutoScene);
  const scalar = validateStaticScene({
    ...baseAutoScene,
    camera: {padding: 15, type: 'auto'},
  });
  const fourSides = validateStaticScene({
    ...baseAutoScene,
    camera: {
      padding: {bottom: 15, left: 15, right: 15, top: 15},
      type: 'auto',
    },
  });

  assert.equal(implicit.ok, true);
  assert.equal(scalar.ok, true);
  assert.equal(fourSides.ok, true);
  if (!implicit.ok || !scalar.ok || !fourSides.ok) return;

  assert.deepEqual(implicit.scene.camera, {
    bearing: 0,
    maxZoom: 16,
    padding: {bottom: 15, left: 15, right: 15, top: 15},
    type: 'auto',
  });
  assert.deepEqual(implicit.scene, scalar.scene);
  assert.deepEqual(scalar.scene, fourSides.scene);
  assert.equal(
    await hashStaticSceneRequest(implicit.scene),
    await hashStaticSceneRequest(scalar.scene),
  );
});

test('uses zero for omitted sides of an explicit padding object', () => {
  const result = validateStaticScene({
    ...baseAutoScene,
    camera: {padding: {right: 260}, type: 'auto'},
  });

  assert.equal(result.ok, true);
  if (!result.ok || result.scene.camera.type !== 'auto') return;
  assert.deepEqual(result.scene.camera.padding, {bottom: 0, left: 0, right: 260, top: 0});
});

test('keeps auto-fit intent distinct from explicit camera hashes', async () => {
  const autoHash = await hashStaticSceneRequest(baseAutoScene);
  const centerHash = await hashStaticSceneRequest({
    ...baseAutoScene,
    camera: {center: [0, 0], type: 'center', zoom: 16},
  });

  assert.notEqual(autoHash, centerHash);
});

test('returns a stable failure when auto-fit has no overlays', () => {
  const result = validateStaticScene({...baseAutoScene, overlays: []});

  assert.deepEqual(result, {
    code: 'AUTO_FIT_EMPTY',
    error: 'Auto-fit requires at least one overlay',
    ok: false,
    reason: 'NO_FITTABLE_OVERLAYS',
    retryable: false,
  });
});

test('rejects out-of-domain overlay latitude without restricting the camera domain', () => {
  const invalidOverlay = validateStaticScene({
    camera: {center: [0, 89], type: 'center', zoom: 2},
    map: 'main',
    overlays: [{coordinate: [12, 86], id: 'polar-place', type: 'marker'}],
    size: {height: 300, width: 400},
    theme: 'light',
  });
  const validPolarCamera = validateStaticScene({
    camera: {center: [0, 89], type: 'center', zoom: 2},
    map: 'main',
    overlays: [{coordinate: [12, 85], type: 'marker'}],
    size: {height: 300, width: 400},
    theme: 'light',
  });

  assert.deepEqual(invalidOverlay, {
    code: 'STATIC_OVERLAY_INVALID',
    details: {
      latitude: 86,
      limit: 85.051129,
      overlay: {id: 'polar-place', index: 0, type: 'marker'},
    },
    error: 'Overlay overlays.0 latitude 86 exceeds the supported ±85.051129° range',
    ok: false,
    reason: 'OVERLAY_LATITUDE_OUT_OF_RANGE',
    retryable: false,
  });
  assert.equal(validPolarCamera.ok, true);
  assert.throws(() => marker({coordinate: [0, 90]}), /85\.051129/);
});

test('does not construct structured latitude details outside the overlay limit', () => {
  const result = validateStaticScene({
    ...baseAutoScene,
    overlays: Array.from({length: 25}, (_, index) => ({
      coordinate: [0, index === 24 ? 86 : 0],
      type: 'marker',
    })),
  });

  assert.equal(result.ok, false);
  assert.equal('code' in result, false);
  assert.match(result.error, /at most 24|too big/iu);
});

test('keeps a finite latitude outside world bounds in the stable overlay failure', () => {
  const result = validateStaticScene({
    ...baseAutoScene,
    overlays: [
      {
        coordinates: [
          [0, 0],
          [1, -100],
        ],
        id: 'invalid-route',
        type: 'line',
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal('code' in result && result.code, 'STATIC_OVERLAY_INVALID');
  if (result.ok || !('code' in result)) return;
  const {ok: _ok, ...response} = result;
  assert.equal(staticMapRequestErrorResponseSchema.safeParse(response).success, true);
  assert.deepEqual(result.details, {
    latitude: -100,
    limit: 85.051129,
    overlay: {id: 'invalid-route', index: 0, type: 'line'},
  });
});

test('returns required insets when the nominal footprint cannot fit', () => {
  const result = validateStaticScene({
    ...baseAutoScene,
    camera: {padding: 1, type: 'auto'},
    overlays: [{coordinate: [0, 0], radius: 30, strokeWidth: 3, type: 'circle'}],
    size: {height: 64, width: 64},
  });

  assert.deepEqual(result, {
    code: 'AUTO_FIT_IMPOSSIBLE',
    details: {
      padding: {bottom: 1, left: 1, right: 1, top: 1},
      requiredInsets: {bottom: 34, left: 34, right: 34, top: 34},
      viewport: {height: 64, width: 64},
    },
    error: 'Auto-fit nominal footprint leaves no usable viewport',
    ok: false,
    reason: 'INSUFFICIENT_VIEWPORT',
    retryable: false,
  });
});

test('keeps every schema-valid padding rejection inside the structured error contract', () => {
  const input = {
    ...baseAutoScene,
    camera: {padding: Number.MAX_SAFE_INTEGER, type: 'auto' as const},
  };
  const result = validateStaticScene(input);

  assert.equal(result.ok, false);
  if (result.ok) return;
  const {ok: _ok, ...response} = result;
  assert.equal(staticMapRequestErrorResponseSchema.safeParse(response).success, true);
  assert.throws(() => prepareStaticMapRequest(input), StaticMapRequestError);
});

test('uses the minimum circular interval for point-like overlays', () => {
  const manifest = createManifest({
    ...baseAutoScene,
    camera: {padding: 0, type: 'auto'},
    overlays: [
      {coordinate: [179, -4], radius: 2, strokeWidth: 0, type: 'circle'},
      {coordinate: [-179, 5], radius: 2, strokeWidth: 0, type: 'circle'},
    ],
  });

  assert.deepEqual(manifest.autoFit?.bounds, [179, -4, 181, 5]);
  assert.deepEqual(manifest.autoFit?.longitudeOffsets, [0, 360]);
});

test('rejects an internally ambiguous line without reinterpreting its vertices', () => {
  const result = validateStaticScene({
    ...baseAutoScene,
    overlays: [
      {
        coordinates: [
          [179, 0],
          [-179, 1],
        ],
        id: 'pacific-route',
        type: 'line',
      },
    ],
  });

  assert.deepEqual(result, {
    code: 'AUTO_FIT_AMBIGUOUS',
    details: {
      overlay: {id: 'pacific-route', index: 0, type: 'line'},
      segmentIndex: 0,
    },
    error: 'Overlay overlays.0 requires an explicit antimeridian wrap decision',
    ok: false,
    reason: 'ANTIMERIDIAN_WRAP_REQUIRED',
    retryable: false,
  });
});

test('moves cut line components whole and preserves their exact style', () => {
  const style = {color: '#123456', opacity: 0.4, width: 7};
  const manifest = createManifest({
    ...baseAutoScene,
    camera: {padding: 0, type: 'auto'},
    overlays: [
      {
        ...style,
        coordinates: [
          [170, 0],
          [180, 1],
        ],
        id: 'route-east',
        type: 'line',
      },
      {
        ...style,
        coordinates: [
          [-180, 1],
          [-170, 2],
        ],
        id: 'route-west',
        type: 'line',
      },
    ],
  });

  assert.deepEqual(manifest.autoFit?.bounds, [170, 0, 190, 2]);
  assert.deepEqual(manifest.autoFit?.longitudeOffsets, [0, 360]);

  const compiled = compileStaticOverlays(manifest.scene.overlays, {
    longitudeOffsets: manifest.autoFit?.longitudeOffsets,
  });
  const sources = Object.values(compiled.sources);
  const layers = compiled.layers;

  assert.deepEqual((sources[0]?.data as {geometry: {coordinates: unknown}}).geometry.coordinates, [
    [170, 0],
    [180, 1],
  ]);
  assert.deepEqual((sources[1]?.data as {geometry: {coordinates: unknown}}).geometry.coordinates, [
    [180, 1],
    [190, 2],
  ]);
  assert.deepEqual(layers[0]?.layout, layers[1]?.layout);
  assert.deepEqual(layers[0]?.paint, layers[1]?.paint);
});

test('moves cut polygon components whole and preserves their exact style', () => {
  const style = {fill: '#abcdef', opacity: 0, stroke: '#123456', strokeWidth: 3};
  const manifest = createManifest({
    ...baseAutoScene,
    camera: {padding: 0, type: 'auto'},
    overlays: [
      {
        ...style,
        coordinates: [
          [
            [170, -10],
            [180, -10],
            [180, 10],
            [170, 10],
            [170, -10],
          ],
        ],
        id: 'region-east',
        type: 'polygon',
      },
      {
        ...style,
        coordinates: [
          [
            [-180, -10],
            [-170, -10],
            [-170, 10],
            [-180, 10],
            [-180, -10],
          ],
        ],
        id: 'region-west',
        type: 'polygon',
      },
    ],
  });

  assert.deepEqual(manifest.autoFit?.bounds, [170, -10, 190, 10]);
  assert.deepEqual(manifest.autoFit?.longitudeOffsets, [0, 360]);

  const compiled = compileStaticOverlays(manifest.scene.overlays, {
    longitudeOffsets: manifest.autoFit?.longitudeOffsets,
  });
  assert.deepEqual(compiled.layers[0]?.paint, compiled.layers[2]?.paint);
  assert.deepEqual(compiled.layers[1]?.layout, compiled.layers[3]?.layout);
  assert.deepEqual(compiled.layers[1]?.paint, compiled.layers[3]?.paint);
});

test('includes transparent overlays and rounds the largest nominal footprint outward', () => {
  const manifest = createManifest({
    ...baseAutoScene,
    camera: {padding: {bottom: 4, left: 3, right: 2, top: 1}, type: 'auto'},
    overlays: [
      {
        coordinate: [-20, 10],
        opacity: 0,
        radius: 6.2,
        strokeWidth: 1.1,
        type: 'circle',
      },
      {
        coordinates: [
          [10, -5],
          [20, -5],
        ],
        opacity: 0,
        width: 3,
        type: 'line',
      },
    ],
  });

  assert.deepEqual(manifest.autoFit?.bounds, [-20, -5, 20, 10]);
  assert.deepEqual(manifest.autoFit?.nominalInsets, {
    bottom: 8,
    left: 8,
    right: 8,
    top: 8,
  });
  assert.deepEqual(manifest.autoFit?.requiredInsets, {
    bottom: 12,
    left: 11,
    right: 10,
    top: 9,
  });
});

test('keeps horizontal and vertical degenerate extents valid', () => {
  const horizontal = createManifest({
    ...baseAutoScene,
    overlays: [
      {
        coordinates: [
          [-10, 5],
          [10, 5],
        ],
        type: 'line',
      },
    ],
  });
  const vertical = createManifest({
    ...baseAutoScene,
    overlays: [
      {
        coordinates: [
          [5, -10],
          [5, 10],
        ],
        type: 'line',
      },
    ],
  });

  assert.deepEqual(horizontal.autoFit?.bounds, [-10, 5, 10, 5]);
  assert.deepEqual(vertical.autoFit?.bounds, [5, -10, 5, 10]);
});

test('rejects a missing or forged renderer auto-fit plan', () => {
  const manifest = createManifest(baseAutoScene);
  const {autoFit: _autoFit, ...missing} = manifest;
  const forged = {
    ...manifest,
    autoFit: {...manifest.autoFit, longitudeOffsets: [360]},
  };

  assert.equal(validateStaticRenderManifest(missing).ok, false);
  assert.equal(validateStaticRenderManifest(forged).ok, false);
  assert.equal(validateStaticRenderManifest(manifest).ok, true);
});

test('preserves a bounded remote auto-fit error as a typed SDK error', async () => {
  await assert.rejects(
    createStaticMap(baseAutoScene, {
      fetch: async () =>
        Response.json(
          {
            code: 'AUTO_FIT_IMPOSSIBLE',
            details: {
              projection: 'globe',
              viewport: {height: 300, width: 400},
            },
            error: 'The overlays cannot be shown simultaneously on this globe',
            reason: 'GLOBE_NOT_SIMULTANEOUSLY_VISIBLE',
            retryable: false,
          },
          {status: 422},
        ),
      idempotencyKey: 'static_12345678',
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaticMapRequestError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'AUTO_FIT_IMPOSSIBLE');
      assert.equal(error.reason, 'GLOBE_NOT_SIMULTANEOUSLY_VISIBLE');
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, {
        projection: 'globe',
        viewport: {height: 300, width: 400},
      });
      return true;
    },
  );
});

test('trusts structured request failures only on their contractual 422 status', async () => {
  await assert.rejects(
    createStaticMap(baseAutoScene, {
      fetch: async () =>
        Response.json(
          {
            code: 'AUTO_FIT_IMPOSSIBLE',
            error: 'Untrusted status/body combination',
            reason: 'CAMERA_UNRESOLVABLE',
            retryable: false,
          },
          {status: 503},
        ),
      idempotencyKey: 'static_12345678',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof StaticMapRequestError, false);
      assert.match(error.message, /503/u);
      return true;
    },
  );
});

function createManifest(scene: Parameters<typeof createRenderManifest>[0]['scene']) {
  return createRenderManifest({
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v1',
    scene,
    styleRevision: 'revision-1',
    styleUrl: 'https://api.example.test/style.json',
  });
}
