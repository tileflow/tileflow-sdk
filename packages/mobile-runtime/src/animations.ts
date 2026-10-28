import type {TileflowShotMotion, TileflowShotPlayback} from '@tileflow/core/browser';
import type {Producer} from './events';
import {type EventName, ProtocolError} from './protocol';
import type {LineProgressAnimation, ShotRequest} from './scene-contract';

/** Event data that marks a camera frame of a shot, so it is not reported as its own movement. */
export const shotFrame = {tileflowReason: 'api', tileflowShot: true} as const;

/** Whether a MapLibre movement event is a frame of a playing shot. */
export function isShotFrame(event: unknown): boolean {
  return (event as {tileflowShot?: unknown}).tileflowShot === true;
}

type Running = {stop: () => void; shot: boolean};

export type AnimationInput = Readonly<{
  emit: (event: EventName, produce: Producer) => void;
  /** Starts Core's shot player on the map. */
  play: (
    motion: TileflowShotMotion,
    options: {
      blend?: (position: number) => void;
      cues: readonly {at: number; run: () => void}[];
      signal: AbortSignal;
    },
  ) => TileflowShotPlayback;
  /** Prepares a blend of themes before a shot that blends them starts. */
  prepareBlend: (
    themes: readonly string[],
    position: number,
    signal: AbortSignal,
  ) => Promise<(position: number) => void>;
  /** Starts animating line layers drawn with progress; `finished` tells whether they got there. */
  animateProgress: (request: LineProgressAnimation) => Promise<{finished: Promise<boolean>}>;
  stopProgress: (layers: readonly string[]) => void;
  /** The camera of a shot starts and stops moving. */
  shotMoving: (moving: boolean) => void;
}>;

/** Checks what Core's shot motion takes for granted about a request's blend. */
export function shotMotion(request: ShotRequest): TileflowShotMotion {
  const positions = request.keyframes.map((keyframe) => keyframe.blendPosition);
  if (request.themes) {
    if (new Set(request.themes).size !== request.themes.length)
      throw new ProtocolError('invalidRequest', 'A shot blends distinct themes.');
    if (positions.some((value) => value === undefined || value > request.themes!.length - 1))
      throw new ProtocolError(
        'invalidRequest',
        'Every keyframe of a shot that blends themes needs a blend position among them.',
      );
  } else if (positions.some((value) => value !== undefined)) {
    throw new ProtocolError('invalidRequest', 'Blend positions need the themes a shot blends.');
  }
  const duration = request.keyframes.at(-1)!.at;
  if (request.cues.some((cue) => cue.at > duration))
    throw new ProtocolError('invalidRequest', 'A cue falls after the shot ends.');
  return {
    easing: request.easing,
    keyframes: request.keyframes.map((keyframe) => ({
      at: keyframe.at,
      camera: {
        center: [keyframe.camera.longitude, keyframe.camera.latitude],
        zoom: keyframe.camera.zoom,
        bearing: keyframe.camera.bearing,
        pitch: keyframe.camera.pitch,
      },
      ...(request.themes
        ? {blend: {themes: request.themes, position: keyframe.blendPosition!}}
        : {}),
    })),
  };
}

/**
 * Animations that can outlast a request: camera shots and line progress. A request starts one and
 * answers with its identifier at once; `animationEnded` reports whether it finished or was stopped,
 * and `shotCue` reports each cue a shot reaches. One shot plays at a time, and a person's gesture
 * stops it, as it stops any camera animation.
 */
export function createAnimations(input: AnimationInput) {
  let sequence = 0;
  const running = new Map<string, Running>();
  let disposed = false;

  function begin(shot: boolean, stop: () => void): string {
    const id = `a${++sequence}`;
    running.set(id, {stop, shot});
    return id;
  }
  function end(id: string, finished: boolean) {
    if (!running.delete(id) || disposed) return;
    input.emit('animationEnded', () => ({animation: id, finished}));
  }
  function stopShots() {
    for (const [id, animation] of running) if (animation.shot) stop(id);
  }
  function stop(id: string) {
    const animation = running.get(id);
    if (!animation) return;
    animation.stop();
    end(id, false);
  }

  return {
    async playShot(request: ShotRequest, signal: AbortSignal): Promise<{animation: string}> {
      const motion = shotMotion(request);
      const abort = new AbortController();
      let blend: ((position: number) => void) | undefined;
      if (request.themes)
        blend = await input.prepareBlend(
          request.themes,
          request.keyframes[0]!.blendPosition!,
          signal,
        );
      signal.throwIfAborted();
      if (disposed) throw new ProtocolError('disposed', 'The map is disposed.');
      stopShots();
      const id = begin(true, () => abort.abort());
      input.shotMoving(true);
      const playback = input.play(motion, {
        ...(blend ? {blend} : {}),
        cues: request.cues.map((cue) => ({
          at: cue.at,
          run: () => {
            if (running.has(id)) input.emit('shotCue', () => ({animation: id, cue: cue.id}));
          },
        })),
        signal: abort.signal,
      });
      void playback.finished.then((finished) => {
        if (!running.has(id)) return;
        input.shotMoving(false);
        end(id, finished);
      });
      return {animation: id};
    },
    async animateProgress(request: LineProgressAnimation): Promise<{animation: string}> {
      // Unknown layers fail the request before anything moves.
      const {finished} = await input.animateProgress(request);
      const id = begin(false, () => input.stopProgress(request.layers));
      void finished.then(
        (done) => end(id, done),
        () => end(id, false),
      );
      return {animation: id};
    },
    stop(id: string) {
      const animation = running.get(id);
      if (animation?.shot) input.shotMoving(false);
      stop(id);
    },
    /** A person's gesture takes the camera from a playing shot. */
    gesture() {
      if ([...running.values()].some((animation) => animation.shot)) {
        input.shotMoving(false);
        stopShots();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const animation of running.values()) animation.stop();
      running.clear();
    },
  };
}
