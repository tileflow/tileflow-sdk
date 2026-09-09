import {z} from 'zod';

export const coordinatesCommands = ['search', 'describe', 'operations', 'transform'] as const;
export const coordinatesCommandSchema = z.enum(coordinatesCommands);
export type CoordinatesCommand = z.infer<typeof coordinatesCommandSchema>;

export const coordinatesLimits = Object.freeze({
  maximumPositions: 50,
  maximumPageSize: 50,
  defaultPageSize: 50,
  maximumQueryCharacters: 200,
  maximumRequestBytes: 32 * 1024,
  maximumDefinitionCharacters: 256 * 1024,
  maximumCursorCharacters: 2048,
  maximumTransformOperations: 100,
});

export const coordinatesText = (maximum = 512) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !/\p{Cc}/u.test(value), {
      message: 'Control characters are not allowed',
    });

export const coordinatesCrsIdSchema = z.string().regex(/^EPSG:[1-9][0-9]{0,9}$/u);
export const coordinatesReleaseIdSchema = z.string().regex(/^cr_[a-f0-9]{64}$/u);
export const coordinatesOperationRefSchema = z.string().regex(/^op_[a-f0-9]{64}$/u);
export const coordinatesInvocationIdSchema = z
  .string()
  .regex(/^cq_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
export const coordinatesDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const coordinatesAnalyticProofIdSchema = z.string().regex(/^ap_[a-f0-9]{64}$/u);
export const coordinatesCursorSchema = z
  .string()
  .min(1)
  .max(coordinatesLimits.maximumCursorCharacters)
  .regex(/^[A-Za-z0-9_-]+$/u);

const ordinate = z.number().finite();
export const coordinatesPositionSchema = z.union([
  z.tuple([ordinate, ordinate]),
  z.tuple([ordinate, ordinate, ordinate]),
]);
export type CoordinatesPosition = z.infer<typeof coordinatesPositionSchema>;

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
export const coordinatesBoundsSchema = z
  .tuple([longitude, latitude, longitude, latitude])
  .refine(([, south, , north]) => south <= north, {message: 'South exceeds north'});

export const coordinatesAreaSchema = z
  .object({
    name: coordinatesText(8192).nullable(),
    bounds: coordinatesBoundsSchema,
  })
  .strict();

export const coordinatesAttributionSchema = z
  .object({
    text: coordinatesText(2048),
    url: z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            !/\p{Cc}/u.test(value) && url.protocol === 'https:' && !url.username && !url.password
          );
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict();

export const coordinatesAnalyticProofSchema = z
  .object({
    id: coordinatesAnalyticProofIdSchema,
    digest: coordinatesDigestSchema,
    version: z.literal(1),
    method: z.object({authority: z.literal('EPSG'), code: z.literal('9602')}).strict(),
    algorithm: z.literal('epsg-9602-static-v1'),
    tolerances: z
      .object({angularDegrees: z.literal(1e-9), linearMetres: z.literal(0.002)})
      .strict(),
  })
  .strict()
  .superRefine((proof, ctx) => {
    if (proof.id !== `ap_${proof.digest}`) {
      ctx.addIssue({code: 'custom', path: ['id'], message: 'Proof id and digest disagree'});
    }
  });

export const coordinatesProvenanceSchema = z
  .object({
    engine: z.object({name: z.literal('PROJ'), version: coordinatesText(64)}).strict(),
    catalog: z
      .object({
        authority: z.literal('EPSG'),
        revision: coordinatesText(128),
        digest: coordinatesDigestSchema,
      })
      .strict(),
    gridSetDigest: coordinatesDigestSchema,
    selectionPolicy: coordinatesText(128),
    numericConvention: z.enum(['xy-geographic-degrees-crs-linear-v1', 'explicit-axis-models-v2']),
    longitudeReference: z.literal('crs-prime-meridian'),
    artifact: z.object({id: coordinatesText(128), digest: coordinatesDigestSchema}).strict(),
    applicabilityProofs: z.array(coordinatesAnalyticProofSchema).max(1).optional(),
  })
  .strict();

export const coordinatesWarningSchema = z
  .object({
    code: z.enum([
      'AUXILIARY_Z_UNTRANSFORMED',
      'BALLPARK_APPLIED',
      'BEST_KNOWN_NOT_USED',
      'DEPRECATED_CRS',
      'LEGACY_EXPORT_LOSSY',
      'EXPORT_UNAVAILABLE',
    ]),
    pointIndex: z.number().int().min(0).max(49).optional(),
    crsId: coordinatesCrsIdSchema.optional(),
    operationRef: coordinatesOperationRefSchema.optional(),
    message: coordinatesText(2048).optional(),
  })
  .strict();

export const coordinatesLocalUsageSchema = z
  .object({mode: z.literal('local'), units: z.literal(0)})
  .strict();
export const coordinatesHostedUsageSchema = z
  .object({
    mode: z.literal('hosted'),
    state: z.enum(['committed', 'not-consumed']),
    units: z.number().int().min(0).max(50),
  })
  .strict();
export const coordinatesUsageSchema = z.union([
  coordinatesLocalUsageSchema,
  coordinatesHostedUsageSchema,
]);

export const coordinatesPolicySchema = z
  .object({
    allowBallpark: z.boolean(),
    requireBestKnown: z.boolean(),
  })
  .strict();

export type CoordinatesProvenance = z.infer<typeof coordinatesProvenanceSchema>;
export type CoordinatesPolicy = z.infer<typeof coordinatesPolicySchema>;
