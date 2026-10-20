import {z} from 'zod';
import {elevationLimits, elevationUnits} from './constants';

export * from './constants';

/**
 * Wire contract of Tileflow Elevation: `POST /v1/elevation/points` answers the heights of up to 100
 * positions and `POST /v1/elevation/profile` samples a line at an even interval and summarizes its
 * climbs and grades. Every length in a request or an answer uses the request's `unit`.
 */

export const elevationOperations = ['points', 'profile'] as const;
export type ElevationOperation = (typeof elevationOperations)[number];

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
export const elevationPositionSchema = z.tuple([longitude, latitude]);
export type ElevationPosition = z.infer<typeof elevationPositionSchema>;
const linePosition = z.union([
  elevationPositionSchema,
  z.tuple([longitude, latitude, z.number().finite()]),
]);
const unit = z.enum(elevationUnits).optional();

export const elevationPointsRequestSchema = z
  .object({
    positions: z.array(elevationPositionSchema).min(1).max(elevationLimits.maximumPoints),
    unit,
  })
  .strict();
export type ElevationPointsRequest = z.input<typeof elevationPointsRequestSchema>;

export const elevationLineStringSchema = z
  .object({
    type: z.literal('LineString'),
    coordinates: z.array(linePosition).min(2).max(elevationLimits.maximumLinePositions),
  })
  .strict();
export const elevationMultiLineStringSchema = z
  .object({
    type: z.literal('MultiLineString'),
    coordinates: z
      .array(z.array(linePosition).min(2).max(elevationLimits.maximumLinePositions))
      .min(1)
      .max(elevationLimits.maximumLines),
  })
  .strict();
export type ElevationLineString = z.input<typeof elevationLineStringSchema>;
export type ElevationMultiLineString = z.input<typeof elevationMultiLineStringSchema>;

export const elevationProfileRequestSchema = z
  .object({
    line: z
      .discriminatedUnion('type', [elevationLineStringSchema, elevationMultiLineStringSchema])
      .optional(),
    polyline: z
      .object({
        encoded: z.string().min(2).max(elevationLimits.maximumPolylineCharacters),
        precision: z.union([z.literal(5), z.literal(6)]).optional(),
      })
      .strict()
      .optional(),
    interval: z.number().finite().positive().optional(),
    maxSamples: z
      .number()
      .int()
      .min(elevationLimits.minimumSamples)
      .max(elevationLimits.maximumSamples)
      .optional(),
    climbThreshold: z.number().finite().min(0).optional(),
    unit,
  })
  .strict()
  .refine((value) => (value.line === undefined) !== (value.polyline === undefined), {
    message: 'Send exactly one of line or polyline.',
  });
export type ElevationProfileRequest = z.input<typeof elevationProfileRequestSchema>;

const elevation = z.number().finite().nullable();
const common = {
  schemaVersion: z.literal(1),
  unit: z.enum(elevationUnits),
  /** The Terrain release read and the tile zoom sampled. */
  dataset: z
    .object({releaseId: z.string().min(1).max(128), zoom: z.number().int().min(0).max(24)})
    .strict(),
  /** The credit to show with the data. */
  attribution: z.string().min(1).max(16_384),
  usage: z.object({units: z.number().int().min(1)}).strict(),
};

export const elevationPointsResponseSchema = z
  .object({...common, positions: z.array(z.tuple([longitude, latitude, elevation]))})
  .strict();
export type ElevationPointsResponse = z.infer<typeof elevationPointsResponseSchema>;

export const elevationProfileSummarySchema = z
  .object({
    distance: z.number().finite().min(0),
    ascent: z.number().finite().min(0).nullable(),
    descent: z.number().finite().min(0).nullable(),
    minElevation: elevation,
    maxElevation: elevation,
    startElevation: elevation,
    endElevation: elevation,
    /** Steepest uphill grade in percent, over a run of at least 100 m. */
    maxGrade: z.number().finite().nullable(),
    /** Steepest downhill grade in percent, over a run of at least 100 m. */
    minGrade: z.number().finite().nullable(),
  })
  .strict();
export type ElevationProfileSummary = z.infer<typeof elevationProfileSummarySchema>;

/** `[longitude, latitude, elevation, distance]`, the distance along the line from its start. */
export type ElevationProfileSample = [number, number, number | null, number];

export const elevationProfileResponseSchema = z
  .object({
    ...common,
    interval: z.number().finite().positive(),
    samples: z.array(z.tuple([longitude, latitude, elevation, z.number().finite().min(0)])),
    /** The first and last sample index of each line, in request order. */
    lines: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
    summary: elevationProfileSummarySchema,
  })
  .strict();
export type ElevationProfileResponse = z.infer<typeof elevationProfileResponseSchema>;

export const elevationErrorCodes = [
  'ELEVATION_INVALID_REQUEST',
  'ELEVATION_REQUEST_TOO_LARGE',
  'ELEVATION_ACCESS_DENIED',
  'ELEVATION_ORIGIN_NOT_ALLOWED',
  'ELEVATION_RATE_LIMITED',
  'ELEVATION_QUOTA_EXCEEDED',
  'ELEVATION_CANCELLED',
  'ELEVATION_UNAVAILABLE',
  'ELEVATION_TIMEOUT',
] as const;
export type ElevationErrorCode = (typeof elevationErrorCodes)[number];

export const elevationErrorStatus = Object.freeze({
  ELEVATION_INVALID_REQUEST: 400,
  ELEVATION_REQUEST_TOO_LARGE: 413,
  ELEVATION_ACCESS_DENIED: 403,
  ELEVATION_ORIGIN_NOT_ALLOWED: 403,
  ELEVATION_RATE_LIMITED: 429,
  ELEVATION_QUOTA_EXCEEDED: 429,
  ELEVATION_CANCELLED: 499,
  ELEVATION_UNAVAILABLE: 503,
  ELEVATION_TIMEOUT: 504,
} satisfies Record<ElevationErrorCode, number>);
