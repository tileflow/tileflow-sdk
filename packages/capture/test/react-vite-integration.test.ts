import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {Server} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';
import {tileflow} from '@tileflow/vite';
import {createTileflowCaptureSession} from '../src/index';
import {assertPngContainsProbeColor} from './framework-vite-harness';

test(
  'captures React wrapper readiness at narrow and desktop sizes through one Vite server',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const capturePackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-test-react-vite-capture-'));
    const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));
    await symlink(
      join(capturePackageRoot, 'node_modules'),
      join(cwd, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await Promise.all([
      writeFile(
        join(cwd, 'index.html'),
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
      ),
      writeFile(join(cwd, 'main.tsx'), applicationSource),
      writeFile(join(cwd, 'tileflow.config.ts'), applicationConfig),
    ]);
    const vite = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [tileflow()],
      resolve: {alias: {'@tileflow/react': reactSource}},
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
      const result = await session.capture(['desktop', 'image', 'narrow', 'popup']);
      assert.deepEqual(
        result.captures.map((capture) => ({
          height: capture.height,
          scene: capture.scene,
          target: capture.target,
          width: capture.width,
        })),
        [
          {height: 240, scene: 'desktop', target: 'application', width: 360},
          {height: 240, scene: 'image', target: 'application', width: 150},
          {height: 240, scene: 'narrow', target: 'application', width: 300},
          {height: 40, scene: 'popup', target: 'application', width: 168},
        ],
      );
      const desktopCapture = result.captures.find(({scene}) => scene === 'desktop');
      const popupCapture = result.captures.find(({scene}) => scene === 'popup');
      assert.ok(desktopCapture);
      assert.ok(popupCapture);
      assertPngContainsProbeColor(desktopCapture.png, [255, 0, 204], 'React desktop map');
      assertPngContainsProbeColor(popupCapture.png, [255, 0, 204], 'React popup selector');
      assert.ok(result.captures.every((capture) => capture.networkDependent === false));
      assert.equal(additionalListeners, 0);
      for (const scene of ['missing-map', 'unresolved-image']) {
        await assert.rejects(
          () => session.capture([scene]),
          (error: unknown) =>
            error instanceof Error && 'code' in error && error.code === 'APPLICATION_ERROR',
          `React ${scene} must become APPLICATION_ERROR`,
        );
      }
    } finally {
      Server.prototype.listen = originalListen;
      await session.close();
      await vite.close();
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

const applicationSource = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};
const popupAnnotations = [{
  ariaLabel: 'React browser popup proof',
  coordinate: [0, 0],
  id: 'react-browser-popup',
  kind: 'marker',
  popup: {content: {kind: 'view', name: 'browser-popup-proof'}}
}];
const defaultPopupState = {popup: {id: 'react-browser-popup', kind: 'annotation'}};

function App() {
  return <main>
    <div className="primary"><Map
      annotations={popupAnnotations}
      captureId="primary"
      defaultInteractionState={defaultPopupState}
      height={180}
      renderPopup={({annotation}) => <div
        data-tileflow-popup-probe="react"
        style={{background: '#ff00cc', boxSizing: 'border-box', color: '#111', font: '11px/16px sans-serif', height: 40, padding: '12px 8px', whiteSpace: 'nowrap', width: 168}}
      >Tileflow React popup ready: {annotation.id}</div>}
      source={{kind: 'maplibre', style}}
    /></div>
    <div className="secondary"><Map captureId="secondary" height={80} source={{kind: 'maplibre', style}} /></div>
    <div className="image"><Map captureId="image" height={80} imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=" mode="image" source={{kind: 'tileflow', map: 'main'}} /></div>
    <div className="image"><Map captureId="missing-map" height={80} source={{kind: 'tileflow', map: 'missing'}} /></div>
    <div className="image"><Map captureId="unresolved-image" height={80} mode="image" source={{kind: 'maplibre', style}} /></div>
  </main>;
}

const sheet = document.createElement('style');
sheet.textContent = 'html,body,#root{margin:0;width:100%;min-height:100%}.primary{width:calc(100vw - 20px);max-width:360px}.secondary{width:120px}.image{width:150px}';
document.head.append(sheet);
createRoot(document.getElementById('root')).render(<App />);
`;

const applicationConfig = `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'main',
  version: 1,
  extends: streets,
  scenes: {
    desktop: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 640, height: 360},
      target: {kind: 'application', path: '/', captureId: 'primary'}
    },
    narrow: {
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'primary'}
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
