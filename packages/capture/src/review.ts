import {types as nodeUtilTypes} from 'node:util';
import {
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
  serializeCanonicalJson,
  sha256Hex,
} from '@tileflow/core';
import type {TileflowCapture} from './capture';
import {type TileflowCaptureReceiptV4, validateTileflowCaptureReceipt} from './receipt';
import {
  analyzeTileflowCapturePairForReview,
  tileflowVisualArtifactLimits,
  type TileflowVisualRegion,
  type TileflowVisualReviewAppearance,
  type TileflowVisualImageIdentity,
  type TileflowVisualPaletteColor,
  type TileflowVisualPixelMetric,
} from './visual';

export const tileflowVisualReviewSchemaVersion = 1 as const;

export type TileflowVisualReviewStatus =
  | 'comparable'
  | 'frame-mismatch'
  | 'dimensions-mismatch'
  | 'runtime-mismatch'
  | 'data-mismatch';

export type TileflowVisualReviewDefinition = NormalizedTileflowCaptureScene & {
  theme: string;
};

export type TileflowVisualReviewCapture = {
  capture: TileflowCapture;
  definition: TileflowVisualReviewDefinition;
};

export type TileflowVisualReviewOptions = {
  /** The contextual diff is evidence for review, never an approval or baseline decision. */
  includeDiff?: boolean;
  /** Restrict appearance metrics to one bounded rectangle in physical PNG pixels. */
  region?: TileflowVisualRegion;
};

export type TileflowVisualReviewFrameIdentity = {
  camera: TileflowVisualReviewDefinition['camera'];
  viewport: TileflowVisualReviewDefinition['viewport'];
  target: {kind: 'map'} | {kind: 'application'; frame: 'map' | 'viewport'};
};

export type TileflowVisualReviewSide = {
  scene: TileflowCaptureReceiptV4['scene'];
  style: TileflowCaptureReceiptV4['style'];
  frame: TileflowVisualReviewFrameIdentity;
  image: TileflowVisualImageIdentity;
  runtime: Pick<TileflowCaptureReceiptV4, 'renderer' | 'platform'>;
  data: TileflowCaptureReceiptV4['data'];
  verification: TileflowCaptureReceiptV4['verification'];
  palette: TileflowVisualPaletteColor[];
};

export type TileflowVisualReviewComparison = {
  schemaVersion: 1;
  kind: 'style-review';
  status: TileflowVisualReviewStatus;
  left: TileflowVisualReviewSide;
  right: TileflowVisualReviewSide;
  frameMatch: boolean;
  dimensionsMatch: boolean;
  rendererMatch: boolean;
  dataMatch: boolean;
  exact: TileflowVisualPixelMetric | null;
  perceptual: (TileflowVisualPixelMetric & {threshold: number}) | null;
  meanAbsoluteChannelDifference: number | null;
  appearance: TileflowVisualReviewAppearance | null;
  diffPng?: Uint8Array;
  warnings: string[];
};

export type TileflowVisualReviewDocument = Omit<TileflowVisualReviewComparison, 'diffPng'>;

export class TileflowVisualReviewError extends Error {
  readonly code = 'VISUAL_REVIEW_INVALID' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TileflowVisualReviewError';
  }
}

/**
 * Compare two deliberate Tileflow renders for human or agent review. Unlike baseline comparison,
 * map, theme, scene, and style identities may differ. Pixel evidence is produced only after the
 * two inputs prove that they share the same frame, dimensions, renderer, and exact data identity.
 */
export async function compareTileflowCapturesForReview(
  leftInput: TileflowVisualReviewCapture,
  rightInput: TileflowVisualReviewCapture,
  options: TileflowVisualReviewOptions = {},
): Promise<TileflowVisualReviewComparison> {
  const normalizedOptions = validateReviewOptions(options);
  const [leftSnapshot, rightSnapshot] = snapshotReviewInputs(leftInput, rightInput);
  const [left, right] = await Promise.all([
    validateReviewCapture(leftSnapshot, 'left'),
    validateReviewCapture(rightSnapshot, 'right'),
  ]);

  const frameMatch = sameCanonicalValue(left.comparableFrame, right.comparableFrame);
  const dimensionsMatch =
    left.receipt.image.physicalWidth === right.receipt.image.physicalWidth &&
    left.receipt.image.physicalHeight === right.receipt.image.physicalHeight;
  const rendererMatch = sameCanonicalValue(
    runtimeIdentity(left.receipt),
    runtimeIdentity(right.receipt),
  );
  const dataMatch = sameCanonicalValue(left.receipt.data, right.receipt.data);
  const status = reviewStatus({dataMatch, dimensionsMatch, frameMatch, rendererMatch});
  const comparable = status === 'comparable';
  const warnings = reviewWarnings(status, left.receipt, right.receipt);
  let analysis: Awaited<ReturnType<typeof analyzeTileflowCapturePairForReview>>;
  try {
    analysis = await analyzeTileflowCapturePairForReview(
      {png: left.png, receipt: left.receipt},
      {png: right.png, receipt: right.receipt},
      {
        comparePixels: comparable,
        includeDiff: comparable && normalizedOptions.includeDiff,
        ...(normalizedOptions.region ? {region: normalizedOptions.region} : {}),
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw invalidReview(`The review PNGs could not be validated.${detail}`, error);
  }

  return {
    schemaVersion: tileflowVisualReviewSchemaVersion,
    kind: 'style-review',
    status,
    left: reviewSide(left, analysis.left.palette),
    right: reviewSide(right, analysis.right.palette),
    frameMatch,
    dimensionsMatch,
    rendererMatch,
    dataMatch,
    exact: comparable ? analysis.exact : null,
    perceptual: comparable ? analysis.perceptual : null,
    meanAbsoluteChannelDifference: comparable ? analysis.meanAbsoluteChannelDifference : null,
    appearance: comparable ? analysis.appearance : null,
    ...(comparable && analysis.diffPng ? {diffPng: analysis.diffPng} : {}),
    warnings,
  };
}

export function createTileflowVisualReviewDocument(
  comparison: TileflowVisualReviewComparison,
): TileflowVisualReviewDocument {
  const {diffPng: _diffPng, ...document} = comparison;
  return document;
}

export const tileflowVisualReviewLimits = Object.freeze({
  maximumAggregatePngBytes: tileflowVisualArtifactLimits.maximumPngBytes,
});

const reviewCaptureKeys = [
  'scene',
  'map',
  'theme',
  'target',
  'png',
  'sha256',
  'sceneSha256',
  'styleSha256',
  'width',
  'height',
  'dpr',
  'networkDependent',
  'renderer',
  'receipt',
  'warnings',
] as const;
const maximumReviewDataNodes = 4_096;
const maximumReviewDataDepth = 32;

type ReviewCaptureSnapshot = {
  capture: TileflowCapture;
  definition: TileflowVisualReviewDefinition;
};

type InspectedReviewInput = {
  capture: Omit<TileflowCapture, 'png'> & {png: Uint8Array};
  pngByteLength: number;
  definition: TileflowVisualReviewDefinition;
};

function snapshotReviewInputs(
  leftInput: TileflowVisualReviewCapture,
  rightInput: TileflowVisualReviewCapture,
): [ReviewCaptureSnapshot, ReviewCaptureSnapshot] {
  const left = inspectReviewInput(leftInput, 'left');
  const right = inspectReviewInput(rightInput, 'right');
  validateTileflowVisualReviewPngByteLengths(left.pngByteLength, right.pngByteLength);
  return [snapshotInspectedReviewInput(left, 'left'), snapshotInspectedReviewInput(right, 'right')];
}

function inspectReviewInput(
  input: TileflowVisualReviewCapture,
  role: 'left' | 'right',
): InspectedReviewInput {
  const wrapper = readPlainDataRecord(input, `${role} review input`, ['capture', 'definition']);
  const capture = readPlainDataRecord(wrapper.capture, `${role} capture`, reviewCaptureKeys);
  const definition = clonePlainDataValue(
    wrapper.definition,
    `${role} definition`,
  ) as TileflowVisualReviewDefinition;
  const renderer = clonePlainDataValue(
    capture.renderer,
    `${role} capture.renderer`,
  ) as TileflowCapture['renderer'];
  const receipt = clonePlainDataValue(
    capture.receipt,
    `${role} capture.receipt`,
  ) as TileflowCapture['receipt'];
  const warnings = clonePlainDataValue(capture.warnings, `${role} capture.warnings`) as string[];
  const png = requireReviewPng(capture.png, role);

  return {
    capture: {
      scene: capture.scene as string,
      map: capture.map as string,
      theme: capture.theme as string,
      target: capture.target as TileflowCapture['target'],
      png: png.source,
      sha256: capture.sha256 as string,
      sceneSha256: capture.sceneSha256 as string,
      styleSha256: capture.styleSha256 as string,
      width: capture.width as number,
      height: capture.height as number,
      dpr: capture.dpr as TileflowCapture['dpr'],
      networkDependent: capture.networkDependent as boolean,
      renderer,
      receipt,
      warnings,
    },
    pngByteLength: png.byteLength,
    definition,
  };
}

function snapshotInspectedReviewInput(
  input: InspectedReviewInput,
  role: 'left' | 'right',
): ReviewCaptureSnapshot {
  let png: Uint8Array;
  try {
    png = new Uint8Array(input.pngByteLength);
    png.set(input.capture.png);
  } catch (error) {
    throw invalidReview(`The ${role} PNG could not be snapshotted safely.`, error);
  }
  if (png.byteLength !== input.pngByteLength) {
    throw invalidReview(`The ${role} PNG changed while it was being snapshotted.`);
  }
  return {capture: {...input.capture, png}, definition: input.definition};
}

/** Internal numeric preflight kept separate so aggregate limits can be regression-tested cheaply. */
export function validateTileflowVisualReviewPngByteLengths(
  leftByteLength: number,
  rightByteLength: number,
): void {
  for (const [role, byteLength] of [
    ['left', leftByteLength],
    ['right', rightByteLength],
  ] as const) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw invalidReview(`The ${role} PNG has an invalid byte length.`);
    }
    if (byteLength > tileflowVisualArtifactLimits.maximumPngBytes) {
      throw invalidReview(`The ${role} PNG exceeds the visual artifact byte limit.`);
    }
  }
  if (leftByteLength + rightByteLength > tileflowVisualReviewLimits.maximumAggregatePngBytes) {
    throw invalidReview('The review PNGs exceed the aggregate visual artifact byte limit.');
  }
}

function requireReviewPng(
  value: unknown,
  role: 'left' | 'right',
): {source: Uint8Array; byteLength: number} {
  if (value !== null && typeof value === 'object' && nodeUtilTypes.isProxy(value)) {
    throw invalidReview(`The ${role} PNG must not use an executable proxy.`);
  }
  const isBuffer = Buffer.isBuffer(value);
  if (
    !(value instanceof Uint8Array) ||
    (!isBuffer && Object.getPrototypeOf(value) !== Uint8Array.prototype)
  ) {
    throw invalidReview(`The ${role} PNG must be a plain Uint8Array or Buffer.`);
  }
  if (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer) {
    throw invalidReview(`The ${role} PNG must not use shared mutable memory.`);
  }
  let byteLength: number;
  try {
    byteLength = value.byteLength;
  } catch (error) {
    throw invalidReview(`The ${role} PNG has an invalid byte buffer.`, error);
  }
  return {source: value, byteLength};
}

function validateReviewOptions(options: TileflowVisualReviewOptions): {
  includeDiff: boolean;
  region?: TileflowVisualRegion;
} {
  const record = readPlainDataRecord(options, 'review options');
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'includeDiff' && key !== 'region')) {
    throw invalidReview('The review options contain unsupported fields.');
  }
  if (record.includeDiff !== undefined && typeof record.includeDiff !== 'boolean') {
    throw invalidReview('The review includeDiff option must be boolean.');
  }
  if (record.region === undefined) {
    return {includeDiff: record.includeDiff !== false};
  }
  const region = readPlainDataRecord(record.region, 'review region', ['x', 'y', 'width', 'height']);
  return {
    includeDiff: record.includeDiff !== false,
    region: {
      x: region.x as number,
      y: region.y as number,
      width: region.width as number,
      height: region.height as number,
    },
  };
}

function clonePlainDataValue(
  value: unknown,
  path: string,
  state: {ancestors: WeakSet<object>; nodes: number} = {
    ancestors: new WeakSet<object>(),
    nodes: 0,
  },
  depth = 0,
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    throw invalidReview(`The ${path} value must contain only plain data.`);
  }
  if (nodeUtilTypes.isProxy(value)) {
    throw invalidReview(`The ${path} value must not use an executable proxy.`);
  }
  if (depth > maximumReviewDataDepth || ++state.nodes > maximumReviewDataNodes) {
    throw invalidReview(`The ${path} value exceeds the bounded plain-data shape.`);
  }
  if (state.ancestors.has(value)) {
    throw invalidReview(`The ${path} value must not contain a cycle.`);
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > maximumReviewDataNodes
      ) {
        throw invalidReview(`The ${path} value must use a plain bounded array.`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const indices = Object.keys(descriptors).filter((key) => key !== 'length');
      if (indices.length !== value.length) {
        throw invalidReview(`The ${path} value must use a dense plain array.`);
      }
      const clone = new Array<unknown>(value.length);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
          throw invalidReview(`The ${path} value contains an unsupported array field.`);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= value.length) {
          throw invalidReview(`The ${path} value contains an out-of-bounds array field.`);
        }
        const descriptor = descriptors[key]!;
        if (!('value' in descriptor) || !descriptor.enumerable) {
          throw invalidReview(`The ${path} value contains an executable array field.`);
        }
        clone[index] = clonePlainDataValue(descriptor.value, `${path}[${key}]`, state, depth + 1);
      }
      return clone;
    }

    const record = readPlainDataRecord(value, path);
    state.nodes += Object.keys(record).length;
    if (state.nodes > maximumReviewDataNodes) {
      throw invalidReview(`The ${path} value exceeds the bounded plain-data shape.`);
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [
        key,
        clonePlainDataValue(child, `${path}.${key}`, state, depth + 1),
      ]),
    );
  } finally {
    state.ancestors.delete(value);
  }
}

function readPlainDataRecord(
  value: unknown,
  path: string,
  expectedKeys?: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidReview(`The ${path} must be a plain data object.`);
  }
  if (nodeUtilTypes.isProxy(value)) {
    throw invalidReview(`The ${path} must not use an executable proxy.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidReview(`The ${path} must not use a custom prototype.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      throw invalidReview(`The ${path} contains an unsupported symbol field.`);
    }
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor) || !descriptor.enumerable) {
      throw invalidReview(`The ${path} contains an accessor or non-enumerable field.`);
    }
    entries.push([key, descriptor.value]);
  }
  if (expectedKeys) {
    const actual = entries.map(([key]) => key).sort(compareCodeUnits);
    const wanted = [...expectedKeys].sort(compareCodeUnits);
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw invalidReview(`The ${path} contains missing or unsupported fields.`);
    }
  }
  return Object.fromEntries(entries);
}

type ValidatedReviewCapture = {
  definition: TileflowVisualReviewDefinition;
  comparableFrame: TileflowVisualReviewFrameIdentity;
  png: Uint8Array;
  receipt: TileflowCaptureReceiptV4;
};

async function validateReviewCapture(
  input: ReviewCaptureSnapshot,
  role: 'left' | 'right',
): Promise<ValidatedReviewCapture> {
  let normalized: NormalizedTileflowCaptureScene;
  try {
    normalized = normalizeTileflowCaptureScene(input.definition);
  } catch (error) {
    throw invalidReview(`The ${role} review definition is invalid.`, error);
  }
  const definition: TileflowVisualReviewDefinition = normalized;
  if (!sameCanonicalValue(input.definition, definition)) {
    throw invalidReview(`The ${role} review definition must be the exact normalized shape.`);
  }
  let parsedReceipt: ReturnType<typeof validateTileflowCaptureReceipt>;
  try {
    parsedReceipt = validateTileflowCaptureReceipt(input.capture.receipt);
  } catch (error) {
    throw invalidReview(`The ${role} capture receipt is invalid.`, error);
  }
  const receipt = parsedReceipt;
  if (receipt.schemaVersion !== 4) {
    throw invalidReview(`The ${role} review capture requires a schema-v4 receipt.`);
  }

  if (
    definition.map !== receipt.scene.map ||
    definition.theme !== receipt.scene.theme ||
    definition.target.kind !== receipt.scene.target
  ) {
    throw invalidReview(`The ${role} review identity does not match its capture receipt.`);
  }
  const capturesViewport =
    definition.target.kind === 'map' || definition.target.frame === 'viewport';
  if (
    definition.viewport.dpr !== receipt.image.dpr ||
    (capturesViewport &&
      (definition.viewport.width !== receipt.image.cssWidth ||
        definition.viewport.height !== receipt.image.cssHeight))
  ) {
    throw invalidReview(`The ${role} review frame does not match its captured dimensions.`);
  }
  if (
    input.capture.scene !== receipt.scene.name ||
    input.capture.map !== receipt.scene.map ||
    input.capture.theme !== receipt.scene.theme ||
    input.capture.target !== receipt.scene.target ||
    input.capture.sha256 !== receipt.image.sha256 ||
    input.capture.sceneSha256 !== receipt.scene.sha256 ||
    input.capture.styleSha256 !== receipt.style.sha256 ||
    input.capture.width !== receipt.image.cssWidth ||
    input.capture.height !== receipt.image.cssHeight ||
    input.capture.dpr !== receipt.image.dpr ||
    input.capture.networkDependent !== receipt.networkDependent ||
    !sameCanonicalValue(input.capture.renderer, receipt.renderer)
  ) {
    throw invalidReview(`The ${role} capture metadata does not match its receipt.`);
  }

  const definitionSha256 = await sha256Hex(serializeCanonicalJson(definition));
  if (definitionSha256 !== receipt.scene.sha256) {
    throw invalidReview(`The ${role} review definition does not match its capture receipt.`);
  }

  return {
    definition,
    comparableFrame: reviewFrameIdentity(definition),
    png: input.capture.png,
    receipt,
  };
}

function reviewSide(
  input: ValidatedReviewCapture,
  palette: TileflowVisualPaletteColor[],
): TileflowVisualReviewSide {
  return {
    scene: input.receipt.scene,
    style: input.receipt.style,
    frame: input.comparableFrame,
    image: imageIdentity(input.receipt),
    runtime: runtimeIdentity(input.receipt),
    data: input.receipt.data,
    verification: input.receipt.verification,
    palette,
  };
}

function reviewFrameIdentity(
  definition: TileflowVisualReviewDefinition,
): TileflowVisualReviewFrameIdentity {
  return {
    camera: definition.camera,
    viewport: definition.viewport,
    target:
      definition.target.kind === 'map'
        ? {kind: 'map'}
        : {kind: 'application', frame: definition.target.frame},
  };
}

function imageIdentity(receipt: TileflowCaptureReceiptV4): TileflowVisualImageIdentity {
  return {
    sha256: receipt.image.sha256,
    cssWidth: receipt.image.cssWidth,
    cssHeight: receipt.image.cssHeight,
    physicalWidth: receipt.image.physicalWidth,
    physicalHeight: receipt.image.physicalHeight,
    dpr: receipt.image.dpr,
    networkDependent: receipt.networkDependent,
  };
}

function runtimeIdentity(
  receipt: TileflowCaptureReceiptV4,
): Pick<TileflowCaptureReceiptV4, 'renderer' | 'platform'> {
  return {renderer: receipt.renderer, platform: receipt.platform};
}

function reviewStatus(input: {
  dataMatch: boolean;
  dimensionsMatch: boolean;
  frameMatch: boolean;
  rendererMatch: boolean;
}): TileflowVisualReviewStatus {
  if (!input.frameMatch) return 'frame-mismatch';
  if (!input.dimensionsMatch) return 'dimensions-mismatch';
  if (!input.rendererMatch) return 'runtime-mismatch';
  if (!input.dataMatch) return 'data-mismatch';
  return 'comparable';
}

function reviewWarnings(
  status: TileflowVisualReviewStatus,
  left: TileflowCaptureReceiptV4,
  right: TileflowCaptureReceiptV4,
): string[] {
  const warnings: string[] = [];
  if (left.networkDependent) {
    warnings.push('The left capture used remote resources and may not be globally byte-stable.');
  }
  if (right.networkDependent) {
    warnings.push('The right capture used remote resources and may not be globally byte-stable.');
  }
  if (left.verification.style !== 'rendered' || right.verification.style !== 'rendered') {
    warnings.push(
      'At least one application capture has expected-but-unverified style and data identity.',
    );
  }
  if (status === 'frame-mismatch') {
    warnings.push('The review frames differ; pixel metrics and contextual diff were not computed.');
  } else if (status === 'dimensions-mismatch') {
    warnings.push(
      'The rendered dimensions differ; pixel metrics and contextual diff were not computed.',
    );
  } else if (status === 'runtime-mismatch') {
    warnings.push(
      'The renderer runtimes differ; pixel metrics and contextual diff were not computed.',
    );
  } else if (status === 'data-mismatch') {
    warnings.push(
      'The exact data identities differ; pixel metrics and contextual diff were not computed.',
    );
  } else {
    warnings.push(
      'Pixel metrics and the contextual diff describe two deliberate renders; they do not approve either image or create a baseline.',
    );
  }
  return [...new Set(warnings)].sort(compareCodeUnits);
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidReview(message: string, cause?: unknown): TileflowVisualReviewError {
  return new TileflowVisualReviewError(message, cause === undefined ? undefined : {cause});
}
