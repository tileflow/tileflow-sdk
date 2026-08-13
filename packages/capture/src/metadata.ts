import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import type {Browser} from 'playwright';

export type TileflowCaptureRendererIdentity = {
  tileflow: string;
  maplibre: string;
  playwright: string;
  chromiumRevision: string;
  chromiumVersion: string;
};

type PackageMetadata = {version: string};
type PlaywrightBrowsersMetadata = {
  browsers: Array<{browserVersion?: string; name: string; revision: string}>;
};

const require = createRequire(import.meta.url);
const capturePackage = readJson<PackageMetadata>(new URL('../package.json', import.meta.url));
const playwrightPackagePath = require.resolve('playwright/package.json');
const playwrightPackage = readJson<PackageMetadata>(playwrightPackagePath);
const requireFromPlaywright = createRequire(playwrightPackagePath);
const playwrightCorePackagePath = requireFromPlaywright.resolve('playwright-core/package.json');
const browsers = readJson<PlaywrightBrowsersMetadata>(
  join(dirname(playwrightCorePackagePath), 'browsers.json'),
);
const maplibrePackage = readJson<PackageMetadata>(require.resolve('maplibre-gl/package.json'));
const chromiumHeadlessShell = browsers.browsers.find(
  (browser) => browser.name === 'chromium-headless-shell',
);

if (!chromiumHeadlessShell) {
  throw new Error('The installed Playwright package does not declare a Chromium headless shell.');
}

export const tileflowCaptureRuntime = Object.freeze({
  tileflow: capturePackage.version,
  maplibre: maplibrePackage.version,
  playwright: playwrightPackage.version,
  chromiumRevision: chromiumHeadlessShell.revision,
  chromiumVersion: chromiumHeadlessShell.browserVersion ?? 'unknown',
});

export function createTileflowCaptureRendererIdentity(
  browser?: Pick<Browser, 'version'>,
): TileflowCaptureRendererIdentity {
  return {
    ...tileflowCaptureRuntime,
    chromiumVersion: browser?.version() ?? tileflowCaptureRuntime.chromiumVersion,
  };
}

export function getPlaywrightCliPath(): string {
  return join(dirname(playwrightPackagePath), 'cli.js');
}

function readJson<T>(path: string | URL): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
