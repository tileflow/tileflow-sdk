import {z} from 'zod';
import {coordinatesCrsKindSchema, coordinatesDefinitionFormatSchema} from './catalog';
import {
  coordinatesBoundsSchema,
  coordinatesCrsIdSchema,
  coordinatesCursorSchema,
  coordinatesLimits,
  coordinatesOperationRefSchema,
  coordinatesPositionSchema,
  coordinatesReleaseIdSchema,
  coordinatesText,
} from './shared';

const common = {
  schemaVersion: z.literal(1).default(1),
  requiredReleaseId: coordinatesReleaseIdSchema.optional(),
};
const page = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(coordinatesLimits.maximumPageSize)
    .default(coordinatesLimits.defaultPageSize),
  cursor: coordinatesCursorSchema.optional(),
};
const pair = {
  from: coordinatesCrsIdSchema,
  to: coordinatesCrsIdSchema,
  areaOfInterest: coordinatesBoundsSchema.optional(),
};
const searchText = () => coordinatesText(coordinatesLimits.maximumQueryCharacters).trim().min(1);

export const coordinatesSearchRequestSchema = z
  .object({
    ...common,
    ...page,
    query: searchText().optional(),
    filters: z
      .object({
        name: searchText().optional(),
        area: searchText().optional(),
        datum: searchText().optional(),
        ellipsoid: searchText().optional(),
        kind: coordinatesCrsKindSchema.optional(),
        unit: searchText().optional(),
      })
      .strict()
      .optional(),
    deprecated: z.enum(['exclude', 'include', 'only']).default('exclude'),
  })
  .strict();

export const coordinatesDescribeRequestSchema = z
  .object({
    ...common,
    id: coordinatesCrsIdSchema,
    formats: z
      .array(coordinatesDefinitionFormatSchema)
      .max(3)
      .default([])
      .refine((formats) => new Set(formats).size === formats.length, {
        message: 'Duplicate definition format',
      }),
  })
  .strict();

export const coordinatesOperationsRequestSchema = z.object({...common, ...pair, ...page}).strict();

export const coordinatesTransformRequestSchema = z
  .object({
    ...common,
    ...pair,
    positions: z.array(coordinatesPositionSchema).min(1).max(coordinatesLimits.maximumPositions),
    operationRef: coordinatesOperationRefSchema.optional(),
    allowBallpark: z.boolean().default(false),
    requireBestKnown: z.boolean().default(true),
  })
  .strict()
  .superRefine((request, ctx) => {
    const dimension = request.positions[0]?.length;
    request.positions.forEach((position, index) => {
      if (position.length !== dimension) {
        ctx.addIssue({
          code: 'custom',
          path: ['positions', index],
          message: 'Position dimensions differ',
          params: {coordinatesReason: 'MIXED_POSITION_DIMENSIONS'},
        });
      }
    });
  });

export const coordinatesRequestSchemas = Object.freeze({
  search: coordinatesSearchRequestSchema,
  describe: coordinatesDescribeRequestSchema,
  operations: coordinatesOperationsRequestSchema,
  transform: coordinatesTransformRequestSchema,
});

export type CoordinatesSearchRequest = z.input<typeof coordinatesSearchRequestSchema>;
export type CoordinatesDescribeRequest = z.input<typeof coordinatesDescribeRequestSchema>;
export type CoordinatesOperationsRequest = z.input<typeof coordinatesOperationsRequestSchema>;
export type CoordinatesTransformRequest = z.input<typeof coordinatesTransformRequestSchema>;
export type NormalizedCoordinatesTransformRequest = z.output<
  typeof coordinatesTransformRequestSchema
>;
export type CoordinatesRequest<C extends keyof typeof coordinatesRequestSchemas> = z.input<
  (typeof coordinatesRequestSchemas)[C]
>;
export type NormalizedCoordinatesRequest<C extends keyof typeof coordinatesRequestSchemas> =
  z.output<(typeof coordinatesRequestSchemas)[C]>;
