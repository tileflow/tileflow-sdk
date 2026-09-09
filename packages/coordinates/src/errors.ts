import {z} from 'zod';
import {coordinatesIneligibilityReasonSchema} from './catalog';
import {
  coordinatesCommandSchema,
  coordinatesCrsIdSchema,
  coordinatesInvocationIdSchema,
  coordinatesLocalUsageSchema,
  coordinatesOperationRefSchema,
  coordinatesProvenanceSchema,
  coordinatesReleaseIdSchema,
  coordinatesText,
  coordinatesWarningSchema,
} from './shared';

export const coordinatesErrorCodes = [
  'COORDINATES_INVALID_REQUEST',
  'COORDINATES_INVALID_RESPONSE',
  'COORDINATES_CRS_NOT_FOUND',
  'COORDINATES_UNSUPPORTED_CRS',
  'COORDINATES_CRS_DIMENSION_MISMATCH',
  'COORDINATES_OPERATION_NOT_FOUND',
  'COORDINATES_OPERATION_MISMATCH',
  'COORDINATES_NO_APPLICABLE_OPERATION',
  'COORDINATES_MISSING_GRID',
  'COORDINATES_OUTSIDE_AREA',
  'COORDINATES_APPLICABILITY_UNDETERMINED',
  'COORDINATES_BALLPARK_DISALLOWED',
  'COORDINATES_BEST_KNOWN_UNAVAILABLE',
  'COORDINATES_RELEASE_UNAVAILABLE',
  'COORDINATES_RELEASE_MISMATCH',
  'COORDINATES_RELEASE_INVALID',
  'COORDINATES_ACCESS_DENIED',
  'COORDINATES_QUOTA_EXCEEDED',
  'COORDINATES_RATE_LIMITED',
  'COORDINATES_UNAVAILABLE',
  'COORDINATES_TIMEOUT',
  'COORDINATES_CANCELLED',
  'COORDINATES_CONSUMPTION_UNCONFIRMED',
] as const;
export const coordinatesErrorCodeSchema = z.enum(coordinatesErrorCodes);
export const coordinatesErrorReasonSchema = z.enum([
  'INVALID_JSON',
  'INVALID_VALUE',
  'UNKNOWN_FIELD',
  'INVALID_POSITION',
  'REQUEST_TOO_LARGE',
  'MIXED_POSITION_DIMENSIONS',
  'CRS_DIMENSION_MISMATCH',
  'UNSUPPORTED_CRS_PROFILE',
  'UNSUPPORTED_AXIS_PROFILE',
  'CRS_NOT_FOUND',
  'OPERATION_NOT_FOUND',
  'OPERATION_BINDING_MISMATCH',
  'OPERATION_UNUSABLE',
  'MISSING_GRID',
  'GRID_NODATA',
  'OUTSIDE_CRS_AREA',
  'OUTSIDE_OPERATION_AREA',
  'OUTSIDE_GRID',
  'OUTSIDE_EXECUTION_DOMAIN',
  'APPLICABILITY_UNDETERMINED',
  'NO_OPERATION',
  'BALLPARK_NOT_ALLOWED',
  'BEST_KNOWN_UNAVAILABLE',
  'BEST_KNOWN_UNDETERMINED',
  'RELEASE_UNAVAILABLE',
  'RUNTIME_PROFILE_UNSUPPORTED',
  'RELEASE_MISMATCH',
  'RELEASE_INTEGRITY_FAILED',
  'RESPONSE_SHAPE_INVALID',
  'RESULT_COUNT_MISMATCH',
  'RESULT_DIMENSION_MISMATCH',
  'UNKNOWN_OPERATION_REF',
  'DUPLICATE_OPERATION_REF',
  'UNUSED_OPERATION',
  'DUPLICATE_CRS_ID',
  'PROVENANCE_MISMATCH',
  'POLICY_MISMATCH',
  'HEIGHT_SEMANTICS_MISMATCH',
  'USAGE_MISMATCH',
  'ACCESS_DENIED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'CANCELLED',
  'CONSUMPTION_UNCONFIRMED',
]);
export const coordinatesErrorDetailsSchema = z
  .object({
    path: z
      .array(z.union([coordinatesText(128), z.number().int().nonnegative()]))
      .max(32)
      .optional(),
    pointIndex: z.number().int().min(0).max(49).optional(),
    from: coordinatesCrsIdSchema.optional(),
    to: coordinatesCrsIdSchema.optional(),
    sourceDimension: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .nullable()
      .optional(),
    targetDimension: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .nullable()
      .optional(),
    expectedCount: z.number().int().nonnegative().optional(),
    actualCount: z.number().int().nonnegative().optional(),
    operationRef: coordinatesOperationRefSchema.optional(),
    requestedReleaseId: coordinatesReleaseIdSchema.optional(),
    runtimeProfileId: coordinatesText(128).optional(),
    missingGrids: z.array(coordinatesText(256)).max(128).optional(),
    scope: z.enum(['source-crs', 'target-crs', 'operation', 'grid', 'execution-domain']).optional(),
    unsupportedReasons: z.array(coordinatesIneligibilityReasonSchema).min(1).max(6).optional(),
  })
  .strict();

export const coordinatesFailureUsageSchema = z
  .union([
    coordinatesLocalUsageSchema,
    z
      .object({mode: z.literal('hosted'), state: z.literal('not-consumed'), units: z.literal(0)})
      .strict(),
    z
      .object({mode: z.literal('hosted'), state: z.literal('unconfirmed'), units: z.null()})
      .strict(),
  ])
  .nullable();

export const coordinatesFailureSchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.literal(false),
    invocationId: coordinatesInvocationIdSchema.optional(),
    command: coordinatesCommandSchema.nullable(),
    releaseId: coordinatesReleaseIdSchema.nullable(),
    provenance: coordinatesProvenanceSchema.nullable(),
    warnings: z.array(coordinatesWarningSchema).max(200),
    usage: coordinatesFailureUsageSchema,
    error: z
      .object({
        code: coordinatesErrorCodeSchema,
        reason: coordinatesErrorReasonSchema,
        phase: z.enum(['input', 'release', 'selection', 'execution', 'consumption', 'response']),
        details: coordinatesErrorDetailsSchema,
        message: coordinatesText(2048).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((failure, ctx) => {
    if (failure.releaseId === null && failure.provenance !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'Unresolved releases cannot claim provenance',
      });
    }
    if (
      ['selection', 'execution', 'consumption'].includes(failure.error.phase) &&
      (failure.releaseId === null || failure.provenance === null || failure.usage === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['releaseId'],
        message: 'Execution failures must identify the resolved release',
      });
    }
    if (
      failure.error.code === 'COORDINATES_CONSUMPTION_UNCONFIRMED' &&
      (failure.error.phase !== 'consumption' ||
        !failure.invocationId ||
        failure.usage?.mode !== 'hosted' ||
        failure.usage.state !== 'unconfirmed')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['usage'],
        message: 'Unconfirmed consumption cannot claim zero units',
      });
    }
  });

export type CoordinatesErrorCode = z.infer<typeof coordinatesErrorCodeSchema>;
export type CoordinatesErrorReason = z.infer<typeof coordinatesErrorReasonSchema>;
export type CoordinatesErrorDetails = z.infer<typeof coordinatesErrorDetailsSchema>;
export type CoordinatesFailure = z.infer<typeof coordinatesFailureSchema>;

export const coordinatesErrorMessages = Object.freeze({
  COORDINATES_INVALID_REQUEST: 'The Coordinates request is invalid.',
  COORDINATES_INVALID_RESPONSE: 'The Coordinates response failed validation.',
  COORDINATES_CRS_NOT_FOUND: 'The CRS is not in this catalog.',
  COORDINATES_UNSUPPORTED_CRS: 'The CRS is outside the supported execution profile.',
  COORDINATES_CRS_DIMENSION_MISMATCH: 'Source and target CRS dimensions differ.',
  COORDINATES_OPERATION_NOT_FOUND: 'The operation reference could not be resolved.',
  COORDINATES_OPERATION_MISMATCH: 'The operation does not match this request.',
  COORDINATES_NO_APPLICABLE_OPERATION: 'No applicable operation is available.',
  COORDINATES_MISSING_GRID: 'A required grid is unavailable.',
  COORDINATES_OUTSIDE_AREA: 'A position is outside the applicable area or domain.',
  COORDINATES_APPLICABILITY_UNDETERMINED: 'Operation applicability could not be established.',
  COORDINATES_BALLPARK_DISALLOWED: 'Ballpark execution needs explicit permission.',
  COORDINATES_BEST_KNOWN_UNAVAILABLE: 'The best-known operation cannot be executed.',
  COORDINATES_RELEASE_UNAVAILABLE: 'The requested execution release is unavailable.',
  COORDINATES_RELEASE_MISMATCH: 'The execution release does not match the request.',
  COORDINATES_RELEASE_INVALID: 'Execution release integrity verification failed.',
  COORDINATES_ACCESS_DENIED: 'Coordinates access was denied.',
  COORDINATES_QUOTA_EXCEEDED: 'The available allowance cannot cover this request.',
  COORDINATES_RATE_LIMITED: 'The Coordinates request rate limit was reached.',
  COORDINATES_UNAVAILABLE: 'Coordinates execution is unavailable.',
  COORDINATES_TIMEOUT: 'Coordinates execution timed out.',
  COORDINATES_CANCELLED: 'Coordinates execution was cancelled.',
  COORDINATES_CONSUMPTION_UNCONFIRMED: 'Usage completion could not be confirmed.',
} satisfies Record<CoordinatesErrorCode, string>);

export class CoordinatesContractError extends Error {
  readonly code: CoordinatesErrorCode;
  readonly reason: CoordinatesErrorReason;
  readonly details: CoordinatesErrorDetails;
  readonly response: CoordinatesFailure;

  constructor(response: CoordinatesFailure) {
    const parsed = coordinatesFailureSchema.parse(response);
    parsed.error.message = coordinatesErrorMessages[parsed.error.code];
    parsed.warnings = parsed.warnings.map((warning) => {
      const structured = {...warning};
      delete structured.message;
      return structured;
    });
    super(parsed.error.message);
    this.name = 'CoordinatesContractError';
    this.code = parsed.error.code;
    this.reason = parsed.error.reason;
    this.details = parsed.error.details;
    this.response = parsed;
  }

  toJSON(): CoordinatesFailure {
    return this.response;
  }
}
