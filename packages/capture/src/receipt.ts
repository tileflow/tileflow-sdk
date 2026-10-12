import {createHash} from 'node:crypto';
import {types as nodeUtilTypes} from 'node:util';
import {
  isTileflowWorldReleaseId,
  serializeCanonicalJson,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureShotLimits,
  tileflowPortableIdSchema,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import type {TileflowCaptureRendererIdentity} from './metadata';

export const tileflowCaptureReceiptSchemaVersion = 4 as const;
export const tileflowCaptureReceiptLimits = Object.freeze({maximumBytes: 64 * 1024});
const maximumReceiptBindingEntries = 128;

export type TileflowCaptureDataBindings = {
  fields: Record<string, string>;
  layers: Record<string, string>;
};

export type TileflowCaptureDataCapabilities = {
  businessCorridor: boolean;
  bathymetry: boolean;
  canopy: boolean;
  globalLandcover: boolean;
  tree: boolean;
};

export type TileflowCaptureDataSource = {
  kind: 'loopback' | 'opaque' | 'remote' | 'root-relative';
  /** SHA-256 of a credential-free, query-free endpoint identity. */
  sha256: string;
};

export type TileflowCaptureDataSemantics = {
  parkLayer: 'mixed' | 'protected-only';
};

/** Exact Tileflow World release identity. */
export type TileflowCaptureWorldIdentity = {
  archiveSha256: string;
  contractSha256: string;
  dataContractSha256: string;
  descriptorSha256: string;
  kind: 'tileflow-world';
  product: 'world-v1';
  releaseId: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  semantics: TileflowCaptureDataSemantics;
  sourceId: 'tileflow';
};

/** External vector-tile identity. Its endpoint is recorded only as a safe fingerprint. */
export type TileflowCaptureVectorIdentity = {
  bindings: TileflowCaptureDataBindings;
  capabilities: TileflowCaptureDataCapabilities;
  kind: 'vector-tiles';
  /** Explicit revision supplied by the data configuration. */
  revision?: string;
  schema: 'openmaptiles';
  schemaVersion: number;
  semantics: TileflowCaptureDataSemantics;
  source: TileflowCaptureDataSource;
  sourceId: 'tileflow';
};

/** Durable data identity owned by capture rather than the live core authoring API. */
export type TileflowCaptureDataIdentity =
  TileflowCaptureVectorIdentity | TileflowCaptureWorldIdentity;

/**
 * Data identity accepted by `createTileflowCaptureReceipt`. A vector `url` is transient input:
 * it is converted to `source` and never returned or serialized.
 */
export type TileflowCaptureDataInput =
  (Omit<TileflowCaptureVectorIdentity, 'source'> & {url: string}) | TileflowCaptureWorldIdentity;

export type TileflowCaptureVerification = {
  data: 'expected-unverified' | 'rendered';
  style: 'expected-unverified' | 'rendered';
};

export type TileflowCaptureReceipt = {
  schemaVersion: typeof tileflowCaptureReceiptSchemaVersion;
  scene: {
    name: string;
    map: string;
    theme: string;
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
  data: TileflowCaptureDataIdentity;
  verification: TileflowCaptureVerification;
  networkDependent: boolean;
};

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
): TileflowCaptureReceipt {
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
  assertPlainReceiptData(value);
  const receipt = requireRecord(value, 'receipt');
  if (receipt.schemaVersion !== tileflowCaptureReceiptSchemaVersion) {
    throw invalidReceipt('The baseline receipt schema version is unsupported.');
  }
  requireExactKeys(receipt, [
    'schemaVersion',
    'scene',
    'style',
    'image',
    'renderer',
    'platform',
    'data',
    'verification',
    'networkDependent',
  ]);

  const scene = requireRecord(receipt.scene, 'scene');
  requireExactKeys(scene, ['name', 'map', 'theme', 'target', 'sha256']);
  const name = requireSceneName(scene.name);
  const map = requirePortableIdentifier(scene.map, 'scene.map');
  const theme = requireConcreteTheme(scene.theme);
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

  const data = validateDataIdentity(receipt.data);

  const normalized: TileflowCaptureReceipt = {
    schemaVersion: tileflowCaptureReceiptSchemaVersion,
    scene: {
      name,
      map,
      theme,
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
  };
  assertCanonicalReceiptByteLimit(normalized);
  return normalized;
}

export const tileflowShotReceiptSchemaVersion = 1 as const;
export const tileflowShotReceiptLimits = Object.freeze({maximumBytes: 64 * 1024});

/**
 * Durable evidence for one rendered shot. Frames are deterministic, so `frames.sha256` identifies
 * the pixels; `output.sha256` identifies the written video or frame set, whose encoder bytes may
 * differ between runs.
 */
export type TileflowShotReceiptV1 = {
  schemaVersion: 1;
  kind: 'shot';
  shot: {name: string; map: string; theme: string; sha256: string};
  /** The compiled style of the shot's theme. */
  style: {sha256: string};
  /** Present when the shot blends themes: each blended theme's compiled style, in blend order. */
  blend?: {themes: Array<{name: string; styleSha256: string}>};
  timing: {fps: 24 | 25 | 30 | 50 | 60; frameCount: number; durationMs: number};
  image: {
    cssWidth: number;
    cssHeight: number;
    physicalWidth: number;
    physicalHeight: number;
    dpr: 1 | 2;
  };
  /** SHA-256 of each frame's PNG SHA-256 in lowercase hex, one per line, in frame order. */
  frames: {sha256: string};
  output: {kind: 'frames'; sha256: string} | {kind: 'webm'; codec: 'vp8' | 'vp9'; sha256: string};
  renderer: TileflowCaptureRendererIdentity;
  platform: {os: string; architecture: string};
  data: TileflowCaptureDataIdentity;
  verification: {data: 'rendered'; style: 'rendered'};
  networkDependent: boolean;
};

export type CreateTileflowShotReceiptInput = {
  blend?: Array<{name: string; styleSha256: string}>;
  data: TileflowCaptureDataInput;
  dpr: 1 | 2;
  durationMs: number;
  fps: 24 | 25 | 30 | 50 | 60;
  frameCount: number;
  framesSha256: string;
  height: number;
  map: string;
  networkDependent: boolean;
  output: TileflowShotReceiptV1['output'];
  renderer: TileflowCaptureRendererIdentity;
  shot: string;
  shotSha256: string;
  styleSha256: string;
  theme: string;
  width: number;
};

export function createTileflowShotReceipt(
  input: CreateTileflowShotReceiptInput,
): TileflowShotReceiptV1 {
  return validateTileflowShotReceipt({
    schemaVersion: tileflowShotReceiptSchemaVersion,
    kind: 'shot',
    shot: {name: input.shot, map: input.map, theme: input.theme, sha256: input.shotSha256},
    style: {sha256: input.styleSha256},
    ...(input.blend ? {blend: {themes: input.blend}} : {}),
    timing: {fps: input.fps, frameCount: input.frameCount, durationMs: input.durationMs},
    image: {
      cssWidth: input.width,
      cssHeight: input.height,
      physicalWidth: input.width * input.dpr,
      physicalHeight: input.height * input.dpr,
      dpr: input.dpr,
    },
    frames: {sha256: input.framesSha256},
    output: input.output,
    renderer: input.renderer,
    platform: {os: process.platform, architecture: process.arch},
    data: normalizeCaptureDataInput(input.data),
    verification: {data: 'rendered', style: 'rendered'},
    networkDependent: input.networkDependent,
  });
}

export function serializeTileflowShotReceipt(receipt: TileflowShotReceiptV1): string {
  const serialized = `${serializeCanonicalJson(validateTileflowShotReceipt(receipt))}\n`;
  if (new TextEncoder().encode(serialized).byteLength > tileflowShotReceiptLimits.maximumBytes) {
    throw invalidReceipt('The shot receipt exceeds the supported byte limit.');
  }
  return serialized;
}

export function parseTileflowShotReceipt(source: string | Uint8Array): TileflowShotReceiptV1 {
  const byteLength =
    typeof source === 'string' ? new TextEncoder().encode(source).byteLength : source.byteLength;
  if (byteLength > tileflowShotReceiptLimits.maximumBytes) {
    throw invalidReceipt('The shot receipt exceeds the supported byte limit.');
  }
  let value: unknown;
  let text: string;
  try {
    text =
      typeof source === 'string' ? source : new TextDecoder('utf-8', {fatal: true}).decode(source);
    value = JSON.parse(text);
  } catch (error) {
    throw invalidReceipt('The shot receipt is not valid UTF-8 JSON.', error);
  }

  const receipt = validateTileflowShotReceipt(value);
  if (text.trim() !== serializeCanonicalJson(value)) {
    throw invalidReceipt('The shot receipt is not canonical JSON.');
  }
  return receipt;
}

export function validateTileflowShotReceipt(value: unknown): TileflowShotReceiptV1 {
  assertPlainReceiptData(value, 'receipt', {
    allowArrays: true,
    ancestors: new WeakSet<object>(),
    nodes: 0,
  });
  const receipt = requireRecord(value, 'receipt');
  if (receipt.schemaVersion !== tileflowShotReceiptSchemaVersion || receipt.kind !== 'shot') {
    throw invalidReceipt('The shot receipt schema version is unsupported.');
  }
  requireExactKeys(receipt, [
    'schemaVersion',
    'kind',
    'shot',
    'style',
    ...(receipt.blend === undefined ? [] : ['blend']),
    'timing',
    'image',
    'frames',
    'output',
    'renderer',
    'platform',
    'data',
    'verification',
    'networkDependent',
  ]);

  const shot = requireRecord(receipt.shot, 'shot');
  requireExactKeys(shot, ['name', 'map', 'theme', 'sha256']);
  const style = requireRecord(receipt.style, 'style');
  requireExactKeys(style, ['sha256']);
  const blend = receipt.blend === undefined ? undefined : validateShotBlend(receipt.blend);

  const timing = requireRecord(receipt.timing, 'timing');
  requireExactKeys(timing, ['fps', 'frameCount', 'durationMs']);
  const fps = timing.fps;
  if (fps !== 24 && fps !== 25 && fps !== 30 && fps !== 50 && fps !== 60) {
    throw invalidReceipt('The shot receipt has an invalid timing.fps.');
  }
  const frameCount = requirePositiveInteger(timing.frameCount, 'timing.frameCount');
  const durationMs = requirePositiveInteger(timing.durationMs, 'timing.durationMs');
  if (
    durationMs > tileflowCaptureShotLimits.durationMs.maximum ||
    frameCount > tileflowCaptureShotLimits.maximumFrames ||
    frameCount !== Math.floor((durationMs * fps) / 1_000 + 1e-9) + 1
  ) {
    throw invalidReceipt('The shot receipt timing is inconsistent.');
  }

  const image = requireRecord(receipt.image, 'image');
  requireExactKeys(image, ['cssWidth', 'cssHeight', 'physicalWidth', 'physicalHeight', 'dpr']);
  const cssWidth = requirePositiveInteger(image.cssWidth, 'image.cssWidth');
  const cssHeight = requirePositiveInteger(image.cssHeight, 'image.cssHeight');
  const physicalWidth = requirePositiveInteger(image.physicalWidth, 'image.physicalWidth');
  const physicalHeight = requirePositiveInteger(image.physicalHeight, 'image.physicalHeight');
  if (image.dpr !== 1 && image.dpr !== 2) {
    throw invalidReceipt('The shot receipt has an invalid image DPR.');
  }
  if (cssWidth * image.dpr !== physicalWidth || cssHeight * image.dpr !== physicalHeight) {
    throw invalidReceipt('The shot receipt image dimensions are inconsistent.');
  }
  if (
    physicalWidth > tileflowCaptureSceneLimits.viewport.maximum ||
    physicalHeight > tileflowCaptureSceneLimits.viewport.maximum ||
    physicalWidth * physicalHeight > tileflowCaptureSceneLimits.maximumPhysicalPixels
  ) {
    throw invalidReceipt('The shot receipt image exceeds the supported pixel limit.');
  }

  const frames = requireRecord(receipt.frames, 'frames');
  requireExactKeys(frames, ['sha256']);
  const framesSha256 = requireHash(frames.sha256, 'frames.sha256');
  const output = requireRecord(receipt.output, 'output');
  if (output.kind === 'webm') {
    requireExactKeys(output, ['kind', 'codec', 'sha256']);
    if (output.codec !== 'vp8' && output.codec !== 'vp9') {
      throw invalidReceipt('The shot receipt has an invalid output.codec.');
    }
  } else if (output.kind === 'frames') {
    requireExactKeys(output, ['kind', 'sha256']);
    if (output.sha256 !== framesSha256) {
      throw invalidReceipt('The shot receipt frame output does not match its frames.');
    }
  } else {
    throw invalidReceipt('The shot receipt has an invalid output.kind.');
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
  const verification = requireRecord(receipt.verification, 'verification');
  requireExactKeys(verification, ['data', 'style']);
  if (verification.data !== 'rendered' || verification.style !== 'rendered') {
    throw invalidReceipt('The shot receipt verification must record rendered style and data.');
  }
  if (typeof receipt.networkDependent !== 'boolean') {
    throw invalidReceipt('The shot receipt has an invalid network dependency flag.');
  }

  const normalized: TileflowShotReceiptV1 = {
    schemaVersion: tileflowShotReceiptSchemaVersion,
    kind: 'shot',
    shot: {
      name: requireSceneName(shot.name),
      map: requirePortableIdentifier(shot.map, 'shot.map'),
      theme: requireShotTheme(shot.theme, 'shot.theme'),
      sha256: requireHash(shot.sha256, 'shot.sha256'),
    },
    style: {sha256: requireHash(style.sha256, 'style.sha256')},
    ...(blend ? {blend} : {}),
    timing: {fps, frameCount, durationMs},
    image: {cssWidth, cssHeight, physicalWidth, physicalHeight, dpr: image.dpr},
    frames: {sha256: framesSha256},
    output:
      output.kind === 'webm'
        ? {
            kind: 'webm',
            codec: output.codec as 'vp8' | 'vp9',
            sha256: requireHash(output.sha256, 'output.sha256'),
          }
        : {kind: 'frames', sha256: framesSha256},
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
    data: validateDataIdentity(receipt.data),
    verification: {data: 'rendered', style: 'rendered'},
    networkDependent: receipt.networkDependent,
  };
  const serialized = `${serializeCanonicalJson(normalized)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > tileflowShotReceiptLimits.maximumBytes) {
    throw invalidReceipt('The shot receipt exceeds the supported byte limit.');
  }
  return normalized;
}

function requireShotTheme(value: unknown, field: string): string {
  const result = tileflowThemeNameSchema.safeParse(value);
  if (!result.success) throw invalidReceipt(`The shot receipt has an invalid ${field}.`);
  return result.data;
}

function validateShotBlend(value: unknown): NonNullable<TileflowShotReceiptV1['blend']> {
  const blend = requireRecord(value, 'blend');
  requireExactKeys(blend, ['themes']);
  if (
    !Array.isArray(blend.themes) ||
    blend.themes.length < tileflowCaptureShotLimits.blendThemes.minimum ||
    blend.themes.length > tileflowCaptureShotLimits.blendThemes.maximum
  ) {
    throw invalidReceipt('The shot receipt has an invalid blend.themes list.');
  }
  const themes = blend.themes.map((entry: unknown, index: number) => {
    const theme = requireRecord(entry, `blend.themes.${index}`);
    requireExactKeys(theme, ['name', 'styleSha256']);
    return {
      name: requireShotTheme(theme.name, `blend.themes.${index}.name`),
      styleSha256: requireHash(theme.styleSha256, `blend.themes.${index}.styleSha256`),
    };
  });
  if (new Set(themes.map((theme) => theme.name)).size !== themes.length) {
    throw invalidReceipt('The shot receipt blends a theme more than once.');
  }
  return {themes};
}

function validateDataIdentity(value: unknown): TileflowCaptureDataIdentity {
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
      'semantics',
      'sourceId',
    ]);
    if (
      data.product !== 'world-v1' ||
      data.schema !== 'openmaptiles' ||
      data.sourceId !== 'tileflow'
    ) {
      throw invalidReceipt('The baseline receipt has an unsupported World data contract.');
    }
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
      semantics: validateDataSemantics(data.semantics, 'data.semantics'),
      sourceId: 'tileflow',
    };
  }
  if (data.kind !== 'vector-tiles') {
    throw invalidReceipt('The baseline receipt has an invalid data.kind.');
  }
  requireExactKeys(data, [
    'bindings',
    'capabilities',
    'kind',
    ...(data.revision === undefined ? [] : ['revision']),
    'schema',
    'schemaVersion',
    'semantics',
    'source',
    'sourceId',
  ]);
  if (data.schema !== 'openmaptiles' || data.sourceId !== 'tileflow') {
    throw invalidReceipt('The baseline receipt has an unsupported data contract.');
  }
  return {
    bindings: validateDataBindings(data.bindings, 'data.bindings'),
    capabilities: validateDataCapabilities(data.capabilities, 'data.capabilities'),
    kind: 'vector-tiles',
    ...(data.revision === undefined ? {} : {revision: requireSourceRevision(data.revision)}),
    schema: 'openmaptiles',
    schemaVersion: requirePositiveInteger(data.schemaVersion, 'data.schemaVersion'),
    semantics: validateDataSemantics(data.semantics, 'data.semantics'),
    source: validateDataSource(data.source, 'data.source'),
    sourceId: 'tileflow',
  };
}

function normalizeCaptureDataInput(input: TileflowCaptureDataInput): TileflowCaptureDataIdentity {
  if (input.kind === 'tileflow-world') return input;
  const {url, ...identity} = input;
  return {...identity, source: fingerprintDataUrl(url)};
}

function validateDataSemantics(value: unknown, field: string): TileflowCaptureDataSemantics {
  const semantics = requireRecord(value, field);
  requireExactKeys(semantics, ['parkLayer']);
  if (semantics.parkLayer !== 'mixed' && semantics.parkLayer !== 'protected-only') {
    throw invalidReceipt(`The baseline receipt has an invalid ${field}.parkLayer.`);
  }
  return {parkLayer: semantics.parkLayer};
}

function validateDataBindings(value: unknown, field: string): TileflowCaptureDataBindings {
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

function validateDataCapabilities(value: unknown, field: string): TileflowCaptureDataCapabilities {
  const capabilities = requireRecord(value, field);
  requireExactKeys(capabilities, [
    'businessCorridor',
    'bathymetry',
    'canopy',
    'globalLandcover',
    'tree',
  ]);
  if (
    typeof capabilities.businessCorridor !== 'boolean' ||
    typeof capabilities.bathymetry !== 'boolean' ||
    typeof capabilities.canopy !== 'boolean' ||
    typeof capabilities.globalLandcover !== 'boolean' ||
    typeof capabilities.tree !== 'boolean'
  ) {
    throw invalidReceipt(`The baseline receipt has an invalid ${field} object.`);
  }
  return {
    businessCorridor: capabilities.businessCorridor,
    bathymetry: capabilities.bathymetry,
    canopy: capabilities.canopy,
    globalLandcover: capabilities.globalLandcover,
    tree: capabilities.tree,
  };
}

function validateDataSource(value: unknown, field: string): TileflowCaptureDataSource {
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
): TileflowCaptureVerification {
  const expected = verificationForTarget(target);
  const verification = requireRecord(value, 'verification');
  requireExactKeys(verification, ['data', 'style']);
  if (verification.data !== expected.data || verification.style !== expected.style) {
    throw invalidReceipt(
      `The baseline receipt verification does not match its ${target} capture target.`,
    );
  }
  return expected;
}

function verificationForTarget(target: 'application' | 'map'): TileflowCaptureVerification {
  const state = target === 'map' ? 'rendered' : 'expected-unverified';
  return {data: state, style: state};
}

function assertCanonicalReceiptByteLimit(receipt: TileflowCaptureReceipt): void {
  const serialized = `${serializeCanonicalJson(receipt)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > tileflowCaptureReceiptLimits.maximumBytes) {
    throw invalidReceipt('The capture receipt exceeds the supported byte limit.');
  }
}

/** Shot receipts contain arrays; still receipts never do. */
function assertPlainReceiptData(
  value: unknown,
  path = 'receipt',
  state: {allowArrays: boolean; ancestors: WeakSet<object>; nodes: number} = {
    allowArrays: false,
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
  if (typeof value === 'object' && Array.isArray(value) && state.allowArrays) {
    assertPlainReceiptArray(value, path, state, depth);
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

function assertPlainReceiptArray(
  value: unknown[],
  path: string,
  state: {allowArrays: boolean; ancestors: WeakSet<object>; nodes: number},
  depth: number,
): void {
  if (nodeUtilTypes.isProxy(value)) {
    throw invalidReceipt(`The baseline receipt has an executable proxy at ${path}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalidReceipt(`The baseline receipt has a non-plain ${path} array.`);
  }
  if (depth > 32 || ++state.nodes > 4_096 || value.length > 4_096) {
    throw invalidReceipt('The baseline receipt exceeds the supported structural limit.');
  }
  if (state.ancestors.has(value)) {
    throw invalidReceipt('The baseline receipt must not contain cyclic data.');
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw invalidReceipt(`The baseline receipt has a sparse or extended ${path} array.`);
  }
  state.ancestors.add(value);
  try {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw invalidReceipt('The baseline receipt contains an accessor or non-enumerable field.');
      }
      assertPlainReceiptData(descriptor.value, `${path}.${index}`, state, depth + 1);
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

function fingerprintDataUrl(value: unknown): TileflowCaptureDataSource {
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
  kind: TileflowCaptureDataSource['kind'],
  identity: string,
): TileflowCaptureDataSource {
  return {kind, sha256: createHash('sha256').update(identity).digest('hex')};
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
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
