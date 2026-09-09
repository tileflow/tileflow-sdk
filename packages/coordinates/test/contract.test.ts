import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  coordinatesAnalyticProofSchema,
  CoordinatesContractError,
  coordinatesFailureSchema,
  coordinatesLimits,
  coordinatesResponseSchema,
  isCoordinatesAxisNormalizationValid,
  parseCoordinatesJsonRequest,
  parseCoordinatesRequest,
  parseCoordinatesResponse,
  validateCoordinatesTransformRequest,
} from '../src/contract';
import {
  context,
  description,
  operation,
  operationRef,
  otherOperationRef,
  otherReleaseId,
  provenance,
  releaseId,
  request,
  summary,
  transformResponse,
} from './fixtures';

const analyticProof = {
  id: `ap_${'e'.repeat(64)}`,
  digest: 'e'.repeat(64),
  version: 1,
  method: {authority: 'EPSG' as const, code: '9602'},
  algorithm: 'epsg-9602-static-v1' as const,
  tolerances: {angularDegrees: 1e-9, linearMetres: 0.002},
};

function analyticTransform(reverse = false, positions: [number, number, number][] = [[1, 2, 3]]) {
  const proof = structuredClone(analyticProof);
  const input = reverse
    ? {from: 'EPSG:4978', to: 'EPSG:4979', positions}
    : {from: 'EPSG:4979', to: 'EPSG:4978', positions};
  const reply = structuredClone(transformResponse(input, 3)) as any;
  reply.provenance.applicabilityProofs = [proof];
  reply.provenance.numericConvention = 'explicit-axis-models-v2';
  for (const [side, kind] of [
    ['from', reverse ? 'geocentric' : 'geographic-3d'],
    ['to', reverse ? 'geographic-3d' : 'geocentric'],
  ] as const) {
    const geocentric = kind === 'geocentric';
    reply.result[side] = {
      ...reply.result[side],
      kind,
      coordinateModel: geocentric ? 'geocentric' : 'geographic',
    };
    const normalized = (
      geocentric ? ['geocentricX', 'geocentricY', 'geocentricZ'] : ['east', 'north', 'up']
    ).map((direction, index) => ({
      name: direction,
      abbreviation: direction,
      direction,
      meridian: null,
      unit:
        !geocentric && index < 2 ? {name: 'degree', toSI: Math.PI / 180} : {name: 'metre', toSI: 1},
    }));
    reply.result.axes[side] = {
      official: geocentric ? normalized : [normalized[1], normalized[0], normalized[2]],
      normalized,
      normalization: {
        method: 'signed-permutation-v1',
        publicToOfficial: (geocentric ? [0, 1, 2] : [1, 0, 2]).map((officialAxis) => ({
          officialAxis,
          scale: 1,
        })),
      },
    };
  }
  reply.result.operations[0] = {
    ...reply.result.operations[0],
    ballpark: false,
    grids: [],
    heightEffect: 'not-applicable',
    areasOfUse: null,
    applicability: {
      source: 'analytic-proof',
      proofId: proof.id,
      proofVersion: 1,
      method: proof.method,
      releaseId,
    },
  };
  for (const point of reply.result.results) {
    point.height = 'not-applicable';
    point.applicability.operationArea = 'not-provided';
    point.analyticalProof = {proofId: proof.id, status: 'verified'};
  }
  return {input, reply};
}

function rejected(run: () => unknown, reason: string, pointIndex?: number) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof CoordinatesContractError);
    assert.equal(error.reason, reason);
    if (pointIndex !== undefined) assert.equal(error.details.pointIndex, pointIndex);
    const serialized = JSON.parse(JSON.stringify(error));
    assert.equal(serialized.schemaVersion, 1);
    assert.equal(serialized.ok, false);
    assert.equal(serialized.error.reason, reason);
    assert.equal(coordinatesFailureSchema.safeParse(serialized).success, true);
    return true;
  });
}

test('request defaults are strict, optional release pin does not block ordinary use', () => {
  const parsed = parseCoordinatesRequest('transform', request);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.allowBallpark, false);
  assert.equal(parsed.requireBestKnown, true);
  assert.equal(parsed.requiredReleaseId, undefined);
  assert.equal(parseCoordinatesRequest('search', {}).limit, 50);
  assert.equal(parseCoordinatesRequest('search', {}).deprecated, 'exclude');
  assert.equal(
    parseCoordinatesResponse('transform', request, transformResponse(), context).ok,
    true,
  );
});

test('strict objects reject unknown fields at the root and nested metadata', () => {
  for (const extra of [
    {epoch: 2020},
    {pipeline: '+proj=noop'},
    {operationIndex: 0},
    {mapId: 'map'},
    {apiKey: 'secret'},
  ]) {
    rejected(() => parseCoordinatesRequest('transform', {...request, ...extra}), 'UNKNOWN_FIELD');
  }
  rejected(
    () => parseCoordinatesRequest('search', {filters: {countryPolygon: true}}),
    'UNKNOWN_FIELD',
  );
  const reply = transformResponse() as any;
  reply.result.operations[0].grids.push({
    name: 'x.tif',
    available: false,
    digest: null,
    license: null,
    attribution: [],
    downloadUrl: 'https://example.com',
  });
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('1 and 50 homogeneous positions pass; empty, 51, mixed, nonfinite and extra ordinates fail', () => {
  for (const length of [1, 50]) {
    const input = {...request, positions: Array.from({length}, () => [12, 55])};
    assert.equal(parseCoordinatesRequest('transform', input).positions.length, length);
    assert.equal(
      parseCoordinatesResponse('transform', input, transformResponse(input), context).ok,
      true,
    );
  }
  for (const length of [0, 51])
    rejected(
      () =>
        parseCoordinatesRequest('transform', {
          ...request,
          positions: Array.from({length}, () => [12, 55]),
        }),
      'INVALID_VALUE',
    );
  rejected(
    () =>
      parseCoordinatesRequest('transform', {
        ...request,
        positions: [
          [12, 55],
          [12, 55, 3],
        ],
      }),
    'MIXED_POSITION_DIMENSIONS',
    1,
  );
  for (const position of [
    [12, NaN],
    [12, Infinity],
    [12, 55, -Infinity],
    [12, 55, 3, 2020],
    ['12', 55],
  ]) {
    rejected(
      () => parseCoordinatesRequest('transform', {...request, positions: [[12, 55], position]}),
      'INVALID_POSITION',
      1,
    );
  }
});

test('JSON request failures remain machine-readable and do not echo input values', () => {
  rejected(() => parseCoordinatesJsonRequest('transform', '{'), 'INVALID_JSON');
  rejected(
    () =>
      parseCoordinatesJsonRequest('search', ' '.repeat(coordinatesLimits.maximumRequestBytes + 1)),
    'REQUEST_TOO_LARGE',
  );
  try {
    parseCoordinatesJsonRequest('transform', '{"from":"SECRET-IN-INPUT"}');
    assert.fail('Expected failure');
  } catch (error) {
    assert.ok(error instanceof CoordinatesContractError);
    assert.equal(JSON.stringify(error).includes('SECRET-IN-INPUT'), false);
    assert.equal(error.response.releaseId, null);
  }
});

test('unknown runtime command values also produce the stable failure envelope', () => {
  rejected(() => parseCoordinatesRequest('unsupported' as any, {}), 'INVALID_VALUE');
});

test('CRS dimensionality mismatches have a specific diagnostic in both directions', () => {
  for (const [fromDimension, toDimension] of [
    [2, 3],
    [3, 2],
  ] as const) {
    assert.throws(
      () =>
        validateCoordinatesTransformRequest(
          {...request, positions: [[12, 55, 10]]},
          summary(request.from, fromDimension),
          summary(request.to, toDimension),
        ),
      (error: unknown) => {
        assert.ok(error instanceof CoordinatesContractError);
        assert.equal(error.code, 'COORDINATES_CRS_DIMENSION_MISMATCH');
        assert.equal(error.details.sourceDimension, fromDimension);
        assert.equal(error.details.targetDimension, toDimension);
        return true;
      },
    );
  }
  rejected(
    () =>
      validateCoordinatesTransformRequest(
        request,
        summary(request.from, 3),
        summary(request.to, 3),
      ),
    'INVALID_POSITION',
    0,
  );
});

test('excluded dynamic CRS remains describable but cannot enter execution', () => {
  const crs = {
    ...summary(request.from, 3),
    dynamic: true,
    eligibility: {eligible: false, reasons: ['DYNAMIC_CRS'] as const},
  };
  rejected(
    () =>
      validateCoordinatesTransformRequest(
        {...request, positions: [[12, 55, 10]]},
        crs as any,
        summary(request.to, 3),
      ),
    'UNSUPPORTED_CRS_PROFILE',
  );
});

test('auxiliary 2D z is preserved and declared untransformed, including JSON negative zero', () => {
  const input = {...request, positions: [[12, 55, -0]]};
  const reply = JSON.parse(JSON.stringify(transformResponse(input)));
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  reply.result.results[0].position[2] = 1;
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'HEIGHT_SEMANTICS_MISMATCH',
    0,
  );
});

test('3D height provenance follows operation semantics, not whether its number changed', () => {
  const input = {...request, positions: [[12, 55, 10]]};
  const reply = transformResponse(input, 3);
  assert.equal(reply.result.results[0].position[2], 10);
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  reply.result.operations[0].heightEffect = 'unknown';
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'HEIGHT_SEMANTICS_MISMATCH',
    0,
  );
});

test('explicit operation authorizes a non-best choice independently of requireBestKnown', () => {
  const input = {...request, operationRef};
  const reply = transformResponse(input);
  reply.result.operations.push(
    operation(request, {
      operationRef: otherOperationRef,
      instantiable: false,
      methodSupported: false,
      accuracy: 0.01,
    }),
  );
  reply.result.results[0].selection.bestKnown = {
    operationRef: otherOperationRef,
    relation: 'different',
  };
  reply.result.results[0].selection.relaxationsApplied = ['best-known'];
  assert.equal(reply.result.policy.requireBestKnown, true);
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  reply.result.results[0].selection.relaxationsApplied = [];
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'POLICY_MISMATCH',
    0,
  );
});

test('explicit ballpark still needs its separate permission and reports unknown accuracy', () => {
  const input = {...request, operationRef};
  const reply = transformResponse(input);
  reply.result.operations[0].ballpark = true;
  reply.result.results[0].selection.relaxationsApplied = ['ballpark'];
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'BALLPARK_NOT_ALLOWED',
    0,
  );
  const allowed = {...input, allowBallpark: true};
  reply.result.policy.allowBallpark = true;
  assert.equal(parseCoordinatesResponse('transform', allowed, reply, context).ok, true);
  assert.equal(reply.result.operations[0].accuracy, null);
});

test('automatic selection cannot quietly use an inferior operation', () => {
  const reply = transformResponse();
  reply.result.operations.push(operation(request, {operationRef: otherOperationRef}));
  reply.result.results[0].selection.bestKnown = {
    operationRef: otherOperationRef,
    relation: 'different',
  };
  reply.result.results[0].selection.relaxationsApplied = ['best-known'];
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'BEST_KNOWN_UNAVAILABLE',
    0,
  );
  reply.result.policy.requireBestKnown = false;
  assert.equal(
    parseCoordinatesResponse('transform', {...request, requireBestKnown: false}, reply, context).ok,
    true,
  );
});

test('AOI guides candidates and can exclude an input point without rejecting that point', () => {
  const input = {
    ...request,
    areaOfInterest: [170, -10, -170, 10] as [number, number, number, number],
  };
  const reply = transformResponse(input);
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  const bad = structuredClone(reply) as any;
  bad.result.results[0].applicability.operationArea = 'undetermined';
  rejected(
    () => parseCoordinatesResponse('transform', input, bad, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('dispersed batches use a deduplicated operation table and preserve every position', () => {
  const input = {
    ...request,
    positions: [
      [12, 55],
      [10, 50],
      [12, 55],
    ],
  };
  const reply = transformResponse(input);
  reply.result.operations.push(operation(request, {operationRef: otherOperationRef}));
  reply.result.results[1].operationRef = otherOperationRef;
  reply.result.results[1].selection.bestKnown.operationRef = otherOperationRef;
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  reply.result.results.pop();
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'RESULT_COUNT_MISMATCH',
  );
});

test('unknown, duplicate, unused and foreign operation references fail validation', () => {
  const unknown = transformResponse();
  unknown.result.results[0].operationRef = otherOperationRef;
  rejected(
    () => parseCoordinatesResponse('transform', request, unknown, context),
    'UNKNOWN_OPERATION_REF',
    0,
  );
  const duplicate = transformResponse();
  duplicate.result.operations.push(structuredClone(duplicate.result.operations[0]));
  rejected(
    () => parseCoordinatesResponse('transform', request, duplicate, context),
    'DUPLICATE_OPERATION_REF',
  );
  const unused = transformResponse();
  unused.result.operations.push(operation(request, {operationRef: otherOperationRef}));
  rejected(
    () => parseCoordinatesResponse('transform', request, unused, context),
    'UNUSED_OPERATION',
  );
  for (const override of [{releaseId: otherReleaseId}, {from: request.to}, {to: request.from}]) {
    const foreign = transformResponse();
    Object.assign(foreign.result.operations[0], override);
    rejected(
      () => parseCoordinatesResponse('transform', request, foreign, context),
      'releaseId' in override ? 'RELEASE_MISMATCH' : 'OPERATION_BINDING_MISMATCH',
    );
  }
});

test('all used resources must be available and attested before success', () => {
  const reply = transformResponse() as any;
  reply.result.operations[0].grids.push({
    name: 'required.tif',
    available: false,
    digest: null,
    license: null,
    attribution: [],
  });
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('release pins and known artifact context cannot be substituted', () => {
  const reply = transformResponse();
  rejected(
    () =>
      parseCoordinatesResponse(
        'transform',
        {...request, requiredReleaseId: otherReleaseId},
        reply,
        {mode: 'local'},
      ),
    'RELEASE_MISMATCH',
  );
  rejected(
    () =>
      parseCoordinatesResponse('transform', request, reply, {
        ...context,
        artifactId: 'another-runtime',
      }),
    'PROVENANCE_MISMATCH',
  );
});

test('successful Hosted transforms consume exactly N units; local consumes zero', () => {
  const input = {
    ...request,
    positions: [
      [12, 55],
      [10, 50],
    ],
  };
  const reply = transformResponse(input);
  reply.usage = {mode: 'hosted', state: 'committed', units: 2};
  reply.invocationId = 'cq_00000000-0000-4000-8000-000000000001';
  assert.equal(parseCoordinatesResponse('transform', input, reply, {mode: 'hosted'}).ok, true);
  reply.usage.units = 1;
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, {mode: 'hosted'}),
    'USAGE_MISMATCH',
  );
  rejected(
    () => parseCoordinatesResponse('transform', input, transformResponse(input), {mode: 'hosted'}),
    'USAGE_MISMATCH',
  );
});

test('atomic failures carry an index and prohibit success data or invented consumption', () => {
  const failure = {
    schemaVersion: 1,
    ok: false,
    command: 'transform',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'hosted', state: 'not-consumed', units: 0},
    error: {
      code: 'COORDINATES_MISSING_GRID',
      reason: 'MISSING_GRID',
      phase: 'selection',
      details: {pointIndex: 1, missingGrids: ['needed.tif']},
    },
  };
  const input = {
    ...request,
    positions: [
      [12, 55],
      [10, 50],
    ],
  };
  assert.equal(parseCoordinatesResponse('transform', input, failure, {mode: 'hosted'}).ok, false);
  rejected(
    () => parseCoordinatesResponse('transform', input, {...failure, result: []}, {mode: 'hosted'}),
    'RESPONSE_SHAPE_INVALID',
  );
  const unconfirmed = {
    ...failure,
    invocationId: 'cq_00000000-0000-4000-8000-000000000001',
    usage: {mode: 'hosted', state: 'unconfirmed', units: null},
    error: {
      ...failure.error,
      code: 'COORDINATES_CONSUMPTION_UNCONFIRMED',
      reason: 'CONSUMPTION_UNCONFIRMED',
      phase: 'consumption',
    },
  };
  assert.equal(
    parseCoordinatesResponse('transform', input, unconfirmed, {mode: 'hosted'}).ok,
    false,
  );
  rejected(
    () =>
      parseCoordinatesResponse(
        'transform',
        input,
        {...unconfirmed, usage: failure.usage},
        {mode: 'hosted'},
      ),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('remote diagnostics do not become untrusted prose in agent-visible failures', () => {
  const value = {
    schemaVersion: 1,
    ok: false,
    command: 'transform',
    releaseId,
    provenance,
    warnings: [{code: 'DEPRECATED_CRS', crsId: request.from, message: 'input 12.3,45.6'}],
    usage: {mode: 'hosted', state: 'not-consumed', units: 0},
    error: {
      code: 'COORDINATES_MISSING_GRID',
      reason: 'MISSING_GRID',
      phase: 'selection',
      details: {pointIndex: 0, missingGrids: ['required.tif']},
      message: 'input 12.3,45.6',
    },
  };
  const reply = parseCoordinatesResponse('transform', request, value, {mode: 'hosted'});
  assert.equal(JSON.stringify(reply).includes('12.3,45.6'), false);
  assert.equal(reply.ok, false);
  if (reply.ok) assert.fail();
  assert.equal(reply.error.code, 'COORDINATES_MISSING_GRID');
  assert.deepEqual(reply.error.details.missingGrids, ['required.tif']);
});

test('search is bounded, deterministic in shape, and permits empty results', () => {
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'search',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'hosted', state: 'not-consumed', units: 0},
    result: {items: [summary('EPSG:4258')], total: 1, nextCursor: null},
  };
  assert.equal(
    parseCoordinatesResponse('search', {query: 'ETRS89', filters: {unit: 'degree'}}, reply, {
      mode: 'hosted',
    }).ok,
    true,
  );
  assert.equal(
    parseCoordinatesResponse(
      'search',
      {query: 'absent'},
      {...reply, result: {items: [], total: 0, nextCursor: null}},
      {mode: 'hosted'},
    ).ok,
    true,
  );
  rejected(
    () =>
      parseCoordinatesResponse(
        'search',
        {},
        {
          ...reply,
          result: {...reply.result, items: [summary('EPSG:4258'), summary('EPSG:4258')], total: 2},
        },
        {mode: 'hosted'},
      ),
    'DUPLICATE_CRS_ID',
  );
});

test('describe separates normalized axes from official metadata and explicit standard exports', () => {
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'describe',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: description(),
  };
  reply.result.definitions = [
    {
      format: 'projjson',
      content: '{"type":"GeographicCRS","name":"Fixture"}',
      lossy: false,
      unavailableReason: null,
    },
    {format: 'legacy-proj', content: null, lossy: true, unavailableReason: 'NOT_REPRESENTABLE'},
  ];
  assert.equal(
    parseCoordinatesResponse(
      'describe',
      {id: 'EPSG:4258', formats: ['projjson', 'legacy-proj']},
      reply,
      context,
    ).ok,
    true,
  );
  assert.equal(reply.result.officialAxes[0].direction, 'north');
  assert.equal(reply.result.normalizedAxes?.[0].direction, 'east');
  rejected(
    () => parseCoordinatesResponse('describe', {id: 'EPSG:4258'}, reply, context),
    'RESULT_COUNT_MISMATCH',
  );
});

test('operation discovery preserves unavailable candidates and explicit refs for chaining', () => {
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'operations',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {
      from: request.from,
      to: request.to,
      total: 2,
      nextCursor: null,
      operations: [
        operation(),
        operation(request, {
          operationRef: otherOperationRef,
          instantiable: false,
          methodSupported: false,
        }),
      ],
    },
  };
  const parsed = parseCoordinatesResponse(
    'operations',
    {from: request.from, to: request.to},
    reply,
    context,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) assert.fail();
  const input = {
    ...request,
    operationRef: parsed.result.operations[0].operationRef,
    requiredReleaseId: parsed.releaseId,
  };
  assert.equal(
    parseCoordinatesResponse('transform', input, transformResponse(input), context).ok,
    true,
  );
});

test('v2 provenance requires explicit axis-model metadata and a complete normalization', () => {
  const reply = structuredClone(transformResponse()) as any;
  reply.provenance.numericConvention = 'explicit-axis-models-v2';
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('v2 search summaries require an explicit coordinate model', () => {
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'search',
    releaseId,
    provenance: {...provenance, numericConvention: 'explicit-axis-models-v2' as const},
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {
      items: [{...summary('EPSG:4258'), coordinateModel: 'geographic' as const}],
      total: 1,
      nextCursor: null,
    },
  };
  assert.equal(parseCoordinatesResponse('search', {}, reply, context).ok, true);
  delete (reply.result.items[0] as any).coordinateModel;
  rejected(() => parseCoordinatesResponse('search', {}, reply, context), 'RESPONSE_SHAPE_INVALID');
});

test('v2 accepts explicit polar axes with a signed-permutation normalization', () => {
  const metre = {name: 'metre', toSI: 1};
  const axis = (name: string, abbreviation: string, longitude: number) => ({
    name,
    abbreviation,
    direction: 'north',
    unit: metre,
    meridian: {longitude, unit: {name: 'degree', toSI: Math.PI / 180}},
  });
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'describe',
    releaseId,
    provenance: {...provenance, numericConvention: 'explicit-axis-models-v2' as const},
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {
      ...description(),
      summary: {...summary('EPSG:25832'), coordinateModel: 'projected' as const},
      officialAxes: [axis('Northing', 'N', 0), axis('Easting', 'E', 90)],
      normalizedAxes: [axis('Easting', 'E', 90), axis('Northing', 'N', 0)],
      normalization: {
        method: 'signed-permutation-v1' as const,
        publicToOfficial: [
          {officialAxis: 1, scale: 1},
          {officialAxis: 0, scale: 1},
        ],
      },
    },
  };
  assert.equal(parseCoordinatesResponse('describe', {id: 'EPSG:25832'}, reply, context).ok, true);
});

test('projected normalization cannot expose northing as public x', () => {
  const axes = ['north', 'east'].map((direction) => ({
    name: direction,
    abbreviation: direction,
    direction,
    meridian: null,
    unit: {name: 'metre', toSI: 1},
  }));
  assert.equal(
    isCoordinatesAxisNormalizationValid(
      axes,
      axes,
      {
        method: 'signed-permutation-v1',
        publicToOfficial: [
          {officialAxis: 0, scale: 1},
          {officialAxis: 1, scale: 1},
        ],
      },
      'projected',
    ),
    false,
  );
});

test('linear normalization preserves the declared CRS units', () => {
  const official = ['east', 'north'].map((direction) => ({
    name: direction,
    abbreviation: direction,
    direction,
    meridian: null,
    unit: {name: 'foot', toSI: 0.3048},
  }));
  const normalized = official.map((axis) => ({...axis, unit: {name: 'metre', toSI: 1}}));
  assert.equal(
    isCoordinatesAxisNormalizationValid(
      official,
      normalized,
      {
        method: 'signed-permutation-v1',
        publicToOfficial: [
          {officialAxis: 0, scale: 1 / 0.3048},
          {officialAxis: 1, scale: 1 / 0.3048},
        ],
      },
      'projected',
    ),
    false,
  );
});

test('v2 maps geographic grads to public degrees through public-to-official scale', () => {
  const degree = {name: 'degree', toSI: Math.PI / 180};
  const grad = {name: 'grad', toSI: Math.PI / 200};
  const axis = (
    name: string,
    abbreviation: string,
    direction: string,
    unit: {name: string; toSI: number},
  ) => ({
    name,
    abbreviation,
    direction,
    unit,
    meridian: null,
  });
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'describe',
    releaseId,
    provenance: {...provenance, numericConvention: 'explicit-axis-models-v2' as const},
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {
      ...description(),
      summary: {...summary('EPSG:4258'), coordinateModel: 'geographic' as const},
      officialAxes: [
        axis('Latitude', 'Lat', 'north', grad),
        axis('Longitude', 'Lon', 'east', grad),
      ],
      normalizedAxes: [
        axis('Longitude', 'Lon', 'east', degree),
        axis('Latitude', 'Lat', 'north', degree),
      ],
      normalization: {
        method: 'signed-permutation-v1' as const,
        publicToOfficial: [
          {officialAxis: 1, scale: 10 / 9},
          {officialAxis: 0, scale: 10 / 9},
        ],
      },
    },
  };
  assert.equal(parseCoordinatesResponse('describe', {id: 'EPSG:4258'}, reply, context).ok, true);
  reply.result.normalizedAxes[0].direction = 'west';
  rejected(
    () => parseCoordinatesResponse('describe', {id: 'EPSG:4258'}, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('v2 geocentric transforms label Z as not-applicable, never height', () => {
  const input = {from: 'EPSG:4978', to: 'EPSG:4978', positions: [[1, 2, 3]]};
  const reply = structuredClone(transformResponse(input, 3)) as any;
  reply.provenance.numericConvention = 'explicit-axis-models-v2';
  for (const side of ['from', 'to']) {
    reply.result[side] = {
      ...reply.result[side],
      kind: 'geocentric',
      coordinateModel: 'geocentric',
    };
    reply.result.axes[side] = {
      official: [
        {
          name: 'Geocentric X',
          abbreviation: 'X',
          direction: 'geocentricX',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
        {
          name: 'Geocentric Y',
          abbreviation: 'Y',
          direction: 'geocentricY',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
        {
          name: 'Geocentric Z',
          abbreviation: 'Z',
          direction: 'geocentricZ',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
      ],
      normalized: [
        {
          name: 'Geocentric X',
          abbreviation: 'X',
          direction: 'geocentricX',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
        {
          name: 'Geocentric Y',
          abbreviation: 'Y',
          direction: 'geocentricY',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
        {
          name: 'Geocentric Z',
          abbreviation: 'Z',
          direction: 'geocentricZ',
          unit: {name: 'metre', toSI: 1},
          meridian: null,
        },
      ],
      normalization: {
        method: 'signed-permutation-v1',
        publicToOfficial: [
          {officialAxis: 0, scale: 1},
          {officialAxis: 1, scale: 1},
          {officialAxis: 2, scale: 1},
        ],
      },
    };
  }
  reply.result.operations[0].heightEffect = 'not-applicable';
  reply.result.results[0].height = 'not-applicable';
  assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  reply.result.axes.from.official[0].direction = 'geocentricY';
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
  reply.result.axes.from.official[0].direction = 'geocentricX';
  reply.result.results[0].height = 'transformed';
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'HEIGHT_SEMANTICS_MISMATCH',
    0,
  );
});

test('ineligible compounds may identify their geographic or projected horizontal model', () => {
  const item = {
    ...summary('EPSG:9518', 3),
    eligibility: {eligible: false, reasons: ['DYNAMIC_CRS'] as const},
    coordinateModel: 'geographic' as const,
  };
  assert.equal(
    coordinatesResponseSchema.safeParse({
      schemaVersion: 1,
      ok: true,
      command: 'search',
      releaseId,
      provenance,
      warnings: [],
      usage: {mode: 'local', units: 0},
      result: {items: [item], total: 1, nextCursor: null},
    }).success,
    true,
  );
});

test('v2 rejects malformed signed permutations', () => {
  const reply = structuredClone(transformResponse()) as any;
  reply.provenance.numericConvention = 'explicit-axis-models-v2';
  for (const side of ['from', 'to']) {
    reply.result[side].coordinateModel = side === 'from' ? 'geographic' : 'projected';
    const axes = reply.result.axes[side];
    for (const axis of [...axes.official, ...axes.normalized]) {
      axis.abbreviation = axis.name;
      axis.meridian = null;
    }
    axes.normalization = {
      method: 'signed-permutation-v1',
      publicToOfficial: [
        {officialAxis: 0, scale: 1},
        {officialAxis: 0, scale: 1},
      ],
    };
  }
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('unsupported axis profiles have a specific transform diagnostic', () => {
  const source = {
    ...summary(request.from),
    eligibility: {eligible: false, reasons: ['UNSUPPORTED_AXIS_PROFILE'] as const},
  };
  rejected(
    () => validateCoordinatesTransformRequest(request, source as any, summary(request.to)),
    'UNSUPPORTED_AXIS_PROFILE',
  );
});

test('analytic proofs bind forward and reverse geocentric transforms per point', () => {
  assert.equal(coordinatesAnalyticProofSchema.parse(analyticProof).id, analyticProof.id);
  for (const reverse of [false, true]) {
    const {input, reply} = analyticTransform(reverse);
    assert.equal(parseCoordinatesResponse('transform', input, reply, context).ok, true);
  }
  const batched = analyticTransform(false, [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  delete batched.reply.result.results[1].analyticalProof;
  rejected(
    () => parseCoordinatesResponse('transform', batched.input, batched.reply, context),
    'APPLICABILITY_UNDETERMINED',
    1,
  );
});

test('an analytical proof cannot claim a legacy numeric convention', () => {
  const {input, reply} = analyticTransform();
  reply.provenance.numericConvention = 'xy-geographic-degrees-crs-linear-v1';
  rejected(
    () => parseCoordinatesResponse('transform', input, reply, context),
    'PROVENANCE_MISMATCH',
  );
});

test('analytic proof registries and operation bindings cannot be substituted', () => {
  for (const [mutate, reason] of [
    [(reply: any) => delete reply.provenance.applicabilityProofs, 'APPLICABILITY_UNDETERMINED'],
    [
      (reply: any) => (reply.result.operations[0].applicability.proofId = `ap_${'f'.repeat(64)}`),
      'APPLICABILITY_UNDETERMINED',
    ],
    [
      (reply: any) => (reply.result.operations[0].applicability.releaseId = otherReleaseId),
      'APPLICABILITY_UNDETERMINED',
    ],
    [
      (reply: any) => (reply.result.operations[0].applicability.method.code = '9603'),
      'RESPONSE_SHAPE_INVALID',
    ],
    [(reply: any) => (reply.result.operations[0].ballpark = true), 'APPLICABILITY_UNDETERMINED'],
  ] as const) {
    const {input, reply} = analyticTransform();
    mutate(reply);
    rejected(
      () => parseCoordinatesResponse('transform', input, reply, context),
      reason,
      reason === 'APPLICABILITY_UNDETERMINED' ? 0 : undefined,
    );
  }
});

test('ordinary transforms cannot replace catalog applicability with a null area', () => {
  const reply = transformResponse() as any;
  reply.result.operations[0].areasOfUse = null;
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, context),
    'APPLICABILITY_UNDETERMINED',
    0,
  );
});

test('operation discovery retains unverified null-area candidates without authorizing execution', () => {
  const reply = transformResponse() as any;
  reply.command = 'operations';
  reply.result = {
    from: request.from,
    to: request.to,
    total: 1,
    nextCursor: null,
    operations: [{...operation(), areasOfUse: null, applicability: {source: 'unverified'}}],
  };
  assert.equal(
    parseCoordinatesResponse('operations', {from: request.from, to: request.to}, reply, context).ok,
    true,
  );
});

test('operation discovery validates analytic proof bindings without a transform result', () => {
  const {input, reply} = analyticTransform();
  const operations = {
    ...reply,
    command: 'operations',
    result: {
      from: input.from,
      to: input.to,
      total: 1,
      nextCursor: null,
      operations: reply.result.operations,
    },
  };
  assert.equal(
    parseCoordinatesResponse('operations', {from: input.from, to: input.to}, operations, context)
      .ok,
    true,
  );
  delete operations.provenance.applicabilityProofs;
  rejected(
    () =>
      parseCoordinatesResponse('operations', {from: input.from, to: input.to}, operations, context),
    'APPLICABILITY_UNDETERMINED',
  );
});

test('analytic applicability does not bypass static 3D geographic-geocentric constraints', () => {
  const projected = analyticTransform();
  projected.reply.result.from.kind = 'projected';
  projected.reply.result.from.coordinateModel = 'projected';
  for (const axis of [
    ...projected.reply.result.axes.from.official,
    ...projected.reply.result.axes.from.normalized,
  ])
    axis.unit = {name: 'metre', toSI: 1};
  rejected(
    () => parseCoordinatesResponse('transform', projected.input, projected.reply, context),
    'OPERATION_UNUSABLE',
    0,
  );
  const dynamic = analyticTransform();
  dynamic.reply.result.from.dynamic = true;
  rejected(
    () => parseCoordinatesResponse('transform', dynamic.input, dynamic.reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('published forward vectors fit normalized 2D and 3D contracts without claiming engine execution', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('fixtures/control-points.json', import.meta.url), 'utf8'),
  );
  assert.equal(fixture.controlPoints.length, 4);
  for (const point of fixture.controlPoints) {
    const input = {from: point.from, to: point.to, positions: [point.position]};
    const response = transformResponse(input, point.position.length);
    response.result.results[0].position = point.expectedPosition;
    assert.equal(
      parseCoordinatesResponse('transform', input, JSON.parse(JSON.stringify(response)), context)
        .ok,
      true,
    );
    assert.equal(coordinatesResponseSchema.safeParse(response).success, true);
    assert.ok(point.source.url.startsWith('https://'));
    assert.ok(point.toleranceMetres > 0);
  }
});

test('point failures require their index and resolved failures identify consumption state', () => {
  const failure = {
    schemaVersion: 1,
    ok: false,
    command: 'transform',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    error: {
      code: 'COORDINATES_MISSING_GRID',
      reason: 'MISSING_GRID',
      phase: 'selection',
      details: {missingGrids: ['needed.tif']},
    },
  };
  rejected(
    () => parseCoordinatesResponse('transform', request, failure, context),
    'INVALID_POSITION',
  );
  rejected(
    () =>
      parseCoordinatesResponse(
        'transform',
        request,
        {...failure, usage: null, error: {...failure.error, details: {pointIndex: 0}}},
        context,
      ),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('invalid runtime validation context fails through the stable error contract', () => {
  rejected(
    () =>
      parseCoordinatesResponse('transform', request, transformResponse(), {
        mode: 'local',
        releaseId: 'bad',
      }),
    'INVALID_VALUE',
  );
});

test('a known release descriptor detects provenance changes under an unchanged release ID', () => {
  const reply = transformResponse();
  reply.provenance = {...provenance, gridSetDigest: 'd'.repeat(64)};
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, {...context, provenance} as any),
    'PROVENANCE_MISMATCH',
  );
});

test('a first search page cannot silently omit matches without a continuation cursor', () => {
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'search',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {items: [summary('EPSG:4258')], total: 2, nextCursor: null},
  };
  rejected(() => parseCoordinatesResponse('search', {}, reply, context), 'RESULT_COUNT_MISMATCH');
});

test('description cannot claim static eligibility while describing a dynamic datum', () => {
  const crs = description();
  crs.datum = {name: 'Dynamic fixture', kind: 'dynamic', referenceEpoch: 2020};
  const reply = {
    schemaVersion: 1,
    ok: true,
    command: 'describe',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: crs,
  };
  rejected(
    () => parseCoordinatesResponse('describe', {id: 'EPSG:4258'}, reply, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('transform output includes official and normalized axes and units for both CRS', () => {
  const reply = transformResponse();
  const parsed = parseCoordinatesResponse('transform', request, reply, context);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) assert.fail();
  assert.equal(parsed.result.axes.from.official[0].direction, 'north');
  assert.equal(parsed.result.axes.from.normalized[0].direction, 'east');
  assert.equal(parsed.result.axes.from.normalized[0].unit.name, 'degree');
  assert.equal(parsed.result.axes.to.normalized[0].unit.name, 'metre');
  const invalid = structuredClone(reply) as any;
  invalid.result.axes.to.normalized.reverse();
  rejected(
    () => parseCoordinatesResponse('transform', request, invalid, context),
    'RESPONSE_SHAPE_INVALID',
  );
});

test('committed Hosted transforms require a server invocation reference', () => {
  const reply = transformResponse();
  reply.usage = {mode: 'hosted', state: 'committed', units: 1};
  rejected(
    () => parseCoordinatesResponse('transform', request, reply, {mode: 'hosted'}),
    'USAGE_MISMATCH',
  );
});

for (const malformed of ['attribution URL', 'empty axes']) {
  test(`malformed ${malformed} stays inside the structured failure boundary`, () => {
    const reply = transformResponse() as any;
    if (malformed === 'attribution URL') {
      reply.result.operations[0].grids = [
        {
          name: 'grid.tif',
          available: true,
          digest: 'c'.repeat(64),
          license: 'CC0-1.0',
          attribution: [{text: 'Fixture', url: 'not a URL'}],
        },
      ];
      reply.result.results[0].applicability.gridCoverage = 'verified';
    } else {
      reply.result.axes.from = {official: [], normalized: []};
    }
    rejected(
      () => parseCoordinatesResponse('transform', request, reply, context),
      'RESPONSE_SHAPE_INVALID',
    );
  });
}
