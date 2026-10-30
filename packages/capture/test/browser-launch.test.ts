import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {type Browser, chromium, type LaunchOptions} from 'playwright';
import {launchTileflowCaptureBrowser} from '../src/browser';

for (const platform of ['win32', 'darwin', 'linux'] as const) {
  test(`preserves browser isolation while configuring TCP allocation on ${platform}`, async (t) => {
    const options = await captureLaunchOptions(t, platform);
    const disabledFeatures = readDisabledFeatures(options.args ?? []);

    assert.equal(disabledFeatures.has('TcpPortRandomizationWin'), platform === 'win32');
    assert.equal(options.chromiumSandbox, true);
    assert.equal(options.headless, true);
    assert.equal(options.args?.includes('--no-sandbox'), false);
    assert.equal(options.args?.includes('--disable-web-security'), false);

    if (platform !== 'win32') {
      assert.deepEqual(options.args, ['--disable-dev-shm-usage']);
    }
  });
}

test(
  'Windows launch arguments retain the installed Playwright feature defaults',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const options = await captureLaunchOptions(t, 'win32');
    const defaults = await browserArguments({...options, args: ['--disable-dev-shm-usage']});
    const configured = await browserArguments(options);
    const expected = readDisabledFeatures(defaults);
    expected.add('TcpPortRandomizationWin');

    assert.deepEqual(readDisabledFeatures(configured), expected);
  },
);

async function captureLaunchOptions(
  t: TestContext,
  platform: NodeJS.Platform,
): Promise<LaunchOptions> {
  let options: LaunchOptions | undefined;
  const launch = t.mock.method(chromium, 'launch', async (value: LaunchOptions) => {
    options = value;
    return {} as Browser;
  });
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

  try {
    Object.defineProperty(process, 'platform', {value: platform});
    await launchTileflowCaptureBrowser({allowInstall: false});
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    launch.mock.restore();
  }

  assert.ok(options);
  return options;
}

async function browserArguments(options: LaunchOptions): Promise<string[]> {
  const browser = await chromium.launch({
    ...options,
    args: [...(options.args ?? []), '--enable-automation'],
  });

  try {
    const session = await browser.newBrowserCDPSession();
    return (await session.send('Browser.getBrowserCommandLine')).arguments;
  } finally {
    await browser.close();
  }
}

function readDisabledFeatures(args: string[]): Set<string> {
  const flag = args.findLast((argument) => argument.startsWith('--disable-features='));
  return new Set(flag?.slice('--disable-features='.length).split(',') ?? []);
}
