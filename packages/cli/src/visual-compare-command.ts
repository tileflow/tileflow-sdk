import type {Command} from 'commander';
import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {basename, dirname, extname, isAbsolute, parse, relative, resolve, sep} from 'node:path';
import {
  compareTileflowCapturesForReview,
  createTileflowCaptureSession,
  createTileflowVisualReviewDocument,
  serializeTileflowCaptureReceipt,
  type TileflowCapture,
  type TileflowCaptureSession,
  tileflowSyntheticAssetOrigin,
  type TileflowVisualReviewDefinition,
  type TileflowVisualReviewDocument,
  type TileflowVisualRegion,
} from '@tileflow/capture';
import {
  compareCodeUnits,
  normalizeTileflowCaptureScene,
  parseTileflowMap,
  resolveThemeSelection,
  tileflowCaptureSceneLimits,
} from '@tileflow/core';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  type TileflowArtifactSession,
  type TileflowArtifactSessionState,
  type TileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';
import {
  installSignalAbortController,
  printCaptureError,
  printInstallProgress,
  relativePath,
} from './capture-command';
import {assertNoSymlinkComponents, assertNotSymlink, writeAtomicFileSet} from './capture-output';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {
  renderTileflowVisualCompareReport,
  tileflowVisualCompareReportLimits,
  type TileflowVisualCompareReportRow,
} from './visual-compare-report';

export const tileflowVisualCompareCommandSchemaVersion = 1 as const;
const tileflowVisualCompareInventorySchemaVersion = 1 as const;
const tileflowVisualCompareInventoryFileName = '.tileflow-visual-compare.json';
const maximumVisualCompareInventoryBytes = 64 * 1024;
export const tileflowVisualCompareLimits = Object.freeze({
  maximumRows: tileflowVisualCompareReportLimits.maximumRows,
  maximumTotalPhysicalPixels: 64 * 1024 * 1024,
});

export type TileflowVisualCompareOptions = {
  againstConfig: string;
  againstMap?: string;
  againstTheme?: string;
  allowDataMismatch?: boolean;
  bearing?: string;
  browserInstall: boolean;
  center: string;
  config: string;
  diff?: boolean;
  dpr?: string;
  force?: boolean;
  height?: string;
  json?: boolean;
  map?: string;
  open?: boolean;
  pitch?: string;
  report?: string;
  region?: string;
  theme?: string;
  watch?: boolean;
  width?: string;
  zoom?: string;
  zooms?: string;
};

export type TileflowVisualCompareSideJsonV1 = {
  config: string;
  label: string;
  map: string;
  theme: string;
};

export type TileflowVisualCompareRowJsonV1 = {
  id: string;
  zoom: number;
  review: TileflowVisualReviewDocument;
  artifacts: {
    diffPath: string | null;
    leftPath: string;
    leftReceiptPath: string;
    rightPath: string;
    rightReceiptPath: string;
  };
};

export type TileflowVisualCompareJsonV1 = {
  schemaVersion: 1;
  command: 'visual.compare';
  left: TileflowVisualCompareSideJsonV1;
  right: TileflowVisualCompareSideJsonV1;
  camera: {
    center: [number, number];
    bearing: number;
    pitch: number;
  };
  viewport: {width: number; height: number; dpr: 1 | 2};
  rows: TileflowVisualCompareRowJsonV1[];
  artifacts: {documentPath: string; reportPath: string};
  warnings: string[];
};

type VisualCompareDependencies = {
  defaultConfigPath: string;
  openReport?: (path: string) => void;
};

type ParsedVisualComparePlan = {
  againstConfig: string;
  againstMap?: string;
  againstTheme?: string;
  allowDataMismatch: boolean;
  browserInstall: boolean;
  camera: {center: [number, number]; bearing: number; pitch: number};
  config: string;
  diff: boolean;
  force: boolean;
  json: boolean;
  map?: string;
  open: boolean;
  output: VisualCompareOutputPlan;
  region?: TileflowVisualRegion;
  theme?: string;
  viewport: {width: number; height: number; dpr: 1 | 2};
  watch: boolean;
  zooms: number[];
};

type VisualCompareOutputPlan = {
  assetDirectory: string;
  boundary: string;
  documentPath: string;
  force: boolean;
  inventoryPath: string;
  managed: boolean;
  previousAssets: VisualCompareInventoryAsset[];
  reportPath: string;
};

type VisualCompareInventoryAsset = {
  path: string;
  sha256: string;
};

type VisualCompareInventoryV1 = {
  schemaVersion: 1;
  kind: 'tileflow-visual-compare-assets';
  assets: Array<{path: string; sha256: string}>;
};

type VisualCompareInputPath = {
  kind: 'directory' | 'file' | 'unknown';
  path: string;
};

type ResolvedVisualCompareSide = {
  config: string;
  label: string;
  map: string;
  theme: string;
};

type VisualCompareSceneRow = {
  id: string;
  leftDefinition: TileflowVisualReviewDefinition;
  rightDefinition: TileflowVisualReviewDefinition;
  scene: string;
  zoom: number;
};

type PreparedVisualCompareOutput = {
  document: TileflowVisualCompareJsonV1;
  files: Array<{path: string; source: string | Uint8Array}>;
  incompatible: boolean;
  nextAssets: VisualCompareInventoryAsset[];
  removePaths: string[];
};

export function registerVisualCompareCommand(
  visual: Command,
  dependencies: VisualCompareDependencies,
): void {
  visual
    .command('compare')
    .description('Review two maps or themes at one synchronized camera without using baselines')
    .requiredOption('--against-config <path>', 'right-hand Tileflow config')
    .requiredOption('--center <lng,lat>', 'shared center camera')
    .option('-c, --config <path>', 'left-hand config path', dependencies.defaultConfigPath)
    .option('--map <name>', 'left map; inferred for a singular config')
    .option('--theme <name>', 'left concrete theme; defaults to the map default')
    .option('--against-map <name>', 'right map; inferred for a singular config')
    .option('--against-theme <name>', 'right concrete theme; defaults to the map default')
    .option('--zoom <number>', 'one shared zoom')
    .option('--zooms <numbers>', 'comma-separated shared zoom matrix')
    .option('--bearing <number>', 'shared bearing', '0')
    .option('--pitch <number>', 'shared pitch', '0')
    .option('--width <pixels>', 'shared viewport width', '1200')
    .option('--height <pixels>', 'shared viewport height', '800')
    .option('--dpr <ratio>', 'shared device pixel ratio: 1 or 2', '1')
    .option('--region <x,y,width,height>', 'shared physical-pixel region for appearance metrics')
    .option('--diff', 'embed and write a contextual pixel diff when identities are comparable')
    .option('--allow-data-mismatch', 'keep exit 0 when exact data identities differ')
    .option('--report <path>', 'offline HTML report', '.tileflow/comparisons/compare.html')
    .option('--force', 'replace different explicitly requested report artifacts')
    .option('--open', 'open the report after the first successful generation')
    .option('--watch', 'watch both configs and preserve the last valid report')
    .option('--json', 'print deterministic JSON, or NDJSON while watching')
    .option('--no-browser-install', 'fail if the pinned browser is missing')
    .action(async (options: TileflowVisualCompareOptions) => {
      try {
        await runTileflowVisualCompare(options, dependencies);
      } catch (error) {
        printCaptureError(error, {command: 'visual.compare', json: options.json});
        process.exitCode = 1;
      }
    });
}

export async function runTileflowVisualCompare(
  options: TileflowVisualCompareOptions,
  dependencies: VisualCompareDependencies,
): Promise<void> {
  const plan = await parseVisualComparePlan(options);
  if (plan.open && !dependencies.openReport) {
    throw new Error('Opening a visual compare report is unavailable in this CLI integration.');
  }
  if (plan.watch) {
    await withTileflowConfigSecretsHidden(() =>
      runVisualCompareWatch(plan, dependencies.openReport),
    );
    return;
  }

  await withTileflowConfigSecretsHidden(async () => {
    const controller = installSignalAbortController();
    let captureSession: TileflowCaptureSession | undefined;
    try {
      const [leftArtifacts, rightArtifacts] = await createArtifactPair(plan);
      await assertVisualCompareOutputDoesNotOverlapInputs(plan, leftArtifacts, rightArtifacts);
      captureSession = createTileflowCaptureSession({
        allowBrowserInstall: plan.browserInstall,
        cwd: process.cwd(),
        onBrowserInstallProgress: plan.json ? undefined : printInstallProgress,
        signal: controller.signal,
      });
      const prepared = await prepareVisualCompareOutput(
        plan,
        leftArtifacts,
        rightArtifacts,
        captureSession,
        controller.signal,
      );
      await writePreparedVisualCompareOutput(plan.output, prepared);
      printVisualCompareResult(plan, prepared.document);
      if (plan.open) dependencies.openReport?.(plan.output.reportPath);
      if (prepared.incompatible) process.exitCode = 1;
    } finally {
      await captureSession?.close();
      controller.close();
    }
  });
}

export function parseTileflowVisualCompareZooms(
  zoom: string | undefined,
  zooms: string | undefined,
): number[] {
  if (Boolean(zoom) === Boolean(zooms)) {
    throw new Error('Choose exactly one of --zoom or --zooms.');
  }
  const values = zoom === undefined ? zooms!.split(',') : [zoom];
  if (values.length === 0 || values.length > tileflowVisualCompareLimits.maximumRows) {
    throw new Error(
      `Visual compare accepts between 1 and ${tileflowVisualCompareLimits.maximumRows} zooms.`,
    );
  }
  const parsed = values.map((value) => parseFiniteNumber(value.trim(), '--zoom/--zooms'));
  for (const value of parsed) {
    if (
      value < tileflowCaptureSceneLimits.zoom.minimum ||
      value > tileflowCaptureSceneLimits.zoom.maximum
    ) {
      throw new Error('Visual compare zooms must be between 0 and 24.');
    }
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('Visual compare zooms must be unique.');
  }
  return parsed.sort((left, right) => left - right);
}

async function parseVisualComparePlan(
  options: TileflowVisualCompareOptions,
): Promise<ParsedVisualComparePlan> {
  const cwd = process.cwd();
  const zooms = parseTileflowVisualCompareZooms(options.zoom, options.zooms);
  const center = parseTuple(options.center, 2, '--center') as [number, number];
  const bearing = parseFiniteNumber(options.bearing ?? '0', '--bearing');
  const pitch = parseFiniteNumber(options.pitch ?? '0', '--pitch');
  const width = parseInteger(options.width ?? '1200', '--width');
  const height = parseInteger(options.height ?? '800', '--height');
  const dprValue = parseInteger(options.dpr ?? '1', '--dpr');
  if (dprValue !== 1 && dprValue !== 2) throw new Error('--dpr expects 1 or 2.');
  const dpr = dprValue;
  const region =
    options.region === undefined ? undefined : parseTileflowVisualRegion(options.region);

  // Core owns all camera and per-viewport bounds. Normalize one representative definition before
  // compiling either trusted config so invalid exploratory input fails early.
  normalizeTileflowCaptureScene({
    map: 'visual-compare',
    theme: 'default',
    camera: {type: 'center', center, zoom: zooms[0]!, bearing, pitch},
    viewport: {width, height, dpr},
    target: {kind: 'map'},
  });
  if (region) {
    assertTileflowVisualRegionFits(
      region,
      {width: width * dpr, height: height * dpr},
      'shared viewport',
    );
  }
  const totalPhysicalPixels = width * height * dpr * dpr * zooms.length * 2;
  if (totalPhysicalPixels > tileflowVisualCompareLimits.maximumTotalPhysicalPixels) {
    throw new Error('Visual compare exceeds the aggregate physical-pixel limit.');
  }
  const output = await resolveVisualCompareOutput(
    cwd,
    options.report ?? '.tileflow/comparisons/compare.html',
    options.report === undefined || options.report === '.tileflow/comparisons/compare.html',
    Boolean(options.force),
    Boolean(options.watch),
    zooms,
  );
  return {
    againstConfig: options.againstConfig,
    ...(options.againstMap ? {againstMap: options.againstMap} : {}),
    ...(options.againstTheme ? {againstTheme: options.againstTheme} : {}),
    allowDataMismatch: Boolean(options.allowDataMismatch),
    browserInstall: options.browserInstall,
    camera: {center, bearing, pitch},
    config: options.config,
    diff: Boolean(options.diff),
    force: Boolean(options.force),
    json: Boolean(options.json),
    ...(options.map ? {map: options.map} : {}),
    open: Boolean(options.open),
    output,
    ...(region ? {region} : {}),
    ...(options.theme ? {theme: options.theme} : {}),
    viewport: {width, height, dpr},
    watch: Boolean(options.watch),
    zooms,
  };
}

async function createArtifactPair(
  plan: ParsedVisualComparePlan,
): Promise<[TileflowBuildArtifacts, TileflowBuildArtifacts]> {
  const cwd = process.cwd();
  const leftPath = portablePathIdentity(resolve(cwd, plan.config));
  const rightPath = portablePathIdentity(resolve(cwd, plan.againstConfig));
  const left = await createTileflowBuildArtifacts({
    assetBaseUrl: tileflowSyntheticAssetOrigin,
    config: plan.config,
    cwd,
  });
  if (leftPath === rightPath) return [left, left];
  const right = await createTileflowBuildArtifacts({
    assetBaseUrl: tileflowSyntheticAssetOrigin,
    config: plan.againstConfig,
    cwd,
  });
  return [left, right];
}

async function prepareVisualCompareOutput(
  plan: ParsedVisualComparePlan,
  leftArtifacts: TileflowBuildArtifacts,
  rightArtifacts: TileflowBuildArtifacts,
  captureSession: TileflowCaptureSession,
  signal?: AbortSignal,
): Promise<PreparedVisualCompareOutput> {
  const cwd = process.cwd();
  const left = resolveVisualCompareSide(leftArtifacts, plan.config, plan.map, plan.theme, 'left');
  const right = resolveVisualCompareSide(
    rightArtifacts,
    plan.againstConfig,
    plan.againstMap,
    plan.againstTheme,
    'right',
  );
  const rows = createVisualCompareRows(plan, left, right);
  const sceneNames = rows.map((row) => row.scene);
  const leftResult = await captureSession.captureArtifacts(
    withVisualCompareScenes(
      leftArtifacts,
      Object.fromEntries(rows.map((row) => [row.scene, row.leftDefinition])),
    ),
    sceneNames,
    signal,
  );
  const rightResult = await captureSession.captureArtifacts(
    withVisualCompareScenes(
      rightArtifacts,
      Object.fromEntries(rows.map((row) => [row.scene, row.rightDefinition])),
    ),
    sceneNames,
    signal,
  );
  const leftCaptures = captureByScene(leftResult.captures);
  const rightCaptures = captureByScene(rightResult.captures);
  const reportRows: TileflowVisualCompareReportRow[] = [];
  const jsonRows: TileflowVisualCompareRowJsonV1[] = [];
  const files: Array<{path: string; source: string | Uint8Array}> = [];
  const removePaths: string[] = [];
  const currentAssets = new Map<string, string | Uint8Array>();
  const warnings = new Set<string>();
  let incompatible = false;
  let embeddedPngBytes = 0;

  for (const [index, row] of rows.entries()) {
    const leftCapture = requireCapture(leftCaptures, row.scene, 'left');
    const rightCapture = requireCapture(rightCaptures, row.scene, 'right');
    const review = await compareTileflowCapturesForReview(
      {capture: leftCapture, definition: row.leftDefinition},
      {capture: rightCapture, definition: row.rightDefinition},
      {includeDiff: plan.diff, ...(plan.region ? {region: plan.region} : {})},
    );
    const reviewDocument = createTileflowVisualReviewDocument(review);
    const allowedDataMismatch = plan.allowDataMismatch && review.status === 'data-mismatch';
    if (review.status !== 'comparable' && !allowedDataMismatch) incompatible = true;
    review.warnings.forEach((warning) => warnings.add(warning));
    const paths = visualCompareRowPaths(plan.output, index, row.zoom, true);
    const rowAssets: Array<{path: string; source: string | Uint8Array}> = [
      {path: paths.leftPath, source: leftCapture.png},
      {path: paths.rightPath, source: rightCapture.png},
      {
        path: paths.leftReceiptPath,
        source: serializeTileflowCaptureReceipt(leftCapture.receipt),
      },
      {
        path: paths.rightReceiptPath,
        source: serializeTileflowCaptureReceipt(rightCapture.receipt),
      },
      ...(paths.diffPath && review.diffPng ? [{path: paths.diffPath, source: review.diffPng}] : []),
    ];
    embeddedPngBytes +=
      leftCapture.png.byteLength + rightCapture.png.byteLength + (review.diffPng?.byteLength ?? 0);
    files.push(...rowAssets);
    rowAssets.forEach((asset) => currentAssets.set(asset.path, asset.source));
    reportRows.push({
      cameraLabel: `${formatCoordinate(plan.camera.center[0])}, ${formatCoordinate(plan.camera.center[1])}`,
      ...(review.diffPng ? {diffPng: review.diffPng} : {}),
      left: {
        label: left.label,
        map: left.map,
        theme: left.theme,
        png: leftCapture.png,
      },
      review: reviewDocument,
      right: {
        label: right.label,
        map: right.map,
        theme: right.theme,
        png: rightCapture.png,
      },
      zoom: row.zoom,
    });
    jsonRows.push({
      id: row.id,
      zoom: row.zoom,
      review: reviewDocument,
      artifacts: {
        diffPath: paths.diffPath && review.diffPng ? relativePath(cwd, paths.diffPath) : null,
        leftPath: relativePath(cwd, paths.leftPath),
        leftReceiptPath: relativePath(cwd, paths.leftReceiptPath),
        rightPath: relativePath(cwd, paths.rightPath),
        rightReceiptPath: relativePath(cwd, paths.rightReceiptPath),
      },
    });
  }
  if (embeddedPngBytes > tileflowVisualCompareReportLimits.maximumEmbeddedPngBytes) {
    throw new Error('Visual compare exceeds the aggregate embedded-PNG limit.');
  }

  const document: TileflowVisualCompareJsonV1 = {
    schemaVersion: tileflowVisualCompareCommandSchemaVersion,
    command: 'visual.compare',
    left: sideJson(left, cwd),
    right: sideJson(right, cwd),
    camera: plan.camera,
    viewport: plan.viewport,
    rows: jsonRows,
    artifacts: {
      documentPath: relativePath(cwd, plan.output.documentPath),
      reportPath: relativePath(cwd, plan.output.reportPath),
    },
    warnings: [...warnings].sort(compareCodeUnits),
  };
  const report = renderTileflowVisualCompareReport({
    generatedBy: 'Tileflow CLI',
    rows: reportRows,
    title: `${left.map} / ${left.theme} ↔ ${right.map} / ${right.theme}`,
  });
  for (const previous of plan.output.previousAssets) {
    if (!currentAssets.has(previous.path)) removePaths.push(previous.path);
  }
  const inventory = createVisualCompareInventory(plan.output.assetDirectory, currentAssets);
  files.push(
    {
      path: plan.output.inventoryPath,
      source: serializeVisualCompareInventory(inventory),
    },
    {path: plan.output.documentPath, source: serializeTileflowVisualCompareJson(document)},
    {path: plan.output.reportPath, source: report},
  );
  const filePaths = new Set(files.map((file) => file.path));
  return {
    document,
    files,
    incompatible,
    nextAssets: inventory.assets.map((asset) => ({
      path: resolve(plan.output.assetDirectory, asset.path),
      sha256: asset.sha256,
    })),
    removePaths: [...new Set(removePaths)].filter((path) => !filePaths.has(path)),
  };
}

async function writePreparedVisualCompareOutput(
  output: VisualCompareOutputPlan,
  prepared: PreparedVisualCompareOutput,
): Promise<void> {
  await writeAtomicFileSet({
    boundaryPath: output.boundary,
    files: prepared.files,
    force: output.force,
    label: 'Visual compare output',
    managed: output.managed,
    removePaths: prepared.removePaths,
  });
}

async function runVisualCompareWatch(
  plan: ParsedVisualComparePlan,
  openReport: ((path: string) => void) | undefined,
): Promise<void> {
  const cwd = process.cwd();
  const controller = installSignalAbortController();
  const sameConfig =
    portablePathIdentity(resolve(cwd, plan.config)) ===
    portablePathIdentity(resolve(cwd, plan.againstConfig));
  let leftSession: TileflowArtifactSession | undefined;
  let rightSession: TileflowArtifactSession | undefined;
  let captureSession: TileflowCaptureSession | undefined;
  const tasks = new Set<Promise<void>>();
  let activeCapture: AbortController | undefined;
  let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
  let comparisonGeneration = 0;
  let hasSuccessfulGeneration = false;
  let unresolvedFailure = false;
  let opened = false;
  let stopped = false;
  const invalidSides = new Set<'left' | 'right'>();

  const emit = (event: Record<string, unknown>) => {
    const document = {schemaVersion: 1, command: 'visual.compare.watch', ...event};
    if (plan.json) {
      process.stdout.write(`${JSON.stringify(document)}\n`);
      return;
    }
    const name = String(event.event ?? 'event');
    if (name === 'generation-complete') {
      console.log(
        `Visual compare generation ${event.generation} -> ${event.reportPath} (${event.rowCount} rows).`,
      );
    } else if (name === 'invalid' || name === 'failed') {
      console.error(`Visual compare ${name} on ${String(event.side ?? 'both')}.`);
    } else if (name === 'watching') {
      console.error(`Watching ${String(event.left)} ↔ ${String(event.right)}.`);
    }
  };

  const abortActive = () => {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = undefined;
    activeCapture?.abort();
  };

  const currentReadySnapshot = () => {
    const leftState = leftSession!.getState();
    const rightState = rightSession!.getState();
    if (leftState.status !== 'ready' || rightState.status !== 'ready') return undefined;
    return {
      leftArtifacts: leftState.artifacts,
      leftGeneration: leftState.generation,
      rightArtifacts: rightState.artifacts,
      rightGeneration: rightState.generation,
    };
  };

  const isCurrentSnapshot = (leftGeneration: number, rightGeneration: number) => {
    const snapshot = currentReadySnapshot();
    return Boolean(
      snapshot &&
      snapshot.leftGeneration === leftGeneration &&
      snapshot.rightGeneration === rightGeneration,
    );
  };

  const startGeneration = () => {
    if (stopped) return;
    const snapshot = currentReadySnapshot();
    if (!snapshot) return;
    activeCapture?.abort();
    activeCapture = new AbortController();
    const signal = activeCapture.signal;
    const generation = ++comparisonGeneration;
    const task = (async () => {
      try {
        plan.output.previousAssets = await readVisualCompareInventory(
          plan.output.assetDirectory,
          plan.output.inventoryPath,
          plan.output.boundary,
        );
        await assertVisualCompareOutputDoesNotOverlapInputs(
          plan,
          snapshot.leftArtifacts,
          snapshot.rightArtifacts,
        );
        captureSession ??= createTileflowCaptureSession({
          allowBrowserInstall: plan.browserInstall,
          cwd,
          onBrowserInstallProgress: plan.json ? undefined : printInstallProgress,
          signal: controller.signal,
        });
        const prepared = await prepareVisualCompareOutput(
          plan,
          snapshot.leftArtifacts,
          snapshot.rightArtifacts,
          captureSession!,
          signal,
        );
        if (
          signal.aborted ||
          !isCurrentSnapshot(snapshot.leftGeneration, snapshot.rightGeneration)
        ) {
          return;
        }
        if (prepared.incompatible) {
          unresolvedFailure = true;
          emit({
            event: 'failed',
            generation,
            side: 'both',
            code: 'VISUAL_REVIEW_INCOMPATIBLE',
            phase: 'visual-review',
            diagnostics: [
              {
                code: 'VISUAL_REVIEW_INCOMPATIBLE',
                message: 'The synchronized captures are not review-compatible.',
                path: '',
                phase: 'visual-review',
              },
            ],
          });
          return;
        }
        await writePreparedVisualCompareOutput(plan.output, prepared);
        plan.output.previousAssets = prepared.nextAssets;
        if (
          signal.aborted ||
          !isCurrentSnapshot(snapshot.leftGeneration, snapshot.rightGeneration)
        ) {
          return;
        }
        hasSuccessfulGeneration = true;
        unresolvedFailure = false;
        emit({
          event: 'generation-complete',
          generation,
          leftGeneration: snapshot.leftGeneration,
          rightGeneration: snapshot.rightGeneration,
          reportPath: relativePath(cwd, plan.output.reportPath),
          documentPath: relativePath(cwd, plan.output.documentPath),
          rowCount: prepared.document.rows.length,
          warnings: prepared.document.warnings,
        });
        if (plan.open && !opened) {
          opened = true;
          openReport?.(plan.output.reportPath);
        }
      } catch (error) {
        if (signal.aborted || stopped) return;
        unresolvedFailure = true;
        const diagnostics = createTileflowArtifactDiagnostics(error, cwd);
        emit({
          event: 'failed',
          generation,
          side: 'both',
          ...(diagnostics[0]?.code ? {code: diagnostics[0].code} : {}),
          ...(diagnostics[0]?.phase ? {phase: diagnostics[0].phase} : {}),
          diagnostics,
        });
      }
    })();
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };

  const scheduleGeneration = () => {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => {
      scheduleTimer = undefined;
      startGeneration();
    }, 50);
  };

  const handleState = (side: 'left' | 'right' | 'both', state: TileflowArtifactSessionState) => {
    if (stopped) return;
    const sides: Array<'left' | 'right'> = side === 'both' ? ['left', 'right'] : [side];
    if (state.status === 'building') {
      abortActive();
      emit({
        event: 'building',
        side,
        sourceGeneration: state.generation,
        ...(state.lastGoodGeneration === undefined
          ? {}
          : {lastGoodGeneration: state.lastGoodGeneration}),
      });
      return;
    }
    if (state.status === 'invalid') {
      abortActive();
      unresolvedFailure = true;
      sides.forEach((value) => invalidSides.add(value));
      emit({
        event: 'invalid',
        side,
        sourceGeneration: state.generation,
        ...(state.lastGoodGeneration === undefined
          ? {}
          : {lastGoodGeneration: state.lastGoodGeneration}),
        ...(state.diagnostics[0]?.code ? {code: state.diagnostics[0].code} : {}),
        ...(state.diagnostics[0]?.phase ? {phase: state.diagnostics[0].phase} : {}),
        diagnostics: state.diagnostics,
      });
      return;
    }
    let recovered = false;
    for (const value of sides) recovered = invalidSides.delete(value) || recovered;
    if (recovered) {
      emit({event: 'recovered', side, sourceGeneration: state.generation});
    }
    scheduleGeneration();
  };

  const ignoredPaths = [
    plan.output.assetDirectory,
    plan.output.documentPath,
    plan.output.reportPath,
  ];
  try {
    leftSession = await createTileflowArtifactSession({
      assetBaseUrl: tileflowSyntheticAssetOrigin,
      config: plan.config,
      cwd,
      ignoredPaths,
      watch: true,
    });
    rightSession = sameConfig
      ? leftSession
      : await createTileflowArtifactSession({
          assetBaseUrl: tileflowSyntheticAssetOrigin,
          config: plan.againstConfig,
          cwd,
          ignoredPaths,
          watch: true,
        });
    emit({
      event: 'watching',
      left: watchSideLabel(cwd, plan.config, plan.map, plan.theme),
      right: watchSideLabel(cwd, plan.againstConfig, plan.againstMap, plan.againstTheme),
      zooms: plan.zooms,
      reportPath: relativePath(cwd, plan.output.reportPath),
    });
    const unsubscribers = sameConfig
      ? [leftSession.subscribe((state) => handleState('both', state))]
      : [
          leftSession.subscribe((state) => handleState('left', state)),
          rightSession.subscribe((state) => handleState('right', state)),
        ];
    if (sameConfig) {
      handleState('both', leftSession.getState());
    } else {
      handleState('left', leftSession.getState());
      handleState('right', rightSession.getState());
    }
    try {
      await waitForAbort(controller.signal);
    } finally {
      stopped = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    }
  } finally {
    stopped = true;
    abortActive();
    await Promise.allSettled(tasks);
    await captureSession?.close();
    if (rightSession && rightSession !== leftSession) await rightSession.close();
    await leftSession?.close();
    emit({event: 'stopped', generation: comparisonGeneration});
    if (!hasSuccessfulGeneration || unresolvedFailure) process.exitCode = 1;
    controller.close();
  }
}

function resolveVisualCompareSide(
  artifacts: TileflowBuildArtifacts,
  config: string,
  requestedMap: string | undefined,
  requestedTheme: string | undefined,
  role: 'left' | 'right',
): ResolvedVisualCompareSide {
  const availableMaps = Object.keys(artifacts.project.maps).sort(compareCodeUnits);
  const map = requestedMap ?? (availableMaps.length === 1 ? availableMaps[0] : undefined);
  if (!map) {
    throw new Error(
      `The ${role} config contains multiple maps; select one explicitly. Available maps: ${availableMaps.join(', ')}.`,
    );
  }
  const candidate = Object.hasOwn(artifacts.project.maps, map)
    ? artifacts.project.maps[map]
    : undefined;
  if (!candidate) {
    throw new Error(
      `Unknown ${role} map "${map}". Available maps: ${availableMaps.join(', ') || '(none)'}.`,
    );
  }
  const resolvedMap = parseTileflowMap(candidate);
  const theme = resolveThemeSelection(resolvedMap, requestedTheme).name;
  if (!artifacts.styles[map]?.[theme]) {
    throw new Error(`The ${role} map theme "${map}/${theme}" was not compiled.`);
  }
  return {config, label: `${map} / ${theme}`, map, theme};
}

function createVisualCompareRows(
  plan: ParsedVisualComparePlan,
  left: ResolvedVisualCompareSide,
  right: ResolvedVisualCompareSide,
): VisualCompareSceneRow[] {
  return plan.zooms.map((zoom, index) => {
    const scene = `compare-${String(index + 1).padStart(2, '0')}`;
    return {
      id: scene,
      leftDefinition: createVisualCompareDefinition(plan, left, zoom),
      rightDefinition: createVisualCompareDefinition(plan, right, zoom),
      scene,
      zoom,
    };
  });
}

function createVisualCompareDefinition(
  plan: ParsedVisualComparePlan,
  side: ResolvedVisualCompareSide,
  zoom: number,
): TileflowVisualReviewDefinition {
  const normalized = normalizeTileflowCaptureScene({
    map: side.map,
    theme: side.theme,
    camera: {
      type: 'center',
      center: plan.camera.center,
      zoom,
      bearing: plan.camera.bearing,
      pitch: plan.camera.pitch,
    },
    viewport: plan.viewport,
    target: {kind: 'map'},
  });
  return normalized;
}

function withVisualCompareScenes(
  artifacts: TileflowBuildArtifacts,
  scenes: Record<string, TileflowVisualReviewDefinition>,
): TileflowBuildArtifacts {
  return {...artifacts, project: {...artifacts.project, scenes}};
}

function captureByScene(captures: readonly TileflowCapture[]): Map<string, TileflowCapture> {
  const result = new Map<string, TileflowCapture>();
  for (const capture of captures) {
    if (result.has(capture.scene)) throw new Error('Visual compare returned a duplicate scene.');
    result.set(capture.scene, capture);
  }
  return result;
}

function requireCapture(
  captures: Map<string, TileflowCapture>,
  scene: string,
  role: 'left' | 'right',
): TileflowCapture {
  const capture = captures.get(scene);
  if (!capture) throw new Error(`Visual compare did not return the ${role} scene "${scene}".`);
  return capture;
}

async function resolveVisualCompareOutput(
  cwd: string,
  value: string,
  managed: boolean,
  force: boolean,
  watch: boolean,
  zooms: readonly number[],
): Promise<VisualCompareOutputPlan> {
  const reportPath = resolve(cwd, value);
  if (extname(reportPath).toLowerCase() !== '.html') {
    throw new Error('--report must name an .html file.');
  }
  const reportDirectory = dirname(reportPath);
  if (reportDirectory === cwd || reportDirectory === parse(reportPath).root) {
    throw new Error('Visual compare output must use a dedicated subdirectory.');
  }
  if (watch && !managed && !force) {
    throw new Error('Visual compare --watch requires --force for an explicit report path.');
  }
  const stem = reportPath.slice(0, -'.html'.length);
  const documentPath = `${stem}.json`;
  const assetDirectory = `${stem}.assets`;
  const inventoryPath = resolve(assetDirectory, tileflowVisualCompareInventoryFileName);
  const boundary = isInside(cwd, reportDirectory) ? cwd : reportDirectory;
  await assertNoSymlinkComponents(reportDirectory, boundary);
  await assertNoSymlinkComponents(assetDirectory, boundary);
  await assertDirectoryIfPresent(assetDirectory);
  const previousAssets = await readVisualCompareInventory(assetDirectory, inventoryPath, boundary);
  const targets = [reportPath, documentPath, inventoryPath];
  for (const [index, zoom] of zooms.entries()) {
    const paths = visualCompareRowPaths({assetDirectory}, index, zoom, true);
    targets.push(
      paths.leftPath,
      paths.rightPath,
      paths.leftReceiptPath,
      paths.rightReceiptPath,
      paths.diffPath!,
    );
  }
  targets.push(...previousAssets.map((asset) => asset.path));
  for (const target of targets) await assertNotSymlink(target);
  if (!managed && !force) {
    for (const target of targets) {
      if (await pathExists(target)) {
        throw new Error('Visual compare output already exists. Use --force to replace it.');
      }
    }
  }
  return {
    assetDirectory,
    boundary,
    documentPath,
    force: managed || force,
    inventoryPath,
    managed,
    previousAssets,
    reportPath,
  };
}

function visualCompareRowPaths(
  output: Pick<VisualCompareOutputPlan, 'assetDirectory'>,
  index: number,
  zoom: number,
  includeDiff: boolean,
) {
  const prefix = `${String(index + 1).padStart(2, '0')}-z${zoomSlug(zoom)}`;
  return {
    leftPath: resolve(output.assetDirectory, `${prefix}.left.png`),
    rightPath: resolve(output.assetDirectory, `${prefix}.right.png`),
    leftReceiptPath: resolve(output.assetDirectory, `${prefix}.left.receipt.json`),
    rightReceiptPath: resolve(output.assetDirectory, `${prefix}.right.receipt.json`),
    diffPath: includeDiff ? resolve(output.assetDirectory, `${prefix}.diff.png`) : undefined,
  };
}

function sideJson(side: ResolvedVisualCompareSide, cwd: string): TileflowVisualCompareSideJsonV1 {
  return {
    config: relativePath(cwd, resolve(cwd, side.config)),
    label: side.label,
    map: side.map,
    theme: side.theme,
  };
}

function watchSideLabel(
  cwd: string,
  config: string,
  map: string | undefined,
  theme: string | undefined,
): string {
  const selection = map
    ? `${map} / ${theme ?? 'default theme'}`
    : `singular map / ${theme ?? 'default theme'}`;
  return `${relativePath(cwd, resolve(cwd, config))} (${selection})`;
}

async function assertVisualCompareOutputDoesNotOverlapInputs(
  plan: ParsedVisualComparePlan,
  leftArtifacts: TileflowBuildArtifacts,
  rightArtifacts: TileflowBuildArtifacts,
): Promise<void> {
  const cwd = process.cwd();
  const inputs = mergeVisualCompareInputPaths([
    {kind: 'file', path: resolve(cwd, plan.config)},
    {kind: 'file', path: resolve(cwd, plan.againstConfig)},
    ...visualCompareArtifactInputPaths(leftArtifacts),
    ...visualCompareArtifactInputPaths(rightArtifacts),
  ]);
  const outputPaths = visualComparePotentialOutputPaths(plan.output, plan.zooms);
  const [assetDirectory, canonicalInputs, canonicalOutputs] = await Promise.all([
    canonicalPathIdentity(plan.output.assetDirectory),
    Promise.all(inputs.map(({path}) => canonicalPathIdentity(path))),
    Promise.all(outputPaths.map((path) => canonicalPathIdentity(path))),
  ]);
  const outputIdentities = new Set(canonicalOutputs);

  for (let index = 0; index < inputs.length; index += 1) {
    const input = canonicalInputs[index]!;
    const entry = inputs[index]!;
    const outputInsideInputDirectory =
      entry.kind === 'directory' && canonicalOutputs.some((output) => isInside(input, output));
    if (
      outputIdentities.has(input) ||
      pathsOverlap(assetDirectory, input) ||
      outputInsideInputDirectory
    ) {
      throw new Error(
        `Visual compare output overlaps a config input (${relativePath(cwd, entry.path)}). Choose another report path.`,
      );
    }
  }
}

function visualCompareArtifactInputPaths(
  artifacts: TileflowBuildArtifacts,
): VisualCompareInputPath[] {
  const inputGraph = (
    artifacts as TileflowBuildArtifacts & {
      inputs?: {directories?: unknown; files?: unknown};
    }
  ).inputs;
  const files = Array.isArray(inputGraph?.files)
    ? inputGraph.files
        .filter((path): path is string => typeof path === 'string')
        .map((path) => ({kind: 'file' as const, path}))
    : [];
  const directories = Array.isArray(inputGraph?.directories)
    ? inputGraph.directories
        .filter((path): path is string => typeof path === 'string')
        .map((path) => ({kind: 'directory' as const, path}))
    : [];
  return [
    ...files,
    ...directories,
    ...artifacts.watchPaths.map((path) => ({kind: 'unknown' as const, path})),
  ];
}

function mergeVisualCompareInputPaths(inputs: VisualCompareInputPath[]): VisualCompareInputPath[] {
  const rank = {unknown: 0, file: 1, directory: 2} as const;
  const merged = new Map<string, VisualCompareInputPath>();
  for (const entry of inputs) {
    const identity = portablePathIdentity(entry.path);
    const previous = merged.get(identity);
    if (!previous || rank[entry.kind] > rank[previous.kind]) merged.set(identity, entry);
  }
  return [...merged.values()];
}

function visualComparePotentialOutputPaths(
  output: VisualCompareOutputPlan,
  zooms: readonly number[],
): string[] {
  const paths = [output.reportPath, output.documentPath, output.inventoryPath];
  for (const [index, zoom] of zooms.entries()) {
    const row = visualCompareRowPaths(output, index, zoom, true);
    paths.push(
      row.leftPath,
      row.rightPath,
      row.leftReceiptPath,
      row.rightReceiptPath,
      row.diffPath!,
    );
  }
  paths.push(...output.previousAssets.map((asset) => asset.path));
  return [...new Set(paths)];
}

function createVisualCompareInventory(
  assetDirectory: string,
  assets: ReadonlyMap<string, string | Uint8Array>,
): VisualCompareInventoryV1 {
  return {
    schemaVersion: tileflowVisualCompareInventorySchemaVersion,
    kind: 'tileflow-visual-compare-assets',
    assets: [...assets]
      .map(([path, source]) => {
        const relativeAssetPath = relative(assetDirectory, path);
        if (
          relativeAssetPath !== basename(path) ||
          !isVisualCompareOwnedAssetName(relativeAssetPath)
        ) {
          throw new Error('Visual compare produced an invalid managed asset path.');
        }
        return {path: relativeAssetPath, sha256: sha256Source(source)};
      })
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
  };
}

function serializeVisualCompareInventory(inventory: VisualCompareInventoryV1): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

async function readVisualCompareInventory(
  assetDirectory: string,
  inventoryPath: string,
  boundary: string,
): Promise<VisualCompareInventoryAsset[]> {
  await assertNoSymlinkComponents(dirname(inventoryPath), boundary);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(inventoryPath);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Visual compare inventory must be a regular non-symlink file.');
  }
  if (info.size > maximumVisualCompareInventoryBytes) {
    throw new Error('Visual compare inventory exceeds its bounded byte limit.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(inventoryPath, 'utf8'));
  } catch (error) {
    throw new Error('Visual compare inventory is not valid bounded JSON.', {cause: error});
  }
  const inventory = validateVisualCompareInventory(parsed);
  const assets: VisualCompareInventoryAsset[] = [];
  for (const asset of inventory.assets) {
    const path = resolve(assetDirectory, asset.path);
    await assertNoSymlinkComponents(dirname(path), boundary);
    let assetInfo: Awaited<ReturnType<typeof lstat>>;
    try {
      assetInfo = await lstat(path);
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
    if (assetInfo.isSymbolicLink() || !assetInfo.isFile()) {
      throw new Error('A managed visual compare asset is not a regular non-symlink file.');
    }
    if (assetInfo.size > tileflowVisualCompareReportLimits.maximumEmbeddedPngBytes) {
      throw new Error('A managed visual compare asset exceeds its bounded byte limit.');
    }
    const source = await readFile(path);
    if (sha256Source(source) !== asset.sha256) {
      throw new Error(
        'A previously managed visual compare asset was modified; move or remove it explicitly.',
      );
    }
    assets.push({path, sha256: asset.sha256});
  }
  return assets;
}

function validateVisualCompareInventory(input: unknown): VisualCompareInventoryV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Visual compare inventory has an invalid shape.');
  }
  const record = input as Record<string, unknown>;
  if (
    !hasExactKeys(record, ['assets', 'kind', 'schemaVersion']) ||
    record.schemaVersion !== tileflowVisualCompareInventorySchemaVersion ||
    record.kind !== 'tileflow-visual-compare-assets' ||
    !Array.isArray(record.assets) ||
    record.assets.length > tileflowVisualCompareLimits.maximumRows * 5
  ) {
    throw new Error('Visual compare inventory has an invalid shape.');
  }
  const assets = record.assets.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Visual compare inventory has an invalid asset entry.');
    }
    const asset = entry as Record<string, unknown>;
    if (
      !hasExactKeys(asset, ['path', 'sha256']) ||
      typeof asset.path !== 'string' ||
      !isVisualCompareOwnedAssetName(asset.path) ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    ) {
      throw new Error('Visual compare inventory has an invalid asset entry.');
    }
    return {path: asset.path, sha256: asset.sha256};
  });
  const paths = assets.map((asset) => asset.path);
  const sortedPaths = [...paths].sort(compareCodeUnits);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sortedPaths[index])
  ) {
    throw new Error('Visual compare inventory asset paths must be unique and sorted.');
  }
  return {
    schemaVersion: tileflowVisualCompareInventorySchemaVersion,
    kind: 'tileflow-visual-compare-assets',
    assets,
  };
}

function isVisualCompareOwnedAssetName(value: string): boolean {
  if (value !== basename(value) || value.length > 160) return false;
  const match =
    /^(\d{2})-z[0-9e+-]+\.(?:diff\.png|left\.png|left\.receipt\.json|right\.png|right\.receipt\.json)$/u.exec(
      value,
    );
  if (!match) return false;
  const row = Number(match[1]);
  return Number.isInteger(row) && row >= 1 && row <= tileflowVisualCompareLimits.maximumRows;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sha256Source(source: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source))
    .digest('hex');
}

async function canonicalPathIdentity(path: string): Promise<string> {
  const absolute = resolve(path);
  let current = absolute;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existing = await realpath(current);
      const canonical = resolve(existing, ...missingSegments.reverse()).normalize('NFC');
      return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if (!isMissingPathComponent(error)) throw error;
      const parent = dirname(current);
      if (parent === current) {
        const canonical = absolute.normalize('NFC');
        return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
      }
      missingSegments.push(basename(current));
      current = parent;
    }
  }
}

function printVisualCompareResult(
  plan: ParsedVisualComparePlan,
  document: TileflowVisualCompareJsonV1,
): void {
  if (plan.json) {
    process.stdout.write(serializeTileflowVisualCompareJson(document));
    return;
  }
  console.log(
    `Visual compare ${document.left.label} ↔ ${document.right.label}: ${document.rows.length} synchronized ${document.rows.length === 1 ? 'view' : 'views'} (${document.artifacts.reportPath}).`,
  );
  for (const row of document.rows) {
    console.log(`z${row.zoom}: ${row.review.status}.`);
  }
  for (const warning of document.warnings) console.error(warning);
}

export function serializeTileflowVisualCompareJson(document: TileflowVisualCompareJsonV1): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseTileflowVisualRegion(value: string): TileflowVisualRegion {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) {
    throw new Error('--region expects x,y,width,height as four comma-separated integers.');
  }
  const [x, y, width, height] = parts.map(Number) as [number, number, number, number];
  if (![x, y, width, height].every(Number.isSafeInteger)) {
    throw new Error('--region expects x,y,width,height as four comma-separated integers.');
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error('--region expects non-negative x/y and positive width/height.');
  }
  return {x, y, width, height};
}

export function assertTileflowVisualRegionFits(
  region: TileflowVisualRegion,
  dimensions: {width: number; height: number},
  label: string,
): void {
  if (region.x > dimensions.width - region.width || region.y > dimensions.height - region.height) {
    throw new Error(
      `--region must fit within the ${label} physical dimensions (${dimensions.width}x${dimensions.height}).`,
    );
  }
}

function parseTuple(value: string, length: number, flag: string): number[] {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== length)
    throw new Error(`${flag} expects ${length} comma-separated numbers.`);
  return parts.map((part) => parseFiniteNumber(part, flag));
}

function parseFiniteNumber(value: string, flag: string): number {
  if (value === '') throw new Error(`${flag} expects a finite number.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${flag} expects a finite number.`);
  return number;
}

function parseInteger(value: string, flag: string): number {
  const number = parseFiniteNumber(value, flag);
  if (!Number.isInteger(number)) throw new Error(`${flag} expects an integer.`);
  return number;
}

function zoomSlug(zoom: number): string {
  return String(zoom).replace('.', '-');
}

function formatCoordinate(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function portablePathIdentity(path: string): string {
  const normalized = resolve(path).normalize('NFC');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function pathsOverlap(left: string, right: string): boolean {
  return isInside(left, right) || isInside(right, left);
}

async function assertDirectoryIfPresent(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Visual compare asset path must be a non-symlink directory.');
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isMissingPathComponent(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR'),
  );
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveAbort) =>
    signal.addEventListener('abort', () => resolveAbort(), {once: true}),
  );
}
