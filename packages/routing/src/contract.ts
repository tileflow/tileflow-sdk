import {z} from 'zod';

/**
 * Wire contract of the Tileflow Routing API. Positions are `[longitude, latitude]` in WGS84;
 * distances are metres and durations seconds, estimated without traffic.
 */

export const routingModes = ['driving', 'walking', 'cycling'] as const;
export type RoutingMode = (typeof routingModes)[number];

/** Languages the instructions can be written in. */
export const routingLanguages = [
  'ar-SA',
  'bg-BG',
  'ca-ES',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'el-GR',
  'en-AU',
  'en-GB',
  'en-US',
  'es-ES',
  'et-EE',
  'fi-FI',
  'fr-FR',
  'hi-IN',
  'hu-HU',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'mn-MN',
  'nb-NO',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'sk-SK',
  'sl-SI',
  'sv-SE',
  'tr-TR',
  'uk-UA',
  'vi-VN',
] as const;
export type RoutingLanguage = (typeof routingLanguages)[number];

export const routingLimits = Object.freeze({
  maximumRequestBytes: 8 * 1024,
  maximumResponseBytes: 4 * 1024 * 1024,
  minimumLocations: 2,
  maximumLocations: 5,
  maximumAlternatives: 2,
  /** Sum of straight-line distances between consecutive locations, per mode. */
  maximumDirectDistanceMeters: Object.freeze({
    driving: 1_000_000,
    walking: 100_000,
    cycling: 300_000,
  } satisfies Record<RoutingMode, number>),
  maximumContours: 4,
  minimumMinutes: 1,
  maximumMinutes: 60,
  maximumSteps: 2_000,
  maximumGeometryPositions: 200_000,
  maximumIsochroneVertices: 200_000,
});

export const routingAttribution = '© OpenStreetMap contributors';

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
export const routingPositionSchema = z.tuple([longitude, latitude]);
export type RoutingPosition = z.infer<typeof routingPositionSchema>;

/** Great-circle distance in metres between two positions. */
export function routingDirectDistance(a: RoutingPosition, b: RoutingPosition): number {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLng = (b[0] - a[0]) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const routingRouteRequestSchema = z
  .object({
    locations: z
      .array(routingPositionSchema)
      .min(routingLimits.minimumLocations)
      .max(routingLimits.maximumLocations),
    mode: z.enum(routingModes),
    alternatives: z.number().int().min(0).max(routingLimits.maximumAlternatives).optional(),
    language: z.enum(routingLanguages).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.alternatives ?? 0) > 0 && request.locations.length !== 2) {
      context.addIssue({
        code: 'custom',
        path: ['alternatives'],
        message: 'Alternatives are available only between two locations.',
      });
    }
    let distance = 0;
    for (let index = 1; index < request.locations.length; index += 1) {
      distance += routingDirectDistance(request.locations[index - 1]!, request.locations[index]!);
    }
    if (distance > routingLimits.maximumDirectDistanceMeters[request.mode]) {
      context.addIssue({
        code: 'custom',
        path: ['locations'],
        message: `The locations are too far apart for ${request.mode}.`,
      });
    }
  });
export type RoutingRouteRequest = z.input<typeof routingRouteRequestSchema>;
export type NormalizedRoutingRouteRequest = z.output<typeof routingRouteRequestSchema>;

export const routingIsochroneRequestSchema = z
  .object({
    location: routingPositionSchema,
    mode: z.enum(routingModes),
    minutes: z
      .array(z.number().int().min(routingLimits.minimumMinutes).max(routingLimits.maximumMinutes))
      .min(1)
      .max(routingLimits.maximumContours),
  })
  .strict()
  .superRefine((request, context) => {
    for (let index = 1; index < request.minutes.length; index += 1) {
      if (request.minutes[index]! <= request.minutes[index - 1]!) {
        context.addIssue({
          code: 'custom',
          path: ['minutes'],
          message: 'Minutes rise strictly.',
        });
        return;
      }
    }
  });
export type RoutingIsochroneRequest = z.input<typeof routingIsochroneRequestSchema>;
export type NormalizedRoutingIsochroneRequest = z.output<typeof routingIsochroneRequestSchema>;

/** What a step asks the traveller to do. */
export const routingManeuvers = [
  'depart',
  'arrive',
  'continue',
  'slight-right',
  'right',
  'sharp-right',
  'u-turn',
  'sharp-left',
  'left',
  'slight-left',
  'ramp-straight',
  'ramp-right',
  'ramp-left',
  'exit-right',
  'exit-left',
  'keep-straight',
  'keep-right',
  'keep-left',
  'merge',
  'merge-right',
  'merge-left',
  'roundabout-enter',
  'roundabout-exit',
  'ferry-enter',
  'ferry-exit',
  'elevator',
  'stairs',
  'escalator',
  'building-enter',
  'building-exit',
] as const;
export type RoutingManeuver = (typeof routingManeuvers)[number];

const meters = z.number().finite().min(0);
const seconds = z.number().finite().min(0);
const text = z.string().min(1).max(500);

export const routingStepSchema = z
  .object({
    maneuver: z.enum(routingManeuvers),
    instruction: text,
    /** Street names and road numbers the step follows, as OpenStreetMap records them. */
    names: z.array(z.string().min(1).max(200)).max(8).optional(),
    /** Exit number of a highway exit. */
    exit: z.string().min(1).max(50).optional(),
    /** Destinations signed at a highway exit or ramp. */
    toward: z.array(z.string().min(1).max(200)).max(8).optional(),
    /** Exit to take at a roundabout, counted from the entry. */
    roundaboutExit: z.number().int().min(1).max(32).optional(),
    distance: meters,
    duration: seconds,
    location: routingPositionSchema,
  })
  .strict();
export type RoutingStep = z.infer<typeof routingStepSchema>;

export const routingLineStringSchema = z
  .object({
    type: z.literal('LineString'),
    coordinates: z.array(routingPositionSchema).min(2).max(routingLimits.maximumGeometryPositions),
  })
  .strict();

export const routingLegSchema = z
  .object({
    distance: meters,
    duration: seconds,
    steps: z.array(routingStepSchema).min(1).max(routingLimits.maximumSteps),
  })
  .strict();

export const routingRouteSchema = z
  .object({
    distance: meters,
    duration: seconds,
    geometry: routingLineStringSchema,
    legs: z
      .array(routingLegSchema)
      .min(1)
      .max(routingLimits.maximumLocations - 1),
  })
  .strict();
export type RoutingRoute = z.infer<typeof routingRouteSchema>;

export const routingNetworkSchema = z
  .object({releaseId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u)})
  .strict();

export const routingUsageSchema = z.object({units: z.number().int().min(0)}).strict();

const ring = z.array(routingPositionSchema).min(4);
const polygon = z.object({type: z.literal('Polygon'), coordinates: z.array(ring).min(1)}).strict();
const multiPolygon = z
  .object({type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1)})
  .strict();

export const routingIsochroneFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    properties: z
      .object({
        minutes: z
          .number()
          .int()
          .min(routingLimits.minimumMinutes)
          .max(routingLimits.maximumMinutes),
      })
      .strict(),
    geometry: z.union([polygon, multiPolygon]),
  })
  .strict();

export const routingIsochroneCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(routingIsochroneFeatureSchema).min(1).max(routingLimits.maximumContours),
  })
  .strict();

const answer = {
  schemaVersion: z.literal(1),
  network: routingNetworkSchema,
  attribution: z.literal(routingAttribution),
};

/** A route answer. */
export const routingRouteResponseSchema = z
  .object({
    ...answer,
    routes: z
      .array(routingRouteSchema)
      .min(1)
      .max(routingLimits.maximumAlternatives + 1),
    usage: routingUsageSchema,
  })
  .strict();
export type RoutingRouteResponse = z.infer<typeof routingRouteResponseSchema>;

/** An isochrone answer. */
export const routingIsochroneResponseSchema = z
  .object({...answer, isochrones: routingIsochroneCollectionSchema, usage: routingUsageSchema})
  .strict();
export type RoutingIsochroneResponse = z.infer<typeof routingIsochroneResponseSchema>;

export const routingOperations = ['route', 'isochrone'] as const;
export type RoutingOperation = (typeof routingOperations)[number];

export const routingErrorCodes = [
  'ROUTING_INVALID_REQUEST',
  'ROUTING_REQUEST_TOO_LARGE',
  'ROUTING_ACCESS_DENIED',
  'ROUTING_ORIGIN_NOT_ALLOWED',
  'ROUTING_NO_ROUTE',
  'ROUTING_RATE_LIMITED',
  'ROUTING_QUOTA_EXCEEDED',
  'ROUTING_CANCELLED',
  'ROUTING_INVALID_RESPONSE',
  'ROUTING_UNAVAILABLE',
  'ROUTING_TIMEOUT',
] as const;
export type RoutingErrorCode = (typeof routingErrorCodes)[number];

export const routingErrorStatus = Object.freeze({
  ROUTING_INVALID_REQUEST: 400,
  ROUTING_REQUEST_TOO_LARGE: 413,
  ROUTING_ACCESS_DENIED: 403,
  ROUTING_ORIGIN_NOT_ALLOWED: 403,
  ROUTING_NO_ROUTE: 422,
  ROUTING_RATE_LIMITED: 429,
  ROUTING_QUOTA_EXCEEDED: 429,
  ROUTING_CANCELLED: 499,
  ROUTING_INVALID_RESPONSE: 502,
  ROUTING_UNAVAILABLE: 503,
  ROUTING_TIMEOUT: 504,
} satisfies Record<RoutingErrorCode, number>);
