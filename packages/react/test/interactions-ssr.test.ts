import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import test from 'node:test';

test('renders an explicit image-mode annotation diagnostic during SSR', async () => {
  const {Map} = await import('../dist/index.js');
  const html = renderToStaticMarkup(
    createElement(Map, {
      annotations: [
        {
          ariaLabel: 'Madrid',
          coordinate: [-3.7, 40.4],
          id: 'madrid',
          kind: 'marker',
        },
      ],
      imageUrl: 'https://cdn.example.test/madrid.png',
      mode: 'image',
      source: {
        kind: 'maplibre',
        style: {layers: [], sources: {}, version: 8},
      },
    }),
  );

  assert.match(html, /data-tileflow-state="error"/u);
  assert.match(html, /data-tileflow-interaction-diagnostic="UNSUPPORTED_MODE"/u);
  assert.match(html, /role="alert"/u);
  assert.match(html, /annotations require mode=&quot;interactive&quot;/u);
});

test('rejects semantic interactions visibly in image mode without evaluating MapLibre', async () => {
  const {Map} = await import('../dist/index.js');
  const html = renderToStaticMarkup(
    createElement(Map, {
      imageUrl: 'https://cdn.example.test/madrid.png',
      interactions: [
        {
          id: 'poi-card',
          popup: {content: {kind: 'view', name: 'poi-card'}},
          target: {domain: 'poi', kind: 'semantic-feature'},
        },
      ],
      mode: 'image',
      source: {
        kind: 'maplibre',
        style: {layers: [], sources: {}, version: 8},
      },
    }),
  );

  assert.match(html, /data-tileflow-state="error"/u);
  assert.match(html, /data-tileflow-interaction-diagnostic="UNSUPPORTED_MODE"/u);
  assert.match(html, /interactions require mode=&quot;interactive&quot;/u);
});

test('exposes a concrete requested theme to deterministic application capture', async () => {
  const {Map} = await import('../dist/index.js');
  const html = renderToStaticMarkup(
    createElement(Map, {
      imageUrl: 'https://cdn.example.test/madrid.png',
      mode: 'image',
      source: {kind: 'tileflow', map: 'madrid'},
      theme: 'dark',
    }),
  );
  assert.match(html, /data-tileflow-map="madrid"/u);
  assert.match(html, /data-tileflow-theme="dark"/u);
});

test('rejects a browser-only system selector on a direct StaticMap image', async () => {
  const {StaticMap} = await import('../dist/static.js');
  const html = renderToStaticMarkup(
    createElement(StaticMap, {
      camera: {type: 'center', center: [-3.7, 40.4], zoom: 12},
      imageUrl: 'https://cdn.example.test/madrid.png',
      map: 'madrid',
      size: {height: 400, width: 600},
      theme: 'system',
    }),
  );

  assert.match(html, /data-tileflow-state="error"/u);
  assert.doesNotMatch(html, /data-tileflow-theme=/u);
  assert.doesNotMatch(html, /<img/u);
});

test('forwards output format through direct StaticMap scene validation', async () => {
  const {StaticMap} = await import('../dist/static.js');
  const html = renderToStaticMarkup(
    createElement(StaticMap, {
      camera: {type: 'center', center: [-3.7, 40.4], zoom: 12},
      format: 'gif' as 'png',
      imageUrl: 'https://cdn.example.test/madrid.png',
      map: 'madrid',
      size: {height: 400, width: 600},
      theme: 'light',
    }),
  );

  assert.match(html, /data-tileflow-state="error"/u);
  assert.doesNotMatch(html, /<img/u);
});
