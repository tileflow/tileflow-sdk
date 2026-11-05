import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {Server} from 'node:http';
import {dirname, join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {Page} from 'playwright';
import {PNG} from 'pngjs';
import {createServer as createViteServer, type PluginOption} from 'vite';
import {tileflow} from '@tileflow/vite';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {createTileflowCaptureSession} from '../src/index';
import {observeBrowserFailures} from './browser-failures';
import {writeFrameworkMapFixture} from './tileflow-source-fixture';

type FrameworkViteFixtureOptions = {
  entry: string;
  files: Record<string, string>;
  framework: string;
  plugins: PluginOption[];
  popupProbeRgb: readonly [number, number, number];
};

export async function verifyFrameworkViteCapture(
  t: TestContext,
  options: FrameworkViteFixtureOptions,
): Promise<void> {
  const browserFailures = observeBrowserFailures(t);
  const capturePackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const cwd = await mkdtemp(
    join(capturePackageRoot, `.tileflow-test-${options.framework}-vite-capture-`),
  );
  await symlink(
    join(capturePackageRoot, 'node_modules'),
    join(cwd, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await Promise.all([
    writeFile(
      join(cwd, 'index.html'),
      `<!doctype html><html><body><div id="root"></div><script type="module" src="/${options.entry}"></script></body></html>`,
      'utf8',
    ),
    writeFile(join(cwd, 'tileflow.config.ts'), applicationConfig, 'utf8'),
    writeFrameworkMapFixture(cwd, undefined, {family: true}),
    ...Object.entries(options.files).map(([file, source]) =>
      writeFile(join(cwd, file), source, 'utf8'),
    ),
  ]);

  const vite = await createViteServer({
    cacheDir: join(cwd, '.vite-cache'),
    configFile: false,
    logLevel: 'silent',
    plugins: [tileflow(), ...options.plugins],
    root: cwd,
    server: {host: '127.0.0.1', port: 0},
  });
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const appOrigin = `http://127.0.0.1:${address.port}`;
    const manifestResponse = await fetch(`${appOrigin}/tileflow/manifest.json`);
    const manifestBody = await manifestResponse.text();
    assert.equal(manifestResponse.status, 200, manifestBody);
    assert.equal((JSON.parse(manifestBody) as {version?: unknown}).version, 3);

    let additionalListeners = 0;
    t.mock.method(Server.prototype, 'listen', function forbiddenAdditionalListener() {
      additionalListeners += 1;
      throw new Error('Application capture opened a second Node listener.');
    });
    const session = createTileflowCaptureSession({
      allowBrowserInstall: false,
      appOrigin,
      config: 'tileflow.config.ts',
      cwd,
      signal: t.signal,
    });

    try {
      const result = await session.capture(['cleanup', 'image', 'interactive', 'popup']);
      assert.deepEqual(
        result.captures.map((capture) => ({
          height: capture.height,
          scene: capture.scene,
          target: capture.target,
          width: capture.width,
        })),
        [
          {height: 16, scene: 'cleanup', target: 'application', width: 16},
          {height: 240, scene: 'image', target: 'application', width: 150},
          {height: 240, scene: 'interactive', target: 'application', width: 260},
          {height: 40, scene: 'popup', target: 'application', width: 168},
        ],
      );
      const interactiveCapture = result.captures.find(({scene}) => scene === 'interactive');
      const popupCapture = result.captures.find(({scene}) => scene === 'popup');
      assert.ok(interactiveCapture);
      assert.ok(popupCapture);
      assertPngContainsProbeColor(
        interactiveCapture.png,
        options.popupProbeRgb,
        `${options.framework} interactive map`,
      );
      assertPngContainsProbeColor(
        popupCapture.png,
        options.popupProbeRgb,
        `${options.framework} popup selector`,
      );
      assert.ok(result.captures.every((capture) => capture.networkDependent === false));
      assert.equal(additionalListeners, 0);
      for (const scene of ['missing-map', 'unresolved-image']) {
        await assert.rejects(
          () => session.capture([scene]),
          (error: unknown) =>
            error instanceof Error && 'code' in error && error.code === 'APPLICATION_ERROR',
          `${options.framework} ${scene} must become APPLICATION_ERROR`,
        );
      }
    } catch (error) {
      t.diagnostic(JSON.stringify({framework: options.framework, browserFailures}));
      throw error;
    } finally {
      await session.close();
    }
  } finally {
    try {
      await vite.close();
    } finally {
      await rm(cwd, {force: true, recursive: true});
    }
  }
}

export function assertPngContainsProbeColor(
  png: Uint8Array,
  expected: readonly [number, number, number],
  label: string,
): void {
  const decoded = PNG.sync.read(Buffer.from(png));
  let matchingPixels = 0;

  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    if (
      Math.abs(decoded.data[offset]! - expected[0]) <= 1 &&
      Math.abs(decoded.data[offset + 1]! - expected[1]) <= 1 &&
      Math.abs(decoded.data[offset + 2]! - expected[2]) <= 1 &&
      decoded.data[offset + 3]! >= 250
    ) {
      matchingPixels += 1;
    }
  }

  assert.ok(
    matchingPixels >= 500,
    `${label} did not capture the committed custom popup probe (${matchingPixels} matching pixels).`,
  );
}

const applicationConfig = `import {defineMap, openMapTiles, vectorTiles} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  themes: {light: streets.themes.light},
  data: vectorTiles({
    attribution: '© Tileflow capture fixture',
    revision: 'capture-fixture-v1',
    schema: openMapTiles(),
    tiles: ['https://tiles.example.invalid/{z}/{x}/{y}.pbf']
  }),
  scenes: {
    cleanup: {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', selector: '#cleanup-proof'}
    },
    image: {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'image'}
    },
    'missing-map': {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'missing-map'}
    },
    interactive: {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', selector: '[data-tileflow-capture-id="interactive"]'}
    },
    popup: {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', selector: '[data-tileflow-popup-probe]'}
    },
    'unresolved-image': {
      theme: 'light',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'unresolved-image'}
    }
  },
  glyphs: {
    kind: 'url',
    url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic', 'DINish Medium,Noto Sans Regular', 'DINish Bold,Noto Sans Regular']
  }
});
`;

/** Exercise a framework reference in its actual MapLibre canvas using the shared local fixture. */
export async function withFrameworkVitePage(
  options: Pick<FrameworkViteFixtureOptions, 'entry' | 'files' | 'framework' | 'plugins'>,
  run: (page: Page, origin: string) => Promise<void>,
): Promise<void> {
  const capturePackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const cwd = await mkdtemp(
    join(capturePackageRoot, `.tileflow-test-${options.framework}-runtime-`),
  );
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
  try {
    await symlink(
      join(capturePackageRoot, 'node_modules'),
      join(cwd, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const style = {
      version: 8,
      name: 'light',
      sources: {},
      layers: [{id: 'background', type: 'background', paint: {'background-color': '#eeeeee'}}],
      metadata: {
        'tileflow:overlay-placement-manifest': {
          schemaVersion: 1,
          anchors: {
            'above-water': null,
            'below-roads': null,
            'above-roads': null,
            'above-buildings': null,
            'below-labels': null,
            'above-labels': null,
          },
        },
      },
    };
    await writeFrameworkMapFixture(cwd, style);
    const manifest = {
      version: 1,
      maps: Object.fromEntries(
        ['main', 'other'].map((id) => [
          id,
          {
            defaultTheme: 'light',
            themes: {
              light: {colorScheme: 'light', styleUrl: './style.json', fontFaces: []},
              dark: {colorScheme: 'dark', styleUrl: './dark.json', fontFaces: []},
            },
          },
        ]),
      ),
    };
    await Promise.all([
      writeFile(
        join(cwd, 'index.html'),
        `<!doctype html><html><body><div id="root"></div><script type="module" src="/${options.entry}"></script></body></html>`,
      ),
      writeFile(join(cwd, 'public/tileflow-fixture/manifest.json'), JSON.stringify(manifest)),
      writeFile(
        join(cwd, 'public/tileflow-fixture/dark.json'),
        JSON.stringify({
          ...style,
          name: 'dark',
          layers: [{id: 'background', type: 'background', paint: {'background-color': '#222222'}}],
        }),
      ),
      ...Object.entries(options.files).map(([file, source]) => writeFile(join(cwd, file), source)),
    ]);
    const source =
      options.framework === 'svelte'
        ? '../../svelte/src/index.js'
        : `../../${options.framework}/src/index.ts`;
    vite = await createViteServer({
      cacheDir: join(cwd, '.vite-cache'),
      configFile: false,
      logLevel: 'silent',
      plugins: options.plugins,
      root: cwd,
      resolve: {
        alias: {
          [`@tileflow/${options.framework}`]: fileURLToPath(new URL(source, import.meta.url)),
        },
      },
      server: {host: '127.0.0.1', port: 0, watch: null},
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    browser = await launchTileflowCaptureBrowser({allowInstall: false});
    const page = await browser.newPage({viewport: {width: 360, height: 280}});
    await run(page, `http://127.0.0.1:${address.port}`);
  } finally {
    await browser?.close();
    await vite?.close();
    await rm(cwd, {force: true, recursive: true});
  }
}
