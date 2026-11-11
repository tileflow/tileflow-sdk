import type {Command} from 'commander';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {
  createTileflowCaptureSession,
  serializeTileflowCaptureReceipt,
  serializeTileflowShotReceipt,
  setupTileflowCaptureBrowser,
  type TileflowCapture,
  TileflowCaptureError,
  type TileflowCaptureRendererIdentity,
  type TileflowCaptureResourceDiagnostic,
  type TileflowShotCapture,
  type TileflowShotFormat,
  type TileflowShotFrame,
  type TileflowShotVideoCodec,
  tileflowSyntheticAssetOrigin,
  TileflowVisualReviewError,
} from '@tileflow/capture';
import {
  compareCodeUnits,
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureSceneSchema,
  tileflowCaptureShotNameSchema,
} from '@tileflow/core';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  type TileflowArtifactDiagnostic,
  type TileflowArtifactSessionState,
  type TileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';
import {TileflowValidationError} from '@tileflow/dev/config';
import {TileflowIconCompilationError} from '@tileflow/dev/icons';
import {TileflowStyleValidationError} from '@tileflow/dev/validation';
import {
  captureReceiptPath,
  commitShotFrameDirectory,
  type StagedShotFrameDirectory,
  stageShotFrameDirectory,
  writeAtomicFileSet,
  writeCapturePair,
} from './capture-output';
import {saveCaptureRecord} from './capture-record';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {
  isTileflowOfficialMapName,
  tileflowOfficialMapNames,
  writeTileflowOfficialMapConfig,
} from './official-map-config';

export type CaptureCommandOptions = {
  all?: boolean;
  allShots?: boolean;
  appOrigin?: string;
  batch?: string;
  bearing?: string;
  bounds?: string;
  browserInstall: boolean;
  center?: string;
  config: string;
  contactSheet?: string;
  dpr?: string;
  force?: boolean;
  format?: string;
  frame?: 'map' | 'viewport';
  gpu?: boolean;
  height?: string;
  json?: boolean;
  map?: string;
  out?: string;
  outDir?: string;
  pitch?: string;
  selector?: string;
  shot?: string[];
  theme?: string;
  timeout?: string;
  url?: string;
  width?: string;
  watch?: boolean;
  zoom?: string;
};

type SetupCaptureOptions = {browserInstall: boolean; json?: boolean};

export type TileflowCaptureJsonV1 = {
  schemaVersion: 1;
  command: 'capture';
  captures: TileflowCaptureJsonEntry[];
  /** The labelled grid of every capture, when `--contact-sheet` asked for one. */
  contactSheetPath?: string;
};

export type TileflowCaptureJsonEntry = {
  captureId?: string;
  scene: string;
  map: string;
  theme: string;
  target: 'map' | 'application';
  status: 'captured';
  definition?: NormalizedTileflowCaptureScene;
  outputPath: string;
  receiptPath: string;
  sha256: string;
  width: number;
  height: number;
  dpr: 1 | 2;
  renderer: TileflowCaptureRendererIdentity;
  networkDependent: boolean;
  warnings: string[];
};

export type TileflowShotCaptureJsonV1 = {
  schemaVersion: 1;
  command: 'capture.shot';
  shots: TileflowShotCaptureJsonEntry[];
};

export type TileflowShotCaptureJsonEntry = {
  shot: string;
  map: string;
  theme: string;
  status: 'captured';
  format: TileflowShotFormat;
  codec?: TileflowShotVideoCodec;
  outputPath: string;
  receiptPath: string;
  sha256: string;
  framesSha256: string;
  frameCount: number;
  fps: number;
  durationMs: number;
  width: number;
  height: number;
  dpr: 1 | 2;
  renderer: TileflowCaptureRendererIdentity;
  networkDependent: boolean;
  warnings: string[];
};

export type TileflowCaptureFailureJsonV1 = {
  schemaVersion: 1;
  command:
    | 'capture'
    | 'capture.shot'
    | 'setup.capture'
    | 'visual.compare'
    | 'visual.analyze'
    | 'visual.diff'
    | 'visual.update'
    | 'visual.report'
    | 'visual.approve'
    | 'compare';
  status: 'failed';
  code: string;
  phase: string;
  diagnostics: TileflowArtifactDiagnostic[];
  resources?: TileflowCaptureResourceDiagnostic[];
};

export function registerCaptureCommands(
  program: Command,
  dependencies: {defaultConfigPath: string},
): void {
  const setup = program.command('setup').description('Provision local Tileflow tooling');
  setup
    .command('capture')
    .description(
      'Preinstall or verify the pinned capture browser for prepared/offline environments',
    )
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option(
      '--no-browser-install',
      'verify the pinned browser is already prepared without installing',
    )
    .addHelpText(
      'after',
      '\nNormal capture installs the exact pinned Chromium headless shell automatically when needed.\nUse setup to pay that cost in advance or verify prepared/offline CI. Tileflow never falls back to system Chrome.\n',
    )
    .action(async (options: SetupCaptureOptions) => {
      const controller = installSignalAbortController();

      try {
        const renderer = await setupTileflowCaptureBrowser({
          allowInstall: options.browserInstall,
          onInstallProgress: options.json ? undefined : printInstallProgress,
          signal: controller.signal,
        });
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify(
              {
                schemaVersion: 1,
                command: 'setup.capture',
                status: 'ready',
                renderer,
              },
              null,
              2,
            )}\n`,
          );
        } else {
          console.log(
            `Pinned Chromium ${renderer.chromiumVersion} (revision ${renderer.chromiumRevision}) is ready for Tileflow capture.`,
          );
        }
      } catch (error) {
        printCaptureError(error, {command: 'setup.capture', json: options.json});
        process.exitCode = 1;
      } finally {
        controller.close();
      }
    });

  program
    .command('capture')
    .description(
      'Render Tileflow scenes to PNG, or timed shots to video, with a pinned headless browser',
    )
    .argument('[scenes...]', 'named committed capture scenes')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--all', 'capture every configured scene')
    .option(
      '--shot <name>',
      'render a committed timed shot; repeat for more shots',
      collectOption,
      [],
    )
    .option('--all-shots', 'render every committed timed shot')
    .option('--format <format>', 'shot output: webm (default) or frames')
    .option(
      '--map <name>',
      'capture one map with an uncommitted camera; an official map (streets, soundings, outdoors) needs no config',
    )
    .option(
      '--theme <names>',
      'concrete theme for exploratory capture; a comma-separated list captures each theme',
    )
    .option(
      '--batch <path>',
      'JSON list of exploratory captures, rendered in one browser session (see REFERENCE.md)',
    )
    .option('--center <lng,lat>', 'exploratory center camera')
    .option('--bounds <west,south,east,north>', 'exploratory bounds camera')
    .option('--zoom <number>', 'exploratory center zoom')
    .option('--bearing <number>', 'exploratory camera bearing')
    .option('--pitch <number>', 'exploratory camera pitch')
    .option('--width <pixels>', 'exploratory viewport width')
    .option('--height <pixels>', 'exploratory viewport height')
    .option('--dpr <ratio>', 'exploratory device pixel ratio: 1 or 2')
    .option('--app-origin <origin>', 'loopback origin for committed application scenes')
    .option('--url <url>', 'one-off full loopback URL for exactly one named scene')
    .option('--selector <selector>', 'one-off application target selector')
    .option('--frame <frame>', 'application capture frame: map or viewport')
    .option('--out <path>', 'PNG path for one scene, or .webm/frame directory for one shot')
    .option('--out-dir <path>', 'directory for one or more captures')
    .option('--force', 'replace different explicit output files')
    .option(
      '--contact-sheet <path>',
      'also write every capture of this command into one labelled grid PNG',
    )
    .option('--timeout <seconds>', 'per-capture budget, including the 3D scene settling', '30')
    .option(
      '--gpu',
      "render exploratory captures with this machine's GPU: much faster 3D, hardware-dependent pixels",
    )
    .option('--json', 'print deterministic schema-version-1 JSON')
    .option('--watch', 'keep running and recapture after each valid local edit')
    .option(
      '--no-browser-install',
      'require the pinned browser to be prepared; never use system Chrome',
    )
    .addHelpText(
      'after',
      '\nCapture installs the exact pinned Chromium headless shell automatically unless --no-browser-install is set.\nUse `tileflow setup capture` to preinstall it or verify prepared/offline CI. Tileflow never falls back to system Chrome.\n',
    )
    .action(async (scenes: string[] | undefined, options: CaptureCommandOptions) => {
      try {
        await runCaptureCommand(scenes ?? [], options);
      } catch (error) {
        printCaptureError(error, {
          command: isShotSelection(options) ? 'capture.shot' : 'capture',
          json: options.json,
        });
        process.exitCode = 1;
      }
    });
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function isShotSelection(options: CaptureCommandOptions): boolean {
  return Boolean(options.allShots) || (options.shot?.length ?? 0) > 0;
}

export function createTileflowShotCaptureJson(
  shots: Array<{capture: TileflowShotCapture; outputPath: string; receiptPath: string}>,
  cwd: string,
): TileflowShotCaptureJsonV1 {
  return {
    schemaVersion: 1,
    command: 'capture.shot',
    shots: [...shots]
      .sort((left, right) => compareCodeUnits(left.capture.shot, right.capture.shot))
      .map(({capture, outputPath, receiptPath}) => ({
        shot: capture.shot,
        map: capture.map,
        theme: capture.theme,
        status: 'captured',
        format: capture.format,
        ...(capture.codec ? {codec: capture.codec} : {}),
        outputPath: relativePath(cwd, outputPath),
        receiptPath: relativePath(cwd, receiptPath),
        sha256: capture.sha256,
        framesSha256: capture.framesSha256,
        frameCount: capture.frameCount,
        fps: capture.fps,
        durationMs: capture.durationMs,
        width: capture.width,
        height: capture.height,
        dpr: capture.dpr,
        renderer: capture.renderer,
        networkDependent: capture.networkDependent,
        warnings: [...capture.warnings].sort(compareCodeUnits),
      })),
  };
}

export function serializeTileflowShotCaptureJson(value: TileflowShotCaptureJsonV1): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Shot receipts sit beside their video or frame directory. */
export function shotReceiptPath(outputPath: string): string {
  return outputPath.toLowerCase().endsWith('.webm')
    ? `${outputPath.slice(0, -5)}.receipt.json`
    : `${outputPath}.receipt.json`;
}

async function runCaptureShotCommand(options: CaptureCommandOptions): Promise<void> {
  const cwd = process.cwd();
  const format: TileflowShotFormat = options.format === 'frames' ? 'frames' : 'webm';
  const controller = installSignalAbortController();
  const session = createTileflowCaptureSession({
    allowBrowserInstall: options.browserInstall,
    config: options.config,
    cwd,
    onBrowserInstallProgress: options.json ? undefined : printInstallProgress,
    signal: controller.signal,
  });
  const stages = new Map<string, StagedShotFrameDirectory>();

  try {
    const onFrame =
      format === 'frames'
        ? async (frame: TileflowShotFrame) => {
            let stage = stages.get(frame.shot);
            if (!stage) {
              const target = resolveShotOutputTarget(frame.shot, options, format, cwd);
              stage = await stageShotFrameDirectory({
                boundaryPath: target.boundaryPath,
                directory: target.outputPath,
              });
              stages.set(frame.shot, stage);
            }
            await stage.write(frame.index, frame.png);
          }
        : undefined;
    const shotOptions = {format, ...(onFrame ? {onFrame} : {}), signal: controller.signal};
    const result = options.allShots
      ? await session.captureAllShots(shotOptions)
      : await session.captureShots(options.shot ?? [], shotOptions);
    const written: Array<{capture: TileflowShotCapture; outputPath: string; receiptPath: string}> =
      [];

    for (const capture of result.shots) {
      const target = resolveShotOutputTarget(capture.shot, options, format, cwd);
      const receipt = serializeTileflowShotReceipt(capture.receipt);
      if (capture.video) {
        await writeAtomicFileSet({
          boundaryPath: target.boundaryPath,
          files: [
            {path: target.outputPath, source: capture.video},
            {path: target.receiptPath, source: receipt},
          ],
          force: Boolean(options.force),
          label: 'Shot output',
          managed: target.managed,
        });
      } else {
        const stage = stages.get(capture.shot);
        if (!stage) throw new Error(`Shot ${capture.shot} produced no frames.`);
        await commitShotFrameDirectory({
          force: Boolean(options.force),
          managed: target.managed,
          receipt,
          receiptPath: target.receiptPath,
          stage,
        });
        stages.delete(capture.shot);
      }
      written.push({capture, outputPath: target.outputPath, receiptPath: target.receiptPath});
    }

    if (!options.out && !options.outDir) await warnIfManagedCapturesAreNotIgnored(cwd);

    const document = createTileflowShotCaptureJson(written, cwd);
    if (options.json) {
      process.stdout.write(serializeTileflowShotCaptureJson(document));
      return;
    }
    for (const entry of document.shots) {
      console.log(
        `Rendered ${entry.shot} -> ${entry.outputPath} (${entry.frameCount} frames, ${entry.sha256.slice(0, 12)}).`,
      );
      if (entry.networkDependent) {
        console.error(`Shot ${entry.shot} used remote map resources.`);
      }
    }
  } finally {
    await Promise.allSettled([...stages.values()].map((stage) => stage.discard()));
    await session.close();
    controller.close();
  }
}

function resolveShotOutputTarget(
  shot: string,
  options: CaptureCommandOptions,
  format: TileflowShotFormat,
  cwd: string,
): {boundaryPath: string; managed: boolean; outputPath: string; receiptPath: string} {
  const managed = !options.out && !options.outDir;
  const directory = resolve(cwd, options.outDir ?? '.tileflow/captures/shots');
  const outputPath = options.out
    ? resolve(cwd, options.out)
    : resolve(directory, format === 'webm' ? `${shot}.webm` : shot);
  const receiptPath = shotReceiptPath(outputPath);

  if (managed) {
    const relativeToRoot = relative(directory, outputPath);
    if (relativeToRoot.startsWith('..') || relativeToRoot.includes(`..${sep}`)) {
      throw new Error('Managed shot output escaped .tileflow/captures/shots.');
    }
  }
  relativePath(cwd, outputPath);
  relativePath(cwd, receiptPath);

  return {
    boundaryPath: managed ? cwd : options.outDir ? directory : resolve(outputPath, '..'),
    managed,
    outputPath,
    receiptPath,
  };
}

function validateShotSelectionOptions(
  positionalScenes: readonly string[],
  options: CaptureCommandOptions,
): void {
  const shots = options.shot ?? [];
  if (options.allShots && shots.length > 0) {
    throw new Error('Use either --shot or --all-shots, not both.');
  }
  if (positionalScenes.length > 0 || options.all || options.map || options.batch) {
    throw new Error('Render shots separately from scenes; --shot and --all-shots take no scenes.');
  }
  if (options.watch) {
    throw new Error('--watch captures scenes; it does not render shots.');
  }
  if (options.gpu) {
    throw new Error(
      'Shots render in software so their frames compare across machines; drop --gpu.',
    );
  }
  if (options.contactSheet !== undefined) {
    throw new Error('--contact-sheet lays out still captures, not shots.');
  }
  const sceneOnlyOptions = [
    options.center,
    options.bounds,
    options.zoom,
    options.bearing,
    options.pitch,
    options.width,
    options.height,
    options.dpr,
    options.theme,
    options.url,
    options.appOrigin,
    options.selector,
    options.frame,
  ];
  if (sceneOnlyOptions.some((value) => value !== undefined)) {
    throw new Error(
      'Shots render committed cameras and themes; camera, viewport, theme, and application flags apply to scenes.',
    );
  }
  for (const shot of shots) {
    if (!tileflowCaptureShotNameSchema.safeParse(shot).success) {
      throw new Error('--shot expects a portable Tileflow shot name.');
    }
  }
  if (options.format !== undefined && options.format !== 'webm' && options.format !== 'frames') {
    throw new Error('--format expects webm or frames.');
  }
  if (options.out && options.outDir) {
    throw new Error('Use either --out or --out-dir, not both.');
  }
  if (options.out) {
    if (options.allShots || new Set(shots).size !== 1) {
      throw new Error('--out can be used only when rendering one shot. Use --out-dir instead.');
    }
    const isVideoPath = options.out.toLowerCase().endsWith('.webm');
    if ((options.format ?? 'webm') === 'webm' && !isVideoPath) {
      throw new Error('--out must name a .webm file.');
    }
    if (options.format === 'frames' && (isVideoPath || /\.(?:json|png)$/iu.test(options.out))) {
      throw new Error('--out must name a directory for --format frames.');
    }
  }
}

export function createTileflowCaptureJson(
  captures: Array<{
    capture: TileflowCapture;
    captureId?: string;
    definition?: NormalizedTileflowCaptureScene;
    outputPath: string;
    receiptPath: string;
  }>,
  cwd: string,
): TileflowCaptureJsonV1 {
  return {
    schemaVersion: 1,
    command: 'capture',
    captures: [...captures]
      .sort((left, right) => compareCodeUnits(left.capture.scene, right.capture.scene))
      .map(({capture, captureId, definition, outputPath, receiptPath}) => ({
        ...(captureId ? {captureId} : {}),
        scene: capture.scene,
        map: capture.map,
        theme: capture.theme,
        target: capture.target,
        status: 'captured',
        ...(definition ? {definition} : {}),
        outputPath: relativePath(cwd, outputPath),
        receiptPath: relativePath(cwd, receiptPath),
        sha256: capture.sha256,
        width: capture.width,
        height: capture.height,
        dpr: capture.dpr,
        renderer: capture.renderer,
        networkDependent: capture.networkDependent,
        warnings: [...capture.warnings].sort(compareCodeUnits),
      })),
  };
}

export function serializeTileflowCaptureJson(value: TileflowCaptureJsonV1): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createTileflowCaptureFailureJson(
  error: unknown,
  cwd: string,
  command: TileflowCaptureFailureJsonV1['command'] = 'capture',
): TileflowCaptureFailureJsonV1 {
  const code = captureFailureCode(error);
  const phase = captureFailurePhase(error, code);
  const diagnostics = createTileflowArtifactDiagnostics(error, cwd);
  const resources =
    error instanceof TileflowCaptureError && error.details?.resources?.length
      ? error.details.resources
      : undefined;

  return {
    schemaVersion: 1,
    command,
    status: 'failed',
    code,
    phase,
    diagnostics,
    ...(resources ? {resources} : {}),
  };
}

export function serializeTileflowCaptureFailureJson(value: TileflowCaptureFailureJsonV1): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runCaptureCommand(
  positionalScenes: string[],
  options: CaptureCommandOptions,
): Promise<void> {
  validateSelectionOptions(positionalScenes, options);
  await withTileflowConfigSecretsHidden(async () => {
    if (isShotSelection(options)) {
      await runCaptureShotCommand(options);
      return;
    }
    if (options.watch) {
      await runCaptureWatchCommand(positionalScenes, options);
      return;
    }

    const cwd = process.cwd();
    const exploratoryDefinitions = isExploratorySelection(options)
      ? await createExploratoryScenes(options, cwd)
      : undefined;
    const config = await resolveCaptureConfig(options, exploratoryDefinitions, cwd);
    const controller = installSignalAbortController();
    const session = createTileflowCaptureSession({
      allowBrowserInstall: options.browserInstall,
      appOrigin: options.url ? undefined : (options.appOrigin ?? process.env.TILEFLOW_APP_ORIGIN),
      appUrl: options.url,
      config,
      cwd,
      onBrowserInstallProgress: options.json ? undefined : printInstallProgress,
      frame: options.frame,
      selector: options.selector,
      signal: controller.signal,
      timeoutMs: parseCaptureTimeout(options.timeout),
      ...(options.gpu ? {graphics: 'gpu' as const} : {}),
    });

    try {
      const result = exploratoryDefinitions
        ? await session.captureDefinitions(exploratoryDefinitions, controller.signal)
        : options.all
          ? await session.captureAll(controller.signal)
          : await session.capture(positionalScenes, controller.signal);
      const targets = resolveOutputTargets(result.captures, options, cwd);
      const written: Array<{
        capture: TileflowCapture;
        captureId?: string;
        definition?: NormalizedTileflowCaptureScene;
        outputPath: string;
        receiptPath: string;
      }> = [];

      for (const target of targets) {
        await writeCapturePair({
          boundaryPath: target.boundaryPath,
          force: Boolean(options.force),
          managed: target.managed,
          outputPath: target.outputPath,
          png: target.capture.png,
          receipt: serializeTileflowCaptureReceipt(target.capture.receipt),
          receiptPath: target.receiptPath,
        });
        const definition = exploratoryDefinitions?.[target.capture.scene];
        written.push({
          ...target,
          captureId: await saveCaptureRecord(target.capture, cwd),
          ...(definition ? {definition} : {}),
        });
      }

      if (targets.some((target) => target.managed)) {
        await warnIfManagedCapturesAreNotIgnored(cwd);
      }

      let contactSheetPath: string | undefined;
      if (options.contactSheet) {
        contactSheetPath = resolve(cwd, options.contactSheet);
        const sheet = await session.contactSheet(
          [...targets]
            .sort((left, right) => compareCodeUnits(left.capture.scene, right.capture.scene))
            .map(({capture}) => ({label: `${capture.scene} · ${capture.theme}`, png: capture.png})),
          {signal: controller.signal},
        );
        await writeAtomicFileSet({
          boundaryPath: resolve(contactSheetPath, '..'),
          files: [{path: contactSheetPath, source: sheet}],
          force: Boolean(options.force),
          label: 'Contact sheet',
          managed: false,
        });
      }

      const document = createTileflowCaptureJson(written, cwd);
      if (contactSheetPath) document.contactSheetPath = relativePath(cwd, contactSheetPath);
      if (options.json) {
        process.stdout.write(serializeTileflowCaptureJson(document));
        return;
      }
      if (contactSheetPath) console.log(`Contact sheet -> ${document.contactSheetPath}.`);

      for (const entry of document.captures) {
        console.log(
          `Captured ${entry.scene} -> ${entry.outputPath} (${entry.sha256.slice(0, 12)}).\nCapture ID: ${entry.captureId}`,
        );
        if (entry.networkDependent) {
          console.error(`Capture ${entry.scene} used remote map resources.`);
        }
        printCaptureWarnings(entry.scene, entry.warnings);
      }
    } finally {
      await session.close();
      controller.close();
    }
  });
}

/**
 * Prints what makes an image incomplete. Remote-origin notes stay in `networkDependent`; the rest
 * (a dataset the key cannot read, a 3D scene that had not settled) reach stderr in text mode too.
 */
function printCaptureWarnings(scene: string, warnings: readonly string[]): void {
  for (const warning of warnings) {
    if (warning.startsWith('Capture requested remote resources from ')) continue;
    console.error(`Warning (${scene}): ${warning}`);
  }
}

function parseCaptureTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) {
    throw new Error('--timeout expects seconds from 5 to 600.');
  }
  return Math.round(seconds * 1000);
}

function isExploratorySelection(options: CaptureCommandOptions): boolean {
  return Boolean(options.map) || Boolean(options.batch);
}

/**
 * The config to capture from. Without a project config, exploratory captures of official maps
 * read a generated config that extends them, so `--map streets` works in an empty directory.
 */
async function resolveCaptureConfig(
  options: CaptureCommandOptions,
  definitions: Record<string, NormalizedTileflowCaptureScene> | undefined,
  cwd: string,
): Promise<string> {
  if (!definitions || existsSync(resolve(cwd, options.config))) return options.config;
  const maps = [...new Set(Object.values(definitions).map((definition) => definition.map))];
  const official = maps.length === 1 && isTileflowOfficialMapName(maps[0]!) ? maps[0] : undefined;
  if (!official) {
    throw new Error(
      `Config not found: ${options.config}. Without a config, exploratory capture opens one official map (${tileflowOfficialMapNames.join(', ')}).`,
    );
  }
  return await writeTileflowOfficialMapConfig(official, cwd);
}

async function runCaptureWatchCommand(
  positionalScenes: string[],
  options: CaptureCommandOptions,
): Promise<void> {
  const cwd = process.cwd();
  const controller = installSignalAbortController();
  const ignoredPaths = options.out
    ? [resolve(cwd, options.out), captureReceiptPath(resolve(cwd, options.out))]
    : options.outDir
      ? [resolve(cwd, options.outDir)]
      : [resolve(cwd, '.tileflow')];
  const artifactSession = await createTileflowArtifactSession({
    assetBaseUrl: tileflowSyntheticAssetOrigin,
    config: options.config,
    cwd,
    ignoredPaths,
    watch: true,
  });
  const captureSession = createTileflowCaptureSession({
    allowBrowserInstall: options.browserInstall,
    appOrigin: options.url ? undefined : (options.appOrigin ?? process.env.TILEFLOW_APP_ORIGIN),
    appUrl: options.url,
    config: options.config,
    cwd,
    onBrowserInstallProgress: options.json ? undefined : printInstallProgress,
    frame: options.frame,
    selector: options.selector,
    signal: controller.signal,
  });
  const activeTasks = new Set<Promise<void>>();
  let activeCapture: AbortController | undefined;
  let hasSuccessfulCapture = false;
  let invalidSinceLastReady = artifactSession.getState().status === 'invalid';
  let unresolvedFailure = invalidSinceLastReady;
  let stopped = false;

  const emit = (event: Record<string, unknown>) => {
    const document = {schemaVersion: 1, command: 'capture.watch', ...event};
    if (options.json) {
      process.stdout.write(`${JSON.stringify(document)}\n`);
      return;
    }
    const name = String(event.event ?? 'event');
    if (name === 'building') {
      console.error(`Tileflow inputs changed; building generation ${event.generation}.`);
    } else if (name === 'invalid' || name === 'failed') {
      const diagnostics = (event.diagnostics ?? []) as Array<{message: string; path: string}>;
      console.error(
        [
          `Tileflow capture generation ${event.generation} ${name}.`,
          ...diagnostics.map(
            (diagnostic) => `- ${diagnostic.path || '(root)'}: ${diagnostic.message}`,
          ),
        ].join('\n'),
      );
    } else if (name === 'recovered') {
      console.error(`Tileflow inputs recovered at generation ${event.generation}.`);
    } else if (name === 'captured') {
      console.log(
        `Captured ${event.scene} -> ${event.outputPath} (${String(event.sha256).slice(0, 12)}).`,
      );
    }
  };

  const captureGeneration = async (
    generation: number,
    artifacts: TileflowBuildArtifacts,
    signal: AbortSignal,
  ) => {
    try {
      const sceneNames = options.all
        ? Object.keys(artifacts.project.scenes ?? {})
        : positionalScenes;
      const result = await captureSession.captureArtifacts(artifacts, sceneNames, signal);
      if (!isCurrentReadyGeneration(artifactSession.getState(), generation) || signal.aborted) {
        return;
      }
      const targets = resolveOutputTargets(result.captures, options, cwd);
      for (const target of targets) {
        if (!isCurrentReadyGeneration(artifactSession.getState(), generation) || signal.aborted) {
          return;
        }
        await writeCapturePair({
          boundaryPath: target.boundaryPath,
          force: Boolean(options.force),
          managed: target.managed,
          outputPath: target.outputPath,
          png: target.capture.png,
          receipt: serializeTileflowCaptureReceipt(target.capture.receipt),
          receiptPath: target.receiptPath,
        });
      }
      if (!isCurrentReadyGeneration(artifactSession.getState(), generation) || signal.aborted) {
        return;
      }
      if (targets.some((target) => target.managed)) {
        await warnIfManagedCapturesAreNotIgnored(cwd);
      }
      for (const target of targets) {
        emit({
          event: 'captured',
          captureId: await saveCaptureRecord(target.capture, cwd),
          generation,
          scene: target.capture.scene,
          map: target.capture.map,
          target: target.capture.target,
          outputPath: relativePath(cwd, target.outputPath),
          receiptPath: relativePath(cwd, target.receiptPath),
          sha256: target.capture.sha256,
          width: target.capture.width,
          height: target.capture.height,
          dpr: target.capture.dpr,
          networkDependent: target.capture.networkDependent,
          warnings: target.capture.warnings,
        });
      }
      hasSuccessfulCapture = true;
      unresolvedFailure = false;
    } catch (error) {
      if (signal.aborted || stopped) return;
      unresolvedFailure = true;
      const failure = createTileflowCaptureFailureJson(error, cwd);
      emit({
        event: 'failed',
        generation,
        code: failure.code,
        phase: failure.phase,
        diagnostics: failure.diagnostics,
        ...(failure.resources ? {resources: failure.resources} : {}),
      });
    }
  };

  const handleState = (state: TileflowArtifactSessionState) => {
    if (stopped) return;
    if (state.status === 'building') {
      activeCapture?.abort();
      emit({
        event: 'building',
        generation: state.generation,
        ...(state.lastGoodGeneration === undefined
          ? {}
          : {lastGoodGeneration: state.lastGoodGeneration}),
      });
      return;
    }
    if (state.status === 'invalid') {
      activeCapture?.abort();
      invalidSinceLastReady = true;
      unresolvedFailure = true;
      const firstDiagnostic = state.diagnostics[0];
      emit({
        event: 'invalid',
        generation: state.generation,
        ...(state.lastGoodGeneration === undefined
          ? {}
          : {lastGoodGeneration: state.lastGoodGeneration}),
        ...(firstDiagnostic?.code ? {code: firstDiagnostic.code} : {}),
        ...(firstDiagnostic?.phase ? {phase: firstDiagnostic.phase} : {}),
        diagnostics: state.diagnostics,
      });
      return;
    }

    activeCapture?.abort();
    activeCapture = new AbortController();
    if (invalidSinceLastReady) {
      emit({event: 'recovered', generation: state.generation});
      invalidSinceLastReady = false;
    }
    const acquisition = artifactSession.acquireArtifacts(state.generation);
    if (!acquisition) return;
    const task = captureGeneration(
      state.generation,
      acquisition.artifacts,
      activeCapture.signal,
    ).finally(() => acquisition.release());
    activeTasks.add(task);
    void task.finally(() => activeTasks.delete(task));
  };

  const unsubscribe = artifactSession.subscribe(handleState);
  handleState(artifactSession.getState());

  try {
    await waitForAbort(controller.signal);
  } finally {
    stopped = true;
    unsubscribe();
    activeCapture?.abort();
    await Promise.allSettled(activeTasks);
    const generation = artifactSession.getState().generation;
    await artifactSession.close();
    await captureSession.close();
    emit({event: 'stopped', generation});
    if (!hasSuccessfulCapture || unresolvedFailure) process.exitCode = 1;
    controller.close();
  }
}

function isCurrentReadyGeneration(
  state: TileflowArtifactSessionState,
  generation: number,
): boolean {
  return state.status === 'ready' && state.generation === generation;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveAbort) =>
    signal.addEventListener('abort', () => resolveAbort(), {once: true}),
  );
}

function validateSelectionOptions(
  positionalScenes: readonly string[],
  options: CaptureCommandOptions,
): void {
  if (isShotSelection(options)) {
    validateShotSelectionOptions(positionalScenes, options);
    return;
  }
  if (options.format !== undefined) {
    throw new Error('--format applies to --shot and --all-shots.');
  }
  if (options.contactSheet !== undefined && !options.contactSheet.toLowerCase().endsWith('.png')) {
    throw new Error('--contact-sheet must name a .png file.');
  }
  if (options.contactSheet !== undefined && options.watch) {
    throw new Error('--contact-sheet applies to one capture run, not --watch.');
  }
  if (options.gpu && !options.map && !options.batch) {
    throw new Error(
      '--gpu applies to exploratory --map and --batch captures; committed scenes render in software so their images compare across machines.',
    );
  }
  const exploratoryOptions = [
    options.center,
    options.bounds,
    options.zoom,
    options.bearing,
    options.pitch,
    options.width,
    options.height,
    options.dpr,
    options.theme,
  ];
  const applicationOverrides = [options.url, options.selector, options.frame];

  if (options.out && options.outDir) {
    throw new Error('Use either --out or --out-dir, not both.');
  }

  if (options.all && positionalScenes.length > 0) {
    throw new Error('Use either named scenes or --all, not both.');
  }

  if (options.frame !== undefined && options.frame !== 'map' && options.frame !== 'viewport') {
    throw new Error('--frame expects map or viewport.');
  }
  if (
    options.selector !== undefined &&
    (options.selector.trim() === '' || options.selector.length > 256)
  ) {
    throw new Error('--selector expects between 1 and 256 characters.');
  }
  if (options.url && options.appOrigin) {
    throw new Error('Use either --url or --app-origin, not both.');
  }
  if (
    applicationOverrides.some((value) => value !== undefined) &&
    (options.all || options.watch || options.map || positionalScenes.length !== 1)
  ) {
    throw new Error('Application URL/selector/frame overrides require exactly one named scene.');
  }

  if (options.map || options.batch) {
    if (options.map && !tileflowCaptureSceneNameSchema.safeParse(options.map).success) {
      throw new Error('Exploratory --map output requires a portable, non-reserved artifact name.');
    }
    if (options.watch) {
      throw new Error(
        '--watch requires committed named scenes or --all, not exploratory --map or --batch.',
      );
    }
    if (options.all || positionalScenes.length > 0) {
      throw new Error('Use --map and --batch only for uncommitted exploratory captures.');
    }
    // A batch file holds each capture's camera; the flags only give defaults.
    if (options.batch) return;
    if (options.theme === undefined) {
      throw new Error('Exploratory --map capture requires one concrete --theme.');
    }
    if (Boolean(options.center) === Boolean(options.bounds)) {
      throw new Error('Exploratory --map capture requires exactly one of --center or --bounds.');
    }
    if (options.center && options.zoom === undefined) {
      throw new Error('Exploratory --center capture requires --zoom.');
    }
    if (options.bounds && options.zoom !== undefined) {
      throw new Error('Exploratory --bounds capture does not accept --zoom.');
    }
    return;
  }

  if (exploratoryOptions.some((value) => value !== undefined)) {
    throw new Error('Exploratory camera, viewport, and theme flags require --map.');
  }

  if (!options.all && positionalScenes.length === 0) {
    throw new Error(
      'Select at least one scene, use --all, use --map for exploration, or select shots with --shot.',
    );
  }
}

/** One exploratory capture as a `--batch` file lists it; flags fill what an entry leaves out. */
type ExploratoryCaptureEntry = {
  name?: unknown;
  map?: unknown;
  theme?: unknown;
  camera?: unknown;
  center?: unknown;
  bounds?: unknown;
  padding?: unknown;
  zoom?: unknown;
  bearing?: unknown;
  pitch?: unknown;
  width?: unknown;
  height?: unknown;
  dpr?: unknown;
};

const maximumExploratoryCaptures = 200;

/**
 * The exploratory captures a command asks for, by output name: one per theme of `--map`, or each
 * entry of a `--batch` file (an array, or `{captures: [...]}`) per theme. They render in one
 * browser session from one compiled artifact snapshot.
 */
export async function createExploratoryScenes(
  options: CaptureCommandOptions,
  cwd: string,
): Promise<Record<string, NormalizedTileflowCaptureScene>> {
  const entries: ExploratoryCaptureEntry[] = options.batch
    ? await readExploratoryBatch(resolve(cwd, options.batch))
    : [{}];
  const scenes: Record<string, NormalizedTileflowCaptureScene> = {};
  for (const [index, entry] of entries.entries()) {
    const label = options.batch ? `--batch entry ${index + 1}` : '--map';
    const map = optionalString(entry.map, `${label} map`) ?? options.map;
    if (!map) throw new Error(`${label} names no map; set "map" or pass --map.`);
    const themeList = optionalString(entry.theme, `${label} theme`) ?? options.theme;
    if (!themeList) {
      throw new Error(`${label} names no theme; set "theme" or pass --theme.`);
    }
    const themes = [...new Set(themeList.split(',').map((theme) => theme.trim()))];
    const base = optionalString(entry.name, `${label} name`) ?? map;
    for (const theme of themes) {
      const name = themes.length > 1 ? `${base}-${theme}` : base;
      if (!tileflowCaptureSceneNameSchema.safeParse(name).success) {
        throw new Error(`${label} output name "${name}" is not a portable artifact name.`);
      }
      if (Object.hasOwn(scenes, name)) {
        throw new Error(`Exploratory captures share the output name "${name}"; name each one.`);
      }
      scenes[name] = createExploratoryScene({...options, map, theme}, entry, label);
      if (Object.keys(scenes).length > maximumExploratoryCaptures) {
        throw new Error(`One command captures at most ${maximumExploratoryCaptures} images.`);
      }
    }
  }
  return scenes;
}

async function readExploratoryBatch(path: string): Promise<ExploratoryCaptureEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `--batch could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as {captures?: unknown}).captures)
      ? (parsed as {captures: unknown[]}).captures
      : undefined;
  if (!list || list.length === 0) {
    throw new Error('--batch expects a non-empty JSON array, or {"captures": [...]}.');
  }
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`--batch entry ${index + 1} is not an object.`);
    }
    return entry as ExploratoryCaptureEntry;
  });
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} expects a non-empty string.`);
  }
  return value;
}

/** Reads a number from a batch entry, or falls back to the flag's text. */
function entryNumber(
  value: unknown,
  flag: string | undefined,
  label: string,
  fallback?: string,
): number | undefined {
  if (value !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${label} expects a finite number.`);
    }
    return value;
  }
  const text = flag ?? fallback;
  return text === undefined ? undefined : parseFiniteNumber(text, label);
}

function entryTuple(
  value: unknown,
  flag: string | undefined,
  length: number,
  label: string,
): number[] | undefined {
  if (value !== undefined) {
    if (
      !Array.isArray(value) ||
      value.length !== length ||
      value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    ) {
      throw new Error(`${label} expects ${length} finite numbers.`);
    }
    return value as number[];
  }
  return flag === undefined ? undefined : parseTuple(flag, length, label);
}

export function createExploratoryScene(
  options: CaptureCommandOptions,
  entry: ExploratoryCaptureEntry = {},
  label = '--map',
): NormalizedTileflowCaptureScene {
  const map = options.map!;
  if (
    entry.camera !== undefined &&
    (!entry.camera || typeof entry.camera !== 'object' || Array.isArray(entry.camera))
  ) {
    throw new Error(`${label} camera expects an object.`);
  }
  const nested = (entry.camera ?? {}) as ExploratoryCaptureEntry;
  const pick = (key: keyof ExploratoryCaptureEntry) => entry[key] ?? nested[key];
  // An entry's own center or bounds replaces the flags' position and zoom as a whole; bearing,
  // pitch and viewport fall back to the flags one by one.
  const ownCamera = pick('center') !== undefined || pick('bounds') !== undefined;
  const flags: Partial<CaptureCommandOptions> = ownCamera ? {} : options;
  const center = entryTuple(pick('center'), flags.center, 2, `${label} center`);
  const bounds = entryTuple(pick('bounds'), flags.bounds, 4, `${label} bounds`);
  if (Boolean(center) === Boolean(bounds)) {
    throw new Error(`${label} needs exactly one of center or bounds.`);
  }
  const zoom = entryNumber(pick('zoom'), flags.zoom, `${label} zoom`);
  if (center && zoom === undefined) throw new Error(`${label} center camera needs a zoom.`);
  if (bounds && zoom !== undefined) throw new Error(`${label} bounds camera takes no zoom.`);
  const bearing = entryNumber(pick('bearing'), options.bearing, `${label} bearing`, '0')!;
  const pitch = entryNumber(pick('pitch'), options.pitch, `${label} pitch`, '0')!;
  const padding = entryNumber(pick('padding'), undefined, `${label} padding`);
  const camera = center
    ? {type: 'center' as const, center: center as [number, number], zoom: zoom!, bearing, pitch}
    : {
        type: 'bounds' as const,
        bounds: bounds as [number, number, number, number],
        ...(padding === undefined ? {} : {padding}),
        bearing,
        pitch,
      };
  const candidate = {
    map,
    theme: options.theme!,
    camera,
    viewport: {
      width: entryNumber(entry.width, options.width, `${label} width`, '1200')!,
      height: entryNumber(entry.height, options.height, `${label} height`, '800')!,
      dpr: entryNumber(entry.dpr, options.dpr, `${label} dpr`, '1')!,
    },
  };
  const parsed = tileflowCaptureSceneSchema.safeParse(candidate);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid exploratory capture at ${issue?.path.join('.') || 'scene'}: ${issue?.message || 'invalid value'}`,
    );
  }

  return normalizeTileflowCaptureScene(parsed.data);
}

function resolveOutputTargets(
  captures: readonly TileflowCapture[],
  options: CaptureCommandOptions,
  cwd: string,
): Array<{
  capture: TileflowCapture;
  boundaryPath: string;
  managed: boolean;
  outputPath: string;
  receiptPath: string;
}> {
  if (options.out && captures.length !== 1) {
    throw new Error('--out can be used only when capturing one scene. Use --out-dir instead.');
  }

  if (options.out && !options.out.toLowerCase().endsWith('.png')) {
    throw new Error('--out must name a .png file.');
  }

  const managed = !options.out && !options.outDir;
  const directory = resolve(cwd, options.outDir ?? '.tileflow/captures');
  const managedRoot = resolve(cwd, '.tileflow/captures');

  return captures.map((capture) => {
    const outputPath = options.out
      ? resolve(cwd, options.out)
      : resolve(directory, `${capture.scene}.png`);

    if (managed) {
      const relativeToRoot = relative(managedRoot, outputPath);
      if (relativeToRoot.startsWith('..') || relativeToRoot.includes(`..${sep}`)) {
        throw new Error('Managed capture output escaped .tileflow/captures.');
      }
    }
    relativePath(cwd, outputPath);
    relativePath(cwd, captureReceiptPath(outputPath));

    return {
      capture,
      boundaryPath: managed ? cwd : options.outDir ? directory : resolve(outputPath, '..'),
      managed,
      outputPath,
      receiptPath: captureReceiptPath(outputPath),
    };
  });
}

function parseTuple(value: string, length: number, flag: string): number[] {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== length) {
    throw new Error(`${flag} expects ${length} comma-separated numbers.`);
  }
  return parts.map((part) => parseFiniteNumber(part, flag));
}

function parseFiniteNumber(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${flag} expects a finite number.`);
  }
  return number;
}

export function relativePath(cwd: string, path: string): string {
  return relativePathForPlatform(cwd, path, {isAbsolute, relative, sep});
}

export function relativePathForPlatform(
  cwd: string,
  path: string,
  platform: {
    isAbsolute(value: string): boolean;
    relative(from: string, to: string): string;
    sep: string;
  },
): string {
  const nativeResult = platform.relative(cwd, path);
  if (platform.isAbsolute(nativeResult)) {
    throw new Error('Artifact paths must share a filesystem volume to remain relative.');
  }
  const result = nativeResult.replaceAll(platform.sep, '/');
  return result || '.';
}

export function printInstallProgress(progress: 'installing' | 'installed'): void {
  console.error(
    progress === 'installing'
      ? "Installing Tileflow's pinned Chromium headless shell..."
      : 'Pinned Chromium headless shell installed.',
  );
}

export function printCaptureError(
  error: unknown,
  options: {
    command?: TileflowCaptureFailureJsonV1['command'];
    json?: boolean;
  } = {},
): void {
  const document = createTileflowCaptureFailureJson(
    error,
    process.cwd(),
    options.command ?? 'capture',
  );
  if (options.json) {
    process.stderr.write(serializeTileflowCaptureFailureJson(document));
    return;
  }

  const heading =
    error instanceof TileflowValidationError
      ? 'Tileflow config has errors.'
      : error instanceof TileflowStyleValidationError
        ? 'Compiled Tileflow styles have errors.'
        : error instanceof TileflowIconCompilationError
          ? 'Tileflow icon compilation has errors.'
          : document.diagnostics[0]?.message || 'Capture failed.';
  const diagnostics = document.diagnostics.filter(
    (diagnostic) => diagnostic.path || diagnostic.message !== heading,
  );
  console.error(
    [
      `${heading} [${document.code}; ${document.phase}]`,
      ...diagnostics.map((diagnostic) => `- ${diagnostic.path || '(root)'}: ${diagnostic.message}`),
    ].join('\n'),
  );
}

function captureFailureCode(error: unknown): string {
  if (error instanceof TileflowCaptureError) return error.code;
  if (error instanceof TileflowVisualReviewError) return error.code;
  if (error instanceof TileflowStyleValidationError) return error.code;
  if (error instanceof TileflowValidationError) return 'CONFIG_INVALID';
  if (error instanceof TileflowIconCompilationError) return 'ICON_INVALID';
  if (error instanceof Error) return 'INVALID_ARGUMENT';
  return 'CAPTURE_FAILED';
}

function captureFailurePhase(error: unknown, code: string): string {
  if (error instanceof TileflowCaptureError && error.details?.phase) {
    return error.details.phase;
  }
  if (error instanceof TileflowStyleValidationError) return error.phase;
  if (error instanceof TileflowVisualReviewError) return 'visual-review';
  if (error instanceof TileflowValidationError) return 'config-validation';
  if (error instanceof TileflowIconCompilationError) return 'icon-compilation';
  if (code.startsWith('BROWSER_')) return 'browser-start';
  if (
    code === 'RESOURCE_FAILED' ||
    code === 'SYNTHETIC_ASSET_NOT_FOUND' ||
    code === 'WORLD_RESOLUTION_FAILED'
  ) {
    return 'resource-load';
  }
  if (code === 'MAP_LOAD_FAILED') return 'map-load';
  if (code === 'SCREENSHOT_FAILED' || code === 'INVALID_PNG') return 'screenshot';
  if (code === 'SCENE_NOT_FOUND' || code.startsWith('APPLICATION_')) return 'scene-resolution';
  if (code === 'SHOT_NOT_FOUND') return 'shot-resolution';
  if (code.startsWith('VIDEO_')) return 'video-encode';
  if (code === 'ABORTED') return 'capture';
  return 'input-validation';
}

export function installSignalAbortController(): AbortController & {close(): void} {
  const controller = new AbortController() as AbortController & {close(): void};
  const onSignal = () => controller.abort();
  const onMessage = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'tileflow:stop'
    ) {
      controller.abort();
    }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  if (process.connected) {
    process.on('message', onMessage);
    process.once('disconnect', onSignal);
    process.channel?.unref();
  }
  controller.close = () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('message', onMessage);
    process.removeListener('disconnect', onSignal);
    if (process.connected) process.disconnect?.();
  };
  return controller;
}

async function warnIfManagedCapturesAreNotIgnored(cwd: string): Promise<void> {
  if (!(await isGitRepository(cwd))) {
    return;
  }

  const relativeDirectory = '.tileflow/captures/';
  const [ignored, tracked] = await Promise.all([
    runGit(cwd, ['check-ignore', '--quiet', '--', relativeDirectory]),
    runGit(cwd, ['ls-files', '--error-unmatch', '--', relativeDirectory]),
  ]);

  if (!ignored || tracked) {
    console.error(
      'Generated captures are not safely ignored by Git. Add .tileflow/captures/ and .tileflow/diffs/ deliberately.',
    );
  }
}

async function isGitRepository(cwd: string): Promise<boolean> {
  return runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
}

function runGit(cwd: string, args: string[]): Promise<boolean> {
  return new Promise((resolveResult) => {
    const child = spawn('git', args, {cwd, shell: false, stdio: 'ignore', windowsHide: true});
    child.once('error', () => resolveResult(false));
    child.once('exit', (code) => resolveResult(code === 0));
  });
}
