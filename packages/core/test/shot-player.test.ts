import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowCaptureShotFrames} from '../src/capture-shot';
import {type TileflowShotMotion, tileflowShotStateAt} from '../src/capture-shot-motion';
import {playTileflowShot} from '../src/shot-player-browser';

const shot = {
  keyframes: [
    {
      at: 0,
      camera: {type: 'center', center: [-80.13, 25.78], zoom: 15, bearing: 0, pitch: 0},
      blend: {themes: ['day', 'night'], position: 0},
    },
    {
      at: 1000,
      camera: {type: 'center', center: [-80.12, 25.79], zoom: 13, bearing: 20, pitch: 40},
      blend: {themes: ['day', 'night'], position: 1},
    },
    {
      at: 2000,
      camera: {type: 'center', center: [-80.12, 25.79], zoom: 16, bearing: 20, pitch: 60},
      blend: {themes: ['day', 'night'], position: 1},
    },
  ],
} satisfies TileflowShotMotion;

test('the state at a time matches the frames Capture renders', () => {
  const frames = tileflowCaptureShotFrames({
    theme: 'day',
    viewport: {width: 64, height: 64},
    fps: 24,
    ...shot,
  });
  for (const frame of frames) {
    const state = tileflowShotStateAt(shot, frame.at);
    assert.deepEqual(state.camera, frame.camera);
    assert.equal(state.blendPosition, frame.blendPosition);
  }
  // A keyframe shows exactly; times outside the shot clamp to its ends.
  assert.equal(tileflowShotStateAt(shot, 1000).camera.zoom, 13);
  assert.equal(tileflowShotStateAt(shot, -50).camera.zoom, 15);
  assert.equal(tileflowShotStateAt(shot, 9000).camera.pitch, 60);
  assert.equal(tileflowShotStateAt({...shot, easing: 'linear'}, 500).camera.zoom, 14);
});

function clock(reducedMotion = false) {
  let now = 0;
  let frames: (() => void)[] = [];
  const view = {
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => {};
    },
    matchMedia: () => ({matches: reducedMotion}),
    performance: {now: () => now},
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  };
  return {
    canvas: {ownerDocument: {defaultView: view}},
    advance(ms: number) {
      now += ms;
      const due = frames;
      frames = [];
      for (const frame of due) frame();
    },
  };
}

function mapWith(canvas: unknown) {
  const moves: {zoom: number; pitch: number}[] = [];
  return {
    moves,
    getCanvas: () => canvas,
    jumpTo(camera: {zoom: number; pitch: number}) {
      moves.push({zoom: camera.zoom, pitch: camera.pitch});
    },
  };
}

test('a shot plays frame by frame, passes the blend on and runs cues once, in order', async () => {
  const time = clock();
  const map = mapWith(time.canvas);
  const blends: number[] = [];
  const ran: string[] = [];
  const playback = playTileflowShot(map, shot, {
    blend: (position) => blends.push(position),
    cues: [
      {at: 1500, run: () => ran.push('title')},
      {at: 400, run: () => ran.push('route')},
      {at: 400, run: () => ran.push('waypoint')},
    ],
  });
  assert.deepEqual(map.moves[0], {zoom: 15, pitch: 0});
  time.advance(500);
  assert.deepEqual(ran, ['route', 'waypoint']);
  assert.equal(playback.at, 500);
  time.advance(500);
  assert.equal(map.moves.at(-1)!.zoom, 13);
  assert.equal(blends.at(-1), 1);
  time.advance(1200);
  assert.equal(await playback.finished, true);
  assert.deepEqual(ran, ['route', 'waypoint', 'title']);
  assert.deepEqual(map.moves.at(-1), {zoom: 16, pitch: 60});
  const moves = map.moves.length;
  time.advance(100);
  assert.equal(map.moves.length, moves);
});

test('stopping or aborting leaves the camera where it is', async () => {
  const time = clock();
  const map = mapWith(time.canvas);
  const controller = new AbortController();
  const playback = playTileflowShot(map, shot, {signal: controller.signal});
  time.advance(300);
  controller.abort();
  assert.equal(await playback.finished, false);
  const moves = map.moves.length;
  time.advance(500);
  assert.equal(map.moves.length, moves);
  assert.equal(await playTileflowShot(map, shot, {signal: AbortSignal.abort()}).finished, false);
});

test('reduced motion or no browser window shows the last keyframe and runs every cue', async () => {
  for (const canvas of [clock(true).canvas, undefined]) {
    const map = mapWith(canvas);
    const ran: number[] = [];
    const playback = playTileflowShot(map, shot, {
      cues: [
        {at: 1800, run: () => ran.push(2)},
        {at: 100, run: () => ran.push(1)},
      ],
    });
    assert.equal(await playback.finished, true);
    assert.deepEqual(map.moves, [{zoom: 16, pitch: 60}]);
    assert.deepEqual(ran, [1, 2]);
  }
});

test('invalid shots and cues are refused', () => {
  const map = mapWith(undefined);
  assert.throws(() => playTileflowShot(map, {keyframes: [shot.keyframes[0]]}), /two keyframes/u);
  assert.throws(
    () => playTileflowShot(map, {keyframes: [{...shot.keyframes[0], at: 5}, shot.keyframes[1]]}),
    /keyframe at 0/u,
  );
  assert.throws(
    () => playTileflowShot(map, {keyframes: [shot.keyframes[1], shot.keyframes[0]]}),
    /keyframe at 0|rise strictly/u,
  );
  assert.throws(
    () => playTileflowShot(map, shot, {cues: [{at: Number.NaN, run: () => {}}]}),
    /Shot cues/u,
  );
});
