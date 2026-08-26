import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  joinTileflowPublicUrl,
  normalizeTileflowBasePath,
  resolveTileflowArtifactPublicUrls,
} from '../src/public-paths';

test('normalizes HTTP route bases without accepting filesystem traversal', () => {
  assert.equal(normalizeTileflowBasePath(), '');
  assert.equal(normalizeTileflowBasePath(''), '');
  assert.equal(normalizeTileflowBasePath('/'), '');
  assert.equal(normalizeTileflowBasePath('tileflow'), '/tileflow');
  assert.equal(normalizeTileflowBasePath('/app/tileflow/'), '/app/tileflow');

  for (const input of [
    '.',
    '..',
    '../tileflow',
    '/app/../tileflow',
    '/app/./tileflow',
    '/app//tileflow',
    '/app\\tileflow',
    '/app?tileflow',
    '/app#tileflow',
    '/%2e%2e/tileflow',
    '/%2fetc',
  ]) {
    assert.throws(() => normalizeTileflowBasePath(input), /Invalid Tileflow base path/u, input);
  }
});

test('joins public URL bases without converting valid relative references to root URLs', () => {
  const cases = [
    ['', '/maps', '/maps'],
    ['/', '/maps', '/maps'],
    ['/app/', '/maps', '/app/maps'],
    ['https://cdn.example.test/app/', '/maps', 'https://cdn.example.test/app/maps'],
    ['.', '/maps', './maps'],
    ['./', '/maps', './maps'],
    ['./assets/', '/maps', './assets/maps'],
    ['assets/', '/maps', './assets/maps'],
    ['..', '/maps', '../maps'],
    ['../', '/maps', '../maps'],
    ['../assets/', '/maps', '../assets/maps'],
  ] as const;

  for (const [publicBase, basePath, expected] of cases) {
    assert.equal(joinTileflowPublicUrl(publicBase, basePath), expected);
  }

  for (const input of [
    'https://user@example.test/app/',
    'https://example.test/app/?query=1',
    'https://example.test/app/#fragment',
    '//cdn.example.test/app/',
    'file:///tmp/app/',
    './assets\\private/',
  ]) {
    assert.throws(() => joinTileflowPublicUrl(input, '/maps'), /Invalid Tileflow public base/u);
  }
});

test('uses owner-relative artifact URLs for path-relative public deployments', () => {
  assert.deepEqual(resolveTileflowArtifactPublicUrls('/app/', '/maps'), {
    assetBaseUrl: '/app/maps',
    publicBaseUrl: '/app/maps',
    styleBaseUrl: '/app/maps',
  });
  assert.deepEqual(resolveTileflowArtifactPublicUrls('https://cdn.example.test/app/', '/maps'), {
    assetBaseUrl: 'https://cdn.example.test/app/maps',
    publicBaseUrl: 'https://cdn.example.test/app/maps',
    styleBaseUrl: 'https://cdn.example.test/app/maps',
  });

  for (const publicBase of ['.', './', '../', 'assets/', '../assets/']) {
    assert.deepEqual(resolveTileflowArtifactPublicUrls(publicBase, '/maps'), {
      publicBaseUrl: joinTileflowPublicUrl(publicBase, '/maps'),
      styleBaseUrl: '.',
    });
  }
});

test('keeps emitted asset names relative and traversal-free', () => {
  assert.equal(getTileflowAssetBasePath('/maps'), 'maps');
  assert.equal(getTileflowAssetBasePath(''), '');
  assert.equal(
    getTileflowAssetFileName('maps', 'generations/abc/style.json'),
    'maps/generations/abc/style.json',
  );
  assert.equal(getTileflowAssetFileName('', 'manifest.json'), 'manifest.json');

  for (const input of ['../maps', '/maps/../escape', '/maps//nested']) {
    assert.throws(() => getTileflowAssetBasePath(input), /Invalid Tileflow base path/u);
  }
  for (const input of ['../manifest.json', '/manifest.json', 'styles/../manifest.json', 'a\\b']) {
    assert.throws(
      () => getTileflowAssetFileName('maps', input),
      /Unsafe Tileflow asset file name/u,
    );
  }
});
