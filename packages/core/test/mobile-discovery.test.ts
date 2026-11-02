import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTileflowMobileDiscovery} from '../src/mobile-discovery';

const base = 'https://api.tileflow.test/maps/map_0123456789abcdef';
const url = `${base}/mobile/manifest.json`;
const fixture = () => ({
  version: 1,
  mapId: 'map_0123456789abcdef',
  deploymentVersion: 3,
  representations: {
    'webview-v1': {manifestUrl: `${base}/mobile/webview-v1/manifest.json`},
    'native-v1': {manifestUrl: `${base}/native/manifest.json`},
  },
});

test('mobile discovery preserves explicit profiles and freezes public selectors', () => {
  const result = parseTileflowMobileDiscovery(fixture(), url);
  assert.deepEqual(result, fixture());
  assert.ok(Object.isFrozen(result.representations['webview-v1']));
});

test('the native representation may name its family document and revision', () => {
  const family = {url: `${base}/native/family/v3.json`, revision: 'a'.repeat(64)};
  const discovery = fixture();
  const withFamily = {
    ...discovery,
    representations: {
      ...discovery.representations,
      'native-v1': {...discovery.representations['native-v1'], family},
    },
  };
  const result = parseTileflowMobileDiscovery(withFamily, url);
  assert.deepEqual(result.representations['native-v1']?.family, family);
  assert.ok(Object.isFrozen(result.representations['native-v1']?.family));
  for (const declared of [
    {...family, url: `${base}/native/family/v2.json`},
    {...family, url: `${base}/native/v3/family.json`},
    {...family, revision: 'A'.repeat(64)},
    {...family, revision: 'a'.repeat(63)},
    {...family, grant: 'secret'},
    family.url,
  ])
    assert.throws(() =>
      parseTileflowMobileDiscovery(
        {
          ...withFamily,
          representations: {
            ...withFamily.representations,
            'native-v1': {...withFamily.representations['native-v1'], family: declared},
          },
        },
        url,
      ),
    );
  assert.throws(() =>
    parseTileflowMobileDiscovery(
      {
        ...discovery,
        representations: {
          ...discovery.representations,
          'webview-v1': {...discovery.representations['webview-v1'], family},
        },
      },
      url,
    ),
  );
});

test('a local development API may serve discovery over loopback HTTP', () => {
  for (const origin of ['http://127.0.0.1:8787', 'http://localhost:8787']) {
    const local = `${origin}/maps/map_0123456789abcdef`;
    const discovery = {
      ...fixture(),
      representations: {'webview-v1': {manifestUrl: `${local}/mobile/webview-v1/manifest.json`}},
    };
    assert.equal(
      parseTileflowMobileDiscovery(discovery, `${local}/mobile/manifest.json`).representations[
        'webview-v1'
      ]?.manifestUrl,
      `${local}/mobile/webview-v1/manifest.json`,
    );
  }
  assert.throws(() =>
    parseTileflowMobileDiscovery(
      fixture(),
      'http://api.tileflow.test/maps/map_0123456789abcdef/mobile/manifest.json',
    ),
  );
});

test('mobile discovery rejects foreign authority, aliases, unsupported profiles and malformed versions', () => {
  for (const discoveryUrl of [
    url + '?key=x',
    url + '#x',
    url.replace('https:', 'http:'),
    url.replace('api.', 'user@api.'),
    url.replace('/mobile/', '/%6dobile/'),
  ]) {
    assert.throws(() => parseTileflowMobileDiscovery(fixture(), discoveryUrl));
  }
  for (const patch of [
    {version: 2},
    {deploymentVersion: 1.5},
    {deploymentVersion: 0},
    {deploymentVersion: Number.MAX_SAFE_INTEGER + 1},
    {mapId: 'map_1111111111111111'},
    {grant: 'secret'},
    {representations: {}},
    {representations: {'unknown-v1': {manifestUrl: url}}},
    {representations: {'webview-v1': {manifestUrl: `${base}/native/manifest.json`}}},
    {
      representations: {
        'webview-v1': {manifestUrl: `${base}/mobile/webview-v1/manifest.json?key=x`},
      },
    },
    {
      representations: {
        'webview-v1': {
          manifestUrl: `${base.replace('api.', 'foreign.')}/mobile/webview-v1/manifest.json`,
        },
      },
    },
  ])
    assert.throws(() => parseTileflowMobileDiscovery({...fixture(), ...patch}, url));
});
