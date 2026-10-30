import {z} from 'zod';
import {maximumPitch} from './camera-contract';

// The person's location on the map: how the renderer draws it, the fixes and headings the host
// passes on from its location provider, and the follow modes that keep the camera on it.

const finite = z.number().finite();
/** Degrees clockwise from true north. */
const direction = finite.min(0).max(360);

/** How the renderer draws the location. The host replays these with the map's options. */
export const locationOptionsSchema = z.strictObject({
  /** Draws the location. Positions reach the renderer only while the host enables it. */
  enabled: z.boolean().default(false),
  /** What the puck's direction indicator shows: nothing, the device heading or the course. */
  bearing: z.enum(['none', 'heading', 'course']).default('none'),
  /** Draws a circle of the fix's horizontal accuracy around the puck. */
  accuracy: z.boolean().default(true),
  /** A fix older than this is drawn as stale, in milliseconds. */
  staleAfterMs: z
    .number()
    .int()
    .min(1000)
    .max(60 * 60 * 1000)
    .default(30_000),
});
export type LocationOptions = z.infer<typeof locationOptionsSchema>;

/** A fix from the host's location provider. */
export const fixSchema = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
  /** The radius of uncertainty, in metres. */
  accuracy: finite.min(0).max(1_000_000).optional(),
  /** The direction of travel. */
  course: direction.optional(),
  /** How old the fix was when the host sent it, in milliseconds. */
  age: finite
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .default(0),
});
export type Fix = z.infer<typeof fixSchema>;

/** An absent field keeps what the renderer has; null clears it. */
export const locationUpdateSchema = z.strictObject({
  location: fixSchema.nullable().optional(),
  heading: z.strictObject({direction}).nullable().optional(),
});
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;

export const followModeSchema = z.enum(['none', 'position', 'heading', 'course']);
export type FollowMode = z.infer<typeof followModeSchema>;

export const followRequestSchema = z.strictObject({
  mode: followModeSchema,
  /** Zooms in to at least this level while the camera starts to follow. */
  minimumZoom: finite.min(0).max(24).optional(),
  /** The pitch to reach while the camera starts to follow. */
  pitch: finite.min(0).max(maximumPitch).optional(),
  /** In the `position` mode, the bearing to turn to; the other modes turn with the puck. */
  bearing: finite.min(-360).max(360).optional(),
  /** How long the camera takes to reach the location, in milliseconds; 0 jumps there. */
  duration: finite.min(0).max(5000).default(0),
  /**
   * The host's count of its requests. `followModeChanged` names the request it ended, so a host
   * can tell an end that a later request already replaced.
   */
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export type FollowRequest = z.infer<typeof followRequestSchema>;
