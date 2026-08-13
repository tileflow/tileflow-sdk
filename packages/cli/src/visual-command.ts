import type {Command} from 'commander';
import {lstat, readFile} from 'node:fs/promises';
import {dirname, isAbsolute, parse, relative, resolve, sep} from 'node:path';
import {
  analyzeTileflowCaptureReference,
  compareTileflowCaptureToBaseline,
  createTileflowCaptureSession,
  createTileflowVisualComparisonDocument,
  createTileflowVisualReferenceAnalysisDocument,
  parseTileflowCaptureReceipt,
  serializeTileflowCaptureReceipt,
  type TileflowCapture,
  TileflowCaptureError,
  type TileflowCaptureReceipt,
  tileflowCaptureReceiptLimits,
  tileflowVisualArtifactLimits,
  type TileflowVisualBaseline,
  type TileflowVisualComparison,
  type TileflowVisualReferenceAnalysis,
  type TileflowVisualReferenceAnalysisDocument,
  validateTileflowVisualReferencePng,
} from '@tileflow/capture';
import {compareCodeUnits} from '@tileflow/core';
import {
  installSignalAbortController,
  printCaptureError,
  printInstallProgress,
  relativePath,
} from './capture-command';
import {
  assertNoSymlinkComponents,
  assertNotSymlink,
  captureReceiptPath,
  writeAtomicFileSet,
} from './capture-output';

type VisualDiffOptions = {
  appOrigin?: string;
  baselineDir: string;
  browserInstall: boolean;
  config: string;
  failOn?: string;
  json?: boolean;
  outputDir: string;
};

type VisualUpdateOptions = {
  appOrigin?: string;
  baselineDir: string;
  browserInstall: boolean;
  config: string;
  json?: boolean;
};

type VisualAnalyzeOptions = {
  appOrigin?: string;
  browserInstall: boolean;
  config: string;
  json?: boolean;
  outputDir: string;
  reference: string;
};

export type TileflowVisualDiffJsonV1 = {
  schemaVersion: 1;
  command: 'visual.diff';
  comparisons: TileflowVisualDiffJsonEntry[];
};

export type TileflowVisualDiffJsonEntry = ReturnType<
  typeof createTileflowVisualComparisonDocument
> & {
  baselinePath: string;
  actualPath: string;
  diffPath: string | null;
  reportPath: string;
};

export type TileflowVisualUpdateJsonV1 = {
  schemaVersion: 1;
  command: 'visual.update';
  updates: TileflowVisualUpdateJsonEntry[];
};

export type TileflowVisualUpdateJsonEntry = {
  scene: string;
  map: string;
  target: 'map' | 'application';
  status: 'created' | 'updated' | 'repaired' | 'unchanged';
  baselinePath: string;
  receiptPath: string;
  previous:
    | null
    | {status: 'invalid'}
    | {
        status: 'valid';
        scene: string;
        map: string;
        target: 'map' | 'application';
        sha256: string;
        sceneSha256: string;
        renderer: TileflowCaptureReceipt['renderer'];
      };
  actual: {
    sha256: string;
    sceneSha256: string;
    renderer: TileflowCaptureReceipt['renderer'];
    networkDependent: boolean;
  };
  warnings: string[];
};

export type TileflowVisualAnalyzeJson = TileflowVisualReferenceAnalysisDocument & {
  command: 'visual.analyze';
  actualPath: string;
  diffPath: string | null;
  reportPath: string;
};

type BaselineFiles =
  | {kind: 'missing'; pngPath: string; receiptPath: string}
  | {kind: 'partial'; pngPath: string; receiptPath: string}
  | {
      kind: 'complete';
      pngPath: string;
      receiptPath: string;
      baseline: TileflowVisualBaseline;
    };

export function registerVisualCommands(
  program: Command,
  dependencies: {defaultConfigPath: string},
): void {
  const visual = program
    .command('visual')
    .description('Compare current map renders with references or approved baselines');

  visual
    .command('analyze')
    .description('Compare one current scene render with any reference PNG')
    .argument('<scene>', 'one named committed capture scene')
    .requiredOption('--reference <path>', 'reference PNG; it is never modified')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option(
      '--output-dir <path>',
      'directory for the current capture, highlighted diff, and JSON report',
      '.tileflow/analysis',
    )
    .option('--app-origin <origin>', 'loopback origin for a committed application scene')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--no-browser-install', 'fail if the pinned browser is missing')
    .action(async (scene: string, options: VisualAnalyzeOptions) => {
      try {
        await runVisualAnalyze(scene, options);
      } catch (error) {
        printCaptureError(error);
        process.exitCode = 1;
      }
    });

  visual
    .command('diff')
    .description('Compare fresh scene renders with approved baselines without changing them')
    .argument('[scenes...]', 'named committed capture scenes')
    .requiredOption('--baseline-dir <path>', 'directory containing approved baseline pairs')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option(
      '--output-dir <path>',
      'directory for current captures, highlighted diffs, and JSON reports',
      '.tileflow/diffs',
    )
    .option('--app-origin <origin>', 'loopback origin for committed application scenes')
    .option('--fail-on <policy>', 'successful comparison policy: changed')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--no-browser-install', 'fail if the pinned browser is missing')
    .action(async (scenes: string[] | undefined, options: VisualDiffOptions) => {
      try {
        await runVisualDiff(scenes ?? [], options);
      } catch (error) {
        printCaptureError(error);
        process.exitCode = 1;
      }
    });

  visual
    .command('update')
    .description('Save fresh scene renders as approved visual baselines')
    .argument('[scenes...]', 'named committed capture scenes')
    .requiredOption('--baseline-dir <path>', 'directory for approved baseline pairs')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--app-origin <origin>', 'loopback origin for committed application scenes')
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--no-browser-install', 'fail if the pinned browser is missing')
    .action(async (scenes: string[] | undefined, options: VisualUpdateOptions) => {
      try {
        await runVisualUpdate(scenes ?? [], options);
      } catch (error) {
        printCaptureError(error);
        process.exitCode = 1;
      }
    });
}

export function createTileflowVisualDiffJson(
  comparisons: Array<{
    comparison: TileflowVisualComparison;
    baselinePath: string;
    actualPath: string;
    diffPath?: string;
    reportPath: string;
  }>,
  cwd: string,
): TileflowVisualDiffJsonV1 {
  return {
    schemaVersion: 1,
    command: 'visual.diff',
    comparisons: [...comparisons]
      .sort((left, right) => compareCodeUnits(left.comparison.scene, right.comparison.scene))
      .map(({comparison, baselinePath, actualPath, diffPath, reportPath}) => ({
        ...createTileflowVisualComparisonDocument(comparison),
        baselinePath: relativePath(cwd, baselinePath),
        actualPath: relativePath(cwd, actualPath),
        diffPath: diffPath ? relativePath(cwd, diffPath) : null,
        reportPath: relativePath(cwd, reportPath),
      })),
  };
}

export function createTileflowVisualAnalyzeJson(
  analysis: TileflowVisualReferenceAnalysis,
  paths: {actualPath: string; diffPath?: string; reportPath: string},
  cwd: string,
): TileflowVisualAnalyzeJson {
  const {schemaVersion, ...document} = createTileflowVisualReferenceAnalysisDocument(analysis);
  return {
    schemaVersion,
    command: 'visual.analyze',
    ...document,
    actualPath: relativePath(cwd, paths.actualPath),
    diffPath: paths.diffPath ? relativePath(cwd, paths.diffPath) : null,
    reportPath: relativePath(cwd, paths.reportPath),
  };
}

export function serializeTileflowVisualCommandJson(
  value: TileflowVisualAnalyzeJson | TileflowVisualDiffJsonV1 | TileflowVisualUpdateJsonV1,
): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runVisualAnalyze(scene: string, options: VisualAnalyzeOptions): Promise<void> {
  validateVisualSelection([scene]);
  delete process.env.TILEFLOW_API_KEY;
  const cwd = process.cwd();
  const referencePath = resolve(cwd, options.reference);
  const referencePng = await readVisualReference(referencePath);
  validateTileflowVisualReferencePng(referencePng);
  const outputDirectory = await resolveVisualDirectory(cwd, options.outputDir, 'output');
  const actualPath = resolve(outputDirectory.path, `${scene}.actual.png`);
  const managedDiffPath = resolve(outputDirectory.path, `${scene}.diff.png`);
  const reportPath = resolve(outputDirectory.path, `${scene}.analysis.json`);
  assertReferenceIsReadOnly(referencePath, [actualPath, managedDiffPath, reportPath]);
  const controller = installSignalAbortController();
  const session = createTileflowCaptureSession({
    allowBrowserInstall: options.browserInstall,
    appOrigin: options.appOrigin ?? process.env.TILEFLOW_APP_ORIGIN,
    config: options.config,
    cwd,
    onBrowserInstallProgress: printInstallProgress,
    signal: controller.signal,
  });

  try {
    const result = await session.capture([scene], controller.signal);
    const capture = result.captures[0];
    if (!capture || result.captures.length !== 1) {
      throw new Error('Visual analysis requires exactly one captured scene.');
    }
    const analysis = await analyzeTileflowCaptureReference(capture, referencePng);
    const diffPath = analysis.diffPng ? managedDiffPath : undefined;
    const document = createTileflowVisualAnalyzeJson(
      analysis,
      {actualPath, diffPath, reportPath},
      cwd,
    );

    await writeAtomicFileSet({
      boundaryPath: outputDirectory.boundary,
      force: true,
      label: 'Visual analysis output',
      managed: true,
      files: [
        {path: actualPath, source: capture.png},
        ...(diffPath && analysis.diffPng ? [{path: diffPath, source: analysis.diffPng}] : []),
        {path: reportPath, source: serializeTileflowVisualCommandJson(document)},
      ],
      removePaths: diffPath ? [] : [managedDiffPath],
    });

    if (options.json) {
      process.stdout.write(serializeTileflowVisualCommandJson(document));
    } else {
      const relationship = document.dimensionsMatch ? 'dimensions match' : 'dimensions differ';
      console.log(`Visual analysis ${document.scene}: ${relationship} (${document.reportPath}).`);
      for (const warning of document.warnings) console.error(warning);
    }
  } finally {
    await session.close();
    controller.close();
  }
}

async function runVisualDiff(scenes: string[], options: VisualDiffOptions): Promise<void> {
  validateVisualSelection(scenes);
  if (options.failOn !== undefined && options.failOn !== 'changed') {
    throw new Error('--fail-on expects changed.');
  }
  delete process.env.TILEFLOW_API_KEY;
  const cwd = process.cwd();
  const baselineDirectory = await resolveVisualDirectory(cwd, options.baselineDir, 'baseline');
  const outputDirectory = await resolveVisualDirectory(cwd, options.outputDir, 'output');
  if (pathsOverlap(baselineDirectory.path, outputDirectory.path)) {
    throw new Error('Visual baseline and generated output directories must not overlap.');
  }
  const controller = installSignalAbortController();
  const session = createTileflowCaptureSession({
    allowBrowserInstall: options.browserInstall,
    appOrigin: options.appOrigin ?? process.env.TILEFLOW_APP_ORIGIN,
    config: options.config,
    cwd,
    onBrowserInstallProgress: printInstallProgress,
    signal: controller.signal,
  });

  try {
    const result = await session.capture(scenes, controller.signal);
    const prepared: Array<{
      capture: TileflowCapture;
      comparison: TileflowVisualComparison;
      baselinePath: string;
      actualPath: string;
      diffPath?: string;
      reportPath: string;
    }> = [];

    for (const capture of result.captures) {
      const files = await readBaselineFiles(baselineDirectory, capture.scene);
      if (files.kind === 'partial') {
        throw new TileflowCaptureError(
          'BASELINE_INVALID',
          `Baseline ${capture.scene} must contain both a PNG and receipt.`,
        );
      }
      const comparison = await compareTileflowCaptureToBaseline(
        capture,
        files.kind === 'complete' ? files.baseline : undefined,
      );
      const actualPath = resolve(outputDirectory.path, `${capture.scene}.actual.png`);
      const diffPath = comparison.diffPng
        ? resolve(outputDirectory.path, `${capture.scene}.diff.png`)
        : undefined;
      prepared.push({
        capture,
        comparison,
        baselinePath: files.pngPath,
        actualPath,
        diffPath,
        reportPath: resolve(outputDirectory.path, `${capture.scene}.visual.json`),
      });
    }

    const document = createTileflowVisualDiffJson(prepared, cwd);
    const entryByScene = new Map(document.comparisons.map((entry) => [entry.scene, entry]));
    await writeAtomicFileSet({
      boundaryPath: outputDirectory.boundary,
      force: true,
      label: 'Visual diff output',
      managed: true,
      files: prepared.flatMap((item) => [
        {path: item.actualPath, source: item.capture.png},
        ...(item.diffPath && item.comparison.diffPng
          ? [{path: item.diffPath, source: item.comparison.diffPng}]
          : []),
        {
          path: item.reportPath,
          source: `${JSON.stringify(entryByScene.get(item.capture.scene), null, 2)}\n`,
        },
      ]),
      removePaths: prepared.flatMap((item) =>
        item.diffPath ? [] : [resolve(outputDirectory.path, `${item.capture.scene}.diff.png`)],
      ),
    });

    if (options.json) {
      process.stdout.write(serializeTileflowVisualCommandJson(document));
    } else {
      for (const entry of document.comparisons) {
        console.log(`Visual ${entry.scene}: ${entry.status} (${entry.reportPath}).`);
        for (const warning of entry.warnings) console.error(warning);
      }
    }

    const incompatible = document.comparisons.some((entry) =>
      ['missing-baseline', 'runtime-mismatch', 'scene-mismatch'].includes(entry.status),
    );
    const changed = document.comparisons.some((entry) => entry.status === 'changed');
    if (incompatible) process.exitCode = 1;
    else if (changed && options.failOn === 'changed') process.exitCode = 2;
  } finally {
    await session.close();
    controller.close();
  }
}

async function runVisualUpdate(scenes: string[], options: VisualUpdateOptions): Promise<void> {
  validateVisualSelection(scenes);
  delete process.env.TILEFLOW_API_KEY;
  const cwd = process.cwd();
  const baselineDirectory = await resolveVisualDirectory(cwd, options.baselineDir, 'baseline');
  const controller = installSignalAbortController();
  const session = createTileflowCaptureSession({
    allowBrowserInstall: options.browserInstall,
    appOrigin: options.appOrigin ?? process.env.TILEFLOW_APP_ORIGIN,
    config: options.config,
    cwd,
    onBrowserInstallProgress: printInstallProgress,
    signal: controller.signal,
  });

  try {
    const result = await session.capture(scenes, controller.signal);
    const updates: TileflowVisualUpdateJsonEntry[] = [];
    const outputFiles: Array<{path: string; source: string | Uint8Array}> = [];

    for (const capture of result.captures) {
      const files = await readBaselineFiles(baselineDirectory, capture.scene);
      const serializedReceipt = serializeTileflowCaptureReceipt(capture.receipt);
      const previous = await resolvePreviousBaseline(capture, files);
      const previousReceiptBytes =
        files.kind === 'complete'
          ? typeof files.baseline.receipt === 'string'
            ? Buffer.from(files.baseline.receipt)
            : files.baseline.receipt instanceof Uint8Array
              ? Buffer.from(files.baseline.receipt)
              : undefined
          : undefined;
      const matches =
        files.kind === 'complete' &&
        Buffer.from(files.baseline.png).equals(Buffer.from(capture.png)) &&
        previousReceiptBytes?.equals(Buffer.from(serializedReceipt)) === true;
      const status = matches
        ? 'unchanged'
        : files.kind === 'missing'
          ? 'created'
          : previous?.status === 'invalid' || files.kind === 'partial'
            ? 'repaired'
            : 'updated';
      updates.push({
        scene: capture.scene,
        map: capture.map,
        target: capture.target,
        status,
        baselinePath: relativePath(cwd, files.pngPath),
        receiptPath: relativePath(cwd, files.receiptPath),
        previous,
        actual: {
          sha256: capture.sha256,
          sceneSha256: capture.sceneSha256,
          renderer: capture.renderer,
          networkDependent: capture.networkDependent,
        },
        warnings: [...capture.warnings].sort(compareCodeUnits),
      });
      outputFiles.push(
        {path: files.pngPath, source: capture.png},
        {path: files.receiptPath, source: serializedReceipt},
      );
    }

    await writeAtomicFileSet({
      boundaryPath: baselineDirectory.boundary,
      files: outputFiles,
      force: true,
      label: 'Visual baseline',
      managed: true,
    });
    const document: TileflowVisualUpdateJsonV1 = {
      schemaVersion: 1,
      command: 'visual.update',
      updates: updates.sort((left, right) => compareCodeUnits(left.scene, right.scene)),
    };
    if (options.json) {
      process.stdout.write(serializeTileflowVisualCommandJson(document));
    } else {
      for (const entry of document.updates) {
        console.log(`Visual baseline ${entry.scene}: ${entry.status} (${entry.baselinePath}).`);
        if (entry.actual.networkDependent) {
          console.error(`Baseline ${entry.scene} used remote map resources.`);
        }
      }
    }
  } finally {
    await session.close();
    controller.close();
  }
}

async function resolvePreviousBaseline(
  capture: TileflowCapture,
  files: BaselineFiles,
): Promise<TileflowVisualUpdateJsonEntry['previous']> {
  if (files.kind === 'missing') return null;
  if (files.kind === 'partial') return {status: 'invalid'};
  try {
    await compareTileflowCaptureToBaseline(capture, files.baseline);
    const receipt =
      typeof files.baseline.receipt === 'object' && !(files.baseline.receipt instanceof Uint8Array)
        ? files.baseline.receipt
        : parseTileflowCaptureReceipt(files.baseline.receipt);
    return {
      status: 'valid',
      scene: receipt.scene.name,
      map: receipt.scene.map,
      target: receipt.scene.target,
      sha256: receipt.image.sha256,
      sceneSha256: receipt.scene.sha256,
      renderer: receipt.renderer,
    };
  } catch (error) {
    if (error instanceof TileflowCaptureError && error.code === 'BASELINE_INVALID') {
      return {status: 'invalid'};
    }
    throw error;
  }
}

async function readBaselineFiles(
  directory: {boundary: string; path: string},
  scene: string,
): Promise<BaselineFiles> {
  const pngPath = resolve(directory.path, `${scene}.png`);
  const receiptPath = captureReceiptPath(pngPath);
  const [png, receipt] = await Promise.all([
    readOptionalArtifact(pngPath, directory.boundary, tileflowVisualArtifactLimits.maximumPngBytes),
    readOptionalArtifact(
      receiptPath,
      directory.boundary,
      tileflowCaptureReceiptLimits.maximumBytes,
    ),
  ]);
  if (!png && !receipt) return {kind: 'missing', pngPath, receiptPath};
  if (!png || !receipt) return {kind: 'partial', pngPath, receiptPath};
  return {kind: 'complete', pngPath, receiptPath, baseline: {png, receipt}};
}

async function readOptionalArtifact(
  path: string,
  boundary: string,
  maximumBytes: number,
): Promise<Uint8Array | undefined> {
  await assertNoSymlinkComponents(dirname(path), boundary);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new TileflowCaptureError(
      'BASELINE_INVALID',
      'Visual baseline artifacts must be regular files without symbolic links.',
    );
  }
  if (info.size > maximumBytes) {
    throw new TileflowCaptureError('BASELINE_INVALID', 'A visual baseline artifact is too large.');
  }
  await assertNotSymlink(path);
  return new Uint8Array(await readFile(path));
}

async function readVisualReference(path: string): Promise<Uint8Array> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    throw new TileflowCaptureError('BASELINE_INVALID', 'The visual reference PNG cannot be read.', {
      cause: error,
    });
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new TileflowCaptureError(
      'BASELINE_INVALID',
      'The visual reference PNG must be a regular file, not a symbolic link.',
    );
  }
  if (info.size > tileflowVisualArtifactLimits.maximumPngBytes) {
    throw new TileflowCaptureError(
      'BASELINE_INVALID',
      'The visual reference PNG exceeds the bounded byte limit.',
    );
  }
  await assertNotSymlink(path);
  return new Uint8Array(await readFile(path));
}

async function resolveVisualDirectory(
  cwd: string,
  value: string,
  kind: 'baseline' | 'output',
): Promise<{boundary: string; path: string}> {
  const path = resolve(cwd, value);
  if (path === cwd || path === parse(path).root) {
    throw new Error(`Visual ${kind} directory must be a dedicated subdirectory.`);
  }
  if (kind === 'baseline') {
    for (const managed of [resolve(cwd, '.tileflow/captures'), resolve(cwd, '.tileflow/diffs')]) {
      if (pathsOverlap(path, managed)) {
        throw new Error('Visual baselines must not overlap Tileflow-managed capture/diff outputs.');
      }
    }
  }
  const boundary = isInside(cwd, path) ? cwd : path;
  await assertNoSymlinkComponents(path, boundary);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Visual ${kind} path must be a non-symlink directory.`);
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return {boundary, path};
}

function validateVisualSelection(scenes: readonly string[]): void {
  if (scenes.length === 0) throw new Error('Select at least one committed visual scene.');
}

function pathsOverlap(left: string, right: string): boolean {
  const portableLeft = portablePathIdentity(left);
  const portableRight = portablePathIdentity(right);
  return isInside(portableLeft, portableRight) || isInside(portableRight, portableLeft);
}

function assertReferenceIsReadOnly(referencePath: string, outputPaths: readonly string[]): void {
  const referenceIdentity = portablePathIdentity(referencePath);
  if (outputPaths.some((path) => portablePathIdentity(path) === referenceIdentity)) {
    throw new Error('Visual analysis output must not replace the reference PNG.');
  }
}

function portablePathIdentity(path: string): string {
  return resolve(path).normalize('NFC').toLowerCase();
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
