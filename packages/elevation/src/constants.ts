/**
 * Limits, units and the API-unit rule of Tileflow Elevation, without any schema, so that code
 * that only measures local profiles does not load the validation library.
 */

export const elevationLimits = Object.freeze({
  maximumRequestBytes: 1024 * 1024,
  maximumResponseBytes: 512 * 1024,
  /** Positions in one points request; the batch helpers split larger lists. */
  maximumPoints: 100,
  maximumLines: 100,
  maximumLinePositions: 20_000,
  maximumPolylineCharacters: 400_000,
  minimumSamples: 2,
  maximumSamples: 1_000,
  defaultSamples: 500,
  defaultIntervalMeters: 30,
  minimumIntervalMeters: 1,
  maximumIntervalMeters: 1_000_000,
  defaultClimbThresholdMeters: 2,
  maximumClimbThresholdMeters: 100,
  minimumGradeRunMeters: 100,
});

/** Elevations returned per API unit: one unit for every started block of 100. */
export const elevationBlockSize = 100;

export const metersPerFoot = 0.3048;
export const elevationUnits = ['meters', 'feet'] as const;
export type ElevationUnit = (typeof elevationUnits)[number];

/** The API units an answer with `elevations` points or samples consumes. */
export function elevationApiUnits(elevations: number): number {
  if (!Number.isSafeInteger(elevations) || elevations < 1) return 0;
  return Math.ceil(elevations / elevationBlockSize);
}
