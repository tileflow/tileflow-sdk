import {z} from 'zod';
import {
  tileflowCaptureCenterCameraSchema,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureViewportSchema,
} from './capture-scene';
import {type TileflowShotCamera, tileflowShotStateAt} from './capture-shot-motion';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';

export const tileflowCaptureShotSchemaVersion = 1 as const;

export const tileflowCaptureShotLimits = Object.freeze({
  blendThemes: Object.freeze({maximum: 8, minimum: 2}),
  defaultFps: 30 as const,
  durationMs: Object.freeze({maximum: 60_000}),
  fps: Object.freeze([24, 25, 30, 50, 60] as const),
  keyframes: Object.freeze({maximum: 64, minimum: 2}),
  maximumFrames: 3_600,
});

/** Shot names follow the same portable artifact-name rules as scene names. */
export const tileflowCaptureShotNameSchema = tileflowCaptureSceneNameSchema;

export const tileflowCaptureShotBlendSchema = z
  .object({
    themes: z
      .array(tileflowThemeNameSchema)
      .min(tileflowCaptureShotLimits.blendThemes.minimum)
      .max(tileflowCaptureShotLimits.blendThemes.maximum),
    position: z.number().finite().min(0),
  })
  .strict()
  .superRefine((blend, context) => {
    if (new Set(blend.themes).size !== blend.themes.length) {
      context.addIssue({code: 'custom', message: 'Expected distinct themes', path: ['themes']});
    }
    if (blend.position > blend.themes.length - 1) {
      context.addIssue({
        code: 'custom',
        message: `Expected a position from 0 to ${blend.themes.length - 1}`,
        path: ['position'],
      });
    }
  });

export const tileflowCaptureShotKeyframeSchema = z
  .object({
    at: z.number().int().min(0).max(tileflowCaptureShotLimits.durationMs.maximum),
    camera: tileflowCaptureCenterCameraSchema,
    blend: tileflowCaptureShotBlendSchema.optional(),
  })
  .strict();

const tileflowCaptureShotFields = {
  theme: tileflowThemeNameSchema,
  viewport: tileflowCaptureViewportSchema,
  fps: z.literal(tileflowCaptureShotLimits.fps).optional(),
  keyframes: z
    .array(tileflowCaptureShotKeyframeSchema)
    .min(tileflowCaptureShotLimits.keyframes.minimum)
    .max(tileflowCaptureShotLimits.keyframes.maximum),
  easing: z.enum(['smooth', 'linear']).optional(),
};

export const tileflowCaptureShotSchema = z
  .object({map: tileflowPortableIdSchema, ...tileflowCaptureShotFields})
  .strict()
  .superRefine(checkShotTiming);

/** The shot schema without its map id, as committed under `shots` on a singular map. */
const tileflowMapShotSchema = z
  .object(tileflowCaptureShotFields)
  .strict()
  .superRefine(checkShotTiming);

export type TileflowCaptureShotBlend = z.infer<typeof tileflowCaptureShotBlendSchema>;
export type TileflowCaptureShotKeyframe = z.infer<typeof tileflowCaptureShotKeyframeSchema>;
export type TileflowCaptureShot = z.infer<typeof tileflowCaptureShotSchema>;
export type TileflowCaptureShotEasing = 'linear' | 'smooth';

export type NormalizedTileflowCaptureShotCamera = TileflowShotCamera;

export type NormalizedTileflowCaptureShot = {
  map: string;
  theme: string;
  viewport: {width: number; height: number; dpr: 1 | 2};
  fps: 24 | 25 | 30 | 50 | 60;
  easing: TileflowCaptureShotEasing;
  keyframes: Array<{
    at: number;
    camera: NormalizedTileflowCaptureShotCamera;
    blend?: {themes: string[]; position: number};
  }>;
};

/** One rendered frame of a shot: the camera and blend position at `at` milliseconds. */
export type TileflowCaptureShotFrame = {
  index: number;
  at: number;
  camera: NormalizedTileflowCaptureShotCamera;
  /** Present when the shot blends themes. */
  blendPosition?: number;
};

export function normalizeTileflowCaptureShot(
  input: TileflowCaptureShot,
): NormalizedTileflowCaptureShot {
  const shot = tileflowCaptureShotSchema.parse(input);
  return {map: shot.map, ...normalizeShotFields(shot)};
}

/**
 * The number of frames a shot renders: one at the start and one every `1 / fps` seconds up to its
 * last keyframe. The last keyframe is a frame when its time is a whole number of frame intervals.
 */
export function tileflowCaptureShotFrameCount(
  shot: Pick<TileflowCaptureShot, 'fps' | 'keyframes'>,
): number {
  const fps = shot.fps ?? tileflowCaptureShotLimits.defaultFps;
  const duration = shot.keyframes.at(-1)?.at ?? 0;
  return Math.floor((duration * fps) / 1_000 + 1e-9) + 1;
}

/**
 * Interpolates every frame of a shot. Frame `i` shows the shot at `i * 1000 / fps` milliseconds.
 * Within each keyframe segment the center moves in Web Mercator coordinates along the shorter way
 * around the world, zoom and pitch change linearly, bearing turns along the shorter arc, and the
 * blend position changes linearly; `easing: 'smooth'` eases each segment in and out.
 */
export function tileflowCaptureShotFrames(
  shot: TileflowCaptureShot | Omit<TileflowCaptureShot, 'map'>,
): TileflowCaptureShotFrame[] {
  const {map: _map, ...fields} = shot as TileflowCaptureShot;
  const normalized = normalizeShotFields(tileflowMapShotSchema.parse(fields));
  const count = tileflowCaptureShotFrameCount(normalized);
  const duration = normalized.keyframes.at(-1)!.at;
  const frames: TileflowCaptureShotFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = Math.min(duration, (index * 1_000) / normalized.fps);
    frames.push({index, ...tileflowShotStateAt(normalized, at)});
  }
  return frames;
}

function normalizeShotFields(
  shot: z.infer<typeof tileflowMapShotSchema>,
): Omit<NormalizedTileflowCaptureShot, 'map'> {
  return {
    theme: shot.theme,
    viewport: {...shot.viewport, dpr: shot.viewport.dpr ?? 1},
    fps: shot.fps ?? tileflowCaptureShotLimits.defaultFps,
    easing: shot.easing ?? 'smooth',
    keyframes: shot.keyframes.map((keyframe) => ({
      at: keyframe.at,
      camera: {
        type: 'center',
        center: keyframe.camera.center,
        zoom: keyframe.camera.zoom,
        bearing: keyframe.camera.bearing ?? 0,
        pitch: keyframe.camera.pitch ?? 0,
      },
      ...(keyframe.blend
        ? {blend: {themes: [...keyframe.blend.themes], position: keyframe.blend.position}}
        : {}),
    })),
  };
}

function checkShotTiming(
  shot: Pick<TileflowCaptureShot, 'fps' | 'keyframes'>,
  context: z.RefinementCtx,
): void {
  const {keyframes} = shot;
  if (keyframes[0] && keyframes[0].at !== 0) {
    context.addIssue({
      code: 'custom',
      message: 'Expected the first keyframe at 0 milliseconds',
      path: ['keyframes', 0, 'at'],
    });
  }
  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index]!.at <= keyframes[index - 1]!.at) {
      context.addIssue({
        code: 'custom',
        message: 'Expected a time after the previous keyframe',
        path: ['keyframes', index, 'at'],
      });
    }
  }

  const blended = keyframes.filter((keyframe) => keyframe.blend !== undefined);
  if (blended.length > 0) {
    const themes = JSON.stringify(blended[0]!.blend!.themes);
    keyframes.forEach((keyframe, index) => {
      if (!keyframe.blend) {
        context.addIssue({
          code: 'custom',
          message: 'Expected a blend on every keyframe when one keyframe blends themes',
          path: ['keyframes', index, 'blend'],
        });
      } else if (JSON.stringify(keyframe.blend.themes) !== themes) {
        context.addIssue({
          code: 'custom',
          message: 'Expected the same themes, in the same order, on every keyframe',
          path: ['keyframes', index, 'blend', 'themes'],
        });
      }
    });
  }

  const frames = tileflowCaptureShotFrameCount(shot);
  if (frames > tileflowCaptureShotLimits.maximumFrames) {
    context.addIssue({
      code: 'custom',
      message: `Expected at most ${tileflowCaptureShotLimits.maximumFrames} frames; this shot renders ${frames}`,
      path: ['keyframes', keyframes.length - 1, 'at'],
    });
  }
}
