import {z} from 'zod';
import {isSupportedStaticTextCodePoint} from './text-coverage';

export const staticSceneSchemaVersion = 1;
export const MAX_OVERLAY_LATITUDE = 85.051129;
export const staticSceneLimits = {
  maxDimension: 2048,
  maxGeoJsonBytes: 96_000,
  maxOverlays: 24,
  maxPathCoordinates: 2000,
  maxPhysicalPixels: 2048 * 2048 * 4,
  minDimension: 64,
} as const;

export const coordinateSchema = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
    message: 'Expected [lng, lat] within world bounds',
  });

const overlayCoordinateSchema = coordinateSchema.refine(
  ([, latitude]) => Math.abs(latitude) <= MAX_OVERLAY_LATITUDE,
  {
    message: `Static overlay latitude must be within ±${MAX_OVERLAY_LATITUDE}°`,
  },
);

const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'Expected a hex color like #C6A15B',
});

export const staticOverlayPlacements = [
  'above-water',
  'below-roads',
  'above-roads',
  'above-buildings',
  'below-labels',
  'above-labels',
] as const;
export const staticSymbolAnchors = [
  'center',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'top-left',
] as const;
export const staticSymbolCollisions = ['always-visible', 'avoid-overlap'] as const;
export const staticSymbolLanguages = ['ja', 'zh-Hans', 'zh-Hant', 'ko'] as const;
export const staticSymbolLabelAppearances = ['plain', 'badge'] as const;
export const staticSymbolLabelPositions = [
  'center',
  'above',
  'above-right',
  'right',
  'below-right',
  'below',
  'below-left',
  'left',
  'above-left',
] as const;

const overlayPlacementSchema = z.enum(staticOverlayPlacements).optional();
const symbolIconSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
    message: 'Expected a deployed sprite icon ID',
  });
const symbolTextSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), 'Symbol label text must be trimmed')
  .refine(
    (value) => Array.from(value).length <= 64,
    'Symbol labels may contain at most 64 characters',
  )
  .refine(
    (value) =>
      Array.from(value).every((character) =>
        isSupportedStaticTextCodePoint(character.codePointAt(0)!),
      ),
    'Symbol label contains a character unsupported by the deterministic renderer font',
  );
const symbolLabelPositionSchema = z.enum(staticSymbolLabelPositions).optional();
const symbolLanguageSchema = z.enum(staticSymbolLanguages).default('zh-Hans');
const symbolFontSizeSchema = z.number().finite().min(8).max(32).default(12);
const symbolGapSchema = z.number().finite().min(0).max(32);
const plainSymbolLabelSchema = z
  .object({
    appearance: z.literal('plain'),
    color: colorSchema.default('#111827'),
    fontSize: symbolFontSizeSchema,
    gap: symbolGapSchema.default(4),
    haloColor: colorSchema.default('#ffffff'),
    haloWidth: z.number().finite().min(0).max(8).default(2),
    language: symbolLanguageSchema,
    position: symbolLabelPositionSchema,
    text: symbolTextSchema,
  })
  .strict();
const badgeSymbolLabelSchema = z
  .object({
    appearance: z.literal('badge'),
    backgroundColor: colorSchema.default('#111827'),
    borderColor: colorSchema.default('#ffffff'),
    borderRadius: z.number().finite().min(0).max(32).default(6),
    borderWidth: z.number().finite().min(0).max(8).default(1),
    color: colorSchema.default('#ffffff'),
    fontSize: symbolFontSizeSchema,
    gap: symbolGapSchema.default(2),
    language: symbolLanguageSchema,
    padding: z
      .object({
        x: z.number().finite().min(0).max(32).default(5),
        y: z.number().finite().min(0).max(32).default(3),
      })
      .strict()
      .default({x: 5, y: 3}),
    position: symbolLabelPositionSchema,
    text: symbolTextSchema,
  })
  .strict();
const symbolLabelSchema = z
  .union([symbolTextSchema, plainSymbolLabelSchema, badgeSymbolLabelSchema])
  .transform((label) =>
    typeof label === 'string'
      ? plainSymbolLabelSchema.parse({appearance: 'plain', text: label})
      : label,
  );

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

const staticMapFormatSchema = z.enum(['png', 'jpeg', 'webp']);

export const staticAttributionPositionSchema = z.enum([
  'auto',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

export const staticAttributionRequestSchema = z.union([
  z
    .object({
      mode: z.literal('embedded').optional(),
      position: staticAttributionPositionSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('external'),
    })
    .strict(),
]);

const sizeSchema = z
  .object({
    dpr: z.union([z.literal(1), z.literal(2)]).optional(),
    height: z
      .number()
      .int()
      .min(staticSceneLimits.minDimension)
      .max(staticSceneLimits.maxDimension),
    width: z.number().int().min(staticSceneLimits.minDimension).max(staticSceneLimits.maxDimension),
  })
  .strict()
  .refine(
    (size) => {
      const dpr = size.dpr ?? 1;
      return size.width * size.height * dpr * dpr <= staticSceneLimits.maxPhysicalPixels;
    },
    {
      message: 'Static map exceeds the maximum render pixel budget',
    },
  );

const centerCameraSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    center: coordinateSchema,
    type: z.literal('center'),
    zoom: z.number().finite().min(0).max(22),
  })
  .strict();

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
  .strict()
  .refine((camera) => camera.bounds[3] > camera.bounds[1], {
    message: 'Bounds north must be greater than south',
  });

export const staticPaddingSchema = z
  .object({
    bottom: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
  })
  .strict();

const autoPaddingInputSchema = z.union([
  z.number().int().nonnegative(),
  z
    .object({
      bottom: z.number().int().nonnegative().optional(),
      left: z.number().int().nonnegative().optional(),
      right: z.number().int().nonnegative().optional(),
      top: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

const autoCameraSchema = z
  .object({
    bearing: z.number().finite().min(-180).max(180).optional(),
    maxZoom: z.number().finite().min(0).max(22).optional(),
    padding: autoPaddingInputSchema.optional(),
    type: z.literal('auto'),
  })
  .strict();

export const lineOverlaySchema = z
  .object({
    color: colorSchema.default('#C6A15B'),
    coordinates: z.array(overlayCoordinateSchema).min(2).max(staticSceneLimits.maxPathCoordinates),
    id: z.string().trim().min(1).max(64).optional(),
    opacity: z.number().finite().min(0).max(1).default(1),
    placement: overlayPlacementSchema,
    type: z.literal('line'),
    width: z.number().finite().min(0.5).max(32).default(4),
  })
  .strict();

export const circleOverlaySchema = z
  .object({
    color: colorSchema.default('#C6A15B'),
    coordinate: overlayCoordinateSchema,
    id: z.string().trim().min(1).max(64).optional(),
    opacity: z.number().finite().min(0).max(1).default(1),
    placement: overlayPlacementSchema,
    radius: z.number().finite().min(1).max(64).default(6),
    strokeColor: colorSchema.optional(),
    strokeWidth: z.number().finite().min(0).max(16).default(0),
    type: z.literal('circle'),
  })
  .strict();

export const markerOverlaySchema = z
  .object({
    color: colorSchema.default('#C6A15B'),
    coordinate: overlayCoordinateSchema,
    id: z.string().trim().min(1).max(64).optional(),
    placement: overlayPlacementSchema,
    radius: z.number().finite().min(2).max(64).default(8),
    strokeColor: colorSchema.default('#ffffff'),
    strokeWidth: z.number().finite().min(0).max(16).default(2),
    type: z.literal('marker'),
  })
  .strict();

const polygonRingSchema = z
  .array(overlayCoordinateSchema)
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

export const polygonOverlaySchema = z
  .object({
    coordinates: z.array(polygonRingSchema).min(1).max(16),
    fill: colorSchema.default('#C6A15B'),
    id: z.string().trim().min(1).max(64).optional(),
    opacity: z.number().finite().min(0).max(1).default(0.28),
    placement: overlayPlacementSchema,
    stroke: colorSchema.optional(),
    strokeWidth: z.number().finite().min(0).max(16).default(0),
    type: z.literal('polygon'),
  })
  .strict();

export const symbolOverlaySchema = z
  .object({
    anchor: z.enum(staticSymbolAnchors).default('center'),
    collision: z.enum(staticSymbolCollisions).default('always-visible'),
    coordinate: overlayCoordinateSchema,
    icon: symbolIconSchema.optional(),
    id: z.string().trim().min(1).max(64).optional(),
    label: symbolLabelSchema.optional(),
    offset: z
      .tuple([z.number().finite().min(-256).max(256), z.number().finite().min(-256).max(256)])
      .default([0, 0]),
    opacity: z.number().finite().min(0).max(1).default(1),
    placement: overlayPlacementSchema,
    scale: z.number().finite().min(0.25).max(4).default(1),
    type: z.literal('symbol'),
  })
  .strict()
  .refine((value) => value.icon !== undefined || value.label !== undefined, {
    message: 'Static symbols require an icon or label',
  });

export const staticOverlaySchema = z.discriminatedUnion('type', [
  lineOverlaySchema,
  circleOverlaySchema,
  markerOverlaySchema,
  polygonOverlaySchema,
  symbolOverlaySchema,
]);

export const staticSceneSchema = z
  .object({
    attribution: staticAttributionRequestSchema.optional(),
    camera: z.discriminatedUnion('type', [
      centerCameraSchema,
      boundsCameraSchema,
      autoCameraSchema,
    ]),
    format: staticMapFormatSchema.optional(),
    map: portableIdSchema,
    overlays: z.array(staticOverlaySchema).max(staticSceneLimits.maxOverlays).default([]),
    size: sizeSchema,
    theme: concreteThemeSchema,
  })
  .strict();

export type StaticCoordinate = z.infer<typeof coordinateSchema>;
export type StaticAttributionMode = 'embedded' | 'external';
export type StaticAttributionPosition = z.infer<typeof staticAttributionPositionSchema>;
export type StaticAttributionRequest = z.infer<typeof staticAttributionRequestSchema>;
export type StaticMapFormat = z.infer<typeof staticMapFormatSchema>;
export type StaticPadding = z.infer<typeof staticPaddingSchema>;
export type StaticSceneInput = z.input<typeof staticSceneSchema>;
export type StaticScene = z.infer<typeof staticSceneSchema>;
export type StaticOverlayInput = z.input<typeof staticOverlaySchema>;
export type StaticOverlay = z.infer<typeof staticOverlaySchema>;
export type StaticOverlayPlacement = (typeof staticOverlayPlacements)[number];
export type StaticSymbolAnchor = (typeof staticSymbolAnchors)[number];
export type StaticSymbolCollision = (typeof staticSymbolCollisions)[number];
export type StaticSymbolLanguage = (typeof staticSymbolLanguages)[number];
export type StaticSymbolLabelAppearance = (typeof staticSymbolLabelAppearances)[number];
export type StaticSymbolLabelPosition = (typeof staticSymbolLabelPositions)[number];

export function isSupportedStaticSymbolCodePoint(codePoint: number) {
  return isSupportedStaticTextCodePoint(codePoint);
}
