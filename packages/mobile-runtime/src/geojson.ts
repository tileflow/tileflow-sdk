import type {GeoJSONSourceSpecification} from 'maplibre-gl';

/** GeoJSON the renderer accepts as source data. */
export type FeatureCollection = Exclude<GeoJSONSourceSpecification['data'], string>;

/**
 * The renderer's GeoJSON contract for application data: an RFC 7946 FeatureCollection without
 * GeometryCollection or foreign members, with positions inside longitude and latitude ranges and
 * closed rings. Size is bounded by the data channel rather than by counts.
 *
 * Returns the path of the first problem, or undefined. Hand-written rather than a schema so a
 * collection of several megabytes validates in one linear pass.
 */
export function geoJSONProblem(value: unknown): string | undefined {
  if (!isObject(value) || value.type !== 'FeatureCollection') return '$.type';
  if (!keys(value, collectionKeys)) return '$';
  if (!boundingBox(value.bbox)) return '$.bbox';
  if (!Array.isArray(value.features)) return '$.features';
  for (let index = 0; index < value.features.length; index += 1) {
    const problem = featureProblem(value.features[index]);
    if (problem !== undefined) return `$.features[${index}]${problem}`;
  }
  return undefined;
}

/** The path of the first problem in a JSON array of features, or undefined. */
export function featuresProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return '$';
  for (let index = 0; index < value.length; index += 1) {
    const problem = featureProblem(value[index]);
    if (problem !== undefined) return `$[${index}]${problem}`;
  }
  return undefined;
}

export function asFeatureCollection(value: unknown): FeatureCollection | undefined {
  return geoJSONProblem(value) === undefined ? (value as FeatureCollection) : undefined;
}

const collectionKeys = new Set(['type', 'features', 'bbox']);
const featureKeys = new Set(['type', 'id', 'geometry', 'properties', 'bbox']);
const geometryKeys = new Set(['type', 'coordinates', 'bbox']);
const maximumPropertyDepth = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  for (const key in value) if (!allowed.has(key)) return false;
  return true;
}

function boundingBox(value: unknown) {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    (value.length === 4 || value.length === 6) &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function featureProblem(value: unknown): string | undefined {
  if (!isObject(value) || value.type !== 'Feature') return '.type';
  if (!keys(value, featureKeys) || !('geometry' in value) || !('properties' in value)) return '';
  if (!boundingBox(value.bbox)) return '.bbox';
  const id = value.id;
  if (
    id !== undefined &&
    !(typeof id === 'string' && id.length <= 128) &&
    !(typeof id === 'number' && Number.isSafeInteger(id))
  )
    return '.id';
  const properties = value.properties;
  if (properties !== null) {
    if (!isObject(properties)) return '.properties';
    for (const key in properties) {
      if (key.length > 128 || tooDeep(properties[key], maximumPropertyDepth)) return '.properties';
    }
  }
  if (value.geometry === null) return undefined;
  const problem = geometryProblem(value.geometry);
  return problem === undefined ? undefined : `.geometry${problem}`;
}

/** Whether a property value nests more than `remaining` arrays or objects. */
function tooDeep(value: unknown, remaining: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (remaining === 0) return true;
  for (const item of Array.isArray(value) ? value : Object.values(value))
    if (tooDeep(item, remaining - 1)) return true;
  return false;
}

function geometryProblem(value: unknown): string | undefined {
  if (!isObject(value)) return '';
  if (!keys(value, geometryKeys)) return '';
  if (!boundingBox(value.bbox)) return '.bbox';
  const coordinates = value.coordinates;
  switch (value.type) {
    case 'Point':
      return position(coordinates) ? undefined : '.coordinates';
    case 'MultiPoint':
      return list(coordinates, 0, position) ? undefined : '.coordinates';
    case 'LineString':
      return line(coordinates) ? undefined : '.coordinates';
    case 'MultiLineString':
      return list(coordinates, 0, line) ? undefined : '.coordinates';
    case 'Polygon':
      return polygon(coordinates) ? undefined : '.coordinates';
    case 'MultiPolygon':
      return list(coordinates, 0, polygon) ? undefined : '.coordinates';
    default:
      return '.type';
  }
}

function list(value: unknown, minimum: number, item: (value: unknown) => boolean) {
  if (!Array.isArray(value) || value.length < minimum) return false;
  for (const entry of value) if (!item(entry)) return false;
  return true;
}

function position(value: unknown): value is number[] {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return false;
  const [longitude, latitude, altitude] = value as unknown[];
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90 &&
    (altitude === undefined || (typeof altitude === 'number' && Number.isFinite(altitude)))
  );
}

const line = (value: unknown) => list(value, 2, position);

function ring(value: unknown) {
  if (!list(value, 4, position)) return false;
  const positions = value as number[][];
  const first = positions[0];
  const last = positions[positions.length - 1];
  return first.length === last.length && first.every((item, index) => item === last[index]);
}

const polygon = (value: unknown) => list(value, 1, ring);
