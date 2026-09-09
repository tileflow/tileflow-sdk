import {z} from 'zod';
import {
  type CoordinatesAxis,
  type CoordinatesAxisNormalization,
  coordinatesAxisNormalizationSchema,
  type CoordinatesCrsDescription,
  type CoordinatesCrsSummary,
  coordinatesCrsSummarySchema,
  type CoordinatesOperation,
  isCoordinatesAxisNormalizationValid,
} from './catalog';
import {
  CoordinatesContractError,
  type CoordinatesErrorCode,
  type CoordinatesErrorDetails,
  type CoordinatesErrorReason,
  coordinatesFailureSchema,
} from './errors';
import {
  type CoordinatesRequest,
  coordinatesRequestSchemas,
  type NormalizedCoordinatesRequest,
  type NormalizedCoordinatesTransformRequest,
} from './requests';
import {
  type CoordinatesResponse,
  coordinatesSuccessSchemas,
  type CoordinatesTransformResponse,
} from './responses';
import {
  type CoordinatesCommand,
  coordinatesCommandSchema,
  coordinatesLimits,
  type CoordinatesProvenance,
  coordinatesProvenanceSchema,
  coordinatesReleaseIdSchema,
  coordinatesText,
} from './shared';

export const coordinatesResponseContextSchema = z
  .object({
    mode: z.enum(['local', 'hosted']),
    releaseId: coordinatesReleaseIdSchema.optional(),
    artifactId: coordinatesText(128).optional(),
    provenance: coordinatesProvenanceSchema.optional(),
  })
  .strict()
  .refine((context) => !context.provenance || context.releaseId !== undefined, {
    message: 'Known provenance requires its release identity',
  });
export type CoordinatesResponseContext = z.infer<typeof coordinatesResponseContextSchema>;

function failure(
  command: CoordinatesCommand | null,
  code: CoordinatesErrorCode,
  reason: CoordinatesErrorReason,
  details: CoordinatesErrorDetails = {},
  context?: CoordinatesResponseContext,
): never {
  throw new CoordinatesContractError({
    schemaVersion: 1,
    ok: false,
    command: coordinatesCommandSchema.safeParse(command).success ? command : null,
    releaseId: context?.releaseId ?? null,
    provenance: context?.provenance ?? null,
    warnings: [],
    usage:
      context?.mode === 'local'
        ? {mode: 'local', units: 0}
        : context?.mode === 'hosted'
          ? {mode: 'hosted', state: 'unconfirmed', units: null}
          : null,
    error: {code, reason, details, phase: context ? 'response' : 'input'},
  });
}

function issueDetails(issue: z.core.$ZodIssue): CoordinatesErrorDetails {
  const path = issue.path
    .filter(
      (part): part is string | number =>
        typeof part === 'number' ||
        (typeof part === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(part)),
    )
    .slice(0, 32);
  const pointIndex =
    path[0] === 'positions' && typeof path[1] === 'number' && path[1] < 50 ? path[1] : undefined;
  return {path, ...(pointIndex === undefined ? {} : {pointIndex})};
}

export function parseCoordinatesRequest<C extends CoordinatesCommand>(
  command: C,
  input: unknown,
): NormalizedCoordinatesRequest<C> {
  if (!coordinatesCommandSchema.safeParse(command).success) {
    failure(null, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', {path: ['command']});
  }
  const parsed = coordinatesRequestSchemas[command].safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const details = issueDetails(issue);
    const reason: CoordinatesErrorReason =
      issue.code === 'unrecognized_keys'
        ? 'UNKNOWN_FIELD'
        : issue.code === 'custom' && issue.params?.coordinatesReason === 'MIXED_POSITION_DIMENSIONS'
          ? 'MIXED_POSITION_DIMENSIONS'
          : details.pointIndex !== undefined
            ? 'INVALID_POSITION'
            : 'INVALID_VALUE';
    failure(command, 'COORDINATES_INVALID_REQUEST', reason, details);
  }
  if (
    new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength >
    coordinatesLimits.maximumRequestBytes
  ) {
    failure(command, 'COORDINATES_INVALID_REQUEST', 'REQUEST_TOO_LARGE');
  }
  return parsed.data as NormalizedCoordinatesRequest<C>;
}

export function parseCoordinatesJsonRequest<C extends CoordinatesCommand>(
  command: C,
  input: string,
): NormalizedCoordinatesRequest<C> {
  if (new TextEncoder().encode(input).byteLength > coordinatesLimits.maximumRequestBytes) {
    failure(command, 'COORDINATES_INVALID_REQUEST', 'REQUEST_TOO_LARGE');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    failure(command, 'COORDINATES_INVALID_REQUEST', 'INVALID_JSON');
  }
  return parseCoordinatesRequest(command, decoded);
}

/** Validates declared CRS/profile semantics; an engine must separately prove geographic applicability. */
export function validateCoordinatesTransformRequest(
  input: unknown,
  source: CoordinatesCrsSummary,
  target: CoordinatesCrsSummary,
): NormalizedCoordinatesTransformRequest {
  const request = parseCoordinatesRequest('transform', input);
  const from = coordinatesCrsSummarySchema.safeParse(source);
  const to = coordinatesCrsSummarySchema.safeParse(target);
  if (!from.success || !to.success || source.id !== request.from || target.id !== request.to) {
    failure('transform', 'COORDINATES_INVALID_REQUEST', 'OPERATION_BINDING_MISMATCH');
  }
  if (!source.eligibility.eligible || !target.eligibility.eligible) {
    const unsupported = !source.eligibility.eligible ? source : target;
    failure(
      'transform',
      'COORDINATES_UNSUPPORTED_CRS',
      unsupported.eligibility.reasons.includes('UNSUPPORTED_AXIS_PROFILE')
        ? 'UNSUPPORTED_AXIS_PROFILE'
        : 'UNSUPPORTED_CRS_PROFILE',
      {
        from: source.id,
        to: target.id,
        scope: unsupported === source ? 'source-crs' : 'target-crs',
        unsupportedReasons: unsupported.eligibility.reasons,
      },
    );
  }
  if (source.dimension !== target.dimension) {
    failure('transform', 'COORDINATES_CRS_DIMENSION_MISMATCH', 'CRS_DIMENSION_MISMATCH', {
      from: source.id,
      to: target.id,
      sourceDimension: source.dimension,
      targetDimension: target.dimension,
    });
  }
  if (source.dimension === 3 && request.positions[0].length !== 3) {
    failure('transform', 'COORDINATES_INVALID_REQUEST', 'INVALID_POSITION', {
      pointIndex: 0,
      path: ['positions', 0],
    });
  }
  return request;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function parseCoordinatesResponse<C extends CoordinatesCommand>(
  command: C,
  input: CoordinatesRequest<C>,
  value: unknown,
  context: CoordinatesResponseContext,
): CoordinatesResponse<C> {
  const parsedContext = coordinatesResponseContextSchema.safeParse(context);
  if (!parsedContext.success)
    failure(command, 'COORDINATES_INVALID_REQUEST', 'INVALID_VALUE', {path: ['context']});
  context = parsedContext.data;
  const request = parseCoordinatesRequest(command, input);
  const invalid = (reason: CoordinatesErrorReason, details: CoordinatesErrorDetails = {}): never =>
    failure(command, 'COORDINATES_INVALID_RESPONSE', reason, details, context);

  if (value && typeof value === 'object' && 'ok' in value && value.ok === false) {
    const parsed = coordinatesFailureSchema.safeParse(value);
    if (!parsed.success) invalid('RESPONSE_SHAPE_INVALID', issueDetails(parsed.error.issues[0]));
    const reply = parsed.data!;
    if (reply.command !== command) invalid('OPERATION_BINDING_MISMATCH');
    if (
      reply.error.details.pointIndex !== undefined &&
      (command !== 'transform' ||
        reply.error.details.pointIndex >=
          (request as NormalizedCoordinatesTransformRequest).positions.length)
    ) {
      invalid('INVALID_POSITION');
    }
    if (
      command === 'transform' &&
      [
        'COORDINATES_MISSING_GRID',
        'COORDINATES_OUTSIDE_AREA',
        'COORDINATES_APPLICABILITY_UNDETERMINED',
        'COORDINATES_BALLPARK_DISALLOWED',
        'COORDINATES_BEST_KNOWN_UNAVAILABLE',
        'COORDINATES_NO_APPLICABLE_OPERATION',
      ].includes(reply.error.code) &&
      reply.error.details.pointIndex === undefined
    )
      invalid('INVALID_POSITION');
    if (context.releaseId && reply.releaseId !== null && reply.releaseId !== context.releaseId)
      invalid('RELEASE_MISMATCH');
    if (context.provenance && reply.provenance && !same(context.provenance, reply.provenance))
      invalid('PROVENANCE_MISMATCH');
    if (reply.usage && reply.usage.mode !== context.mode) invalid('USAGE_MISMATCH');
    return new CoordinatesContractError(reply).toJSON() as CoordinatesResponse<C>;
  }

  const parsed = coordinatesSuccessSchemas[command].safeParse(value);
  if (!parsed.success) invalid('RESPONSE_SHAPE_INVALID', issueDetails(parsed.error.issues[0]));
  const reply = parsed.data!;
  if (
    (request.requiredReleaseId && reply.releaseId !== request.requiredReleaseId) ||
    (context.releaseId && reply.releaseId !== context.releaseId)
  )
    invalid('RELEASE_MISMATCH');
  if (context.artifactId && reply.provenance.artifact.id !== context.artifactId)
    invalid('PROVENANCE_MISMATCH');
  if (context.provenance && !same(context.provenance, reply.provenance))
    invalid('PROVENANCE_MISMATCH');
  if (reply.usage.mode !== context.mode) invalid('USAGE_MISMATCH');
  const units =
    reply.command === 'transform' && context.mode === 'hosted'
      ? (request as NormalizedCoordinatesTransformRequest).positions.length
      : 0;
  if (units > 0 && !reply.invocationId) invalid('USAGE_MISMATCH');
  if (
    reply.usage.units !== units ||
    (reply.usage.mode === 'hosted' &&
      reply.usage.state !== (units > 0 ? 'committed' : 'not-consumed'))
  )
    invalid('USAGE_MISMATCH');

  if (
    reply.provenance.applicabilityProofs?.length &&
    reply.provenance.numericConvention !== 'explicit-axis-models-v2'
  )
    invalid('PROVENANCE_MISMATCH');
  if (reply.provenance.numericConvention === 'explicit-axis-models-v2') {
    if (reply.command === 'search') {
      reply.result.items.forEach((item) => validateV2Summary(item, invalid));
    } else if (reply.command === 'describe') {
      validateV2Summary(reply.result.summary, invalid);
      validateV2DescriptionAxes(reply.result, invalid);
    } else if (reply.command === 'transform') {
      validateV2Summary(reply.result.from, invalid);
      validateV2Summary(reply.result.to, invalid);
      validateV2TransformAxes(reply.result.axes.from, reply.result.from, invalid);
      validateV2TransformAxes(reply.result.axes.to, reply.result.to, invalid);
    }
  }

  const checkOperation = (operation: CoordinatesOperation) => {
    const pair = request as NormalizedCoordinatesRequest<'operations'>;
    if (operation.releaseId !== reply.releaseId)
      invalid('RELEASE_MISMATCH', {operationRef: operation.operationRef});
    if (operation.from !== pair.from || operation.to !== pair.to)
      invalid('OPERATION_BINDING_MISMATCH', {operationRef: operation.operationRef});
  };
  const checkPage = (items: readonly unknown[], total: number, nextCursor: string | null) => {
    const page = request as NormalizedCoordinatesRequest<'search'>;
    if (
      items.length > page.limit ||
      total < items.length ||
      (items.length === 0 && nextCursor !== null) ||
      (nextCursor !== null && nextCursor === page.cursor)
    )
      invalid('RESULT_COUNT_MISMATCH');
    if (!page.cursor && total > items.length && nextCursor === null)
      invalid('RESULT_COUNT_MISMATCH');
  };

  if (reply.command === 'search') {
    const search = request as NormalizedCoordinatesRequest<'search'>;
    checkPage(reply.result.items, reply.result.total, reply.result.nextCursor);
    if (new Set(reply.result.items.map((item) => item.id)).size !== reply.result.items.length)
      invalid('DUPLICATE_CRS_ID');
    if (
      reply.result.items.some(
        (item) =>
          (search.deprecated === 'exclude' && item.deprecated) ||
          (search.deprecated === 'only' && !item.deprecated),
      )
    )
      invalid('POLICY_MISMATCH');
  } else if (reply.command === 'describe') {
    const describe = request as NormalizedCoordinatesRequest<'describe'>;
    if (reply.result.summary.id !== describe.id) invalid('OPERATION_BINDING_MISMATCH');
    if (
      !same(
        reply.result.definitions.map((definition) => definition.format).sort(),
        [...describe.formats].sort(),
      )
    ) {
      invalid('RESULT_COUNT_MISMATCH');
    }
  } else if (reply.command === 'operations') {
    const operations = request as NormalizedCoordinatesRequest<'operations'>;
    if (reply.result.from !== operations.from || reply.result.to !== operations.to)
      invalid('OPERATION_BINDING_MISMATCH');
    checkPage(reply.result.operations, reply.result.total, reply.result.nextCursor);
    reply.result.operations.forEach((operation) => {
      checkOperation(operation);
      validateOperationApplicability(operation, reply, invalid);
    });
    if (
      new Set(reply.result.operations.map((operation) => operation.operationRef)).size !==
      reply.result.operations.length
    ) {
      invalid('DUPLICATE_OPERATION_REF');
    }
  } else {
    const transform = request as NormalizedCoordinatesTransformRequest;
    validateTransformResponse(transform, reply, checkOperation, invalid);
  }
  for (const warning of reply.warnings) {
    if (
      warning.pointIndex !== undefined &&
      (reply.command !== 'transform' || warning.pointIndex >= reply.result.results.length)
    ) {
      invalid('INVALID_POSITION');
    }
    if (
      warning.operationRef !== undefined &&
      ((reply.command !== 'operations' && reply.command !== 'transform') ||
        !reply.result.operations.some(
          (operation) => operation.operationRef === warning.operationRef,
        ))
    )
      invalid('UNKNOWN_OPERATION_REF');
  }
  return reply as CoordinatesResponse<C>;
}

function validateTransformResponse(
  request: NormalizedCoordinatesTransformRequest,
  response: CoordinatesTransformResponse,
  checkOperation: (operation: CoordinatesOperation) => void,
  invalid: (reason: CoordinatesErrorReason, details?: CoordinatesErrorDetails) => never,
) {
  const result = response.result;
  for (const side of ['from', 'to'] as const) {
    const crs = result[side];
    const axes = result.axes[side];
    if (axes.normalized.length !== crs.dimension) invalid('RESULT_DIMENSION_MISMATCH');
    if (crs.kind === 'geographic-2d' || crs.kind === 'geographic-3d') {
      if (
        axes.normalized
          .slice(0, 2)
          .some(
            (axis) =>
              axis.unit.name !== 'degree' || Math.abs(axis.unit.toSI - Math.PI / 180) > 1e-14,
          )
      ) {
        invalid('POLICY_MISMATCH');
      }
    }
  }
  try {
    validateCoordinatesTransformRequest(request, result.from, result.to);
  } catch (error) {
    if (error instanceof CoordinatesContractError) invalid(error.reason, error.details);
    throw error;
  }
  if (result.results.length !== request.positions.length) {
    invalid('RESULT_COUNT_MISMATCH', {
      expectedCount: request.positions.length,
      actualCount: result.results.length,
    });
  }
  if (
    !same(result.areaOfInterest, request.areaOfInterest) ||
    result.policy.allowBallpark !== request.allowBallpark ||
    result.policy.requireBestKnown !== request.requireBestKnown
  )
    invalid('POLICY_MISMATCH');

  const operations = new Map<string, CoordinatesOperation>();
  for (const operation of result.operations) {
    checkOperation(operation);
    if (operations.has(operation.operationRef))
      invalid('DUPLICATE_OPERATION_REF', {operationRef: operation.operationRef});
    operations.set(operation.operationRef, operation);
  }
  const referenced = new Set<string>();
  result.results.forEach((point, pointIndex) => {
    const details = {pointIndex};
    const used = operations.get(point.operationRef);
    const best = operations.get(point.selection.bestKnown.operationRef);
    if (!used || !best) invalid('UNKNOWN_OPERATION_REF', details);
    referenced.add(used.operationRef);
    referenced.add(best.operationRef);
    const analytic = validateOperationApplicability(used, response, invalid, details, true);
    const bestAnalytic = validateOperationApplicability(best, response, invalid, details, true);
    if (point.position.length !== request.positions[pointIndex].length)
      invalid('RESULT_DIMENSION_MISMATCH', details);
    if (!used.instantiable || result.from.areasOfUse === null || result.to.areasOfUse === null) {
      invalid('OPERATION_UNUSABLE', details);
    }
    if (point.applicability.gridCoverage !== (used.grids.length ? 'verified' : 'not-required'))
      invalid('APPLICABILITY_UNDETERMINED', details);
    if (analytic) {
      if (
        point.applicability.operationArea !== 'not-provided' ||
        point.analyticalProof?.proofId !== analytic.proofId ||
        point.analyticalProof.status !== 'verified'
      )
        invalid('APPLICABILITY_UNDETERMINED', details);
      if (!isAnalyticTransformPair(result.from, result.to)) invalid('OPERATION_UNUSABLE', details);
    } else if (
      point.applicability.operationArea !== 'verified' ||
      point.analyticalProof !== undefined
    ) {
      invalid('APPLICABILITY_UNDETERMINED', details);
    }
    if (bestAnalytic && !isAnalyticTransformPair(result.from, result.to))
      invalid('OPERATION_UNUSABLE', details);

    const explicit = request.operationRef !== undefined;
    if (
      point.selection.mode !== (explicit ? 'explicit' : 'automatic') ||
      (explicit && point.operationRef !== request.operationRef)
    )
      invalid('OPERATION_BINDING_MISMATCH', details);
    const different = used.operationRef !== best.operationRef;
    if (point.selection.bestKnown.relation !== (different ? 'different' : 'same'))
      invalid('POLICY_MISMATCH', details);
    if (used.ballpark && !request.allowBallpark) invalid('BALLPARK_NOT_ALLOWED', details);
    if (different && !explicit && request.requireBestKnown)
      invalid('BEST_KNOWN_UNAVAILABLE', details);
    const applied = [
      ...(used.ballpark ? ['ballpark'] : []),
      ...(different ? ['best-known'] : []),
    ].sort();
    if (!same([...point.selection.relaxationsApplied].sort(), applied))
      invalid('POLICY_MISMATCH', details);

    const position = request.positions[pointIndex];
    const geocentric =
      result.from.coordinateModel === 'geocentric' ||
      result.to.coordinateModel === 'geocentric' ||
      result.from.kind === 'geocentric' ||
      result.to.kind === 'geocentric';
    if (geocentric) {
      if (
        position.length !== 3 ||
        point.position.length !== 3 ||
        point.height !== 'not-applicable' ||
        used.heightEffect !== 'not-applicable'
      ) {
        invalid('HEIGHT_SEMANTICS_MISMATCH', details);
      }
    } else if (position.length === 2) {
      if (point.height !== 'absent' || used.heightEffect !== 'none')
        invalid('HEIGHT_SEMANTICS_MISMATCH', details);
    } else if (result.from.dimension === 2) {
      if (
        point.height !== 'auxiliary-preserved' ||
        used.heightEffect !== 'none' ||
        point.position[2] !== position[2]
      ) {
        invalid('HEIGHT_SEMANTICS_MISMATCH', details);
      }
    } else if (used.heightEffect === 'transformed') {
      if (point.height !== 'transformed') invalid('HEIGHT_SEMANTICS_MISMATCH', details);
    } else if (used.heightEffect === 'preserved') {
      if (point.height !== 'crs-preserved') invalid('HEIGHT_SEMANTICS_MISMATCH', details);
    } else invalid('HEIGHT_SEMANTICS_MISMATCH', details);
  });
  if (referenced.size !== operations.size) invalid('UNUSED_OPERATION');
}

function validateOperationApplicability(
  operation: CoordinatesOperation,
  response: {releaseId: string; provenance: CoordinatesProvenance},
  invalid: (reason: CoordinatesErrorReason, details?: CoordinatesErrorDetails) => never,
  details: CoordinatesErrorDetails = {},
  forTransform = false,
) {
  const applicability = operation.applicability;
  if (applicability?.source === 'analytic-proof') {
    const proof = response.provenance.applicabilityProofs?.find(
      (candidate) => candidate.id === applicability.proofId,
    );
    if (
      !proof ||
      applicability.releaseId !== response.releaseId ||
      applicability.proofVersion !== proof.version ||
      applicability.method.authority !== proof.method.authority ||
      applicability.method.code !== proof.method.code ||
      operation.ballpark ||
      operation.grids.length !== 0 ||
      operation.heightEffect !== 'not-applicable' ||
      operation.areasOfUse !== null
    )
      invalid('APPLICABILITY_UNDETERMINED', details);
    return applicability;
  }
  if (applicability?.source === 'catalog-area') {
    if (operation.areasOfUse === null) invalid('APPLICABILITY_UNDETERMINED', details);
    return undefined;
  }
  if (forTransform && (applicability?.source === 'unverified' || operation.areasOfUse === null)) {
    invalid('APPLICABILITY_UNDETERMINED', details);
  }
  return undefined;
}

function isAnalyticTransformPair(
  source: CoordinatesCrsSummary,
  target: CoordinatesCrsSummary,
): boolean {
  return (
    source.eligibility.eligible &&
    target.eligibility.eligible &&
    !source.dynamic &&
    !target.dynamic &&
    source.dimension === 3 &&
    target.dimension === 3 &&
    ((source.kind === 'geographic-3d' && target.kind === 'geocentric') ||
      (source.kind === 'geocentric' && target.kind === 'geographic-3d'))
  );
}

function validateV2Summary(
  summary: CoordinatesCrsSummary,
  invalid: (reason: CoordinatesErrorReason, details?: CoordinatesErrorDetails) => never,
): void {
  if (summary.coordinateModel === undefined) invalid('RESPONSE_SHAPE_INVALID');
}

function hasV2AxisMetadata(axes: readonly CoordinatesAxis[]): boolean {
  return axes.every((axis) => axis.abbreviation !== undefined && axis.meridian !== undefined);
}

function validateV2DescriptionAxes(
  description: CoordinatesCrsDescription,
  invalid: (reason: CoordinatesErrorReason, details?: CoordinatesErrorDetails) => never,
): void {
  const {summary, officialAxes, normalizedAxes, normalization} = description;
  if (!hasV2AxisMetadata(officialAxes) || (normalizedAxes && !hasV2AxisMetadata(normalizedAxes)))
    invalid('RESPONSE_SHAPE_INVALID');
  if (!summary.eligibility.eligible) return;
  if (
    !normalizedAxes ||
    !normalization ||
    !isCoordinatesAxisNormalizationValid(
      officialAxes,
      normalizedAxes,
      normalization,
      summary.coordinateModel,
    )
  )
    invalid('RESPONSE_SHAPE_INVALID');
}

function validateV2TransformAxes(
  axes: {
    official: CoordinatesAxis[];
    normalized: CoordinatesAxis[];
    normalization?: CoordinatesAxisNormalization | null;
  },
  summary: CoordinatesCrsSummary,
  invalid: (reason: CoordinatesErrorReason, details?: CoordinatesErrorDetails) => never,
): void {
  if (!hasV2AxisMetadata(axes.official) || !hasV2AxisMetadata(axes.normalized))
    invalid('RESPONSE_SHAPE_INVALID');
  const parsed = coordinatesAxisNormalizationSchema.safeParse(axes.normalization);
  if (
    !parsed.success ||
    !isCoordinatesAxisNormalizationValid(
      axes.official,
      axes.normalized,
      parsed.data,
      summary.coordinateModel,
    )
  )
    invalid('RESPONSE_SHAPE_INVALID');
}
