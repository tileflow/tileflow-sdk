import assert from 'node:assert/strict';
import test from 'node:test';
import {createAnimations, isShotFrame, shotFrame, shotMotion} from '../src/animations';
import type {ShotRequest} from '../src/scene-contract';

const never = new AbortController().signal;
const keyframe = (at: number, blendPosition?: number) => ({
  at,
  camera: {longitude: 2, latitude: 41, zoom: 12 + at / 1000, bearing: 0, pitch: 0},
  ...(blendPosition === undefined ? {} : {blendPosition}),
});
const shot = (extra: Partial<ShotRequest> = {}): ShotRequest => ({
  keyframes: [keyframe(0), keyframe(2000)],
  easing: 'smooth',
  cues: [],
  ...extra,
});

function fixture() {
  const events: [string, unknown][] = [];
  const moving: boolean[] = [];
  const blends: number[] = [];
  const plays: {
    cues: readonly {at: number; run: () => void}[];
    blend?: (position: number) => void;
    signal: AbortSignal;
    finish: (finished: boolean) => void;
  }[] = [];
  const progress: {layers: readonly string[]; finish: (done: boolean) => void}[] = [];
  const stopped: (readonly string[])[] = [];
  const animations = createAnimations({
    emit: (event, produce) => void events.push([event, produce()]),
    play: (_motion, options) => {
      let finish!: (finished: boolean) => void;
      const finished = new Promise<boolean>((resolve) => (finish = resolve));
      options.signal.addEventListener('abort', () => finish(false));
      plays.push({...options, finish});
      return {finished, at: 0, stop: () => finish(false)};
    },
    prepareBlend: async (_themes, position) => {
      blends.push(position);
      return (next) => void blends.push(next);
    },
    animateProgress: async (request) => {
      if (request.layers.includes('missing')) throw new Error('unknown layer');
      return {
        finished: new Promise((resolve) =>
          progress.push({layers: request.layers, finish: resolve}),
        ),
      };
    },
    stopProgress: (layers) => {
      stopped.push(layers);
      const running = progress.find((item) => item.layers === layers);
      running?.finish(false);
    },
    shotMoving: (value) => void moving.push(value),
  });
  return {animations, events, moving, blends, plays, progress, stopped};
}
// Animation events wait for the task after the answer that names the animation.
const settle = () => new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));

test('a shot reports its cues, moves the camera once, and ends finished', async () => {
  const {animations, events, moving, plays} = fixture();
  const {animation} = await animations.playShot(shot({cues: [{at: 500, id: 'title'}]}), never);
  assert.equal(animation, 'a1');
  plays[0]!.cues[0]!.run();
  plays[0]!.finish(true);
  await settle();
  assert.deepEqual(events, [
    ['shotCue', {animation: 'a1', cue: 'title'}],
    ['animationEnded', {animation: 'a1', finished: true}],
  ]);
  assert.deepEqual(moving, [true, false]);
});

test('a gesture or a new shot stops the playing shot, which ends unfinished', async () => {
  const {animations, events, plays} = fixture();
  await animations.playShot(shot(), never);
  animations.gesture();
  assert.equal(plays[0]!.signal.aborted, true);
  await animations.playShot(shot(), never);
  await animations.playShot(shot(), never);
  assert.equal(plays[1]!.signal.aborted, true);
  await settle();
  assert.deepEqual(
    events.filter(([event]) => event === 'animationEnded'),
    [
      ['animationEnded', {animation: 'a1', finished: false}],
      ['animationEnded', {animation: 'a2', finished: false}],
    ],
  );
  animations.stop('a3');
  animations.stop('a3');
  await settle();
  assert.deepEqual(events.at(-1), ['animationEnded', {animation: 'a3', finished: false}]);
  assert.equal(events.length, 3, 'an animation ends once');
});

test('a shot that blends themes prepares the blend before it starts', async () => {
  const {animations, blends, plays} = fixture();
  await animations.playShot(
    shot({themes: ['day', 'night'], keyframes: [keyframe(0, 0), keyframe(3000, 1)]}),
    never,
  );
  assert.deepEqual(blends, [0]);
  plays[0]!.blend!(0.5);
  assert.deepEqual(blends, [0, 0.5]);
});

test('shot blends and cues are checked against the shot', () => {
  assert.throws(() => shotMotion(shot({keyframes: [keyframe(0, 0), keyframe(1000)]})));
  assert.throws(() =>
    shotMotion(shot({themes: ['day', 'night'], keyframes: [keyframe(0, 0), keyframe(1000, 2)]})),
  );
  assert.throws(() =>
    shotMotion(shot({themes: ['day', 'day'], keyframes: [keyframe(0, 0), keyframe(1000, 1)]})),
  );
  assert.throws(() => shotMotion(shot({cues: [{at: 2001, id: 'late'}]})));
  const motion = shotMotion(
    shot({themes: ['day', 'night'], keyframes: [keyframe(0, 0), keyframe(1000, 1)]}),
  );
  assert.deepEqual(motion.keyframes[1]!.blend, {themes: ['day', 'night'], position: 1});
  assert.deepEqual(motion.keyframes[0]!.camera.center, [2, 41]);
});

test('line progress answers at once and reports its end, so it may outlast a request', async () => {
  const {animations, events, progress, stopped} = fixture();
  const first = await animations.animateProgress({
    layers: ['route-line'],
    to: {end: 1},
    duration: 45_000,
  });
  assert.deepEqual(first, {animation: 'a1'});
  progress[0]!.finish(true);
  await settle();
  const second = await animations.animateProgress({
    layers: ['route-line'],
    to: {end: 0},
    duration: 1000,
  });
  animations.stop(second.animation);
  assert.deepEqual(stopped, [['route-line']]);
  await settle();
  assert.deepEqual(events, [
    ['animationEnded', {animation: 'a1', finished: true}],
    ['animationEnded', {animation: 'a2', finished: false}],
  ]);
  await assert.rejects(
    animations.animateProgress({layers: ['missing'], to: {end: 1}, duration: 0}),
  );
});

test('shot frames are marked so they are not reported as separate movements', () => {
  assert.equal(isShotFrame(shotFrame), true);
  assert.equal(isShotFrame({tileflowReason: 'api'}), false);
});
