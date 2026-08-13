import {
  serializeCanonicalJson,
  tileflowCaptureIdSchema,
  tileflowCaptureSceneLimits,
  tileflowCaptureSceneNameSchema,
} from '@tileflow/core';
import {TileflowCaptureError} from './errors';
import type {TileflowCaptureRendererIdentity} from './metadata';

export const tileflowCaptureReceiptSchemaVersion = 1 as const;
export const tileflowCaptureReceiptLimits = Object.freeze({maximumBytes: 64 * 1024});

export type TileflowCaptureReceipt = {
  schemaVersion: 1;
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
  source: {tilesetVersion: string | null};
  networkDependent: boolean;
};

export type CreateTileflowCaptureReceiptInput = {
  dpr: 1 | 2;
  height: number;
  map: string;
  networkDependent: boolean;
  pngSha256: string;
  renderer: TileflowCaptureRendererIdentity;
  scene: string;
  sceneSha256: string;
  styleSha256: string;
  sourceVersion?: string;
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
    source: {tilesetVersion: input.sourceVersion ?? null},
    networkDependent: input.networkDependent,
  });
}

export function serializeTileflowCaptureReceipt(receipt: TileflowCaptureReceipt): string {
  return `${serializeCanonicalJson(validateTileflowCaptureReceipt(receipt))}\n`;
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
  if (text.trim() !== serializeCanonicalJson(receipt)) {
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
    'source',
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

  const source = requireRecord(receipt.source, 'source');
  requireExactKeys(source, ['tilesetVersion']);

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
    source: {tilesetVersion: requireNullableSourceVersion(source.tilesetVersion)},
    networkDependent: receipt.networkDependent,
  };
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

function requireNullableSourceVersion(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw invalidReceipt('The baseline receipt has an invalid source.tilesetVersion.');
  }
  return value;
}

function isSafeRuntimeIdentity(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
}

function invalidReceipt(message: string, cause?: unknown): TileflowCaptureError {
  return new TileflowCaptureError('BASELINE_INVALID', message, {cause});
}
