import {createRequire} from 'node:module';
import type {Browser, BrowserContext} from 'playwright';
import type {MapLibreStyle, NormalizedTileflowCaptureScene} from '@tileflow/core';
import {
  assertValidTileflowStyle,
  type TileflowBuildAsset,
  TileflowStyleValidationError,
} from '@tileflow/dev';
import {
  TileflowCaptureError,
  type TileflowCapturePhase,
  type TileflowCaptureResourceDiagnostic,
  type TileflowCaptureResourceKind,
} from './errors';

export const tileflowSyntheticAssetOrigin = 'https://tileflow.local.invalid';

export type StandaloneTileflowCaptureInput = {
  assets: TileflowBuildAsset[];
  browser: Browser;
  scene: NormalizedTileflowCaptureScene;
  signal?: AbortSignal;
  style: MapLibreStyle;
  timeoutMs?: number;
};

export type StandaloneTileflowCaptureOutput = {
  height: number;
  networkDependent: boolean;
  png: Uint8Array;
  warnings: string[];
  width: number;
};

const require = createRequire(import.meta.url);
const maplibreJsPath = require.resolve('maplibre-gl/dist/maplibre-gl.js');
const maplibreCssPath = require.resolve('maplibre-gl/dist/maplibre-gl.css');

type PagePhaseResult = {status: 'ok'} | {reason: 'error' | 'timeout'; status: 'failed'};

export async function captureStandaloneTileflowScene(
  input: StandaloneTileflowCaptureInput,
): Promise<StandaloneTileflowCaptureOutput> {
  if (input.scene.target.kind !== 'map') {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_REQUIRED',
      'Application scenes require an explicit loopback application origin.',
    );
  }

  try {
    assertValidTileflowStyle(input.style, input.scene.map);
  } catch (error) {
    if (error instanceof TileflowStyleValidationError) {
      throw new TileflowCaptureError('STYLE_INVALID', error.message, {
        cause: error,
        details: {
          diagnostics: error.issues,
          phase: 'style-validation',
        },
      });
    }
    throw error;
  }

  const timeoutMs = input.timeoutMs ?? 30_000;
  let termination: 'aborted' | 'timeout' | undefined;
  let context: BrowserContext | undefined;
  let phase: TileflowCapturePhase = 'browser-start';
  let timeout: NodeJS.Timeout | undefined;
  const onAbort = () => {
    termination = 'aborted';
    void context?.close().catch(() => undefined);
  };

  if (input.signal?.aborted) {
    throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
  }

  try {
    context = await input.browser.newContext({
      acceptDownloads: false,
      colorScheme: 'light',
      deviceScaleFactor: input.scene.viewport.dpr,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: 'en-US',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      timezoneId: 'UTC',
      viewport: {
        height: input.scene.viewport.height,
        width: input.scene.viewport.width,
      },
    });
    input.signal?.addEventListener('abort', onAbort, {once: true});
    if (input.signal?.aborted) {
      onAbort();
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
    }
    timeout = setTimeout(() => {
      termination = 'timeout';
      void context?.close().catch(() => undefined);
    }, timeoutMs);
    timeout.unref?.();

    const assets = new Map(input.assets.map((asset) => [asset.fileName, asset]));
    const remoteOrigins = new Set<string>();
    let syntheticAssetFailure: string | undefined;
    const resourceFailures: TileflowCaptureResourceDiagnostic[] = [];
    let pageFailed = false;
    const recordResourceFailure = (url: string, status?: number) => {
      const diagnostic = classifyResource(url, status);
      if (!diagnostic || resourceFailures.length >= 16) return;
      const key = JSON.stringify(diagnostic);
      if (!resourceFailures.some((item) => JSON.stringify(item) === key)) {
        resourceFailures.push(diagnostic);
      }
    };

    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.origin === tileflowSyntheticAssetOrigin) {
        const fileName = decodeURIComponent(url.pathname.slice(1));
        const asset = url.search === '' ? assets.get(fileName) : undefined;

        if (!asset) {
          syntheticAssetFailure = fileName || 'unknown';
          await route.abort('blockedbyclient');
          return;
        }

        await route.fulfill({
          body: typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source),
          contentType: asset.contentType,
          status: 200,
        });
        return;
      }

      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (!isLoopbackUrl(url)) remoteOrigins.add(url.origin);
        await route.continue();
        return;
      }

      pageFailed = true;
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, async (socket) => {
      pageFailed = true;
      await socket.close({code: 1008, reason: 'WebSockets are disabled during capture'});
    });

    const page = await context.newPage();
    page.on('dialog', (dialog) => void dialog.dismiss());
    page.on('popup', (popup) => void popup.close());
    page.on('pageerror', () => {
      pageFailed = true;
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        recordResourceFailure(response.url(), response.status());
      }
    });
    page.on('requestfailed', (request) => recordResourceFailure(request.url()));
    page.setDefaultTimeout(timeoutMs);

    await page.setContent(renderHtml(input.scene.viewport), {waitUntil: 'domcontentloaded'});
    await page.addStyleTag({path: maplibreCssPath});
    await page.addScriptTag({path: maplibreJsPath});
    await page.addScriptTag({content: renderMapInPageScript});

    phase = 'map-load';
    const loadResult = await page.evaluate(
      (renderInput) => {
        const renderWindow = window as typeof window & {
          __tileflowCaptureLoad: (value: typeof renderInput) => Promise<PagePhaseResult>;
        };
        return renderWindow.__tileflowCaptureLoad(renderInput);
      },
      {
        mapEventTimeoutMs: Math.max(1, timeoutMs - 1_000),
        style: input.style,
      },
    );
    assertPhaseSucceeded(loadResult, phase, syntheticAssetFailure, resourceFailures, pageFailed);

    phase = 'map-idle';
    const idleResult = await page.evaluate(
      (renderInput) => {
        const renderWindow = window as typeof window & {
          __tileflowCaptureIdle: (value: typeof renderInput) => Promise<PagePhaseResult>;
        };
        return renderWindow.__tileflowCaptureIdle(renderInput);
      },
      {
        camera: input.scene.camera,
        mapEventTimeoutMs: Math.max(1, timeoutMs - 1_000),
      },
    );
    assertPhaseSucceeded(idleResult, phase, syntheticAssetFailure, resourceFailures, pageFailed);

    phase = 'screenshot';
    let png: Uint8Array;
    try {
      png = new Uint8Array(
        await page.locator('#map').screenshot({animations: 'disabled', type: 'png'}),
      );
    } catch (error) {
      throw new TileflowCaptureError(
        'SCREENSHOT_FAILED',
        'Tileflow could not produce the map PNG.',
        {
          cause: error,
          details: {phase},
        },
      );
    }
    assertPostScreenshotSucceeded(syntheticAssetFailure, resourceFailures, pageFailed);
    assertPngDimensions(
      png,
      input.scene.viewport.width * input.scene.viewport.dpr,
      input.scene.viewport.height * input.scene.viewport.dpr,
    );

    const warnings = [...remoteOrigins]
      .sort(compareCodeUnits)
      .map((origin) => `Capture requested remote resources from ${origin}.`);

    return {
      height: input.scene.viewport.height,
      networkDependent: remoteOrigins.size > 0,
      png,
      warnings,
      width: input.scene.viewport.width,
    };
  } catch (error) {
    if (termination === 'aborted') {
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.', {cause: error});
    }

    if (termination === 'timeout') {
      throw new TileflowCaptureError('CAPTURE_TIMEOUT', timeoutMessage(phase), {
        cause: error,
        details: {phase},
      });
    }

    if (error instanceof TileflowCaptureError) {
      throw error;
    }

    if (phase === 'browser-start') {
      throw new TileflowCaptureError(
        'BROWSER_START_FAILED',
        'Tileflow could not create an isolated capture page.',
        {cause: error, details: {phase}},
      );
    }
    if (phase === 'screenshot') {
      throw new TileflowCaptureError(
        'SCREENSHOT_FAILED',
        'Tileflow could not produce the map PNG.',
        {
          cause: error,
          details: {phase},
        },
      );
    }
    throw new TileflowCaptureError('MAP_LOAD_FAILED', mapFailureMessage(phase), {
      cause: error,
      details: {phase},
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    input.signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined);
  }
}

function assertPhaseSucceeded(
  result: PagePhaseResult,
  phase: 'map-load' | 'map-idle',
  syntheticAssetFailure: string | undefined,
  resourceFailures: TileflowCaptureResourceDiagnostic[],
  pageFailed: boolean,
): void {
  if (syntheticAssetFailure) {
    throw new TileflowCaptureError(
      'SYNTHETIC_ASSET_NOT_FOUND',
      `Compiled capture asset is unavailable: ${safeAssetName(syntheticAssetFailure)}`,
      {details: {phase: 'resource-load'}},
    );
  }

  if (resourceFailures.length > 0) throwResourceFailure(resourceFailures);
  if (result.status === 'failed' && result.reason === 'timeout') {
    throw new TileflowCaptureError('CAPTURE_TIMEOUT', timeoutMessage(phase), {
      details: {phase},
    });
  }
  if (result.status === 'failed' || pageFailed) {
    throw new TileflowCaptureError('MAP_LOAD_FAILED', mapFailureMessage(phase), {
      details: {phase},
    });
  }
}

function assertPostScreenshotSucceeded(
  syntheticAssetFailure: string | undefined,
  resourceFailures: TileflowCaptureResourceDiagnostic[],
  pageFailed: boolean,
): void {
  if (syntheticAssetFailure) {
    throw new TileflowCaptureError(
      'SYNTHETIC_ASSET_NOT_FOUND',
      `Compiled capture asset is unavailable: ${safeAssetName(syntheticAssetFailure)}`,
      {details: {phase: 'resource-load'}},
    );
  }
  if (resourceFailures.length > 0) throwResourceFailure(resourceFailures);
  if (pageFailed) {
    throw new TileflowCaptureError(
      'SCREENSHOT_FAILED',
      'The capture page failed while producing the map PNG.',
      {details: {phase: 'screenshot'}},
    );
  }
}

function throwResourceFailure(resources: TileflowCaptureResourceDiagnostic[]): never {
  const first = [...resources].sort(compareResources)[0]!;
  const label = resourceLabel(first.kind);
  const status = first.status === undefined ? 'failed' : `returned HTTP ${first.status}`;
  throw new TileflowCaptureError(
    'RESOURCE_FAILED',
    `${label} resource ${status} from ${first.origin}.`,
    {
      details: {
        phase: 'resource-load',
        resources,
      },
    },
  );
}

function classifyResource(
  value: string,
  status?: number,
): TileflowCaptureResourceDiagnostic | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const path = url.pathname.toLowerCase();
  let kind: TileflowCaptureResourceKind = 'other-http';
  let context: string | undefined;

  if (/(?:^|\/)(?:fonts?|glyphs?)(?:\/|$)/.test(path)) {
    kind = 'glyph';
    context = fontStackContext(url.pathname);
  } else if (/sprite(?:@2x)?\.json$/.test(path)) {
    kind = 'sprite-json';
  } else if (/sprite(?:@2x)?\.(?:png|webp)$/.test(path)) {
    kind = 'sprite-image';
  } else if (/(?:tiles|tilejson)\.json$/.test(path) || path.includes('/tilejson/')) {
    kind = 'tilejson';
  } else if (/\.pbf$/.test(path) || /\/tiles?\/\d+\/\d+\/\d+/.test(path)) {
    kind = 'vector-tile';
  }

  return {
    ...(context ? {context} : {}),
    kind,
    origin: url.origin,
    ...(status === undefined ? {} : {status}),
  };
}

function fontStackContext(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean);
  const index = segments.findIndex((segment) => /^(?:fonts?|glyphs?)$/i.test(segment));
  if (index < 0 || !segments[index + 1]) return undefined;
  try {
    const stack = decodeURIComponent(segments[index + 1]!)
      .replace(/[^A-Za-z0-9 _.,:@+-]/g, '')
      .trim()
      .slice(0, 96);
    return stack ? `fontStack: ${stack}` : undefined;
  } catch {
    return undefined;
  }
}

function compareResources(
  left: TileflowCaptureResourceDiagnostic,
  right: TileflowCaptureResourceDiagnostic,
): number {
  const leftKey = `${left.kind}\u0000${left.origin}\u0000${left.status ?? ''}\u0000${left.context ?? ''}`;
  const rightKey = `${right.kind}\u0000${right.origin}\u0000${right.status ?? ''}\u0000${right.context ?? ''}`;
  return compareCodeUnits(leftKey, rightKey);
}

function resourceLabel(kind: TileflowCaptureResourceKind): string {
  return {
    glyph: 'Glyph',
    'other-http': 'HTTP',
    'sprite-image': 'Sprite image',
    'sprite-json': 'Sprite JSON',
    tilejson: 'TileJSON',
    'vector-tile': 'Vector tile',
  }[kind];
}

function timeoutMessage(phase: TileflowCapturePhase): string {
  if (phase === 'map-load') return 'MapLibre did not finish loading before the capture timeout.';
  if (phase === 'map-idle') return 'MapLibre did not become idle before the capture timeout.';
  if (phase === 'screenshot') return 'PNG production exceeded the capture timeout.';
  return 'Tileflow capture exceeded its timeout while creating the browser page.';
}

function mapFailureMessage(phase: 'map-load' | 'map-idle'): string {
  return phase === 'map-load'
    ? 'MapLibre failed while loading the compiled style.'
    : 'MapLibre failed while waiting for the committed camera to become idle.';
}

function safeAssetName(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 200) || 'unknown';
}

function isLoopbackUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function readPngDimensions(png: Uint8Array): {height: number; width: number} {
  if (
    png.byteLength < 24 ||
    png[0] !== 137 ||
    png[1] !== 80 ||
    png[2] !== 78 ||
    png[3] !== 71 ||
    png[4] !== 13 ||
    png[5] !== 10 ||
    png[6] !== 26 ||
    png[7] !== 10
  ) {
    throw new TileflowCaptureError('INVALID_PNG', 'Capture output is not a valid PNG image.');
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {width: view.getUint32(16), height: view.getUint32(20)};
}

function assertPngDimensions(png: Uint8Array, width: number, height: number): void {
  let actual: {height: number; width: number};
  try {
    actual = readPngDimensions(png);
  } catch (error) {
    throw new TileflowCaptureError('INVALID_PNG', 'Capture output is not a valid PNG image.', {
      cause: error,
      details: {phase: 'screenshot'},
    });
  }

  if (actual.width !== width || actual.height !== height) {
    throw new TileflowCaptureError(
      'INVALID_PNG',
      `Capture PNG dimensions are ${actual.width}x${actual.height}; expected ${width}x${height}.`,
      {details: {phase: 'screenshot'}},
    );
  }
}

function renderHtml(viewport: {height: number; width: number}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #map {
        width: ${viewport.width}px;
        height: ${viewport.height}px;
        margin: 0;
        overflow: hidden;
      }
      body { background: transparent; }
    </style>
  </head>
  <body><div id="map"></div></body>
</html>`;
}

const renderMapInPageScript = String.raw`
window.__tileflowCaptureLoad = async function(input) {
  try {
    const map = new window.maplibregl.Map({
      attributionControl: false,
      container: "map",
      fadeDuration: 0,
      interactive: false,
      style: input.style
    });
    window.__tileflowMap = map;
    return await waitForMapEvent(map, "load", input.mapEventTimeoutMs);
  } catch {
    return {status: "failed", reason: "error"};
  }
};

window.__tileflowCaptureIdle = async function(input) {
  const map = window.__tileflowMap;
  if (!map) return {status: "failed", reason: "error"};

  try {
    applyCamera(map, input.camera);
    const result = await waitForMapEvent(map, "idle", input.mapEventTimeoutMs);
    if (result.status === "failed") return result;
    await nextFrame();
    await nextFrame();
    return {status: "ok"};
  } catch {
    return {status: "failed", reason: "error"};
  }
};

function applyCamera(mapInstance, camera) {
  if (camera.type === "bounds") {
    mapInstance.fitBounds(
      [
        [camera.bounds[0], camera.bounds[1]],
        [camera.bounds[2], camera.bounds[3]]
      ],
      {
        bearing: camera.bearing,
        duration: 0,
        padding: camera.padding,
        pitch: camera.pitch
      }
    );
    return;
  }

  mapInstance.jumpTo({
    bearing: camera.bearing,
    center: camera.center,
    pitch: camera.pitch,
    zoom: camera.zoom
  });
}

function waitForMapEvent(mapInstance, event, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({status: "failed", reason: "timeout"});
    }, timeoutMs);
    const onSuccess = () => {
      cleanup();
      resolve({status: "ok"});
    };
    const onError = () => {
      cleanup();
      resolve({status: "failed", reason: "error"});
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      mapInstance.off(event, onSuccess);
      mapInstance.off("error", onError);
    };

    mapInstance.once(event, onSuccess);
    mapInstance.once("error", onError);
  });
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
`;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
