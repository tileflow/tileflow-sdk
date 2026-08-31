#!/usr/bin/env node

import {serve} from '@hono/node-server';
import {Command} from 'commander';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {createInterface} from 'node:readline/promises';
import pc from 'picocolors';
import {
  auditTileflowMapThemeValues,
  getTileflowStyleFontFaces,
  parseResolvedTileflowMap,
  parseTileflowMap,
  serializeCanonicalJson,
  tileflowMapIdSchema,
} from '@tileflow/core';
import {
  createTileflowMapBuildManifest,
  type TileflowBuildCatalog,
  type TileflowPreparedMapAssets,
} from '@tileflow/core/build';
import {
  type TileflowRuntimeManifest as DeployedManifest,
  type TileflowRuntimeManifestMapEntry as DeployedManifestMap,
  parseTileflowRuntimeManifest,
} from '@tileflow/core/manifest';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowBuildProvenance,
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
import {
  bindTileflowStyleFontBundle,
  prepareTileflowStyleFonts,
  TileflowFontCompilationError,
} from '@tileflow/dev/fonts';
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
  type AuthConfigV2,
  type CliAccountSessionV2,
  installAccountSession,
  loadAuthConfig,
  normalizeApiOrigin,
  parseProjectReference,
  projectReference,
  removeAccountSession,
  removeAuthFile,
  resolveAccountSession,
  writeAuthFileAtomic,
} from './account-session';
import {registerAiCommands} from './ai-commands';
import {installSignalAbortController, registerCaptureCommands} from './capture-command';
import {writeAtomicFile} from './capture-output';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {registerConfigInspectCommand} from './config-inspect-command';
import {allowsStoredDeployCredential, resolveDeploySource} from './deploy-source';
import {defaultTileflowDevHost, parseTileflowDevHost, tileflowDevOrigin} from './dev-host';
import {registerFeatureInspectCommand} from './feature-inspect-command';
import {
  fetchHostedMapStatus,
  pollDeviceToken,
  publishHostedStyle,
  requestMapCapability,
  requestProjectCapability,
  revokeHostedAccountSession,
  startDeviceAuthorization,
  uploadHostedFontBundle,
  uploadHostedIconPackage,
  validateAccountSession,
  validateApiKey,
} from './hosted-client';
import {
  inspectTileflowHostedCompatibility,
  prepareTileflowHostedThemeFamily,
} from './hosted-preflight';
import type {HostedMapStatus} from './hosted-response';
import {registerIconDiffCommand} from './icon-diff-command';
import {registerIconListCommand} from './icon-list-command';
import {registerLanguageCommand} from './language-command';
import {openTileflowExternal} from './open-external';
import {registerProjectCommands, resolveAccountProjectTarget} from './project-commands';
import {registerTilesetCommands} from './tileset-command';
import {registerVisualCommands} from './visual-command';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {version: string};

const program = new Command();
const defaultApiUrl = defaultTileflowApiUrl;
const defaultAppUrl = 'https://tileflow.dev';
const defaultConfigPath = defaultTileflowConfigPath;
const defaultManifestPath = defaultTileflowManifestPath;

program
  .name('tileflow')
  .description('Beautiful maps from config.')
  .version(packageJson.version)
  .showHelpAfterError(pc.gray('\nRun tileflow <command> --help for usage.'))
  .showSuggestionAfterError();

registerLanguageCommand(program);
registerTilesetCommands(program, {defaultApiUrl, loadAuthConfig});

program
  .command('init')
  .description('Create a starter tileflow.config.ts')
  .option('-f, --force', 'overwrite an existing config')
  .action(async (options: {force?: boolean}) => {
    const configPath = resolve(process.cwd(), defaultConfigPath);
    const ignorePath = resolve(process.cwd(), '.gitignore');

    if (existsSync(configPath) && !options.force) {
      logWarning(`${pathLabel(defaultConfigPath)} already exists.`);
      printNextSteps([`Run ${command('tileflow init --force')} to replace it.`]);
      return;
    }

    await writeFile(configPath, starterConfig(), 'utf8');
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
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
  .option(
    '--app-url <url>',
    'Tileflow Dashboard URL',
    process.env.TILEFLOW_APP_URL ?? defaultAppUrl,
  )
  .option('--no-browser', 'print the authorization URL without opening it')
  .action(async (options: {apiUrl?: string; appUrl?: string; noBrowser?: boolean}) => {
    const apiUrl = normalizeUrl(options.apiUrl ?? defaultApiUrl);
    const appUrl = normalizeUrl(options.appUrl ?? defaultAppUrl);

    try {
      await loginWithDeviceFlow({
        expectedApiUrl: apiUrl,
        appUrl,
        noBrowser: Boolean(options.noBrowser),
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
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
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
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
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
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .option('--json', 'print deterministic schema-version-1 JSON')
  .action(async (options: {apiBaseUrl: string; config: string; json?: boolean; target: string}) => {
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
        target: options.target,
      });
      const mapAssets = createCompiledMapAssets(compiledIcons, (binding) =>
        options.target === 'hosted'
          ? `${normalizeUrl(options.apiBaseUrl)}/sprites/preflight/${binding.packageHash}/sprite`
          : `/tileflow/icons/${binding.mapName}/sprite`,
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

      const diagnostics = createTileflowStructuredDiagnostics(
        {
          diagnostics: mapNames.flatMap((mapName) =>
            auditTileflowMapThemeValues(project.maps[mapName]!).filter(
              ({severity}) => severity === 'warning',
            ),
          ),
        },
        process.cwd(),
        {code: 'VALIDATION_WARNING', phase: 'theme-audit'},
      );

      const checks = [
        'Config schema',
        'Icon asset closure',
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
  });

program
  .command('build')
  .description('Generate static Tileflow styles')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('-o, --out <path>', 'output directory', 'dist/tileflow')
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .action(async (options: {apiBaseUrl: string; config: string; out: string}) => {
    logInfo(`Building ${pathLabel(options.config)}.`);
    await withTileflowConfigSecretsHidden(() =>
      writeTileflowBuildArtifacts({
        config: options.config,
        outDir: options.out,
        styleBaseUrl: '.',
        apiBaseUrl: options.apiBaseUrl,
      }),
    );

    logSuccess('Built Tileflow artifacts.');
    printKeyValue('Output', pathLabel(resolve(process.cwd(), options.out)));
  });

program
  .command('preview')
  .alias('dev')
  .description('Run a local map preview')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--against-config <path>', 'second config for the comparison workbench')
  .option('--against-map <name>', 'map on the right; defaults to --map')
  .option('--against-scene <name>', 'committed standalone scene on the right')
  .option('--against-theme <name>', 'concrete theme on the right; defaults to --theme')
  .option('--host <host>', 'bind host: an explicit IP address or localhost', defaultTileflowDevHost)
  .option('--map <name>', 'preview one configured map')
  .option('--theme <name>', 'preview one concrete theme; defaults to the map default')
  .option('-p, --port <port>', 'preview port', '3333')
  .option('--scene <name>', 'preview one committed standalone map scene')
  .option(
    '--api-base-url <url>',
    'Tileflow API base URL used to resolve official map assets',
    process.env.TILEFLOW_API_URL ?? defaultApiUrl,
  )
  .option('--json', 'emit schema-version-1 NDJSON lifecycle events')
  .action(
    async (options: {
      apiBaseUrl: string;
      againstConfig?: string;
      againstMap?: string;
      againstScene?: string;
      againstTheme?: string;
      config: string;
      host: string;
      json?: boolean;
      map?: string;
      port: string;
      scene?: string;
      theme?: string;
    }) => {
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

      const comparisonRequested =
        options.againstConfig !== undefined ||
        options.againstMap !== undefined ||
        options.againstScene !== undefined ||
        options.againstTheme !== undefined;
      if (comparisonRequested) {
        await runTileflowComparisonPreview(options, {host, port});
        return;
      }

      await withTileflowConfigSecretsHidden(async () => {
        const origin = tileflowDevOrigin(host, port);
        const session = await createTileflowArtifactSession({
          assetBaseUrl: origin,
          apiBaseUrl: options.apiBaseUrl,
          config: options.config,
          styleBaseUrl: origin,
          watch: true,
        });
        const initialArtifacts = session.getLastGoodArtifacts();

        try {
          if (initialArtifacts) {
            resolveTileflowPreview(initialArtifacts.project, {
              map: options.map,
              scene: options.scene,
              theme: options.theme,
            });
          }
        } catch (error) {
          await session.close();
          logError(error instanceof Error ? error.message : 'Invalid Tileflow preview selection.');
          process.exitCode = 1;
          return;
        }

        const fetch = createTileflowDevRequestHandler({
          config: options.config,
          apiBaseUrl: options.apiBaseUrl,
          map: options.map,
          onError: printTileflowPreviewError,
          scene: options.scene,
          session,
          theme: options.theme,
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
                command: 'dev',
                event: recovered ? 'recovered' : state.status,
                generation: state.generation,
                ...('lastGoodGeneration' in state && state.lastGoodGeneration !== undefined
                  ? {lastGoodGeneration: state.lastGoodGeneration}
                  : {}),
                ...(firstDiagnostic?.code ? {code: firstDiagnostic.code} : {}),
                ...(firstDiagnostic?.phase ? {phase: firstDiagnostic.phase} : {}),
                ...(state.status === 'invalid' ? {diagnostics: state.diagnostics} : {}),
              })}\n`,
            );
            return;
          }
          if (state.status === 'invalid') {
            console.error(
              [
                `Tileflow generation ${state.generation} is invalid; preserving the last valid preview.`,
                ...state.diagnostics.map(
                  (diagnostic) => `- ${diagnostic.path || '(root)'}: ${diagnostic.message}`,
                ),
              ].join('\n'),
            );
          } else if (recovered) {
            logSuccess(`Tileflow preview recovered at generation ${state.generation}.`);
          }
        };
        emitState(session.getState());
        const unsubscribe = session.subscribe(emitState);
        let server: ReturnType<typeof serve> | undefined;

        try {
          await new Promise<void>((resolveListening, rejectListening) => {
            const createdServer = serve({fetch, hostname: host, port}, () => resolveListening());
            createdServer.once('error', rejectListening);
            server = createdServer;
          });
          if (!options.json) {
            logSuccess('Tileflow preview is running and watching for changes.');
            printKeyValue('Local', link(origin));
            printKeyValue('Config', pathLabel(options.config));
            if (options.map) printKeyValue('Map', options.map);
            if (options.theme) printKeyValue('Theme', options.theme);
            if (options.scene) printKeyValue('Scene', options.scene);
            logMuted('Press Ctrl+C to stop.');
          }
          await waitForTerminationSignal(server!);
        } finally {
          unsubscribe();
          await closeNodeServer(server);
          const generation = session.getState().generation;
          await session.close();
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({schemaVersion: 1, command: 'dev', event: 'stopped', generation})}\n`,
            );
          }
        }
      });
    },
  );

program
  .command('deploy')
  .description('Deploy maps to Tileflow and write the frontend manifest')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--manifest <path>', 'manifest path written for frontend bundlers', defaultManifestPath)
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .option('--map-id <id>', 'managed Map destination')
  .option('--map <name>', 'configured map to connect when the repository contains multiple maps')
  .option(
    '--overwrite-self-hosted-manifest',
    'explicitly replace an existing self-hosted manifest at --manifest',
  )
  .action(
    async (options: {
      config: string;
      manifest: string;
      apiUrl?: string;
      apiKey?: string;
      mapId?: string;
      map?: string;
      overwriteSelfHostedManifest?: boolean;
    }) => {
      const source = resolveDeploySource(process.env);
      const resolveApi = (selectedMap?: string) =>
        requireApiOptions(options, {
          allowStoredCredential: allowsStoredDeployCredential(source),
          assertExplicitKeyMap: true,
          capabilityScopes: ['styles:write'],
          retryCommand: cliInvocation([
            'tileflow',
            'deploy',
            '--config',
            options.config,
            '--manifest',
            options.manifest,
            '--api-url',
            options.apiUrl ?? defaultApiUrl,
            ...(options.overwriteSelfHostedManifest ? ['--overwrite-self-hosted-manifest'] : []),
            ...(options.mapId ? ['--map-id', options.mapId] : []),
            ...(options.map && selectedMap ? ['--map', selectedMap] : []),
          ]),
        });
      const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
      // The config is executable repository code. Keep the captured bearer
      // credential for the HTTP request, but do not expose it while Jiti
      // imports tileflow.config.ts or anything that file imports.
      delete process.env.TILEFLOW_API_KEY;

      logInfo(`Deploying ${pathLabel(options.config)}.`);
      const loaded = await withTileflowConfigSecretsHidden(() =>
        loadTileflowConfigWithInputs(options.config),
      );
      const project = loaded.project;
      const baseDirectory = dirname(loaded.configFile);
      assertValidTileflowConfig(project);

      const configuredMapNames = getTileflowMapNames(project);
      const mapNames = selectManagedDeployMaps(configuredMapNames, options);
      if (!mapNames) return;
      if (!validateDeployTarget(options)) return;
      if (!validateDeployManifestMapNames(mapNames)) return;
      const deploymentProject: TileflowBuildCatalog =
        mapNames.length === configuredMapNames.length
          ? project
          : {
              ...project,
              maps: Object.fromEntries(
                mapNames.map((mapName) => [mapName, project.maps[mapName]!]),
              ),
            };
      const compiledIcons = await compileTileflowIconPackages(deploymentProject, {
        baseDirectory,
        cwd: process.cwd(),
        target: 'hosted',
      });
      const bindingsByMap = new Map(
        compiledIcons.bindings.map((binding) => [binding.mapName, binding]),
      );
      const packagesByHash = new Map(
        compiledIcons.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
      );

      // Validate the complete local style before the first remote write. Hosted
      // sprite URLs are substituted after upload, but they do not change layer
      // semantics.
      const preflightMapAssets = createCompiledMapAssets(
        compiledIcons,
        (binding) => `${apiUrl}/sprites/preflight/${binding.packageHash}/sprite`,
      );
      const compiledPreflightStyles = createTileflowStyles(deploymentProject, {
        apiBaseUrl: apiUrl,
        mapAssets: preflightMapAssets,
      });
      const preflightLocalTilesets = await prepareTileflowLocalTilesets(
        deploymentProject,
        compiledPreflightStyles,
        {assetBaseUrl: apiUrl, baseDirectory, cwd: process.cwd()},
      );
      const preflightFonts = await prepareTileflowStyleFonts(
        deploymentProject,
        preflightLocalTilesets.styles,
        {
          assetBaseUrl: `${apiUrl}/fonts/preflight`,
          baseDirectory,
          cwd: process.cwd(),
          target: 'hosted',
        },
      );

      if (
        !printHostedCompatibilityIssues(
          inspectTileflowHostedCompatibility(deploymentProject, preflightFonts.styles),
        )
      ) {
        return;
      }
      const mapsWithHostedFontBundles = Object.keys(preflightFonts.bundles).sort();
      if (mapsWithHostedFontBundles.length > 0) {
        logError('Hosted deploy does not yet support package-owned web fonts.');
        printKeyValue('Maps', mapsWithHostedFontBundles.join(', '));
        printNextSteps(['Use self-hosted delivery or an explicit public glyph provider.']);
        process.exitCode = 1;
        return;
      }

      let outputManifest: DeployedManifest | null = null;
      try {
        outputManifest = await loadExistingDeployManifest(options.manifest, {
          overwriteSelfHosted: options.overwriteSelfHostedManifest === true,
        });
      } catch (error) {
        logError(error instanceof Error ? error.message : 'Existing manifest is invalid.');
        process.exitCode = 1;
        return;
      }
      const existingApiUrl = outputManifest
        ? (outputManifest.apiUrl ?? Object.values(outputManifest.maps)[0]?.apiUrl)
        : undefined;
      if (existingApiUrl && normalizeUrl(existingApiUrl) !== apiUrl) {
        logError('Existing manifest belongs to a different Tileflow API origin.');
        process.exitCode = 1;
        return;
      }
      const existingManifest = outputManifest;

      // Authentication and account/project discovery may perform network
      // requests. Keep them after every deterministic config, asset, style,
      // font, compatibility, and existing-manifest check so invalid local
      // input always fails without network access.
      const api = await resolveApi(mapNames[0]);
      if (!api) return;

      const hostedSpriteByPackageHash = new Map<string, string>();

      for (const iconPackage of compiledIcons.packages) {
        const binding = compiledIcons.bindings.find(
          (candidate) => candidate.packageHash === iconPackage.contentHash,
        );
        const uploaded = await uploadHostedIconPackage(api, iconPackage);

        if (!uploaded.ok) {
          logError(`Icon package upload failed: ${uploaded.status}.`);
          process.exitCode = 1;
          return;
        }
        const totalBytes = iconPackage.manifest.files.reduce(
          (total, file) => total + file.byteLength,
          0,
        );
        const action = uploaded.value.changed === false ? 'Reused' : 'Uploaded';
        logSuccess(
          `${action} icon package ${pc.bold(binding?.label ?? 'Icons')} (${plural(iconPackage.manifest.iconNames.length, 'icon')}, ${formatBytes(totalBytes)}, ${iconPackage.contentHash.slice(0, 12)}).`,
        );
        hostedSpriteByPackageHash.set(iconPackage.contentHash, uploaded.value.spriteUrl);
      }

      const hostedMapAssets = createCompiledMapAssets(compiledIcons, (binding) => {
        const sprite = hostedSpriteByPackageHash.get(binding.packageHash);
        if (!sprite) throw new Error(`Missing hosted sprite URL for map ${binding.mapName}`);
        return sprite;
      });
      const compiledHostedStyles = createTileflowStyles(deploymentProject, {
        apiBaseUrl: api.apiUrl,
        mapAssets: hostedMapAssets,
      });
      const hostedLocalTilesets = await prepareTileflowLocalTilesets(
        deploymentProject,
        compiledHostedStyles,
        {assetBaseUrl: api.apiUrl, baseDirectory, cwd: process.cwd()},
      );
      const hostedFonts = await prepareTileflowStyleFonts(
        deploymentProject,
        hostedLocalTilesets.styles,
        {
          assetBaseUrl: `${api.apiUrl}/font-bundles/preflight`,
          baseDirectory,
          cwd: process.cwd(),
          target: 'hosted',
        },
      );
      for (const mapName of mapNames) {
        if (
          hostedFonts.bundles[mapName]?.contentHash !== preflightFonts.bundles[mapName]?.contentHash
        ) {
          throw new Error(`Font bundle changed after authentication for map ${mapName}.`);
        }
      }

      const hostedFontBaseByHash = new Map<string, string>();
      const uniqueFontBundles = [
        ...new Map(
          Object.values(hostedFonts.bundles).map((bundle) => [bundle.contentHash, bundle]),
        ).values(),
      ].sort((left, right) => left.contentHash.localeCompare(right.contentHash));
      for (const bundle of uniqueFontBundles) {
        const uploaded = await uploadHostedFontBundle(api, bundle);
        if (!uploaded.ok) {
          logError(`Font bundle upload failed: ${uploaded.status}.`);
          process.exitCode = 1;
          return;
        }
        const action = uploaded.value.changed === false ? 'Reused' : 'Uploaded';
        logSuccess(
          `${action} font bundle (${plural(bundle.manifest.fontFaces.length, 'face')}, ${formatBytes(uploaded.value.totalBytes)}, ${bundle.contentHash.slice(0, 12)}).`,
        );
        hostedFontBaseByHash.set(bundle.contentHash, uploaded.value.baseUrl);
      }

      const fontBoundStyles = Object.fromEntries(
        mapNames.map((mapName) => {
          const themeStyles = hostedFonts.styles[mapName]!;
          const bundle = hostedFonts.bundles[mapName];
          if (!bundle) return [mapName, themeStyles];
          const publicBaseUrl = hostedFontBaseByHash.get(bundle.contentHash);
          if (!publicBaseUrl) throw new Error(`Missing hosted font bundle URL for map ${mapName}.`);
          return [
            mapName,
            Object.fromEntries(
              Object.entries(themeStyles).map(([themeName, style]) => [
                themeName,
                bindTileflowStyleFontBundle(style, bundle, publicBaseUrl),
              ]),
            ),
          ];
        }),
      );
      const hostedThemeFamilies = Object.fromEntries(
        mapNames.map((mapName) => [
          mapName,
          prepareTileflowHostedThemeFamily(
            mapName,
            deploymentProject.maps[mapName]!,
            fontBoundStyles[mapName]!,
          ),
        ]),
      );
      const styles = Object.fromEntries(
        Object.entries(hostedThemeFamilies).map(([mapName, family]) => [mapName, family.styles]),
      );
      const buildManifest = await createTileflowMapBuildManifest(
        Object.fromEntries(
          mapNames.map((mapName) => {
            const map = deploymentProject.maps[mapName]!;
            const iconBinding = bindingsByMap.get(mapName);
            const iconPackage = iconBinding
              ? packagesByHash.get(iconBinding.packageHash)
              : undefined;
            return [
              mapName,
              {
                assets: [
                  ...(iconPackage?.files ?? []).map((file) => ({
                    contentType: file.contentType,
                    fileName: `icons/${mapName}/${file.fileName}`,
                    source: file.source,
                  })),
                  ...(hostedFonts.bundles[mapName]?.files ?? []),
                ],
                lineage: deploymentProject.mapMetadata?.[mapName]?.lineage ?? [
                  {id: map.id, mapVersion: map.version},
                ],
                map,
                sourceAssets: {
                  fonts: hostedFonts.sourceIdentities[mapName] ?? [],
                  icons: compiledIcons.sourceIdentities[mapName] ?? [],
                },
                styles: styles[mapName]!,
              },
            ];
          }),
        ),
        {provenance: await createTileflowBuildProvenance(process.cwd())},
      );
      const deployments = mapNames.map((mapName) => {
        const iconBinding = bindingsByMap.get(mapName);
        const iconPackage = iconBinding ? packagesByHash.get(iconBinding.packageHash) : undefined;
        const fontBundle = hostedFonts.bundles[mapName];
        return {
          iconBinding,
          iconPackage,
          fontBundle,
          mapName,
          teamSources: hostedThemeFamilies[mapName]!.teamSources,
          buildManifest: {
            maps: {[mapName]: buildManifest.maps[mapName]!},
            ...(buildManifest.provenance ? {provenance: buildManifest.provenance} : {}),
            schemaVersion: buildManifest.schemaVersion,
          },
          styles: styles[mapName]!,
        };
      });

      const deployedMaps: Record<string, DeployedManifestMap> = {};

      for (const deployment of deployments) {
        const {
          buildManifest,
          fontBundle,
          iconBinding,
          iconPackage,
          mapName,
          teamSources,
          styles: themeStyles,
        } = deployment;
        const themeNames = Object.keys(themeStyles).sort();
        logInfo(
          `Deploying compiled map ${pc.bold(mapName)} (${plural(themeNames.length, 'theme')}).`,
        );
        const response = await publishHostedStyle(
          api,
          {
            artifact: {
              buildManifest,
              kind: 'tileflow-map-deployment',
              mapId: mapName,
              schemaVersion: 1,
              styles: themeStyles,
              teamSources,
            },
            environment: mapName,
            managedMapId: options.mapId,
            usageMode: 'session',
            ...(iconBinding && iconPackage
              ? {
                  iconPackage: {
                    contentHash: iconPackage.contentHash,
                    label: iconBinding.label,
                  },
                }
              : {}),
            ...(fontBundle ? {fontBundle: {contentHash: fontBundle.contentHash}} : {}),
            source,
          },
          `Deploy response for ${mapName}`,
        );

        if (!response.ok) {
          logError(`Deploy failed for ${mapName}: ${response.status}.`);
          if (Object.keys(deployedMaps).length > 0) {
            logWarning(
              `Remote publication partially succeeded for ${Object.keys(deployedMaps).join(', ')}; ` +
                'the local manifest was preserved. Retry the same deploy to converge.',
            );
          }
          process.exitCode = 1;
          return;
        }

        const body = response.value;
        const expectedMapId = options.mapId ?? api.mapId;
        if (expectedMapId && body.mapId !== expectedMapId) {
          logError(`Deploy response did not confirm the requested Map for ${mapName}.`);
          process.exitCode = 1;
          return;
        }
        const deployedThemeNames = Object.keys(body.themes).sort();
        if (
          themeNames.length !== deployedThemeNames.length ||
          themeNames.some((themeName, index) => themeName !== deployedThemeNames[index])
        ) {
          logError(`Deploy response did not return the exact theme family for ${mapName}.`);
          process.exitCode = 1;
          return;
        }
        const resolvedMap = parseResolvedTileflowMap(deploymentProject.maps[mapName]!);
        const mapBuild = buildManifest.maps[mapName]!;
        deployedMaps[mapName] = {
          defaultTheme: resolvedMap.defaultTheme,
          environment: mapName,
          mapId: body.mapId,
          ...(resolvedMap.systemThemes ? {systemThemes: resolvedMap.systemThemes} : {}),
          themes: Object.fromEntries(
            themeNames.map((themeName) => {
              const deployedTheme = body.themes[themeName]!;
              const fontFaces = getTileflowStyleFontFaces(themeStyles[themeName]!);
              return [
                themeName,
                {
                  colorScheme: resolvedMap.themes[themeName]!.colorScheme,
                  fontFaces,
                  revision: mapBuild.themes[themeName]!.styleSha256,
                  ...(deployedTheme.styleId ? {styleId: deployedTheme.styleId} : {}),
                  styleUrl: deployedTheme.styleUrl,
                },
              ];
            }),
          ),
          ...(resolvedMap.view ? {view: resolvedMap.view} : {}),
          usageMode: 'session' as const,
          worldGeneration: 'v1' as const,
        };
        const versionLabel = Number.isInteger(body.version) ? ` (v${body.version})` : '';

        if (body.changed === false) {
          logSuccess(`Unchanged ${pc.bold(mapName)}${versionLabel}.`);
        } else {
          logSuccess(`Published ${pc.bold(mapName)}${versionLabel}.`);
        }
      }

      const manifestPath = await writeDeployManifest(options.manifest, {
        apiUrl: api.apiUrl,
        maps: {...(existingManifest?.maps ?? {}), ...deployedMaps},
        version: 1,
      });

      logSuccess('Deployed Tileflow maps.');
      printKeyValue('Manifest', pathLabel(manifestPath));
      printDeployedMaps(deployedMaps);
      const deployedMapId = Object.values(deployedMaps)[0]?.mapId;
      if (deployedMapId) {
        printNextSteps([
          `Check hosted state with ${command(`tileflow status --map-id ${deployedMapId}`)}.`,
        ]);
      }
    },
  );

program
  .command('status')
  .description('Show deployed compiled styles')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
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
        retryCommand: cliInvocation([
          'tileflow',
          'status',
          '--api-url',
          options.apiUrl ?? defaultApiUrl,
          ...(options.json ? ['--json'] : []),
        ]),
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
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    printMapStatus(status, api.apiUrl);
  });

const iconsCommand = program.command('icons').description('Inspect managed Tileflow icons');

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
      retryCommand: cliInvocation([
        'tileflow',
        'icons',
        'diff',
        '--against',
        options.against,
        ...(options.config ? ['--config', options.config] : []),
        '--map-id',
        options.mapId,
        '--api-url',
        options.apiUrl ?? defaultApiUrl,
      ]),
      silent: true,
    });
  },
});
const inspectCommand = program.command('inspect').description('Inspect map data for authoring');
registerConfigInspectCommand(inspectCommand, {defaultConfigPath});
registerFeatureInspectCommand(inspectCommand, {defaultConfigPath});
registerAiCommands(program, {defaultApiUrl, defaultConfigPath});
registerCaptureCommands(program, {defaultConfigPath});
registerVisualCommands(program, {
  defaultConfigPath,
  openReport: (path) => openBrowser(path, true),
});
registerProjectCommands(program, {
  defaultApiUrl,
  loadAuthConfig,
});

program.parseAsync().catch((error: unknown) => {
  printCliError(error);
  process.exitCode = 1;
});

type TileflowDevServer = ReturnType<typeof serve>;

type TileflowComparisonPreviewCommandOptions = {
  apiBaseUrl: string;
  againstConfig?: string;
  againstMap?: string;
  againstScene?: string;
  againstTheme?: string;
  config: string;
  json?: boolean;
  map?: string;
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
    let unsubscribeLeft = () => {};
    let unsubscribeRight = () => {};
    const emit = (event: Record<string, unknown>): void => {
      if (!options.json) return;
      process.stdout.write(
        `${JSON.stringify({schemaVersion: 1, command: 'dev.compare', ...event})}\n`,
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
      leftSession = await createTileflowArtifactSession({
        apiBaseUrl: options.apiBaseUrl,
        assetBaseUrl: `${origin}${leftBasePath}`,
        config: options.config,
        inspection: true,
        styleBaseUrl: `${origin}${leftBasePath}`,
        watch: true,
      });
      rightSession = await createTileflowArtifactSession({
        apiBaseUrl: options.apiBaseUrl,
        assetBaseUrl: `${origin}${rightBasePath}`,
        config: rightConfig,
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
        apiBaseUrl: options.apiBaseUrl,
        basePath: rightBasePath,
        config: rightConfig,
        map: rightMap,
        onError: printTileflowPreviewError,
        scene: rightScene,
        session: rightSession,
        theme: rightTheme,
      });
      const fetch = createTileflowComparisonRequestHandler({
        left: {
          basePath: leftBasePath,
          ...(leftCaptureConfig ? {captureConfig: leftCaptureConfig} : {}),
          handler: leftHandler,
          label: `${leftPreview.label} · ${options.config}`,
          previewUrl: `${leftBasePath}/`,
          sidecarUrl: `${leftBasePath}/__inspection/${leftPreview.mapName}/${leftPreview.themeName}.json`,
        },
        right: {
          basePath: rightBasePath,
          ...(rightCaptureConfig ? {captureConfig: rightCaptureConfig} : {}),
          handler: rightHandler,
          label: `${rightPreview.label} · ${rightConfig}`,
          previewUrl: `${rightBasePath}/`,
          sidecarUrl: `${rightBasePath}/__inspection/${rightPreview.mapName}/${rightPreview.themeName}.json`,
        },
        title: 'Tileflow visual workbench',
      });

      await new Promise<void>((resolveListening, rejectListening) => {
        const createdServer = serve({fetch, hostname: address.host, port: address.port}, () =>
          resolveListening(),
        );
        createdServer.once('error', rejectListening);
        server = createdServer;
      });
      serverStarted = true;
      if (!options.json) {
        logSuccess('Tileflow visual workbench is running and watching both configs.');
        printKeyValue('Local', link(origin));
        printKeyValue('Left', `${leftPreview.label} · ${pathLabel(options.config)}`);
        printKeyValue('Right', `${rightPreview.label} · ${pathLabel(rightConfig)}`);
        logMuted('Press Ctrl+C to stop.');
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
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = createPkceChallenge(codeVerifier);
  printTitle('Tileflow login', 'Authorize this machine from the Tileflow dashboard.');
  const authorization = await startDeviceAuthorization(options.appUrl, {
    codeChallenge,
    deviceName: hostname(),
  });

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
  });
  const apiUrl = normalizeApiOrigin(token.apiUrl);

  if (apiUrl !== normalizeApiOrigin(options.expectedApiUrl)) {
    throw new Error(`The dashboard returned an unexpected Tileflow API origin: ${apiUrl}.`);
  }

  const session: CliAccountSessionV2 = {
    account: token.account,
    accountSession: token.accountSession,
    apiOrigin: apiUrl,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    sessionId: token.sessionId,
  };
  const profile = await validateAccountSession(session);

  if (!profile.ok) {
    throw new Error(profile.error);
  }

  await installAccountSession({...session, account: profile.value.account});

  logSuccess('Signed in to Tileflow.');
  printAccountDetails({...session, account: profile.value.account});
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

type CompiledProjectIcons = Awaited<ReturnType<typeof compileTileflowIconPackages>>;

function createCompiledMapAssets(
  compiled: CompiledProjectIcons,
  resolveSprite: (binding: CompiledProjectIcons['bindings'][number]) => string,
): Record<string, TileflowPreparedMapAssets> {
  return Object.fromEntries(
    compiled.bindings.map((binding) => [
      binding.mapName,
      {icons: {ids: binding.iconIds, sprite: resolveSprite(binding)}},
    ]),
  );
}

function selectManagedDeployMaps(
  mapNames: string[],
  options: {map?: string; mapId?: string},
): string[] | null {
  if (options.map && !options.mapId) {
    logError('--map requires --map-id.');
    process.exitCode = 1;
    return null;
  }
  if (options.map) {
    if (!mapNames.includes(options.map)) {
      logError(`Unknown Tileflow map: ${options.map}.`);
      printKeyValue('Maps', mapNames.join(', '));
      process.exitCode = 1;
      return null;
    }
    return [options.map];
  }
  if (!options.mapId) return mapNames;
  if (mapNames.length === 1) return [mapNames[0]!];
  logError(
    'This managed target requires an explicit map because the config contains multiple maps.',
  );
  printKeyValue('Maps', mapNames.join(', '));
  printNextSteps([
    `Retry with ${command(`tileflow deploy --map-id ${options.mapId} --map ${mapNames[0]}`)}.`,
  ]);
  process.exitCode = 1;
  return null;
}

function validateDeployTarget(options: {mapId?: string}) {
  if (!options.mapId) {
    logError('Managed deploy requires --map-id.');
    process.exitCode = 1;
    return false;
  }
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
    project?: string;
  },
  behavior: {
    allowStoredCredential?: boolean;
    assertExplicitKeyMap?: boolean;
    capabilityScopes?: Array<'static:write' | 'status:read' | 'styles:write'>;
    retryCommand?: string;
    silent?: boolean;
  } = {},
): Promise<{apiUrl: string; apiKey: string; mapId?: string} | null> {
  const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
  const requestedMapId = options.mapId;
  const requested = options.project ? parseProjectReference(options.project) : null;

  if (requestedMapId && !/^map_[A-Za-z0-9_-]{16}$/u.test(requestedMapId)) {
    if (!behavior.silent) logError('Managed Map ID is invalid.');
    process.exitCode = 1;
    return null;
  }

  if (options.project && !requested) {
    if (!behavior.silent) logError('Managed destination must use @organization/project syntax.');
    process.exitCode = 1;
    return null;
  }

  if (options.apiKey) {
    if (requestedMapId && behavior.assertExplicitKeyMap) {
      const profile = await validateApiKey(apiUrl, options.apiKey);
      if (!profile.ok) {
        if (!behavior.silent) logError(profile.error);
        process.exitCode = 1;
        return null;
      }
      if (profile.value.mapId !== requestedMapId) {
        if (!behavior.silent) logError('This API key belongs to another Map.');
        process.exitCode = 1;
        return null;
      }
    }
    if (requested) {
      const profile = await validateApiKey(apiUrl, options.apiKey);
      if (!profile.ok) {
        if (!behavior.silent) logError(profile.error);
        process.exitCode = 1;
        return null;
      }
      if (requested && projectReference(profile.value) !== options.project) {
        if (!behavior.silent) {
          logError(
            `This project key belongs to ${projectReference(profile.value)}, not ${options.project}.`,
          );
        }
        process.exitCode = 1;
        return null;
      }
    }
    return {
      apiKey: options.apiKey,
      apiUrl,
      ...(requestedMapId ? {mapId: requestedMapId} : {}),
    };
  }

  const allowStoredCredential =
    behavior.allowStoredCredential !== false &&
    allowsStoredDeployCredential(resolveDeploySource(process.env));
  if (!allowStoredCredential) {
    if (!behavior.silent) {
      logError('CI requires an explicit Map-scoped Tileflow API key.');
      printNextSteps([
        `Set ${pc.cyan('TILEFLOW_API_KEY')} from the CI secret store.`,
        'The saved personal account session is never used in CI.',
      ]);
    }
    process.exitCode = 1;
    return null;
  }

  let config: AuthConfigV2;
  try {
    config = await loadAuthConfig();
  } catch (error) {
    if (!behavior.silent) logError(safeAuthError(error));
    process.exitCode = 1;
    return null;
  }
  const resolvedSession = resolveAccountSession(config, apiUrl);
  if (resolvedSession.kind !== 'selected') {
    if (!behavior.silent) {
      logError(
        resolvedSession.kind === 'expired'
          ? 'The Tileflow account session has expired.'
          : 'No Tileflow account session is saved.',
      );
      printNextSteps([`Run ${command('tileflow login')} to authorize this machine.`]);
    }
    process.exitCode = 1;
    return null;
  }

  if (requestedMapId) {
    const capability = await requestMapCapability(
      resolvedSession.session,
      {mapId: requestedMapId},
      behavior.capabilityScopes ?? ['status:read'],
    );
    if (!capability.ok) {
      if (!behavior.silent) logError(capability.error);
      process.exitCode = 1;
      return null;
    }
    return {apiKey: capability.capability, apiUrl, mapId: capability.mapId};
  }

  const target = await resolveAccountProjectTarget(resolvedSession.session, options.project);
  if (target.kind === 'remote') {
    if (!behavior.silent) logError(target.error);
    process.exitCode = 1;
    return null;
  }
  if (target.kind !== 'selected') {
    if (!behavior.silent) {
      const references = target.targets.map((candidate) => candidate.reference);
      if (target.kind === 'ambiguous') {
        const retry = `${behavior.retryCommand ?? 'tileflow <command>'} --project ${references[0]}`;
        logError(`Managed destination is ambiguous: ${references.join(', ')}.`);
        printNextSteps([`Retry exactly with ${command(retry)}.`]);
      } else if (target.kind === 'invalid') {
        logError('Managed destination must use @organization/project syntax.');
      } else {
        logError(
          options.project
            ? `Destination ${options.project} is not accessible to this account.`
            : 'No active managed destination is accessible to this account.',
        );
      }
    }
    process.exitCode = 1;
    return null;
  }

  const capability = await requestProjectCapability(
    resolvedSession.session,
    target.target.reference,
    behavior.capabilityScopes ?? ['status:read'],
  );
  if (!capability.ok) {
    if (!behavior.silent) logError(capability.error);
    process.exitCode = 1;
    return null;
  }

  return {apiKey: capability.capability, apiUrl};
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

function logSuccess(message: string) {
  console.log(`${pc.green('✓')} ${message}`);
}

function logError(message: string) {
  console.log(`${pc.red('✕')} ${message}`);
}

function logWarning(message: string) {
  console.log(`${pc.yellow('!')} ${message}`);
}

function logInfo(message: string) {
  console.log(`${pc.cyan('i')} ${message}`);
}

function logMuted(message: string) {
  console.log(pc.gray(message));
}

function printTitle(title: string, subtitle?: string) {
  console.log(pc.bold(title));
  if (subtitle) {
    console.log(pc.gray(subtitle));
  }
}

function printKeyValue(label: string, value: string) {
  console.log(`${pc.gray(`${label}:`.padEnd(13))} ${value}`);
}

function printChecks(items: readonly string[]) {
  for (const item of items) {
    console.log(`  ${pc.green('✓')} ${item}`);
  }
}

function printNextSteps(steps: readonly string[]) {
  if (steps.length === 0) return;

  console.log(`\n${pc.bold('Next steps')}`);
  for (const step of steps) {
    console.log(`  ${pc.cyan('•')} ${step}`);
  }
}

function printValidationErrors(messages: readonly {message: string; path: string}[]) {
  logError('Tileflow config has errors.');
  for (const message of messages) {
    const path = message.path ? pc.cyan(message.path) : pc.cyan('(root)');
    console.log(`  ${pc.red('✕')} ${path} ${pc.gray('-')} ${message.message}`);
  }
}

function printAccountDetails(session: CliAccountSessionV2) {
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

  console.log(`\n${pc.bold('Maps')}`);
  for (const [name, map] of entries) {
    for (const [themeName, theme] of Object.entries(map.themes)) {
      const label = `${name}/${themeName}`;
      console.log(`  ${pc.green('✓')} ${label.padEnd(24)} ${link(theme.styleUrl)}`);
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

function cliInvocation(parts: string[]) {
  return parts.map(quoteCliArgument).join(' ');
}

function quoteCliArgument(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function link(value: string) {
  return pc.cyan(value);
}

function pathLabel(value: string) {
  return pc.cyan(value);
}

function starterConfig(): string {
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

function printHostedCompatibilityIssues(
  issues: ReturnType<typeof inspectTileflowHostedCompatibility>,
): boolean {
  if (issues.length === 0) return true;

  for (const issue of issues) logError(issue.message);
  process.exitCode = 1;
  return false;
}

function printMapStatus(status: HostedMapStatus, apiUrl: string) {
  printTitle('Tileflow status');
  printKeyValue('Map', pc.bold(status.mapId));

  console.log(`\n${pc.bold('Styles')}`);
  if (status.styles.length === 0) {
    logMuted('  No styles deployed.');
  }
  for (const style of status.styles) {
    console.log(
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
