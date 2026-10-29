import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseTileflowMobileDiscovery} from '../../core/src/mobile-discovery';
import {parseNativeUrl as parseWithCoreParser} from '../../core/src/native-url-provider';
import {parseNativeUrl} from '../src/platform-url';

const urls = [
  'https://api.tileflow.test/maps/map_0123456789abcdef/mobile/manifest.json',
  'https://bücher.example.test/a.json',
  'https://ＭＡＰＳ.example.test:443/a.json',
  'https://faß.example.test/a',
  'https://é.example.test/a',
  'https://مثال.إختبار/a',
  'https://maps.example.test/﻿/😀?x=﻿💩',
  'https://127.1:443/a',
  'https://0x7f000001/a',
  'https://[0:0:0:0:0:0:0:1]:443/a',
  'https://m%61ps.example.test/a/%2e%2E/b?',
  'https://user:secret@maps.example.test/a#fragment',
  'https://maps.example.test./a?#',
  'http://127.0.0.1:18645/cached/manifest.json',
  'tileflow://resource/abc',
  'https://exa mple.test/a',
  'https://%00.example.test/a',
  'not a url',
];

const project = (parse: () => unknown) => {
  try {
    return parse();
  } catch {
    return 'invalid';
  }
};

test("the WebView's URL parser projects URLs as Core's private parser does", () => {
  for (const value of urls) {
    assert.deepEqual(
      project(() => parseNativeUrl(value)),
      project(() => parseWithCoreParser(value)),
      value,
    );
  }
  const base = 'https://maps.example.test/generations/a/styles/streets/light.json?old=1';
  for (const value of ['../../icons/sprite', '%2e%2e/%2E./glyphs/a.pbf', '?', '?v=😀', '#x']) {
    assert.deepEqual(parseNativeUrl(value, base), parseWithCoreParser(value, base), value);
  }
});

test("the runtime's discovery accepts and rejects exactly what Core's does", async () => {
  const require = createRequire(import.meta.url);
  const {build} = require('esbuild') as typeof import('esbuild');
  const platformUrl = fileURLToPath(new URL('../src/platform-url.ts', import.meta.url));
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../../core/src/mobile-discovery.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    plugins: [
      {
        name: 'platform-url',
        setup(builder) {
          builder.onResolve({filter: /^\.\/native-url-provider$/}, () => ({path: platformUrl}));
        },
      },
    ],
  });
  const runtime = (await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  )) as {parseTileflowMobileDiscovery: typeof parseTileflowMobileDiscovery};
  const base = 'https://api.tileflow.test/maps/map_0123456789abcdef';
  const discoveryUrl = `${base}/mobile/manifest.json`;
  const document = (manifestUrl: string) => ({
    version: 1,
    mapId: 'map_0123456789abcdef',
    deploymentVersion: 3,
    representations: {'webview-v1': {manifestUrl}},
  });
  const cases: [unknown, string][] = [
    [document(`${base}/mobile/webview-v1/manifest.json`), discoveryUrl],
    [document(`${base}/mobile/webview-v1/manifest.json`), `${discoveryUrl}?key=x`],
    [
      document(`${base}/mobile/webview-v1/manifest.json`),
      discoveryUrl.replace('/mobile/', '/%6dobile/'),
    ],
    [
      document(`${base}/mobile/webview-v1/manifest.json`),
      discoveryUrl.replace('api.', 'user@api.'),
    ],
    [document(`${base}/mobile/webview-v1/manifest.json`), discoveryUrl.replace('api.', 'API.')],
    [
      document(`${base}/mobile/webview-v1/manifest.json`),
      discoveryUrl.replace('.test/', '.test:443/'),
    ],
    [document(`${base}/mobile/webview-v1/manifest.json?key=x`), discoveryUrl],
    [document(`${base}/mobile/webview-v1/../webview-v1/manifest.json`), discoveryUrl],
    [document(`${base.replace('api.', 'foreign.')}/mobile/webview-v1/manifest.json`), discoveryUrl],
    [document(`${base}/native/manifest.json`), discoveryUrl],
  ];
  for (const [value, url] of cases) {
    assert.deepEqual(
      project(() => runtime.parseTileflowMobileDiscovery(value, url)),
      project(() => parseTileflowMobileDiscovery(value, url)),
      url,
    );
  }
  assert.notEqual(
    project(() => runtime.parseTileflowMobileDiscovery(...cases[0])),
    'invalid',
  );
});
