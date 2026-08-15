import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';
import {
  compareCodeUnits,
  serializeCanonicalJson,
  sha256Hex,
  tileflowCaptureSceneLimits,
} from '@tileflow/core';
import type {TileflowCapture} from './capture';
import {TileflowCaptureError} from './errors';
import {
  parseTileflowCaptureReceipt,
  type TileflowCaptureReceipt,
  validateTileflowCaptureReceipt,
} from './receipt';
import {readPngDimensions} from './standalone';

export const tileflowVisualComparisonSchemaVersion = 1 as const;
export const tileflowVisualAnalysisSchemaVersion = 1 as const;
export const tileflowVisualPerceptualThreshold = 0.1;
export const tileflowVisualArtifactLimits = Object.freeze({
  maximumPngBytes: 256 * 1024 * 1024,
  maximumPaletteColors: 16,
});

export type TileflowVisualComparisonStatus =
  | 'unchanged'
  | 'changed'
  | 'missing-baseline'
  | 'scene-mismatch'
  | 'runtime-mismatch';

export type TileflowVisualPixelMetric = {
  changedPixels: number;
  totalPixels: number;
  ratio: number;
};

export type TileflowVisualImageIdentity = {
  sha256: string;
  cssWidth: number;
  cssHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  dpr: 1 | 2;
  networkDependent: boolean;
};

export type TileflowVisualSceneIdentity = TileflowCaptureReceipt['scene'];
export type TileflowVisualRuntimeIdentity = Pick<TileflowCaptureReceipt, 'renderer' | 'platform'>;

export type TileflowVisualComparison = {
  schemaVersion: 1;
  scene: string;
  map: string;
  target: 'map' | 'application';
  status: TileflowVisualComparisonStatus;
  changeKind: 'pixels' | 'dimensions' | null;
  baselineScene: TileflowVisualSceneIdentity | null;
  actualScene: TileflowVisualSceneIdentity;
  baselineRuntime: TileflowVisualRuntimeIdentity | null;
  actualRuntime: TileflowVisualRuntimeIdentity;
  baseline: TileflowVisualImageIdentity | null;
  actual: TileflowVisualImageIdentity;
  dimensionsMatch: boolean | null;
  exact: TileflowVisualPixelMetric | null;
  perceptual: (TileflowVisualPixelMetric & {threshold: number}) | null;
  rendererMatch: boolean | null;
  sceneMatch: boolean | null;
  diffPng?: Uint8Array;
  warnings: string[];
};

export type TileflowVisualComparisonDocument = Omit<TileflowVisualComparison, 'diffPng'>;

export type TileflowVisualPaletteColor = {
  color: string;
  count: number;
  ratio: number;
};

export type TileflowVisualReferenceAnalysis = {
  schemaVersion: 1;
  scene: string;
  map: string;
  target: 'map' | 'application';
  dimensionsMatch: boolean;
  reference: {
    sha256: string;
    physicalWidth: number;
    physicalHeight: number;
    palette: TileflowVisualPaletteColor[];
  };
  actual: {
    sha256: string;
    physicalWidth: number;
    physicalHeight: number;
    palette: TileflowVisualPaletteColor[];
  };
  exact: TileflowVisualPixelMetric | null;
  perceptual: (TileflowVisualPixelMetric & {threshold: number}) | null;
  meanAbsoluteChannelDifference: number | null;
  diffPng?: Uint8Array;
  warnings: string[];
};

export type TileflowVisualReferenceAnalysisDocument = Omit<
  TileflowVisualReferenceAnalysis,
  'diffPng'
>;

export type TileflowVisualBaseline = {
  png: Uint8Array;
  receipt: string | Uint8Array | TileflowCaptureReceipt;
};

type TileflowVisualPngRole = 'actual' | 'baseline' | 'reference';

export function validateTileflowVisualReferencePng(png: Uint8Array): {
  width: number;
  height: number;
} {
  const image = decodePng(png, 'reference');
  return {width: image.width, height: image.height};
}

export async function analyzeTileflowCaptureReference(
  actualCapture: TileflowCapture,
  referencePng: Uint8Array,
): Promise<TileflowVisualReferenceAnalysis> {
  const receipt = validateTileflowCaptureReceipt(actualCapture.receipt);
  const actualImage = await validatePngAgainstReceipt(actualCapture.png, receipt, 'actual');
  const referenceImage = decodePng(referencePng, 'reference');
  const dimensionsMatch =
    referenceImage.width === actualImage.width && referenceImage.height === actualImage.height;
  const common = {
    schemaVersion: tileflowVisualAnalysisSchemaVersion,
    scene: receipt.scene.name,
    map: receipt.scene.map,
    target: receipt.scene.target,
    dimensionsMatch,
    reference: {
      sha256: await sha256Hex(referencePng),
      physicalWidth: referenceImage.width,
      physicalHeight: referenceImage.height,
      palette: createQuantizedPalette(referenceImage.data),
    },
    actual: {
      sha256: receipt.image.sha256,
      physicalWidth: actualImage.width,
      physicalHeight: actualImage.height,
      palette: createQuantizedPalette(actualImage.data),
    },
  } as const;

  if (!dimensionsMatch) {
    return {
      ...common,
      exact: null,
      perceptual: null,
      meanAbsoluteChannelDifference: null,
      warnings: [
        'The reference and actual PNG dimensions differ; pixel metrics and diff were not computed.',
        ...networkWarnings(undefined, receipt),
      ].sort(compareCodeUnits),
    };
  }

  const totalPixels = actualImage.width * actualImage.height;
  const exactChangedPixels = countExactChangedPixels(referenceImage.data, actualImage.data);
  const diffData = new Uint8Array(totalPixels * 4);
  const perceptualChangedPixels = pixelmatch(
    referenceImage.data,
    actualImage.data,
    diffData,
    actualImage.width,
    actualImage.height,
    {
      checkerboard: true,
      diffColor: [255, 0, 255],
      diffColorAlt: [0, 255, 255],
      diffMask: true,
      includeAA: true,
      threshold: tileflowVisualPerceptualThreshold,
    },
  );

  return {
    ...common,
    exact: pixelMetric(exactChangedPixels, totalPixels),
    perceptual: {
      threshold: tileflowVisualPerceptualThreshold,
      ...pixelMetric(perceptualChangedPixels, totalPixels),
    },
    meanAbsoluteChannelDifference: meanAbsoluteChannelDifference(
      referenceImage.data,
      actualImage.data,
    ),
    diffPng: encodeDiffPng(diffData, actualImage.width, actualImage.height),
    warnings: networkWarnings(undefined, receipt),
  };
}

export function createTileflowVisualReferenceAnalysisDocument(
  analysis: TileflowVisualReferenceAnalysis,
): TileflowVisualReferenceAnalysisDocument {
  const {diffPng: _diffPng, ...document} = analysis;
  return document;
}

export async function compareTileflowCaptureToBaseline(
  actualCapture: TileflowCapture,
  baseline?: TileflowVisualBaseline,
): Promise<TileflowVisualComparison> {
  const actualReceipt = validateTileflowCaptureReceipt(actualCapture.receipt);
  const actual = imageIdentity(actualReceipt);
  const common = {
    schemaVersion: tileflowVisualComparisonSchemaVersion,
    scene: actualReceipt.scene.name,
    map: actualReceipt.scene.map,
    target: actualReceipt.scene.target,
    actual,
    actualScene: actualReceipt.scene,
    actualRuntime: runtimeIdentity(actualReceipt),
  } as const;
  const actualImage = await validatePngAgainstReceipt(actualCapture.png, actualReceipt, 'actual');

  if (!baseline) {
    return {
      ...common,
      status: 'missing-baseline',
      changeKind: null,
      baselineScene: null,
      baselineRuntime: null,
      baseline: null,
      dimensionsMatch: null,
      exact: null,
      perceptual: null,
      rendererMatch: null,
      sceneMatch: null,
      warnings: networkWarnings(undefined, actualReceipt),
    };
  }

  const baselineReceipt =
    typeof baseline.receipt === 'string' || baseline.receipt instanceof Uint8Array
      ? parseTileflowCaptureReceipt(baseline.receipt)
      : validateTileflowCaptureReceipt(baseline.receipt);
  const baselineImage = await validatePngAgainstReceipt(baseline.png, baselineReceipt, 'baseline');
  const baselineIdentity = imageIdentity(baselineReceipt);
  const baselineScene = baselineReceipt.scene;
  const baselineRuntime = runtimeIdentity(baselineReceipt);
  const warnings = networkWarnings(baselineReceipt, actualReceipt);
  const sceneMatch = sameSceneIdentity(baselineReceipt, actualReceipt);

  if (!sceneMatch) {
    return {
      ...common,
      status: 'scene-mismatch',
      changeKind: null,
      baselineScene,
      baselineRuntime,
      baseline: baselineIdentity,
      dimensionsMatch: null,
      exact: null,
      perceptual: null,
      rendererMatch: null,
      sceneMatch: false,
      warnings,
    };
  }

  const rendererMatch = sameRuntimeIdentity(baselineReceipt, actualReceipt);
  if (!rendererMatch) {
    return {
      ...common,
      status: 'runtime-mismatch',
      changeKind: null,
      baselineScene,
      baselineRuntime,
      baseline: baselineIdentity,
      dimensionsMatch: null,
      exact: null,
      perceptual: null,
      rendererMatch: false,
      sceneMatch: true,
      warnings,
    };
  }

  const dimensionsMatch =
    baselineReceipt.image.physicalWidth === actualReceipt.image.physicalWidth &&
    baselineReceipt.image.physicalHeight === actualReceipt.image.physicalHeight;
  if (!dimensionsMatch) {
    const diffWidth = Math.max(
      baselineReceipt.image.physicalWidth,
      actualReceipt.image.physicalWidth,
    );
    const diffHeight = Math.max(
      baselineReceipt.image.physicalHeight,
      actualReceipt.image.physicalHeight,
    );
    const boundedWidth =
      diffWidth * diffHeight <= tileflowCaptureSceneLimits.maximumPhysicalPixels
        ? diffWidth
        : actualReceipt.image.physicalWidth;
    const boundedHeight =
      diffWidth * diffHeight <= tileflowCaptureSceneLimits.maximumPhysicalPixels
        ? diffHeight
        : actualReceipt.image.physicalHeight;
    return {
      ...common,
      status: 'changed',
      changeKind: 'dimensions',
      baselineScene,
      baselineRuntime,
      baseline: baselineIdentity,
      dimensionsMatch: false,
      exact: null,
      perceptual: null,
      rendererMatch: true,
      sceneMatch: true,
      diffPng: encodeSolidDiffPng(boundedWidth, boundedHeight),
      warnings: [
        ...warnings,
        'The PNG dimensions differ; exact and perceptual pixel metrics were not computed.',
      ].sort(compareCodeUnits),
    };
  }

  const width = actualImage.width;
  const height = actualImage.height;
  const totalPixels = width * height;
  const exactChangedPixels = countExactChangedPixels(baselineImage.data, actualImage.data);
  const diffData = new Uint8Array(totalPixels * 4);
  const perceptualChangedPixels = pixelmatch(
    baselineImage.data,
    actualImage.data,
    diffData,
    width,
    height,
    {
      checkerboard: true,
      diffColor: [255, 0, 255],
      diffColorAlt: [0, 255, 255],
      diffMask: true,
      includeAA: true,
      threshold: tileflowVisualPerceptualThreshold,
    },
  );
  const status = exactChangedPixels === 0 ? 'unchanged' : 'changed';

  return {
    ...common,
    status,
    changeKind: status === 'changed' ? 'pixels' : null,
    baselineScene,
    baselineRuntime,
    baseline: baselineIdentity,
    dimensionsMatch: true,
    exact: pixelMetric(exactChangedPixels, totalPixels),
    perceptual: {
      threshold: tileflowVisualPerceptualThreshold,
      ...pixelMetric(perceptualChangedPixels, totalPixels),
    },
    rendererMatch: true,
    sceneMatch: true,
    diffPng: encodeDiffPng(diffData, width, height),
    warnings,
  };
}

export function createTileflowVisualComparisonDocument(
  comparison: TileflowVisualComparison,
): TileflowVisualComparisonDocument {
  const {diffPng: _diffPng, ...document} = comparison;
  return document;
}

export function serializeTileflowVisualComparison(
  comparison: TileflowVisualComparison | TileflowVisualComparisonDocument,
): string {
  return `${serializeCanonicalJson(createTileflowVisualComparisonDocument(comparison))}\n`;
}

function imageIdentity(receipt: TileflowCaptureReceipt): TileflowVisualImageIdentity {
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

function runtimeIdentity(receipt: TileflowCaptureReceipt): TileflowVisualRuntimeIdentity {
  return {renderer: receipt.renderer, platform: receipt.platform};
}

async function validatePngAgainstReceipt(
  png: Uint8Array,
  receipt: TileflowCaptureReceipt,
  role: Exclude<TileflowVisualPngRole, 'reference'>,
) {
  const image = decodePng(png, role);
  if (
    image.width !== receipt.image.physicalWidth ||
    image.height !== receipt.image.physicalHeight
  ) {
    throw invalidBaseline(`The ${role} PNG dimensions do not match its receipt.`);
  }
  if ((await sha256Hex(png)) !== receipt.image.sha256) {
    throw invalidBaseline(`The ${role} PNG hash does not match its receipt.`);
  }
  return image;
}

function preflightPng(png: Uint8Array, role: TileflowVisualPngRole) {
  if (png.byteLength > tileflowVisualArtifactLimits.maximumPngBytes) {
    throw invalidBaseline(`The ${role} PNG exceeds the visual artifact byte limit.`);
  }
  let dimensions: {width: number; height: number};
  try {
    dimensions = readPngDimensions(png);
  } catch (error) {
    throw invalidBaseline(`The ${role} image is not a valid PNG.`, error);
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    png.byteLength < 29 ||
    view.getUint32(8) !== 13 ||
    png[12] !== 73 ||
    png[13] !== 72 ||
    png[14] !== 68 ||
    png[15] !== 82
  ) {
    throw invalidBaseline(`The ${role} image does not begin with a canonical PNG header.`);
  }
  if (png[28] !== 0) {
    throw invalidBaseline(
      `The ${role} PNG is interlaced and cannot be decoded within fixed bounds.`,
    );
  }
  if (
    dimensions.width > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    dimensions.height > tileflowCaptureSceneLimits.viewport.maximum * 2 ||
    dimensions.width * dimensions.height > tileflowCaptureSceneLimits.maximumPhysicalPixels
  ) {
    throw invalidBaseline(`The ${role} PNG exceeds the visual pixel limit.`);
  }
  return dimensions;
}

function decodePng(png: Uint8Array, role: TileflowVisualPngRole) {
  preflightPng(png, role);
  try {
    const decoded = PNG.sync.read(Buffer.from(png), {checkCRC: true, skipRescale: false});
    if (decoded.data.byteLength !== decoded.width * decoded.height * 4) {
      throw new Error('Decoded PNG did not produce bounded RGBA pixels.');
    }
    return decoded;
  } catch (error) {
    throw invalidBaseline(`The ${role} PNG could not be decoded safely.`, error);
  }
}

function encodeDiffPng(data: Uint8Array, width: number, height: number): Uint8Array {
  const image = new PNG({height, width});
  image.data = Buffer.from(data);
  return new Uint8Array(
    PNG.sync.write(image, {
      bitDepth: 8,
      colorType: 6,
      deflateLevel: 9,
      deflateStrategy: 3,
      filterType: 4,
      inputColorType: 6,
      inputHasAlpha: true,
    }),
  );
}

function encodeSolidDiffPng(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    data.set([255, 0, 255, 255], offset);
  }
  return encodeDiffPng(data, width, height);
}

function countExactChangedPixels(left: Uint8Array, right: Uint8Array): number {
  if (left.byteLength !== right.byteLength || left.byteLength % 4 !== 0) {
    throw invalidBaseline('Comparable PNGs did not decode to equal RGBA dimensions.');
  }
  let changed = 0;
  for (let index = 0; index < left.byteLength; index += 4) {
    if (
      left[index] !== right[index] ||
      left[index + 1] !== right[index + 1] ||
      left[index + 2] !== right[index + 2] ||
      left[index + 3] !== right[index + 3]
    ) {
      changed += 1;
    }
  }
  return changed;
}

function createQuantizedPalette(data: Uint8Array): TileflowVisualPaletteColor[] {
  if (data.byteLength === 0 || data.byteLength % 4 !== 0) {
    throw invalidBaseline('The decoded PNG did not contain bounded RGBA pixels.');
  }
  const counts = new Map<string, number>();
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    const alpha = data[offset + 3]!;
    const red = compositeOnWhite(data[offset]!, alpha);
    const green = compositeOnWhite(data[offset + 1]!, alpha);
    const blue = compositeOnWhite(data[offset + 2]!, alpha);
    const color = `#${quantizeChannel(red)}${quantizeChannel(green)}${quantizeChannel(blue)}`;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const totalPixels = data.byteLength / 4;
  return [...counts]
    .sort((left, right) => right[1] - left[1] || compareCodeUnits(left[0], right[0]))
    .slice(0, tileflowVisualArtifactLimits.maximumPaletteColors)
    .map(([color, count]) => ({color, count, ratio: count / totalPixels}));
}

function compositeOnWhite(channel: number, alpha: number): number {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function quantizeChannel(channel: number): string {
  return (Math.round(channel / 17) * 17).toString(16).padStart(2, '0');
}

function meanAbsoluteChannelDifference(left: Uint8Array, right: Uint8Array): number {
  if (left.byteLength !== right.byteLength || left.byteLength === 0) {
    throw invalidBaseline('Comparable PNGs did not decode to equal RGBA dimensions.');
  }
  let sum = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    sum += Math.abs(left[index]! - right[index]!);
  }
  return Math.round((sum / left.byteLength) * 1_000_000) / 1_000_000;
}

function pixelMetric(changedPixels: number, totalPixels: number): TileflowVisualPixelMetric {
  return {changedPixels, totalPixels, ratio: changedPixels / totalPixels};
}

function sameSceneIdentity(
  baseline: TileflowCaptureReceipt,
  actual: TileflowCaptureReceipt,
): boolean {
  return (
    baseline.scene.name === actual.scene.name &&
    baseline.scene.map === actual.scene.map &&
    baseline.scene.target === actual.scene.target &&
    baseline.scene.sha256 === actual.scene.sha256 &&
    serializeCanonicalJson(baseline.data) === serializeCanonicalJson(actual.data)
  );
}

function sameRuntimeIdentity(
  baseline: TileflowCaptureReceipt,
  actual: TileflowCaptureReceipt,
): boolean {
  return (
    baseline.renderer.tileflow === actual.renderer.tileflow &&
    baseline.renderer.maplibre === actual.renderer.maplibre &&
    baseline.renderer.playwright === actual.renderer.playwright &&
    baseline.renderer.chromiumRevision === actual.renderer.chromiumRevision &&
    baseline.renderer.chromiumVersion === actual.renderer.chromiumVersion &&
    baseline.platform.os === actual.platform.os &&
    baseline.platform.architecture === actual.platform.architecture
  );
}

function networkWarnings(
  baseline: TileflowCaptureReceipt | undefined,
  actual: TileflowCaptureReceipt,
): string[] {
  const warnings: string[] = [];
  if (baseline?.networkDependent) {
    warnings.push('The baseline used remote resources and may not be globally byte-stable.');
  }
  if (actual.networkDependent) {
    warnings.push('The actual capture used remote resources and may not be globally byte-stable.');
  }
  return warnings.sort(compareCodeUnits);
}

function invalidBaseline(message: string, cause?: unknown): TileflowCaptureError {
  return new TileflowCaptureError('BASELINE_INVALID', message, {cause});
}
