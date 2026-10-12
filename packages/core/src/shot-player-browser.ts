import {
  type TileflowShotCamera,
  type TileflowShotMotion,
  tileflowShotStateAt,
} from './capture-shot-motion';
import {prefersReducedMotion, tileflowThemeMotionView} from './theme-motion-browser';

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowShotPlayerMap = {
  getCanvas?: unknown;
  jumpTo(camera: {center: [number, number]; zoom: number; bearing: number; pitch: number}): unknown;
};

/** Something to do once the shot reaches a time, such as drawing a route or showing a title. */
export type TileflowShotCue = Readonly<{at: number; run: () => void}>;

export type TileflowShotPlaybackOptions = Readonly<{
  /**
   * Receives the blend position at each frame of a shot that blends themes, to pass on to the
   * theme controller: `(position) => controller.setBlend({themes, position})`.
   */
  blend?: (position: number) => void;
  /** Run once each, in time order, as the shot reaches them. */
  cues?: readonly TileflowShotCue[];
  /** Receives the camera after each frame's move. */
  onFrame?: (state: {at: number; camera: TileflowShotCamera; blendPosition?: number}) => void;
  /** Stops the shot where it is. */
  signal?: AbortSignal;
}>;

export type TileflowShotPlayback = {
  /** True when the shot played to its last keyframe; false when it was stopped first. */
  readonly finished: Promise<boolean>;
  /** Milliseconds the shot has played. */
  readonly at: number;
  /** Stops the shot where it is. */
  stop(): void;
};

/**
 * Plays a timed shot live on a map: the camera follows the shot's keyframes frame by frame, the
 * blend position goes to `blend`, and cues run as the shot reaches them. It moves as Capture renders
 * the same shot to video, so the page and the film agree. With reduced motion requested, or without
 * a browser window, it shows the last keyframe at once and runs every cue in order.
 */
export function playTileflowShot(
  map: TileflowShotPlayerMap,
  shot: TileflowShotMotion,
  options: TileflowShotPlaybackOptions = {},
): TileflowShotPlayback {
  validated(shot);
  const cues = [...(options.cues ?? [])]
    .map((cue, order) => {
      if (!Number.isFinite(cue?.at) || typeof cue.run !== 'function')
        throw new TypeError('Shot cues are {at, run} with a finite time in milliseconds.');
      return {...cue, order};
    })
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const duration = shot.keyframes.at(-1)!.at;
  let next = 0;
  let played = 0;
  let stopped = false;
  let frame: number | undefined;
  let settle!: (finished: boolean) => void;
  const finished = new Promise<boolean>((resolve) => (settle = resolve));
  const view = tileflowThemeMotionView(
    map as unknown as Parameters<typeof tileflowThemeMotionView>[0],
  );

  function show(at: number) {
    const state = tileflowShotStateAt(shot, at);
    map.jumpTo(state.camera);
    if (state.blendPosition !== undefined) options.blend?.(state.blendPosition);
    options.onFrame?.(state);
    while (next < cues.length && cues[next]!.at <= at) cues[next++]!.run();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    options.signal?.removeEventListener('abort', stop);
    settle(played >= duration);
  }

  if (options.signal?.aborted) {
    stopped = true;
    settle(false);
  } else if (!view || prefersReducedMotion(view)) {
    played = duration;
    show(duration);
    stopped = true;
    settle(true);
  } else {
    options.signal?.addEventListener('abort', stop, {once: true});
    const now = () => view.performance?.now?.() ?? Date.now();
    const began = now();
    const step = () => {
      frame = undefined;
      if (stopped) return;
      played = Math.min(duration, now() - began);
      show(played);
      if (played >= duration) stop();
      else frame = view.requestAnimationFrame(step);
    };
    show(0);
    frame = view.requestAnimationFrame(step);
  }

  return {
    finished,
    get at() {
      return played;
    },
    stop,
  };
}

function validated(shot: TileflowShotMotion) {
  const keyframes = shot?.keyframes;
  if (!Array.isArray(keyframes) || keyframes.length < 2)
    throw new TypeError('A shot needs at least two keyframes.');
  if (keyframes[0]!.at !== 0) throw new TypeError('A shot starts with a keyframe at 0.');
  for (const [index, keyframe] of keyframes.entries()) {
    const {at, camera} = keyframe;
    if (!Number.isFinite(at) || (index > 0 && at <= keyframes[index - 1]!.at))
      throw new TypeError('Shot keyframe times rise strictly, in milliseconds.');
    const numbers = [camera?.center?.[0], camera?.center?.[1], camera?.zoom];
    if (camera?.bearing !== undefined) numbers.push(camera.bearing);
    if (camera?.pitch !== undefined) numbers.push(camera.pitch);
    if (!numbers.every(Number.isFinite))
      throw new TypeError('Shot keyframe cameras need a center, a zoom and finite angles.');
  }
  if (shot.easing !== undefined && shot.easing !== 'smooth' && shot.easing !== 'linear')
    throw new TypeError('Shot easing is smooth or linear.');
}
