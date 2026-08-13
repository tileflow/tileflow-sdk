import {z} from 'zod';

export const tileflowCaptureSceneSchemaVersion = 1 as const;

export const tileflowCaptureSceneLimits = Object.freeze({
  applicationPathLength: 2_048,
  boundsPadding: {maximum: 1_024, minimum: 0},
  captureIdLength: 64,
  maximumPhysicalPixels: 16_777_216,
  pitch: {maximum: 85, minimum: 0},
  selectorLength: 256,
  viewport: {maximum: 4_096, minimum: 64},
  zoom: {maximum: 24, minimum: 0},
});

const finiteLongitudeSchema = z.number().finite().min(-180).max(180);
const finiteLatitudeSchema = z.number().finite().min(-90).max(90);
const bearingSchema = z.number().finite().min(-180).max(180).optional();
const pitchSchema = z
  .number()
  .finite()
  .min(tileflowCaptureSceneLimits.pitch.minimum)
  .max(tileflowCaptureSceneLimits.pitch.maximum)
  .optional();

export const tileflowCaptureCenterCameraSchema = z
  .object({
    type: z.literal('center'),
    center: z.tuple([finiteLongitudeSchema, finiteLatitudeSchema]),
    zoom: z
      .number()
      .finite()
      .min(tileflowCaptureSceneLimits.zoom.minimum)
      .max(tileflowCaptureSceneLimits.zoom.maximum),
    bearing: bearingSchema,
    pitch: pitchSchema,
  })
  .strict();

export const tileflowCaptureBoundsCameraSchema = z
  .object({
    type: z.literal('bounds'),
    bounds: z.tuple([
      finiteLongitudeSchema,
      finiteLatitudeSchema,
      finiteLongitudeSchema,
      finiteLatitudeSchema,
    ]),
    padding: z
      .number()
      .finite()
      .min(tileflowCaptureSceneLimits.boundsPadding.minimum)
      .max(tileflowCaptureSceneLimits.boundsPadding.maximum)
      .optional(),
    bearing: bearingSchema,
    pitch: pitchSchema,
  })
  .strict()
  .superRefine((camera, context) => {
    const [west, south, east, north] = camera.bounds;

    if (south >= north) {
      context.addIssue({
        code: 'custom',
        message: 'Expected south latitude to be less than north latitude',
        path: ['bounds'],
      });
    }

    if (west === east) {
      context.addIssue({
        code: 'custom',
        message: 'Expected west and east longitude to define a non-empty span',
        path: ['bounds'],
      });
    }
  });

export const tileflowCaptureCameraSchema = z.discriminatedUnion('type', [
  tileflowCaptureCenterCameraSchema,
  tileflowCaptureBoundsCameraSchema,
]);

export const tileflowCaptureViewportSchema = z
  .object({
    width: z
      .number()
      .int()
      .min(tileflowCaptureSceneLimits.viewport.minimum)
      .max(tileflowCaptureSceneLimits.viewport.maximum),
    height: z
      .number()
      .int()
      .min(tileflowCaptureSceneLimits.viewport.minimum)
      .max(tileflowCaptureSceneLimits.viewport.maximum),
    dpr: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict()
  .superRefine((viewport, context) => {
    const dpr = viewport.dpr ?? 1;
    const physicalPixels = viewport.width * viewport.height * dpr * dpr;

    if (physicalPixels > tileflowCaptureSceneLimits.maximumPhysicalPixels) {
      context.addIssue({
        code: 'custom',
        message: `Expected at most ${tileflowCaptureSceneLimits.maximumPhysicalPixels} physical pixels`,
        path: ['dpr'],
      });
    }
  });

export const tileflowCaptureIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(tileflowCaptureSceneLimits.captureIdLength)
  .regex(/^[A-Za-z0-9_-]+$/, {
    message: 'Expected letters, numbers, underscores, or hyphens',
  })
  .refine((name) => name !== '__proto__', {
    message: 'Expected an identifier that cannot mutate an object prototype',
  });

export const tileflowCaptureSceneNameSchema = tileflowCaptureIdSchema.refine(
  (name) => !/^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/i.test(name),
  'Expected a portable scene name that is not a reserved filename or prototype key',
);

const applicationPathSchema = z
  .string()
  .min(1)
  .max(tileflowCaptureSceneLimits.applicationPathLength)
  .refine(isPortableApplicationPath, {
    message:
      'Expected a root-relative application path without an origin, credentials, fragment, backslash, or control character',
  });

export const tileflowCaptureMapTargetSchema = z.object({kind: z.literal('map')}).strict();

export const tileflowCaptureApplicationTargetSchema = z
  .object({
    kind: z.literal('application'),
    path: applicationPathSchema,
    captureId: tileflowCaptureIdSchema.optional(),
    selector: z.string().trim().min(1).max(tileflowCaptureSceneLimits.selectorLength).optional(),
    frame: z.enum(['map', 'viewport']).optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.captureId && target.selector) {
      context.addIssue({
        code: 'custom',
        message: 'Expected either captureId or selector, not both',
        path: ['selector'],
      });
    }
  });

export const tileflowCaptureTargetSchema = z.discriminatedUnion('kind', [
  tileflowCaptureMapTargetSchema,
  tileflowCaptureApplicationTargetSchema,
]);

export const tileflowCaptureSceneSchema = z
  .object({
    map: tileflowCaptureIdSchema,
    camera: tileflowCaptureCameraSchema,
    viewport: tileflowCaptureViewportSchema,
    target: tileflowCaptureTargetSchema.optional(),
  })
  .strict();

export type TileflowCaptureCenterCamera = z.infer<typeof tileflowCaptureCenterCameraSchema>;
export type TileflowCaptureBoundsCamera = z.infer<typeof tileflowCaptureBoundsCameraSchema>;
export type TileflowCaptureCamera = z.infer<typeof tileflowCaptureCameraSchema>;
export type TileflowCaptureViewport = z.infer<typeof tileflowCaptureViewportSchema>;
export type TileflowCaptureMapTarget = z.infer<typeof tileflowCaptureMapTargetSchema>;
export type TileflowCaptureApplicationTarget = z.infer<
  typeof tileflowCaptureApplicationTargetSchema
>;
export type TileflowCaptureTarget = z.infer<typeof tileflowCaptureTargetSchema>;
export type TileflowCaptureScene = z.infer<typeof tileflowCaptureSceneSchema>;

export type NormalizedTileflowCaptureScene = {
  map: string;
  camera:
    | {
        type: 'center';
        center: [number, number];
        zoom: number;
        bearing: number;
        pitch: number;
      }
    | {
        type: 'bounds';
        bounds: [number, number, number, number];
        padding: number;
        bearing: number;
        pitch: number;
      };
  viewport: {width: number; height: number; dpr: 1 | 2};
  target:
    | {kind: 'map'}
    | {
        kind: 'application';
        path: string;
        captureId?: string;
        selector?: string;
        frame: 'map' | 'viewport';
      };
};

export function normalizeTileflowCaptureScene(
  input: TileflowCaptureScene,
): NormalizedTileflowCaptureScene {
  const scene = tileflowCaptureSceneSchema.parse(input);
  const camera =
    scene.camera.type === 'center'
      ? {
          type: scene.camera.type,
          center: scene.camera.center,
          zoom: scene.camera.zoom,
          bearing: scene.camera.bearing ?? 0,
          pitch: scene.camera.pitch ?? 0,
        }
      : {
          type: scene.camera.type,
          bounds: scene.camera.bounds,
          padding: scene.camera.padding ?? 0,
          bearing: scene.camera.bearing ?? 0,
          pitch: scene.camera.pitch ?? 0,
        };
  const target = scene.target ?? {kind: 'map' as const};

  return {
    map: scene.map,
    camera,
    viewport: {...scene.viewport, dpr: scene.viewport.dpr ?? 1},
    target:
      target.kind === 'map'
        ? target
        : {
            kind: target.kind,
            path: target.path,
            ...(target.captureId ? {captureId: target.captureId} : {}),
            ...(target.selector ? {selector: target.selector} : {}),
            frame: target.frame ?? 'map',
          },
  };
}

export function normalizeTileflowCaptureId(value: string | undefined): string | undefined {
  return value === undefined ? undefined : tileflowCaptureIdSchema.parse(value);
}

function isPortableApplicationPath(value: string): boolean {
  if (
    value !== value.trim() ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    return false;
  }

  try {
    const base = new URL('http://tileflow.local');
    const resolved = new URL(value, base);
    return (
      resolved.origin === base.origin &&
      resolved.username === '' &&
      resolved.password === '' &&
      resolved.pathname.startsWith('/')
    );
  } catch {
    return false;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
