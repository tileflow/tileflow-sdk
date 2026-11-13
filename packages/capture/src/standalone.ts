import {readFileSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import type {Browser, BrowserContext, Page} from 'playwright';
import {
  type MapLibreStyle,
  type NormalizedTileflowCaptureScene,
  tileflowBuildingsMetadataKey,
  tileflowStreetLightsMetadataKey,
  tileflowVegetationDisplayMetadataKey,
  tileflowVegetationMetadataKey,
} from '@tileflow/core';
import {getTileflowStyleFontFaces, type TileflowStyleFontFace} from '@tileflow/core/runtime';
import {
  createTileflowLineBackgroundGlyphResponder,
  parseTileflowLineBackgroundGlyphPath,
  type TileflowLineBackgroundGlyphProviders,
  type TileflowLineBackgroundGlyphResponder,
  tileflowLineBackgroundGlyphRoute,
  type TileflowLocalTilesetFile,
} from '@tileflow/dev/artifacts';
import {assertValidTileflowStyle, TileflowStyleValidationError} from '@tileflow/dev/validation';
import {type TileflowCaptureAsset, tileflowSyntheticAssetOrigin} from './assets';
import type {TileflowCaptureGraphics} from './browser';
import {
  TileflowCaptureError,
  type TileflowCapturePhase,
  type TileflowCaptureResourceDiagnostic,
  type TileflowCaptureResourceKind,
} from './errors';

export {tileflowSyntheticAssetOrigin} from './assets';

export type StandaloneTileflowCaptureInput = {
  assets: TileflowCaptureAsset[];
  browser: Browser;
  /** Project root whose `.tileflow/cache` stores upstream glyph ranges. */
  glyphCacheDirectory?: string;
  /** The browser's WebGL rendering, reported in warnings when GPU capture fell back to software. */
  graphics?: TileflowCaptureGraphics;
  /** Upstream glyph templates for maps whose text uses line-fitted backgrounds. */
  lineBackgroundGlyphs?: TileflowLineBackgroundGlyphProviders;
  localTilesets?: readonly TileflowLocalTilesetFile[];
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

/** Everything one isolated standalone page needs: compiled assets, its style, and viewport. */
export type StandaloneTileflowPageInput = Omit<StandaloneTileflowCaptureInput, 'scene'> & {
  viewport: {height: number; width: number; dpr: 1 | 2};
};

/** One loaded standalone page, valid only inside `withStandaloneTileflowPage`. */
export type StandaloneTileflowPage = {
  readonly page: Page;
  readonly mapEventTimeoutMs: number;
  /** Runs the page's map loader for the style the page was opened with. */
  load(fontFaces: readonly TileflowStyleFontFace[]): Promise<void>;
  /** Runs one in-page step that resolves to a phase result, and fails with that phase. */
  step(phase: StandaloneTileflowPagePhase, name: string, input: unknown): Promise<void>;
  /** Captures the map element as PNG bytes of the viewport's physical size. */
  screenshot(): Promise<Uint8Array>;
  /** Restarts the timeout, so every frame of a shot receives the whole budget. */
  restartTimeout(): void;
  /** Runs caller work with the timeout paused; its errors pass through unchanged. */
  outside<T>(work: () => Promise<T>): Promise<T>;
  result(): {networkDependent: boolean; warnings: string[]};
};

type StandaloneTileflowPagePhase = 'map-load' | 'theme-blend' | 'map-idle';

const require = createRequire(import.meta.url);
const mapLibreRuntimePaths = Object.freeze({
  css: require.resolve('maplibre-gl/dist/maplibre-gl.css'),
  main: require.resolve('maplibre-gl/dist/maplibre-gl.mjs'),
  worker: require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'),
});
const tileflowCorePackagePath = require.resolve('@tileflow/core/package.json');
const tileflowBrowserModule = `${readFileSync(
  join(dirname(tileflowCorePackagePath), 'dist', 'browser.js'),
  'utf8',
)}\nglobalThis.__tileflowRegisterContourProtocol = registerTileflowContourProtocol;
globalThis.__tileflowRegisterPathGroundProtocol = registerTileflowPathGroundProtocol;
globalThis.__tileflowRegisterPmtilesProtocol = registerTileflowPmtilesProtocol;
globalThis.__tileflowAttachAtmosphere = attachTileflowAtmosphere;
globalThis.__tileflowAttachBranding = attachTileflowBranding;
globalThis.__tileflowAttachNotices = attachTileflowNotices;
globalThis.__tileflowAttachNauticalLights = attachTileflowNauticalLights;
globalThis.__tileflowMaxPitch = tileflowMaxPitch;
globalThis.__tileflowAttachLabelPlacement = attachTileflowLabelPlacement;
globalThis.__tileflowCreateMap3D = createTileflowMap3D;
globalThis.__tileflowCreateThemeController = createTileflowThemeController;`;

type PagePhaseResult =
  | {status: 'ok'; warnings?: string[]}
  | {message?: string; reason: 'error' | 'timeout'; status: 'failed'};

export async function captureStandaloneTileflowScene(
  input: StandaloneTileflowCaptureInput,
): Promise<StandaloneTileflowCaptureOutput> {
  if (input.scene.target.kind !== 'map') {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_REQUIRED',
      'Application scenes require an explicit loopback application origin.',
    );
  }

  assertValidCaptureStyle(input.style, input.scene.map);
  const {scene, ...pageInput} = input;
  return withStandaloneTileflowPage({...pageInput, viewport: scene.viewport}, async (page) => {
    await page.load(getTileflowStyleFontFaces(input.style));
    await page.step('map-idle', '__tileflowCaptureIdle', {
      camera: scene.camera,
      mapEventTimeoutMs: page.mapEventTimeoutMs,
    });
    const png = await page.screenshot();
    return {
      height: scene.viewport.height,
      png,
      width: scene.viewport.width,
      ...page.result(),
    };
  });
}

/** Rejects a compiled style before any browser work, with the capture error contract. */
export function assertValidCaptureStyle(style: MapLibreStyle, label: string): void {
  try {
    assertValidTileflowStyle(style, label);
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
}

/**
 * Opens one fresh browser context and page for a standalone style, routes the MapLibre runtime and
 * compiled assets into it, and closes it after `run`. Failures map to capture error codes by phase.
 */
export async function withStandaloneTileflowPage<T>(
  input: StandaloneTileflowPageInput,
  run: (page: StandaloneTileflowPage) => Promise<T>,
): Promise<T> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const mapEventTimeoutMs = Math.max(1, timeoutMs - 1_000);
  const mapLibreRuntimeUrls = createMapLibreRuntimeUrls(
    resolveMapLibreRuntimeDocumentOrigin(input.style),
  );
  let termination: 'aborted' | 'timeout' | undefined;
  let context: BrowserContext | undefined;
  let phase: TileflowCapturePhase = 'browser-start';
  let timeout: NodeJS.Timeout | undefined;
  let budgetStartedAt = Date.now();
  const pageWarnings = new Set<string>();
  const onAbort = () => {
    termination = 'aborted';
    void context?.close().catch(() => undefined);
  };
  const stopTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  };
  const restartTimeout = () => {
    stopTimeout();
    budgetStartedAt = Date.now();
    timeout = setTimeout(() => {
      termination = 'timeout';
      void context?.close().catch(() => undefined);
    }, timeoutMs);
    timeout.unref?.();
  };

  if (input.signal?.aborted) {
    throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
  }

  try {
    context = await input.browser.newContext({
      acceptDownloads: false,
      colorScheme: 'light',
      deviceScaleFactor: input.viewport.dpr,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: 'en-US',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      timezoneId: 'UTC',
      viewport: {
        height: input.viewport.height,
        width: input.viewport.width,
      },
    });
    input.signal?.addEventListener('abort', onAbort, {once: true});
    if (input.signal?.aborted) {
      onAbort();
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
    }
    restartTimeout();

    const assets = new Map(input.assets.map((asset) => [asset.fileName, asset]));
    const frozenResources = new Map(
      input.assets.filter((asset) => asset.url !== undefined).map((asset) => [asset.url!, asset]),
    );
    const localTilesets = new Map(
      (input.localTilesets ?? []).map((tileset) => [tileset.fileName, tileset]),
    );
    const remoteOrigins = new Set<string>();
    let lineBackgroundGlyphs: TileflowLineBackgroundGlyphResponder | undefined;
    let syntheticAssetFailure: string | undefined;
    const resourceFailures: TileflowCaptureResourceDiagnostic[] = [];
    let pageFailed = false;
    const recordResourceFailure = (url: string, status?: number) => {
      // Data the account may not read, and 3D models that are missing, leave a map that still
      // draws: they become loud warnings naming what is missing rather than failing the capture.
      const degraded = describeDegradedResource(url, status);
      if (degraded) {
        if (pageWarnings.size < 32) pageWarnings.add(degraded);
        return;
      }
      const diagnostic = classifyResource(url, status);
      if (!diagnostic || resourceFailures.length >= 16) return;
      const key = JSON.stringify(diagnostic);
      if (!resourceFailures.some((item) => JSON.stringify(item) === key)) {
        resourceFailures.push(diagnostic);
      }
    };

    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const frozenResource = frozenResources.get(url.toString());

      if (frozenResource) {
        await route.fulfill({
          body:
            typeof frozenResource.source === 'string'
              ? frozenResource.source
              : Buffer.from(frozenResource.source),
          contentType: frozenResource.contentType,
          headers: {'Access-Control-Allow-Origin': '*'},
          status: 200,
        });
        return;
      }

      if (url.origin === mapLibreRuntimeUrls.origin) {
        const runtime = getMapLibreRuntimeResponse(url.pathname, input.viewport);
        if (runtime) {
          await route.fulfill(runtime);
          return;
        }
      }

      if (
        url.origin === tileflowSyntheticAssetOrigin &&
        url.pathname.startsWith(`/${tileflowLineBackgroundGlyphRoute}/`)
      ) {
        const glyphRequest = parseTileflowLineBackgroundGlyphPath(url.pathname);
        const upstream = glyphRequest
          ? input.lineBackgroundGlyphs?.[glyphRequest.mapName]
          : undefined;
        if (!glyphRequest || !upstream || url.search !== '') {
          syntheticAssetFailure = url.pathname.slice(1) || 'unknown';
          await route.abort('blockedbyclient');
          return;
        }
        // Upstream ranges come from the declared provider, so the capture depends on it.
        const provider = new URL(
          upstream.replace('{fontstack}', 'stack').replace('{range}', '0-255'),
        );
        if (!isLoopbackUrl(provider)) remoteOrigins.add(provider.origin);
        lineBackgroundGlyphs ??= createTileflowLineBackgroundGlyphResponder({
          cwd: input.glyphCacheDirectory ?? process.cwd(),
        });
        const response = await lineBackgroundGlyphs(
          upstream,
          glyphRequest.fontStack,
          glyphRequest.range,
        );
        if (response.status !== 200) recordResourceFailure(url.toString(), response.status);
        await route.fulfill({
          body: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') ?? 'application/x-protobuf',
          headers: {'Access-Control-Allow-Origin': '*'},
          status: response.status,
        });
        return;
      }

      if (url.origin === tileflowSyntheticAssetOrigin) {
        const fileName = decodeURIComponent(url.pathname.slice(1));
        const localTileset = url.search === '' ? localTilesets.get(fileName) : undefined;
        if (localTileset) {
          const response = await localTilesetCaptureResponse(
            route.request().headers()['range'],
            localTileset,
          );
          await route.fulfill({
            ...response,
            headers: {'Access-Control-Allow-Origin': '*', ...response.headers},
          });
          return;
        }
        const asset = url.search === '' ? assets.get(fileName) : undefined;

        if (!asset) {
          syntheticAssetFailure = fileName || 'unknown';
          await route.abort('blockedbyclient');
          return;
        }

        const source = asset.source;
        await route.fulfill({
          body: typeof source === 'string' ? source : Buffer.from(source),
          contentType: asset.contentType,
          headers: {'Access-Control-Allow-Origin': '*'},
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
    page.on('requestfailed', (request) => {
      // A request the page cancelled, such as a tile that left the view, did not fail.
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      recordResourceFailure(request.url());
    });
    page.setDefaultTimeout(timeoutMs);

    await page.goto(mapLibreRuntimeUrls.document, {waitUntil: 'domcontentloaded'});
    await page.addStyleTag({url: mapLibreRuntimeUrls.css});
    await page.addScriptTag({
      content: `import * as maplibregl from ${JSON.stringify(mapLibreRuntimeUrls.main)};
maplibregl.setWorkerUrl(${JSON.stringify(mapLibreRuntimeUrls.worker)});
globalThis.maplibregl = maplibregl;`,
      type: 'module',
    });
    await page.waitForFunction(() =>
      Boolean((globalThis as typeof globalThis & {maplibregl?: unknown}).maplibregl),
    );
    await page.addScriptTag({content: tileflowBrowserModule, type: 'module'});
    await page.addScriptTag({content: renderMapInPageScript});
    if (input.graphics === 'gpu') {
      const renderer = await page.evaluate(() => {
        const context = document.createElement('canvas').getContext('webgl2');
        const info = context?.getExtension('WEBGL_debug_renderer_info');
        return info ? String(context!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      });
      pageWarnings.add(
        /swiftshader|llvmpipe|software/iu.test(renderer) || renderer === ''
          ? 'GPU rendering is unavailable on this machine; the capture used software rendering.'
          : "Rendered with this machine's GPU: pixels depend on its hardware and driver, so compare it only with other GPU captures from the same machine.",
      );
    }

    const step = async (stepPhase: StandaloneTileflowPagePhase, name: string, value: unknown) => {
      phase = stepPhase;
      // The 3D scene settles within what is left of the budget, keeping time for the last frames
      // and the PNG: a software-rendered frame of a dense 3D scene can take seconds.
      const reserveMs = Math.max(10_000, Math.round(timeoutMs * 0.35));
      const sceneBudgetMs = Math.max(0, timeoutMs - (Date.now() - budgetStartedAt) - reserveMs);
      const result = await page.evaluate(
        ({name: functionName, value: stepInput}) => {
          const renderWindow = window as unknown as Record<
            string,
            (value: unknown) => Promise<PagePhaseResult>
          >;
          return renderWindow[functionName]!(stepInput);
        },
        {name, value: {...(value as object), sceneBudgetMs}},
      );
      assertPhaseSucceeded(result, stepPhase, syntheticAssetFailure, resourceFailures, pageFailed);
      if (result.status === 'ok') {
        for (const warning of result.warnings ?? []) pageWarnings.add(safeSceneWarning(warning));
      }
    };

    return await run({
      page,
      mapEventTimeoutMs,
      load: (fontFaces) =>
        step('map-load', '__tileflowCaptureLoad', {
          fontFaces,
          mapEventTimeoutMs,
          style: input.style,
        }),
      step,
      async screenshot() {
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
          input.viewport.width * input.viewport.dpr,
          input.viewport.height * input.viewport.dpr,
        );
        return png;
      },
      restartTimeout,
      async outside(work) {
        stopTimeout();
        try {
          return await work();
        } catch (error) {
          throw new CallerFailure(error);
        }
      },
      result() {
        return {
          networkDependent: remoteOrigins.size > 0,
          warnings: [
            ...[...remoteOrigins]
              .sort(compareCodeUnits)
              .map((origin) => `Capture requested remote resources from ${origin}.`),
            ...[...pageWarnings].sort(compareCodeUnits),
          ],
        };
      },
    });
  } catch (error) {
    if (termination === 'aborted') {
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.', {cause: error});
    }

    if (termination === 'timeout') {
      throw new TileflowCaptureError(
        'CAPTURE_TIMEOUT',
        `${timeoutMessage(phase)}${slowSceneHint(input.style, input.graphics, phase)}`,
        {cause: error, details: {phase}},
      );
    }

    if (error instanceof CallerFailure) {
      throw error.error;
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
    throw new TileflowCaptureError(
      'MAP_LOAD_FAILED',
      mapFailureMessage(phase === 'theme-blend' || phase === 'map-load' ? phase : 'map-idle'),
      {
        cause: error,
        details: {phase},
      },
    );
  } finally {
    stopTimeout();
    input.signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined);
  }
}

/** Carries an error thrown by caller work inside a page session past its phase mapping. */
class CallerFailure {
  constructor(readonly error: unknown) {}
}

function createMapLibreRuntimeUrls(origin: string) {
  return Object.freeze({
    css: `${origin}/__runtime/maplibre-gl.css`,
    document: `${origin}/__runtime/document.html`,
    main: `${origin}/__runtime/maplibre-gl.mjs`,
    origin,
    worker: `${origin}/__runtime/maplibre-gl-worker.mjs`,
  });
}

function resolveMapLibreRuntimeDocumentOrigin(style: MapLibreStyle): string {
  const origins = new Set<string>();
  const loopbackOrigins = new Set<string>();
  const addOrigin = (value: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const url = new URL(value);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === ''
      ) {
        origins.add(url.origin);
        if (isLoopbackUrl(url)) loopbackOrigins.add(url.origin);
      }
    } catch {
      // MapLibre validates style URLs independently. Only a safe origin can host this virtual page.
    }
  };

  addOrigin(style.glyphs);
  if (Array.isArray(style.sprite)) {
    for (const sprite of style.sprite) {
      if (sprite && typeof sprite === 'object') {
        addOrigin((sprite as {url?: unknown}).url);
      }
    }
  } else {
    addOrigin(style.sprite);
  }
  const fontFaces = style.metadata?.['tileflow:fontFaces'];
  if (Array.isArray(fontFaces)) {
    for (const fontFace of fontFaces) {
      if (fontFace && typeof fontFace === 'object') {
        addOrigin((fontFace as {source?: unknown}).source);
      }
    }
  }
  for (const source of Object.values(style.sources)) {
    const candidate = source as {data?: unknown; tiles?: unknown; url?: unknown; urls?: unknown};
    addOrigin(candidate.data);
    addOrigin(candidate.url);
    if (Array.isArray(candidate.tiles)) {
      for (const tile of candidate.tiles) addOrigin(tile);
    }
    if (Array.isArray(candidate.urls)) {
      for (const url of candidate.urls) addOrigin(url);
    }
  }

  const preferredOrigins = loopbackOrigins.size > 0 ? loopbackOrigins : origins;
  return [...preferredOrigins].sort(compareCodeUnits)[0] ?? tileflowSyntheticAssetOrigin;
}

function getMapLibreRuntimeResponse(
  pathname: string,
  viewport: {height: number; width: number},
): {body: string; contentType: string; status: number} | undefined {
  if (pathname === '/__runtime/document.html') {
    return {
      body: renderHtml(viewport),
      contentType: 'text/html; charset=utf-8',
      status: 200,
    };
  }

  const asset =
    pathname === '/__runtime/maplibre-gl.mjs'
      ? mapLibreRuntimePaths.main
      : pathname === '/__runtime/maplibre-gl-worker.mjs'
        ? mapLibreRuntimePaths.worker
        : pathname === '/__runtime/maplibre-gl.css'
          ? mapLibreRuntimePaths.css
          : undefined;
  if (!asset) return undefined;

  return {
    body: readFileSync(asset, 'utf8'),
    contentType:
      pathname === '/__runtime/maplibre-gl.css'
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8',
    status: 200,
  };
}

async function localTilesetCaptureResponse(
  rangeHeader: string | undefined,
  file: TileflowLocalTilesetFile,
): Promise<{
  body: Buffer;
  contentType?: string;
  headers: Record<string, string>;
  status: number;
}> {
  const match = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/u);
  if (!match) {
    return {
      body: Buffer.alloc(0),
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${file.byteLength}`,
        ETag: file.etag,
      },
      status: 416,
    };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : file.byteLength - 1;
  const end = Math.min(requestedEnd, file.byteLength - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= file.byteLength ||
    requestedEnd < start ||
    end - start + 1 > 16 * 1024 * 1024
  ) {
    return {
      body: Buffer.alloc(0),
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${file.byteLength}`,
        ETag: file.etag,
      },
      status: 416,
    };
  }
  const length = end - start + 1;
  const handle = await open(file.sourcePath, 'r');
  try {
    const body = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(body, read, length - read, start + read);
      if (result.bytesRead === 0) throw new Error('Local PMTiles snapshot ended during capture.');
      read += result.bytesRead;
    }
    return {
      body,
      contentType: 'application/vnd.pmtiles',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${file.byteLength}`,
        ETag: file.etag,
      },
      status: 206,
    };
  } finally {
    await handle.close();
  }
}

function assertPhaseSucceeded(
  result: PagePhaseResult,
  phase: StandaloneTileflowPagePhase,
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
    const message =
      result.status === 'failed' && result.message
        ? `${mapFailureMessage(phase)} ${safeMapError(result.message)}`
        : mapFailureMessage(phase);
    throw new TileflowCaptureError('MAP_LOAD_FAILED', message, {
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

/**
 * The warning for a resource whose failure leaves a drawable but incomplete map: a Tileflow dataset
 * or another data resource refused with HTTP 401 or 403, or a 3D model file that is missing.
 * Glyphs and sprites stay failures, since without them no label or icon draws.
 */
export function describeDegradedResource(value: string, status?: number): string | undefined {
  if (status === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const kind = classifyResource(value, status)?.kind;
  if (kind === 'glyph' || kind === 'sprite-json' || kind === 'sprite-image') return undefined;
  const dataset = tileflowDatasetOf(url);
  if (status === 401 || status === 403) {
    const subject = dataset ? `Tileflow dataset "${dataset}"` : `Data from ${url.origin}`;
    return `${subject} returned HTTP ${status}: this capture is not entitled to read it, so its layers are missing from the image.`;
  }
  if (status === 404 && isModelResource(url)) {
    return `A 3D model from ${dataset ? `Tileflow dataset "${dataset}"` : url.origin} returned HTTP 404; the buildings under it were captured instead.`;
  }
  return undefined;
}

/** The hosted dataset a Tileflow tile URL reads: `/tiles/<dataset>/…` or `/v1/tiles/<dataset>/…`. */
export function tileflowDatasetOf(url: URL): string | undefined {
  const match = /^\/(?:v1\/)?tiles\/([^/]+)\//u.exec(url.pathname);
  if (!match) return undefined;
  try {
    const name = decodeURIComponent(match[1]!);
    return /^[a-z0-9][a-z0-9,_-]{0,63}$/u.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

function isModelResource(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return path.endsWith('.glb') || /\/(?:landmarks|models)(?:\/|$)/u.test(path);
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

/** The scene metadata through which a compiled style declares 3D buildings, trees or lights. */
const sceneMetadataKeys = [
  tileflowBuildingsMetadataKey,
  tileflowVegetationMetadataKey,
  tileflowVegetationDisplayMetadataKey,
  tileflowStreetLightsMetadataKey,
];

function slowSceneHint(
  style: MapLibreStyle,
  graphics: TileflowCaptureGraphics | undefined,
  phase: TileflowCapturePhase,
): string {
  if (graphics === 'gpu' || (phase !== 'map-idle' && phase !== 'screenshot')) return '';
  const metadata = style.metadata as Record<string, unknown> | undefined;
  if (!sceneMetadataKeys.some((key) => metadata?.[key] !== undefined && metadata[key] !== null)) {
    return '';
  }
  return ' Software rendering draws a dense 3D scene slowly: raise --timeout, or pass --gpu for exploratory captures.';
}

function timeoutMessage(phase: TileflowCapturePhase): string {
  if (phase === 'map-load') return 'MapLibre did not finish loading before the capture timeout.';
  if (phase === 'theme-blend') return 'The theme blend was not ready before the capture timeout.';
  if (phase === 'map-idle') return 'MapLibre did not become idle before the capture timeout.';
  if (phase === 'screenshot') return 'PNG production exceeded the capture timeout.';
  return 'Tileflow capture exceeded its timeout while creating the browser page.';
}

function mapFailureMessage(phase: StandaloneTileflowPagePhase): string {
  if (phase === 'map-load') return 'MapLibre failed while loading the compiled style.';
  if (phase === 'theme-blend') return 'Tileflow could not prepare the theme blend.';
  return 'MapLibre failed while waiting for the committed camera to become idle.';
}

function safeMapError(value: string): string {
  return value
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, 'resource')
    .replace(/[^A-Za-z0-9 _.,:'"@+()[\]/=-]/g, '')
    .trim()
    .slice(0, 200);
}

function safeSceneWarning(value: string): string {
  return value
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, 'resource')
    .replace(/[^A-Za-z0-9 _.,:;'"@+()[\]/=-]/g, '')
    .trim()
    .slice(0, 300);
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
    await loadTileflowFontFaces(input.fontFaces || []);
    window.__tileflowRegisterContourProtocol?.({addProtocol: window.maplibregl.addProtocol});
    window.__tileflowRegisterPathGroundProtocol?.({addProtocol: window.maplibregl.addProtocol});
    window.__tileflowRegisterPmtilesProtocol?.({addProtocol: window.maplibregl.addProtocol});
    const data = input.style.metadata?.["tileflow:data"];
    const worldSourceId = data?.kind === "tileflow-world" ? data.sourceId : undefined;
    window.__tileflowCaptureLoopbackSourceIds = Object.entries(input.style.sources || {})
      .filter(([sourceId, source]) => sourceId !== worldSourceId && isLoopbackSourceUrl(source?.url))
      .map(([sourceId]) => sourceId);
    const map = new window.maplibregl.Map({
      ...(input.style.metadata?.["tileflow:fontFallback"] === 1 ? {localIdeographFontFamily: false} : {}),
      attributionControl: false,
      // Multisampled like the interactive map, so thin 3D model edges capture without stipple.
      canvasContextAttributes: {antialias: true},
      container: "map",
      fadeDuration: 0,
      interactive: false,
      maxPitch: window.__tileflowMaxPitch,
      style: input.style
    });
    window.__tileflowMap = map;
    window.__tileflowCaptureStyle = input.style;
    window.__tileflowAttachAtmosphere(map);
    // Notices such as "Not for navigation" are part of the map, so captured images keep them.
    window.__tileflowAttachBranding(map);
    window.__tileflowAttachNotices(map);
    // Capture prefers reduced motion, so Nautical lights stay steady and every image is stable.
    window.__tileflowAttachNauticalLights(map);
    window.__tileflowAttachLabelPlacement(map);
    // The 3D scene the style declares (buildings, landmarks and Team models, trees, street
    // lights), mounted as an application and the preview mount it, so captures show the same map.
    window.__tileflowSceneErrors = [];
    window.__tileflowScene = window.__tileflowCreateMap3D?.({
      map,
      onError: (error) => {
        if (window.__tileflowSceneErrors.length < 4) {
          window.__tileflowSceneErrors.push(String(error?.message || error || "unknown error"));
        }
      }
    });
    return await waitForMapEvent(map, "load", input.mapEventTimeoutMs);
  } catch (error) {
    return {status: "failed", reason: "error", message: String(error?.message || error || "")};
  }
};

async function loadTileflowFontFaces(definitions) {
  const maximumFontBytes = 1024 * 1024;
  await Promise.all(definitions.map(async (definition) => {
    const response = await fetch(definition.source, {
      cache: "force-cache",
      credentials: "same-origin",
      redirect: "error"
    });
    if (!response.ok) throw new Error("Tileflow font failed: " + response.status);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maximumFontBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Tileflow font exceeds the maximum response size.");
    }
    if (!response.body) throw new Error("Tileflow font response is empty.");
    const reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (!value) continue;
        byteLength += value.byteLength;
        if (byteLength > maximumFontBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Tileflow font exceeds the maximum response size.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const face = new FontFace(definition.family, bytes.buffer, {
      ...(definition.style ? {style: definition.style} : {}),
      ...(definition.weight ? {weight: definition.weight} : {})
    });
    await face.load();
    document.fonts.add(face);
  }));
}

window.__tileflowCaptureIdle = async function(input) {
  const map = window.__tileflowMap;
  if (!map) return {status: "failed", reason: "error"};
  releaseFrames(map);

  try {
    applyCamera(map, input.camera);
    return await settleMap(map, input);
  } catch {
    return {status: "failed", reason: "error"};
  }
};

// A shot prepares its theme blend once; each frame then only moves the blend position.
window.__tileflowCapturePrepareBlend = async function(input) {
  const map = window.__tileflowMap;
  if (!map) return {status: "failed", reason: "error"};
  releaseFrames(map);

  try {
    const controller = window.__tileflowCreateThemeController({
      initial: {style: window.__tileflowCaptureStyle, theme: input.theme},
      loadFonts: () => Promise.resolve(),
      map,
      timeoutMs: input.mapEventTimeoutMs
    });
    const themes = input.themes.map((theme) => ({style: theme.style, theme: theme.theme}));
    const result = await controller.setBlend({position: input.position, themes});
    if (result.status !== "applied") {
      controller.dispose();
      return {status: "failed", reason: "error", message: String(result.error?.message || "")};
    }
    window.__tileflowShotBlend = {controller, themes};
    return {status: "ok"};
  } catch (error) {
    return {status: "failed", reason: "error", message: String(error?.message || error || "")};
  }
};

window.__tileflowCaptureFrame = async function(input) {
  const map = window.__tileflowMap;
  if (!map) return {status: "failed", reason: "error"};
  releaseFrames(map);

  try {
    const blend = window.__tileflowShotBlend;
    if (blend && input.blendPosition !== undefined) {
      const result = await blend.controller.setBlend({
        position: input.blendPosition,
        themes: blend.themes
      });
      if (result.status !== "applied") {
        return {status: "failed", reason: "error", message: String(result.error?.message || "")};
      }
    }
    applyCamera(map, input.camera);
    map.triggerRepaint();
    return await settleMap(map, input);
  } catch {
    return {status: "failed", reason: "error"};
  }
};

// MapLibre's idle covers the style's own sources only, and a 3D scene still preparing keeps asking
// for frames, so on a slow renderer the map may not become idle. With a 3D scene the capture waits until
// the map's tiles have loaded and the scene has nothing pending, across a few consecutive checks.
async function settleMap(map, input) {
  const scene = window.__tileflowScene;
  if (!scene) {
    const result = await waitForMapEvent(map, "idle", input.mapEventTimeoutMs);
    if (result.status === "failed") return result;
    await nextFrame();
    await nextFrame();
    return {status: "ok", warnings: []};
  }
  const warnings = [];
  const budget = Math.max(0, Math.min(input.mapEventTimeoutMs, input.sceneBudgetMs ?? 0));
  const deadline = performance.now() + budget;
  const failure = watchMapErrors(map);
  let quiet = 0;
  let pending = scene.pending();
  try {
    // The scene asks for the frames it needs; forcing more would only slow a software renderer.
    while (quiet < 3 && performance.now() < deadline) {
      await delay(100);
      await nextFrame();
      if (failure.result) return failure.result;
      pending = scene.pending();
      const busy = pending.buildingTiles + pending.models + pending.treeTiles + pending.transitions;
      quiet = busy === 0 && map.loaded() ? quiet + 1 : 0;
    }
  } finally {
    failure.stop();
  }
  if (quiet < 3) {
    const parts = [];
    if (!map.loaded()) parts.push("map tiles");
    if (pending.buildingTiles) parts.push(pending.buildingTiles + " building tiles");
    if (pending.models) parts.push(pending.models + " models");
    if (pending.treeTiles) parts.push(pending.treeTiles + " tree tiles");
    if (pending.transitions) parts.push(pending.transitions + " transitions");
    // Map tiles still loading are a MapLibre failure to settle, as without a 3D scene.
    if (!map.loaded() && parts.length === 1) return {status: "failed", reason: "timeout"};
    warnings.push(
      "The 3D scene was still loading when the capture budget ran out (" +
        parts.join(", ") +
        " pending after " + Math.round(budget / 1000) + " s); the image may be incomplete. Raise --timeout, or pass --gpu for exploratory captures."
    );
  }
  for (const message of window.__tileflowSceneErrors || []) {
    warnings.push("The 3D scene failed to draw (" + message + "); the flat map was captured instead.");
  }
  if (quiet >= 3) {
    map.triggerRepaint();
    await nextFrame();
    await nextFrame();
  }
  holdFrames(map);
  return {status: "ok", warnings};
}

// Keeps the last frame on screen while the PNG is taken: on a software renderer a 3D scene that
// is still preparing would otherwise queue frames that take seconds each and stall the screenshot.
// The next frame step releases it.
function holdFrames(map) {
  if (map.__tileflowHeldRepaint) return;
  map.__tileflowHeldRepaint = map.triggerRepaint;
  map.triggerRepaint = () => map;
}

function releaseFrames(map) {
  if (!map.__tileflowHeldRepaint) return;
  map.triggerRepaint = map.__tileflowHeldRepaint;
  map.__tileflowHeldRepaint = undefined;
}

// Reports the first map error while the scene settles, with the idle wait's tolerance for source
// layers a TileJSON advertises but one tile lacks.
function watchMapErrors(map) {
  const state = {result: undefined, stop: () => undefined};
  const pending = waitForMapEvent(map, "tileflow:never", 2147483647);
  pending.then((result) => {
    if (result.status === "failed" && result.reason === "error") state.result = result;
  });
  state.stop = () => pending.cancel?.();
  return state;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// A map's pitch cap can depend on zoom (a 3D scene lowers it over the overview), so a camera
// that changes both is applied again once the new zoom has lifted the cap.
function applyCamera(mapInstance, camera) {
  moveCamera(mapInstance, camera);
  const pitch = camera.pitch ?? 0;
  if (Math.abs(mapInstance.getPitch() - pitch) > 1e-6) moveCamera(mapInstance, camera);
}

function moveCamera(mapInstance, camera) {
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
  let cancel;
  const promise = new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({status: "failed", reason: "timeout"});
    }, timeoutMs);
    const onSuccess = () => {
      cleanup();
      resolve({status: "ok"});
    };
    const onError = (errorEvent) => {
      // Data the key cannot read leaves the rest of the map drawable; the capture reports it as a
      // warning naming the dataset instead of failing.
      const status = errorEvent?.error?.status;
      if (status === 401 || status === 403) {
        // MapLibre never finishes loading a style whose source it could not read; the source and
        // its layers come off, so the rest of the map loads and draws.
        if (errorEvent?.sourceId) removeRefusedSource(mapInstance, errorEvent.sourceId);
        return;
      }
      const message = String(errorEvent?.error?.message || errorEvent?.message || "");
      const missingSourceLayer = message.match(
        /^Source layer "(.+)" does not exist on source "(.+)" as specified by style layer ".+"\.$/
      );
      if (missingSourceLayer) {
        const [, sourceLayer, sourceId] = missingSourceLayer;
        const liveSource = mapInstance.getSource(sourceId);
        const advertisedSourceLayers = liveSource?.vectorLayerIds;
        const loopbackSource = window.__tileflowCaptureLoopbackSourceIds?.includes(sourceId);
        // A layer advertised by TileJSON may legitimately be absent from one
        // MVT. Local PMTiles development archives may also carry stale TileJSON
        // metadata while their tile payload already contains the layer. Keep
        // remote contracts strict, but let local visual captures verify pixels.
        if (
          loopbackSource ||
          (Array.isArray(advertisedSourceLayers) && advertisedSourceLayers.includes(sourceLayer))
        ) {
          return;
        }
      }
      cleanup();
      resolve({status: "failed", reason: "error", message});
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      mapInstance.off(event, onSuccess);
      mapInstance.off("error", onError);
    };

    cancel = () => {
      cleanup();
      resolve({status: "cancelled"});
    };
    mapInstance.once(event, onSuccess);
    mapInstance.on("error", onError);
  });
  promise.cancel = cancel;
  return promise;
}

function removeRefusedSource(mapInstance, sourceId) {
  try {
    if (!mapInstance.getSource(sourceId)) return;
    for (const layer of mapInstance.getStyle()?.layers || []) {
      if (layer.source === sourceId) mapInstance.removeLayer(layer.id);
    }
    mapInstance.removeSource(sourceId);
  } catch {
    // The warning still names the dataset; MapLibre reports anything else it cannot load.
  }
}

function isLoopbackSourceUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
`;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
