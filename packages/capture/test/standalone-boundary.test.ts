import assert from 'node:assert/strict';
import test from 'node:test';
import type {Browser, BrowserContext, Locator, Page} from 'playwright';
import type {MapLibreStyle, NormalizedTileflowCaptureScene} from '@tileflow/core';
import {TileflowCaptureError} from '../src/errors';
import {captureStandaloneTileflowScene} from '../src/standalone';

type PhaseResult = {status: 'ok'} | {reason: 'error' | 'timeout'; status: 'failed'};

test('rejects invalid styles before creating a browser context', async () => {
  let contexts = 0;
  const browser = {
    newContext: async () => {
      contexts += 1;
      throw new Error('must not launch');
    },
  } as unknown as Browser;
  const invalidStyle: MapLibreStyle = {
    ...style,
    layers: [{id: 'background', type: 'background', paint: {'background-color': 42}}],
  };

  await assert.rejects(
    () => captureStandaloneTileflowScene({assets: [], browser, scene, style: invalidStyle}),
    captureError('STYLE_INVALID', 'style-validation'),
  );
  assert.equal(contexts, 0);
});

test('classifies MapLibre load errors separately from load and idle timeouts', async () => {
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({load: {reason: 'error', status: 'failed'}}),
        scene,
        style,
      }),
    captureError('MAP_LOAD_FAILED', 'map-load'),
  );
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({load: {reason: 'timeout', status: 'failed'}}),
        scene,
        style,
      }),
    captureError('CAPTURE_TIMEOUT', 'map-load'),
  );
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({idle: {reason: 'timeout', status: 'failed'}}),
        scene,
        style,
      }),
    captureError('CAPTURE_TIMEOUT', 'map-idle'),
  );
});

test('prefers a sanitized glyph 404 over a generic MapLibre load error', async () => {
  const browser = createBrowser({
    load: {reason: 'error', status: 'failed'},
    onEvaluate(call, handlers) {
      if (call !== 1) return;
      handlers.get('response')?.({
        status: () => 404,
        url: () =>
          'https://user:secret@fonts.example.test/fonts/Noto%20Sans/0-255.pbf?token=hidden',
      });
    },
  });

  await assert.rejects(
    () => captureStandaloneTileflowScene({assets: [], browser, scene, style}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowCaptureError);
      assert.equal(error.code, 'RESOURCE_FAILED');
      assert.equal(error.details?.phase, 'resource-load');
      assert.deepEqual(error.details?.resources, [
        {
          context: 'fontStack: Noto Sans',
          kind: 'glyph',
          origin: 'https://fonts.example.test',
          status: 404,
        },
      ]);
      assert.doesNotMatch(JSON.stringify(error.details), /user:secret|token=hidden|0-255/);
      return true;
    },
  );
});

test('identifies screenshot API, page, and PNG validation failures', async () => {
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({screenshot: async () => Promise.reject(new Error('closed'))}),
        scene,
        style,
      }),
    captureError('SCREENSHOT_FAILED', 'screenshot'),
  );
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({
          screenshot: async (handlers) => {
            handlers.get('pageerror')?.(new Error('late render failure'));
            return Buffer.from(pngHeader(64, 64));
          },
        }),
        scene,
        style,
      }),
    captureError('SCREENSHOT_FAILED', 'screenshot'),
  );
  await assert.rejects(
    () =>
      captureStandaloneTileflowScene({
        assets: [],
        browser: createBrowser({
          screenshot: async () => Buffer.from(pngHeader(32, 64)),
        }),
        scene,
        style,
      }),
    captureError('INVALID_PNG', 'screenshot'),
  );
});

function createBrowser(options: {
  idle?: PhaseResult;
  load?: PhaseResult;
  onEvaluate?: (call: number, handlers: Map<string, (...args: unknown[]) => void>) => void;
  screenshot?: (handlers: Map<string, (...args: unknown[]) => void>) => Promise<Buffer>;
}): Browser {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let evaluateCalls = 0;
  const locator = {
    screenshot: async () => options.screenshot?.(handlers) ?? Buffer.from(pngHeader(64, 64)),
  } as unknown as Locator;
  const page = {
    addScriptTag: async () => undefined,
    addStyleTag: async () => undefined,
    evaluate: async () => {
      evaluateCalls += 1;
      options.onEvaluate?.(evaluateCalls, handlers);
      return evaluateCalls === 1
        ? (options.load ?? {status: 'ok'})
        : (options.idle ?? {status: 'ok'});
    },
    locator: () => locator,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return page;
    },
    setContent: async () => undefined,
    setDefaultTimeout: () => undefined,
  } as unknown as Page;
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    route: async () => undefined,
    routeWebSocket: async () => undefined,
  } as unknown as BrowserContext;
  return {newContext: async () => context} as unknown as Browser;
}

function captureError(code: string, phase: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof TileflowCaptureError);
    assert.equal(error.code, code);
    assert.equal(error.details?.phase, phase);
    return true;
  };
}

const scene: NormalizedTileflowCaptureScene = {
  map: 'proof',
  camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
  viewport: {width: 64, height: 64, dpr: 1},
  target: {kind: 'map'},
};

const style: MapLibreStyle = {
  version: 8,
  name: 'Boundary fixture',
  sources: {},
  layers: [],
};

function pngHeader(width: number, height: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}
