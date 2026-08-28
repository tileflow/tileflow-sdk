import {z} from 'zod';

export const staticSceneSchemaVersion = 1;
export const staticSceneLimits = {
  maxDimension: 1280,
  maxGeoJsonBytes: 96_000,
  maxOverlays: 24,
  maxPathCoordinates: 2000,
  maxPhysicalPixels: 1280 * 1280,
  minDimension: 64,
} as const;

export const coordinateSchema = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
    message: 'Expected [lng, lat] within world bounds',
  });

const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'Expected a hex color like #C6A15B',
});

const portableIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]{0,63}$/u, {
    message: 'Expected lowercase kebab-case beginning with a letter',
  })
  .refine(
    (name) =>
      !['constructor', 'prototype'].includes(name) &&
      !/^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$/i.test(name),
    'Expected a portable identifier that is not a reserved filename or prototype key',
  );

const concreteThemeSchema = portableIdSchema.refine((value) => value !== 'system', {
  message: 'Static maps require a concrete theme; "system" is browser-only',
});

const sizeSchema = z
  .object({
    dpr: z.literal(1).optional(),
    height: z
      .number()
      .int()
      .min(staticSceneLimits.minDimension)
      .max(staticSceneLimits.maxDimension),
    width: z.number().int().min(staticSceneLimits.minDimension).max(staticSceneLimits.maxDimension),
  })
  .refine(
    (size) => size.width * size.height * (size.dpr ?? 1) <= staticSceneLimits.maxPhysicalPixels,
    {
      message: 'Static map exceeds the maximum render pixel budget',
    },
  );

const centerCameraSchema = z.object({
  bearing: z.number().finite().min(-180).max(180).optional(),
  center: coordinateSchema,
  type: z.literal('center'),
  zoom: z.number().finite().min(0).max(22),
});

const boundsCameraSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    bounds: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .refine(
        ([west, south, east, north]) =>
          west >= -180 &&
          west <= 180 &&
          east >= -180 &&
          east <= 180 &&
          south >= -90 &&
          south <= 90 &&
          north >= -90 &&
          north <= 90 &&
          west !== east &&
          south !== north,
        {message: 'Expected bounds as [west, south, east, north]'},
      ),
    padding: z.number().int().min(0).max(256).optional(),
    type: z.literal('bounds'),
  })
  .refine((camera) => camera.bounds[3] > camera.bounds[1], {
    message: 'Bounds north must be greater than south',
  });

export const lineOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinates: z.array(coordinateSchema).min(2).max(staticSceneLimits.maxPathCoordinates),
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  type: z.literal('line'),
  width: z.number().finite().min(0.5).max(32).default(4),
});

export const circleOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinate: coordinateSchema,
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  radius: z.number().finite().min(1).max(64).default(6),
  strokeColor: colorSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(16).default(0),
  type: z.literal('circle'),
});

export const markerOverlaySchema = z.object({
  color: colorSchema.default('#C6A15B'),
  coordinate: coordinateSchema,
  id: z.string().trim().min(1).max(64).optional(),
  radius: z.number().finite().min(2).max(64).default(8),
  strokeColor: colorSchema.default('#ffffff'),
  strokeWidth: z.number().finite().min(0).max(16).default(2),
  type: z.literal('marker'),
});

const polygonRingSchema = z
  .array(coordinateSchema)
  .min(4)
  .max(staticSceneLimits.maxPathCoordinates)
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
    },
    {message: 'Polygon rings must end at their starting coordinate'},
  );

export const polygonOverlaySchema = z.object({
  coordinates: z.array(polygonRingSchema).min(1).max(16),
  fill: colorSchema.default('#C6A15B'),
  id: z.string().trim().min(1).max(64).optional(),
  opacity: z.number().finite().min(0).max(1).default(0.28),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(16).default(0),
  type: z.literal('polygon'),
});

export const staticOverlaySchema = z.discriminatedUnion('type', [
  lineOverlaySchema,
  circleOverlaySchema,
  markerOverlaySchema,
  polygonOverlaySchema,
]);

export const staticSceneSchema = z.object({
  camera: z.discriminatedUnion('type', [centerCameraSchema, boundsCameraSchema]),
  map: portableIdSchema,
  overlays: z.array(staticOverlaySchema).max(staticSceneLimits.maxOverlays).default([]),
  size: sizeSchema,
  theme: concreteThemeSchema,
});

export type StaticCoordinate = z.infer<typeof coordinateSchema>;
export type StaticSceneInput = z.input<typeof staticSceneSchema>;
export type StaticScene = z.infer<typeof staticSceneSchema>;
export type StaticOverlayInput = z.input<typeof staticOverlaySchema>;
export type StaticOverlay = z.infer<typeof staticOverlaySchema>;
