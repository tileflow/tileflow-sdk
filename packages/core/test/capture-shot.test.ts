import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineMap,
  normalizeTileflowCaptureShot,
  parseTileflowMap,
  type TileflowCaptureShot,
  tileflowCaptureShotFrameCount,
  tileflowCaptureShotFrames,
  tileflowCaptureShotLimits,
  tileflowCaptureShotSchemaVersion,
  type TileflowMapShot,
  validateTileflowMap,
} from '../src/index';
import {testLightTheme} from './map-fixture';

const captureRoot = defineMap({
  id: 'shot-root',
  version: 1,
  defaultTheme: 'light',
  glyphs: {
    kind: 'url',
    url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
  },
  themes: {light: testLightTheme, dark: testLightTheme},
});

const map = defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: captureRoot,
  shots: {
    'dusk-flyover': {
      theme: 'light',
      viewport: {width: 1_280, height: 720},
      keyframes: [
        {
          at: 0,
          camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
          blend: {themes: ['light', 'dark'], position: 0},
        },
        {
          at: 4_000,
          camera: {type: 'center', center: [-3.69, 40.42], zoom: 14, bearing: 30, pitch: 45},
          blend: {themes: ['light', 'dark'], position: 1},
        },
      ],
    },
  },
});

const line = (overrides: Partial<TileflowMapShot> = {}): TileflowMapShot => ({
  theme: 'light',
  viewport: {width: 320, height: 200},
  keyframes: [
    {at: 0, camera: {type: 'center', center: [0, 0], zoom: 2}},
    {at: 1_000, camera: {type: 'center', center: [10, 0], zoom: 4}},
  ],
  ...overrides,
});

test('singular maps own timed shots without repeating their map id', () => {
  assert.equal(tileflowCaptureShotSchemaVersion, 1);
  assert.deepEqual(tileflowCaptureShotLimits.fps, [24, 25, 30, 50, 60]);
  assert.deepEqual(validateTileflowMap(map), {valid: true, messages: []});

  const resolved = parseTileflowMap(map);
  assert.equal(resolved.id, 'madrid');
  assert.equal('shots' in resolved, false);

  assert.deepEqual(normalizeTileflowCaptureShot({...map.shots['dusk-flyover'], map: map.id}), {
    map: 'madrid',
    theme: 'light',
    viewport: {width: 1_280, height: 720, dpr: 1},
    fps: 30,
    easing: 'smooth',
    keyframes: [
      {
        at: 0,
        camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12, bearing: 0, pitch: 0},
        blend: {themes: ['light', 'dark'], position: 0},
      },
      {
        at: 4_000,
        camera: {type: 'center', center: [-3.69, 40.42], zoom: 14, bearing: 30, pitch: 45},
        blend: {themes: ['light', 'dark'], position: 1},
      },
    ],
  });
});

test('shot metadata is leaf-only and never inherited into a derived map', () => {
  const child = defineMap({id: 'child', version: 1, extends: map});
  assert.equal(parseTileflowMap(child).id, 'child');
  assert.equal('shots' in parseTileflowMap(child), false);
  assert.deepEqual(validateTileflowMap(child), {valid: true, messages: []});
});

test('rejects invalid shot themes, timing, blends, cameras, names, and map references', () => {
  const camera = {type: 'center' as const, center: [0, 0] as [number, number], zoom: 1};
  const cases: Array<[unknown, RegExp]> = [
    [{shots: {proof: line({theme: 'system'})}}, /shots\.proof\.theme/],
    [{shots: {proof: line({fps: 29 as never})}}, /shots\.proof\.fps/],
    [{shots: {proof: line({easing: 'bounce' as never})}}, /shots\.proof\.easing/],
    [{shots: {proof: line({viewport: {width: 4_096, height: 4_096, dpr: 2}})}}, /viewport/],
    [{shots: {proof: line({keyframes: [{at: 0, camera}]})}}, /shots\.proof\.keyframes/],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 10, camera},
              {at: 20, camera},
            ],
          }),
        },
      },
      /keyframes\.0\.at: Expected the first keyframe at 0 milliseconds/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera},
              {at: 500, camera},
              {at: 500, camera},
            ],
          }),
        },
      },
      /keyframes\.2\.at: Expected a time after the previous keyframe/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera},
              {at: 60_001, camera},
            ],
          }),
        },
      },
      /keyframes\.1\.at/,
    ],
    [
      {
        shots: {
          proof: line({
            fps: 60,
            keyframes: [
              {at: 0, camera},
              {at: 60_000, camera},
            ],
          }),
        },
      },
      /Expected at most 3600 frames; this shot renders 3601/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera: {type: 'bounds', bounds: [-1, -1, 1, 1]} as never},
              {at: 1_000, camera},
            ],
          }),
        },
      },
      /keyframes\.0\.camera/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera, blend: {themes: ['light', 'dark'], position: 0}},
              {at: 1_000, camera},
            ],
          }),
        },
      },
      /keyframes\.1\.blend: Expected a blend on every keyframe/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera, blend: {themes: ['light', 'dark'], position: 0}},
              {at: 1_000, camera, blend: {themes: ['dark', 'light'], position: 0}},
            ],
          }),
        },
      },
      /keyframes\.1\.blend\.themes: Expected the same themes/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera, blend: {themes: ['light', 'light'], position: 0}},
              {at: 1_000, camera, blend: {themes: ['light', 'light'], position: 0}},
            ],
          }),
        },
      },
      /blend\.themes: Expected distinct themes/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera, blend: {themes: ['light', 'dark'], position: 0}},
              {at: 1_000, camera, blend: {themes: ['light', 'dark'], position: 1.5}},
            ],
          }),
        },
      },
      /blend\.position: Expected a position from 0 to 1/,
    ],
    [
      {
        shots: {
          proof: line({
            keyframes: [
              {at: 0, camera, blend: {themes: ['light', 'system'], position: 0}},
              {at: 1_000, camera, blend: {themes: ['light', 'system'], position: 0}},
            ],
          }),
        },
      },
      /blend\.themes\.1/,
    ],
    [{shots: {CON: line()}}, /shots\.CON/],
    [{shots: {proof: {...line(), map: 'madrid'}}}, /shots\.proof\.map: Unrecognized key/],
    [{shots: {proof: {...line(), target: {kind: 'map'}}}}, /shots\.proof/],
    [{shots: Object.create({proof: line()})}, /shots: Expected a plain object/],
  ];

  for (const [overrides, expected] of cases) {
    const input = {...map, ...(overrides as object)};
    assert.equal(validateTileflowMap(input).valid, false);
    assert.throws(() => parseTileflowMap(input as never), expected);
  }
});

test('counts one frame at the start and one per frame interval up to the last keyframe', () => {
  const camera = {type: 'center' as const, center: [0, 0] as [number, number], zoom: 1};
  const shot = (at: number, fps?: TileflowCaptureShot['fps']) => ({
    ...(fps ? {fps} : {}),
    keyframes: [
      {at: 0, camera},
      {at, camera},
    ],
  });
  assert.equal(tileflowCaptureShotFrameCount(shot(500)), 16);
  assert.equal(tileflowCaptureShotFrameCount(shot(510)), 16);
  assert.equal(tileflowCaptureShotFrameCount(shot(1_000, 24)), 25);
  assert.equal(tileflowCaptureShotFrameCount(shot(1_000, 25)), 26);
  assert.equal(tileflowCaptureShotFrameCount(shot(60_000, 30)), 1_801);
  assert.equal(tileflowCaptureShotFrameCount(shot(59_983, 60)), 3_599);
  assert.equal(tileflowCaptureShotFrameCount(shot(60_000, 60)), 3_601);
});

test('interpolates centers in Web Mercator with linear zoom and pitch', () => {
  const frames = tileflowCaptureShotFrames({
    ...line({
      easing: 'linear',
      fps: 24,
      keyframes: [
        {at: 0, camera: {type: 'center', center: [0, 0], zoom: 2, pitch: 0}},
        {at: 1_000, camera: {type: 'center', center: [20, 60], zoom: 6, pitch: 60}},
      ],
    }),
    map: 'madrid',
  });

  assert.equal(frames.length, 25);
  assert.deepEqual(
    frames.map((frame) => frame.index),
    Array.from({length: 25}, (_, index) => index),
  );
  assert.equal(frames[0]!.at, 0);
  assert.equal(frames[24]!.at, 1_000);
  assert.deepEqual(frames[0]!.camera, {
    type: 'center',
    center: [0, 0],
    zoom: 2,
    bearing: 0,
    pitch: 0,
  });
  assert.deepEqual(frames[24]!.camera, {
    type: 'center',
    center: [20, 60],
    zoom: 6,
    bearing: 0,
    pitch: 60,
  });

  const middle = frames[12]!;
  assert.equal(middle.at, 500);
  assert.equal(middle.camera.zoom, 4);
  assert.equal(middle.camera.pitch, 30);
  assertClose(middle.camera.center[0], 10);
  // Halfway in Mercator y between the equator and 60°N lies north of 30°N.
  const mercatorY = (latitude: number) =>
    Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  assertClose(mercatorY(middle.camera.center[1]), mercatorY(60) / 2);
  assert.ok(middle.camera.center[1] > 30);
  assert.equal(
    frames.some((frame) => frame.blendPosition !== undefined),
    false,
  );
});

test('eases each segment smoothly by default and keeps keyframe cameras exact', () => {
  const frames = tileflowCaptureShotFrames(
    line({
      fps: 25,
      keyframes: [
        {at: 0, camera: {type: 'center', center: [0, 0], zoom: 0}},
        {at: 400, camera: {type: 'center', center: [0, 0], zoom: 8}},
        {at: 800, camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 8, bearing: 12}},
      ],
    }),
  );

  assert.equal(frames.length, 21);
  // 25 fps samples every 40 ms, a tenth of the first segment.
  assert.equal(frames[0]!.camera.zoom, 0);
  assertClose(frames[1]!.camera.zoom, 8 * smoothstep(0.1));
  assert.equal(frames[10]!.at, 400);
  assert.deepEqual(frames[10]!.camera, {
    type: 'center',
    center: [0, 0],
    zoom: 8,
    bearing: 0,
    pitch: 0,
  });
  assertClose(frames[15]!.camera.bearing, 12 * smoothstep(0.5));
  assert.deepEqual(frames[20]!.camera, {
    type: 'center',
    center: [-3.7038, 40.4168],
    zoom: 8,
    bearing: 12,
    pitch: 0,
  });
});

test('turns bearing and crosses the antimeridian along the shorter way', () => {
  const frames = tileflowCaptureShotFrames(
    line({
      easing: 'linear',
      fps: 24,
      keyframes: [
        {at: 0, camera: {type: 'center', center: [170, 10], zoom: 3, bearing: 170}},
        {at: 1_000, camera: {type: 'center', center: [-170, 10], zoom: 3, bearing: -170}},
      ],
    }),
  );
  const middle = frames[12]!;
  assertClose(Math.abs(middle.camera.center[0]), 180);
  assertClose(middle.camera.center[1], 10);
  assertClose(Math.abs(middle.camera.bearing), 180);
  const quarter = frames[6]!;
  assertClose(quarter.camera.center[0], 175);
  assertClose(quarter.camera.bearing, 175);
  const threeQuarters = frames[18]!;
  assertClose(threeQuarters.camera.center[0], -175);
  assertClose(threeQuarters.camera.bearing, -175);
  for (const frame of frames) {
    assert.ok(frame.camera.center[0] >= -180 && frame.camera.center[0] <= 180);
    assert.ok(frame.camera.bearing >= -180 && frame.camera.bearing <= 180);
  }
});

test('moves the blend position with the same easing as the camera', () => {
  const frames = tileflowCaptureShotFrames({...map.shots['dusk-flyover'], fps: 24});
  assert.equal(frames.length, 97);
  assert.equal(frames[0]!.blendPosition, 0);
  assertClose(frames[24]!.blendPosition!, smoothstep(0.25));
  assertClose(frames[48]!.blendPosition!, 0.5);
  assert.equal(frames[96]!.blendPosition, 1);
  for (let index = 1; index < frames.length; index += 1) {
    assert.ok(frames[index]!.blendPosition! >= frames[index - 1]!.blendPosition!);
  }
});

test('returns the same frames for the same shot', () => {
  const shot = map.shots['dusk-flyover'];
  assert.deepEqual(
    tileflowCaptureShotFrames(shot),
    tileflowCaptureShotFrames(structuredClone(shot)),
  );
  assert.throws(() => tileflowCaptureShotFrames({...shot, keyframes: []}), /keyframes/);
});

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function assertClose(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}
