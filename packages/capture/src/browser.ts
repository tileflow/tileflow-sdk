import {spawn} from 'node:child_process';
import {type Browser, chromium} from 'playwright';
import {TileflowCaptureError} from './errors';
import {
  createTileflowCaptureRendererIdentity,
  getPlaywrightCliPath,
  type TileflowCaptureRendererIdentity,
} from './metadata';

export type TileflowBrowserInstallProgress = 'installing' | 'installed';

export type TileflowBrowserLaunchOptions = {
  allowInstall?: boolean;
  onInstallProgress?: (progress: TileflowBrowserInstallProgress) => void;
  signal?: AbortSignal;
};

export type TileflowCaptureBrowserDependencies = {
  install(signal?: AbortSignal): Promise<void>;
  launch(): Promise<Browser>;
};

const chromiumEnvironmentAllowlist = [
  'APPDATA',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
] as const;

const installerEnvironmentAllowlist = [
  ...chromiumEnvironmentAllowlist,
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST',
  'PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT',
  'PLAYWRIGHT_DOWNLOAD_HOST',
] as const;

export function createTileflowCaptureBrowserEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: source.HOME || source.USERPROFILE || source.TMPDIR || source.TEMP || source.TMP || '/tmp',
    LANG: source.LANG || 'C.UTF-8',
  };

  for (const key of chromiumEnvironmentAllowlist) {
    const value = source[key];

    if (value) {
      environment[key] = value;
    }
  }

  return environment;
}

export async function launchTileflowCaptureBrowser(
  options: TileflowBrowserLaunchOptions = {},
): Promise<Browser> {
  return launchTileflowCaptureBrowserWithDependencies(options, {
    install: installPinnedBrowser,
    launch: launchPinnedBrowser,
  });
}

export async function launchTileflowCaptureBrowserWithDependencies(
  options: TileflowBrowserLaunchOptions,
  dependencies: TileflowCaptureBrowserDependencies,
): Promise<Browser> {
  throwIfAborted(options.signal);

  try {
    return await dependencies.launch();
  } catch (error) {
    if (!isMissingBrowserError(error)) {
      throw new TileflowCaptureError(
        'BROWSER_START_FAILED',
        'Pinned Chromium could not start for Tileflow capture.',
        {cause: error},
      );
    }

    if (options.allowInstall === false) {
      throw new TileflowCaptureError(
        'BROWSER_MISSING',
        'Pinned Chromium is not installed. Run `tileflow setup capture` or allow browser installation.',
        {cause: error},
      );
    }

    options.onInstallProgress?.('installing');
    await dependencies.install(options.signal);
    throwIfAborted(options.signal);
    options.onInstallProgress?.('installed');

    try {
      return await dependencies.launch();
    } catch (retryError) {
      throw new TileflowCaptureError(
        'BROWSER_START_FAILED',
        'Pinned Chromium was installed but could not start for Tileflow capture.',
        {cause: retryError},
      );
    }
  }
}

export async function setupTileflowCaptureBrowser(
  options: TileflowBrowserLaunchOptions = {},
): Promise<TileflowCaptureRendererIdentity> {
  const browser = await launchTileflowCaptureBrowser(options);

  try {
    return createTileflowCaptureRendererIdentity(browser);
  } finally {
    await browser.close();
  }
}

export class TileflowCaptureBrowserManager {
  readonly #dependencies: TileflowCaptureBrowserDependencies;
  readonly #options: TileflowBrowserLaunchOptions;
  #browserPromise?: Promise<Browser>;
  #closed = false;

  constructor(
    options: TileflowBrowserLaunchOptions = {},
    dependencies: TileflowCaptureBrowserDependencies = {
      install: installPinnedBrowser,
      launch: launchPinnedBrowser,
    },
  ) {
    this.#options = options;
    this.#dependencies = dependencies;
  }

  getBrowser(signal: AbortSignal | undefined = this.#options.signal): Promise<Browser> {
    if (this.#closed) {
      return Promise.reject(
        new TileflowCaptureError('BROWSER_START_FAILED', 'Tileflow capture session is closed.'),
      );
    }

    try {
      throwIfAborted(signal);
    } catch (error) {
      return Promise.reject(error);
    }

    this.#browserPromise ??= launchTileflowCaptureBrowserWithDependencies(
      {...this.#options, signal},
      this.#dependencies,
    ).catch((error) => {
      this.#browserPromise = undefined;
      throw error;
    });
    return this.#browserPromise;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    const browserPromise = this.#browserPromise;
    this.#browserPromise = undefined;

    if (!browserPromise) {
      return;
    }

    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // A failed launch has no connected Browser to close.
    }
  }
}

function launchPinnedBrowser(): Promise<Browser> {
  return chromium.launch({
    args: ['--disable-dev-shm-usage'],
    chromiumSandbox: true,
    env: createTileflowCaptureBrowserEnvironment(),
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    headless: true,
  });
}

async function installPinnedBrowser(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const invocation = getPlaywrightInstallerInvocation();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: createTileflowCaptureBrowserInstallerEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      finish(() => reject(new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.')));
    };

    signal?.addEventListener('abort', onAbort, {once: true});
    child.once('error', (error) => {
      finish(() =>
        reject(
          new TileflowCaptureError(
            'BROWSER_INSTALL_FAILED',
            'Pinned Chromium installation could not start.',
            {cause: error},
          ),
        ),
      );
    });
    child.once('exit', (code, exitSignal) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new TileflowCaptureError(
            'BROWSER_INSTALL_FAILED',
            `Pinned Chromium installation failed${exitSignal ? ` after ${exitSignal}` : ''}.`,
          ),
        );
      });
    });
  });
}

export function createTileflowCaptureBrowserInstallerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return pickEnvironment(installerEnvironmentAllowlist, source);
}

export function getPlaywrightInstallerInvocation(): {command: string; args: string[]} {
  return {
    command: process.execPath,
    args: [getPlaywrightCliPath(), 'install', '--only-shell', 'chromium'],
  };
}

function pickEnvironment(
  keys: readonly string[],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of keys) {
    const value = source[key];
    if (value) {
      environment[key] = value;
    }
  }

  environment.HOME ||=
    environment.USERPROFILE || environment.TMPDIR || environment.TEMP || environment.TMP || '/tmp';
  environment.LANG ||= 'C.UTF-8';
  return environment;
}

function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") || message.includes('Executable does not exist')
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
  }
}
