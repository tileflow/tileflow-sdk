import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer, Server} from 'node:http';
import test from 'node:test';
import type {NormalizedTileflowCaptureScene} from '@tileflow/core';
import {captureApplicationTileflowScene} from '../src/application';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {TileflowCaptureError} from '../src/errors';
import {readPngDimensions} from '../src/standalone';

test(
  'captures one ready application target and the viewport through one existing loopback server',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(request.url?.startsWith('/error') ? errorHtml : applicationHtml);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const appOrigin = `http://127.0.0.1:${address.port}`;
    const originalListen = Server.prototype.listen;
    let extraListenAttempts = 0;
    Server.prototype.listen = function forbiddenExtraListener() {
      extraListenAttempts += 1;
      throw new Error('Application capture opened a second server.');
    };
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});

    try {
      const mapCapture = await captureApplicationTileflowScene({
        appOrigin,
        browser,
        scene: applicationScene({captureId: 'primary', frame: 'map'}),
      });
      assert.deepEqual(readPngDimensions(mapCapture.png), {height: 120, width: 240});
      assert.equal(mapCapture.width, 240);
      assert.equal(mapCapture.height, 120);
      assert.equal(mapCapture.networkDependent, false);

      const viewportCapture = await captureApplicationTileflowScene({
        appUrl: `${appOrigin}/proof?viewport=narrow`,
        browser,
        scene: applicationScene({captureId: 'secondary', frame: 'viewport'}),
      });
      assert.deepEqual(readPngDimensions(viewportCapture.png), {height: 240, width: 320});

      const selectorCapture = await captureApplicationTileflowScene({
        appOrigin,
        browser,
        scene: {
          ...applicationScene({frame: 'map'}),
          target: {
            kind: 'application',
            path: '/proof',
            selector: '.secondary',
            frame: 'map',
          },
        },
      });
      assert.deepEqual(readPngDimensions(selectorCapture.png), {height: 120, width: 240});
      assert.equal(extraListenAttempts, 0);

      await assert.rejects(
        () =>
          captureApplicationTileflowScene({
            appOrigin,
            browser,
            scene: applicationScene({frame: 'map'}),
          }),
        (error: unknown) =>
          error instanceof TileflowCaptureError && error.code === 'APPLICATION_TARGET_AMBIGUOUS',
      );
      await assert.rejects(
        () =>
          captureApplicationTileflowScene({
            appOrigin,
            browser,
            scene: {
              ...applicationScene({frame: 'map'}),
              target: {
                kind: 'application',
                path: '/error',
                captureId: 'broken',
                frame: 'map',
              },
            },
          }),
        (error: unknown) =>
          error instanceof TileflowCaptureError && error.code === 'APPLICATION_ERROR',
      );
      await assert.rejects(
        () =>
          captureApplicationTileflowScene({
            appOrigin,
            browser,
            scene: {
              ...applicationScene({frame: 'map'}),
              target: {
                kind: 'application',
                path: '/proof',
                captureId: 'missing',
                frame: 'map',
              },
            },
          }),
        (error: unknown) =>
          error instanceof TileflowCaptureError && error.code === 'APPLICATION_TARGET_NOT_FOUND',
      );
    } finally {
      Server.prototype.listen = originalListen;
      await browser.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  },
);

test(
  'rejects redirects away from the explicitly approved application origin',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const destination = createServer((_request, response) => {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        '<!doctype html><div style="width:120px;height:80px" data-tileflow-map="main" data-tileflow-capture-id="primary" data-tileflow-state="idle"></div>',
      );
    });
    destination.listen(0, '127.0.0.1');
    await once(destination, 'listening');
    const destinationAddress = destination.address();
    assert.ok(destinationAddress && typeof destinationAddress === 'object');

    const source = createServer((_request, response) => {
      response.writeHead(302, {
        location: `http://127.0.0.1:${destinationAddress.port}/escaped`,
      });
      response.end();
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const sourceAddress = source.address();
    assert.ok(sourceAddress && typeof sourceAddress === 'object');
    t.after(
      () =>
        new Promise<void>((resolveClose) =>
          source.close(() => destination.close(() => resolveClose())),
        ),
    );

    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    t.after(() => browser.close());
    await assert.rejects(
      () =>
        captureApplicationTileflowScene({
          appOrigin: `http://127.0.0.1:${sourceAddress.port}`,
          browser,
          scene: applicationScene({captureId: 'primary', frame: 'map'}),
        }),
      (error: unknown) =>
        error instanceof TileflowCaptureError && error.code === 'APPLICATION_NAVIGATION_FAILED',
    );
  },
);

function applicationScene(target: {
  captureId?: string;
  frame: 'map' | 'viewport';
}): NormalizedTileflowCaptureScene & {
  target: {
    kind: 'application';
    path: string;
    captureId?: string;
    frame: 'map' | 'viewport';
  };
} {
  return {
    map: 'main',
    camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
    viewport: {width: 320, height: 240, dpr: 1},
    target: {kind: 'application', path: '/proof', ...target},
  };
}

const applicationHtml = `<!doctype html>
<html>
  <head><style>html,body{margin:0;width:100%;height:100%}.map{width:240px;height:120px}.primary{background:#123456}.secondary{background:#abcdef}</style></head>
  <body>
    <div class="map primary" data-tileflow-map="main" data-tileflow-capture-id="primary" data-tileflow-state="loading"></div>
    <div class="map secondary" data-tileflow-map="main" data-tileflow-capture-id="secondary" data-tileflow-state="loading"></div>
    <script>requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('[data-tileflow-state]').forEach((element) => element.dataset.tileflowState = 'idle')));</script>
  </body>
</html>`;

const errorHtml = `<!doctype html><div style="width:200px;height:100px" data-tileflow-map="main" data-tileflow-capture-id="broken" data-tileflow-state="error"></div>`;
