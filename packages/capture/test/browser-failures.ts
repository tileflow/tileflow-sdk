import type {TestContext} from 'node:test';
import {TileflowCaptureBrowserManager} from '../src/browser';

export function observeBrowserFailures(t: TestContext): string[] {
  const browserFailures: string[] = [];
  const observedBrowsers = new WeakSet();
  const recordFailure = (message: string) => {
    if (browserFailures.length < 12) browserFailures.push(message.slice(0, 800));
  };
  const getBrowser = TileflowCaptureBrowserManager.prototype.getBrowser;

  t.mock.method(
    TileflowCaptureBrowserManager.prototype,
    'getBrowser',
    async function (this: TileflowCaptureBrowserManager, signal?: AbortSignal) {
      const browser = await getBrowser.call(this, signal);
      if (observedBrowsers.has(browser)) return browser;
      observedBrowsers.add(browser);
      const newContext = browser.newContext.bind(browser);

      t.mock.method(browser, 'newContext', async (...options: Parameters<typeof newContext>) => {
        const context = await newContext(...options);
        context.on('page', (page) => {
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
