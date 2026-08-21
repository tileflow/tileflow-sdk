import {createHash} from 'node:crypto';
import {
  serializeCanonicalJson,
  tileflowCaptureIdSchema,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneNameSchema,
} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import type {TileflowCaptureRendererIdentity} from './metadata';

export const tileflowCaptureReceiptSchemaVersion = 2 as const;
export const tileflowCaptureReceiptLimits = Object.freeze({maximumBytes: 64 * 1024});

export type TileflowCaptureDataBindingsV2 = {
  fields: Record<string, string>;
  layers: Record<string, string>;
};

export type TileflowCaptureDataCapabilitiesV2 = {
  businessCorridor: boolean;
  /** Optional because receipts written before this capability existed remain valid schema v2. */
  bathymetry?: boolean;
  globalLandcover: boolean;
  tree: boolean;
};

export type TileflowCaptureDataSourceV2 = {
  kind: 'loopback' | 'opaque' | 'remote' | 'root-relative';
  /** SHA-256 of a credential-free, query-free endpoint identity. */
  sha256: string;
};

/** Durable schema-v2 data identity owned by capture rather than the live core authoring API. */
export type TileflowCaptureDataIdentityV2 = {
  bindings?: TileflowCaptureDataBindingsV2;
  capabilities?: TileflowCaptureDataCapabilitiesV2;
  kind: 'tileflow-world' | 'vector-tiles';
  revision?: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  sourceId: 'tileflow';
  source?: TileflowCaptureDataSourceV2;
};

/** Structural input accepted from a compiler without making it the durable receipt type. */
export type TileflowCaptureDataInput = {
  bindings?: {
    fields: Readonly<Record<string, string>>;
    layers: Readonly<Record<string, string>>;
  };
  capabilities?: {
    businessCorridor: boolean;
    bathymetry?: boolean;
    globalLandcover: boolean;
    tree: boolean;
  };
  kind: 'tileflow-world' | 'vector-tiles';
  revision?: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  sourceId: 'tileflow';
  /** Accepted only as transient input and converted to `source`; never returned or serialized. */
  url?: string;
};

export type TileflowCaptureVerificationV2 = {
  data: 'expected-unverified' | 'rendered';
  style: 'expected-unverified' | 'rendered';
};

export type TileflowCaptureReceipt = {
  schemaVersion: 2;
  scene: {
    name: string;
    map: string;
    target: 'map' | 'application';
    sha256: string;
  };
  style: {sha256: string};
  image: {
    sha256: string;
    cssWidth: number;
    cssHeight: number;
    physicalWidth: number;
    physicalHeight: number;
    dpr: 1 | 2;
  };
  renderer: TileflowCaptureRendererIdentity;
  platform: {os: string; architecture: string};
  data: TileflowCaptureDataIdentityV2;
  verification: TileflowCaptureVerificationV2;
  networkDependent: boolean;
};

export type CreateTileflowCaptureReceiptInput = {
  dpr: 1 | 2;
  data: TileflowCaptureDataInput;
  height: number;
  map: string;
  networkDependent: boolean;
  pngSha256: string;
  renderer: TileflowCaptureRendererIdentity;
  scene: string;
  sceneSha256: string;
  styleSha256: string;
  target: 'map' | 'application';
  width: number;
};

export function createTileflowCaptureReceipt(
  input: CreateTileflowCaptureReceiptInput,
): TileflowCaptureReceipt {
  return validateTileflowCaptureReceipt({
    schemaVersion: tileflowCaptureReceiptSchemaVersion,
    scene: {
      name: input.scene,
      map: input.map,
      target: input.target,
      sha256: input.sceneSha256,
    },
    style: {sha256: input.styleSha256},
    image: {
      sha256: input.pngSha256,
      cssWidth: input.width,
      cssHeight: input.height,
      physicalWidth: input.width * input.dpr,
      physicalHeight: input.height * input.dpr,
      dpr: input.dpr,
    },
    renderer: input.renderer,
    platform: {os: process.platform, architecture: process.arch},
    data: input.data,
    verification: verificationForTarget(input.target),
    networkDependent: input.networkDependent,
  });
}

export function serializeTileflowCaptureReceipt(receipt: TileflowCaptureReceipt): string {
  const serialized = `${serializeCanonicalJson(validateTileflowCaptureReceipt(receipt))}\n`;
  if (new TextEncoder().encode(serialized).byteLength > tileflowCaptureReceiptLimits.maximumBytes) {
    throw invalidReceipt('The capture receipt exceeds the supported byte limit.');
  }
  return serialized;
}

export function parseTileflowCaptureReceipt(source: string | Uint8Array): TileflowCaptureReceipt {
  const byteLength =
    typeof source === 'string' ? new TextEncoder().encode(source).byteLength : source.byteLength;
  if (byteLength > tileflowCaptureReceiptLimits.maximumBytes) {
    throw invalidReceipt('The baseline receipt exceeds the supported byte limit.');
  }
  let value: unknown;
  let text: string;
  try {
    text =
      typeof source === 'string' ? source : new TextDecoder('utf-8', {fatal: true}).decode(source);
    value = JSON.parse(text);
  } catch (error) {
    throw invalidReceipt('The baseline receipt is not valid UTF-8 JSON.', error);
  }

  const receipt = validateTileflowCaptureReceipt(value);
  if (text.trim() !== serializeCanonicalJson(value)) {
    throw invalidReceipt('The baseline receipt is not canonical JSON.');
  }
  return receipt;
}

export function validateTileflowCaptureReceipt(value: unknown): TileflowCaptureReceipt {
  const receipt = requireRecord(value, 'receipt');
  const commonKeys = [
    'schemaVersion',
    'scene',
    'style',
    'image',
    'renderer',
    'platform',
    'data',
    ...(receipt.verification === undefined ? [] : ['verification']),
    'networkDependent',
  ];
  if (receipt.schemaVersion !== tileflowCaptureReceiptSchemaVersion) {
    throw invalidReceipt('The baseline receipt schema version is unsupported.');
  }
  requireExactKeys(receipt, commonKeys);

  const scene = requireRecord(receipt.scene, 'scene');
  requireExactKeys(scene, ['name', 'map', 'target', 'sha256']);
  const name = requireSceneName(scene.name);
  const map = requireIdentifier(scene.map, 'scene.map');
  if (scene.target !== 'map' && scene.target !== 'application') {
    throw invalidReceipt('The baseline receipt has an invalid scene target.');
  }
  const verification = validateVerification(receipt.verification, scene.target);

  const style = requireRecord(receipt.style, 'style');
  requireExactKeys(style, ['sha256']);
  const image = requireRecord(receipt.image, 'image');
  requireExactKeys(image, [
    'sha256',
    'cssWidth',
    'cssHeight',
    'physicalWidth',
    'physicalHeight',
    'dpr',
  ]);
  const cssWidth = requirePositiveFinite(image.cssWidth, 'image.cssWidth');
  const cssHeight = requirePositiveFinite(image.cssHeight, 'image.cssHeight');
  const physicalWidth = requirePositiveInteger(image.physicalWidth, 'image.physicalWidth');
  const physicalHeight = requirePositiveInteger(image.physicalHeight, 'image.physicalHeight');
  if (image.dpr !== 1 && image.dpr !== 2) {
    throw invalidReceipt('The baseline receipt has an invalid image DPR.');
  }
  if (cssWidth * image.dpr !== physicalWidth || cssHeight * image.dpr !== physicalHeight) {
    throw invalidReceipt('The baseline receipt image dimensions are inconsistent.');
  }
  if (
    physicalWidth > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    physicalHeight > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    physicalWidth * physicalHeight > tileflowCaptureSceneLimits.maximumPhysicalPixels
  ) {
    throw invalidReceipt('The baseline receipt image exceeds the supported pixel limit.');
  }

  const renderer = requireRecord(receipt.renderer, 'renderer');
  requireExactKeys(renderer, [
    'tileflow',
    'maplibre',
    'playwright',
    'chromiumRevision',
    'chromiumVersion',
  ]);
  const platform = requireRecord(receipt.platform, 'platform');
  requireExactKeys(platform, ['os', 'architecture']);
  if (typeof receipt.networkDependent !== 'boolean') {
    throw invalidReceipt('The baseline receipt has an invalid network dependency flag.');
  }

  const data = requireRecord(receipt.data, 'data');
  if (data.url !== undefined && data.source !== undefined) {
    throw invalidReceipt(
      'The baseline receipt data identity must not mix legacy and safe sources.',
    );
  }
  requireExactKeys(data, [
    ...(data.bindings === undefined ? [] : ['bindings']),
    ...(data.capabilities === undefined ? [] : ['capabilities']),
    'kind',
    ...(data.revision === undefined ? [] : ['revision']),
    'schema',
    'schemaVersion',
    'sourceId',
    ...(data.source === undefined ? [] : ['source']),
    ...(data.url === undefined ? [] : ['url']),
  ]);
  if (data.kind !== 'tileflow-world' && data.kind !== 'vector-tiles') {
    throw invalidReceipt('The baseline receipt has an invalid data.kind.');
  }
  if (data.schema !== 'openmaptiles' || data.sourceId !== 'tileflow') {
    throw invalidReceipt('The baseline receipt has an unsupported data contract.');
  }

  const bindings =
    data.bindings === undefined ? undefined : validateDataBindings(data.bindings, 'data.bindings');
  const capabilities =
    data.capabilities === undefined
      ? undefined
      : validateDataCapabilities(data.capabilities, 'data.capabilities');
  const source =
    data.source === undefined
      ? data.url === undefined
        ? undefined
        : fingerprintLegacyDataUrl(data.url)
      : validateDataSource(data.source, 'data.source');

  return {
    schemaVersion: tileflowCaptureReceiptSchemaVersion,
    scene: {
      name,
      map,
      target: scene.target,
      sha256: requireHash(scene.sha256, 'scene.sha256'),
    },
    style: {sha256: requireHash(style.sha256, 'style.sha256')},
    image: {
      sha256: requireHash(image.sha256, 'image.sha256'),
      cssWidth,
      cssHeight,
      physicalWidth,
      physicalHeight,
      dpr: image.dpr,
    },
    renderer: {
      tileflow: requireBoundedString(renderer.tileflow, 'renderer.tileflow'),
      maplibre: requireBoundedString(renderer.maplibre, 'renderer.maplibre'),
      playwright: requireBoundedString(renderer.playwright, 'renderer.playwright'),
      chromiumRevision: requireBoundedString(
        renderer.chromiumRevision,
        'renderer.chromiumRevision',
      ),
      chromiumVersion: requireBoundedString(renderer.chromiumVersion, 'renderer.chromiumVersion'),
    },
    platform: {
      os: requireBoundedString(platform.os, 'platform.os'),
      architecture: requireBoundedString(platform.architecture, 'platform.architecture'),
    },
    data: {
      ...(bindings ? {bindings} : {}),
      ...(capabilities ? {capabilities} : {}),
      kind: data.kind,
      ...(data.revision === undefined ? {} : {revision: requireSourceRevision(data.revision)}),
      schema: data.schema,
      schemaVersion: requirePositiveInteger(data.schemaVersion, 'data.schemaVersion'),
      sourceId: data.sourceId,
      ...(source ? {source} : {}),
    },
    verification,
    networkDependent: receipt.networkDependent,
  };
}

function validateDataBindings(value: unknown, field: string): TileflowCaptureDataBindingsV2 {
  const bindings = requireRecord(value, field);
  requireExactKeys(bindings, ['fields', 'layers']);
  return {
    fields: validateStringBindings(bindings.fields, `${field}.fields`),
    layers: validateStringBindings(bindings.layers, `${field}.layers`),
  };
}

function validateStringBindings(value: unknown, field: string): Record<string, string> {
  const bindings = requireRecord(value, field);
  const entries = Object.entries(bindings);
  if (entries.length === 0 || entries.length > 64) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field} object.`);
  }
  return Object.fromEntries(
    entries
      .map(([name, binding]) => [
        requireBindingKey(name, `${field} key`),
        requireBindingValue(binding, `${field}.${name}`),
      ])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function requireBindingKey(value: string, field: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value)) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function requireBindingValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 256 || value.trim().length === 0) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function validateDataCapabilities(
  value: unknown,
  field: string,
): TileflowCaptureDataCapabilitiesV2 {
  const capabilities = requireRecord(value, field);
  requireExactKeys(capabilities, [
    'businessCorridor',
    ...(capabilities.bathymetry === undefined ? [] : ['bathymetry']),
    'globalLandcover',
    'tree',
  ]);
  if (
    typeof capabilities.businessCorridor !== 'boolean' ||
    (capabilities.bathymetry !== undefined && typeof capabilities.bathymetry !== 'boolean') ||
    typeof capabilities.globalLandcover !== 'boolean' ||
    typeof capabilities.tree !== 'boolean'
  ) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field} object.`);
  }
  return {
    businessCorridor: capabilities.businessCorridor,
    ...(capabilities.bathymetry === undefined ? {} : {bathymetry: capabilities.bathymetry}),
    globalLandcover: capabilities.globalLandcover,
    tree: capabilities.tree,
  };
}

function validateDataSource(value: unknown, field: string): TileflowCaptureDataSourceV2 {
  const source = requireRecord(value, field);
  requireExactKeys(source, ['kind', 'sha256']);
  if (
    source.kind !== 'loopback' &&
    source.kind !== 'opaque' &&
    source.kind !== 'remote' &&
    source.kind !== 'root-relative'
  ) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.kind.`);
  }
  return {kind: source.kind, sha256: requireHash(source.sha256, `${field}.sha256`)};
}

function validateVerification(
  value: unknown,
  target: 'application' | 'map',
): TileflowCaptureVerificationV2 {
  const expected = verificationForTarget(target);
  if (value === undefined) return expected;
  const verification = requireRecord(value, 'verification');
  requireExactKeys(verification, ['data', 'style']);
  if (verification.data !== expected.data || verification.style !== expected.style) {
    throw invalidReceipt(
      `The baseline receipt verification does not match its ${target} capture target.`,
    );
  }
  return expected;
}

function verificationForTarget(target: 'application' | 'map'): TileflowCaptureVerificationV2 {
  const state = target === 'map' ? 'rendered' : 'expected-unverified';
  return {data: state, style: state};
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field} object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw invalidReceipt('The baseline receipt contains missing or unsupported fields.');
  }
}

function requireIdentifier(value: unknown, field: string): string {
  const result = tileflowCaptureIdSchema.safeParse(value);
  if (!result.success) throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  return result.data;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireSceneName(value: unknown): string {
  const result = tileflowCaptureSceneNameSchema.safeParse(value);
  if (!result.success) throw invalidReceipt('The baseline receipt has an invalid scene.name.');
  return result.data;
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function requirePositiveFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function requireBoundedString(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    !isSafeRuntimeIdentity(value)
  ) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  }
  return value;
}

function requireSourceRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw invalidReceipt('The baseline receipt has an invalid data.revision.');
  }
  return value;
}

function fingerprintLegacyDataUrl(value: unknown): TileflowCaptureDataSourceV2 {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) {
    throw invalidReceipt('The baseline receipt has an invalid data.url.');
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    const url = new URL(value, 'https://tileflow.invalid');
    return fingerprintDataSource('root-relative', `root-relative:${url.pathname}`);
  }
  try {
    const url = new URL(value);
    if (!url.username && !url.password && url.protocol !== 'file:') {
      if (isLoopbackHostname(url.hostname)) {
        return fingerprintDataSource('loopback', `loopback:${url.pathname}`);
      }
      const kind = url.protocol === 'http:' || url.protocol === 'https:' ? 'remote' : 'opaque';
      return fingerprintDataSource(kind, `${kind}:${url.protocol}//${url.host}${url.pathname}`);
    }
  } catch {
    // Report one stable receipt error below.
  }
  throw invalidReceipt('The baseline receipt has an invalid data.url.');
}

function fingerprintDataSource(
  kind: TileflowCaptureDataSourceV2['kind'],
  identity: string,
): TileflowCaptureDataSourceV2 {
  return {kind, sha256: createHash('sha256').update(identity).digest('hex')};
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isSafeRuntimeIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(value);
}

function invalidReceipt(message: string, cause?: unknown): TileflowCaptureError {
  return new TileflowCaptureError('BASELINE_INVALID', message, {cause});
}
