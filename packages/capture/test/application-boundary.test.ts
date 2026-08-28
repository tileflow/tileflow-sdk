import assert from 'node:assert/strict';
import test from 'node:test';
import type {Browser, BrowserContext, Locator, Page, Response} from 'playwright';
import type {NormalizedTileflowCaptureScene} from '@tileflow/core';
import {captureApplicationTileflowScene} from '../src/application';
import {TileflowCaptureError} from '../src/errors';

test('rejects an oversized map target before requesting screenshot bytes', async () => {
  let screenshotCalls = 0;
  const png = pngHeader(1, 1);
  const locator = {
    boundingBox: async () => ({height: 4_097, width: 4_097, x: 0, y: 0}),
    count: async () => 1,
    evaluate: async () => undefined,
    getAttribute: async (name: string) => (name === 'data-tileflow-theme' ? 'light' : 'idle'),
    screenshot: async () => {
      screenshotCalls += 1;
      return Buffer.from(png);
    },
    waitFor: async () => undefined,
  } as unknown as Locator;
  const page = {
    goto: async () => ({status: () => 200, url: () => 'http://127.0.0.1:3000/'}) as Response,
    locator: () => locator,
    mainFrame: () => ({}),
    newPage: async () => undefined,
    on: () => page,
    route: async () => undefined,
    screenshot: async () => Buffer.from(png),
    setDefaultTimeout: () => undefined,
    url: () => 'http://127.0.0.1:3000/',
  } as unknown as Page;
  const context = {
    close: async () => undefined,
    newPage: async () => page,
  } as unknown as BrowserContext;
  const browser = {
    newContext: async () => context,
  } as unknown as Browser;

  await assert.rejects(
    () =>
      captureApplicationTileflowScene({
        appOrigin: 'http://127.0.0.1:3000',
        browser,
        colorScheme: 'light',
        scene: applicationScene,
      }),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'RENDER_FAILED',
  );
  assert.equal(screenshotCalls, 0);
});

test('labels external WebSocket input as a remote visual dependency', async () => {
  const {browser, handlers} = fakeApplicationBrowser();
  const resultPromise = captureApplicationTileflowScene({
    appOrigin: 'http://127.0.0.1:3000',
    browser,
    colorScheme: 'light',
    scene: applicationScene,
  });
  while (!handlers.has('websocket')) await new Promise((resolve) => setImmediate(resolve));
  handlers.get('websocket')?.({url: () => 'ws://remote.example/socket'});
  const result = await resultPromise;

  assert.equal(result.networkDependent, true);
  assert.deepEqual(result.warnings, [
    'Application capture requested remote resources from ws://remote.example.',
  ]);
});

test('fails when the application reports an error during screenshot capture', async () => {
  const {browser, handlers, locator} = fakeApplicationBrowser();
  locator.screenshot = async () => {
    handlers.get('console')?.({type: () => 'error'});
    return Buffer.from(pngHeader(64, 64));
  };

  await assert.rejects(
    () =>
      captureApplicationTileflowScene({
        appOrigin: 'http://127.0.0.1:3000',
        browser,
        colorScheme: 'light',
        scene: applicationScene,
      }),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'APPLICATION_ERROR',
  );
});

test('fails when the selected target becomes non-idle during screenshot capture', async () => {
  const {browser, locator} = fakeApplicationBrowser();
  let state = 'idle';
  locator.getAttribute = async (name) => (name === 'data-tileflow-theme' ? 'light' : state);
  locator.screenshot = async () => {
    state = 'loading';
    return Buffer.from(pngHeader(64, 64));
  };

  await assert.rejects(
    () =>
      captureApplicationTileflowScene({
        appOrigin: 'http://127.0.0.1:3000',
        browser,
        colorScheme: 'light',
        scene: applicationScene,
      }),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'APPLICATION_ERROR',
  );
});

test('rejects a final application document URL that adds a fragment after navigation', async () => {
  const {browser} = fakeApplicationBrowser('http://127.0.0.1:3000/proof#escaped');

  await assert.rejects(
    () =>
      captureApplicationTileflowScene({
        appOrigin: 'http://127.0.0.1:3000',
        browser,
        colorScheme: 'light',
        scene: applicationScene,
      }),
    (error: unknown) =>
      error instanceof TileflowCaptureError && error.code === 'APPLICATION_NAVIGATION_FAILED',
  );
});

test('waits for an implicit map and theme target for the full capture budget', async () => {
  const {browser, locator} = fakeApplicationBrowser();
  let count = 0;
  const waitCalls: Array<{state?: string; timeout?: number}> = [];
  locator.count = async () => count;
  locator.waitFor = async (options) => {
    waitCalls.push(options ?? {});
    if (options?.state === 'attached') count = 1;
  };
  locator.first = () => locator as unknown as Locator;

  const result = await captureApplicationTileflowScene({
    appOrigin: 'http://127.0.0.1:3000',
    browser,
    colorScheme: 'light',
    scene: {
      ...applicationScene,
      target: {kind: 'application', path: '/', frame: 'map'},
    },
    timeoutMs: 7_500,
  });

  assert.deepEqual(waitCalls[0], {state: 'attached', timeout: 7_500});
  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
});

const applicationScene: NormalizedTileflowCaptureScene & {
  target: {kind: 'application'; path: string; captureId: string; frame: 'map'};
} = {
  map: 'main',
  theme: 'light',
  camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
  viewport: {width: 320, height: 240, dpr: 1},
  target: {kind: 'application', path: '/', captureId: 'main', frame: 'map'},
};

function pngHeader(width: number, height: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

function fakeApplicationBrowser(pageUrl = 'http://127.0.0.1:3000/'): {
  browser: Browser;
  handlers: Map<string, (...args: unknown[]) => void>;
  locator: {
    boundingBox(): Promise<{height: number; width: number; x: number; y: number}>;
    count(): Promise<number>;
    evaluate(): Promise<void>;
    first(): Locator;
    getAttribute(name: string): Promise<string | null>;
    screenshot(): Promise<Buffer>;
    waitFor(options?: {state?: string; timeout?: number}): Promise<void>;
  };
} {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const locator = {
    boundingBox: async () => ({height: 64, width: 64, x: 0, y: 0}),
    count: async () => 1,
    evaluate: async () => undefined,
    first: () => locator as unknown as Locator,
    getAttribute: async (name: string) => (name === 'data-tileflow-theme' ? 'light' : 'idle'),
    screenshot: async () => Buffer.from(pngHeader(64, 64)),
    waitFor: async () => undefined,
  };
  const page = {
    goto: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return {status: () => 200, url: () => pageUrl} as Response;
    },
    locator: () => locator as unknown as Locator,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return page;
    },
    route: async () => undefined,
    screenshot: async () => Buffer.from(pngHeader(320, 240)),
    setDefaultTimeout: () => undefined,
    url: () => pageUrl,
  } as unknown as Page;
  const context = {
    close: async () => undefined,
    newPage: async () => page,
  } as unknown as BrowserContext;
  return {
    browser: {newContext: async () => context} as unknown as Browser,
    handlers,
    locator,
  };
}
