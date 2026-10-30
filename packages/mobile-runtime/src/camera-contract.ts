import {z} from 'zod';

/** Tileflow's steepest pitch, as `tileflowMaxPitch` in Core: the camera can look along a street. */
export const maximumPitch = 85;

const finite = z.number().finite();
const zoom = finite.min(0).max(24);
const pitch = finite.min(0).max(maximumPitch);
const bearing = finite.min(-360).max(360);
const coordinate = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
});
/** An east edge west of the west edge describes a region crossing the antimeridian. */
export const boundsSchema = z
  .strictObject({
    west: finite.min(-180).max(180),
    south: finite.min(-90).max(90),
    east: finite.min(-180).max(180),
    north: finite.min(-90).max(90),
  })
  .refine((value) => value.south <= value.north);
export type Bounds = z.infer<typeof boundsSchema>;
/** Space at each edge of the view, in CSS pixels, that the camera treats as covered. */
export const insetsSchema = z.strictObject({
  top: finite.min(0).max(8192),
  left: finite.min(0).max(8192),
  bottom: finite.min(0).max(8192),
  right: finite.min(0).max(8192),
});
export type Insets = z.infer<typeof insetsSchema>;
/** A cubic Bézier timing curve through (0, 0) and (1, 1), as CSS `cubic-bezier()`. */
const easing = z.tuple([
  finite.min(0).max(1),
  finite.min(-8).max(8),
  finite.min(0).max(1),
  finite.min(-8).max(8),
]);
// Animations end well before a request times out, so every movement answers with its outcome.
const duration = finite.min(0).max(20_000);
export const maximumAnimationMs = 20_000;
export const animationSchema = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('jump')}),
  z.strictObject({type: z.literal('ease'), duration, easing: easing.optional()}),
  z.strictObject({
    type: z.literal('fly'),
    duration: duration.optional(),
    speed: finite.min(0.01).max(100).optional(),
    curve: finite.min(0.01).max(100).optional(),
    minZoom: zoom.optional(),
    easing: easing.optional(),
  }),
]);
export type Animation = z.infer<typeof animationSchema>;
const fitSchema = z.strictObject({
  bounds: boundsSchema,
  padding: insetsSchema.optional(),
  bearing: bearing.optional(),
  pitch: pitch.optional(),
  maxZoom: zoom.optional(),
});
export type Fit = z.infer<typeof fitSchema>;
export const cameraForBoundsSchema = fitSchema;
export const moveCameraSchema = z
  .strictObject({
    target: z
      .strictObject({
        center: coordinate.optional(),
        zoom: zoom.optional(),
        bearing: bearing.optional(),
        pitch: pitch.optional(),
      })
      .optional(),
    fit: fitSchema.optional(),
    animation: animationSchema,
    /** Native map controls move the camera for a person, as the renderer's own controls do. */
    reason: z.enum(['api', 'gesture']).default('api'),
  })
  .refine((value) => (value.target === undefined) !== (value.fit === undefined));
export type MoveCamera = z.infer<typeof moveCameraSchema>;
export const limitsSchema = z
  .strictObject({
    minZoom: zoom.default(0),
    maxZoom: zoom.default(24),
    minPitch: pitch.default(0),
    maxPitch: pitch.default(maximumPitch),
    bounds: boundsSchema.nullable().default(null),
  })
  .refine((value) => value.minZoom <= value.maxZoom && value.minPitch <= value.maxPitch);
export type Limits = z.infer<typeof limitsSchema>;
export const gesturesSchema = z.strictObject({
  pan: z.boolean().default(true),
  zoom: z.boolean().default(true),
  rotate: z.boolean().default(true),
  pitch: z.boolean().default(true),
  doubleTapZoom: z.boolean().default(true),
  /** Zoom levels one double tap adds. */
  doubleTapZoomDelta: finite.min(0.25).max(4).default(1),
  /** One finger scrolls the surrounding page; two fingers move the map. */
  cooperative: z.boolean().default(false),
});
export type Gestures = z.infer<typeof gesturesSchema>;
export const cornerSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
export type Corner = z.infer<typeof cornerSchema>;
