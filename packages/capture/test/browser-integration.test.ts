import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {PNG} from 'pngjs';
import type {MapLibreStyle, NormalizedTileflowCaptureScene} from '@tileflow/core';
import {createTileflowBuildArtifacts, type TileflowBuildAsset} from '@tileflow/dev/artifacts';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {
  captureStandaloneTileflowScene,
  readPngDimensions,
  tileflowSyntheticAssetOrigin,
} from '../src/standalone';

test(
  'renders local sprite and package-font pixels through one headless Browser without a listener',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    fontSourceReads = 0;
    const originalListen = Server.prototype.listen;
    let listenAttempts = 0;
    Server.prototype.listen = function forbiddenListen() {
      listenAttempts += 1;
      throw new Error('Capture opened a forbidden HTTP listener.');
    };
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});

    try {
      const first = await captureStandaloneTileflowScene({
        assets,
        browser,
        scene,
        style,
      });
      const second = await captureStandaloneTileflowScene({
        assets,
        browser,
        scene,
        style,
      });
      const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

      assert.equal(hash(first.png), hash(second.png));
      assert.equal(first.networkDependent, false);
      assert.deepEqual(first.warnings, []);
      assert.equal(listenAttempts, 0);
      assert.equal(fontSourceReads, 2, 'each capture routes the synthetic TTF before map creation');
      assert.deepEqual([...first.png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      Server.prototype.listen = originalListen;
      await browser.close();
    }
  },
);

test(
  'renders validated compiler-generated roads twice against loopback vector fixtures',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 30_000},
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-generated-browser-'));
    await linkWorkspacePackages(cwd);
    let origin = '';
    const requests = new Set<string>();
    const server = createServer((request, response) => {
      const path = request.url?.split('?')[0] ?? '/';
      requests.add(path);
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (path.endsWith('.pbf')) {
        response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
        response.end(Buffer.alloc(0));
        return;
      }
      if (path.endsWith('/sprite.json') || path.endsWith('/sprite@2x.json')) {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end('{}');
        return;
      }
      if (path.endsWith('/sprite.png') || path.endsWith('/sprite@2x.png')) {
        response.writeHead(200, {'Content-Type': 'image/png'});
        response.end(transparentPng);
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    origin = `http://127.0.0.1:${address.port}`;
    let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;

    try {
      await writeFile(
        join(cwd, 'tileflow.config.ts'),
        `import {defineRootMap} from '@tileflow/core';
import {streetsIcons} from '@tileflow/maps';

export default defineRootMap({
      id: 'proof',
      version: 1,
      root: {compiler: 'streets', compilerVersion: 1},
      icons: [streetsIcons],
      glyphs: {
        kind: 'url',
        url: ${JSON.stringify(`${origin}/glyphs/{fontstack}/{range}.pbf`)},
        fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
      },
      data: {
        type: 'vector-tiles',
        attribution: 'Tileflow exact fixture',
        revision: 'fixture_1',
        schema: {type: 'openmaptiles', contractVersion: 1},
        tiles: [${JSON.stringify(`${origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
        minzoom: 0,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85]
      },
      modules: {roads: {
        type: 'roads', detail: 'all', hierarchy: 'clear', outline: 'strong', weight: 'regular',
        extras: {paths: true}
      }}
});\n`,
      );
      const artifacts = await createTileflowBuildArtifacts({
        apiBaseUrl: origin,
        assetBaseUrl: tileflowSyntheticAssetOrigin,
        cwd,
      });
      const generatedStyle = artifacts.styles.proof;
      assert.ok(generatedStyle);
      assert.ok(
        generatedStyle.layers.some((layer) => layer.id === 'streets-road-surface-primary-casing'),
      );
      assert.ok(
        generatedStyle.layers.some((layer) => layer.id === 'streets-road-bridge-primary-fill'),
      );
      browser = await launchTileflowCaptureBrowser({allowInstall: false});
      const first = await captureStandaloneTileflowScene({
        assets: artifacts.assets,
        browser,
        scene: generatedScene,
        style: generatedStyle,
      });
      const second = await captureStandaloneTileflowScene({
        assets: artifacts.assets,
        browser,
        scene: generatedScene,
        style: generatedStyle,
      });
      const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

      assert.equal(hash(first.png), hash(second.png));
      assert.deepEqual(readPngDimensions(first.png), {height: 256, width: 256});
      assert.equal(first.networkDependent, false);
      assert.deepEqual(first.warnings, []);
      assert.equal(requests.has('/tiles/world/tiles.json'), false);
      assert.equal(
        [...requests].some((path) => path.endsWith('.pbf')),
        true,
      );
    } finally {
      await browser?.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

test(
  'renders compiler-generated contours twice through the packaged browser protocol',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-contour-browser-'));
    await linkWorkspacePackages(cwd);
    const requests = new Set<string>();
    const server = createServer((request, response) => {
      const path = request.url?.split('?')[0] ?? '/';
      requests.add(path);
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (path.startsWith('/dem/') && path.endsWith('.png')) {
        response.writeHead(200, {'Content-Type': 'image/png'});
        response.end(flatTerrariumPng);
        return;
      }
      if (path.endsWith('.pbf')) {
        response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
        response.end(Buffer.alloc(0));
        return;
      }
      if (path.endsWith('/sprite.json') || path.endsWith('/sprite@2x.json')) {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end('{}');
        return;
      }
      if (path.endsWith('/sprite.png') || path.endsWith('/sprite@2x.png')) {
        response.writeHead(200, {'Content-Type': 'image/png'});
        response.end(transparentPng);
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;

    try {
      await writeFile(
        join(cwd, 'tileflow.config.ts'),
        `import {defineRootMap} from '@tileflow/core';
import {streetsIcons} from '@tileflow/maps';

export default defineRootMap({
  id: 'proof',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  icons: [streetsIcons],
  glyphs: {
    kind: 'url',
    url: ${JSON.stringify(`${origin}/glyphs/{fontstack}/{range}.pbf`)},
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  data: {
    type: 'vector-tiles',
    attribution: 'Tileflow exact fixture',
    revision: 'fixture_1',
    schema: {type: 'openmaptiles', contractVersion: 1},
    tiles: [${JSON.stringify(`${origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
    minzoom: 0,
    maxzoom: 14,
    bounds: [-180, -85, 180, 85]
  },
  terrain: {
    mode: 'none',
    encoding: 'terrarium',
    contours: {
      demMaxZoom: 1,
      demUrl: ${JSON.stringify(`${origin}/dem/{z}/{x}/{y}.png`)},
      maxZoom: 1,
      minZoom: 0,
      thresholds: {0: [250, 500], 1: [250, 500]}
    }
  }
});\n`,
      );
      const artifacts = await createTileflowBuildArtifacts({
        apiBaseUrl: origin,
        assetBaseUrl: tileflowSyntheticAssetOrigin,
        cwd,
      });
      const generatedStyle = artifacts.styles.proof;
      assert.ok(generatedStyle);
      assert.equal(generatedStyle.sources['tileflow-contours']?.type, 'vector');
      assert.ok(
        generatedStyle.layers.some((layer) => layer.id === 'streets-terrain-contour-minor'),
      );
      browser = await launchTileflowCaptureBrowser({allowInstall: false});
      const first = await captureStandaloneTileflowScene({
        assets: artifacts.assets,
        browser,
        scene: generatedScene,
        style: generatedStyle,
      });
      const second = await captureStandaloneTileflowScene({
        assets: artifacts.assets,
        browser,
        scene: generatedScene,
        style: generatedStyle,
      });
      const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

      assert.equal(hash(first.png), hash(second.png));
      assert.deepEqual(readPngDimensions(first.png), {height: 256, width: 256});
      assert.equal(first.networkDependent, false);
      assert.deepEqual(first.warnings, []);
      assert.equal(
        [...requests].some((path) => path.startsWith('/dem/') && path.endsWith('.png')),
        true,
      );
    } finally {
      await browser?.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

const scene: NormalizedTileflowCaptureScene = {
  map: 'proof',
  camera: {
    type: 'center',
    center: [0, 0],
    zoom: 1,
    bearing: 0,
    pitch: 0,
  },
  viewport: {width: 64, height: 64, dpr: 1},
  target: {kind: 'map'},
};

const generatedScene: NormalizedTileflowCaptureScene = {
  map: 'proof',
  camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
  viewport: {width: 256, height: 256, dpr: 1},
  target: {kind: 'map'},
};

const style: MapLibreStyle = {
  version: 8,
  name: 'Capture integration fixture',
  metadata: {
    'tileflow:fontFaces': [
      {
        family: 'Oxanium Medium',
        source: `${tileflowSyntheticAssetOrigin}/fonts/oxanium/oxanium-medium.ttf`,
        weight: '500',
      },
    ],
  },
  sprite: `${tileflowSyntheticAssetOrigin}/icons/proof/sprite`,
  sources: {
    marker: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {label: 'Tileflow'},
            geometry: {type: 'Point', coordinates: [0, 0]},
          },
        ],
      },
    },
  },
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#F6F7F3'}},
    {
      id: 'marker',
      type: 'symbol',
      source: 'marker',
      layout: {
        'icon-allow-overlap': true,
        'icon-image': 'marker',
        'text-field': ['get', 'label'],
        'text-font': ['Oxanium Medium'],
        'text-offset': [0, 1.5],
      },
    },
  ],
};

let fontSourceReads = 0;
const oxaniumMedium = readFileSync(
  new URL('../../maps/assets/cyberpunk/fonts/Oxanium-Medium.ttf', import.meta.url),
);

const assets: TileflowBuildAsset[] = [
  {
    contentType: 'font/ttf',
    fileName: 'fonts/oxanium/oxanium-medium.ttf',
    get source() {
      fontSourceReads += 1;
      return oxaniumMedium;
    },
  },
  {
    contentType: 'application/json; charset=utf-8',
    fileName: 'icons/proof/sprite.json',
    source: JSON.stringify({marker: {height: 2, pixelRatio: 1, width: 2, x: 0, y: 0}}),
  },
  {
    contentType: 'image/png',
    fileName: 'icons/proof/sprite.png',
    source: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=',
      'base64',
    ),
  },
];

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=',
  'base64',
);

const flatTerrariumImage = new PNG({height: 256, width: 256});
for (let offset = 0; offset < flatTerrariumImage.data.length; offset += 4) {
  flatTerrariumImage.data[offset] = 128;
  flatTerrariumImage.data[offset + 1] = 0;
  flatTerrariumImage.data[offset + 2] = 0;
  flatTerrariumImage.data[offset + 3] = 255;
}
const flatTerrariumPng = PNG.sync.write(flatTerrariumImage, {
  colorType: 6,
  filterType: 4,
  inputColorType: 6,
});
