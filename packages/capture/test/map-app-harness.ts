import {svelte} from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Page} from 'playwright';
import {createServer as createViteServer, type PluginOption} from 'vite';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {writeDataLayerFixture} from './tileflow-source-fixture';

export type MapAppFramework = 'react' | 'svelte' | 'vue';

export type MapAppPage = {
  consoleErrors: string[];
  page: Page;
  pageErrors: string[];
};

const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));

const appFile: Record<MapAppFramework, string> = {
  react: 'main.tsx',
  svelte: 'App.svelte',
  vue: 'App.vue',
};

const entry = (framework: Exclude<MapAppFramework, 'react'>) =>
  framework === 'vue'
    ? `import {createApp} from 'vue';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/vue';
import App from './App.vue';
configureTileflowMapLibre({workerUrl});
createApp(App).mount('#root');
`
    : `import {mount} from 'svelte';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/svelte';
import App from './App.svelte';
configureTileflowMapLibre({workerUrl});
mount(App, {target: document.getElementById('root')});
`;

/**
 * Serves a small application of one framework from a throwaway Vite server, with the test fixture's
 * manifest at `/tileflow-fixture/manifest.json`, and runs `body` with a way to open its pages in
 * Chromium. React runs from the workspace sources; Vue and Svelte from their built packages.
 */
export async function withMapApp(
  framework: MapAppFramework,
  source: string,
  body: (open: (query?: string) => Promise<MapAppPage>) => Promise<void>,
  options: {writeFixture?: (cwd: string, origin: string) => Promise<void>} = {},
): Promise<void> {
  const writeFixture = options.writeFixture ?? writeDataLayerFixture;
  const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const cwd = await mkdtemp(join(root, `.tileflow-test-${framework}-map-app-`));
  const plugins: PluginOption[] =
    framework === 'vue' ? [vue()] : framework === 'svelte' ? [svelte()] : [];
  let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    await Promise.all([
      writeFile(
        join(cwd, 'index.html'),
        `<!doctype html><html><body><div id="root" style="width:640px"></div><script type="module" src="/${framework === 'react' ? 'main.tsx' : 'main.js'}"></script></body></html>`,
      ),
      ...(framework === 'react'
        ? []
        : [writeFile(join(cwd, 'main.js'), entry(framework as Exclude<MapAppFramework, 'react'>))]),
      writeFile(join(cwd, appFile[framework]), source),
      writeFixture(cwd, 'http://127.0.0.1'),
    ]);
    vite = await createViteServer({
      cacheDir: join(cwd, '.vite-cache'),
      configFile: false,
      logLevel: 'silent',
      plugins,
      resolve: framework === 'react' ? {alias: {'@tileflow/react': reactSource}} : {},
      root: cwd,
      server: {host: '127.0.0.1', port: 0, watch: null},
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    await writeFixture(cwd, origin);

    browser = await launchTileflowCaptureBrowser({allowInstall: false});
    await body(async (query = '') => {
      const page = await browser!.newPage({viewport: {height: 480, width: 640}});
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(`${origin}/${query}`, {waitUntil: 'domcontentloaded'});
      return {consoleErrors, page, pageErrors};
    });
  } finally {
    await browser?.close();
    await vite?.close();
    await rm(cwd, {force: true, recursive: true});
  }
}

/** The three frameworks, for a test that runs the same case in each. */
export const mapAppFrameworks: readonly MapAppFramework[] = ['react', 'vue', 'svelte'];
