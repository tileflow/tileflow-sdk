import {
  isTileflowWorldReleaseId,
  type MapLibreStyle,
  tileflowWorldTileJsonUrl,
} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import type {
  TileflowCaptureDataInput,
  TileflowCaptureDataSemanticsV2,
  TileflowCaptureWorldIdentityV3,
} from './receipt';

export const tileflowWorldCurrentTileJsonUrl = tileflowWorldTileJsonUrl;

const maximumTileJsonBytes = 1024 * 1024;

type FetchTileJson = (
  input: string,
  init: {cache: 'no-store'; redirect: 'error'; signal?: AbortSignal},
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

export type TileflowCaptureResolvedWorldV1 = Readonly<{
  identity: Omit<
    TileflowCaptureWorldIdentityV3,
    'kind' | 'schema' | 'schemaVersion' | 'semantics' | 'sourceId'
  >;
  tileJsonUrl: string;
  tiles: readonly [string];
}>;

export type PreparedTileflowCaptureStyle = Readonly<{
  data: TileflowCaptureDataInput;
  style: MapLibreStyle;
}>;

/**
 * Own one exact World resolution for the complete lifetime of a capture session. A failed lookup
 * is retained too: retrying the same session cannot silently move to a newer `current` release.
 */
export class TileflowCaptureWorldSession {
  readonly #fetch: FetchTileJson;
  #lookupUrl: string | undefined;
  #resolution: Promise<TileflowCaptureResolvedWorldV1> | undefined;

  constructor(fetchTileJson: FetchTileJson = globalThis.fetch as FetchTileJson) {
    this.#fetch = fetchTileJson;
  }

  async prepare(style: MapLibreStyle, signal?: AbortSignal): Promise<PreparedTileflowCaptureStyle> {
    const metadata = requireDataMetadata(style);
    if (metadata.kind !== 'tileflow-world') {
      return {data: validateVectorDataInput(metadata), style};
    }

    const source = requirePrimaryVectorSource(style);
    const lookupUrl = worldTileJsonLookupUrl(source, metadata);
    const resolution = await this.#resolveOne(lookupUrl, signal);
    const semantics = validateSemantics(metadata.semantics);
    const data: TileflowCaptureWorldIdentityV3 = {
      ...resolution.identity,
      kind: 'tileflow-world',
      schema: requireLiteral(metadata.schema, 'openmaptiles', 'schema'),
      schemaVersion: requirePositiveInteger(metadata.schemaVersion, 'schemaVersion'),
      ...(semantics ? {semantics} : {}),
      sourceId: requireLiteral(metadata.sourceId, 'tileflow', 'sourceId'),
    };
    const {tiles: _mutableTiles, url: _mutableUrl, ...sourceWithoutSelector} = source;
    return {
      data,
      style: {
        ...style,
        sources: {
          ...style.sources,
          tileflow: {...sourceWithoutSelector, tiles: [...resolution.tiles]},
        },
      },
    };
  }

  #resolveOne(
    lookupUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<TileflowCaptureResolvedWorldV1> {
    if (this.#lookupUrl !== undefined && this.#lookupUrl !== lookupUrl) {
      throw worldResolutionError(
        'One capture session cannot mix different Tileflow World selectors.',
      );
    }
    this.#lookupUrl ??= lookupUrl;
    this.#resolution ??= resolveTileflowCaptureWorldTileJson(lookupUrl, {
      fetchTileJson: this.#fetch,
      signal,
    });
    return this.#resolution;
  }
}

export async function resolveTileflowCaptureWorldTileJson(
  tileJsonUrl: string,
  options: {fetchTileJson?: FetchTileJson; signal?: AbortSignal} = {},
): Promise<TileflowCaptureResolvedWorldV1> {
  const normalizedUrl = validateTileJsonUrl(tileJsonUrl);
  const expectedRelease = exactWorldReferenceFromSelector(normalizedUrl);
  let response: Pick<Response, 'ok' | 'status' | 'text'>;
  try {
    response = await (options.fetchTileJson ?? (globalThis.fetch as FetchTileJson))(normalizedUrl, {
      cache: 'no-store',
      redirect: 'error',
      ...(options.signal ? {signal: options.signal} : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.', {cause: error});
    }
    throw worldResolutionError('Tileflow World TileJSON could not be loaded.', error);
  }
  if (!response.ok) {
    throw worldResolutionError(`Tileflow World TileJSON returned HTTP ${String(response.status)}.`);
  }

  let text: string;
  let input: unknown;
  try {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumTileJsonBytes) {
      throw new TypeError('TileJSON exceeds the supported byte limit');
    }
    input = JSON.parse(text);
  } catch (error) {
    throw worldResolutionError('Tileflow World TileJSON is not bounded valid JSON.', error);
  }
  const tileJson = requireRecord(input, 'TileJSON');
  if (tileJson.tilejson !== '3.0.0') {
    throw worldResolutionError('Tileflow World requires TileJSON 3.0.0.');
  }
  if (!Array.isArray(tileJson.tiles) || tileJson.tiles.length !== 1) {
    throw worldResolutionError('Tileflow World TileJSON must contain one exact tile template.');
  }
  const tileflow = requireRecord(tileJson.tileflow, 'TileJSON tileflow');
  const world = requireRecord(tileflow.world, 'TileJSON tileflow.world');
  requireExactKeys(world, [
    'archiveSha256',
    'contractSha256',
    'dataContractSha256',
    'descriptorSha256',
    'product',
    'releaseId',
  ]);
  if (world.product !== 'world-v1') {
    throw worldResolutionError('Tileflow World TileJSON has an unsupported product.');
  }
  const releaseId = requireWorldReleaseId(world.releaseId);
  const descriptorSha256 = requireHash(world.descriptorSha256, 'descriptorSha256');
  if (
    expectedRelease &&
    (expectedRelease.releaseId !== releaseId ||
      expectedRelease.descriptorSha256 !== descriptorSha256)
  ) {
    throw worldResolutionError(
      'Tileflow World TileJSON conflicts with the requested exact release.',
    );
  }
  const tileTemplate = validateExactTileTemplate(tileJson.tiles[0], releaseId, descriptorSha256);

  return {
    identity: {
      archiveSha256: requireHash(world.archiveSha256, 'archiveSha256'),
      contractSha256: requireHash(world.contractSha256, 'contractSha256'),
      dataContractSha256: requireHash(world.dataContractSha256, 'dataContractSha256'),
      descriptorSha256,
      product: 'world-v1',
      releaseId,
    },
    tileJsonUrl: normalizedUrl,
    tiles: [tileTemplate],
  };
}

function requireDataMetadata(style: MapLibreStyle): Record<string, unknown> {
  const data = style.metadata?.['tileflow:data'];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw worldResolutionError('The compiled style has no valid Tileflow data identity.');
  }
  return data as Record<string, unknown>;
}

function validateVectorDataInput(data: Record<string, unknown>): TileflowCaptureDataInput {
  if (data.kind !== 'vector-tiles') {
    throw worldResolutionError('The compiled style has an unsupported Tileflow data kind.');
  }
  return data as TileflowCaptureDataInput;
}

function requirePrimaryVectorSource(style: MapLibreStyle): Record<string, unknown> {
  const source = style.sources.tileflow;
  if (!source || source.type !== 'vector') {
    throw worldResolutionError('Tileflow World requires the primary vector source.');
  }
  return source;
}

function worldTileJsonLookupUrl(
  source: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string {
  if (typeof source.url === 'string') return validateTileJsonUrl(source.url);
  if (typeof metadata.url === 'string') return validateTileJsonUrl(metadata.url);
  throw worldResolutionError(
    'Tileflow World capture requires a current or exact TileJSON selector.',
  );
}

function validateTileJsonUrl(value: string): string {
  if (value.length < 1 || value.length > 2_048) {
    throw worldResolutionError('Tileflow World TileJSON URL has an invalid length.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw worldResolutionError('Tileflow World TileJSON URL is invalid.', error);
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname)))
  ) {
    throw worldResolutionError('Tileflow World TileJSON URL is not an approved HTTP URL.');
  }
  return url.toString();
}

function exactWorldReferenceFromSelector(
  value: string,
): {descriptorSha256: string; releaseId: string} | undefined {
  const url = new URL(value);
  const releaseId = url.searchParams.get('worldReleaseId');
  const descriptorSha256 = url.searchParams.get('worldDescriptorSha256');
  if ((releaseId === null) !== (descriptorSha256 === null)) {
    throw worldResolutionError(
      'An exact Tileflow World selector requires releaseId and descriptorSha256 together.',
    );
  }
  return releaseId === null
    ? undefined
    : {
        descriptorSha256: requireHash(descriptorSha256, 'selector descriptorSha256'),
        releaseId: requireWorldReleaseId(releaseId),
      };
}

function validateExactTileTemplate(
  value: unknown,
  releaseId: string,
  descriptorSha256: string,
): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
    throw worldResolutionError('Tileflow World has an invalid exact tile template.');
  }
  if (!value.includes('{z}') || !value.includes('{x}') || !value.includes('{y}')) {
    throw worldResolutionError('Tileflow World tile template is missing XYZ placeholders.');
  }
  let url: URL;
  try {
    url = new URL(value.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'));
  } catch (error) {
    throw worldResolutionError('Tileflow World has an invalid exact tile template.', error);
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) ||
    url.pathname.split('/').includes('current') ||
    !url.pathname.split('/').includes(releaseId) ||
    url.searchParams.get('worldDescriptorSha256') !== descriptorSha256
  ) {
    throw worldResolutionError(
      'Tileflow World TileJSON did not bind tiles to its exact release and descriptor.',
    );
  }
  return value;
}

function validateSemantics(value: unknown): TileflowCaptureDataSemanticsV2 | undefined {
  if (value === undefined) return undefined;
  const semantics = requireRecord(value, 'data semantics');
  requireExactKeys(semantics, ['parkLayer']);
  if (semantics.parkLayer !== 'mixed' && semantics.parkLayer !== 'protected-only') {
    throw worldResolutionError('The compiled style has invalid park semantics.');
  }
  return {parkLayer: semantics.parkLayer};
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw worldResolutionError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw worldResolutionError('Tileflow World identity contains missing or unsupported fields.');
  }
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw worldResolutionError(`Tileflow World has an invalid ${field}.`);
  }
  return value;
}

function requireWorldReleaseId(value: unknown): string {
  if (!isTileflowWorldReleaseId(value)) {
    throw worldResolutionError('Tileflow World has an invalid releaseId.');
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw worldResolutionError(`The compiled style has an invalid ${field}.`);
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, expected: T, field: string): T {
  if (value !== expected) {
    throw worldResolutionError(`The compiled style has an invalid ${field}.`);
  }
  return expected;
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function worldResolutionError(message: string, cause?: unknown): TileflowCaptureError {
  return new TileflowCaptureError('WORLD_RESOLUTION_FAILED', message, {cause});
}
