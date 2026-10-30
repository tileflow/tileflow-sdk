import type {TestContext} from 'node:test';
import {TileflowCaptureBrowserManager} from '../src/browser';

export function observeBrowserFailures(
  t: TestContext,
  write: (message: string) => void = (message) => {
    if (process.env.TILEFLOW_TEST_PROGRESS === '1') process.stderr.write(message);
  },
): string[] {
  const browserFailures: string[] = [];
  const observedBrowsers = new WeakSet();
  const started = Date.now();
  let remaining = 64;
  const report = (phase: string, message?: string) => {
    if (remaining-- <= 0) return;

    write(
      `[capture-browser] ${JSON.stringify({
        test: t.name,
        pid: process.pid,
        phase,
        elapsedMs: Date.now() - started,
        ...(message === undefined ? {} : {message: message.slice(0, 800)}),
      })}\n`,
    );
  };
  const recordFailure = (message: string) => {
    if (browserFailures.length >= 12) return;

    browserFailures.push(message.slice(0, 800));
    report('failure', message);
  };
  const getBrowser = TileflowCaptureBrowserManager.prototype.getBrowser;
  const close = TileflowCaptureBrowserManager.prototype.close;
  const onAbort = () => report('test-aborted');
  t.signal.addEventListener('abort', onAbort, {once: true});
  t.after(() => t.signal.removeEventListener('abort', onAbort));

  t.mock.method(
    TileflowCaptureBrowserManager.prototype,
    'close',
    async function (this: TileflowCaptureBrowserManager) {
      report('browser-close-request');
      await close.call(this);
      report('browser-closed');
    },
  );

  t.mock.method(
    TileflowCaptureBrowserManager.prototype,
    'getBrowser',
    async function (this: TileflowCaptureBrowserManager, signal?: AbortSignal) {
      report('browser-request');
      let browser;
      try {
        browser = await getBrowser.call(this, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause =
          error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
        recordFailure(`launch: ${message} ${cause}`);
        throw error;
      }

      if (observedBrowsers.has(browser)) return browser;
      observedBrowsers.add(browser);
      report('browser-ready');
      browser.on('disconnected', () => report('browser-disconnected'));
      const newContext = browser.newContext.bind(browser);

      t.mock.method(browser, 'newContext', async (...options: Parameters<typeof newContext>) => {
        report('context-request');
        const context = await newContext(...options);
        report('context-ready');
        context.on('close', () => report('context-closed'));
        context.on('page', (page) => {
          page.on('crash', () => recordFailure('page crashed'));
          page.on('pageerror', (error) => recordFailure(`pageerror: ${error.message}`));
          page.on('console', (message) => {
            if (message.type() === 'error') recordFailure(`console: ${message.text()}`);
          });
          page.on('response', (response) => {
            if (response.status() >= 400)
              recordFailure(`response: ${response.status()} ${new URL(response.url()).pathname}`);
          });
          page.on('requestfailed', (request) => {
            recordFailure(
              `requestfailed: ${request.failure()?.errorText} ${new URL(request.url()).pathname}`,
            );
          });
        });
        return context;
      });
      return browser;
    },
  );

  return browserFailures;
}
