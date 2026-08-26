import type {TileflowTerrainEncoding} from '../types';

export const tileflowContourProtocol = 'tileflow-contour' as const;
export const tileflowContourSourceLayer = 'contours' as const;

export type TileflowContourThresholds = Readonly<Record<number, readonly [number, number]>>;

export type TileflowContourProtocolConfig = Readonly<{
  demMaxzoom: number;
  demUrl: string;
  encoding: TileflowTerrainEncoding;
  maxzoom: number;
  multiplier: number;
  overzoom: number;
  thresholds: TileflowContourThresholds;
}>;

/** Main-thread contour density budget, expressed in native DEM elevation units. */
export function minimumTileflowContourSourceInterval(zoom: number): number {
  if (zoom <= 4) return 250;
  if (zoom <= 7) return 100;
  if (zoom <= 10) return 50;
  if (zoom <= 12) return 20;
  return 10;
}

/** Compares scaled intervals with enough tolerance to absorb IEEE-754 boundary noise. */
export function isTileflowContourDensityWithinBudget(
  minorInterval: number,
  multiplier: number,
  zoom: number,
): boolean {
  const minimumScaledInterval = minimumTileflowContourSourceInterval(zoom) * multiplier;
  const tolerance = Number.EPSILON * Math.max(1, minorInterval, minimumScaledInterval) * 8;
  return minorInterval + tolerance >= minimumScaledInterval;
}

const maximumDemUrlLength = 2048;
const maximumProtocolUrlLength = 8192;
const contourTilePathPattern = /^\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.pbf$/u;
const allowedParameters = new Set([
  'demMaxzoom',
  'demUrl',
  'encoding',
  'maxzoom',
  'multiplier',
  'overzoom',
  'thresholds',
]);

/** Deterministic, self-contained URL consumed by the generic browser contour protocol. */
export function createTileflowContourProtocolUrl(config: TileflowContourProtocolConfig): string {
  assertTileflowContourProtocolConfig(config);
  const parameters = new URLSearchParams();
  parameters.set('demUrl', config.demUrl);
  parameters.set('encoding', config.encoding);
  parameters.set('demMaxzoom', String(config.demMaxzoom));
  parameters.set('maxzoom', String(config.maxzoom));
  parameters.set('overzoom', String(config.overzoom));
  parameters.set('multiplier', String(config.multiplier));
  parameters.set('thresholds', serializeThresholds(config.thresholds));
  const url = `${tileflowContourProtocol}://tiles/{z}/{x}/{y}.pbf?${parameters.toString()}`;
  if (url.length > maximumProtocolUrlLength) {
    throw new Error('Tileflow contour protocol URL exceeds its maximum length.');
  }
  return url;
}

export type ParsedTileflowContourProtocolRequest = Readonly<{
  config: TileflowContourProtocolConfig;
  x: number;
  y: number;
  z: number;
}>;

/** Strict parser shared by browser protocol delivery and its security tests. */
export function parseTileflowContourProtocolRequest(
  value: string,
): ParsedTileflowContourProtocolRequest {
  if (value.length > maximumProtocolUrlLength || /[\\\p{Cc}]/u.test(value)) {
    throw new Error('Invalid Tileflow contour protocol URL.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Tileflow contour protocol URL.');
  }
  if (
    url.protocol !== `${tileflowContourProtocol}:` ||
    url.hostname !== 'tiles' ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Invalid Tileflow contour protocol URL.');
  }
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('Invalid Tileflow contour protocol URL parameters.');
    }
  }
  if ([...allowedParameters].some((key) => !url.searchParams.has(key))) {
    throw new Error('Incomplete Tileflow contour protocol URL parameters.');
  }

  const tile = contourTilePathPattern.exec(url.pathname);
  if (!tile) throw new Error('Invalid Tileflow contour tile coordinates.');
  const z = Number(tile[1]);
  const x = Number(tile[2]);
  const y = Number(tile[3]);
  const config: TileflowContourProtocolConfig = {
    demMaxzoom: parseBoundedInteger(url.searchParams.get('demMaxzoom'), 0, 24),
    demUrl: url.searchParams.get('demUrl') ?? '',
    encoding: parseEncoding(url.searchParams.get('encoding')),
    maxzoom: parseBoundedInteger(url.searchParams.get('maxzoom'), 0, 24),
    multiplier: parseBoundedNumber(url.searchParams.get('multiplier'), 0.001, 100),
    overzoom: parseBoundedInteger(url.searchParams.get('overzoom'), 0, 8),
    thresholds: parseThresholds(url.searchParams.get('thresholds') ?? ''),
  };
  assertTileflowContourProtocolConfig(config);
  const axisLimit = 2 ** z;
  const minimumThresholdZoom = Math.min(...Object.keys(config.thresholds).map(Number));
  if (z < minimumThresholdZoom || z > config.maxzoom || x >= axisLimit || y >= axisLimit) {
    throw new Error('Invalid Tileflow contour tile coordinates.');
  }
  return {config, x, y, z};
}

export function isSafeTileflowDemUrlTemplate(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > maximumDemUrlLength ||
    value.startsWith('//') ||
    value.includes('#') ||
    /[\\\p{Cc}]/u.test(value)
  ) {
    return false;
  }
  for (const placeholder of ['{z}', '{x}', '{y}']) {
    if (value.split(placeholder).length !== 2) return false;
  }
  if (/\{[^{}]*\}/u.test(value.replaceAll('{z}', '').replaceAll('{x}', '').replaceAll('{y}', ''))) {
    return false;
  }
  try {
    const url = new URL(value.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'));
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && isLoopbackHostname(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function assertTileflowContourProtocolConfig(config: TileflowContourProtocolConfig): void {
  if (!isSafeTileflowDemUrlTemplate(config.demUrl)) {
    throw new Error(
      'Tileflow contour demUrl must be a safe HTTP(S) template containing {z}, {x}, and {y}.',
    );
  }
  if (config.encoding !== 'mapbox' && config.encoding !== 'terrarium') {
    throw new Error('Tileflow contour encoding must be mapbox or terrarium.');
  }
  assertBoundedInteger(config.demMaxzoom, 0, 24, 'demMaxzoom');
  assertBoundedInteger(config.maxzoom, 0, 24, 'maxzoom');
  assertBoundedInteger(config.overzoom, 0, 8, 'overzoom');
  assertBoundedNumber(config.multiplier, 0.001, 100, 'multiplier');
  const entries = Object.entries(config.thresholds);
  if (entries.length === 0 || entries.length > 25) {
    throw new Error('Tileflow contour thresholds must contain between 1 and 25 zoom entries.');
  }
  for (const [zoom, pair] of entries) {
    if (!/^(?:0|[1-9]\d?)$/u.test(zoom)) {
      throw new Error('Tileflow contour threshold zooms must be integers from 0 to 24.');
    }
    assertBoundedInteger(Number(zoom), 0, 24, 'threshold zoom');
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error('Tileflow contour thresholds must be [minor, index] pairs.');
    }
    const [minor, index] = pair;
    assertBoundedNumber(minor, 0.001, 100_000, 'minor threshold');
    assertBoundedNumber(index, minor, 100_000, 'index threshold');
    if (!isTileflowContourDensityWithinBudget(minor, config.multiplier, Number(zoom))) {
      throw new Error('Tileflow contour threshold exceeds the supported density budget.');
    }
    if (!isWholeContourMultiple(index, minor)) {
      throw new Error(
        'Tileflow contour index threshold must be a whole multiple of the minor threshold.',
      );
    }
  }
  const thresholdZooms = entries.map(([zoom]) => Number(zoom));
  if (Math.max(...thresholdZooms) > config.maxzoom) {
    throw new Error('Tileflow contour maxzoom must include every threshold zoom.');
  }
  if (config.overzoom > Math.min(...thresholdZooms)) {
    throw new Error('Tileflow contour overzoom must not produce a negative DEM zoom.');
  }
}

function serializeThresholds(thresholds: TileflowContourThresholds): string {
  return Object.entries(thresholds)
    .map(([zoom, pair]) => [Number(zoom), pair] as const)
    .sort(([left], [right]) => left - right)
    .map(([zoom, [minor, index]]) => `${zoom}:${minor},${index}`)
    .join(';');
}

function parseThresholds(value: string): TileflowContourThresholds {
  if (!value || value.length > 1024) {
    throw new Error('Invalid Tileflow contour thresholds.');
  }
  const result: Record<number, readonly [number, number]> = {};
  for (const entry of value.split(';')) {
    const match = /^(0|[1-9]\d?):([^,]+),([^,]+)$/u.exec(entry);
    if (!match) throw new Error('Invalid Tileflow contour thresholds.');
    const zoom = parseBoundedInteger(match[1], 0, 24);
    if (Object.hasOwn(result, zoom)) throw new Error('Duplicate Tileflow contour threshold zoom.');
    result[zoom] = [
      parseBoundedNumber(match[2], 0.001, 100_000),
      parseBoundedNumber(match[3], 0.001, 100_000),
    ];
  }
  return result;
}

function parseEncoding(value: string | null): TileflowTerrainEncoding {
  if (value !== 'mapbox' && value !== 'terrarium') {
    throw new Error('Invalid Tileflow contour encoding.');
  }
  return value;
}

function parseBoundedInteger(value: string | null, minimum: number, maximum: number): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error('Invalid Tileflow contour integer.');
  }
  const parsed = Number(value);
  assertBoundedInteger(parsed, minimum, maximum, 'integer');
  return parsed;
}

function parseBoundedNumber(value: string | null, minimum: number, maximum: number): number {
  if (value === null || value.trim() !== value || value === '') {
    throw new Error('Invalid Tileflow contour number.');
  }
  const parsed = Number(value);
  assertBoundedNumber(parsed, minimum, maximum, 'number');
  return parsed;
}

function assertBoundedInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Tileflow contour ${name} is outside its supported range.`);
  }
}

function assertBoundedNumber(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Tileflow contour ${name} is outside its supported range.`);
  }
}

function isWholeContourMultiple(value: number, interval: number): boolean {
  const ratio = value / interval;
  return Math.abs(ratio - Math.round(ratio)) <= Number.EPSILON * Math.max(1, ratio) * 8;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}
