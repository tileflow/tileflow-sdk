import pixelmatch from 'pixelmatch';
import {types as nodeUtilTypes} from 'node:util';
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
  type TileflowCaptureDataIdentityV2,
  type TileflowCaptureDataIdentityV3,
  type TileflowCaptureReceipt,
  type TileflowCaptureReceiptV4,
  validateTileflowCaptureReceipt,
} from './receipt';
import {readPngDimensions} from './standalone';

export const tileflowVisualComparisonSchemaVersion = 1 as const;
export const tileflowVisualAnalysisSchemaVersion = 1 as const;
export const tileflowVisualPerceptualThreshold = 0.1;
/** Fixed linear-luminance difference used to classify adjacent pixel pairs as edges. */
export const tileflowVisualEdgeThreshold = 0.05;
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

/** One bounded region in physical PNG pixels, relative to the top-left corner. */
export type TileflowVisualRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TileflowVisualAppearanceStatistics = {
  mean: number;
  percentiles: {
    p10: number;
    p50: number;
    p90: number;
  };
};

export type TileflowVisualAppearanceProfile = {
  /** WCAG relative luminance after compositing transparent pixels on white, in [0, 1]. */
  linearLuminance: TileflowVisualAppearanceStatistics;
  /** Perceptual OKLab L after compositing transparent pixels on white, in [0, 1]. */
  oklabLightness: TileflowVisualAppearanceStatistics;
  /** Perceptual OKLab chroma after compositing transparent pixels on white. */
  oklabChroma: TileflowVisualAppearanceStatistics;
  /** Ratio of horizontal/vertical neighbor pairs crossing tileflowVisualEdgeThreshold. */
  edgeDensity: number;
  /** Mean absolute linear-luminance difference across horizontal/vertical neighbor pairs. */
  localContrast: number;
};

/** Signed, field-for-field subtraction between two reported appearance profiles. */
export type TileflowVisualAppearanceDelta = TileflowVisualAppearanceProfile;

export type TileflowVisualReferenceAppearance = {
  region: TileflowVisualRegion;
  reference: TileflowVisualAppearanceProfile;
  actual: TileflowVisualAppearanceProfile;
  /** Every value is actual minus reference; negative values mean the actual is lower. */
  actualMinusReference: TileflowVisualAppearanceDelta;
};

export type TileflowVisualReviewAppearance = {
  region: TileflowVisualRegion;
  left: TileflowVisualAppearanceProfile;
  right: TileflowVisualAppearanceProfile;
  /** Every value is right minus left; negative values mean the right side is lower. */
  rightMinusLeft: TileflowVisualAppearanceDelta;
};

export type TileflowVisualReferenceAnalysisOptions = {
  /** Restrict appearance metrics to one bounded rectangle in physical PNG pixels. */
  region?: TileflowVisualRegion;
};

export type TileflowVisualReferenceAnalysis = {
  schemaVersion: 1;
  scene: string;
  map: string;
  theme: string;
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
  appearance: TileflowVisualReferenceAppearance | null;
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

type TileflowVisualPngRole = 'actual' | 'baseline' | 'left' | 'reference' | 'right';

export type TileflowVisualReviewImageAnalysis = {
  left: {
    sha256: string;
    physicalWidth: number;
    physicalHeight: number;
    palette: TileflowVisualPaletteColor[];
  };
  right: {
    sha256: string;
    physicalWidth: number;
    physicalHeight: number;
    palette: TileflowVisualPaletteColor[];
  };
  exact: TileflowVisualPixelMetric | null;
  perceptual: (TileflowVisualPixelMetric & {threshold: number}) | null;
  meanAbsoluteChannelDifference: number | null;
  appearance: TileflowVisualReviewAppearance | null;
  diffPng?: Uint8Array;
};

/** Internal review primitive: authenticate both images before optionally comparing their pixels. */
export async function analyzeTileflowCapturePairForReview(
  left: {png: Uint8Array; receipt: TileflowCaptureReceiptV4},
  right: {png: Uint8Array; receipt: TileflowCaptureReceiptV4},
  options: {comparePixels: boolean; includeDiff: boolean; region?: TileflowVisualRegion},
): Promise<TileflowVisualReviewImageAnalysis> {
  if (options.region) {
    resolveTileflowVisualRegion(
      options.region,
      left.receipt.image.physicalWidth,
      left.receipt.image.physicalHeight,
    );
    resolveTileflowVisualRegion(
      options.region,
      right.receipt.image.physicalWidth,
      right.receipt.image.physicalHeight,
    );
  }
  if (!options.comparePixels) {
    // Authenticate sequentially so an incompatible review never retains two decoded RGBA buffers.
    const leftIdentity = await inspectPngAgainstReceipt(left.png, left.receipt, 'left');
    const rightIdentity = await inspectPngAgainstReceipt(right.png, right.receipt, 'right');
    return {
      left: leftIdentity,
      right: rightIdentity,
      exact: null,
      perceptual: null,
      meanAbsoluteChannelDifference: null,
      appearance: null,
    };
  }

  const leftImage = await validatePngAgainstReceipt(left.png, left.receipt, 'left');
  const rightImage = await validatePngAgainstReceipt(right.png, right.receipt, 'right');
  if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
    throw invalidBaseline('Comparable review PNGs did not decode to equal dimensions.');
  }

  const totalPixels = leftImage.width * leftImage.height;
  const region = resolveTileflowVisualRegion(options.region, leftImage.width, leftImage.height);
  const appearance = createTileflowVisualReviewAppearance(leftImage, rightImage, region);
  const exactChangedPixels = countExactChangedPixels(leftImage.data, rightImage.data);
  const diffData = options.includeDiff ? new Uint8Array(totalPixels * 4) : undefined;
  const perceptualChangedPixels = pixelmatch(
    leftImage.data,
    rightImage.data,
    diffData,
    leftImage.width,
    leftImage.height,
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
    left: reviewImageAnalysisIdentity(leftImage, left.receipt),
    right: reviewImageAnalysisIdentity(rightImage, right.receipt),
    exact: pixelMetric(exactChangedPixels, totalPixels),
    perceptual: {
      threshold: tileflowVisualPerceptualThreshold,
      ...pixelMetric(perceptualChangedPixels, totalPixels),
    },
    meanAbsoluteChannelDifference: meanAbsoluteChannelDifference(leftImage.data, rightImage.data),
    appearance,
    ...(diffData ? {diffPng: encodeDiffPng(diffData, leftImage.width, leftImage.height)} : {}),
  };
}

async function inspectPngAgainstReceipt(
  png: Uint8Array,
  receipt: TileflowCaptureReceiptV4,
  role: 'left' | 'right',
): Promise<TileflowVisualReviewImageAnalysis['left']> {
  const image = await validatePngAgainstReceipt(png, receipt, role);
  return reviewImageAnalysisIdentity(image, receipt);
}

function reviewImageAnalysisIdentity(
  image: {data: Uint8Array; height: number; width: number},
  receipt: TileflowCaptureReceiptV4,
): TileflowVisualReviewImageAnalysis['left'] {
  return {
    sha256: receipt.image.sha256,
    physicalWidth: image.width,
    physicalHeight: image.height,
    palette: createQuantizedPalette(image.data),
  };
}

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
  options: TileflowVisualReferenceAnalysisOptions = {},
): Promise<TileflowVisualReferenceAnalysis> {
  const requestedRegion = snapshotTileflowVisualReferenceAnalysisOptions(options);
  const receipt = validateTileflowCaptureReceipt(actualCapture.receipt);
  if (receipt.schemaVersion !== 4) {
    throw invalidBaseline('Visual reference analysis requires a schema-v4 capture receipt.');
  }
  const actualImage = await validatePngAgainstReceipt(actualCapture.png, receipt, 'actual');
  const referenceImage = decodePng(referencePng, 'reference');
  const dimensionsMatch =
    referenceImage.width === actualImage.width && referenceImage.height === actualImage.height;
  if (requestedRegion) {
    resolveTileflowVisualRegion(requestedRegion, referenceImage.width, referenceImage.height);
    resolveTileflowVisualRegion(requestedRegion, actualImage.width, actualImage.height);
  }
  const common = {
    schemaVersion: tileflowVisualAnalysisSchemaVersion,
    scene: receipt.scene.name,
    map: receipt.scene.map,
    theme: receipt.scene.theme,
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
      appearance: null,
      warnings: [
        'The reference and actual PNG dimensions differ; pixel metrics and diff were not computed.',
        ...networkWarnings(undefined, receipt),
      ].sort(compareCodeUnits),
    };
  }

  const totalPixels = actualImage.width * actualImage.height;
  const region = resolveTileflowVisualRegion(
    requestedRegion,
    actualImage.width,
    actualImage.height,
  );
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
    appearance: createTileflowVisualReferenceAppearance(referenceImage, actualImage, region),
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

const appearanceHistogramSteps = 4_096;
const maximumOklabChroma = 0.5;

type DecodedVisualPng = {
  data: Uint8Array;
  width: number;
  height: number;
};

type AppearanceHistogram = {
  counts: Uint32Array;
  maximum: number;
};

function createTileflowVisualReferenceAppearance(
  reference: DecodedVisualPng,
  actual: DecodedVisualPng,
  region: TileflowVisualRegion,
): TileflowVisualReferenceAppearance {
  const referenceProfile = createAppearanceProfile(reference, region);
  const actualProfile = createAppearanceProfile(actual, region);
  return {
    region,
    reference: referenceProfile,
    actual: actualProfile,
    actualMinusReference: subtractAppearanceProfiles(actualProfile, referenceProfile),
  };
}

function createTileflowVisualReviewAppearance(
  left: DecodedVisualPng,
  right: DecodedVisualPng,
  region: TileflowVisualRegion,
): TileflowVisualReviewAppearance {
  const leftProfile = createAppearanceProfile(left, region);
  const rightProfile = createAppearanceProfile(right, region);
  return {
    region,
    left: leftProfile,
    right: rightProfile,
    rightMinusLeft: subtractAppearanceProfiles(rightProfile, leftProfile),
  };
}

function createAppearanceProfile(
  image: DecodedVisualPng,
  region: TileflowVisualRegion,
): TileflowVisualAppearanceProfile {
  const linearLuminanceHistogram = createAppearanceHistogram(1);
  const oklabLightnessHistogram = createAppearanceHistogram(1);
  const oklabChromaHistogram = createAppearanceHistogram(maximumOklabChroma);
  const previousRow = new Float64Array(region.width);
  const totalPixels = region.width * region.height;
  let linearLuminanceSum = 0;
  let oklabLightnessSum = 0;
  let oklabChromaSum = 0;
  let neighborCount = 0;
  let edgeCount = 0;
  let localContrastSum = 0;

  for (let localY = 0; localY < region.height; localY += 1) {
    const y = region.y + localY;
    let leftLuminance = 0;
    for (let localX = 0; localX < region.width; localX += 1) {
      const x = region.x + localX;
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]! / 255;
      const red = srgbToLinear(compositeSrgbOnWhite(image.data[offset]!, alpha));
      const green = srgbToLinear(compositeSrgbOnWhite(image.data[offset + 1]!, alpha));
      const blue = srgbToLinear(compositeSrgbOnWhite(image.data[offset + 2]!, alpha));
      const linearLuminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const [oklabLightness, oklabA, oklabB] = linearSrgbToOklab(red, green, blue);
      const oklabChroma = Math.hypot(oklabA, oklabB);

      linearLuminanceSum += linearLuminance;
      oklabLightnessSum += oklabLightness;
      oklabChromaSum += oklabChroma;
      addAppearanceHistogramValue(linearLuminanceHistogram, linearLuminance);
      addAppearanceHistogramValue(oklabLightnessHistogram, oklabLightness);
      addAppearanceHistogramValue(oklabChromaHistogram, oklabChroma);

      if (localX > 0) {
        const difference = Math.abs(linearLuminance - leftLuminance);
        localContrastSum += difference;
        neighborCount += 1;
        if (difference >= tileflowVisualEdgeThreshold) edgeCount += 1;
      }
      if (localY > 0) {
        const difference = Math.abs(linearLuminance - previousRow[localX]!);
        localContrastSum += difference;
        neighborCount += 1;
        if (difference >= tileflowVisualEdgeThreshold) edgeCount += 1;
      }
      leftLuminance = linearLuminance;
      previousRow[localX] = linearLuminance;
    }
  }

  return {
    linearLuminance: appearanceStatistics(
      linearLuminanceSum,
      totalPixels,
      linearLuminanceHistogram,
    ),
    oklabLightness: appearanceStatistics(oklabLightnessSum, totalPixels, oklabLightnessHistogram),
    oklabChroma: appearanceStatistics(oklabChromaSum, totalPixels, oklabChromaHistogram),
    edgeDensity: roundAppearanceMetric(neighborCount === 0 ? 0 : edgeCount / neighborCount),
    localContrast: roundAppearanceMetric(
      neighborCount === 0 ? 0 : localContrastSum / neighborCount,
    ),
  };
}

function createAppearanceHistogram(maximum: number): AppearanceHistogram {
  return {counts: new Uint32Array(appearanceHistogramSteps + 1), maximum};
}

function addAppearanceHistogramValue(histogram: AppearanceHistogram, value: number): void {
  const normalized = Math.max(0, Math.min(1, value / histogram.maximum));
  histogram.counts[Math.round(normalized * appearanceHistogramSteps)]! += 1;
}

function appearanceStatistics(
  sum: number,
  total: number,
  histogram: AppearanceHistogram,
): TileflowVisualAppearanceStatistics {
  return {
    mean: roundAppearanceMetric(sum / total),
    percentiles: {
      p10: appearancePercentile(histogram, total, 0.1),
      p50: appearancePercentile(histogram, total, 0.5),
      p90: appearancePercentile(histogram, total, 0.9),
    },
  };
}

function appearancePercentile(
  histogram: AppearanceHistogram,
  total: number,
  percentile: number,
): number {
  const position = (total - 1) * percentile;
  const lowerRank = Math.floor(position);
  const upperRank = Math.ceil(position);
  const lower = appearanceHistogramValueAtRank(histogram, lowerRank);
  const upper = appearanceHistogramValueAtRank(histogram, upperRank);
  return roundAppearanceMetric(lower + (upper - lower) * (position - lowerRank));
}

function appearanceHistogramValueAtRank(histogram: AppearanceHistogram, rank: number): number {
  let cumulative = 0;
  for (let index = 0; index < histogram.counts.length; index += 1) {
    cumulative += histogram.counts[index]!;
    if (cumulative > rank) {
      return (index / appearanceHistogramSteps) * histogram.maximum;
    }
  }
  return histogram.maximum;
}

function subtractAppearanceProfiles(
  minuend: TileflowVisualAppearanceProfile,
  subtrahend: TileflowVisualAppearanceProfile,
): TileflowVisualAppearanceDelta {
  return {
    linearLuminance: subtractAppearanceStatistics(
      minuend.linearLuminance,
      subtrahend.linearLuminance,
    ),
    oklabLightness: subtractAppearanceStatistics(minuend.oklabLightness, subtrahend.oklabLightness),
    oklabChroma: subtractAppearanceStatistics(minuend.oklabChroma, subtrahend.oklabChroma),
    edgeDensity: subtractAppearanceMetric(minuend.edgeDensity, subtrahend.edgeDensity),
    localContrast: subtractAppearanceMetric(minuend.localContrast, subtrahend.localContrast),
  };
}

function subtractAppearanceStatistics(
  minuend: TileflowVisualAppearanceStatistics,
  subtrahend: TileflowVisualAppearanceStatistics,
): TileflowVisualAppearanceStatistics {
  return {
    mean: subtractAppearanceMetric(minuend.mean, subtrahend.mean),
    percentiles: {
      p10: subtractAppearanceMetric(minuend.percentiles.p10, subtrahend.percentiles.p10),
      p50: subtractAppearanceMetric(minuend.percentiles.p50, subtrahend.percentiles.p50),
      p90: subtractAppearanceMetric(minuend.percentiles.p90, subtrahend.percentiles.p90),
    },
  };
}

function subtractAppearanceMetric(minuend: number, subtrahend: number): number {
  return roundAppearanceMetric(minuend - subtrahend);
}

function roundAppearanceMetric(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compositeSrgbOnWhite(channel: number, alpha: number): number {
  return (channel / 255) * alpha + (1 - alpha);
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearSrgbToOklab(
  red: number,
  green: number,
  blue: number,
): [lightness: number, a: number, b: number] {
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function snapshotTileflowVisualReferenceAnalysisOptions(
  options: TileflowVisualReferenceAnalysisOptions,
): TileflowVisualRegion | undefined {
  const record = requirePlainVisualRecord(options, 'Visual reference analysis options');
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'region')) {
    throw invalidBaseline('Visual reference analysis options contain unsupported fields.');
  }
  return record.region === undefined
    ? undefined
    : snapshotTileflowVisualRegion(record.region, 'Visual reference analysis region');
}

function snapshotTileflowVisualRegion(value: unknown, label: string): TileflowVisualRegion {
  const record = requirePlainVisualRecord(value, label);
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    keys.some((key) => key !== 'x' && key !== 'y' && key !== 'width' && key !== 'height')
  ) {
    throw invalidBaseline(`${label} must contain exactly x, y, width, and height.`);
  }
  return {
    x: record.x as number,
    y: record.y as number,
    width: record.width as number,
    height: record.height as number,
  };
}

function requirePlainVisualRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeUtilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidBaseline(`${label} must be a plain data object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      throw invalidBaseline(`${label} must not contain symbol fields.`);
    }
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor) || !descriptor.enumerable) {
      throw invalidBaseline(`${label} must not contain accessors or hidden fields.`);
    }
    entries.push([key, descriptor.value]);
  }
  return Object.fromEntries(entries);
}

function resolveTileflowVisualRegion(
  requested: TileflowVisualRegion | undefined,
  physicalWidth: number,
  physicalHeight: number,
): TileflowVisualRegion {
  const region = requested ?? {x: 0, y: 0, width: physicalWidth, height: physicalHeight};
  if (
    !Number.isSafeInteger(region.x) ||
    !Number.isSafeInteger(region.y) ||
    !Number.isSafeInteger(region.width) ||
    !Number.isSafeInteger(region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x > physicalWidth - region.width ||
    region.y > physicalHeight - region.height
  ) {
    throw invalidBaseline(
      'The visual region must be a positive integer rectangle within the physical PNG bounds.',
    );
  }
  return {...region};
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
    sameDataIdentity(baseline.data, actual.data)
  );
}

function sameDataIdentity(
  baseline: TileflowCaptureDataIdentityV2 | TileflowCaptureDataIdentityV3,
  actual: TileflowCaptureDataIdentityV2 | TileflowCaptureDataIdentityV3,
): boolean {
  if (
    baseline.kind !== actual.kind ||
    baseline.schema !== actual.schema ||
    baseline.schemaVersion !== actual.schemaVersion ||
    baseline.sourceId !== actual.sourceId
  ) {
    return false;
  }
  const baselineExactWorld = exactWorldIdentity(baseline);
  const actualExactWorld = exactWorldIdentity(actual);
  if (baselineExactWorld || actualExactWorld) {
    if (!baselineExactWorld || !actualExactWorld) return false;
    return (
      baselineExactWorld.product === actualExactWorld.product &&
      baselineExactWorld.releaseId === actualExactWorld.releaseId &&
      baselineExactWorld.descriptorSha256 === actualExactWorld.descriptorSha256 &&
      baselineExactWorld.archiveSha256 === actualExactWorld.archiveSha256 &&
      baselineExactWorld.dataContractSha256 === actualExactWorld.dataContractSha256 &&
      baselineExactWorld.contractSha256 === actualExactWorld.contractSha256 &&
      sameOptionalSemantics(baselineExactWorld.semantics, actualExactWorld.semantics)
    );
  }
  const baselineLegacy = baseline as TileflowCaptureDataIdentityV2;
  const actualLegacy = actual as TileflowCaptureDataIdentityV2;
  if (
    baselineLegacy.generation !== actualLegacy.generation ||
    baselineLegacy.revision !== actualLegacy.revision ||
    !sameOptionalSemantics(baselineLegacy.semantics, actualLegacy.semantics)
  ) {
    return false;
  }
  if (
    baselineLegacy.source &&
    (!actualLegacy.source ||
      baselineLegacy.source.kind !== actualLegacy.source.kind ||
      baselineLegacy.source.sha256 !== actualLegacy.source.sha256)
  ) {
    return false;
  }
  if (
    baselineLegacy.capabilities &&
    (!actualLegacy.capabilities ||
      !isRecordSubset(baselineLegacy.capabilities, actualLegacy.capabilities))
  ) {
    return false;
  }
  if (baselineLegacy.bindings) {
    if (!actualLegacy.bindings) return false;
    if (
      !isRecordSubset(baselineLegacy.bindings.fields, actualLegacy.bindings.fields) ||
      !isRecordSubset(baselineLegacy.bindings.layers, actualLegacy.bindings.layers)
    ) {
      return false;
    }
  }
  return true;
}

function exactWorldIdentity(
  value: TileflowCaptureDataIdentityV2 | TileflowCaptureDataIdentityV3,
): Extract<TileflowCaptureDataIdentityV3, {kind: 'tileflow-world'}> | undefined {
  return value.kind === 'tileflow-world' && 'product' in value
    ? (value as Extract<TileflowCaptureDataIdentityV3, {kind: 'tileflow-world'}>)
    : undefined;
}

function sameOptionalSemantics(
  baseline: {parkLayer: string} | undefined,
  actual: {parkLayer: string} | undefined,
): boolean {
  return baseline === undefined || baseline.parkLayer === actual?.parkLayer;
}

function isRecordSubset(
  baseline: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(baseline).every(([key, value]) => actual[key] === value);
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
