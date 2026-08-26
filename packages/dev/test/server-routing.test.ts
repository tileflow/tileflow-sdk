import assert from 'node:assert/strict';
import test from 'node:test';
import {getTileflowRequestPath, isTileflowRequestUrl} from '../src/server';

const ownedPaths = [
  '/',
  '/build-manifest.json',
  '/manifest.json',
  '/style.json',
  '/generations/abc/styles/main.json',
  '/icons/main/sprite.png',
  '/styles/main.json',
  '/fonts/family/font.woff2',
  '/__runtime/maplibre-gl.js',
  '/__events',
  '/__status',
] as const;

test('matches the same complete route table at root and under a base path', () => {
  for (const basePath of ['', '/tileflow']) {
    for (const path of ownedPaths) {
      const route = `${basePath}${path === '/' ? '' : path}`;
      const url = `${route || '/'}?cache=1`;
      assert.equal(isTileflowRequestUrl(url, basePath), true, `${basePath || '<root>'}: ${path}`);
      assert.equal(getTileflowRequestPath(url, basePath), path);
    }
  }
});

test('does not claim application paths or prefix-confusable routes', () => {
  const cases = [
    ['/application', ''],
    ['/font/file.woff2', ''],
    ['/fonts', ''],
    ['/__runtime', ''],
    ['/__events/extra', ''],
    ['/tileflow-evil/manifest.json', '/tileflow'],
    ['/tileflowish/styles/main.json', '/tileflow'],
    ['/other/tileflow/manifest.json', '/tileflow'],
  ] as const;

  for (const [url, basePath] of cases) {
    assert.equal(isTileflowRequestUrl(url, basePath), false, `${basePath || '<root>'}: ${url}`);
    assert.equal(getTileflowRequestPath(url, basePath), null);
  }
});
