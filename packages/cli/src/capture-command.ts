import type {Command} from 'commander';
import {spawn} from 'node:child_process';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {
  createTileflowCaptureSession,
  serializeTileflowCaptureReceipt,
  setupTileflowCaptureBrowser,
  type TileflowCapture,
  TileflowCaptureError,
  type TileflowCaptureRendererIdentity,
  type TileflowCaptureResourceDiagnostic,
  tileflowSyntheticAssetOrigin,
  TileflowVisualReviewError,
} from '@tileflow/capture';
import {
  compareCodeUnits,
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureSceneSchema,
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
import {captureReceiptPath, writeCapturePair} from './capture-output';
import {withTileflowConfigSecretsHidden} from './config-execution';

export type CaptureCommandOptions = {
  all?: boolean;
  appOrigin?: string;
  bearing?: string;
  bounds?: string;
  browserInstall: boolean;
  center?: string;
  config: string;
  dpr?: string;
  force?: boolean;
  frame?: 'map' | 'viewport';
  height?: string;
  json?: boolean;
  map?: string;
  out?: string;
  outDir?: string;
  pitch?: string;
  selector?: string;
  theme?: string;
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
};

export type TileflowCaptureJsonEntry = {
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

export type TileflowCaptureFailureJsonV1 = {
  schemaVersion: 1;
  command: 'capture' | 'setup.capture' | 'visual.compare';
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
    .description('Render Tileflow scenes to PNG with a pinned headless browser')
    .argument('[scenes...]', 'named committed capture scenes')
    .option('-c, --config <path>', 'config path', dependencies.defaultConfigPath)
    .option('--all', 'capture every configured scene')
    .option('--map <name>', 'capture one map with an uncommitted camera')
    .option('--theme <name>', 'required concrete theme for exploratory --map capture')
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
    .option('--out <path>', 'PNG path for one capture')
    .option('--out-dir <path>', 'directory for one or more captures')
    .option('--force', 'replace different explicit output files')
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
        printCaptureError(error, {command: 'capture', json: options.json});
        process.exitCode = 1;
      }
    });
}

export function createTileflowCaptureJson(
  captures: Array<{
    capture: TileflowCapture;
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
      .map(({capture, definition, outputPath, receiptPath}) => ({
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
    if (options.watch) {
      await runCaptureWatchCommand(positionalScenes, options);
      return;
    }

    const cwd = process.cwd();
    const controller = installSignalAbortController();
    const session = createTileflowCaptureSession({
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

    try {
      const exploratoryDefinition = options.map ? createExploratoryScene(options) : undefined;
      const result = exploratoryDefinition
        ? await session.captureDefinitions(
            {[options.map!]: exploratoryDefinition},
            controller.signal,
          )
        : options.all
          ? await session.captureAll(controller.signal)
          : await session.capture(positionalScenes, controller.signal);
      const targets = resolveOutputTargets(result.captures, options, cwd);
      const written: Array<{
        capture: TileflowCapture;
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
        written.push({
          ...target,
          ...(exploratoryDefinition ? {definition: exploratoryDefinition} : {}),
        });
      }

      if (targets.some((target) => target.managed)) {
        await warnIfManagedCapturesAreNotIgnored(cwd);
      }

      const document = createTileflowCaptureJson(written, cwd);
      if (options.json) {
        process.stdout.write(serializeTileflowCaptureJson(document));
        return;
      }

      for (const entry of document.captures) {
        console.log(
          `Captured ${entry.scene} -> ${entry.outputPath} (${entry.sha256.slice(0, 12)}).`,
        );
        if (entry.networkDependent) {
          console.error(`Capture ${entry.scene} used remote map resources.`);
        }
      }
    } finally {
      await session.close();
      controller.close();
    }
  });
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
    const task = captureGeneration(state.generation, state.artifacts, activeCapture.signal);
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

  if (options.map) {
    if (!tileflowCaptureSceneNameSchema.safeParse(options.map).success) {
      throw new Error('Exploratory --map output requires a portable, non-reserved artifact name.');
    }
    if (options.watch) {
      throw new Error('--watch requires committed named scenes or --all, not exploratory --map.');
    }
    if (options.all || positionalScenes.length > 0) {
      throw new Error('Use --map only for an uncommitted exploratory capture.');
    }
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
    throw new Error('Select at least one scene, use --all, or use --map for exploration.');
  }
}

export function createExploratoryScene(
  options: CaptureCommandOptions,
): NormalizedTileflowCaptureScene {
  const map = options.map!;
  const bearing = parseFiniteNumber(options.bearing ?? '0', '--bearing');
  const pitch = parseFiniteNumber(options.pitch ?? '0', '--pitch');
  const camera = options.center
    ? {
        type: 'center' as const,
        center: parseTuple(options.center, 2, '--center') as [number, number],
        zoom: parseFiniteNumber(options.zoom!, '--zoom'),
        bearing,
        pitch,
      }
    : {
        type: 'bounds' as const,
        bounds: parseTuple(options.bounds!, 4, '--bounds') as [number, number, number, number],
        bearing,
        pitch,
      };
  const candidate = {
    map,
    theme: options.theme!,
    camera,
    viewport: {
      width: parseFiniteNumber(options.width ?? '1200', '--width'),
      height: parseFiniteNumber(options.height ?? '800', '--height'),
      dpr: parseFiniteNumber(options.dpr ?? '1', '--dpr'),
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
