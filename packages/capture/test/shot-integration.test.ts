import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {sha256Hex} from '@tileflow/core';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {createTileflowCaptureSession} from '../src/capture';
import {parseTileflowShotReceipt, serializeTileflowShotReceipt} from '../src/receipt';
import type {TileflowShotFrame} from '../src/shot';
import {readPngDimensions} from '../src/standalone';
import {tileflowWebmElementIds as id} from '../src/webm';
import {child, children, readEbml, readSimpleBlock, readString, readUnsigned} from './webm-reader';

test(
  'renders a blended half-second shot to identical frames and a WebM video',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'tileflow-shot-browser-'));
    await linkWorkspacePackages(cwd);
    const server = createServer((request, response) => {
      const path = request.url?.split('?')[0] ?? '/';
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (path.endsWith('.pbf')) {
        response.writeHead(200, {'Content-Type': 'application/x-protobuf'});
        response.end(Buffer.alloc(0));
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const session = createTileflowCaptureSession({allowBrowserInstall: false, cwd});

    try {
      await writeFile(
        join(cwd, 'tileflow.config.ts'),
        `import {defineMap} from '@tileflow/core';
import {streetsIcons, streetsThemes} from '@tileflow/maps';

export default defineMap({
  id: 'proof',
  version: 1,
  defaultTheme: 'light',
  themes: streetsThemes,
  icons: [streetsIcons],
  glyphs: {
    kind: 'url',
    url: ${JSON.stringify(`${origin}/glyphs/{fontstack}/{range}.pbf`)},
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  data: {
    type: 'vector-tiles',
    attribution: 'Tileflow exact fixture',
    revision: 'fixture_1',
    schema: {type: 'openmaptiles', contractVersion: 1},
    tiles: [${JSON.stringify(`${origin}/tiles/world/{z}/{x}/{y}.pbf`)}],
    minzoom: 0,
    maxzoom: 14,
    bounds: [-180, -85, 180, 85]
  },
  shots: {
    dusk: {
      theme: 'light',
      viewport: {width: 64, height: 64},
      keyframes: [
        {
          at: 0,
          camera: {type: 'center', center: [0, 0], zoom: 1},
          blend: {themes: ['light', 'dark'], position: 0}
        },
        {
          at: 500,
          camera: {type: 'center', center: [10, 10], zoom: 2, bearing: 20},
          blend: {themes: ['light', 'dark'], position: 1}
        }
      ]
    }
  }
});\n`,
      );

      const frames: TileflowShotFrame[] = [];
      const framesCapture = await session.captureShot('dusk', {
        format: 'frames',
        onFrame: (frame) => {
          frames.push(frame);
        },
      });
      const video = await session.captureShot('dusk');

      assert.equal(framesCapture.frameCount, 16);
      assert.equal(frames.length, 16);
      assert.deepEqual(
        frames.map((frame) => frame.index),
        Array.from({length: 16}, (_, index) => index),
      );
      for (const frame of frames) {
        assert.deepEqual(readPngDimensions(frame.png), {height: 64, width: 64});
        assert.equal(frame.sha256, await sha256Hex(frame.png));
      }
      assert.notEqual(frames[0]!.sha256, frames[15]!.sha256);
      assert.equal(framesCapture.video, undefined);
      assert.equal(framesCapture.sha256, framesCapture.framesSha256);
      assert.equal(framesCapture.networkDependent, false);
      assert.deepEqual(framesCapture.warnings, []);

      // Each frame waits for its own readiness, so two renders produce the same pixels.
      assert.deepEqual(video.frameSha256s, framesCapture.frameSha256s);
      assert.equal(video.framesSha256, framesCapture.framesSha256);
      assert.equal(video.format, 'webm');
      assert.ok(video.video);
      assert.equal(video.sha256, await sha256Hex(video.video));
      assert.equal(video.receipt.output.kind, 'webm');
      assert.deepEqual(
        parseTileflowShotReceipt(serializeTileflowShotReceipt(video.receipt)),
        video.receipt,
      );
      assert.deepEqual(
        framesCapture.receipt.blend?.themes.map((theme) => theme.name),
        ['light', 'dark'],
      );

      const segment = readEbml(video.video)[1]!;
      const track = child(child(segment, id.tracks), id.trackEntry);
      assert.equal(readString(child(track, id.codecId)), video.codec === 'vp9' ? 'V_VP9' : 'V_VP8');
      assert.equal(readUnsigned(child(child(track, id.video), id.pixelWidth)), 64);
      const blocks = children(segment, id.cluster).flatMap((cluster) =>
        children(cluster, id.simpleBlock).map(readSimpleBlock),
      );
      assert.equal(blocks.length, 16);
      assert.equal(blocks[0]!.key, true);

      // The pinned browser plays and seeks the video it encoded.
      const playback = await playWebm(video.video);
      assert.equal(playback.width, 64);
      assert.equal(playback.height, 64);
      assert.ok(Math.abs(playback.duration - 16 / 30) < 0.001);
      assert.ok(Math.abs(playback.seekableEnd - 16 / 30) < 0.001);
    } finally {
      await session.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

async function playWebm(video: Uint8Array): Promise<{
  duration: number;
  height: number;
  seekableEnd: number;
  width: number;
}> {
  const browser = await launchTileflowCaptureBrowser({allowInstall: false});
  try {
    const context = await browser.newContext();
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === 'https://tileflow.local.invalid/player.html') {
        await route.fulfill({
          body: '<!doctype html><video muted></video>',
          contentType: 'text/html',
        });
      } else if (url === 'https://tileflow.local.invalid/shot.webm') {
        await route.fulfill({body: Buffer.from(video), contentType: 'video/webm'});
      } else {
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    await page.goto('https://tileflow.local.invalid/player.html');
    return await page.evaluate(async () => {
      const element = document.querySelector('video')!;
      const blob = await (await fetch('/shot.webm')).blob();
      element.src = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        element.onloadedmetadata = resolve;
        element.onerror = () => reject(new Error(element.error?.message ?? 'playback failed'));
      });
      element.currentTime = element.duration / 2;
      await new Promise((resolve) => {
        element.onseeked = resolve;
      });
      return {
        duration: element.duration,
        height: element.videoHeight,
        seekableEnd: element.seekable.end(0),
        width: element.videoWidth,
      };
    });
  } finally {
    await browser.close();
  }
}
