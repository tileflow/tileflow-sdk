import {createHash} from 'node:crypto';
import {types as nodeUtilTypes} from 'node:util';
import {
  isTileflowWorldReleaseId,
  serializeCanonicalJson,
  tileflowCaptureIdSchema,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneNameSchema,
  tileflowPortableIdSchema,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import type {TileflowCaptureRendererIdentity} from './metadata';

export const tileflowCaptureReceiptSchemaVersion = 4 as const;
export const tileflowCaptureReceiptLimits = Object.freeze({maximumBytes: 64 * 1024});
const maximumReceiptBindingEntries = 128;

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

export type TileflowCaptureDataSemanticsV2 = {
  parkLayer: 'mixed' | 'protected-only';
};

/** Durable schema-v2 data identity owned by capture rather than the live core authoring API. */
export type TileflowCaptureDataIdentityV2 = {
  bindings?: TileflowCaptureDataBindingsV2;
  capabilities?: TileflowCaptureDataCapabilitiesV2;
  generation?: 'v1';
  kind: 'tileflow-world' | 'vector-tiles';
  revision?: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  /** Optional because earlier schema-v2 receipts predate explicit park semantics. */
  semantics?: TileflowCaptureDataSemanticsV2;
  sourceId: 'tileflow';
  source?: TileflowCaptureDataSourceV2;
};

export type TileflowCaptureWorldIdentityV3 = {
  archiveSha256: string;
  contractSha256: string;
  dataContractSha256: string;
  descriptorSha256: string;
  kind: 'tileflow-world';
  product: 'world-v1';
  releaseId: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  semantics?: TileflowCaptureDataSemanticsV2;
  sourceId: 'tileflow';
};

export type TileflowCaptureVectorIdentityV3 = {
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
  kind: 'vector-tiles';
  revision?: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  semantics?: TileflowCaptureDataSemanticsV2;
  sourceId: 'tileflow';
  /** Accepted only as transient input and converted to `source`; never returned or serialized. */
  url?: string;
};

/** Exact data-identity input embedded in every newly written schema-v4 receipt. */
export type TileflowCaptureDataInput =
  | TileflowCaptureVectorIdentityV3
  | TileflowCaptureWorldIdentityV3;

export type TileflowCaptureDataIdentityV3 =
  | (Omit<TileflowCaptureVectorIdentityV3, 'url'> & {source?: TileflowCaptureDataSourceV2})
  | TileflowCaptureWorldIdentityV3;

export type TileflowCaptureVerificationV2 = {
  data: 'expected-unverified' | 'rendered';
  style: 'expected-unverified' | 'rendered';
};

type TileflowCaptureReceiptCommon = {
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
  verification: TileflowCaptureVerificationV2;
  networkDependent: boolean;
};

export type TileflowCaptureReceiptV2 = TileflowCaptureReceiptCommon & {
  schemaVersion: 2;
  data: TileflowCaptureDataIdentityV2;
};

export type TileflowCaptureReceiptV3 = TileflowCaptureReceiptCommon & {
  schemaVersion: 3;
  data: TileflowCaptureDataIdentityV3;
};

export type TileflowCaptureReceiptV4 = Omit<TileflowCaptureReceiptCommon, 'scene'> & {
  schemaVersion: 4;
  data: TileflowCaptureDataIdentityV3;
  scene: TileflowCaptureReceiptCommon['scene'] & {theme: string};
};

export type TileflowCaptureReceipt =
  | TileflowCaptureReceiptV2
  | TileflowCaptureReceiptV3
  | TileflowCaptureReceiptV4;

export type CreateTileflowCaptureReceiptInput = {
  dpr: 1 | 2;
  data: TileflowCaptureDataInput;
  height: number;
  map: string;
  theme: string;
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
): TileflowCaptureReceiptV4 {
  return validateTileflowCaptureReceipt({
    schemaVersion: tileflowCaptureReceiptSchemaVersion,
    scene: {
      name: input.scene,
      map: input.map,
      theme: input.theme,
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
    data: normalizeCaptureDataInput(input.data),
    verification: verificationForTarget(input.target),
    networkDependent: input.networkDependent,
  }) as TileflowCaptureReceiptV4;
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
  assertPlainReceiptData(value);
  const receipt = requireRecord(value, 'receipt');
  const schemaVersion = receipt.schemaVersion;
  if (
    schemaVersion !== 2 &&
    schemaVersion !== 3 &&
    schemaVersion !== tileflowCaptureReceiptSchemaVersion
  ) {
    throw invalidReceipt('The baseline receipt schema version is unsupported.');
  }
  const commonKeys = [
    'schemaVersion',
    'scene',
    'style',
    'image',
    'renderer',
    'platform',
    'data',
    ...(schemaVersion === 2 && receipt.verification === undefined ? [] : ['verification']),
    'networkDependent',
  ];
  requireExactKeys(receipt, commonKeys);

  const scene = requireRecord(receipt.scene, 'scene');
  requireExactKeys(
    scene,
    schemaVersion === tileflowCaptureReceiptSchemaVersion
      ? ['name', 'map', 'theme', 'target', 'sha256']
      : ['name', 'map', 'target', 'sha256'],
  );
  const name = requireSceneName(scene.name);
  const map =
    schemaVersion === tileflowCaptureReceiptSchemaVersion
      ? requirePortableIdentifier(scene.map, 'scene.map')
      : requireIdentifier(scene.map, 'scene.map');
  const theme =
    schemaVersion === tileflowCaptureReceiptSchemaVersion
      ? requireConcreteTheme(scene.theme)
      : undefined;
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

  const data =
    schemaVersion === 2
      ? validateDataIdentityV2(receipt.data)
      : validateDataIdentityV3(receipt.data);

  const normalized = {
    schemaVersion,
    scene: {
      name,
      map,
      ...(theme === undefined ? {} : {theme}),
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
    data,
    verification,
    networkDependent: receipt.networkDependent,
  } as TileflowCaptureReceipt;
  assertCanonicalReceiptByteLimit(normalized);
  return normalized;
}

function validateDataIdentityV2(value: unknown): TileflowCaptureDataIdentityV2 {
  const data = requireRecord(value, 'data');
  if (data.url !== undefined && data.source !== undefined) {
    throw invalidReceipt(
      'The baseline receipt data identity must not mix legacy and safe sources.',
    );
  }
  requireExactKeys(data, [
    ...(data.bindings === undefined ? [] : ['bindings']),
    ...(data.capabilities === undefined ? [] : ['capabilities']),
    'kind',
    ...(data.generation === undefined ? [] : ['generation']),
    ...(data.revision === undefined ? [] : ['revision']),
    'schema',
    'schemaVersion',
    ...(data.semantics === undefined ? [] : ['semantics']),
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
  if (data.kind === 'tileflow-world') {
    const hasGeneration = data.generation !== undefined;
    const hasLegacyRevision = data.revision !== undefined;
    if (hasGeneration === hasLegacyRevision) {
      throw invalidReceipt(
        'The baseline receipt must identify World by one generation or one legacy revision.',
      );
    }
  } else if (data.generation !== undefined) {
    throw invalidReceipt('The baseline receipt has an invalid data.generation.');
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
  const semantics =
    data.semantics === undefined
      ? undefined
      : validateDataSemantics(data.semantics, 'data.semantics');

  return {
    ...(bindings ? {bindings} : {}),
    ...(capabilities ? {capabilities} : {}),
    ...(data.generation === undefined ? {} : {generation: requireWorldGeneration(data.generation)}),
    kind: data.kind,
    ...(data.revision === undefined ? {} : {revision: requireSourceRevision(data.revision)}),
    schema: data.schema,
    schemaVersion: requirePositiveInteger(data.schemaVersion, 'data.schemaVersion'),
    ...(semantics ? {semantics} : {}),
    sourceId: data.sourceId,
    ...(source ? {source} : {}),
  };
}

function validateDataIdentityV3(value: unknown): TileflowCaptureDataIdentityV3 {
  const data = requireRecord(value, 'data');
  if (data.kind === 'tileflow-world') {
    requireExactKeys(data, [
      'archiveSha256',
      'contractSha256',
      'dataContractSha256',
      'descriptorSha256',
      'kind',
      'product',
      'releaseId',
      'schema',
      'schemaVersion',
      ...(data.semantics === undefined ? [] : ['semantics']),
      'sourceId',
    ]);
    if (
      data.product !== 'world-v1' ||
      data.schema !== 'openmaptiles' ||
      data.sourceId !== 'tileflow'
    ) {
      throw invalidReceipt('The baseline receipt has an unsupported World data contract.');
    }
    const semantics =
      data.semantics === undefined
        ? undefined
        : validateDataSemantics(data.semantics, 'data.semantics');
    return {
      archiveSha256: requireHash(data.archiveSha256, 'data.archiveSha256'),
      contractSha256: requireHash(data.contractSha256, 'data.contractSha256'),
      dataContractSha256: requireHash(data.dataContractSha256, 'data.dataContractSha256'),
      descriptorSha256: requireHash(data.descriptorSha256, 'data.descriptorSha256'),
      kind: 'tileflow-world',
      product: 'world-v1',
      releaseId: requireWorldReleaseId(data.releaseId),
      schema: 'openmaptiles',
      schemaVersion: requirePositiveInteger(data.schemaVersion, 'data.schemaVersion'),
      ...(semantics ? {semantics} : {}),
      sourceId: 'tileflow',
    };
  }
  if (data.kind !== 'vector-tiles') {
    throw invalidReceipt('The baseline receipt has an invalid data.kind.');
  }
  requireExactKeys(data, [
    ...(data.bindings === undefined ? [] : ['bindings']),
    ...(data.capabilities === undefined ? [] : ['capabilities']),
    'kind',
    ...(data.revision === undefined ? [] : ['revision']),
    'schema',
    'schemaVersion',
    ...(data.semantics === undefined ? [] : ['semantics']),
    'sourceId',
    ...(data.source === undefined ? [] : ['source']),
  ]);
  if (data.schema !== 'openmaptiles' || data.sourceId !== 'tileflow') {
    throw invalidReceipt('The baseline receipt has an unsupported data contract.');
  }
  const bindings =
    data.bindings === undefined ? undefined : validateDataBindings(data.bindings, 'data.bindings');
  const capabilities =
    data.capabilities === undefined
      ? undefined
      : validateDataCapabilities(data.capabilities, 'data.capabilities');
  const semantics =
    data.semantics === undefined
      ? undefined
      : validateDataSemantics(data.semantics, 'data.semantics');
  return {
    ...(bindings ? {bindings} : {}),
    ...(capabilities ? {capabilities} : {}),
    kind: 'vector-tiles',
    ...(data.revision === undefined ? {} : {revision: requireSourceRevision(data.revision)}),
    schema: 'openmaptiles',
    schemaVersion: requirePositiveInteger(data.schemaVersion, 'data.schemaVersion'),
    ...(semantics ? {semantics} : {}),
    sourceId: 'tileflow',
    ...(data.source === undefined ? {} : {source: validateDataSource(data.source, 'data.source')}),
  };
}

function normalizeCaptureDataInput(input: TileflowCaptureDataInput): TileflowCaptureDataIdentityV3 {
  if (input.kind === 'tileflow-world') return input;
  const {url, ...identity} = input;
  return {
    ...identity,
    ...(url === undefined ? {} : {source: fingerprintLegacyDataUrl(url)}),
  };
}

function validateDataSemantics(value: unknown, field: string): TileflowCaptureDataSemanticsV2 {
  const semantics = requireRecord(value, field);
  requireExactKeys(semantics, ['parkLayer']);
  if (semantics.parkLayer !== 'mixed' && semantics.parkLayer !== 'protected-only') {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.parkLayer.`);
  }
  return {parkLayer: semantics.parkLayer};
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
  if (entries.length === 0 || entries.length > maximumReceiptBindingEntries) {
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

function assertCanonicalReceiptByteLimit(receipt: TileflowCaptureReceipt): void {
  const serialized = `${serializeCanonicalJson(receipt)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > tileflowCaptureReceiptLimits.maximumBytes) {
    throw invalidReceipt('The capture receipt exceeds the supported byte limit.');
  }
}

function assertPlainReceiptData(
  value: unknown,
  path = 'receipt',
  state: {ancestors: WeakSet<object>; nodes: number} = {
    ancestors: new WeakSet<object>(),
    nodes: 0,
  },
  depth = 0,
): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidReceipt(`The baseline receipt has an executable or non-plain ${path} value.`);
  }
  if (nodeUtilTypes.isProxy(value)) {
    throw invalidReceipt(`The baseline receipt has an executable proxy at ${path}.`);
  }
  if (depth > 32 || ++state.nodes > 4_096) {
    throw invalidReceipt('The baseline receipt exceeds the supported structural limit.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidReceipt(`The baseline receipt has a non-plain ${path} object.`);
  }
  if (state.ancestors.has(value)) {
    throw invalidReceipt('The baseline receipt must not contain cyclic data.');
  }
  state.ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    state.nodes += keys.length;
    if (state.nodes > 4_096) {
      throw invalidReceipt('The baseline receipt exceeds the supported structural limit.');
    }
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw invalidReceipt('The baseline receipt contains an unsupported symbol field.');
      }
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) {
        throw invalidReceipt('The baseline receipt contains an accessor or non-enumerable field.');
      }
      assertPlainReceiptData(descriptor.value, `${path}.${key}`, state, depth + 1);
    }
  } finally {
    state.ancestors.delete(value);
  }
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

function requirePortableIdentifier(value: unknown, field: string): string {
  const result = tileflowPortableIdSchema.safeParse(value);
  if (!result.success) throw invalidReceipt(`The baseline receipt has an invalid ${field}.`);
  return result.data;
}

function requireConcreteTheme(value: unknown): string {
  const result = tileflowThemeNameSchema.safeParse(value);
  if (!result.success) throw invalidReceipt('The baseline receipt has an invalid scene.theme.');
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

function requireWorldGeneration(value: unknown): 'v1' {
  if (value !== 'v1') {
    throw invalidReceipt('The baseline receipt has an invalid data.generation.');
  }
  return value;
}

function requireWorldReleaseId(value: unknown): string {
  if (!isTileflowWorldReleaseId(value)) {
    throw invalidReceipt('The baseline receipt has an invalid data.releaseId.');
  }
  return value;
}

function isSafeRuntimeIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(value);
}

function invalidReceipt(message: string, cause?: unknown): TileflowCaptureError {
  return new TileflowCaptureError('BASELINE_INVALID', message, {cause});
}
