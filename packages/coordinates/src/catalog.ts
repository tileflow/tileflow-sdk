import {z} from 'zod';
import {
  coordinatesAnalyticProofIdSchema,
  coordinatesAreaSchema,
  coordinatesAttributionSchema,
  coordinatesCrsIdSchema,
  coordinatesDigestSchema,
  coordinatesLimits,
  coordinatesOperationRefSchema,
  coordinatesReleaseIdSchema,
  coordinatesText,
} from './shared';

export const coordinatesCrsKindSchema = z.enum([
  'geographic-2d',
  'geographic-3d',
  'projected',
  'compound',
  'geocentric',
  'vertical',
  'engineering',
  'other',
]);
export const coordinatesIneligibilityReasonSchema = z.enum([
  'GEOCENTRIC',
  'VERTICAL_ONLY',
  'DYNAMIC_CRS',
  'INCOMPATIBLE_AXES',
  'UNSUPPORTED_AXIS_PROFILE',
  'UNSUPPORTED_CRS_TYPE',
  'UNKNOWN_DIMENSION',
]);
export const coordinatesCoordinateModelSchema = z.enum(['geographic', 'projected', 'geocentric']);

const summaryFields = {
  id: coordinatesCrsIdSchema,
  name: coordinatesText(512),
  kind: coordinatesCrsKindSchema,
  dimension: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  deprecated: z.boolean(),
  dynamic: z.boolean(),
  areasOfUse: z.array(coordinatesAreaSchema).min(1).max(128).nullable(),
  coordinateModel: coordinatesCoordinateModelSchema.nullable().optional(),
  eligibility: z
    .object({
      eligible: z.boolean(),
      reasons: z.array(coordinatesIneligibilityReasonSchema).max(6),
    })
    .strict(),
};

export const coordinatesCrsSummarySchema = z
  .object(summaryFields)
  .strict()
  .superRefine((crs, ctx) => {
    if (crs.eligibility.eligible === crs.eligibility.reasons.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['eligibility'],
        message: 'Eligibility and reasons disagree',
      });
    }
    const dimensions: Partial<Record<typeof crs.kind, number>> = {
      'geographic-2d': 2,
      'geographic-3d': 3,
      compound: 3,
      geocentric: 3,
      vertical: 1,
    };
    const dimension = dimensions[crs.kind];
    if (dimension && dimension !== crs.dimension) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimension'],
        message: 'CRS kind and dimension disagree',
      });
    }
    if (
      crs.eligibility.eligible &&
      (crs.dynamic ||
        ![2, 3].includes(crs.dimension ?? 0) ||
        !['geographic-2d', 'geographic-3d', 'projected', 'compound', 'geocentric'].includes(
          crs.kind,
        ))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['eligibility'],
        message: 'CRS is outside the execution profile',
      });
    }
    if (crs.coordinateModel !== undefined) {
      const valid =
        crs.kind === 'geographic-2d' || crs.kind === 'geographic-3d'
          ? crs.coordinateModel === 'geographic'
          : crs.kind === 'projected'
            ? crs.coordinateModel === 'projected'
            : crs.kind === 'geocentric'
              ? crs.coordinateModel === 'geocentric'
              : crs.kind === 'compound'
                ? crs.coordinateModel === null ||
                  ['geographic', 'projected'].includes(crs.coordinateModel)
                : crs.coordinateModel === null;
      if (
        !valid ||
        (crs.kind === 'compound' && crs.eligibility.eligible && crs.coordinateModel === null)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['coordinateModel'],
          message: 'Coordinate model and CRS kind disagree',
        });
      }
    }
  });

const coordinatesAxisUnitSchema = z
  .object({name: coordinatesText(128), toSI: z.number().finite().positive()})
  .strict();
const coordinatesAxisMeridianSchema = z
  .object({longitude: z.number().finite(), unit: coordinatesAxisUnitSchema})
  .strict();
export const coordinatesAxisSchema = z
  .object({
    name: coordinatesText(256),
    direction: coordinatesText(128),
    abbreviation: coordinatesText(128).optional(),
    unit: coordinatesAxisUnitSchema,
    meridian: coordinatesAxisMeridianSchema.nullable().optional(),
  })
  .strict();

export const coordinatesAxisNormalizationSchema = z
  .object({
    method: z.literal('signed-permutation-v1'),
    publicToOfficial: z
      .array(
        z
          .object({officialAxis: z.number().int().min(0).max(2), scale: z.number().finite()})
          .strict()
          .refine((value) => value.scale !== 0, {message: 'Scale must be nonzero'}),
      )
      .min(2)
      .max(3),
  })
  .strict();

export type CoordinatesAxis = z.infer<typeof coordinatesAxisSchema>;
export type CoordinatesAxisNormalization = z.infer<typeof coordinatesAxisNormalizationSchema>;

function oppositeDirection(direction: string): string | undefined {
  return {east: 'west', west: 'east', north: 'south', south: 'north', up: 'down', down: 'up'}[
    direction
  ];
}

function matchingDirection(
  publicAxis: CoordinatesAxis,
  officialAxis: CoordinatesAxis,
  scale: number,
): boolean {
  const publicMeridian = publicAxis.meridian;
  const officialMeridian = officialAxis.meridian;
  if (publicMeridian !== null || officialMeridian !== null) {
    if (
      !publicMeridian ||
      !officialMeridian ||
      publicMeridian.longitude !== officialMeridian.longitude ||
      publicMeridian.unit.name !== officialMeridian.unit.name ||
      publicMeridian.unit.toSI !== officialMeridian.unit.toSI ||
      !['north', 'south'].includes(publicAxis.direction) ||
      !['north', 'south'].includes(officialAxis.direction)
    )
      return false;
  }
  return (
    publicAxis.direction ===
    (scale > 0 ? officialAxis.direction : oppositeDirection(officialAxis.direction))
  );
}

export function isCoordinatesAxisNormalizationValid(
  official: readonly CoordinatesAxis[],
  normalized: readonly CoordinatesAxis[],
  normalization: CoordinatesAxisNormalization,
  coordinateModel?: z.infer<typeof coordinatesCoordinateModelSchema> | null,
): boolean {
  if (
    official.length !== normalized.length ||
    normalized.length !== normalization.publicToOfficial.length ||
    normalized.length < 2 ||
    normalized.length > 3
  )
    return false;
  const expected = Array.from({length: normalized.length}, (_, index) => index);
  const permutation = normalization.publicToOfficial.map((item) => item.officialAxis).sort();
  if (!permutation.every((axis, index) => axis === expected[index])) return false;
  for (const [index, mapping] of normalization.publicToOfficial.entries()) {
    const publicAxis = normalized[index];
    const officialAxis = official[mapping.officialAxis];
    if (!officialAxis || !Number.isFinite(mapping.scale) || mapping.scale === 0) return false;
    const expectedToSI = officialAxis.unit.toSI * Math.abs(mapping.scale);
    if (Math.abs(expectedToSI - publicAxis.unit.toSI) > 1e-12 * publicAxis.unit.toSI) return false;
    if (
      coordinateModel &&
      !(coordinateModel === 'geographic' && index < 2) &&
      (Math.abs(mapping.scale) !== 1 ||
        publicAxis.unit.name !== officialAxis.unit.name ||
        publicAxis.unit.toSI !== officialAxis.unit.toSI)
    )
      return false;
    if (!matchingDirection(publicAxis, officialAxis, mapping.scale)) return false;
  }
  if (coordinateModel === 'geographic') {
    return (
      ['east', 'north', ...(normalized.length === 3 ? ['up'] : [])].every(
        (direction, index) => normalized[index].direction === direction,
      ) &&
      normalized
        .slice(0, 2)
        .every(
          (axis) => axis.unit.name === 'degree' && Math.abs(axis.unit.toSI - Math.PI / 180) < 1e-14,
        )
    );
  }
  if (coordinateModel === 'geocentric') {
    return (
      normalized.length === 3 &&
      ['geocentricX', 'geocentricY', 'geocentricZ'].every(
        (direction, index) =>
          normalized[index].direction === direction &&
          normalization.publicToOfficial[index].scale > 0 &&
          official[normalization.publicToOfficial[index].officialAxis].direction === direction,
      )
    );
  }
  if (coordinateModel === 'projected') {
    return (
      normalized
        .slice(0, 2)
        .every((axis, index) =>
          axis.meridian
            ? axis.name === (index === 0 ? 'Easting' : 'Northing')
            : axis.direction === (index === 0 ? 'east' : 'north'),
        ) &&
      (normalized.length === 2 || normalized[2].direction === 'up')
    );
  }
  return true;
}

export const coordinatesDefinitionFormatSchema = z.enum(['wkt2', 'projjson', 'legacy-proj']);
export const coordinatesDefinitionSchema = z
  .object({
    format: coordinatesDefinitionFormatSchema,
    content: z.string().min(1).max(coordinatesLimits.maximumDefinitionCharacters).nullable(),
    lossy: z.boolean(),
    unavailableReason: z.enum(['NOT_REPRESENTABLE', 'NOT_AVAILABLE']).nullable(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if ((definition.content === null) !== (definition.unavailableReason !== null)) {
      ctx.addIssue({code: 'custom', message: 'Definition availability is inconsistent'});
    }
    if (definition.format !== 'legacy-proj' && definition.lossy) {
      ctx.addIssue({
        code: 'custom',
        path: ['lossy'],
        message: 'Only legacy PROJ exports may be lossy',
      });
    }
    if (definition.content && definition.format === 'projjson') {
      try {
        const parsed = JSON.parse(definition.content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'PROJJSON must contain a JSON object',
        });
      }
    }
  });

export const coordinatesCrsDescriptionSchema = z
  .object({
    summary: coordinatesCrsSummarySchema,
    officialAxes: z.array(coordinatesAxisSchema).max(32),
    normalizedAxes: z.array(coordinatesAxisSchema).min(2).max(3).nullable(),
    normalization: coordinatesAxisNormalizationSchema.nullable().optional(),
    datum: z
      .object({
        name: coordinatesText(512),
        kind: z.enum(['static', 'ensemble', 'dynamic']),
        referenceEpoch: z.number().finite().nullable(),
      })
      .strict()
      .nullable(),
    ellipsoid: z
      .object({
        name: coordinatesText(512),
        semiMajorMetres: z.number().finite().positive(),
        inverseFlattening: z.number().finite().nonnegative().nullable(),
      })
      .strict()
      .nullable(),
    primeMeridian: z
      .object({
        name: coordinatesText(256),
        longitudeDegrees: z.number().finite(),
      })
      .strict()
      .nullable(),
    definitions: z.array(coordinatesDefinitionSchema).max(3),
  })
  .strict()
  .superRefine((description, ctx) => {
    if (description.datum?.kind === 'dynamic' && !description.summary.dynamic) {
      ctx.addIssue({
        code: 'custom',
        path: ['datum'],
        message: 'Datum and CRS dynamic status disagree',
      });
    }
    const formats = description.definitions.map((definition) => definition.format);
    if (new Set(formats).size !== formats.length) {
      ctx.addIssue({code: 'custom', path: ['definitions'], message: 'Duplicate definition format'});
    }
    const dimension = description.summary.dimension;
    if (dimension !== null && description.officialAxes.length !== dimension) {
      ctx.addIssue({
        code: 'custom',
        path: ['officialAxes'],
        message: 'Axis count and dimension disagree',
      });
    }
    if (
      description.summary.eligibility.eligible &&
      (!description.normalizedAxes || description.normalizedAxes.length !== dimension)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['normalizedAxes'],
        message: 'Normalized axes and dimension disagree',
      });
    }
    if (
      description.summary.eligibility.eligible &&
      description.normalization === undefined &&
      description.normalizedAxes &&
      (description.normalizedAxes[0].direction !== 'east' ||
        description.normalizedAxes[1].direction !== 'north' ||
        (dimension === 3 && description.normalizedAxes[2].direction !== 'up'))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['normalizedAxes'],
        message: 'Expected normalized x/y[/z] axes',
      });
    if (
      description.normalization !== undefined &&
      description.normalization !== null &&
      (!description.normalizedAxes ||
        !isCoordinatesAxisNormalizationValid(
          description.officialAxes,
          description.normalizedAxes,
          description.normalization,
          description.summary.coordinateModel,
        ))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['normalization'],
        message: 'Axis normalization is not a complete signed permutation',
      });
  });

export const coordinatesGridSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_.=+-]+$/u)
      .refine((name) => name !== '.' && name !== '..'),
    available: z.boolean(),
    digest: coordinatesDigestSchema.nullable(),
    license: coordinatesText(1024).nullable(),
    attribution: z.array(coordinatesAttributionSchema).max(32),
  })
  .strict()
  .superRefine((grid, ctx) => {
    if (grid.available && grid.digest === null) {
      ctx.addIssue({code: 'custom', path: ['digest'], message: 'Available grids require a digest'});
    }
  });

export const coordinatesOperationApplicabilitySchema = z
  .discriminatedUnion('source', [
    z.object({source: z.literal('catalog-area')}).strict(),
    z.object({source: z.literal('unverified')}).strict(),
    z
      .object({
        source: z.literal('analytic-proof'),
        proofId: coordinatesAnalyticProofIdSchema,
        proofVersion: z.literal(1),
        method: z.object({authority: z.literal('EPSG'), code: z.literal('9602')}).strict(),
        releaseId: coordinatesReleaseIdSchema,
      })
      .strict(),
  ])
  .optional();

export const coordinatesOperationSchema = z
  .object({
    operationRef: coordinatesOperationRefSchema,
    releaseId: coordinatesReleaseIdSchema,
    from: coordinatesCrsIdSchema,
    to: coordinatesCrsIdSchema,
    direction: z.literal('forward'),
    name: coordinatesText(8192),
    identifiers: z
      .array(z.object({authority: coordinatesText(64), code: coordinatesText(128)}).strict())
      .max(32),
    accuracy: z.number().finite().nonnegative().nullable(),
    ballpark: z.boolean(),
    areasOfUse: z.array(coordinatesAreaSchema).min(1).max(128).nullable(),
    grids: z.array(coordinatesGridSchema).max(128),
    methodSupported: z.boolean(),
    instantiable: z.boolean(),
    hasInverse: z.boolean(),
    heightEffect: z.enum(['none', 'preserved', 'transformed', 'unknown', 'not-applicable']),
    applicability: coordinatesOperationApplicabilitySchema,
  })
  .strict()
  .superRefine((operation, ctx) => {
    if (new Set(operation.grids.map((grid) => grid.name)).size !== operation.grids.length) {
      ctx.addIssue({code: 'custom', path: ['grids'], message: 'Duplicate operation resource'});
    }
    if (
      operation.instantiable &&
      (!operation.methodSupported || operation.grids.some((grid) => !grid.available))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['instantiable'],
        message: 'An instantiable operation needs its method and resources',
      });
    }
  });

export type CoordinatesCrsSummary = z.infer<typeof coordinatesCrsSummarySchema>;
export type CoordinatesCrsDescription = z.infer<typeof coordinatesCrsDescriptionSchema>;
export type CoordinatesOperation = z.infer<typeof coordinatesOperationSchema>;
