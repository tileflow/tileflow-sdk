import {z} from 'zod';
import {roundNumber} from './canonical';
import {
  MAX_OVERLAY_LATITUDE,
  type StaticOverlay,
  type StaticPadding,
  staticPaddingSchema,
  type StaticScene,
  staticSceneLimits,
} from './scene-contract';

const autoFitOverlayReferenceSchema = z
  .object({
    id: z.string().min(1).max(64),
    index: z.number().int().min(0).max(23),
    type: z.enum(['circle', 'line', 'marker', 'polygon']),
  })
  .strict();

const autoFitViewportSchema = z
  .object({
    height: z.number().int().min(64).max(1280),
    width: z.number().int().min(64).max(1280),
  })
  .strict();

const autoFitDetailsSchema = z
  .object({
    overlay: autoFitOverlayReferenceSchema.optional(),
    padding: staticPaddingSchema.optional(),
    projection: z.enum(['globe', 'mercator']).optional(),
    requiredInsets: staticPaddingSchema.optional(),
    ringIndex: z.number().int().min(0).max(15).optional(),
    segmentIndex: z.number().int().min(0).max(1999).optional(),
    viewport: autoFitViewportSchema.optional(),
  })
  .strict();

export type StaticAutoFitDetails = z.infer<typeof autoFitDetailsSchema>;

const staticOverlayInvalidDetailsSchema = z
  .object({
    latitude: z.number().finite(),
    limit: z.literal(MAX_OVERLAY_LATITUDE),
    overlay: autoFitOverlayReferenceSchema,
  })
  .strict();

export type StaticMapRequestErrorDetails =
  | StaticAutoFitDetails
  | z.infer<typeof staticOverlayInvalidDetailsSchema>;

const autoFitErrorBase = {
  error: z.string().min(1).max(512),
  retryable: z.literal(false),
} as const;

export const staticMapRequestErrorResponseSchema = z.discriminatedUnion('code', [
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('AUTO_FIT_EMPTY'),
      reason: z.literal('NO_FITTABLE_OVERLAYS'),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('AUTO_FIT_AMBIGUOUS'),
      details: autoFitDetailsSchema,
      reason: z.literal('ANTIMERIDIAN_WRAP_REQUIRED'),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('AUTO_FIT_IMPOSSIBLE'),
      details: autoFitDetailsSchema.optional(),
      reason: z.enum([
        'GLOBE_NOT_SIMULTANEOUSLY_VISIBLE',
        'INSUFFICIENT_VIEWPORT',
        'CAMERA_UNRESOLVABLE',
        'PROJECTED_FOOTPRINT_OUTSIDE_VIEWPORT',
      ]),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('STATIC_OVERLAY_INVALID'),
      details: staticOverlayInvalidDetailsSchema,
      reason: z.literal('OVERLAY_LATITUDE_OUT_OF_RANGE'),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('STATIC_MAP_ATTRIBUTION_UNSUPPORTED'),
      reason: z.enum(['UNSUPPORTED_DECLARATION', 'UNSUPPORTED_GLYPH']),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('STATIC_MAP_ATTRIBUTION_TOO_LARGE'),
      reason: z.literal('CONTENT_LIMIT_EXCEEDED'),
    })
    .strict(),
  z
    .object({
      ...autoFitErrorBase,
      code: z.literal('STATIC_MAP_ATTRIBUTION_DOES_NOT_FIT'),
      reason: z.literal('BLOCK_DOES_NOT_FIT'),
    })
    .strict(),
]);

export type StaticMapRequestErrorResponse = z.infer<typeof staticMapRequestErrorResponseSchema>;
export type StaticAutoFitErrorResponse = Extract<
  StaticMapRequestErrorResponse,
  {code: `AUTO_FIT_${string}`}
>;

export class StaticMapRequestError extends Error {
  readonly code: StaticMapRequestErrorResponse['code'];
  readonly details?: StaticMapRequestErrorDetails;
  readonly reason: StaticMapRequestErrorResponse['reason'];
  readonly retryable = false;
  readonly status: number;

  constructor(response: StaticMapRequestErrorResponse, status = 422) {
    super(response.error);
    this.name = 'StaticMapRequestError';
    this.code = response.code;
    this.details = 'details' in response ? response.details : undefined;
    this.reason = response.reason;
    this.status = status;
  }
}

export const staticAutoFitPlanSchema = z
  .object({
    bounds: z.tuple([
      z.number().finite(),
      z.number().finite().min(-90).max(90),
      z.number().finite(),
      z.number().finite().min(-90).max(90),
    ]),
    longitudeOffsets: z.array(z.number().int().min(-360).max(360)).max(24),
    nominalInsets: staticPaddingSchema,
    requiredInsets: staticPaddingSchema,
  })
  .strict();

export type StaticAutoFitPlan = z.infer<typeof staticAutoFitPlanSchema>;

export type StaticAutoFitFailure = StaticAutoFitErrorResponse & {ok: false};
export type StaticMapRequestFailure = StaticMapRequestErrorResponse & {ok: false};
export type StaticAutoFitAnalysis = {ok: true; plan: StaticAutoFitPlan} | StaticAutoFitFailure;

type LongitudeComponent = {
  east: number;
  overlayIndex: number;
  west: number;
};

export function analyzeStaticAutoFit(scene: StaticScene): StaticAutoFitAnalysis {
  if (scene.camera.type !== 'auto') {
    throw new Error('Static auto-fit analysis requires an auto camera');
  }

  if (scene.overlays.length === 0) {
    return failure({
      code: 'AUTO_FIT_EMPTY',
      error: 'Auto-fit requires at least one overlay',
      reason: 'NO_FITTABLE_OVERLAYS',
      retryable: false,
    });
  }

  const components: LongitudeComponent[] = [];
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let nominalExpansion = 0;

  for (const [overlayIndex, overlay] of scene.overlays.entries()) {
    const coordinates = overlayCoordinates(overlay);
    const ambiguity = findAmbiguousSegment(overlay);

    if (ambiguity) {
      return failure({
        code: 'AUTO_FIT_AMBIGUOUS',
        details: {
          overlay: {
            id: overlay.id ?? `overlay-${overlayIndex + 1}`,
            index: overlayIndex,
            type: overlay.type,
          },
          ...(ambiguity.ringIndex === undefined ? {} : {ringIndex: ambiguity.ringIndex}),
          segmentIndex: ambiguity.segmentIndex,
        },
        error: `Overlay overlays.${overlayIndex} requires an explicit antimeridian wrap decision`,
        reason: 'ANTIMERIDIAN_WRAP_REQUIRED',
        retryable: false,
      });
    }

    const longitudes = coordinates.map(([longitude]) => longitude);
    components.push({
      east: Math.max(...longitudes),
      overlayIndex,
      west: Math.min(...longitudes),
    });

    for (const [, latitude] of coordinates) {
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }

    nominalExpansion = Math.max(nominalExpansion, nominalOverlayExpansion(overlay));
  }

  const longitudePlan = fitLongitudeComponents(components);
  const nominalInset = Math.ceil(nominalExpansion);
  const nominalInsets = allSides(nominalInset);
  const padding = normalizedPadding(scene.camera.padding, scene.size);

  if (
    [padding.bottom, padding.left, padding.right, padding.top].some(
      (value) => !Number.isSafeInteger(value + nominalInset),
    )
  ) {
    return failure({
      code: 'AUTO_FIT_IMPOSSIBLE',
      details: {
        padding,
        viewport: {height: scene.size.height, width: scene.size.width},
      },
      error: 'Auto-fit nominal footprint leaves no usable viewport',
      reason: 'INSUFFICIENT_VIEWPORT',
      retryable: false,
    });
  }

  const requiredInsets = {
    bottom: padding.bottom + nominalInset,
    left: padding.left + nominalInset,
    right: padding.right + nominalInset,
    top: padding.top + nominalInset,
  };

  if (
    requiredInsets.left + requiredInsets.right >= scene.size.width ||
    requiredInsets.top + requiredInsets.bottom >= scene.size.height
  ) {
    return failure({
      code: 'AUTO_FIT_IMPOSSIBLE',
      details: {
        padding,
        requiredInsets,
        viewport: {height: scene.size.height, width: scene.size.width},
      },
      error: 'Auto-fit nominal footprint leaves no usable viewport',
      reason: 'INSUFFICIENT_VIEWPORT',
      retryable: false,
    });
  }

  return {
    ok: true,
    plan: {
      bounds: [
        roundNumber(longitudePlan.west),
        roundNumber(south),
        roundNumber(longitudePlan.east),
        roundNumber(north),
      ],
      longitudeOffsets: longitudePlan.offsets,
      nominalInsets,
      requiredInsets,
    },
  };
}

function failure(response: StaticAutoFitErrorResponse): StaticAutoFitFailure {
  return {...response, ok: false};
}

function overlayCoordinates(overlay: StaticOverlay): Array<[number, number]> {
  if (overlay.type === 'circle' || overlay.type === 'marker') {
    return [overlay.coordinate];
  }

  if (overlay.type === 'line') {
    return overlay.coordinates;
  }

  return overlay.coordinates.flat();
}

function findAmbiguousSegment(
  overlay: StaticOverlay,
): {ringIndex?: number; segmentIndex: number} | null {
  if (overlay.type === 'circle' || overlay.type === 'marker') return null;

  const paths = overlay.type === 'line' ? [overlay.coordinates] : overlay.coordinates;

  for (const [ringIndex, path] of paths.entries()) {
    for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex += 1) {
      const start = path[segmentIndex];
      const end = path[segmentIndex + 1];

      if (start && end && Math.abs(end[0] - start[0]) >= 180) {
        return {
          ...(overlay.type === 'polygon' ? {ringIndex} : {}),
          segmentIndex,
        };
      }
    }
  }

  return null;
}

function nominalOverlayExpansion(overlay: StaticOverlay): number {
  if (overlay.type === 'circle' || overlay.type === 'marker') {
    return overlay.radius + overlay.strokeWidth;
  }

  if (overlay.type === 'line') {
    return overlay.width / 2 + 0.5;
  }

  return overlay.stroke && overlay.strokeWidth > 0 ? overlay.strokeWidth / 2 + 0.5 : 0;
}

function fitLongitudeComponents(components: LongitudeComponent[]): {
  east: number;
  offsets: number[];
  west: number;
} {
  const candidates = new Set<number>();

  for (const component of components) {
    candidates.add(toCircle(component.west));
    candidates.add(toCircle(component.east));
  }

  let best:
    | {
        assignedStarts: number[];
        east: number;
        span: number;
        west: number;
      }
    | undefined;

  for (const cut of [...candidates].sort((left, right) => left - right)) {
    const assignedStarts: number[] = [];
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    let valid = true;

    for (const component of components) {
      const width = component.east - component.west;
      let start = toCircle(component.west);
      if (start < cut) start += 360;
      const end = start + width;

      if (end > cut + 360 + 1e-9) {
        valid = false;
        break;
      }

      assignedStarts.push(start);
      west = Math.min(west, start);
      east = Math.max(east, end);
    }

    if (!valid) continue;

    const span = east - west;
    const canonicalWest = canonicalLongitude(west - 180);
    const bestCanonicalWest = best ? canonicalLongitude(best.west - 180) : Number.POSITIVE_INFINITY;

    if (
      !best ||
      span < best.span - 1e-9 ||
      (Math.abs(span - best.span) <= 1e-9 && canonicalWest < bestCanonicalWest)
    ) {
      best = {assignedStarts, east, span, west};
    }
  }

  if (!best) {
    const west = Math.min(...components.map((component) => component.west));
    const east = Math.max(...components.map((component) => component.east));
    return {east, offsets: components.map(() => 0), west};
  }

  const unshiftedWest = best.west - 180;
  const canonicalWest = canonicalLongitude(unshiftedWest);
  const globalOffset = canonicalWest - unshiftedWest;
  const offsets = components.map((component, index) => {
    const assignedLongitude = (best?.assignedStarts[index] ?? 0) - 180 + globalOffset;
    return Math.round(assignedLongitude - component.west);
  });

  return {
    east: canonicalWest + best.span,
    offsets,
    west: canonicalWest,
  };
}

function toCircle(longitude: number): number {
  const value = (longitude + 180) % 360;
  return value < 0 ? value + 360 : value;
}

function canonicalLongitude(longitude: number): number {
  const value = (((longitude + 180) % 360) + 360) % 360;
  return value - 180;
}

function allSides(value: number): StaticPadding {
  return {bottom: value, left: value, right: value, top: value};
}

function normalizedPadding(
  padding: number | Partial<StaticPadding> | undefined,
  size: {height: number; width: number},
): StaticPadding {
  if (padding === undefined) {
    return allSides(Math.min(32, Math.ceil(Math.min(size.width, size.height) * 0.05)));
  }

  if (typeof padding === 'number') return allSides(padding);

  return {
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
    right: padding.right ?? 0,
    top: padding.top ?? 0,
  };
}

export function autoFitErrorResponse(failure: StaticAutoFitFailure): StaticAutoFitErrorResponse {
  const {ok: _ok, ...response} = failure;
  return response;
}

export function findStaticOverlayLatitudeFailure(input: unknown): StaticMapRequestFailure | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const overlays = (input as {overlays?: unknown}).overlays;
  if (!Array.isArray(overlays)) return null;

  for (const [index, candidate] of overlays.entries()) {
    if (index >= staticSceneLimits.maxOverlays) break;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const overlay = candidate as Record<string, unknown>;
    const type = overlay.type;
    if (!['circle', 'line', 'marker', 'polygon'].includes(String(type))) continue;
    const coordinates =
      type === 'circle' || type === 'marker'
        ? [overlay.coordinate]
        : overlayCoordinateCandidates(type, overlay.coordinates);

    for (const coordinate of coordinates) {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length !== 2 ||
        typeof coordinate[1] !== 'number' ||
        !Number.isFinite(coordinate[1]) ||
        Math.abs(coordinate[1]) <= MAX_OVERLAY_LATITUDE
      ) {
        continue;
      }

      const id =
        typeof overlay.id === 'string' && overlay.id.trim()
          ? overlay.id.trim()
          : `overlay-${index + 1}`;
      const response: StaticMapRequestErrorResponse = {
        code: 'STATIC_OVERLAY_INVALID',
        details: {
          latitude: coordinate[1],
          limit: MAX_OVERLAY_LATITUDE,
          overlay: {
            id: id.slice(0, 64),
            index,
            type: type as 'circle' | 'line' | 'marker' | 'polygon',
          },
        },
        error: `Overlay overlays.${index} latitude ${coordinate[1]} exceeds the supported ±${MAX_OVERLAY_LATITUDE}° range`,
        reason: 'OVERLAY_LATITUDE_OUT_OF_RANGE',
        retryable: false,
      };

      return {...response, ok: false};
    }
  }

  return null;
}

function overlayCoordinateCandidates(type: unknown, value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];

  if (type === 'line') {
    return value.slice(0, staticSceneLimits.maxPathCoordinates);
  }

  return value
    .slice(0, 16)
    .flatMap((ring) =>
      Array.isArray(ring) ? ring.slice(0, staticSceneLimits.maxPathCoordinates) : [],
    );
}
