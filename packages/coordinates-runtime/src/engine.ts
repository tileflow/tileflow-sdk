import {readFile, stat} from 'node:fs/promises';
import {z} from 'zod';
import {
  type CoordinatesCommand,
  CoordinatesContractError,
  type CoordinatesCrsDescription,
  coordinatesCrsDescriptionSchema,
  type CoordinatesErrorCode,
  type CoordinatesErrorDetails,
  type CoordinatesErrorReason,
  coordinatesGridSchema,
  type CoordinatesOperation,
  coordinatesOperationSchema,
  type CoordinatesProvenance,
  type CoordinatesRequest,
  type CoordinatesResponse,
  parseCoordinatesRequest,
  parseCoordinatesResponse,
  validateCoordinatesTransformRequest,
} from '@tileflow/coordinates/contract';
import {digest} from './identity';
import {CoordinatesNativeError, createNativeRunner} from './native';
import {verifiedAnalyticProofPath} from './proofs';

const catalogSchema = z
  .array(
    z
      .object({
        description: coordinatesCrsDescriptionSchema,
        aliases: z.array(z.string()).max(1024),
      })
      .strict(),
  )
  .max(100000);
const nativeOperationSchema = z
  .object(coordinatesOperationSchema.shape)
  .omit({operationRef: true, releaseId: true, from: true, to: true, direction: true, grids: true})
  .extend({
    analyticProofId: z
      .string()
      .regex(/^ap_[a-f0-9]{64}$/u)
      .nullable(),
    index: z.number().int().nonnegative().optional(),
    internalPipeline: z
      .string()
      .max(1024 * 1024)
      .nullable(),
    grids: z.array(z.object({name: z.string(), available: z.boolean()}).strict()).max(128),
  });
type NativeOperation = z.infer<typeof nativeOperationSchema>;
type Grid = z.infer<typeof coordinatesGridSchema>;
type Warning = CoordinatesResponse<'search'>['warnings'][number];
type Pair = {from: string; to: string};

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const tokens = (value: string) => normalize(value).trim().split(/\s+/u);
const matches = (value: string, query: string) =>
  tokens(query).every((token) => normalize(value).includes(token));

export async function createCoordinatesEngine(options: {
  nativePath: string;
  resourceDirectory: string;
  catalogPath: string;
  root: string;
  releaseId: string;
  provenance: CoordinatesProvenance;
  resources: Grid[];
}) {
  if ((await stat(options.catalogPath)).size > 64 * 1024 * 1024) throw new Error('CATALOG_INVALID');
  const catalog = catalogSchema.parse(JSON.parse(await readFile(options.catalogPath, 'utf8')));
  const byId = new Map(catalog.map((record) => [record.description.summary.id, record]));
  if (byId.size !== catalog.length) throw new Error('CATALOG_INVALID');
  const resources = new Map(options.resources.map((grid) => [grid.name, grid]));
  const proofPath = await verifiedAnalyticProofPath(options.root, options.provenance);
  const runner = createNativeRunner(
    options.nativePath,
    options.resourceDirectory,
    options.root,
    proofPath,
  );
  const context = {
    mode: 'local' as const,
    releaseId: options.releaseId,
    provenance: options.provenance,
  };
  let closed = false;

  function failure(
    command: CoordinatesCommand,
    code: CoordinatesErrorCode,
    reason: CoordinatesErrorReason,
    details: CoordinatesErrorDetails = {},
    phase: 'input' | 'release' | 'selection' | 'execution' | 'response' = 'selection',
  ): never {
    throw new CoordinatesContractError({
      schemaVersion: 1,
      ok: false,
      command,
      releaseId: options.releaseId,
      provenance: options.provenance,
      warnings: [],
      usage: {mode: 'local', units: 0},
      error: {code, reason, phase, details},
    });
  }

  function description(
    command: CoordinatesCommand,
    id: string,
    field: 'id' | 'from' | 'to',
  ): CoordinatesCrsDescription {
    const value = byId.get(id)?.description;
    if (!value)
      failure(command, 'COORDINATES_CRS_NOT_FOUND', 'CRS_NOT_FOUND', {path: [field]}, 'input');
    return value;
  }

  function publicOperation(pair: Pair, raw: NativeOperation): CoordinatesOperation {
    const {index: _index, internalPipeline, analyticProofId, ...data} = raw;
    const proof = options.provenance.applicabilityProofs?.find(
      (proof) => proof.id === analyticProofId,
    );
    if (analyticProofId && !proof) throw new Error('UNDECLARED_ANALYTIC_PROOF');
    const applicability = proof
      ? {
          source: 'analytic-proof' as const,
          proofId: proof.id,
          proofVersion: proof.version,
          method: proof.method,
          releaseId: options.releaseId,
        }
      : {source: data.areasOfUse === null ? ('unverified' as const) : ('catalog-area' as const)};
    const binding = {from: pair.from, to: pair.to};
    const grids = raw.grids.map((grid) => {
      const verified = resources.get(grid.name);
      return verified && grid.available
        ? verified
        : {
            name: grid.name,
            available: false,
            digest: verified?.digest ?? null,
            license: verified?.license ?? null,
            attribution: verified?.attribution ?? [],
          };
    });
    return coordinatesOperationSchema.parse({
      ...data,
      applicability,
      ...binding,
      grids,
      direction: 'forward',
      releaseId: options.releaseId,
      instantiable: data.instantiable && grids.every((grid) => grid.available),
      operationRef: `op_${digest({
        releaseId: options.releaseId,
        ...binding,
        direction: 'forward',
        internalPipeline,
        name: data.name,
        identifiers: data.identifiers,
        areasOfUse: data.areasOfUse,
        accuracy: data.accuracy,
        ballpark: data.ballpark,
        grids: grids.map((grid) => grid.name),
        heightEffect: data.heightEffect,
        applicability,
      })}`,
    });
  }

  async function native(
    command: CoordinatesCommand,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let reply: {
      ok: boolean;
      result?: unknown;
      code?: string;
      index?: number;
      details?: {missingGrids?: string[]};
    };
    try {
      const raw = await runner.run(body, signal);
      reply = z
        .union([
          z.object({ok: z.literal(true), result: z.unknown()}).strict(),
          z
            .object({
              ok: z.literal(false),
              code: z.string(),
              index: z.number().int().min(-1).max(49),
              details: z
                .object({missingGrids: z.array(z.string().max(256)).max(128).optional()})
                .strict()
                .optional(),
            })
            .strict(),
        ])
        .parse(raw);
    } catch (error) {
      if (error instanceof CoordinatesNativeError && error.code === 'CANCELLED')
        failure(command, 'COORDINATES_CANCELLED', 'CANCELLED', {}, 'execution');
      if (error instanceof CoordinatesNativeError && error.code === 'TIMEOUT')
        failure(command, 'COORDINATES_TIMEOUT', 'TIMEOUT', {}, 'execution');
      if (error instanceof CoordinatesNativeError && error.code === 'UNAVAILABLE')
        failure(command, 'COORDINATES_UNAVAILABLE', 'SERVICE_UNAVAILABLE', {}, 'execution');
      failure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', {}, 'response');
    }
    if (reply.ok) return reply.result;
    const point = command === 'transform' ? {pointIndex: Math.max(0, reply.index ?? 0)} : {};
    const mapping: Record<
      string,
      [CoordinatesErrorCode, CoordinatesErrorReason, CoordinatesErrorDetails?]
    > = {
      MISSING_GRID: ['COORDINATES_MISSING_GRID', 'MISSING_GRID', {scope: 'grid'}],
      OUTSIDE_CRS_AREA: ['COORDINATES_OUTSIDE_AREA', 'OUTSIDE_CRS_AREA', {scope: 'source-crs'}],
      OUTSIDE_TARGET_CRS_AREA: [
        'COORDINATES_OUTSIDE_AREA',
        'OUTSIDE_CRS_AREA',
        {scope: 'target-crs'},
      ],
      OUTSIDE_OPERATION_AREA: [
        'COORDINATES_OUTSIDE_AREA',
        'OUTSIDE_OPERATION_AREA',
        {scope: 'operation'},
      ],
      OUTSIDE_GRID: ['COORDINATES_OUTSIDE_AREA', 'OUTSIDE_GRID', {scope: 'grid'}],
      GRID_NODATA: ['COORDINATES_APPLICABILITY_UNDETERMINED', 'GRID_NODATA', {scope: 'grid'}],
      OUTSIDE_EXECUTION_DOMAIN: [
        'COORDINATES_OUTSIDE_AREA',
        'OUTSIDE_EXECUTION_DOMAIN',
        {scope: 'execution-domain'},
      ],
      APPLICABILITY_UNDETERMINED: [
        'COORDINATES_APPLICABILITY_UNDETERMINED',
        'APPLICABILITY_UNDETERMINED',
      ],
      BEST_KNOWN_UNDETERMINED: [
        'COORDINATES_APPLICABILITY_UNDETERMINED',
        'BEST_KNOWN_UNDETERMINED',
      ],
      BALLPARK_NOT_ALLOWED: ['COORDINATES_BALLPARK_DISALLOWED', 'BALLPARK_NOT_ALLOWED'],
      NO_OPERATION: ['COORDINATES_NO_APPLICABLE_OPERATION', 'NO_OPERATION'],
      OPERATION_UNUSABLE: ['COORDINATES_BEST_KNOWN_UNAVAILABLE', 'OPERATION_UNUSABLE'],
      OPERATION_NOT_FOUND: ['COORDINATES_OPERATION_NOT_FOUND', 'OPERATION_NOT_FOUND'],
      CRS_DIMENSION_MISMATCH: ['COORDINATES_CRS_DIMENSION_MISMATCH', 'CRS_DIMENSION_MISMATCH'],
      UNSUPPORTED_CRS: ['COORDINATES_UNSUPPORTED_CRS', 'UNSUPPORTED_CRS_PROFILE'],
      UNSUPPORTED_AXIS_PROFILE: ['COORDINATES_UNSUPPORTED_CRS', 'UNSUPPORTED_AXIS_PROFILE'],
      CRS_NOT_FOUND: ['COORDINATES_CRS_NOT_FOUND', 'CRS_NOT_FOUND'],
    };
    const entry = mapping[reply.code ?? ''];
    if (!entry)
      failure(command, 'COORDINATES_INVALID_RESPONSE', 'RESPONSE_SHAPE_INVALID', {}, 'response');
    failure(command, entry[0], entry[1], {...point, ...entry[2], ...reply.details});
  }

  function paginate<C extends 'search' | 'operations'>(
    command: C,
    input: CoordinatesRequest<C>,
    values: unknown[],
  ) {
    const request = parseCoordinatesRequest(command, input);
    const {cursor, requiredReleaseId: _requiredReleaseId, ...binding} = request;
    const key = digest({releaseId: options.releaseId, command, ...binding});
    let offset = 0;
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64url');
        if (decoded.toString('base64url') !== cursor) throw new Error();
        const page = z
          .object({key: z.string(), offset: z.number().int().positive()})
          .strict()
          .parse(JSON.parse(decoded.toString('utf8')));
        if (page.key !== key || page.offset >= values.length || page.offset % request.limit !== 0)
          throw new Error();
        offset = page.offset;
      } catch {
        failure(
          command,
          'COORDINATES_INVALID_REQUEST',
          'INVALID_VALUE',
          {path: ['cursor']},
          'input',
        );
      }
    }
    const next = offset + request.limit;
    return {
      items: values.slice(offset, next),
      total: values.length,
      nextCursor:
        next < values.length
          ? Buffer.from(JSON.stringify({key, offset: next})).toString('base64url')
          : null,
    };
  }

  async function execute<C extends CoordinatesCommand>(
    command: C,
    input: CoordinatesRequest<C>,
    signal?: AbortSignal,
  ): Promise<CoordinatesResponse<C>> {
    const request = parseCoordinatesRequest(command, input);
    if (closed) failure(command, 'COORDINATES_UNAVAILABLE', 'SERVICE_UNAVAILABLE', {}, 'release');
    if (signal?.aborted) failure(command, 'COORDINATES_CANCELLED', 'CANCELLED', {}, 'input');
    if (request.requiredReleaseId && request.requiredReleaseId !== options.releaseId)
      failure(
        command,
        'COORDINATES_RELEASE_UNAVAILABLE',
        'RELEASE_UNAVAILABLE',
        {requestedReleaseId: request.requiredReleaseId},
        'release',
      );
    const warnings: Warning[] = [];
    let result: unknown;
    if (command === 'search') {
      const search = parseCoordinatesRequest('search', input);
      const values = catalog
        .filter(({description: item, aliases}) => {
          const summary = item.summary;
          if (
            (search.deprecated === 'exclude' && summary.deprecated) ||
            (search.deprecated === 'only' && !summary.deprecated)
          )
            return false;
          const fields = {
            name: summary.name,
            area: summary.areasOfUse?.map((area) => area.name ?? '').join(' ') ?? '',
            datum: item.datum?.name ?? '',
            ellipsoid: item.ellipsoid?.name ?? '',
            unit: item.officialAxes.map((axis) => axis.unit.name).join(' '),
            kind: summary.kind,
          };
          for (const [key, value] of Object.entries(search.filters ?? {})) {
            if (
              key === 'kind'
                ? value !== fields.kind
                : !matches(fields[key as keyof typeof fields], value)
            )
              return false;
          }
          return (
            !search.query ||
            matches([summary.id, ...aliases, ...Object.values(fields)].join(' '), search.query)
          );
        })
        .sort((a, b) => {
          const exact = (record: typeof a) =>
            search.query &&
            normalize(record.description.summary.id.replace(/^EPSG:/u, '')) ===
              normalize(search.query.replace(/^EPSG:/iu, ''))
              ? 0
              : 1;
          return (
            exact(a) - exact(b) ||
            Number(a.description.summary.id.slice(5)) - Number(b.description.summary.id.slice(5))
          );
        })
        .map((record) => record.description.summary);
      result = paginate('search', search, values);
    } else if (command === 'describe') {
      const describe = parseCoordinatesRequest('describe', input);
      const base = description('describe', describe.id, 'id');
      result = describe.formats.length
        ? coordinatesCrsDescriptionSchema.parse(
            await native(command, {command, ...describe}, signal),
          )
        : base;
      for (const definition of (result as CoordinatesCrsDescription).definitions) {
        if (definition.content === null)
          warnings.push({code: 'EXPORT_UNAVAILABLE', crsId: describe.id});
        else if (definition.lossy) warnings.push({code: 'LEGACY_EXPORT_LOSSY', crsId: describe.id});
      }
      if (base.summary.deprecated) warnings.push({code: 'DEPRECATED_CRS', crsId: describe.id});
    } else {
      const pair = parseCoordinatesRequest('operations', {
        from: (request as Pair).from,
        to: (request as Pair).to,
      });
      const from = description(command, pair.from, 'from');
      const to = description(command, pair.to, 'to');
      for (const value of [from, to])
        if (
          value.summary.deprecated &&
          !warnings.some((warning) => warning.crsId === value.summary.id)
        )
          warnings.push({code: 'DEPRECATED_CRS', crsId: value.summary.id});
      if (command === 'operations') {
        const operations = parseCoordinatesRequest('operations', input);
        const raw = z
          .array(nativeOperationSchema)
          .max(4096)
          .parse(await native(command, {command, from: pair.from, to: pair.to}, signal));
        const values = [
          ...new Map(
            raw.map((item) => {
              const operation = publicOperation(pair, item);
              return [operation.operationRef, operation] as const;
            }),
          ).values(),
        ];
        if (operations.areaOfInterest)
          values.sort(
            (a, b) =>
              Number(intersects(b, operations.areaOfInterest!)) -
              Number(intersects(a, operations.areaOfInterest!)),
          );
        const page = paginate('operations', operations, values);
        result = {
          from: pair.from,
          to: pair.to,
          operations: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
        };
      } else {
        const transform = validateCoordinatesTransformRequest(input, from.summary, to.summary);
        let operationIndex: number | undefined;
        if (transform.operationRef) {
          const raw = z
            .array(nativeOperationSchema)
            .max(4096)
            .parse(
              await native(command, {command: 'operations', from: pair.from, to: pair.to}, signal),
            );
          const found = raw.find(
            (item) => publicOperation(pair, item).operationRef === transform.operationRef,
          );
          if (!found || found.index === undefined)
            failure(command, 'COORDINATES_OPERATION_NOT_FOUND', 'OPERATION_NOT_FOUND', {
              operationRef: transform.operationRef,
            });
          operationIndex = found.index;
        }
        const {operationRef: _ref, ...parameters} = transform;
        const raw = await native(
          command,
          {command, ...parameters, ...(operationIndex === undefined ? {} : {operationIndex})},
          signal,
        );
        const rows = z
          .array(
            z
              .object({
                position: z.array(z.number().finite()).min(2).max(3),
                operation: nativeOperationSchema,
                bestKnown: nativeOperationSchema,
                analyticProofVerified: z.boolean(),
                height: z.enum([
                  'absent',
                  'auxiliary-preserved',
                  'crs-preserved',
                  'transformed',
                  'not-applicable',
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(50)
          .parse(raw);
        const operations = new Map<string, CoordinatesOperation>();
        const results = rows.map((row, pointIndex) => {
          const used = publicOperation(pair, row.operation);
          const best = publicOperation(pair, row.bestKnown);
          const analytical = used.applicability?.source === 'analytic-proof';
          if (row.analyticProofVerified !== analytical)
            failure(
              command,
              'COORDINATES_APPLICABILITY_UNDETERMINED',
              'APPLICABILITY_UNDETERMINED',
              {pointIndex},
            );
          if (!used.instantiable)
            failure(command, 'COORDINATES_MISSING_GRID', 'MISSING_GRID', {
              pointIndex,
              missingGrids: used.grids.filter((grid) => !grid.available).map((grid) => grid.name),
            });
          operations.set(used.operationRef, used);
          operations.set(best.operationRef, best);
          const same = used.operationRef === best.operationRef;
          if (row.height === 'auxiliary-preserved')
            warnings.push({code: 'AUXILIARY_Z_UNTRANSFORMED', pointIndex});
          if (used.ballpark)
            warnings.push({code: 'BALLPARK_APPLIED', pointIndex, operationRef: used.operationRef});
          if (!same)
            warnings.push({
              code: 'BEST_KNOWN_NOT_USED',
              pointIndex,
              operationRef: used.operationRef,
            });
          return {
            position: row.position,
            operationRef: used.operationRef,
            height: row.height,
            ...(used.applicability?.source === 'analytic-proof'
              ? {analyticalProof: {proofId: used.applicability.proofId, status: 'verified'}}
              : {}),
            selection: {
              mode: transform.operationRef ? 'explicit' : 'automatic',
              bestKnown: {operationRef: best.operationRef, relation: same ? 'same' : 'different'},
              relaxationsApplied: [
                ...(used.ballpark ? ['ballpark'] : []),
                ...(!same ? ['best-known'] : []),
              ],
            },
            applicability: {
              crsArea: 'verified',
              operationArea: analytical ? 'not-provided' : 'verified',
              gridCoverage: used.grids.length ? 'verified' : 'not-required',
              executionDomain: 'verified',
            },
          };
        });
        result = {
          from: from.summary,
          to: to.summary,
          axes: {
            from: {
              official: from.officialAxes,
              normalized: from.normalizedAxes,
              normalization: from.normalization,
            },
            to: {
              official: to.officialAxes,
              normalized: to.normalizedAxes,
              normalization: to.normalization,
            },
          },
          ...(transform.areaOfInterest ? {areaOfInterest: transform.areaOfInterest} : {}),
          policy: {
            allowBallpark: transform.allowBallpark,
            requireBestKnown: transform.requireBestKnown,
          },
          results,
          operations: [...operations.values()],
        };
      }
    }
    return parseCoordinatesResponse(
      command,
      input,
      {
        schemaVersion: 1,
        ok: true,
        command,
        releaseId: options.releaseId,
        provenance: options.provenance,
        warnings,
        usage: {mode: 'local', units: 0},
        result,
      },
      context,
    );
  }

  async function dispatch<C extends CoordinatesCommand>(
    command: C,
    input: CoordinatesRequest<C>,
    signal?: AbortSignal,
  ): Promise<CoordinatesResponse<C>> {
    try {
      return await execute(command, input, signal);
    } catch (error) {
      if (error instanceof CoordinatesContractError) {
        return {
          ...error.toJSON(),
          command,
          releaseId: options.releaseId,
          provenance: options.provenance,
          usage: {mode: 'local', units: 0},
        } as CoordinatesResponse<C>;
      }
      return {
        schemaVersion: 1,
        ok: false,
        command,
        releaseId: options.releaseId,
        provenance: options.provenance,
        warnings: [],
        usage: {mode: 'local', units: 0},
        error: {
          code: 'COORDINATES_INVALID_RESPONSE',
          reason: 'RESPONSE_SHAPE_INVALID',
          phase: 'response',
          details: {},
        },
      } as CoordinatesResponse<C>;
    }
  }

  return {
    execute: dispatch,
    async readiness() {
      const reply = await runner.run({command: 'metadata'});
      const parsed = z
        .object({
          ok: z.literal(true),
          result: z
            .object({
              engine: z.string(),
              catalog: z.string(),
              networkEnabled: z.literal(false),
              analyticProofId: z.string().nullable(),
            })
            .strict(),
        })
        .strict()
        .parse(reply);
      if (
        parsed.result.engine !== options.provenance.engine.version ||
        parsed.result.catalog !== options.provenance.catalog.revision ||
        parsed.result.analyticProofId !== (options.provenance.applicabilityProofs?.[0]?.id ?? null)
      )
        throw new Error('ENGINE_RELEASE_MISMATCH');
    },
    close() {
      closed = true;
      runner.close();
    },
  };
}

function intersects(operation: CoordinatesOperation, bounds: [number, number, number, number]) {
  const intervals = (west: number, east: number) =>
    west <= east
      ? [[west, east]]
      : [
          [west, 180],
          [-180, east],
        ];
  return (
    operation.areasOfUse?.some(
      ({bounds: [west, south, east, north]}) =>
        south <= bounds[3] &&
        north >= bounds[1] &&
        intervals(west, east).some(([left, right]) =>
          intervals(bounds[0], bounds[2]).some(([a, b]) => left <= b && right >= a),
        ),
    ) ?? false
  );
}
