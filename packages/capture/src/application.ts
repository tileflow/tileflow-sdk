import type {Browser, BrowserContext, Locator} from 'playwright';
import {type NormalizedTileflowCaptureScene, tileflowCaptureSceneLimits} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import {readPngDimensions} from './standalone';

const maximumApplicationUrlLength = tileflowCaptureSceneLimits.applicationPathLength + 512;

export type ApplicationTileflowCaptureInput = {
  appOrigin?: string;
  appUrl?: string;
  browser: Browser;
  scene: NormalizedTileflowCaptureScene & {
    target: {
      kind: 'application';
      path: string;
      captureId?: string;
      selector?: string;
      frame: 'map' | 'viewport';
    };
  };
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ApplicationTileflowCaptureOutput = {
  height: number;
  networkDependent: boolean;
  png: Uint8Array;
  warnings: string[];
  width: number;
};

export function resolveTileflowApplicationUrl(input: {
  appOrigin?: string;
  appUrl?: string;
  path: string;
}): {origin: string; url: string} {
  if (input.appOrigin && input.appUrl) {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_INVALID',
      'Use either an application origin or a full application URL, not both.',
    );
  }

  if (input.appUrl) {
    const url = parseLoopbackHttpUrl(input.appUrl, false);
    return {origin: url.origin, url: url.toString()};
  }

  if (!input.appOrigin) {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_REQUIRED',
      'Application capture requires --app-origin, --url, TILEFLOW_APP_ORIGIN, or a programmatic equivalent.',
    );
  }

  const origin = parseLoopbackHttpUrl(input.appOrigin, true);
  const url = parseLoopbackHttpUrl(new URL(input.path, `${origin.origin}/`).toString(), false);
  return {origin: origin.origin, url: url.toString()};
}

export async function captureApplicationTileflowScene(
  input: ApplicationTileflowCaptureInput,
): Promise<ApplicationTileflowCaptureOutput> {
  const application = resolveTileflowApplicationUrl({
    appOrigin: input.appOrigin,
    appUrl: input.appUrl,
    path: input.scene.target.path,
  });
  const timeoutMs = input.timeoutMs ?? 30_000;
  let context: BrowserContext | undefined;
  let termination: 'aborted' | 'timeout' | undefined;
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

    const page = await context.newPage();
    const remoteOrigins = new Set<string>();
    let applicationFailure = false;
    let applicationOriginEscape = false;
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*', async (route) => {
      const request = route.request();
      try {
        if (
          request.isNavigationRequest() &&
          request.frame().parentFrame() === null &&
          !isApprovedApplicationDocumentUrl(request.url(), application.origin)
        ) {
          applicationOriginEscape = true;
          await route.abort('blockedbyclient');
          return;
        }
      } catch {
        // A request without a stable frame cannot replace the approved main document.
      }
      await route.continue();
    });
    page.on('dialog', (dialog) => void dialog.dismiss());
    page.on('popup', (popup) => void popup.close());
    page.on('console', (message) => {
      if (message.type() === 'error') applicationFailure = true;
    });
    page.on('pageerror', () => {
      applicationFailure = true;
    });
    page.on('websocket', (socket) => {
      try {
        const url = new URL(socket.url());
        if (
          (url.protocol === 'ws:' || url.protocol === 'wss:') &&
          webSocketHttpOrigin(url) !== application.origin
        ) {
          remoteOrigins.add(url.origin);
        }
      } catch {
        // Browser-internal sockets without a valid URL cannot be projected as safe origins.
      }
    });
    page.on('request', (request) => {
      try {
        const url = new URL(request.url());
        if (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.origin !== application.origin
        ) {
          remoteOrigins.add(url.origin);
        }
      } catch {
        // Playwright can report non-URL browser-internal requests; they are not external dependencies.
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && new URL(response.url()).origin === application.origin) {
        applicationFailure = true;
      }
    });

    let navigationResponse;
    try {
      navigationResponse = await page.goto(application.url, {waitUntil: 'domcontentloaded'});
    } catch (error) {
      throw new TileflowCaptureError(
        'APPLICATION_NAVIGATION_FAILED',
        'The loopback application page could not be loaded.',
        {cause: error},
      );
    }
    if (
      !navigationResponse ||
      navigationResponse.status() >= 400 ||
      !isApprovedApplicationDocumentUrl(navigationResponse.url(), application.origin) ||
      !isApprovedApplicationDocumentUrl(page.url(), application.origin) ||
      applicationOriginEscape
    ) {
      throw new TileflowCaptureError(
        'APPLICATION_NAVIGATION_FAILED',
        'The loopback application page did not return a successful document on the approved origin.',
      );
    }

    const locator = createTargetLocator(page, input.scene);
    let targetCount: number;
    try {
      targetCount = await locator.count();
    } catch (error) {
      throw new TileflowCaptureError(
        'APPLICATION_TARGET_NOT_FOUND',
        'The application capture selector is invalid.',
        {cause: error},
      );
    }
    if (targetCount === 0) {
      try {
        await locator.first().waitFor({
          state: 'attached',
          timeout: Math.min(timeoutMs, 2_000),
        });
        targetCount = await locator.count();
      } catch {
        // Client-rendered framework targets may attach after DOMContentLoaded. The bounded grace
        // period closes that race while preserving the stable not-found diagnostic below.
      }
    }
    if (targetCount === 0) {
      if (applicationFailure || applicationOriginEscape) {
        throw new TileflowCaptureError(
          'APPLICATION_ERROR',
          'The application reported an error before its capture target became ready.',
        );
      }
      throw new TileflowCaptureError(
        'APPLICATION_TARGET_NOT_FOUND',
        'The application page did not contain the requested Tileflow capture target.',
      );
    }
    if (targetCount !== 1) {
      throw new TileflowCaptureError(
        'APPLICATION_TARGET_AMBIGUOUS',
        `The application page contained ${targetCount} matching Tileflow capture targets; expected exactly one.`,
      );
    }

    await locator.waitFor({state: 'visible'});
    await waitForApplicationTarget(
      locator,
      input.scene.target.selector !== undefined,
      timeoutMs,
      () => applicationFailure || applicationOriginEscape,
    );
    if (applicationFailure || applicationOriginEscape) {
      throw new TileflowCaptureError(
        'APPLICATION_ERROR',
        'The application reported an error before its capture target became ready.',
      );
    }
    if (!isApprovedApplicationDocumentUrl(page.url(), application.origin)) {
      throw new TileflowCaptureError(
        'APPLICATION_NAVIGATION_FAILED',
        'The application page left the approved loopback origin before capture.',
      );
    }

    if (input.scene.target.frame === 'map') {
      await assertApplicationTargetPixelBounds(locator, input.scene.viewport.dpr);
    }

    const png = new Uint8Array(
      input.scene.target.frame === 'viewport'
        ? await page.screenshot({animations: 'disabled', type: 'png'})
        : await locator.screenshot({animations: 'disabled', type: 'png'}),
    );
    await assertApplicationTargetRemainsReady(locator, input.scene.target.selector !== undefined);
    if (applicationFailure || applicationOriginEscape) {
      throw new TileflowCaptureError(
        'APPLICATION_ERROR',
        'The application reported an error before capture completed.',
      );
    }
    if (!isApprovedApplicationDocumentUrl(page.url(), application.origin)) {
      throw new TileflowCaptureError(
        'APPLICATION_NAVIGATION_FAILED',
        'The application page left the approved loopback origin during capture.',
      );
    }
    const physical = readPngDimensions(png);
    if (
      physical.width > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
      physical.height > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
      physical.width * physical.height > tileflowCaptureSceneLimits.maximumPhysicalPixels
    ) {
      throw new TileflowCaptureError(
        'RENDER_FAILED',
        'The application capture target exceeded the bounded visual pixel limit.',
      );
    }
    const warnings = [...remoteOrigins]
      .sort(compareCodeUnits)
      .map((origin) => `Application capture requested remote resources from ${origin}.`);

    return {
      height: physical.height / input.scene.viewport.dpr,
      networkDependent: remoteOrigins.size > 0,
      png,
      warnings,
      width: physical.width / input.scene.viewport.dpr,
    };
  } catch (error) {
    if (termination === 'aborted') {
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.', {cause: error});
    }
    if (termination === 'timeout') {
      throw new TileflowCaptureError(
        'CAPTURE_TIMEOUT',
        'Tileflow capture timed out before the application target became idle.',
        {cause: error},
      );
    }
    if (error instanceof TileflowCaptureError) throw error;
    throw new TileflowCaptureError(
      'APPLICATION_ERROR',
      'The application target failed before capture completed.',
      {cause: error},
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    input.signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined);
  }
}

async function assertApplicationTargetRemainsReady(
  locator: Locator,
  allowUnmarkedSelector: boolean,
): Promise<void> {
  const state = await locator.getAttribute('data-tileflow-state');
  if (state === 'idle' || (state === null && allowUnmarkedSelector)) return;

  throw new TileflowCaptureError(
    'APPLICATION_ERROR',
    'The application capture target stopped being ready while its screenshot was produced.',
  );
}

function webSocketHttpOrigin(url: URL): string {
  const comparable = new URL(url);
  comparable.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return comparable.origin;
}

async function assertApplicationTargetPixelBounds(locator: Locator, dpr: 1 | 2): Promise<void> {
  const box = await locator.boundingBox();
  if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    throw new TileflowCaptureError(
      'RENDER_FAILED',
      'The application capture target did not have stable bounded dimensions.',
    );
  }
  const physicalWidth = Math.ceil(box.width * dpr);
  const physicalHeight = Math.ceil(box.height * dpr);
  if (
    physicalWidth <= 0 ||
    physicalHeight <= 0 ||
    physicalWidth > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    physicalHeight > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    physicalWidth * physicalHeight > tileflowCaptureSceneLimits.maximumPhysicalPixels
  ) {
    throw new TileflowCaptureError(
      'RENDER_FAILED',
      'The application capture target exceeded the bounded visual pixel limit.',
    );
  }
}

function createTargetLocator(
  page: import('playwright').Page,
  scene: ApplicationTileflowCaptureInput['scene'],
): Locator {
  try {
    if (scene.target.captureId) {
      return page.locator(`[data-tileflow-capture-id="${scene.target.captureId}"]`);
    }
    if (scene.target.selector) return page.locator(scene.target.selector);
    return page.locator(`[data-tileflow-map="${scene.map}"]`);
  } catch (error) {
    throw new TileflowCaptureError(
      'APPLICATION_TARGET_NOT_FOUND',
      'The application capture selector is invalid.',
      {cause: error},
    );
  }
}

async function waitForApplicationTarget(
  locator: Locator,
  allowUnmarkedSelector: boolean,
  timeoutMs: number,
  hasApplicationFailure: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasApplicationFailure()) {
      throw new TileflowCaptureError(
        'APPLICATION_ERROR',
        'The application reported an error before its capture target became ready.',
      );
    }
    const state = await locator.getAttribute('data-tileflow-state');
    if (state === 'error') {
      throw new TileflowCaptureError(
        'APPLICATION_ERROR',
        'The application capture target entered the error state.',
      );
    }
    if (state === 'idle' || (state === null && allowUnmarkedSelector)) {
      await locator.evaluate(
        () =>
          new Promise<void>((resolveReady) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolveReady())),
          ),
      );
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }

  throw new TileflowCaptureError(
    'CAPTURE_TIMEOUT',
    'The application capture target did not become idle.',
  );
}

function parseLoopbackHttpUrl(value: string, requireOriginOnly: boolean): URL {
  if (
    value !== value.trim() ||
    value.length > maximumApplicationUrlLength ||
    hasControlCharacter(value)
  ) {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_INVALID',
      'Application capture requires a bounded loopback HTTP(S) URL without surrounding whitespace or control characters.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_INVALID',
      'Application capture requires a valid loopback HTTP(S) URL.',
      {cause: error},
    );
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !isLoopbackHostname(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (requireOriginOnly && (url.pathname !== '/' || url.search !== ''))
  ) {
    throw new TileflowCaptureError(
      'APPLICATION_ORIGIN_INVALID',
      requireOriginOnly
        ? 'Application origin must be an HTTP(S) loopback origin without credentials, path, query, or fragment.'
        : 'Application URL must use HTTP(S) loopback without credentials or a fragment.',
    );
  }

  return url;
}

function isApprovedApplicationDocumentUrl(value: string, origin: string): boolean {
  try {
    return parseLoopbackHttpUrl(value, false).origin === origin;
  } catch {
    return false;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '[::1]') {
    return true;
  }
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    Number(octets[0]) === 127
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
