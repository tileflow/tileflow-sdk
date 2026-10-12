import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import type {Browser, BrowserContext, Locator, Page} from 'playwright';
import {
  type MapLibreStyle,
  normalizeTileflowCaptureShot,
  tileflowCaptureShotFrames,
} from '@tileflow/core';
import {selectTileflowCaptureShotNames} from '../src/capture';
import {TileflowCaptureError} from '../src/errors';
import {createTileflowCaptureRendererIdentity} from '../src/metadata';
import {
  createTileflowCaptureReceipt,
  createTileflowShotReceipt,
  parseTileflowShotReceipt,
  serializeTileflowShotReceipt,
  tileflowShotReceiptLimits,
  validateTileflowCaptureReceipt,
  validateTileflowShotReceipt,
} from '../src/receipt';
import {
  captureStandaloneTileflowShot,
  renderTileflowShot,
  type TileflowShotFrame,
  tileflowShotFramesSha256,
} from '../src/shot';
import {tileflowWebmElementIds as id} from '../src/webm';
import {child, children, readEbml, readSimpleBlock, readString} from './webm-reader';

type PhaseResult =
  {status: 'ok'} | {message?: string; reason: 'error' | 'timeout'; status: 'failed'};
type Step = {name: string; value: Record<string, unknown>};
type EncoderResult =
  | {codec?: 'vp8' | 'vp9'; message?: string; status: string}
  | {chunks: Array<{data: string; key: boolean; timestamp: number}>; status: 'ok'}
  | {message?: string; status: 'failed'};

const style: MapLibreStyle = {version: 8, name: 'Shot fixture', sources: {}, layers: []};
const styles = {dark: {...style, name: 'Dark fixture'}, light: style};
const data = {
  kind: 'vector-tiles',
  schema: 'openmaptiles',
  schemaVersion: 1,
  sourceId: 'tileflow',
} as const;

const shot = normalizeTileflowCaptureShot({
  map: 'proof',
  theme: 'light',
  viewport: {width: 64, height: 64},
  easing: 'linear',
  keyframes: [
    {at: 0, camera: {type: 'center', center: [0, 0], zoom: 1}},
    {at: 100, camera: {type: 'center', center: [10, 5], zoom: 3, bearing: 30, pitch: 20}},
  ],
});

const blendShot = normalizeTileflowCaptureShot({
  ...shot,
  keyframes: [
    {...shot.keyframes[0]!, blend: {themes: ['light', 'dark'], position: 0.25}},
    {...shot.keyframes[1]!, blend: {themes: ['light', 'dark'], position: 1}},
  ],
});

test('moves the camera with every frame and waits for each frame before its screenshot', async () => {
  const fake = createBrowser();
  const delivered: number[] = [];
  const output = await captureStandaloneTileflowShot({
    assets: [],
    browser: fake.browser,
    onFrame: ({index, png}) => {
      fake.log.push(`frame:${index}`);
      delivered.push(index);
      assert.equal(png[24], index);
    },
    shot,
    styles,
  });

  const frames = tileflowCaptureShotFrames(shot);
  assert.equal(frames.length, 4);
  assert.deepEqual(output, {
    frameCount: 4,
    height: 64,
    networkDependent: false,
    warnings: [],
    width: 64,
  });
  assert.deepEqual(fake.log, [
    'step:__tileflowCaptureLoad',
    ...frames.flatMap((frame) => [
      'step:__tileflowCaptureFrame',
      'screenshot',
      `frame:${frame.index}`,
    ]),
  ]);
  assert.deepEqual(delivered, [0, 1, 2, 3]);
  const frameSteps = fake.steps.filter((step) => step.name === '__tileflowCaptureFrame');
  assert.deepEqual(
    frameSteps.map((step) => step.value.camera),
    frames.map((frame) => frame.camera),
  );
  assert.ok(frameSteps.every((step) => step.value.blendPosition === undefined));
  assert.ok(frameSteps.every((step) => step.value.mapEventTimeoutMs === 29_000));
  const load = fake.steps[0]!.value as {style: MapLibreStyle & {transition?: unknown}};
  assert.deepEqual(load.style.transition, {delay: 0, duration: 0});
  assert.equal(fake.closedContexts(), 1);
});

test('prepares a theme blend once and moves its position with each frame', async () => {
  const fake = createBrowser();
  await captureStandaloneTileflowShot({
    assets: [],
    browser: fake.browser,
    onFrame: () => undefined,
    shot: blendShot,
    styles,
  });

  const frames = tileflowCaptureShotFrames(blendShot);
  assert.deepEqual(
    fake.steps.map((step) => step.name),
    [
      '__tileflowCaptureLoad',
      '__tileflowCapturePrepareBlend',
      ...frames.map(() => '__tileflowCaptureFrame'),
    ],
  );
  const prepare = fake.steps[1]!.value as {
    position: number;
    theme: string;
    themes: Array<{style: MapLibreStyle & {transition?: unknown}; theme: string}>;
  };
  assert.equal(prepare.theme, 'light');
  assert.equal(prepare.position, 0.25);
  assert.deepEqual(
    prepare.themes.map((theme) => [theme.theme, theme.style.name, theme.style.transition]),
    [
      ['light', 'Shot fixture', {delay: 0, duration: 0}],
      ['dark', 'Dark fixture', {delay: 0, duration: 0}],
    ],
  );
  assert.deepEqual(
    fake.steps.slice(2).map((step) => step.value.blendPosition),
    frames.map((frame) => frame.blendPosition),
  );
  assert.equal(frames.at(-1)!.blendPosition, 1);
});

test('page frames move the blend, jump the camera, and wait for idle and two animation frames', async () => {
  const fake = createBrowser();
  await captureStandaloneTileflowShot({
    assets: [],
    browser: fake.browser,
    onFrame: () => undefined,
    shot,
    styles,
  });
  const pageScript = fake.scripts.find((script) => script.includes('__tileflowCaptureFrame'));
  assert.ok(pageScript);

  const calls: string[] = [];
  let idle: (() => void) | undefined;
  const map = {
    jumpTo: (options: unknown) => calls.push(`jumpTo ${JSON.stringify(options)}`),
    off: () => undefined,
    on: () => undefined,
    once: (event: string, listener: () => void) => {
      calls.push(`once ${event}`);
      idle = listener;
    },
    triggerRepaint: () => calls.push('repaint'),
  };
  const window = {
    __tileflowCaptureStyle: style,
    __tileflowCreateThemeController: (options: {initial: {theme: string}}) => {
      calls.push(`controller ${options.initial.theme}`);
      return {
        dispose: () => calls.push('dispose'),
        setBlend: async (request: {position: number; themes: Array<{theme: string}>}) => {
          calls.push(`blend ${request.position} ${request.themes.map((theme) => theme.theme)}`);
          return {status: 'applied'};
        },
      };
    },
    __tileflowMap: map,
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => {
      calls.push('animation frame');
      setImmediate(callback);
      return 1;
    },
    setTimeout,
  } as Record<string, unknown>;
  runInNewContext(pageScript, {window});
  // Results come from another realm, so compare their JSON form.
  const run = async (name: string, input: unknown) =>
    JSON.parse(
      JSON.stringify(await (window[name] as (value: unknown) => Promise<unknown>)(input)),
    ) as unknown;

  assert.deepEqual(
    await run('__tileflowCapturePrepareBlend', {
      mapEventTimeoutMs: 1_000,
      position: 0.25,
      theme: 'light',
      themes: [
        {style, theme: 'light'},
        {style, theme: 'dark'},
      ],
    }),
    {status: 'ok'},
  );
  const frame = run('__tileflowCaptureFrame', {
    blendPosition: 0.5,
    camera: {type: 'center', center: [1, 2], zoom: 3, bearing: 4, pitch: 5},
    mapEventTimeoutMs: 1_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(idle);
  idle();
  assert.deepEqual(await frame, {status: 'ok'});
  assert.deepEqual(calls, [
    'controller light',
    'blend 0.25 light,dark',
    'blend 0.5 light,dark',
    'jumpTo {"bearing":4,"center":[1,2],"pitch":5,"zoom":3}',
    'repaint',
    'once idle',
    'animation frame',
    'animation frame',
  ]);

  calls.length = 0;
  assert.deepEqual(
    await run('__tileflowCaptureFrame', {
      camera: {type: 'center', center: [0, 0], zoom: 1, bearing: 0, pitch: 0},
      mapEventTimeoutMs: 10,
    }),
    {reason: 'timeout', status: 'failed'},
  );
  assert.deepEqual(calls, [
    'jumpTo {"bearing":0,"center":[0,0],"pitch":0,"zoom":1}',
    'repaint',
    'once idle',
  ]);
});

test('gives every frame the whole timeout budget', async () => {
  const fake = createBrowser({
    step: async () => {
      await delay(40);
      return {status: 'ok'};
    },
  });
  const output = await captureStandaloneTileflowShot({
    assets: [],
    browser: fake.browser,
    onFrame: () => delay(40),
    shot,
    styles,
    timeoutMs: 80,
  });
  assert.equal(output.frameCount, 4);
});

test('times out a frame that never becomes ready and keeps earlier frames', async () => {
  const fake = createBrowser({
    step: (step, index) =>
      step.name === '__tileflowCaptureFrame' && index === 3 ? new Promise(() => undefined) : ok(),
  });
  const delivered: number[] = [];
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: ({index}) => {
          delivered.push(index);
        },
        shot,
        styles,
        timeoutMs: 50,
      }),
    captureError('CAPTURE_TIMEOUT', 'map-idle'),
  );
  assert.deepEqual(delivered, [0, 1]);
  assert.equal(fake.closedContexts(), 1);
});

test('reports a frame that fails to become ready', async () => {
  const fake = createBrowser({
    step: (step, index) =>
      Promise.resolve(
        step.name === '__tileflowCaptureFrame' && index === 2
          ? {reason: 'error', status: 'failed'}
          : {status: 'ok'},
      ),
  });
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: () => undefined,
        shot,
        styles,
      }),
    captureError('MAP_LOAD_FAILED', 'map-idle'),
  );
  assert.equal(fake.log.filter((entry) => entry === 'screenshot').length, 1);
});

test('reports a theme blend that cannot be prepared', async () => {
  const fake = createBrowser({
    step: (step) =>
      Promise.resolve(
        step.name === '__tileflowCapturePrepareBlend'
          ? {
              message: 'Blended themes must use the same sources.',
              reason: 'error',
              status: 'failed',
            }
          : {status: 'ok'},
      ),
  });
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: () => undefined,
        shot: blendShot,
        styles,
      }),
    (error: unknown) => {
      captureError('MAP_LOAD_FAILED', 'theme-blend')(error);
      assert.match((error as Error).message, /theme blend.*same sources/u);
      return true;
    },
  );
});

test('stops between frames when the capture is aborted', async () => {
  const controller = new AbortController();
  const fake = createBrowser();
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: ({index}) => {
          if (index === 1) controller.abort();
        },
        shot,
        signal: controller.signal,
        styles,
      }),
    (error: unknown) => {
      assert.ok(error instanceof TileflowCaptureError);
      assert.equal(error.code, 'ABORTED');
      return true;
    },
  );
  assert.equal(fake.log.filter((entry) => entry === 'screenshot').length, 2);
});

test('passes a frame callback error through unchanged', async () => {
  const failure = new Error('disk full');
  const fake = createBrowser();
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: () => {
          throw failure;
        },
        shot,
        styles,
      }),
    (error: unknown) => error === failure,
  );
});

test('rejects a shot theme without a compiled style before opening a page', async () => {
  const fake = createBrowser();
  await assert.rejects(
    () =>
      captureStandaloneTileflowShot({
        assets: [],
        browser: fake.browser,
        onFrame: () => undefined,
        shot: blendShot,
        styles: {light: style},
      }),
    (error: unknown) => {
      assert.ok(error instanceof TileflowCaptureError);
      assert.equal(error.code, 'SHOT_NOT_FOUND');
      return true;
    },
  );
  assert.equal(fake.contexts.length, 0);
});

test('returns per-frame hashes and a frame-set receipt for the frames format', async () => {
  const fake = createBrowser();
  const frames: TileflowShotFrame[] = [];
  const capture = await renderTileflowShot({
    assets: [],
    browser: fake.browser,
    data,
    format: 'frames',
    name: 'fly-in',
    onFrame: (frame) => {
      frames.push(frame);
    },
    renderer: createTileflowCaptureRendererIdentity(),
    shot,
    styles,
  });

  const hashes = frames.map((frame) => sha256(frame.png));
  assert.deepEqual(
    frames.map((frame) => [frame.shot, frame.index, frame.sha256]),
    hashes.map((hash, index) => ['fly-in', index, hash]),
  );
  assert.deepEqual(capture.frameSha256s, hashes);
  assert.equal(capture.framesSha256, sha256(hashes.map((hash) => `${hash}\n`).join('')));
  assert.equal(capture.framesSha256, await tileflowShotFramesSha256(hashes));
  assert.equal(capture.sha256, capture.framesSha256);
  assert.equal(capture.video, undefined);
  assert.equal(capture.codec, undefined);
  assert.equal(capture.frameCount, 4);
  assert.equal(capture.durationMs, 100);
  assert.equal(capture.fps, 30);
  assert.deepEqual(capture.receipt.output, {kind: 'frames', sha256: capture.framesSha256});
  assert.equal(capture.receipt.shot.sha256, capture.shotSha256);
  assert.equal(capture.receipt.blend, undefined);
  assert.deepEqual(validateTileflowShotReceipt(capture.receipt), capture.receipt);
  assert.equal(fake.contexts.length, 1);
});

test('opens the encoder before rendering and muxes every frame into WebM', async () => {
  const fake = createBrowser();
  const capture = await renderTileflowShot({
    assets: [],
    browser: fake.browser,
    data,
    format: 'webm',
    name: 'fly-in',
    renderer: createTileflowCaptureRendererIdentity(),
    shot: blendShot,
    styles,
  });

  assert.deepEqual(
    fake.contexts.map((context) => context.kind),
    ['encoder', 'map'],
  );
  assert.equal(fake.encoderFrames.length, 4);
  assert.deepEqual(
    fake.encoderFrames.map((frame) => frame[24]),
    [0, 1, 2, 3],
  );
  assert.ok(capture.video);
  assert.equal(capture.codec, 'vp9');
  assert.equal(capture.sha256, sha256(capture.video));
  assert.deepEqual(capture.receipt.output, {codec: 'vp9', kind: 'webm', sha256: capture.sha256});
  assert.deepEqual(
    capture.receipt.blend?.themes.map((theme) => theme.name),
    ['light', 'dark'],
  );
  const segment = readEbml(capture.video)[1]!;
  assert.equal(
    readString(child(child(child(segment, id.tracks), id.trackEntry), id.codecId)),
    'V_VP9',
  );
  const blocks = children(segment, id.cluster).flatMap((cluster) =>
    children(cluster, id.simpleBlock).map(readSimpleBlock),
  );
  assert.deepEqual(
    blocks.map((block) => [...block.data]),
    [[0], [1], [2], [3]],
  );
  assert.equal(fake.closedContexts(), 2);
});

test('fails before rendering when the browser cannot encode video', async () => {
  const fake = createBrowser({encoderOpen: {status: 'unsupported'}});
  await assert.rejects(
    () =>
      renderTileflowShot({
        assets: [],
        browser: fake.browser,
        data,
        format: 'webm',
        name: 'fly-in',
        renderer: createTileflowCaptureRendererIdentity(),
        shot,
        styles,
      }),
    (error: unknown) => {
      captureError('VIDEO_ENCODER_UNAVAILABLE', 'video-encode')(error);
      assert.match((error as Error).message, /format "frames"/u);
      return true;
    },
  );
  assert.deepEqual(
    fake.contexts.map((context) => context.kind),
    ['encoder'],
  );
  assert.equal(fake.closedContexts(), 1);
});

test('reports an encoder failure with the video-encode phase', async () => {
  const fake = createBrowser({encodeFailure: 'Encoding error.'});
  await assert.rejects(
    () =>
      renderTileflowShot({
        assets: [],
        browser: fake.browser,
        data,
        format: 'webm',
        name: 'fly-in',
        renderer: createTileflowCaptureRendererIdentity(),
        shot,
        styles,
      }),
    captureError('VIDEO_ENCODE_FAILED', 'video-encode'),
  );
  assert.equal(fake.closedContexts(), 2);
});

test('shot receipts are canonical, bounded, and self-consistent', () => {
  const receipt = createTileflowShotReceipt(receiptInput());
  const serialized = serializeTileflowShotReceipt(receipt);

  assert.ok(
    new TextEncoder().encode(serialized).byteLength < tileflowShotReceiptLimits.maximumBytes,
  );
  assert.deepEqual(parseTileflowShotReceipt(serialized), receipt);
  assert.equal(serializeTileflowShotReceipt(parseTileflowShotReceipt(serialized)), serialized);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'blend',
    'data',
    'frames',
    'image',
    'kind',
    'networkDependent',
    'output',
    'platform',
    'renderer',
    'schemaVersion',
    'shot',
    'style',
    'timing',
    'verification',
  ]);
  assert.doesNotMatch(serialized, /time"|user|\/Users\/|"cwd"|"path"/u);
  assert.throws(() => parseTileflowShotReceipt(JSON.stringify(receipt, null, 2)), /canonical/u);
  assert.throws(
    () => validateTileflowCaptureReceipt(receipt),
    (error: unknown) => error instanceof TileflowCaptureError && error.code === 'BASELINE_INVALID',
  );

  const stillReceipt = createTileflowCaptureReceipt({
    data,
    dpr: 1,
    height: 64,
    map: 'proof',
    networkDependent: false,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'proof',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map',
    theme: 'light',
    width: 64,
  });
  const invalid: unknown[] = [
    stillReceipt,
    {...receipt, kind: 'scene'},
    {...receipt, schemaVersion: 2},
    {...receipt, recordedAt: '2026-01-01'},
    {...receipt, timing: {...receipt.timing, frameCount: 5}},
    {...receipt, timing: {...receipt.timing, fps: 29}},
    {...receipt, image: {...receipt.image, physicalWidth: 65}},
    {...receipt, output: {kind: 'frames', sha256: 'a'.repeat(64)}},
    {...receipt, output: {kind: 'webm', codec: 'h264', sha256: 'a'.repeat(64)}},
    {...receipt, output: {kind: 'gif', sha256: 'a'.repeat(64)}},
    {...receipt, blend: {themes: [{name: 'light', styleSha256: 'a'.repeat(64)}]}},
    {
      ...receipt,
      blend: {
        themes: [
          {name: 'light', styleSha256: 'a'.repeat(64)},
          {name: 'light', styleSha256: 'b'.repeat(64)},
        ],
      },
    },
    {...receipt, blend: {themes: Object.assign([], {extra: true})}},
    {...receipt, verification: {data: 'expected-unverified', style: 'rendered'}},
    {...receipt, shot: {...receipt.shot, theme: 'system'}},
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateTileflowShotReceipt(value),
      (error: unknown) =>
        error instanceof TileflowCaptureError && error.code === 'BASELINE_INVALID',
    );
  }
});

test('selects committed shots by sorted unique name and lists the available ones', () => {
  const artifacts = {
    project: {
      maps: {},
      shots: {
        'fly-in': {...shot, map: 'proof'},
        dusk: {...blendShot, map: 'proof'},
      },
    },
  } as unknown as Parameters<typeof selectTileflowCaptureShotNames>[0];

  assert.deepEqual(selectTileflowCaptureShotNames(artifacts, ['fly-in', 'dusk', 'fly-in']), [
    'dusk',
    'fly-in',
  ]);
  assert.throws(
    () => selectTileflowCaptureShotNames(artifacts, ['orbit']),
    /Unknown Tileflow capture shot "orbit". Available shots: dusk, fly-in\./u,
  );
  assert.throws(() => selectTileflowCaptureShotNames(artifacts, []), /at least one capture shot/u);
  assert.throws(
    () => selectTileflowCaptureShotNames({project: {maps: {}}} as never, ['dusk']),
    /defines no capture shots/u,
  );
});

function receiptInput(): Parameters<typeof createTileflowShotReceipt>[0] {
  return {
    blend: [
      {name: 'light', styleSha256: 'b'.repeat(64)},
      {name: 'dark', styleSha256: 'c'.repeat(64)},
    ],
    data,
    dpr: 1,
    durationMs: 100,
    fps: 30,
    frameCount: 4,
    framesSha256: 'd'.repeat(64),
    height: 64,
    map: 'proof',
    networkDependent: false,
    output: {codec: 'vp9', kind: 'webm', sha256: 'e'.repeat(64)},
    renderer: createTileflowCaptureRendererIdentity(),
    shot: 'fly-in',
    shotSha256: 'f'.repeat(64),
    styleSha256: 'b'.repeat(64),
    theme: 'light',
    width: 64,
  };
}

function createBrowser(
  options: {
    encodeFailure?: string;
    encoderOpen?: EncoderResult;
    step?: (step: Step, index: number) => Promise<PhaseResult>;
  } = {},
) {
  const log: string[] = [];
  const scripts: string[] = [];
  const steps: Step[] = [];
  const encoderFrames: Uint8Array[] = [];
  const contexts: Array<{closed: boolean; kind: 'encoder' | 'map'}> = [];

  const createContext = (kind: 'encoder' | 'map'): BrowserContext => {
    const state = {closed: false, kind};
    contexts.push(state);
    const pending = new Set<(error: Error) => void>();
    const track = <T>(promise: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (state.closed) {
          reject(new Error('Target page, context or browser has been closed'));
          return;
        }
        pending.add(reject);
        promise.then(resolve, reject).finally(() => pending.delete(reject));
      });
    let route: ((route: unknown) => Promise<void>) | undefined;
    let screenshots = 0;
    let encoded = 0;

    const page = {
      addScriptTag: async ({content}: {content?: string}) => {
        if (content) scripts.push(content);
      },
      addStyleTag: async () => undefined,
      evaluate: (_function: unknown, argument: unknown) => {
        if (kind === 'map') {
          const step = argument as Step;
          steps.push(step);
          log.push(`step:${step.name}`);
          return track(options.step?.(step, steps.length - 1) ?? ok());
        }
        if (argument && typeof argument === 'object') {
          return track(Promise.resolve(options.encoderOpen ?? {codec: 'vp9', status: 'ok'}));
        }
        if (typeof argument === 'number') {
          return track(
            (async () => {
              let png: Uint8Array | undefined;
              await route?.({
                abort: async () => undefined,
                fulfill: async ({body}: {body: Buffer}) => {
                  png = new Uint8Array(body);
                },
                request: () => ({
                  url: () => 'https://tileflow.local.invalid/__tileflow/shot-frame.png',
                }),
              });
              assert.ok(png);
              encoderFrames.push(png);
              if (options.encodeFailure) return {message: options.encodeFailure, status: 'failed'};
              const index = encoded++;
              return {
                chunks: [
                  {
                    data: Buffer.from([index]).toString('base64'),
                    key: index === 0,
                    timestamp: Math.round((argument * 1e6) / 30),
                  },
                ],
                status: 'ok',
              };
            })(),
          );
        }
        return track(Promise.resolve({chunks: [], status: 'ok'}));
      },
      goto: async () => undefined,
      locator: () =>
        ({
          screenshot: async () => {
            log.push('screenshot');
            const png = new Uint8Array(25);
            png.set(pngHeader(64, 64));
            png[24] = screenshots++;
            return Buffer.from(png);
          },
        }) as unknown as Locator,
      on: () => page,
      setDefaultTimeout: () => undefined,
      waitForFunction: async () => undefined,
    } as unknown as Page;

    return {
      close: async () => {
        state.closed = true;
        for (const reject of pending)
          reject(new Error('Target page, context or browser has been closed'));
      },
      newPage: async () => page,
      route: async (_pattern: unknown, handler: (route: unknown) => Promise<void>) => {
        route = handler;
      },
      routeWebSocket: async () => undefined,
    } as unknown as BrowserContext;
  };

  const browser = {
    newContext: async (contextOptions: {deviceScaleFactor?: number}) =>
      createContext(contextOptions.deviceScaleFactor === undefined ? 'encoder' : 'map'),
  } as unknown as Browser;

  return {
    browser,
    closedContexts: () => contexts.filter((context) => context.closed).length,
    contexts,
    encoderFrames,
    log,
    scripts,
    steps,
  };
}

function ok(): Promise<PhaseResult> {
  return Promise.resolve({status: 'ok'});
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureError(code: string, phase: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof TileflowCaptureError);
    assert.equal(error.code, code);
    assert.equal(error.details?.phase, phase);
    return true;
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}
