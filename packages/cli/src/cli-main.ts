#!/usr/bin/env node

import {serve} from '@hono/node-server';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, realpathSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stripVTControlCharacters} from 'node:util';
import pc from 'picocolors';
import {createLocalCoordinates, setupCoordinates} from '@tileflow/coordinates-runtime';
import {auditTileflowMapThemeValues, tileflowMapIdSchema} from '@tileflow/core';
import {
  type TileflowRuntimeManifest as DeployedManifest,
  type TileflowRuntimeManifestMapEntry as DeployedManifestMap,
  parseTileflowRuntimeManifest,
} from '@tileflow/core/manifest';
import {
  resolveTileflowRenderer,
  TileflowNativeCompatibilityError,
} from '@tileflow/core/native-profile';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowStyles,
  prepareTileflowLocalTilesets,
  type TileflowArtifactSessionState,
  writeTileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';
import {
  assertValidTileflowConfig,
  defaultTileflowApiUrl,
  defaultTileflowConfigPath,
  defaultTileflowManifestPath,
  getTileflowMapNames,
  loadTileflowConfigWithInputs,
  TileflowValidationError,
} from '@tileflow/dev/config';
import {prepareTileflowStyleFonts, TileflowFontCompilationError} from '@tileflow/dev/fonts';
import {compileTileflowIconPackages, TileflowIconCompilationError} from '@tileflow/dev/icons';
import {resolveTileflowPreview} from '@tileflow/dev/preview';
import {
  createTileflowComparisonRequestHandler,
  createTileflowDevRequestHandler,
} from '@tileflow/dev/server';
import {
  createTileflowCommandFailureDocument,
  createTileflowCommandSummary,
  createTileflowStructuredDiagnostics,
  serializeTileflowCommandDocument,
  TileflowStyleValidationError,
} from '@tileflow/dev/validation';
import {
  type AuthConfig,
  type CliAccountSession,
  installAccountSession,
  loadAuthConfig,
  normalizeApiOrigin,
  prepareAccountLogin,
  removeAccountSession,
  removeAuthFile,
  resolveAccountSession,
  writeAuthFileAtomic,
} from './account-session';
import {registerAiCommands} from './ai-commands';
import {installSignalAbortController, registerCaptureCommands} from './capture-command';
import {writeAtomicFile} from './capture-output';
import {configureJsonErrors, createCliProgram} from './cli-program';
import {getCliVersion, isRootCliVersionRequest} from './cli-version';
import {registerCaptureRecordComparison} from './compare-record-command';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {registerConfigInspectCommand} from './config-inspect-command';
import {registerCoordinatesCommands} from './coordinates-command';
import {allowsStoredDeployCredential, resolveDeploySource} from './deploy-source';
import {registerDeploymentCommands} from './deployment-command';
import {registerDescribeCommand} from './describe-command';
import {
  defaultTileflowDevHost,
  parseTileflowDevHost,
  redirectTileflowDevNavigation,
  rejectTileflowDevRebinding,
  tileflowDevOrigin,
} from './dev-host';
import {registerFeatureInspectCommand} from './feature-inspect-command';
import {
  apiProfileCanTargetMap,
  fetchHostedMapStatus,
  pollDeviceToken,
  requestMapCapability,
  revokeHostedAccountSession,
  startDeviceAuthorization,
  validateAccountSession,
  validateApiKey,
} from './hosted-client';
import {type HostedFailure, HostedRequestError, safeHostedText} from './hosted-error';
import {
  describeNativeDifference,
  HostedCompatibilityError,
  type HostedDeployEvent,
  HostedDeploymentError,
  isHostedDeployOrigin,
  type NativeDifference,
  type PreparedHostedDeploy,
  prepareHostedDeploy,
  runHostedDeploy,
} from './hosted-native-deploy';
import {hostedApiKeyOption, hostedApiUrlOption, isHostedApiKey} from './hosted-options';
import {inspectTileflowHostedCompatibility} from './hosted-preflight';
import type {HostedMapStatus} from './hosted-response';
import {emitFailure, emitHostedFailure, emitJson} from './hosted-team';
import {registerIconDiffCommand} from './icon-diff-command';
import {registerIconListCommand} from './icon-list-command';
import {registerIconLockCommands} from './icon-lock-command';
import {resolveIconOptions} from './icon-options';
import {registerIconSetCommands} from './icon-set-command';
import {registerLanguageCommand} from './language-command';
import {
  addMapSetupOptions,
  createMapForDeploy,
  hasMapSetupOptions,
  registerMapCommands,
} from './map-commands';
import {checkMapSetupOptions, type MapSetupOptions} from './map-setup';
import {compiledMapAssets, mapAssetsWithBuildingModels, prepareModelAssets} from './model-assets';
import {registerModelCommands} from './model-command';
import {
  createTileflowNativePreviewRequestHandler,
  getTileflowNativePreviewManifestUrl,
  resolveTileflowNativePreviewSelection,
  tileflowNativePreviewProfile,
} from './native-preview-command';
import {enableNativePlatforms, usesTileflowNativeSdk} from './native-sdk-detection';
import {openTileflowExternal} from './open-external';
import {registerProjectCommands} from './project-commands';
import {runRendererArtifactCommand} from './renderer-artifact-command';
import {isRestoreJsonCommand, parseRestoreJson} from './restore-guidance';
import {registerTilesetCommands, registerTilesetInspectCommand} from './tileset-command';
import {registerVisualCommands} from './visual-command';
import {createWorkbenchService, registerWorkbenchInspection} from './workbench-service';

const program = createCliProgram();
// Deploy's machine output is one document; shared human printers stay quiet in this mode.
let deployJson = false;
let deployFailureWritten = false;
let deploySecrets: string[] = [];
const deployErrors: string[] = [];
const deployWarnings: string[] = [];
const defaultApiUrl = defaultTileflowApiUrl;
const defaultAppUrl = 'https://tileflow.dev';
const defaultConfigPath = defaultTileflowConfigPath;
const defaultManifestPath = defaultTileflowManifestPath;

registerDescribeCommand(program);
registerLanguageCommand(program);
registerTilesetCommands(program, {defaultApiUrl, loadAuthConfig});
registerIconSetCommands(program, {defaultApiUrl, loadAuthConfig});
registerModelCommands(program, {defaultApiUrl, loadAuthConfig});

program
  .command('init')
  .description('Create a starter tileflow.config.ts')
  .option('-f, --force', 'overwrite an existing config')
  .option('--native', 'publish for web and native apps')
  .option('--no-native', 'publish for web only')
  .action(async (options: {force?: boolean; native?: boolean}) => {
    const configPath = resolve(process.cwd(), defaultConfigPath);
    const ignorePath = resolve(process.cwd(), '.gitignore');

    if (existsSync(configPath) && !options.force) {
      logWarning(`${pathLabel(defaultConfigPath)} already exists.`);
      printNextSteps([`Run ${command('tileflow init --force')} to replace it.`]);
      return;
    }

    let native = options.native;
    if (native === undefined && process.stdin.isTTY) {
      const input = createInterface({input: process.stdin, output: process.stdout});
      try {
        const answer = await input.question('Publish for web and native apps? [y/N] ');
        native = /^y(?:es)?$/iu.test(answer.trim());
      } finally {
        input.close();
      }
    }
    await writeFile(configPath, starterConfig(native === true), 'utf8');
    if (!existsSync(ignorePath)) {
      await writeFile(
        ignorePath,
        '# Tileflow generated visual evidence\n.tileflow/captures/\n.tileflow/diffs/\n',
        'utf8',
      );
    }
    logSuccess(`Created ${pathLabel(defaultConfigPath)}.`);
    printKeyValue('Path', pathLabel(configPath));
    printKeyValue('Map', pc.bold('madrid'));
    printNextSteps([
      `Install ${pc.cyan('@tileflow/core')} and ${pc.cyan('@tileflow/maps')} in this project if needed.`,
      `Preview locally with ${command('tileflow preview')}.`,
      `Validate the config with ${command('tileflow validate')}.`,
    ]);
  });

program
  .command('login')
  .description('Authorize this machine for your Tileflow account')
  .addOption(hostedApiUrlOption())
  .option(
    '--app-url <url>',
    'Tileflow Dashboard URL',
    process.env.TILEFLOW_APP_URL ?? defaultAppUrl,
  )
  .option('--no-browser', 'print the authorization URL without opening it')
  .action(async (options: {apiUrl?: string; appUrl?: string; browser?: boolean}) => {
    const apiUrl = normalizeUrl(options.apiUrl ?? defaultApiUrl);
    const appUrl = normalizeUrl(options.appUrl ?? defaultAppUrl);

    try {
      await loginWithDeviceFlow({
        expectedApiUrl: apiUrl,
        appUrl,
        noBrowser: options.browser === false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';
      logError(message);
      process.exitCode = 1;
    }
  });

program
  .command('logout')
  .description("Revoke this origin's Tileflow account session")
  .addOption(hostedApiUrlOption())
  .action(async (options: {apiUrl?: string}) => {
    const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
    const config = await loadAuthConfig().catch((error: unknown) => {
      logError(safeAuthError(error));
      return null;
    });
    if (!config) {
      process.exitCode = 1;
      return;
    }
    const session = config.sessions[apiUrl];
    if (!session) {
      logWarning('No Tileflow login is saved.');
      return;
    }

    if (!(await revokeHostedAccountSession(apiUrl, session.accountSession))) {
      logError('Could not revoke the Tileflow account session; local state was preserved.');
      process.exitCode = 1;
      return;
    }

    const removed = removeAccountSession(config, apiUrl);
    if (Object.keys(removed.config.sessions).length) {
      await writeAuthFileAtomic(removed.config);
    } else {
      await removeAuthFile();
    }
    logSuccess('Signed out of this Tileflow origin.');
  });

program
  .command('whoami')
  .description('Show the authenticated Tileflow account')
  .addOption(hostedApiUrlOption())
  .option('--json', 'print deterministic schema-version-1 JSON')
  .action(async (options: {apiUrl?: string; json?: boolean}) => {
    const config = await loadAuthConfig().catch((error: unknown) => {
      logAuthCommandError(options.json, safeAuthError(error));
      return null;
    });
    if (!config) return;
    const selected = resolveAccountSession(config, options.apiUrl ?? defaultApiUrl);

    if (selected.kind !== 'selected') {
      const message =
        selected.kind === 'expired'
          ? 'The Tileflow account session has expired.'
          : 'Not logged in.';
      if (options.json) {
        logAuthCommandError(true, message);
        return;
      }
      logError(message);
      printNextSteps([`Run ${command('tileflow login')} to authorize this machine.`]);
      process.exitCode = 1;
      return;
    }

    const profile = await validateAccountSession(selected.session);

    if (!profile.ok) {
      logAuthCommandError(options.json, profile.error);
      return;
    }

    const document = {
      schemaVersion: 1,
      account: profile.value.account,
      apiUrl: selected.session.apiOrigin,
      session: profile.value.session,
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(document)}\n`);
      return;
    }

    logSuccess('Tileflow CLI is authenticated.');
    printAccountDetails(selected.session);
  });

program
  .command('validate')
  .description('Validate a Tileflow config')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--target <target>', 'validation target: local or hosted', 'local')
  .option('--renderer <renderer>', 'artifact renderer: web or native', 'web')
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .option('--cache-dir <path>', 'verified Icon Set artifact cache root')
  .option('--offline', 'fail a locked Icon Set cache miss instead of hydrating it')
  .option('--json', 'print deterministic schema-version-1 JSON')
  .action(
    async (options: {
      apiBaseUrl: string;
      cacheDir?: string;
      config: string;
      json?: boolean;
      offline?: boolean;
      renderer: string;
      target: string;
    }) => {
      if (options.renderer !== 'web') {
        await runRendererArtifactCommand('validate', {
          ...options,
          icons: resolveIconOptions(options),
        });
        return;
      }
      if (options.target !== 'local' && options.target !== 'hosted') {
        if (options.json) {
          const failure = createTileflowCommandFailureDocument(
            'validate',
            {
              code: 'INVALID_TARGET',
              issues: [
                {
                  code: 'INVALID_TARGET',
                  message: `Invalid validation target: ${options.target}`,
                  path: 'target',
                  phase: 'command-validation',
                },
              ],
              phase: 'command-validation',
            },
            process.cwd(),
            {code: 'INVALID_TARGET', phase: 'command-validation'},
          );
          process.stderr.write(serializeTileflowCommandDocument(failure));
          process.exitCode = 1;
          return;
        }
        logError(`Invalid validation target: ${options.target}`);
        printNextSteps([
          `Use ${command('tileflow validate --target local')} or ${command('tileflow validate --target hosted')}.`,
        ]);
        process.exitCode = 1;
        return;
      }

      let failureDefaults = {code: 'CONFIG_LOAD_FAILED', phase: 'config-load'};
      try {
        if (!options.json) logInfo(`Validating ${pathLabel(options.config)}.`);
        const loaded = await withTileflowConfigSecretsHidden(() =>
          loadTileflowConfigWithInputs(options.config),
        );
        const project = loaded.project;
        const baseDirectory = dirname(loaded.configFile);
        failureDefaults = {code: 'CONFIG_INVALID', phase: 'config-validation'};
        assertValidTileflowConfig(project);

        const mapNames = getTileflowMapNames(project).sort();
        failureDefaults = {code: 'ICON_COMPILATION_FAILED', phase: 'icon-compilation'};
        const compiledIcons = await compileTileflowIconPackages(project, {
          baseDirectory,
          cwd: process.cwd(),
          icons: resolveIconOptions(options),
          target: options.target,
        });
        const modelAssets = await prepareModelAssets(project, {
          baseDirectory,
          target: options.target,
        });
        const mapAssets = compiledMapAssets(
          compiledIcons,
          (binding) =>
            options.target === 'hosted'
              ? `${normalizeUrl(options.apiBaseUrl)}/sprites/preflight/${binding.packageHash}/sprite`
              : `/tileflow/icons/${binding.mapName}/sprite`,
          mapAssetsWithBuildingModels(
            modelAssets,
            options.target === 'hosted'
              ? {hosted: true}
              : {localBase: (mapName) => `/tileflow/models/${mapName}`},
          ),
        );
        failureDefaults = {code: 'STYLE_INVALID', phase: 'style-validation'};
        const compiledStyles = createTileflowStyles(project, {
          apiBaseUrl: options.apiBaseUrl,
          mapAssets,
        });
        failureDefaults = {code: 'TF_LOCAL_TILESET_INVALID', phase: 'local-tileset-resolution'};
        const localTilesets = await prepareTileflowLocalTilesets(project, compiledStyles, {
          assetBaseUrl: '/tileflow',
          baseDirectory,
          cwd: process.cwd(),
        });
        failureDefaults = {code: 'FONT_COMPILATION_FAILED', phase: 'font-compilation'};
        const {styles} = await prepareTileflowStyleFonts(project, localTilesets.styles, {
          apiBaseUrl: options.apiBaseUrl,
          assetBaseUrl: '/tileflow',
          baseDirectory,
          cwd: process.cwd(),
          target: options.target,
        });
        failureDefaults = {code: 'HOSTED_INCOMPATIBLE', phase: 'hosted-validation'};
        const hostedIssues =
          options.target === 'hosted' ? inspectTileflowHostedCompatibility(project, styles) : [];
        if (hostedIssues.length > 0) {
          if (!options.json) {
            printHostedCompatibilityIssues(hostedIssues);
            return;
          }
          throw Object.assign(new Error('Tileflow config is not Hosted-compatible.'), {
            code: 'HOSTED_INCOMPATIBLE',
            issues: hostedIssues.map((issue) => ({
              code: 'HOSTED_INCOMPATIBLE',
              message: issue.message,
              path: issue.path,
              phase: 'hosted-validation',
            })),
            phase: 'hosted-validation',
          });
        }

        const themeWarnings = mapNames.flatMap((mapName) =>
          auditTileflowMapThemeValues(project.maps[mapName]!).filter(
            ({severity}) => severity === 'warning',
          ),
        );
        const diagnostics =
          themeWarnings.length === 0
            ? []
            : createTileflowStructuredDiagnostics({diagnostics: themeWarnings}, process.cwd(), {
                code: 'VALIDATION_WARNING',
                phase: 'theme-audit',
              });

        const sharedIconMaps = Object.keys(compiledIcons.compositions).sort();
        const checks = [
          'Config schema',
          'Icon asset closure',
          ...(sharedIconMaps.length > 0 ? ['Locked Icon Set composition'] : []),
          'Text provider closure',
          'Named map styles',
          'MapLibre style semantics',
          ...(options.target === 'hosted' ? ['Hosted compatibility'] : []),
        ];
        if (options.json) {
          const summary = createTileflowCommandSummary({
            code: 'VALIDATION_OK',
            command: 'validate',
            message: `Tileflow config is valid (${plural(mapNames.length, 'map')}).`,
            ok: true,
            path: '',
            phase: 'validation',
            severity: 'info',
            suggestion: 'No changes are required.',
          });
          process.stdout.write(
            serializeTileflowCommandDocument({
              ...summary,
              target: options.target,
              maps: mapNames,
              checks,
              diagnostics,
            }),
          );
          return;
        }

        logSuccess(`Config is valid (${plural(mapNames.length, 'map')}).`);
        printChecks(checks);
        for (const diagnostic of diagnostics) {
          logWarning(`${diagnostic.path || '(root)'}: ${diagnostic.message}`);
        }
      } catch (error) {
        if (!options.json) throw error;
        const failure = createTileflowCommandFailureDocument(
          'validate',
          error,
          process.cwd(),
          failureDefaults,
        );
        process.stderr.write(serializeTileflowCommandDocument(failure));
        process.exitCode = 1;
      }
    },
  );

program
  .command('build')
  .description('Generate static Tileflow styles')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('-o, --out <path>', 'output directory', 'dist/tileflow')
  .option('--renderer <renderer>', 'artifact renderer: web or native', 'web')
  .option('--target <target>', 'artifact target: local or hosted (build supports local)', 'local')
  .option('--json', 'print deterministic schema-version-1 JSON')
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .option('--cache-dir <path>', 'verified Icon Set artifact cache root')
  .option('--offline', 'fail a locked Icon Set cache miss instead of hydrating it')
  .option(
    '--inline-tilejson',
    'write the TileJSON of exact World release sources into the styles, read once now',
  )
  .action(
    async (options: {
      apiBaseUrl: string;
      cacheDir?: string;
      config: string;
      inlineTilejson?: boolean;
      json?: boolean;
      offline?: boolean;
      out: string;
      renderer: string;
      target: string;
    }) => {
      const icons = resolveIconOptions(options);
      if (options.renderer !== 'web' || options.target !== 'local' || options.json) {
        if (options.inlineTilejson)
          throw new Error('--inline-tilejson applies to web builds with --target local.');
        await runRendererArtifactCommand('build', {...options, icons});
        return;
      }
      logInfo(`Building ${pathLabel(options.config)}.`);
      await withTileflowConfigSecretsHidden(() =>
        writeTileflowBuildArtifacts({
          config: options.config,
          outDir: options.out,
          styleBaseUrl: '.',
          apiBaseUrl: options.apiBaseUrl,
          ...(icons ? {icons} : {}),
          ...(options.inlineTilejson ? {inlineTileJson: true} : {}),
        }),
      );

      logSuccess('Built Tileflow artifacts.');
      printKeyValue('Output', pathLabel(resolve(process.cwd(), options.out)));
    },
  );

program
  .command('preview')
  .description('Open Inspector with inspection and optional comparison')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--against-config <path>', 'second config for live comparison in Inspector')
  .option('--against-map <name>', 'map on the right; defaults to --map')
  .option('--against-scene <name>', 'committed standalone scene on the right')
  .option('--against-theme <name>', 'concrete theme on the right; defaults to --theme')
  .option('--host <host>', 'bind host: an explicit IP address or localhost', defaultTileflowDevHost)
  .option('--map <name>', 'preview one configured map')
  .option('--theme <name>', 'preview one concrete theme; defaults to the map default')
  .option('--renderer <renderer>', 'artifact renderer: web or native', 'web')
  .option('-p, --port <port>', 'preview port', '3333')
  .option('--no-open', 'start Inspector without opening the browser')
  .option('--scene <name>', 'preview one committed standalone map scene')
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .option('--cache-dir <path>', 'verified Icon Set artifact cache root')
  .option('--offline', 'fail a locked Icon Set cache miss instead of hydrating it')
  .option('--json', 'emit schema-version-1 NDJSON lifecycle events')
  .action(
    async (options: {
      apiBaseUrl: string;
      againstConfig?: string;
      againstMap?: string;
      againstScene?: string;
      againstTheme?: string;
      cacheDir?: string;
      config: string;
      host: string;
      json?: boolean;
      map?: string;
      offline?: boolean;
      open: boolean;
      port: string;
      renderer: string;
      scene?: string;
      theme?: string;
    }) => {
      let renderer: 'native' | 'web';
      try {
        renderer = resolveTileflowRenderer(options.renderer);
      } catch (error) {
        const diagnostics = createTileflowArtifactDiagnostics(error, process.cwd());
        if (options.json) {
          const first = diagnostics[0];
          process.stdout.write(
            `${JSON.stringify({
              schemaVersion: 1,
              command: 'preview',
              event: 'error',
              code: first?.code ?? 'NATIVE_RENDERER_UNSUPPORTED',
              phase: first?.phase ?? 'command-validation',
              diagnostics,
            })}\n`,
          );
        } else {
          logError(diagnostics[0]?.message ?? 'Unsupported artifact renderer.');
        }
        process.exitCode = 1;
        return;
      }

      const comparisonRequested =
        options.againstConfig !== undefined ||
        options.againstMap !== undefined ||
        options.againstScene !== undefined ||
        options.againstTheme !== undefined;
      if (renderer === 'native' && (options.scene !== undefined || comparisonRequested)) {
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              schemaVersion: 1,
              command: 'preview',
              event: 'error',
              code: 'NATIVE_RENDERER_UNSUPPORTED',
              phase: 'command-validation',
              renderer: 'native',
              profile: tileflowNativePreviewProfile,
            })}\n`,
          );
        } else {
          logError(
            'Native preview serves assets only; scenes and live comparison options are unavailable.',
          );
        }
        process.exitCode = 1;
        return;
      }

      const port = parsePort(options.port);
      if (port === null) {
        logError(`Invalid port: ${options.port}`);
        process.exitCode = 1;
        return;
      }

      if (options.map !== undefined && options.scene !== undefined) {
        logError('Choose either --map or --scene, not both.');
        process.exitCode = 1;
        return;
      }
      if (options.scene !== undefined && options.theme !== undefined) {
        logError('A committed scene owns its theme; do not combine --scene and --theme.');
        process.exitCode = 1;
        return;
      }
      if (options.theme !== undefined && options.map === undefined) {
        logError('--theme requires an explicit --map.');
        process.exitCode = 1;
        return;
      }

      if (options.againstMap !== undefined && options.againstScene !== undefined) {
        logError('Choose either --against-map or --against-scene, not both.');
        process.exitCode = 1;
        return;
      }
      if (options.againstScene !== undefined && options.againstTheme !== undefined) {
        logError(
          'A committed scene owns its theme; do not combine --against-scene and --against-theme.',
        );
        process.exitCode = 1;
        return;
      }
      if (
        options.againstTheme !== undefined &&
        options.againstMap === undefined &&
        options.map === undefined
      ) {
        logError('--against-theme requires --against-map or --map.');
        process.exitCode = 1;
        return;
      }

      const host = parseTileflowDevHost(options.host);
      if (!host) {
        logError('--host expects an IP address or localhost.');
        process.exitCode = 1;
        return;
      }

      if (comparisonRequested) {
        await runTileflowComparisonPreview(options, {host, port});
        return;
      }

      await withTileflowConfigSecretsHidden(async () => {
        const origin = tileflowDevOrigin(host, port);
        const previewBasePath = renderer === 'web' ? '/map' : '';
        const captureConfig =
          renderer === 'web' ? comparisonCaptureConfigArgument(options.config) : undefined;
        const manifestUrl =
          renderer === 'native' ? getTileflowNativePreviewManifestUrl(origin) : undefined;
        const nativeLifecycleFields = manifestUrl
          ? {
              renderer: 'native' as const,
              profile: tileflowNativePreviewProfile,
              manifest: manifestUrl,
              assetsOnly: true,
            }
          : {};
        const icons = resolveIconOptions(options);
        const session = await createTileflowArtifactSession({
          assetBaseUrl: `${origin}${previewBasePath}`,
          apiBaseUrl: options.apiBaseUrl,
          config: options.config,
          ...(icons ? {icons} : {}),
          // Locally built sprites and fonts are served over HTTP from this exact origin only.
          ...(renderer === 'native'
            ? {developmentOrigin: origin, renderer: 'native' as const}
            : {}),
          inspection: renderer === 'web',
          styleBaseUrl: `${origin}${previewBasePath}`,
          watch: true,
        });
        const initialArtifacts = session.getLastGoodArtifacts();
        let nativeSelection: ReturnType<typeof resolveTileflowNativePreviewSelection> | undefined;

        try {
          if (initialArtifacts) {
            if (renderer === 'native') {
              nativeSelection = resolveTileflowNativePreviewSelection(initialArtifacts.manifest, {
                map: options.map,
                theme: options.theme,
              });
            } else {
              resolveTileflowPreview(initialArtifacts.project, {
                map: options.map,
                scene: options.scene,
                theme: options.theme,
              });
            }
          }
        } catch (error) {
          await session.close();
          logError(error instanceof Error ? error.message : 'Invalid Tileflow preview selection.');
          process.exitCode = 1;
          return;
        }

        const previewHandler =
          renderer === 'native'
            ? createTileflowNativePreviewRequestHandler({
                config: options.config,
                apiBaseUrl: options.apiBaseUrl,
                onError: printTileflowPreviewError,
                session,
              })
            : createTileflowDevRequestHandler({
                fitViewport: true,
                basePath: previewBasePath,
                config: options.config,
                apiBaseUrl: options.apiBaseUrl,
                map: options.map,
                onError: printTileflowPreviewError,
                scene: options.scene,
                session,
                theme: options.theme,
              });
        const selectedPreview =
          renderer === 'web' && initialArtifacts
            ? resolveTileflowPreview(initialArtifacts.project, {
                map: options.map,
                scene: options.scene,
                theme: options.theme,
              })
            : undefined;
        const workbench =
          renderer === 'web'
            ? createWorkbenchService({
                origin,
                cwd: process.cwd(),
                sides: {left: {session, basePath: previewBasePath, config: captureConfig}},
              })
            : undefined;
        const fetch =
          renderer === 'native'
            ? previewHandler
            : createTileflowComparisonRequestHandler({
                left: {
                  basePath: previewBasePath,
                  captureConfig,
                  handler: previewHandler,
                  label: selectedPreview?.label ?? 'Map',
                  previewUrl: workbenchPreviewUrl(previewBasePath, options),
                  sidecarUrl: `${previewBasePath}/__inspection/${selectedPreview?.mapName ?? 'pending'}/${selectedPreview?.themeName ?? 'pending'}.json`,
                },
                title: 'Tileflow Inspector',
                workbench,
              });
        let invalidSinceLastReady = false;
        const emitState = (state: TileflowArtifactSessionState) => {
          const recovered = invalidSinceLastReady && state.status === 'ready';
          if (state.status === 'invalid') invalidSinceLastReady = true;
          if (state.status === 'ready') invalidSinceLastReady = false;
          if (options.json) {
            const firstDiagnostic = state.status === 'invalid' ? state.diagnostics[0] : undefined;
            process.stdout.write(
              `${JSON.stringify({
                schemaVersion: 1,
                command: 'preview',
                event: recovered ? 'recovered' : state.status,
                generation: state.generation,
                ...('lastGoodGeneration' in state && state.lastGoodGeneration !== undefined
                  ? {lastGoodGeneration: state.lastGoodGeneration}
                  : {}),
                ...(firstDiagnostic?.code ? {code: firstDiagnostic.code} : {}),
                ...(firstDiagnostic?.phase ? {phase: firstDiagnostic.phase} : {}),
                ...(state.status === 'invalid' ? {diagnostics: state.diagnostics} : {}),
                ...nativeLifecycleFields,
              })}\n`,
            );
            return;
          }
          if (state.status === 'invalid') {
            console.error(
              [
                renderer === 'native'
                  ? `Tileflow generation ${state.generation} is invalid; preserving the last valid native artifact family.`
                  : `Tileflow generation ${state.generation} is invalid; preserving the last valid preview.`,
                ...state.diagnostics.map(
                  (diagnostic) => `- ${diagnostic.path || '(root)'}: ${diagnostic.message}`,
                ),
              ].join('\n'),
            );
          } else if (recovered) {
            logSuccess(
              renderer === 'native'
                ? `Tileflow native artifact preview recovered at generation ${state.generation}.`
                : `Tileflow preview recovered at generation ${state.generation}.`,
            );
          }
        };
        emitState(session.getState());
        const unsubscribe = session.subscribe(emitState);
        let server: ReturnType<typeof serve> | undefined;

        try {
          await new Promise<void>((resolveListening, rejectListening) => {
            const createdServer = serve(
              {
                fetch: (request) =>
                  rejectTileflowDevRebinding(request) ??
                  (renderer === 'web'
                    ? redirectTileflowDevNavigation(request, origin)
                    : undefined) ??
                  fetch(request),
                hostname: host,
                port,
              },
              () => resolveListening(),
            );
            createdServer.once('error', rejectListening);
            server = createdServer;
          });
          if (!options.json) {
            if (renderer === 'native') {
              logSuccess('Tileflow native artifact preview is running and watching for changes.');
              printKeyValue('Manifest', link(manifestUrl!));
              printKeyValue('Profile', tileflowNativePreviewProfile);
              printKeyValue('Endpoint', 'assets-only');
              printKeyValue('Config', pathLabel(options.config));
              if (nativeSelection) {
                printKeyValue('Map', nativeSelection.mapName);
                printKeyValue('Theme', nativeSelection.themeName);
              }
              logMuted('Metro remains the JavaScript development server. Press Ctrl+C to stop.');
            } else {
              logSuccess('Tileflow Inspector is running and watching for changes.');
              printKeyValue('Local', link(origin));
              printKeyValue('Config', pathLabel(options.config));
              if (options.map) printKeyValue('Map', options.map);
              if (options.theme) printKeyValue('Theme', options.theme);
              if (options.scene) printKeyValue('Scene', options.scene);
              logMuted('Press Ctrl+C to stop.');
              if (options.open) openBrowser(origin);
            }
          }
          await waitForTerminationSignal(server!);
        } finally {
          unsubscribe();
          await closeNodeServer(server);
          await workbench?.close();
          const generation = session.getState().generation;
          await session.close();
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                schemaVersion: 1,
                command: 'preview',
                event: 'stopped',
                generation,
                ...nativeLifecycleFields,
              })}\n`,
            );
          }
        }
      });
    },
  );

addMapSetupOptions(
  program
    .command('deploy')
    .description(
      'Deploy a map to Tileflow and write the frontend manifest; without --map-id, create the Map first',
    ),
)
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--manifest <path>', 'manifest path written for frontend bundlers', defaultManifestPath)
  .addOption(hostedApiUrlOption())
  .addOption(hostedApiKeyOption('Tileflow API key'))
  .option('--map-id <id>', 'managed Map destination; omit it to create a new Map')
  .option('--json', 'print deterministic schema-version-1 JSON')
  .option('--map <name>', 'configured map to connect when the repository contains multiple maps')
  .option(
    '--overwrite-self-hosted-manifest',
    'explicitly replace an existing self-hosted manifest at --manifest',
  )
  .option('--cache-dir <path>', 'verified Icon Set artifact cache root')
  .option('--offline', 'fail a locked Icon Set cache miss instead of hydrating it')
  .action(
    async (
      options: MapSetupOptions & {
        cacheDir?: string;
        config: string;
        manifest: string;
        apiUrl?: string;
        apiKey?: string;
        mapId?: string;
        map?: string;
        offline?: boolean;
        json?: boolean;
        overwriteSelfHostedManifest?: boolean;
      },
    ) => {
      deployJson = options.json === true;
      deploySecrets = options.apiKey ? [options.apiKey] : [];
      let mapCreation: {createdMapId: string; setupKey: string; nextSteps: string[]} | undefined;
      try {
        const source = resolveDeploySource(process.env);
        if (!validateMapSetupTarget(options, source)) return;
        const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
        if (!isHostedDeployOrigin(apiUrl)) {
          logError('Hosted deploy requires an HTTPS Tileflow API URL (HTTP only on localhost).');
          process.exitCode = 1;
          return;
        }
        // The config is executable repository code. Keep the captured bearer
        // credential for the HTTP request, but do not expose it while Jiti
        // imports tileflow.config.ts or anything that file imports.
        delete process.env.TILEFLOW_API_KEY;

        logInfo(`Deploying ${pathLabel(options.config)}.`);
        const loaded = await withTileflowConfigSecretsHidden(() =>
          loadTileflowConfigWithInputs(options.config),
        );
        const project = loaded.project;
        assertValidTileflowConfig(project);
        const mapNames = selectManagedDeployMaps(getTileflowMapNames(project), options);
        if (!mapNames) return;
        if (!validateDeployTarget(options)) return;
        if (!validateDeployManifestMapNames(mapNames)) return;
        const mapName = mapNames[0]!;

        // The selected renderer families are prepared before any authentication or remote write, so an
        // invalid map always fails without network access.
        let prepared: PreparedHostedDeploy;
        try {
          prepared = await prepareHostedDeploy({
            project,
            configFile: loaded.configFile,
            mapName,
            apiUrl,
            ...(resolveIconOptions(options) ? {icons: resolveIconOptions(options)} : {}),
          });
        } catch (error) {
          if (!(error instanceof HostedCompatibilityError)) throw error;
          printHostedCompatibilityIssues(error.issues.map((message) => ({message})));
          return;
        }

        let createdMapId: string | null = null;
        if (
          prepared.preflight.schemaVersion === 1 &&
          (await usesTileflowNativeSdk(loaded.configFile))
        )
          logWarning(
            `This repository uses a Tileflow native SDK. To publish this map for native apps, add: ${enableNativePlatforms}`,
          );
        let result: Awaited<ReturnType<typeof runHostedDeploy>>;
        try {
          result = await runHostedDeploy(
            prepared,
            {
              apiUrl,
              manifest: options.manifest,
              overwriteSelfHostedManifest: options.overwriteSelfHostedManifest === true,
            },
            {
              source,
              loadManifest: loadExistingDeployManifest,
              writeManifest: writeDeployManifest,
              progress: printHostedDeployProgress,
              async resolveTarget({existing}) {
                // Authentication and Map creation may perform network requests; they follow every
                // deterministic config, asset, style, font, compatibility and manifest check.
                if (!options.mapId) {
                  const deployedMapId = existing?.maps[mapName]?.mapId;
                  if (deployedMapId) {
                    logError(`${pc.bold(mapName)} is already deployed to ${deployedMapId}.`);
                    printNextSteps([
                      `Deploy it again with ${command(`tileflow deploy --map-id ${deployedMapId}`)}.`,
                    ]);
                    process.exitCode = 1;
                    return null;
                  }
                  createdMapId = await createMapForDeploy(options, {
                    defaultApiUrl,
                    loadAuthConfig,
                    onCreated: (createdMapId, setupKey) => {
                      mapCreation = {
                        createdMapId,
                        setupKey,
                        nextSteps: [
                          `Run your original deploy command again with --map-id ${createdMapId}. Keep its --config, --map, --manifest and --api-url options, and omit Map creation flags (--team, --origin, --any-website and --setup-key).`,
                        ],
                      };
                    },
                  });
                  if (!createdMapId) {
                    deployFailureWritten = true;
                    return null;
                  }
                  options.mapId = createdMapId;
                }
                return requireApiOptions(options, {
                  allowStoredCredential: allowsStoredDeployCredential(source),
                  assertExplicitKeyMap: true,
                  capabilityScopes: ['styles:write'],
                  onFailure: (code, message, failure, steps = []) => {
                    const safeSteps = steps
                      .map((step) => safeHostedText(stripVTControlCharacters(step), deploySecrets))
                      .filter((step): step is string => step !== undefined);
                    if (failure)
                      throw new HostedRequestError('Deploy authorization', failure, safeSteps);
                    const nextSteps = [...safeSteps, ...(mapCreation?.nextSteps ?? [])];
                    if (options.json) {
                      emitFailure(
                        true,
                        code,
                        safeHostedText(message, deploySecrets) ?? 'Deploy authorization failed.',
                        {
                          ...(mapCreation ?? {}),
                          ...(nextSteps.length ? {nextSteps} : {}),
                        },
                      );
                    } else {
                      logError(message);
                      if (nextSteps.length) printNextSteps(nextSteps);
                    }
                    deployFailureWritten = true;
                  },
                });
              },
            },
          );
        } catch (error) {
          if (!(error instanceof HostedDeploymentError)) throw error;
          if (error.failure) {
            emitHostedFailure(
              options.json,
              error.operation ?? `Deploy for ${mapName}`,
              error.failure,
              {
                ...(mapCreation ?? {}),
                ...(deployWarnings.length ? {warnings: deployWarnings} : {}),
                nextSteps: [
                  'The local manifest was preserved.' +
                    (error.resumable ? ' Run the same deploy again to resume.' : ''),
                ],
              },
            );
            deployFailureWritten = true;
            return;
          }
          logError(error.message);
          printNextSteps(
            error.resumable
              ? [
                  'The local manifest was preserved. Run the same deploy again: it resumes where this one stopped.',
                ]
              : ['The local manifest was preserved.'],
          );
          process.exitCode = 1;
          return;
        }
        if (!result) return;

        const versionLabel = ` (v${result.version})`;
        logSuccess(
          result.changed
            ? `Published ${pc.bold(result.mapName)}${versionLabel} for ${result.nativeManifestUrl ? 'web and native apps' : 'web'}.`
            : `Unchanged ${pc.bold(result.mapName)}${versionLabel}.`,
        );
        printNativeDifferences(result.mapName, result.nativeDifferences);
        // Hosted maps draw a Team 3D model's published current version, not the project's files.
        for (const teamModel of result.teamModels) {
          if (teamModel.sources !== 'differ') continue;
          logWarning(
            `3D model ${pc.bold(teamModel.model)} draws its published version ${teamModel.version}, which was not prepared from this project's files. Run \`tileflow models publish\` to publish them.`,
          );
        }
        if (options.json)
          emitJson({
            command: 'deploy',
            ok: true,
            schemaVersion: 1,
            manifestPath: result.manifestPath,
            maps: {[result.mapName]: result.entry},
            ...(mapCreation ?? {}),
            ...(deployWarnings.length ? {warnings: deployWarnings} : {}),
          });
        printKeyValue('Manifest', pathLabel(result.manifestPath));
        if (result.nativeManifestUrl) printKeyValue('Native', link(result.nativeManifestUrl));
        printDeployedMaps({[result.mapName]: result.entry});
        printNextSteps([
          ...(createdMapId
            ? [`Deploy later changes with ${command(`tileflow deploy --map-id ${createdMapId}`)}.`]
            : []),
          `Check hosted state with ${command(`tileflow status --map-id ${result.mapId}`)}.`,
        ]);
      } catch (error) {
        if (error instanceof HostedRequestError) {
          emitHostedFailure(options.json, error.operation, error.failure, {
            ...(mapCreation ?? {}),
            ...(error.nextSteps.length
              ? {nextSteps: [...error.nextSteps, ...(mapCreation?.nextSteps ?? [])]}
              : {}),
            ...(deployWarnings.length ? {warnings: deployWarnings} : {}),
          });
          deployFailureWritten = true;
        } else if (options.json) {
          printCliError(error);
          process.exitCode = 1;
        } else {
          throw error;
        }
      } finally {
        if (options.json && process.exitCode && !deployFailureWritten) {
          emitFailure(true, 'deploy_failed', deployErrors[0] ?? 'Deploy failed.', {
            ...(mapCreation ?? {}),
            ...(deployErrors.length > 1
              ? {messages: deployErrors.slice(0, 16).map((message) => ({message}))}
              : {}),
            ...(deployWarnings.length ? {warnings: deployWarnings} : {}),
          });
        }
        deployJson = false;
      }
    },
  );

program
  .command('status')
  .description('Show deployed compiled styles')
  .addOption(hostedApiUrlOption())
  .addOption(hostedApiKeyOption('Tileflow API key'))
  .option('--map-id <id>', 'managed Map destination')
  .option('--json', 'print raw JSON')
  .action(async (options: {apiUrl?: string; apiKey?: string; json?: boolean; mapId?: string}) => {
    if (!options.mapId || !/^map_[A-Za-z0-9_-]{16}$/u.test(options.mapId)) {
      if (options.json) console.error('Status requires a valid --map-id.');
      else logError('Status requires a valid --map-id.');
      process.exitCode = 1;
      return;
    }
    let api: {apiKey: string; apiUrl: string} | null;
    try {
      api = await requireApiOptions(options, {
        capabilityScopes: ['status:read'],
        silent: options.json,
      });
    } catch (error) {
      if (options.json) {
        console.error(safeStatusError(error));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (!api) {
      if (options.json) console.error('Status authentication failed.');
      return;
    }

    let status: HostedMapStatus;
    try {
      status = await fetchHostedMapStatus(api);
    } catch (error) {
      const message = safeStatusError(error);
      if (options.json) console.error(message);
      else logError(message);
      process.exitCode = 1;
      return;
    }
    if (status.mapId !== options.mapId) {
      if (options.json) console.error('Status response belongs to another Map.');
      else logError('Status response belongs to another Map.');
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      printHumanLine(JSON.stringify(status, null, 2));
      return;
    }

    printMapStatus(status, api.apiUrl);
  });

registerDeploymentCommands(program, {
  resolveApi: (options, behavior) => {
    const source = resolveDeploySource(process.env);
    return requireApiOptions(options, {
      ...behavior,
      allowStoredCredential: allowsStoredDeployCredential(source),
      assertExplicitKeyMap: true,
    });
  },
});

const iconsCommand = program.command('icons').description('Inspect managed Tileflow icons');

registerIconLockCommands(program, {defaultApiUrl, defaultConfigPath, loadAuthConfig});
registerIconListCommand(iconsCommand, {defaultConfigPath});
registerIconDiffCommand(iconsCommand, {
  defaultApiUrl,
  defaultConfigPath,
  openReport: (path) => openBrowser(path, true),
  resolveApi: (options) => {
    const source = resolveDeploySource(process.env);
    return requireApiOptions(options, {
      assertExplicitKeyMap: true,
      allowStoredCredential: allowsStoredDeployCredential(source),
      capabilityScopes: ['status:read'],
      silent: true,
    });
  },
});
const inspectCommand = program.command('inspect').description('Inspect map data for authoring');
registerWorkbenchInspection(inspectCommand);
registerConfigInspectCommand(inspectCommand, {defaultConfigPath});
registerFeatureInspectCommand(inspectCommand, {defaultConfigPath});
registerAiCommands(program, {defaultApiUrl, defaultConfigPath});
registerCaptureCommands(program, {defaultConfigPath});
registerCoordinatesCommands(program, {createLocalCoordinates, setupCoordinates});
registerVisualCommands(program, {
  defaultConfigPath,
  openReport: (path) => openBrowser(path, true),
});
const compareCommand = registerVisualCommands(
  program,
  {
    defaultConfigPath,
    openReport: (path) => openBrowser(path, true),
  },
  true,
);
registerAiCommands(
  program,
  {defaultApiUrl, defaultConfigPath},
  {inspect: inspectCommand, compare: compareCommand},
);
registerCaptureRecordComparison(compareCommand);
registerIconListCommand(inspectCommand, {defaultConfigPath}, 'icons');
registerTilesetInspectCommand(inspectCommand, 'tileset');
registerProjectCommands(program, {
  defaultApiUrl,
  loadAuthConfig,
});
registerMapCommands(program, {defaultApiUrl, loadAuthConfig});

if (isRootCliVersionRequest(process.argv.slice(2))) {
  process.stdout.write(`${getCliVersion()}\n`);
} else if (isRestoreJsonCommand(process.argv.slice(2))) {
  await parseRestoreJson(program);
} else {
  const structuredCommand = process.argv[2] ?? 'tileflow';
  const structuredErrors =
    process.argv.includes('--json') &&
    [
      'describe',
      'inspect',
      'capture',
      'compare',
      'preview',
      'visual',
      'explain',
      'semantic-diff',
      'language',
    ].includes(structuredCommand);
  const deployStructured = structuredCommand === 'deploy' && process.argv.includes('--json');
  if (structuredErrors || deployStructured) configureJsonErrors(program);
  program.parseAsync().catch((error: unknown) => {
    if (deployStructured) {
      if (error && typeof error === 'object' && 'exitCode' in error && error.exitCode === 0) return;
      emitFailure(
        true,
        'deploy_failed',
        safeHostedText(error instanceof Error ? error.message : undefined) ?? 'Deploy failed.',
      );
      return;
    }
    if (structuredErrors) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'exitCode' in error &&
        error.exitCode === 0
      )
        return;
      process.stderr.write(
        serializeTileflowCommandDocument(
          createTileflowCommandFailureDocument(structuredCommand, error, process.cwd(), {
            code: 'COMMAND_FAILED',
            phase: 'command-validation',
          }),
        ),
      );
    } else printCliError(error);
    process.exitCode = 1;
  });
}

type TileflowDevServer = ReturnType<typeof serve>;

type TileflowComparisonPreviewCommandOptions = {
  apiBaseUrl: string;
  againstConfig?: string;
  againstMap?: string;
  againstScene?: string;
  againstTheme?: string;
  cacheDir?: string;
  config: string;
  json?: boolean;
  map?: string;
  offline?: boolean;
  open: boolean;
  scene?: string;
  theme?: string;
};

async function runTileflowComparisonPreview(
  options: TileflowComparisonPreviewCommandOptions,
  address: {host: string; port: number},
): Promise<void> {
  await withTileflowConfigSecretsHidden(async () => {
    const origin = tileflowDevOrigin(address.host, address.port);
    const leftBasePath = '/left';
    const rightBasePath = '/right';
    const rightConfig = options.againstConfig ?? options.config;
    const rightScene =
      options.againstScene ?? (options.againstMap === undefined ? options.scene : undefined);
    const rightMap = options.againstMap ?? (rightScene === undefined ? options.map : undefined);
    const rightTheme =
      rightScene === undefined ? (options.againstTheme ?? options.theme) : undefined;
    let leftSession: Awaited<ReturnType<typeof createTileflowArtifactSession>> | undefined;
    let rightSession: Awaited<ReturnType<typeof createTileflowArtifactSession>> | undefined;
    let server: TileflowDevServer | undefined;
    let serverStarted = false;
    let workbench: ReturnType<typeof createWorkbenchService> | undefined;
    let unsubscribeLeft = () => {};
    let unsubscribeRight = () => {};
    const emit = (event: Record<string, unknown>): void => {
      if (!options.json) return;
      process.stdout.write(
        `${JSON.stringify({schemaVersion: 1, command: 'preview.compare', ...event})}\n`,
      );
    };
    const emitState = (side: 'left' | 'right', state: TileflowArtifactSessionState): void => {
      if (!options.json) {
        if (state.status === 'invalid') {
          console.error(
            `Tileflow ${side} generation ${state.generation} is invalid; preserving its last valid preview.`,
          );
        }
        return;
      }
      emit({
        event: state.status,
        side,
        generation: state.generation,
        ...('lastGoodGeneration' in state && state.lastGoodGeneration !== undefined
          ? {lastGoodGeneration: state.lastGoodGeneration}
          : {}),
        ...(state.status === 'invalid' ? {diagnostics: state.diagnostics} : {}),
      });
    };

    try {
      const leftCaptureConfig = comparisonCaptureConfigArgument(options.config);
      const rightCaptureConfig = comparisonCaptureConfigArgument(rightConfig);
      const comparisonIcons = resolveIconOptions(options);
      leftSession = await createTileflowArtifactSession({
        apiBaseUrl: options.apiBaseUrl,
        assetBaseUrl: `${origin}${leftBasePath}`,
        config: options.config,
        ...(comparisonIcons ? {icons: comparisonIcons} : {}),
        inspection: true,
        styleBaseUrl: `${origin}${leftBasePath}`,
        watch: true,
      });
      rightSession = await createTileflowArtifactSession({
        apiBaseUrl: options.apiBaseUrl,
        assetBaseUrl: `${origin}${rightBasePath}`,
        config: rightConfig,
        ...(comparisonIcons ? {icons: comparisonIcons} : {}),
        inspection: true,
        styleBaseUrl: `${origin}${rightBasePath}`,
        watch: true,
      });

      emitState('left', leftSession.getState());
      emitState('right', rightSession.getState());
      unsubscribeLeft = leftSession.subscribe((state) => emitState('left', state));
      unsubscribeRight = rightSession.subscribe((state) => emitState('right', state));

      const leftArtifacts = leftSession.getLastGoodArtifacts();
      const rightArtifacts = rightSession.getLastGoodArtifacts();
      if (!leftArtifacts || !rightArtifacts) {
        if (options.json) {
          const invalidSides = [
            {side: 'left' as const, state: leftSession.getState()},
            {side: 'right' as const, state: rightSession.getState()},
          ].filter(
            (
              entry,
            ): entry is {
              side: 'left' | 'right';
              state: Extract<TileflowArtifactSessionState, {status: 'invalid'}>;
            } => entry.state.status === 'invalid',
          );
          emit({
            event: 'error',
            code: 'COMPARISON_INITIAL_INVALID',
            phase: 'initialization',
            diagnostics: invalidSides.flatMap(({state}) => state.diagnostics),
            sides: invalidSides.map(({side, state}) => ({
              side,
              generation: state.generation,
              diagnostics: state.diagnostics,
            })),
          });
          process.exitCode = 1;
          return;
        }
        throw new Error('Both comparison sides require one valid artifact generation.');
      }
      const leftPreview = resolveTileflowPreview(leftArtifacts.project, {
        map: options.map,
        scene: options.scene,
        theme: options.theme,
      });
      const rightPreview = resolveTileflowPreview(rightArtifacts.project, {
        map: rightMap,
        scene: rightScene,
        theme: rightTheme,
      });
      const leftHandler = createTileflowDevRequestHandler({
        fitViewport: true,
        apiBaseUrl: options.apiBaseUrl,
        basePath: leftBasePath,
        config: options.config,
        map: options.map,
        onError: printTileflowPreviewError,
        scene: options.scene,
        session: leftSession,
        theme: options.theme,
      });
      const rightHandler = createTileflowDevRequestHandler({
        fitViewport: true,
        apiBaseUrl: options.apiBaseUrl,
        basePath: rightBasePath,
        config: rightConfig,
        map: rightMap,
        onError: printTileflowPreviewError,
        scene: rightScene,
        session: rightSession,
        theme: rightTheme,
      });
      workbench = createWorkbenchService({
        origin,
        cwd: process.cwd(),
        sides: {
          left: {session: leftSession, basePath: leftBasePath, config: leftCaptureConfig},
          right: {session: rightSession, basePath: rightBasePath, config: rightCaptureConfig},
        },
      });
      const fetch = createTileflowComparisonRequestHandler({
        workbench,
        left: {
          basePath: leftBasePath,
          ...(leftCaptureConfig ? {captureConfig: leftCaptureConfig} : {}),
          handler: leftHandler,
          label: `${leftPreview.label} · ${options.config}`,
          previewUrl: workbenchPreviewUrl(leftBasePath, options),
          sidecarUrl: `${leftBasePath}/__inspection/${leftPreview.mapName}/${leftPreview.themeName}.json`,
        },
        right: {
          basePath: rightBasePath,
          ...(rightCaptureConfig ? {captureConfig: rightCaptureConfig} : {}),
          handler: rightHandler,
          label: `${rightPreview.label} · ${rightConfig}`,
          previewUrl: workbenchPreviewUrl(rightBasePath, {
            scene: rightScene,
            map: rightMap,
            theme: rightTheme,
          }),
          sidecarUrl: `${rightBasePath}/__inspection/${rightPreview.mapName}/${rightPreview.themeName}.json`,
        },
        title: 'Tileflow Inspector',
      });

      await new Promise<void>((resolveListening, rejectListening) => {
        const createdServer = serve(
          {
            fetch: (request) =>
              rejectTileflowDevRebinding(request) ??
              redirectTileflowDevNavigation(request, origin) ??
              fetch(request),
            hostname: address.host,
            port: address.port,
          },
          () => resolveListening(),
        );
        createdServer.once('error', rejectListening);
        server = createdServer;
      });
      serverStarted = true;
      if (!options.json) {
        logSuccess('Tileflow Inspector is running and watching both configs.');
        printKeyValue('Local', link(origin));
        printKeyValue('Left', `${leftPreview.label} · ${pathLabel(options.config)}`);
        printKeyValue('Right', `${rightPreview.label} · ${pathLabel(rightConfig)}`);
        logMuted('Press Ctrl+C to stop.');
        if (options.open) openBrowser(origin);
      }
      await waitForTerminationSignal(server!);
    } catch (error) {
      if (!options.json) throw error;
      const diagnostics = createTileflowArtifactDiagnostics(error, process.cwd());
      emit({
        event: 'error',
        code: diagnostics[0]?.code ?? 'COMPARISON_PREVIEW_FAILED',
        phase: diagnostics[0]?.phase ?? 'preview',
        diagnostics,
      });
      process.exitCode = 1;
    } finally {
      unsubscribeLeft();
      unsubscribeRight();
      await closeNodeServer(server);
      await workbench?.close();
      const generation = {
        left: leftSession?.getState().generation,
        right: rightSession?.getState().generation,
      };
      await Promise.all([leftSession?.close(), rightSession?.close()]);
      if (serverStarted) emit({event: 'stopped', generation});
    }
  });
}

function comparisonCaptureConfigArgument(configPath: string): string | undefined {
  const cwd = realpathSync(process.cwd());
  const requestedConfigPath = resolve(process.cwd(), configPath);
  const defaultRequestedPath = resolve(process.cwd(), defaultConfigPath);
  const absoluteConfigPath = existsSync(requestedConfigPath)
    ? realpathSync(requestedConfigPath)
    : requestedConfigPath;
  const absoluteDefaultPath = existsSync(defaultRequestedPath)
    ? realpathSync(defaultRequestedPath)
    : defaultRequestedPath;
  if (absoluteConfigPath === absoluteDefaultPath) return undefined;

  const relativeConfigPath = relative(cwd, absoluteConfigPath);
  if (
    relativeConfigPath === '' ||
    relativeConfigPath === '..' ||
    relativeConfigPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeConfigPath)
  ) {
    throw new Error(
      'Comparison configs must be inside the current working directory so Copy command can remain reproducible.',
    );
  }
  return relativeConfigPath.split(sep).join('/');
}

function waitForTerminationSignal(server: TileflowDevServer): Promise<void> {
  return new Promise((resolveStop, rejectStop) => {
    const controller = installSignalAbortController();
    const cleanup = () => {
      controller.signal.removeEventListener('abort', onAbort);
      server.removeListener('error', onError);
      controller.close();
    };
    const onAbort = () => {
      cleanup();
      resolveStop();
    };
    const onError = (error: Error) => {
      cleanup();
      rejectStop(error);
    };
    controller.signal.addEventListener('abort', onAbort, {once: true});
    server.once('error', onError);
  });
}

function closeNodeServer(server: TileflowDevServer | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function loginWithDeviceFlow(options: {
  appUrl: string;
  expectedApiUrl: string;
  noBrowser: boolean;
}) {
  const authState = await prepareAccountLogin();
  if (authState.kind === 'legacy') {
    logWarning('An older Tileflow CLI login will be replaced after authorization.');
  }
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = createPkceChallenge(codeVerifier);
  printTitle('Tileflow login', 'Authorize this machine from the Tileflow dashboard.');
  const authorizationStartedAt = Date.now();
  const authorization = await startDeviceAuthorization(options.appUrl, {
    codeChallenge,
    deviceName: hostname(),
  });

  const apiUrl = normalizeApiOrigin(options.expectedApiUrl);
  if (normalizeApiOrigin(authorization.apiUrl) !== apiUrl) {
    throw new Error('The dashboard returned an unexpected Tileflow API origin.');
  }
  const previousSession =
    authState.kind === 'sessions' ? authState.config.sessions[apiUrl] : undefined;

  printKeyValue('Code', pc.bold(authorization.userCode));
  printKeyValue('URL', link(authorization.verificationUriComplete));

  if (options.noBrowser) {
    logMuted('Open the URL above to continue.');
  } else if (process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      await readline.question(`${pc.cyan('?')} Press Enter to open Tileflow Dashboard...`);
      openBrowser(authorization.verificationUriComplete);
    } finally {
      readline.close();
    }
  } else {
    logMuted('Open the URL above to continue.');
  }

  logInfo('Waiting for authorization...');
  const token = await pollDeviceToken(options.appUrl, authorization, {
    codeVerifier,
    expiresAt: authorizationStartedAt + authorization.expiresIn * 1000,
  });

  const session: CliAccountSession = {
    account: token.account,
    accountSession: token.accountSession,
    apiOrigin: apiUrl,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    sessionId: token.sessionId,
  };
  let account = session.account;
  try {
    // Never follow a token response to another origin, including during cleanup.
    if (normalizeApiOrigin(token.apiUrl) !== apiUrl) {
      throw new Error('The dashboard returned an unexpected Tileflow API origin.');
    }
    const profile = await validateAccountSession(session);
    if (!profile.ok) throw new Error(profile.error);
    account = profile.value.account;
    await installAccountSession({...session, account});
  } catch (error) {
    if (!(await revokeHostedAccountSession(apiUrl, session.accountSession))) {
      logWarning(
        'Could not revoke the new account session after login failed. Revoke it in Dashboard settings.',
      );
    }
    throw error;
  }

  if (
    previousSession &&
    previousSession.accountSession !== session.accountSession &&
    !(await revokeHostedAccountSession(apiUrl, previousSession.accountSession))
  ) {
    logWarning(
      'The new login was saved, but the previous session could not be revoked. Revoke it in Dashboard settings.',
    );
  }
  logSuccess('Signed in to Tileflow.');
  printAccountDetails({...session, account});
  printKeyValue('Dashboard', link(options.appUrl));
}

function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function randomBase64Url(byteLength: number) {
  return randomBytes(byteLength).toString('base64url');
}

function openBrowser(url: string, errorsToStderr = false) {
  openTileflowExternal(url, {
    onError: () => {
      if (errorsToStderr) {
        console.error(`Could not open a browser. Visit ${url}`);
      } else {
        logWarning(`Could not open a browser. Visit ${url}`);
      }
    },
  });
}

async function writeDeployManifest(manifestPath: string, manifest: DeployedManifest) {
  const outputPath = resolve(process.cwd(), manifestPath);

  await writeAtomicFile({
    boundaryPath: dirname(outputPath),
    force: true,
    label: 'Deploy manifest',
    managed: true,
    path: outputPath,
    source: `${JSON.stringify(manifest, null, 2)}\n`,
  });

  return manifestPath;
}

function selectManagedDeployMaps(
  mapNames: string[],
  options: {map?: string; mapId?: string},
): string[] | null {
  if (options.map) {
    if (!mapNames.includes(options.map)) {
      logError(`Unknown Tileflow map: ${options.map}.`);
      printKeyValue('Maps', mapNames.join(', '));
      process.exitCode = 1;
      return null;
    }
    return [options.map];
  }
  if (mapNames.length === 1) return [mapNames[0]!];
  logError(
    'This managed target requires an explicit map because the config contains multiple maps.',
  );
  printKeyValue('Maps', mapNames.join(', '));
  printNextSteps([
    `Retry with ${command(`tileflow deploy ${options.mapId ? `--map-id ${options.mapId} ` : ''}--map ${mapNames[0]}`)}.`,
  ]);
  process.exitCode = 1;
  return null;
}

/**
 * Without --map-id, deploy creates the Map with the personal account session. CI and an explicit
 * credential keep requiring an existing Map.
 */
function validateMapSetupTarget(
  options: MapSetupOptions & {apiKey?: string; mapId?: string},
  source: ReturnType<typeof resolveDeploySource>,
) {
  const fail = (message: string, steps: string[] = []) => {
    logError(message);
    printNextSteps(steps);
    process.exitCode = 1;
    return false;
  };
  if (options.mapId) {
    return hasMapSetupOptions(options)
      ? fail(
          '--team, --origin, --any-website and --setup-key apply only when deploy creates a Map.',
        )
      : true;
  }
  const createFirst = `Create the Map with ${command('tileflow maps create')} after ${command('tileflow login')}, then pass --map-id.`;
  if (options.apiKey !== undefined || !allowsStoredDeployCredential(source)) {
    return fail('Managed deploy with a Tileflow credential or in CI requires --map-id.', [
      createFirst,
    ]);
  }
  const checked = checkMapSetupOptions(options);
  return checked.ok ? true : fail(checked.error);
}

function validateDeployTarget(options: {mapId?: string}) {
  if (options.mapId && !/^map_[A-Za-z0-9_-]{16}$/u.test(options.mapId)) {
    logError('Managed Map ID is invalid.');
    process.exitCode = 1;
    return false;
  }
  return true;
}

function validateDeployManifestMapNames(mapNames: string[]): boolean {
  for (const mapName of mapNames) {
    if (!tileflowMapIdSchema.safeParse(mapName).success) {
      logError('A configured map name cannot be represented safely in a runtime manifest.');
      process.exitCode = 1;
      return false;
    }
  }
  return true;
}

async function loadExistingDeployManifest(
  manifestPath: string,
  options: {overwriteSelfHosted: boolean},
): Promise<DeployedManifest | null> {
  let source: string;
  try {
    source = await readFile(resolve(process.cwd(), manifestPath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Existing Tileflow manifest could not be read.');
  }
  if (source.length > 1024 * 1024) throw new Error('Existing Tileflow manifest is too large.');
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error('Existing Tileflow manifest is not valid JSON.');
  }
  let manifest;
  try {
    manifest = parseTileflowRuntimeManifest(value);
  } catch {
    throw new Error(
      'Existing Tileflow manifest does not match the strict theme manifest contract.',
    );
  }
  const hasHostedMetadata =
    manifest.apiUrl !== undefined ||
    Object.values(manifest.maps).some(
      (map) =>
        map.apiUrl !== undefined ||
        map.environment !== undefined ||
        map.mapId !== undefined ||
        Object.values(map.themes).some((theme) => theme.styleId !== undefined),
    );
  if (!hasHostedMetadata) {
    if (options.overwriteSelfHosted) return null;
    throw new Error(
      'Refusing to replace a self-hosted Tileflow manifest with Hosted delivery. ' +
        'Choose another --manifest path or pass --overwrite-self-hosted-manifest explicitly.',
    );
  }
  return manifest;
}

async function requireApiOptions(
  options: {
    apiUrl?: string;
    apiKey?: string;
    mapId?: string;
  },
  behavior: {
    allowStoredCredential?: boolean;
    assertExplicitKeyMap?: boolean;
    capabilityScopes?: Array<'static:write' | 'status:read' | 'styles:write'>;
    silent?: boolean;
    onFailure?:
      | ((
          code: string,
          message: string,
          failure?: HostedFailure,
          steps?: readonly string[],
        ) => void)
      | undefined;
  } = {},
): Promise<{apiUrl: string; apiKey: string; mapId: string} | null> {
  const refuse = (code: string, message: string, steps: string[] = [], failure?: HostedFailure) => {
    if (behavior.onFailure) behavior.onFailure(code, message, failure, steps);
    else if (!behavior.silent) {
      logError(message);
      if (steps.length) printNextSteps(steps);
    }
    process.exitCode = 1;
    return null;
  };

  const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
  const requestedMapId = options.mapId;

  if (!requestedMapId || !/^map_[A-Za-z0-9_-]{16}$/u.test(requestedMapId)) {
    return refuse('invalid_map_id', 'Managed Map ID is invalid.');
  }

  if (options.apiKey !== undefined) {
    if (!isHostedApiKey(options.apiKey)) {
      return refuse('invalid_api_key', 'Tileflow API key is invalid.');
    }
    if (behavior.assertExplicitKeyMap) {
      const profile = await validateApiKey(apiUrl, options.apiKey);
      if (!profile.ok) {
        return refuse('api_key_validation_failed', profile.error, [], profile.failure);
      }
      if (!apiProfileCanTargetMap(profile.value, requestedMapId)) {
        return refuse('api_key_map_mismatch', 'This API key belongs to another Map.');
      }
    }
    return {apiKey: options.apiKey, apiUrl, mapId: requestedMapId};
  }

  const allowStoredCredential =
    behavior.allowStoredCredential !== false &&
    allowsStoredDeployCredential(resolveDeploySource(process.env));
  if (!allowStoredCredential) {
    return refuse(
      'api_key_required',
      'CI requires an explicit Tileflow credential with access to the target Map.',
      [
        `Set ${pc.cyan('TILEFLOW_API_KEY')} from the CI secret store.`,
        'The saved personal account session is never used in CI.',
      ],
    );
  }

  let config: AuthConfig;
  try {
    config = await loadAuthConfig();
  } catch (error) {
    return refuse('auth_state_unavailable', safeAuthError(error));
  }
  const resolvedSession = resolveAccountSession(config, apiUrl);
  if (resolvedSession.kind !== 'selected') {
    return refuse(
      `account_session_${resolvedSession.kind}`,
      resolvedSession.kind === 'expired'
        ? 'The Tileflow account session has expired.'
        : 'No Tileflow account session is saved.',
      [`Run ${command('tileflow login')} to authorize this machine.`],
    );
  }

  const capability = await requestMapCapability(
    resolvedSession.session,
    {mapId: requestedMapId},
    behavior.capabilityScopes ?? ['status:read'],
  );
  if (!capability.ok) {
    return refuse(
      'map_capability_failed',
      capability.error,
      capability.failure?.status === 401
        ? ['Run tileflow login to authorize this machine again.']
        : [],
      capability.failure,
    );
  }
  return {apiKey: capability.capability, apiUrl, mapId: capability.mapId};
}

function printTileflowPreviewError(error: unknown) {
  if (error instanceof TileflowStyleValidationError) {
    printValidationErrors(error.issues);
    return;
  }

  if (error instanceof TileflowValidationError) {
    printValidationErrors(error.messages);
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  logError(`Tileflow preview error: ${message}`);
}

function printCliError(error: unknown) {
  if (error instanceof TileflowStyleValidationError) {
    printValidationErrors(error.issues);
    return;
  }

  if (error instanceof TileflowValidationError) {
    printValidationErrors(error.messages);
    return;
  }

  if (error instanceof TileflowIconCompilationError) {
    printValidationErrors(error.issues);
    return;
  }

  if (error instanceof TileflowFontCompilationError) {
    printValidationErrors(error.issues);
    return;
  }

  if (error instanceof TileflowNativeCompatibilityError) {
    logError('A theme cannot be prepared for native apps.');
    for (const issue of error.issues.slice(0, 20)) {
      console.log(
        `  ${pc.red('✕')} ${pc.cyan(issue.path || '(root)')} ${pc.gray('-')} ${issue.message}`,
      );
    }
    printNextSteps([...new Set(error.issues.map((issue) => issue.suggestion))].slice(0, 3));
    return;
  }

  const message = error instanceof Error ? error.message : 'Command failed.';
  if (message.includes("Cannot find module '@tileflow/core'")) {
    logError(`Cannot load ${pc.cyan('@tileflow/core')} from this project.`);
    printNextSteps([
      `Install ${pc.cyan('@tileflow/core')} in this project.`,
      `Run the command again from the project root.`,
    ]);
    return;
  }
  if (message.includes("Cannot find module '@tileflow/maps'")) {
    logError(`Cannot load ${pc.cyan('@tileflow/maps')} from this project.`);
    printNextSteps([
      `Install ${pc.cyan('@tileflow/maps')} in this project.`,
      `Run the command again from the project root.`,
    ]);
    return;
  }

  logError(message.split('\n')[0] ?? message);

  if (message.includes(defaultConfigPath) || message.includes('config')) {
    printNextSteps([`Run ${command('tileflow validate')} to check the config.`]);
  }
}

function printHumanLine(message: string) {
  if (!deployJson) console.log(message);
}

function logSuccess(message: string) {
  printHumanLine(`${pc.green('✓')} ${message}`);
}

function logError(message: string) {
  if (deployJson)
    deployErrors.push(
      safeHostedText(stripVTControlCharacters(message), deploySecrets) ??
        'Deploy failed. Check the local configuration and connection.',
    );
  printHumanLine(`${pc.red('✕')} ${message}`);
}

function logWarning(message: string) {
  const warning = safeHostedText(stripVTControlCharacters(message), deploySecrets);
  if (warning) deployWarnings.push(warning);
  printHumanLine(`${pc.yellow('!')} ${message}`);
}

function logInfo(message: string) {
  printHumanLine(`${pc.cyan('i')} ${message}`);
}

function logMuted(message: string) {
  printHumanLine(pc.gray(message));
}

function printTitle(title: string, subtitle?: string) {
  printHumanLine(pc.bold(title));
  if (subtitle) {
    printHumanLine(pc.gray(subtitle));
  }
}

function printKeyValue(label: string, value: string) {
  printHumanLine(`${pc.gray(`${label}:`.padEnd(13))} ${value}`);
}

function printChecks(items: readonly string[]) {
  for (const item of items) {
    printHumanLine(`  ${pc.green('✓')} ${item}`);
  }
}

function printNextSteps(steps: readonly string[]) {
  if (steps.length === 0) return;

  printHumanLine(`\n${pc.bold('Next steps')}`);
  for (const step of steps) {
    printHumanLine(`  ${pc.cyan('•')} ${step}`);
  }
}

function printValidationErrors(messages: readonly {message: string; path: string}[]) {
  logError('Tileflow config has errors.');
  for (const message of messages) {
    const path = message.path ? pc.cyan(message.path) : pc.cyan('(root)');
    if (deployJson) logError(`${message.path || '(root)'}: ${message.message}`);
    else printHumanLine(`  ${pc.red('✕')} ${path} ${pc.gray('-')} ${message.message}`);
  }
}

function printAccountDetails(session: CliAccountSession) {
  printKeyValue('Account', pc.bold(session.account.name));
  printKeyValue('Email', session.account.email);
  printKeyValue('API', link(session.apiOrigin));
  printKeyValue('Expires', formatDate(session.expiresAt));
}

function logAuthCommandError(json: boolean | undefined, message: string) {
  if (json) {
    console.error(message);
    process.stdout.write(
      `${JSON.stringify({schemaVersion: 1, ok: false, error: {code: 'authentication_failed'}})}\n`,
    );
  } else {
    logError(message);
  }
  process.exitCode = 1;
}

function safeAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message && message.length <= 300 ? message : 'Tileflow auth state is unavailable.';
}

function safeStatusError(error: unknown) {
  const message = error instanceof Error ? error.message.split('\n')[0] : '';
  return message && message.length <= 300 && /^(?:Status failed|Status response)/u.test(message)
    ? message
    : 'Status failed.';
}

function printDeployedMaps(maps: Record<string, DeployedManifestMap>) {
  const entries = Object.entries(maps);
  if (entries.length === 0) return;

  printHumanLine(`\n${pc.bold('Maps')}`);
  for (const [name, map] of entries) {
    for (const [themeName, theme] of Object.entries(map.themes)) {
      const label = `${name}/${themeName}`;
      printHumanLine(`  ${pc.green('✓')} ${label.padEnd(24)} ${link(theme.styleUrl)}`);
    }
  }
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function command(value: string) {
  return pc.cyan(value);
}

function link(value: string) {
  return pc.cyan(value);
}

function pathLabel(value: string) {
  return pc.cyan(value);
}

function starterConfig(native: boolean): string {
  return `import { defineMap, defineTheme, labels, poi } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

const madridDark = defineTheme(streetsThemes.dark, {
  id: "madrid-dark",
  version: 1,
  colorScheme: "dark",
  tokens: {
    color: {
      "surface.background": "#080b12",
      "surface.land": "#0d1320",
      "surface.water": "#081e2e"
    }
  }
});

export default defineMap({
  id: "madrid",
  name: "Madrid",
  version: 1,
  extends: streets,
  ${native ? enableNativePlatforms : 'platforms: ["web"],'}
  themes: { light: streetsThemes.light, dark: madridDark },
  defaultTheme: "light",
  systemThemes: { light: "light", dark: "dark" },
  modules: {
    labels: labels({ roads: "major" }),
    poi: poi({ density: 3, icons: true })
  },
  view: {
    center: [-3.7038, 40.4168],
    zoom: 12
  }
});
`;
}

function printHostedCompatibilityIssues(issues: readonly Readonly<{message: string}>[]): boolean {
  if (issues.length === 0) return true;

  for (const issue of issues) logError(issue.message);
  process.exitCode = 1;
  return false;
}

function printHostedDeployProgress(event: HostedDeployEvent) {
  switch (event.kind) {
    case 'icon-package':
      logSuccess(
        `${event.changed ? 'Uploaded' : 'Reused'} icon package ${pc.bold(event.label)} (${plural(event.icons, 'icon')}, ${formatBytes(event.bytes)}, ${event.contentHash.slice(0, 12)}).`,
      );
      return;
    case 'font-bundle':
      logSuccess(
        `${event.changed ? 'Uploaded' : 'Reused'} font bundle (${plural(event.faces, 'face')}, ${formatBytes(event.bytes)}, ${event.contentHash.slice(0, 12)}).`,
      );
      return;
    case 'publishing':
      logInfo(
        `Publishing ${pc.bold(event.mapName)} for ${event.native ? 'web and native apps' : 'web'} (${plural(event.themes, 'theme')}, ${formatBytes(event.bytes)} web request).`,
      );
      return;
    case 'reserved':
      logInfo(
        event.documents < event.total
          ? `Resuming v${event.version}: ${event.documents} of ${event.total} native documents left to upload (${formatBytes(event.bytes)}).`
          : `Reserved v${event.version}; uploading ${plural(event.documents, 'native document')} (${formatBytes(event.bytes)}).`,
      );
      return;
    case 'uploaded':
      printHumanLine(
        `  ${pc.green('✓')} ${event.document === 'family' ? 'Family document' : `Native style ${event.theme}`} ${pc.gray(`${formatBytes(event.bytes)}, ${event.position}/${event.count}`)}`,
      );
      return;
    case 'publication-job': {
      const messages = {
        family: 'Verifying the native family and blend plans.',
        staging: 'Preparing verified styles for delivery.',
        activation: 'Activating the new revision.',
      };
      logInfo(
        event.state === 'queued'
          ? `Publication queued (${event.jobId}).`
          : event.phase
            ? messages[event.phase]
            : 'Checking the publication request.',
      );
      return;
    }
    case 'activating':
      logInfo(`Submitting v${event.version} for activation.`);
      return;
  }
}

/** Degradations never block a deploy; say briefly what native apps draw differently. */
function printNativeDifferences(mapName: string, differences: readonly NativeDifference[]) {
  if (differences.length === 0) return;
  logWarning(`Native apps draw ${pc.bold(mapName)} without some web features:`);
  for (const difference of differences) {
    const themes = difference.all ? '' : pc.gray(` (${difference.themes.join(', ')})`);
    printHumanLine(`    ${describeNativeDifference(difference)}${themes}`);
  }
}

function printMapStatus(status: HostedMapStatus, apiUrl: string) {
  printTitle('Tileflow status');
  printKeyValue('Map', pc.bold(status.mapId));

  printHumanLine(`\n${pc.bold('Styles')}`);
  if (status.styles.length === 0) {
    logMuted('  No styles deployed.');
  }
  for (const style of status.styles) {
    printHumanLine(
      `  ${pc.green('✓')} ${style.environment.padEnd(16)} ${link(`${apiUrl}/maps/${style.mapId}/style.json`).padEnd(36)} ${formatBytes(style.size).padStart(10)}  ${pc.gray(formatDate(style.uploaded))}`,
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';

  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function workbenchPreviewUrl(
  basePath: string,
  selection: {scene?: string; map?: string; theme?: string},
): string {
  const query = new URLSearchParams();
  for (const key of ['scene', 'map', 'theme'] as const) {
    const value = selection[key];
    if (value) query.set(key, value);
  }
  return `${basePath}/${query.size ? `?${query}` : ''}`;
}
