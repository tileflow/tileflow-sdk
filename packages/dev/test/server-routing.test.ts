import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTileflowRequestPath,
  getTileflowStyleInspectionSelection,
  getTileflowStyleSelection,
  isTileflowRequestUrl,
} from '../src/server';

const ownedPaths = [
  '/',
  '/build-manifest.json',
  '/manifest.json',
  '/generations/abc/styles/main/light.json',
  '/icons/main/sprite.png',
  '/styles/main/light.json',
  '/fonts/family/font.woff2',
  '/__runtime/maplibre-gl.js',
  '/__events',
  '/__inspection/main/light.json',
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
    ['/style.json', ''],
    ['/styles/main.json', ''],
    ['/styles/main/light/extra.json', ''],
    ['/styles/main/../dark.json', ''],
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

test('parses only concrete portable map/theme style routes', () => {
  assert.deepEqual(getTileflowStyleSelection('/styles/main/dark.json'), {
    mapName: 'main',
    themeName: 'dark',
  });
  for (const path of [
    '/styles/main.json',
    '/styles/Main/dark.json',
    '/styles/main/Dark.json',
    '/styles/main/system.json',
    '/styles/con/dark.json',
    '/styles/constructor/dark.json',
    '/styles/main/con.json',
    '/styles/main/../dark.json',
    '/styles/main/dark/extra.json',
  ]) {
    assert.equal(getTileflowStyleSelection(path), undefined, path);
  }
});

test('parses only concrete portable compiler-inspection routes', () => {
  assert.deepEqual(getTileflowStyleInspectionSelection('/__inspection/main/dark.json'), {
    mapName: 'main',
    themeName: 'dark',
  });
  for (const path of [
    '/__inspection/main.json',
    '/__inspection/Main/dark.json',
    '/__inspection/main/system.json',
    '/__inspection/con/dark.json',
    '/__inspection/main/con.json',
    '/__inspection/main/../dark.json',
    '/__inspection/main/dark/extra.json',
  ]) {
    assert.equal(getTileflowStyleInspectionSelection(path), undefined, path);
  }
});
