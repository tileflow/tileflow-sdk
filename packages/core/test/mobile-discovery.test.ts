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
