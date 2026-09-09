import {z} from 'zod';
import {
  coordinatesAxisSchema,
  coordinatesAxisNormalizationSchema,
  coordinatesCrsDescriptionSchema,
  coordinatesCrsSummarySchema,
  isCoordinatesAxisNormalizationValid,
  coordinatesOperationSchema,
} from './catalog';
import {coordinatesFailureSchema} from './errors';
import {
  coordinatesAnalyticProofIdSchema,
  coordinatesBoundsSchema,
  coordinatesCrsIdSchema,
  coordinatesCursorSchema,
  coordinatesInvocationIdSchema,
  coordinatesLimits,
  coordinatesOperationRefSchema,
  coordinatesPolicySchema,
  coordinatesPositionSchema,
  coordinatesProvenanceSchema,
  coordinatesReleaseIdSchema,
  coordinatesUsageSchema,
  coordinatesWarningSchema,
} from './shared';

const common = {
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  invocationId: coordinatesInvocationIdSchema.optional(),
  releaseId: coordinatesReleaseIdSchema,
  provenance: coordinatesProvenanceSchema,
  warnings: z.array(coordinatesWarningSchema).max(200),
  usage: coordinatesUsageSchema,
};
const page = {
  total: z.number().int().nonnegative(),
  nextCursor: coordinatesCursorSchema.nullable(),
};

export const coordinatesTransformAxesSchema = z
  .object({
    official: z.array(coordinatesAxisSchema).min(2).max(3),
    normalized: z.array(coordinatesAxisSchema).min(2).max(3),
    normalization: coordinatesAxisNormalizationSchema.nullable().optional(),
  })
  .strict()
  .superRefine((axes, ctx) => {
    if (
      axes.normalized.length < 2 ||
      axes.official.length !== axes.normalized.length ||
      (axes.normalization === undefined &&
        (axes.normalized[0].direction !== 'east' ||
          axes.normalized[1].direction !== 'north' ||
          (axes.normalized.length === 3 && axes.normalized[2].direction !== 'up'))) ||
      (axes.normalization !== undefined &&
        axes.normalization !== null &&
        !isCoordinatesAxisNormalizationValid(axes.official, axes.normalized, axes.normalization))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['normalization'],
        message: 'Axis normalization is not a complete signed permutation',
      });
    }
  });

export const coordinatesSearchResponseSchema = z
  .object({
    ...common,
    command: z.literal('search'),
    result: z
      .object({
        ...page,
        items: z.array(coordinatesCrsSummarySchema).max(coordinatesLimits.maximumPageSize),
      })
      .strict(),
  })
  .strict();

export const coordinatesDescribeResponseSchema = z
  .object({
    ...common,
    command: z.literal('describe'),
    result: coordinatesCrsDescriptionSchema,
  })
  .strict();

export const coordinatesOperationsResponseSchema = z
  .object({
    ...common,
    command: z.literal('operations'),
    result: z
      .object({
        ...page,
        from: coordinatesCrsIdSchema,
        to: coordinatesCrsIdSchema,
        operations: z.array(coordinatesOperationSchema).max(coordinatesLimits.maximumPageSize),
      })
      .strict(),
  })
  .strict();

export const coordinatesSelectionSchema = z
  .object({
    mode: z.enum(['automatic', 'explicit']),
    bestKnown: z
      .object({
        relation: z.enum(['same', 'different']),
        operationRef: coordinatesOperationRefSchema,
      })
      .strict(),
    relaxationsApplied: z
      .array(z.enum(['ballpark', 'best-known']))
      .max(2)
      .refine((items) => new Set(items).size === items.length, {message: 'Duplicate relaxation'}),
  })
  .strict();

export const coordinatesTransformResultSchema = z
  .object({
    position: coordinatesPositionSchema,
    operationRef: coordinatesOperationRefSchema,
    selection: coordinatesSelectionSchema,
    height: z.enum([
      'absent',
      'auxiliary-preserved',
      'crs-preserved',
      'transformed',
      'not-applicable',
    ]),
    applicability: z
      .object({
        crsArea: z.literal('verified'),
        operationArea: z.enum(['verified', 'not-provided']),
        gridCoverage: z.enum(['verified', 'not-required']),
        executionDomain: z.literal('verified'),
      })
      .strict(),
    analyticalProof: z
      .object({proofId: coordinatesAnalyticProofIdSchema, status: z.literal('verified')})
      .strict()
      .optional(),
  })
  .strict();

export const coordinatesTransformResponseSchema = z
  .object({
    ...common,
    command: z.literal('transform'),
    result: z
      .object({
        from: coordinatesCrsSummarySchema,
        to: coordinatesCrsSummarySchema,
        axes: z
          .object({from: coordinatesTransformAxesSchema, to: coordinatesTransformAxesSchema})
          .strict(),
        areaOfInterest: coordinatesBoundsSchema.optional(),
        policy: coordinatesPolicySchema,
        results: z
          .array(coordinatesTransformResultSchema)
          .min(1)
          .max(coordinatesLimits.maximumPositions),
        operations: z
          .array(coordinatesOperationSchema)
          .min(1)
          .max(coordinatesLimits.maximumTransformOperations),
      })
      .strict(),
  })
  .strict();

export const coordinatesSuccessSchemas = Object.freeze({
  search: coordinatesSearchResponseSchema,
  describe: coordinatesDescribeResponseSchema,
  operations: coordinatesOperationsResponseSchema,
  transform: coordinatesTransformResponseSchema,
});

export const coordinatesResponseSchema = z.union([
  coordinatesFailureSchema,
  coordinatesSearchResponseSchema,
  coordinatesDescribeResponseSchema,
  coordinatesOperationsResponseSchema,
  coordinatesTransformResponseSchema,
]);

export type CoordinatesSuccess<C extends keyof typeof coordinatesSuccessSchemas> = z.infer<
  (typeof coordinatesSuccessSchemas)[C]
>;
export type CoordinatesResponse<C extends keyof typeof coordinatesSuccessSchemas> =
  | CoordinatesSuccess<C>
  | z.infer<typeof coordinatesFailureSchema>;
export type CoordinatesTransformResponse = z.infer<typeof coordinatesTransformResponseSchema>;
export type CoordinatesSearchResponse = z.infer<typeof coordinatesSearchResponseSchema>;
export type CoordinatesDescribeResponse = z.infer<typeof coordinatesDescribeResponseSchema>;
export type CoordinatesOperationsResponse = z.infer<typeof coordinatesOperationsResponseSchema>;
