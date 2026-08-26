import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';
import {launchTileflowCaptureBrowser} from '../src/browser';

type SemanticProof = {
  diagnostics: string[];
  events: Array<{
    bindingId?: string;
    category?: string;
    domain?: string;
    featureId?: number | string;
    hasPhysicalLayerId: boolean;
    inputModality?: string;
    name?: unknown;
    targetKind: string;
    type: string;
  }>;
  popupCommitState?: string | null;
  states: unknown[];
};

test(
  'opens a semantic POI popup from a real MapLibre GeoJSON hit test',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () => {
    const capturePackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-test-react-semantic-vite-'));
    const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));
    let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

    try {
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
      ]);

      vite = await createViteServer({
        configFile: false,
        logLevel: 'silent',
        resolve: {alias: {'@tileflow/react': reactSource}},
        root: cwd,
        server: {
          host: '127.0.0.1',
          port: 0,
          watch: {usePolling: process.platform === 'win32'},
        },
      });
      await vite.listen();
      const address = vite.httpServer?.address();
      assert.ok(address && typeof address === 'object');
      const appOrigin = `http://127.0.0.1:${address.port}`;

      browser = await launchTileflowCaptureBrowser({allowInstall: false});
      const page = await browser.newPage({viewport: {height: 480, width: 640}});
      const browserErrors: string[] = [];
      const remoteOrigins = new Set<string>();
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('request', (request) => {
        const url = new URL(request.url());
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== appOrigin) {
          remoteOrigins.add(url.origin);
        }
      });

      const response = await page.goto(appOrigin, {waitUntil: 'domcontentloaded'});
      assert.equal(response?.status(), 200);
      const map = page.locator('[data-tileflow-capture-id="semantic-poi"]');
      await map.waitFor({state: 'visible'});
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-tileflow-capture-id="semantic-poi"]')
            ?.getAttribute('data-tileflow-state') === 'idle',
      );
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 1);

      const nativeHit = await page.evaluate(() => {
        const nativeMap = (window as typeof window & {__tileflowSemanticMap: MapLibreMap})
          .__tileflowSemanticMap;
        const point = nativeMap.project([0, 0]);
        return {
          features: nativeMap
            .queryRenderedFeatures(point, {layers: ['semantic-poi-layer']})
            .map((feature) => ({
              id: feature.id,
              layerId: feature.layer.id,
              name: feature.properties.name,
              source: feature.source,
              sourceLayer: feature.sourceLayer ?? null,
            })),
          point: {x: point.x, y: point.y},
        };
      });
      assert.deepEqual(nativeHit.features, [
        {
          id: 42,
          layerId: 'semantic-poi-layer',
          name: 'Café Browser',
          source: 'semantic-pois',
          sourceLayer: null,
        },
      ]);

      const bounds = await map.boundingBox();
      assert.ok(bounds);
      const featurePoint = {
        x: bounds.x + nativeHit.point.x,
        y: bounds.y + nativeHit.point.y,
      };
      await page.mouse.move(featurePoint.x, featurePoint.y);
      await page.waitForFunction(
        () =>
          (
            window as typeof window & {__tileflowSemanticProof?: SemanticProof}
          ).__tileflowSemanticProof?.events.some(({type}) => type === 'target:enter'),
        undefined,
        {timeout: 5_000},
      );
      const hoverProof = await page.evaluate(
        () =>
          (window as typeof window & {__tileflowSemanticProof: SemanticProof})
            .__tileflowSemanticProof,
      );
      assert.ok(hoverProof.events.some(({type}) => type === 'target:enter'));
      await page.mouse.click(featurePoint.x, featurePoint.y);

      const popup = page.locator('[data-tileflow-semantic-popup-proof]');
      await popup.waitFor({state: 'visible'});
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-tileflow-capture-id="semantic-poi"]')
            ?.getAttribute('data-tileflow-state') === 'idle',
      );
      assert.equal(await popup.textContent(), 'Tileflow semantic popup ready: Café Browser (42)');
      assert.equal(await popup.getAttribute('data-feature-id'), '42');

      const proof = await page.evaluate(
        () =>
          (window as typeof window & {__tileflowSemanticProof: SemanticProof})
            .__tileflowSemanticProof,
      );
      assert.equal(proof.popupCommitState, 'loading');
      assert.deepEqual(
        proof.events.map(({type}) => type),
        ['target:enter', 'target:activate', 'popup:open'],
      );
      for (const event of proof.events) {
        assert.deepEqual(
          {
            bindingId: event.bindingId,
            category: event.category,
            domain: event.domain,
            featureId: event.featureId,
            hasPhysicalLayerId: event.hasPhysicalLayerId,
            name: event.name,
            targetKind: event.targetKind,
          },
          {
            bindingId: 'semantic-poi-popup',
            category: 'food',
            domain: 'poi',
            featureId: 42,
            hasPhysicalLayerId: false,
            name: 'Café Browser',
            targetKind: 'semantic-feature',
          },
        );
      }
      assert.ok(proof.events.every(({inputModality}) => inputModality === 'pointer'));
      assert.deepEqual(proof.states, [
        {popup: {domain: 'poi', featureId: 42, kind: 'semantic-feature'}},
      ]);
      assert.deepEqual(proof.diagnostics, []);
      assert.deepEqual([...remoteOrigins], []);
      assert.deepEqual(browserErrors, []);
    } finally {
      await browser?.close();
      await vite?.close();
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

const applicationSource = `import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

const proof = window.__tileflowSemanticProof = {diagnostics: [], events: [], states: []};
const style = {
  version: 8,
  name: 'Tileflow semantic GeoJSON browser fixture',
  center: [0, 0],
  zoom: 3,
  metadata: {
    'tileflow:interaction-manifest': {
      domains: {
        poi: {
          deduplication: {
            identity: ['source', 'source-layer', 'feature-id'],
            representationPriority: ['marker', 'icon', 'combined', 'label']
          },
          fields: {class: 'class', name: 'name', rank: 'rank', subclass: 'subclass'},
          hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
          identity: 'maplibre-feature-id-if-present',
          layers: [{
            anchor: 'pointer-coordinate',
            category: 'food',
            layerId: 'semantic-poi-layer',
            priority: 10,
            representation: 'marker',
            source: 'semantic-pois'
          }]
        }
      },
      version: 1
    }
  },
  sources: {
    'semantic-pois': {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: 42,
          properties: {class: 'restaurant', name: 'Café Browser', rank: 1, subclass: 'cafe'},
          geometry: {type: 'Point', coordinates: [0, 0]}
        }]
      }
    }
  },
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#2468ac'}},
    {id: 'semantic-poi-layer', type: 'circle', source: 'semantic-pois', paint: {'circle-color': '#ffe100', 'circle-radius': 24, 'circle-stroke-color': '#111111', 'circle-stroke-width': 2}}
  ]
};
const interactions = [{
  id: 'semantic-poi-popup',
  popup: {content: {kind: 'view', name: 'semantic-poi-card'}},
  target: {categories: ['food'], domain: 'poi', kind: 'semantic-feature'}
}];

function SemanticPopup({context}) {
  useLayoutEffect(() => {
    proof.popupCommitState = document
      .querySelector('[data-tileflow-capture-id="semantic-poi"]')
      ?.getAttribute('data-tileflow-state');
  }, []);
  const target = context.target;
  if (target.kind !== 'semantic-feature') return null;
  return <article
    data-feature-id={String(target.feature.id)}
    data-tileflow-semantic-popup-proof
    style={{background: '#ff00cc', color: '#111', padding: 8, whiteSpace: 'nowrap'}}
  >Tileflow semantic popup ready: {String(target.feature.properties.name)} ({String(target.feature.id)})</article>;
}

function App() {
  return <div style={{width: 320}}><Map
    captureId="semantic-poi"
    height={240}
    interactions={interactions}
    onInteractionDiagnostic={(diagnostic) => proof.diagnostics.push(diagnostic.code)}
    onLoad={(map) => { window.__tileflowSemanticMap = map; }}
    onInteractionEvent={(event) => {
      const target = event.target;
      proof.events.push({
        bindingId: event.bindingId,
        category: target.kind === 'semantic-feature' ? target.feature.category : undefined,
        domain: target.kind === 'semantic-feature' ? target.domain : undefined,
        featureId: target.kind === 'semantic-feature' ? target.feature.id : undefined,
        hasPhysicalLayerId: Object.hasOwn(target, 'layerId'),
        inputModality: event.inputModality,
        name: target.kind === 'semantic-feature' ? target.feature.properties.name : undefined,
        targetKind: target.kind,
        type: event.type
      });
    }}
    onInteractionStateChange={(state) => proof.states.push(state)}
    renderPopup={(context) => <SemanticPopup context={context} />}
    source={{kind: 'maplibre', style}}
  /></div>;
}

const sheet = document.createElement('style');
sheet.textContent = 'html,body,#root{margin:0;width:100%;min-height:100%}';
document.head.append(sheet);
createRoot(document.getElementById('root')).render(<App />);
`;
