import assert from 'node:assert/strict';
import test from 'node:test';
import type {Browser} from 'playwright';
import {
  createTileflowCaptureBrowserInstallerEnvironment,
  getPlaywrightInstallerInvocation,
  launchTileflowCaptureBrowserWithDependencies,
  TileflowCaptureBrowserManager,
} from '../src/browser';
import {TileflowCaptureError} from '../src/errors';

const fakeBrowser = {version: () => '148.0.7778.96'} as Browser;

test('reuses an installed pinned browser without invoking setup', async () => {
  let installs = 0;
  const browser = await launchTileflowCaptureBrowserWithDependencies(
    {allowInstall: true},
    {
      install: async () => {
        installs += 1;
      },
      launch: async () => fakeBrowser,
    },
  );

  assert.equal(browser, fakeBrowser);
  assert.equal(installs, 0);
});

test('installs the pinned shell once after the exact missing-browser failure', async () => {
  let launches = 0;
  let installs = 0;
  const progress: string[] = [];
  const browser = await launchTileflowCaptureBrowserWithDependencies(
    {
      allowInstall: true,
      onInstallProgress: (event) => progress.push(event),
    },
    {
      install: async () => {
        installs += 1;
      },
      launch: async () => {
        launches += 1;
        if (launches === 1) {
          throw new Error("Executable doesn't exist for pinned Chromium");
        }
        return fakeBrowser;
      },
    },
  );

  assert.equal(browser, fakeBrowser);
  assert.equal(installs, 1);
  assert.equal(launches, 2);
  assert.deepEqual(progress, ['installing', 'installed']);
});

test('does not retry browser launch when cancellation wins as installation completes', async () => {
  const controller = new AbortController();
  let launches = 0;

  await assert.rejects(
    () =>
      launchTileflowCaptureBrowserWithDependencies(
        {allowInstall: true, signal: controller.signal},
        {
          install: async () => controller.abort(),
          launch: async () => {
            launches += 1;
            if (launches === 1) throw new Error("Executable doesn't exist for pinned Chromium");
            return fakeBrowser;
          },
        },
      ),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'ABORTED',
  );
  assert.equal(launches, 1);
});

test('disabled installation fails without invoking the installer', async () => {
  let installs = 0;

  await assert.rejects(
    () =>
      launchTileflowCaptureBrowserWithDependencies(
        {allowInstall: false},
        {
          install: async () => {
            installs += 1;
          },
          launch: async () => {
            throw new Error("Executable doesn't exist for pinned Chromium");
          },
        },
      ),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'BROWSER_MISSING',
  );
  assert.equal(installs, 0);
});

test('does not misclassify missing host libraries as a missing browser download', async () => {
  let installs = 0;
  await assert.rejects(
    () =>
      launchTileflowCaptureBrowserWithDependencies(
        {allowInstall: true},
        {
          install: async () => {
            installs += 1;
          },
          launch: async () => {
            throw new Error(
              'Host system is missing dependencies to run browsers. Run playwright install-deps chromium.',
            );
          },
        },
      ),
    (error: unknown) =>
      error instanceof TileflowCaptureError && error.code === 'BROWSER_START_FAILED',
  );
  assert.equal(installs, 0);
});

test('uses only the pinned Playwright CLI and fixed headless-shell arguments', () => {
  const invocation = getPlaywrightInstallerInvocation();

  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(1), ['install', '--only-shell', 'chromium']);
  assert.match(invocation.args[0] ?? '', /playwright[/\\]cli\.js$/);
});

test('preserves lowercase proxy settings for the pinned browser installer only', () => {
  const environment = createTileflowCaptureBrowserInstallerEnvironment({
    HOME: '/safe-home',
    LANG: 'en_US.UTF-8',
    https_proxy: 'http://proxy.local:8080',
    no_proxy: 'localhost,127.0.0.1',
    PLAYWRIGHT_BROWSERS_PATH: '/opt/pinned-browsers',
    NPM_TOKEN: 'secret',
  });

  assert.equal(environment.https_proxy, 'http://proxy.local:8080');
  assert.equal(environment.no_proxy, 'localhost,127.0.0.1');
  assert.equal(environment.PLAYWRIGHT_BROWSERS_PATH, '/opt/pinned-browsers');
  assert.equal(environment.NPM_TOKEN, undefined);
});

test('a warm manager launches one Browser and closes it once across repeated generations', async () => {
  let closes = 0;
  let launches = 0;
  const browser = {
    close: async () => {
      closes += 1;
    },
    version: () => '148.0.7778.96',
  } as Browser;
  const manager = new TileflowCaptureBrowserManager(
    {allowInstall: false},
    {
      install: async () => assert.fail('warm manager unexpectedly installed a browser'),
      launch: async () => {
        launches += 1;
        return browser;
      },
    },
  );

  assert.equal(await manager.getBrowser(), browser);
  assert.equal(await manager.getBrowser(), browser);
  await manager.close();
  await manager.close();
  assert.equal(launches, 1);
  assert.equal(closes, 1);
});

test('an aborted capture does not launch a shared Browser', async () => {
  let launches = 0;
  const controller = new AbortController();
  controller.abort();
  const manager = new TileflowCaptureBrowserManager(
    {allowInstall: false},
    {
      install: async () => assert.fail('aborted manager unexpectedly installed a browser'),
      launch: async () => {
        launches += 1;
        return {} as Browser;
      },
    },
  );

  await assert.rejects(
    () => manager.getBrowser(controller.signal),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'ABORTED',
  );
  assert.equal(launches, 0);
});
