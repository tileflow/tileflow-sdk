import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMobileManifest} from '../src/manifest';

const mapId = 'map_0123456789abcdef';
const base = `https://api.tileflow.test/maps/${mapId}`;
const source = {map: 'map', manifestUrl: `${base}/mobile/manifest.json`, discoveryMapId: mapId};
const profileUrl = `${base}/mobile/webview-v1/manifest.json`;
const discovery = {
  version: 1,
  mapId,
  deploymentVersion: 3,
  representations: {'webview-v1': {manifestUrl: profileUrl}},
};
const manifest = (version = 3) => ({
  version: 1,
  maps: {
    map: {
      mapId,
      defaultTheme: 'day',
      themes: {
        day: {colorScheme: 'light', styleUrl: `${base}/mobile/webview-v1/v${version}/day.json`},
      },
    },
  },
});

test('Hosted loads discovery then only the selected profile; self-hosted stays a direct manifest', async () => {
  const calls: string[] = [];
  const fetchResource = (async (url) => {
    calls.push(String(url));
    return Response.json(String(url) === source.manifestUrl ? discovery : manifest());
  }) as typeof fetch;
  assert.ok(await loadMobileManifest(source, fetchResource, new AbortController().signal));
  assert.deepEqual(calls, [source.manifestUrl, profileUrl]);
  calls.length = 0;
  await loadMobileManifest(
    {map: 'map', manifestUrl: profileUrl},
    fetchResource,
    new AbortController().signal,
  );
  assert.deepEqual(calls, [profileUrl]);
});

test('discovery rejects oversized bodies, missing profiles and deployment races before style loading', async () => {
  for (const value of [
    ' '.repeat(4097),
    {...discovery, representations: {'native-v1': {manifestUrl: `${base}/native/manifest.json`}}},
    {...discovery, mapId: 'map_1111111111111111'},
  ]) {
    let calls = 0;
    await assert.rejects(
      loadMobileManifest(
        source,
        (async () => {
          calls++;
          return typeof value === 'string' ? new Response(value) : Response.json(value);
        }) as typeof fetch,
        new AbortController().signal,
      ),
    );
    assert.equal(calls, 1);
  }
  const calls: string[] = [];
  await assert.rejects(
    loadMobileManifest(
      source,
      (async (url) => {
        calls.push(String(url));
        return Response.json(String(url) === source.manifestUrl ? discovery : manifest(4));
      }) as typeof fetch,
      new AbortController().signal,
    ),
    /deployment changed/u,
  );
  assert.deepEqual(calls, [source.manifestUrl, profileUrl]);
});
