import {
  type CoordinatesCrsDescription,
  type CoordinatesCrsSummary,
  type CoordinatesOperation,
  type CoordinatesTransformRequest,
  type CoordinatesTransformResponse,
  parseCoordinatesRequest,
} from '../src/contract';

export const releaseId = `cr_${'a'.repeat(64)}`;
export const otherReleaseId = `cr_${'b'.repeat(64)}`;
export const operationRef = `op_${'1'.repeat(64)}`;
export const otherOperationRef = `op_${'2'.repeat(64)}`;
export const digest = 'c'.repeat(64);
export const area = {
  name: 'Contract fixture',
  bounds: [-180, -90, 180, 90] as [number, number, number, number],
};
export const provenance = {
  engine: {name: 'PROJ' as const, version: '9.8.1'},
  catalog: {authority: 'EPSG' as const, revision: 'v12.029', digest},
  gridSetDigest: digest,
  selectionPolicy: 'fixture-policy-v1',
  numericConvention: 'xy-geographic-degrees-crs-linear-v1' as const,
  longitudeReference: 'crs-prime-meridian' as const,
  artifact: {id: 'fixture-runtime', digest},
};
export const context = {mode: 'local' as const, releaseId};
export const request = {from: 'EPSG:4258', to: 'EPSG:25832', positions: [[12, 55]]};

export function summary(id: string, dimension: 2 | 3 = 2): CoordinatesCrsSummary {
  const projected = ['EPSG:25832', 'EPSG:31370', 'EPSG:3812'].includes(id);
  const compound = ['EPSG:9518', 'EPSG:7405'].includes(id);
  return {
    id,
    name: 'Contract fixture CRS',
    kind: compound
      ? 'compound'
      : projected
        ? 'projected'
        : dimension === 2
          ? 'geographic-2d'
          : 'geographic-3d',
    dimension,
    deprecated: false,
    dynamic: false,
    areasOfUse: [area],
    eligibility: {eligible: true, reasons: []},
  };
}

export function operation(
  input = request,
  overrides: Partial<CoordinatesOperation> = {},
): CoordinatesOperation {
  return {
    operationRef,
    releaseId,
    from: input.from,
    to: input.to,
    direction: 'forward',
    name: 'Contract fixture operation',
    identifiers: [],
    accuracy: null,
    ballpark: false,
    areasOfUse: [area],
    grids: [],
    methodSupported: true,
    instantiable: true,
    hasInverse: true,
    heightEffect: 'none',
    ...overrides,
  };
}

export function transformResponse(
  input: CoordinatesTransformRequest = request,
  dimension: 2 | 3 = 2,
): CoordinatesTransformResponse {
  const axes = (id: string) => {
    const projected = ['EPSG:25832', 'EPSG:31370', 'EPSG:3812', 'EPSG:7405'].includes(id);
    const unit = projected ? {name: 'metre', toSI: 1} : {name: 'degree', toSI: Math.PI / 180};
    const x = {name: 'X', direction: 'east', unit};
    const y = {name: 'Y', direction: 'north', unit};
    const z = {name: 'Height', direction: 'up', unit: {name: 'metre', toSI: 1}};
    return {
      official: [...(projected ? [x, y] : [y, x]), ...(dimension === 3 ? [z] : [])],
      normalized: [x, y, ...(dimension === 3 ? [z] : [])],
    };
  };
  const normalized = parseCoordinatesRequest('transform', input);
  const used = operation(
    {...request, from: input.from, to: input.to},
    {
      operationRef: input.operationRef ?? operationRef,
      heightEffect: dimension === 3 ? 'transformed' : 'none',
    },
  );
  return {
    schemaVersion: 1,
    ok: true,
    command: 'transform',
    releaseId,
    provenance,
    warnings: [],
    usage: {mode: 'local', units: 0},
    result: {
      from: summary(input.from, dimension),
      to: summary(input.to, dimension),
      axes: {from: axes(input.from), to: axes(input.to)},
      ...(input.areaOfInterest ? {areaOfInterest: input.areaOfInterest} : {}),
      policy: {
        allowBallpark: normalized.allowBallpark,
        requireBestKnown: normalized.requireBestKnown,
      },
      operations: [used],
      results: normalized.positions.map((position) => ({
        position: [...position] as [number, number] | [number, number, number],
        operationRef: used.operationRef,
        selection: {
          mode: input.operationRef ? 'explicit' : 'automatic',
          bestKnown: {operationRef: used.operationRef, relation: 'same'},
          relaxationsApplied: [],
        },
        height:
          position.length === 2
            ? 'absent'
            : dimension === 2
              ? 'auxiliary-preserved'
              : 'transformed',
        applicability: {
          crsArea: 'verified',
          operationArea: 'verified',
          gridCoverage: 'not-required',
          executionDomain: 'verified',
        },
      })),
    },
  };
}

export function description(): CoordinatesCrsDescription {
  const unit = {name: 'degree', toSI: Math.PI / 180};
  const latitude = {name: 'Latitude', direction: 'north', unit};
  const longitude = {name: 'Longitude', direction: 'east', unit};
  return {
    summary: summary('EPSG:4258'),
    officialAxes: [latitude, longitude],
    normalizedAxes: [longitude, latitude],
    datum: {name: 'ETRS89', kind: 'ensemble', referenceEpoch: null},
    ellipsoid: {name: 'GRS 1980', semiMajorMetres: 6378137, inverseFlattening: 298.257222101},
    primeMeridian: {name: 'Greenwich', longitudeDegrees: 0},
    definitions: [],
  };
}
