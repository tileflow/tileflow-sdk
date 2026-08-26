import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {Server} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {createServer as createViteServer, type PluginOption} from 'vite';
import {tileflow} from '@tileflow/vite';
import {createTileflowCaptureSession} from '../src/index';

type FrameworkViteFixtureOptions = {
  entry: string;
  files: Record<string, string>;
  framework: string;
  plugins: PluginOption[];
  popupProbeRgb: readonly [number, number, number];
};

export async function verifyFrameworkViteCapture(
  options: FrameworkViteFixtureOptions,
): Promise<void> {
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
    ...Object.entries(options.files).map(([file, source]) =>
      writeFile(join(cwd, file), source, 'utf8'),
    ),
  ]);

  const vite = await createViteServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [tileflow(), ...options.plugins],
    root: cwd,
    server: {host: '127.0.0.1', port: 0},
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  const appOrigin = `http://127.0.0.1:${address.port}`;
  const manifestResponse = await fetch(`${appOrigin}/tileflow/manifest.json`);
  const manifestBody = await manifestResponse.text();
  assert.equal(manifestResponse.status, 200, manifestBody);
  assert.equal((JSON.parse(manifestBody) as {version?: unknown}).version, 3);

  const originalListen = Server.prototype.listen;
  let additionalListeners = 0;
  Server.prototype.listen = function forbiddenAdditionalListener() {
    additionalListeners += 1;
    throw new Error('Application capture opened a second Node listener.');
  };
  const session = createTileflowCaptureSession({
    allowBrowserInstall: false,
    appOrigin,
    config: 'tileflow.config.ts',
    cwd,
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
  } finally {
    Server.prototype.listen = originalListen;
    await session.close();
    await vite.close();
    await rm(cwd, {force: true, recursive: true});
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

const applicationConfig = `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  scenes: {
    cleanup: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', selector: '#cleanup-proof'}
    },
    image: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'image'}
    },
    'missing-map': {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'missing-map'}
    },
    interactive: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'interactive'}
    },
    popup: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', selector: '[data-tileflow-popup-probe]'}
    },
    'unresolved-image': {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'unresolved-image'}
    }
  },
  glyphs: {
    kind: 'url',
    url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  }
});
`;
