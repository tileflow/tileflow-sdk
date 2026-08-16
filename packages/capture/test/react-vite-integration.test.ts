import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {Server} from 'node:http';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';
import {createTileflowCaptureSession} from '../src/index';

test(
  'captures React wrapper readiness at narrow and desktop sizes through one Vite server',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const capturePackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const cwd = await mkdtemp(join(capturePackageRoot, '.tileflow-test-react-vite-capture-'));
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
      resolve: {alias: {'@tileflow/react': reactSource}},
      root: cwd,
      server: {host: '127.0.0.1', port: 0},
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const appOrigin = `http://127.0.0.1:${address.port}`;
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
      const result = await session.capture(['desktop', 'image', 'narrow']);
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
        ],
      );
      assert.ok(result.captures.every((capture) => capture.networkDependent === false));
      assert.equal(additionalListeners, 0);
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

const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};

function App() {
  return <main>
    <div className="primary"><Map captureId="primary" height={180} map="main" style={style} /></div>
    <div className="secondary"><Map captureId="secondary" height={80} map="main" style={style} /></div>
    <div className="image"><Map captureId="image" height={80} imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=" map="main" mode="image" /></div>
  </main>;
}

const sheet = document.createElement('style');
sheet.textContent = 'html,body,#root{margin:0;width:100%;min-height:100%}.primary{width:calc(100vw - 20px);max-width:360px}.secondary{width:120px}.image{width:150px}';
document.head.append(sheet);
createRoot(document.getElementById('root')).render(<App />);
`;

const applicationConfig = `import {streets} from '@tileflow/core';
export default {
  maps: {main: {basemap: streets()}},
  scenes: {
    desktop: {
      map: 'main',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 640, height: 360},
      target: {kind: 'application', path: '/', captureId: 'primary'}
    },
    narrow: {
      map: 'main',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'primary'}
    },
    image: {
      map: 'main',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 480},
      target: {kind: 'application', path: '/', captureId: 'image'}
    }
  }
};
`;
