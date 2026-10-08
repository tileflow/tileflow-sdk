import assert from 'node:assert/strict';
import {lstat, mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  createTileflowLineBackgroundFontStack,
  deriveTileflowLineBackgroundGlyphs,
  type MapLibreStyle,
} from '@tileflow/core';
import {
  createTileflowLineBackgroundGlyphResponder,
  parseTileflowLineBackgroundGlyphPath,
  prepareTileflowLineBackgroundGlyphs,
} from '../src/line-background-glyphs';

const upstream = 'https://glyphs.example.test/fonts/{fontstack}/{range}.pbf';
const backedStack = createTileflowLineBackgroundFontStack('Noto Sans Bold', {letterSpacing: 0.08});

function style(fonts: string[], glyphs = upstream): MapLibreStyle {
  return {
    glyphs,
    layers: [
      {
        id: 'label',
        layout: {'text-field': 'Label', 'text-font': fonts},
        source: 's',
        type: 'symbol',
      },
    ],
    name: 'fixture',
    sources: {},
    version: 8,
  };
}

// One glyph range: a single 1x1 glyph whose bitmap carries the 3px border.
function sourceRange(): Uint8Array {
  const glyph = [
    0x08,
    0x41, // id 65
    0x12,
    0x31,
    ...new Array(49).fill(0), // bitmap (1 + 6)^2 bytes
    0x18,
    0x01, // width 1
    0x20,
    0x01, // height 1
    0x28,
    0x00, // left 0
    0x30,
    0x11, // top -9
    0x38,
    0x0a, // advance 10
  ];
  const name = [...new TextEncoder().encode('Noto Sans Bold')];
  const range = [...new TextEncoder().encode('0-255')];
  const stack = [
    0x0a,
    name.length,
    ...name,
    0x12,
    range.length,
    ...range,
    0x1a,
    glyph.length,
    ...glyph,
  ];
  return Uint8Array.from([0x0a, stack.length, ...stack]);
}

test('only maps that draw derived stacks are routed through the local glyph provider', () => {
  const prepared = prepareTileflowLineBackgroundGlyphs(
    {
      backed: {light: style([backedStack]), night: style([backedStack])},
      plain: {light: style(['Noto Sans Bold'])},
      relative: {light: style([backedStack], '/fonts/{fontstack}/{range}.pbf')},
    },
    {assetBaseUrl: 'http://127.0.0.1:3333/tileflow'},
  );

  assert.deepEqual(prepared.providers, {backed: upstream});
  assert.equal(
    prepared.styles.backed!.night!.glyphs,
    'http://127.0.0.1:3333/tileflow/__glyphs/backed/{fontstack}/{range}.pbf',
  );
  assert.equal(prepared.styles.plain!.light!.glyphs, upstream);
  assert.equal(prepared.styles.relative!.light!.glyphs, '/fonts/{fontstack}/{range}.pbf');

  const relativeBase = prepareTileflowLineBackgroundGlyphs(
    {backed: {light: style([backedStack])}},
    {assetBaseUrl: './tileflow'},
  );
  assert.deepEqual(relativeBase.providers, {});
});

test('glyph route paths are bounded and decoded once', () => {
  assert.deepEqual(
    parseTileflowLineBackgroundGlyphPath(
      `/__glyphs/main/${encodeURIComponent(backedStack)}/0-255.pbf`,
    ),
    {fontStack: backedStack, mapName: 'main', range: '0-255'},
  );
  for (const path of [
    '/__glyphs/main/Noto%20Sans%20Bold/0-255',
    '/__glyphs/main/Noto%2FSans/0-255.pbf',
    '/__glyphs/../Noto%20Sans%20Bold/0-255.pbf',
    '/__glyphs/main/Noto%20Sans%20Bold/0-255x.pbf',
    '/__glyphs/main/%E0%A4%A/0-255.pbf',
  ]) {
    assert.equal(parseTileflowLineBackgroundGlyphPath(path), undefined, path);
  }
});

test('the responder passes ordinary stacks through and derives backed stacks from their source', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-glyphs-'));
  const requests: Array<{init: RequestInit | undefined; url: string}> = [];
  const respond = createTileflowLineBackgroundGlyphResponder({
    cwd,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({init, url});
      if (url.includes('Missing')) return new Response(null, {status: 404});
      return new Response(sourceRange(), {headers: {'Content-Type': 'application/x-protobuf'}});
    },
  });

  try {
    const plain = await respond(upstream, 'Noto Sans Bold', '0-255');
    assert.equal(plain.status, 200);
    assert.deepEqual(new Uint8Array(await plain.arrayBuffer()), sourceRange());

    const backed = await respond(upstream, backedStack, '0-255');
    assert.equal(backed.status, 200);
    assert.equal(backed.headers.get('content-type'), 'application/x-protobuf');
    assert.deepEqual(
      new Uint8Array(await backed.arrayBuffer()),
      deriveTileflowLineBackgroundGlyphs(sourceRange(), {letterSpacing: 0.08}),
    );

    // The derived range reused the cached source range: one upstream request in total.
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]!.url,
      'https://glyphs.example.test/fonts/Noto%20Sans%20Bold/0-255.pbf',
    );
    assert.equal(requests[0]!.init?.redirect, 'error');
    assert.equal(requests[0]!.init?.credentials, 'omit');

    assert.equal((await respond(upstream, 'Missing Sans', '0-255')).status, 404);
    assert.equal((await respond(upstream, `Noto Sans Bold,${backedStack}`, '0-255')).status, 404);
    assert.equal(
      (await respond('/relative/{fontstack}/{range}.pbf', backedStack, '0-255')).status,
      404,
    );

    const cacheRoot = join(cwd, '.tileflow', 'cache', 'glyphs', 'v1');
    const [provider] = await readdir(cacheRoot);
    assert.ok((await lstat(join(cacheRoot, provider!))).isDirectory());
    assert.equal(
      (await readdir(join(cacheRoot, provider!))).filter((name) => name.endsWith('.pbf')).length,
      1,
    );

    // A fresh responder serves the cached source range without the network.
    const offline = createTileflowLineBackgroundGlyphResponder({
      cwd,
      fetch: async () => {
        throw new Error('network unavailable');
      },
    });
    assert.equal((await offline(upstream, backedStack, '0-255')).status, 200);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});
