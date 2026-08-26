#!/usr/bin/env node

import {serve} from '@hono/node-server';
import {Command} from 'commander';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {hostname, platform} from 'node:os';
import {dirname, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import pc from 'picocolors';
import {serializeCanonicalJson, type TileflowProjectConfig, validateConfig} from '@tileflow/core';
import {
  type CompiledTileflowIconPackage,
  compileTileflowIconPackages,
  createTileflowArtifactSession,
  createTileflowDevRequestHandler,
  createTileflowStyles,
  defaultTileflowApiUrl,
  defaultTileflowConfigPath,
  defaultTileflowManifestPath,
  getTileflowMapNames,
  loadTileflowConfig,
  resolveTileflowPreview,
  type TileflowArtifactSessionState,
  TileflowIconCompilationError,
  TileflowStyleValidationError,
  TileflowValidationError,
  writeTileflowBuildArtifacts,
} from '@tileflow/dev';
import {
  type AccountIdentity,
  type AuthConfigV2,
  type CliAccountSessionV2,
  installAccountSession,
  loadAuthConfig,
  normalizeApiOrigin,
  parseProjectReference,
  type ProjectIdentity,
  projectReference,
  removeAccountSession,
  removeAuthFile,
  resolveAccountSession,
  writeAuthFileAtomic,
} from './account-session';
import {registerCaptureCommands} from './capture-command';
import {writeAtomicFileSet} from './capture-output';
import {withTileflowConfigSecretsHidden} from './config-execution';
import {allowsStoredDeployCredential, resolveDeploySource} from './deploy-source';
import {defaultTileflowDevHost, parseTileflowDevHost, tileflowDevOrigin} from './dev-host';
import {registerFeatureInspectCommand} from './feature-inspect-command';
import {inspectTileflowHostedCompatibility} from './hosted-preflight';
import {
  hostedIconPackageResponseSchema,
  type HostedProjectStatus,
  hostedProjectStatusSchema,
  hostedStyleDeploymentResponseSchema,
  readHostedError,
  readHostedJson,
} from './hosted-response';
import {registerIconDiffCommand} from './icon-diff-command';
import {registerIconListCommand} from './icon-list-command';
import {registerProjectCommands, resolveAccountProjectTarget} from './project-commands';
import {registerVisualCommands} from './visual-command';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {version: string};

const program = new Command();
const defaultApiUrl = defaultTileflowApiUrl;
const defaultAppUrl = 'https://tileflow.dev';
const defaultConfigPath = defaultTileflowConfigPath;
const defaultManifestPath = defaultTileflowManifestPath;

type ApiProfile = {
  apiKeyId: string;
  credentialType: 'project_api_key';
  organization: ProjectIdentity;
  project: ProjectIdentity;
  projectId: string;
  scopes: string[];
};

type DeviceAuthorization = {
  apiUrl: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
};

type DeviceToken = {
  account: AccountIdentity;
  accountSession: string;
  apiUrl: string;
  createdAt: string;
  expiresAt: string;
  sessionId: string;
};

type DeployedManifestMap = {
  environment: string;
  mapId: string;
  styleId?: string;
  styleUrl: string;
  usageMode?: 'session';
  worldGeneration?: 'v1';
};

type DeployedManifest = {
  version: 2;
  apiUrl: string;
  maps: Record<string, DeployedManifestMap>;
  styles: Record<string, string>;
};

program
  .name('tileflow')
  .description('Beautiful maps from config.')
  .version(packageJson.version)
  .showHelpAfterError(pc.gray('\nRun tileflow <command> --help for usage.'))
  .showSuggestionAfterError();

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
      `Install ${pc.cyan('@tileflow/core')} in this project if it is not already installed.`,
      `Preview locally with ${command('tileflow dev')}.`,
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

    const response = await fetch(`${apiUrl}/v1/cli/account/session`, {
      headers: {Authorization: `Bearer ${session.accountSession}`},
      method: 'DELETE',
    }).catch(() => null);
    if (!response || (response.status !== 401 && !response.ok)) {
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
  .action(async (options: {apiBaseUrl: string; config: string; target: string}) => {
    if (options.target !== 'local' && options.target !== 'hosted') {
      logError(`Invalid validation target: ${options.target}`);
      printNextSteps([
        `Use ${command('tileflow validate --target local')} or ${command('tileflow validate --target hosted')}.`,
      ]);
      process.exitCode = 1;
      return;
    }

    logInfo(`Validating ${pathLabel(options.config)}.`);
    const project = await withTileflowConfigSecretsHidden(() => loadTileflowConfig(options.config));
    const result = validateConfig(project);

    if (!result.valid) {
      printValidationErrors(result.messages);
      process.exitCode = 1;
      return;
    }

    const mapNames = getTileflowMapNames(project);
    await compileTileflowIconPackages(project, {
      cwd: process.cwd(),
      target: options.target,
    });

    const styles = createTileflowStyles(project, {apiBaseUrl: options.apiBaseUrl});
    if (
      options.target === 'hosted' &&
      !printHostedCompatibilityIssues(inspectTileflowHostedCompatibility(mapNames, styles))
    ) {
      return;
    }

    logSuccess(`Config is valid (${plural(mapNames.length, 'map')}).`);
    printChecks([
      'Config schema',
      'Local icon package',
      'Named map styles',
      'MapLibre style semantics',
      ...(options.target === 'hosted' ? ['Hosted compatibility'] : []),
    ]);
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
  .command('dev')
  .description('Run a local map preview')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--host <host>', 'bind host: an explicit IP address or localhost', defaultTileflowDevHost)
  .option('--map <name>', 'preview one configured map')
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
      config: string;
      host: string;
      json?: boolean;
      map?: string;
      port: string;
      scene?: string;
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

      const host = parseTileflowDevHost(options.host);
      if (!host) {
        logError('--host expects an IP address or localhost.');
        process.exitCode = 1;
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
  .option('--project <target>', 'technical destination @organization/project')
  .option('--world-promotion <id>', 'continue one verified Tileflow World promotion')
  .option('--map <name>', 'map to connect when a promotion config contains multiple maps')
  .action(
    async (options: {
      config: string;
      manifest: string;
      apiUrl?: string;
      apiKey?: string;
      project?: string;
      map?: string;
      worldPromotion?: string;
    }) => {
      const source = resolveDeploySource(process.env);
      const resolveApi = (selectedMap?: string) =>
        requireApiOptions(options, {
          allowStoredCredential: allowsStoredDeployCredential(source),
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
            ...(options.worldPromotion && selectedMap
              ? ['--world-promotion', options.worldPromotion, '--map', selectedMap]
              : []),
          ]),
        });
      let api = options.worldPromotion ? null : await resolveApi();
      if (!options.worldPromotion && !api) return;
      // The config is executable repository code. Keep the captured bearer
      // credential for the HTTP request, but do not expose it while Jiti
      // imports tileflow.config.ts or anything that file imports.
      delete process.env.TILEFLOW_API_KEY;

      logInfo(`Deploying ${pathLabel(options.config)}.`);
      const project = await withTileflowConfigSecretsHidden(() =>
        loadTileflowConfig(options.config),
      );
      const validation = validateConfig(project);

      if (!validation.valid) {
        printValidationErrors(validation.messages);
        process.exitCode = 1;
        return;
      }

      const configuredMapNames = getTileflowMapNames(project);
      const mapNames = selectWorldPromotionMaps(configuredMapNames, options);
      if (!mapNames) return;
      const deploymentProject: TileflowProjectConfig =
        mapNames.length === configuredMapNames.length
          ? project
          : {
              ...project,
              maps: Object.fromEntries(
                mapNames.map((mapName) => [mapName, project.maps[mapName]!]),
              ),
            };
      let existingManifest: DeployedManifest | null = null;
      if (options.worldPromotion) {
        try {
          existingManifest = await loadExistingDeployManifest(options.manifest);
        } catch (error) {
          logError(error instanceof Error ? error.message : 'Existing manifest is invalid.');
          process.exitCode = 1;
          return;
        }
      }
      api ??= await resolveApi(mapNames[0]);
      if (!api) return;
      if (existingManifest && normalizeUrl(existingManifest.apiUrl) !== api.apiUrl) {
        logError('Existing manifest belongs to a different Tileflow API origin.');
        process.exitCode = 1;
        return;
      }
      const compiledIcons = await compileTileflowIconPackages(deploymentProject, {
        cwd: process.cwd(),
        target: 'hosted',
      });

      // Validate the complete local style before the first remote write. Hosted
      // sprite URLs are substituted after upload, but they do not change layer
      // semantics.
      const preflightStyles = createTileflowStyles(deploymentProject, {apiBaseUrl: api.apiUrl});

      if (
        !printHostedCompatibilityIssues(
          inspectTileflowHostedCompatibility(mapNames, preflightStyles),
        )
      ) {
        return;
      }

      const bindingsByMap = new Map(
        compiledIcons.bindings.map((binding) => [binding.mapName, binding]),
      );
      const packagesByHash = new Map(
        compiledIcons.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
      );
      const hostedSpriteByPackageHash = new Map<string, string>();

      for (const iconPackage of compiledIcons.packages) {
        const binding = compiledIcons.bindings.find(
          (candidate) => candidate.packageHash === iconPackage.contentHash,
        );
        const uploaded = await uploadHostedIconPackage(api, iconPackage, binding?.label ?? 'Icons');

        if (!uploaded) {
          process.exitCode = 1;
          return;
        }

        hostedSpriteByPackageHash.set(iconPackage.contentHash, uploaded.spriteUrl);
      }

      const hostedProject: TileflowProjectConfig = {
        ...deploymentProject,
        maps: Object.fromEntries(
          Object.entries(deploymentProject.maps).map(([mapName, map]) => {
            const binding = bindingsByMap.get(mapName);
            if (!binding) return [mapName, map];

            const sprite = hostedSpriteByPackageHash.get(binding.packageHash);
            if (!sprite) {
              throw new Error(`Missing hosted sprite URL for map ${mapName}`);
            }

            return [
              mapName,
              {
                ...map,
                icons: {
                  ...(binding.mapping ? {mapping: binding.mapping} : {}),
                  sprite,
                },
              },
            ];
          }),
        ),
      };
      const styles = createTileflowStyles(hostedProject, {apiBaseUrl: api.apiUrl});
      const deployments = mapNames.map((mapName) => {
        const iconBinding = bindingsByMap.get(mapName);
        const iconPackage = iconBinding ? packagesByHash.get(iconBinding.packageHash) : undefined;
        return {
          allowedOrigins: deploymentProject.maps[mapName]?.allowedOrigins,
          iconBinding,
          iconPackage,
          mapName,
          style: styles[mapName]!,
        };
      });

      const deployedMaps: Record<string, DeployedManifestMap> = {};
      const deployedStyles: Record<string, string> = {};

      for (const deployment of deployments) {
        const {allowedOrigins, iconBinding, iconPackage, mapName, style} = deployment;
        const serializedStyle = serializeCanonicalJson(style);
        const styleHash = createHash('sha256').update(serializedStyle).digest('hex');
        logInfo(`Deploying compiled map ${pc.bold(mapName)}.`);
        const response = await fetch(`${api.apiUrl}/v1/styles`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${api.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            artifact: {
              schemaVersion: 1,
              style,
              receipt: {
                basemap: style.metadata?.['tileflow:basemap'],
                basemapVersion: style.metadata?.['tileflow:basemapVersion'],
                compilerVersion: packageJson.version,
                data: style.metadata?.['tileflow:data'],
                ...(style.metadata?.['tileflow:provenance']
                  ? {provenance: style.metadata['tileflow:provenance']}
                  : {}),
                styleHash,
              },
            },
            environment: mapName,
            ...(options.worldPromotion
              ? {usageMode: 'session', worldPromotionId: options.worldPromotion}
              : {}),
            ...(allowedOrigins ? {policy: {allowedOrigins}} : {}),
            ...(iconBinding && iconPackage
              ? {
                  iconPackage: {
                    contentHash: iconPackage.contentHash,
                    label: iconBinding.label,
                    ...(iconBinding.mapping ? {mapping: iconBinding.mapping} : {}),
                  },
                }
              : {}),
            source,
          }),
        });

        if (!response.ok) {
          logError(await readHostedError(response, `Deploy failed for ${mapName}`));
          process.exitCode = 1;
          return;
        }

        const body = await readHostedJson(
          response,
          hostedStyleDeploymentResponseSchema,
          `Deploy response for ${mapName}`,
        );
        if (options.worldPromotion && body.worldPromotionId !== options.worldPromotion) {
          logError(`Deploy response did not confirm the World promotion for ${mapName}.`);
          process.exitCode = 1;
          return;
        }
        const styleUrl = body.mapUrl;
        deployedMaps[mapName] = {
          environment: mapName,
          mapId: body.mapId,
          styleId: body.styleId,
          styleUrl,
          ...(options.worldPromotion
            ? {usageMode: 'session' as const, worldGeneration: 'v1' as const}
            : {}),
        };
        deployedStyles[mapName] = styleUrl;
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
        styles: {...(existingManifest?.styles ?? {}), ...deployedStyles},
        version: 2,
      });

      logSuccess('Deployed Tileflow maps.');
      printKeyValue('Manifest', pathLabel(manifestPath));
      printDeployedMaps(deployedMaps);
      printNextSteps([`Check hosted state with ${command('tileflow status')}.`]);
    },
  );

program
  .command('status')
  .description('Show deployed compiled styles')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .option('--project <target>', 'technical destination @organization/project')
  .option('--json', 'print raw JSON')
  .action(async (options: {apiUrl?: string; apiKey?: string; json?: boolean; project?: string}) => {
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

    let status: HostedProjectStatus;
    try {
      const response = await fetch(`${api.apiUrl}/v1/status`, {
        headers: {
          Authorization: `Bearer ${api.apiKey}`,
        },
      });

      if (!response.ok) throw new Error(await readHostedError(response, 'Status failed'));
      status = await readHostedJson(response, hostedProjectStatusSchema, 'Status response');
    } catch (error) {
      const message = safeStatusError(error);
      if (options.json) console.error(message);
      else logError(message);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    printProjectStatus(status, api.apiUrl);
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
      allowStoredCredential: allowsStoredDeployCredential(source),
      capabilityScopes: ['status:read'],
      retryCommand: cliInvocation([
        'tileflow',
        'icons',
        'diff',
        '--against',
        options.against,
        ...(options.config ? ['--config', options.config] : []),
        '--api-url',
        options.apiUrl ?? defaultApiUrl,
      ]),
      silent: true,
    });
  },
});
const inspectCommand = program.command('inspect').description('Inspect map data for authoring');
registerFeatureInspectCommand(inspectCommand, {defaultConfigPath});
registerCaptureCommands(program, {defaultConfigPath});
registerVisualCommands(program, {defaultConfigPath});
registerProjectCommands(program, {
  defaultApiUrl,
  loadAuthConfig,
});

program.parseAsync().catch((error: unknown) => {
  printCliError(error);
  process.exitCode = 1;
});

type TileflowDevServer = ReturnType<typeof serve>;

function waitForTerminationSignal(server: TileflowDevServer): Promise<void> {
  return new Promise((resolveStop, rejectStop) => {
    const cleanup = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      server.removeListener('error', onError);
    };
    const onSignal = () => {
      cleanup();
      resolveStop();
    };
    const onError = (error: Error) => {
      cleanup();
      rejectStop(error);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
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

async function startDeviceAuthorization(
  appUrl: string,
  body: {
    codeChallenge: string;
    deviceName: string;
  },
) {
  const response = await fetch(`${appUrl}/api/cli/device/start`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<DeviceAuthorization> & {error?: string})
    | null;

  if (!response.ok || !payload?.deviceCode || !payload.userCode) {
    throw new Error(payload?.error ?? `Could not start CLI authorization (${response.status}).`);
  }

  return payload as DeviceAuthorization;
}

async function pollDeviceToken(
  appUrl: string,
  authorization: DeviceAuthorization,
  options: {codeVerifier: string},
) {
  const expiresAt = Date.now() + authorization.expiresIn * 1000;
  const intervalMs = Math.max(authorization.interval, 1) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);

    const response = await fetch(`${appUrl}/api/cli/device/token`, {
      body: JSON.stringify({
        codeVerifier: options.codeVerifier,
        deviceCode: authorization.deviceCode,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const payload = (await response.json().catch(() => null)) as
      | (Partial<DeviceToken> & {error?: string})
      | null;

    if (response.ok && isDeviceToken(payload)) {
      return payload as DeviceToken;
    }

    if (payload?.error === 'authorization_pending') {
      continue;
    }

    if (payload?.error === 'access_denied') {
      throw new Error('CLI authorization was denied.');
    }

    throw new Error(payload?.error ?? `CLI authorization failed (${response.status}).`);
  }

  throw new Error('CLI authorization expired. Run `tileflow login` again.');
}

async function validateAccountSession(
  session: CliAccountSessionV2,
): Promise<
  | {ok: true; value: {account: AccountIdentity; session: {expiresAt: string; id: string}}}
  | {error: string; ok: false}
> {
  const response = await fetch(`${session.apiOrigin}/v1/cli/account`, {
    headers: {Authorization: `Bearer ${session.accountSession}`},
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    return {
      error:
        body && typeof body.error === 'string'
          ? body.error
          : `Account session validation failed (${response.status}).`,
      ok: false,
    };
  }

  const account = body ? asRecord(body.account) : {};
  const sessionProfile = body ? asRecord(body.session) : {};
  if (
    body?.schemaVersion !== 1 ||
    !isAccountIdentity(account) ||
    typeof sessionProfile.id !== 'string' ||
    sessionProfile.id !== session.sessionId ||
    !validIsoDate(sessionProfile.expiresAt) ||
    sessionProfile.expiresAt !== session.expiresAt ||
    Object.hasOwn(body, 'project')
  ) {
    return {error: 'Account session validation returned an invalid response.', ok: false};
  }

  return {
    ok: true,
    value: {
      account,
      session: {expiresAt: sessionProfile.expiresAt, id: sessionProfile.id},
    },
  };
}

async function validateApiKey(
  apiUrl: string,
  apiKey: string,
): Promise<{ok: true; value: ApiProfile} | {error: string; ok: false}> {
  const response = await fetch(`${apiUrl}/v1/me`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | Partial<ApiProfile>
    | {error?: string}
    | null;

  if (!response.ok) {
    return {
      error:
        body && 'error' in body && body.error
          ? body.error
          : `API key validation failed (${response.status}).`,
      ok: false,
    };
  }

  if (
    !body ||
    !('apiKeyId' in body) ||
    typeof body.apiKeyId !== 'string' ||
    !('credentialType' in body) ||
    body.credentialType !== 'project_api_key' ||
    !('organization' in body) ||
    !isAuthIdentity(body.organization) ||
    !('project' in body) ||
    !isAuthIdentity(body.project) ||
    !('projectId' in body) ||
    typeof body.projectId !== 'string' ||
    body.projectId !== body.project.id ||
    !Array.isArray(body.scopes)
  ) {
    return {
      error: 'API key validation returned an invalid response.',
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      apiKeyId: body.apiKeyId,
      credentialType: body.credentialType,
      organization: body.organization,
      project: body.project,
      projectId: body.projectId,
      scopes: body.scopes.filter((scope): scope is string => typeof scope === 'string'),
    },
  };
}

function isAuthIdentity(value: unknown): value is ProjectIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.id === 'string' &&
    identity.id.length > 0 &&
    identity.id.length <= 160 &&
    typeof identity.name === 'string' &&
    identity.name.length > 0 &&
    identity.name.length <= 200 &&
    typeof identity.slug === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(identity.slug)
  );
}

function isAccountIdentity(value: unknown): value is AccountIdentity {
  const account = asRecord(value);
  return (
    typeof account.id === 'string' &&
    account.id.length > 0 &&
    account.id.length <= 200 &&
    typeof account.name === 'string' &&
    account.name.length > 0 &&
    account.name.length <= 200 &&
    typeof account.email === 'string' &&
    account.email.length > 2 &&
    account.email.length <= 320 &&
    account.email.includes('@')
  );
}

function isDeviceToken(value: unknown): value is DeviceToken {
  const token = asRecord(value);
  return (
    isAccountIdentity(token.account) &&
    typeof token.accountSession === 'string' &&
    /^tf_session_[0-9a-f]{64}$/u.test(token.accountSession) &&
    typeof token.apiUrl === 'string' &&
    safeApiOrigin(token.apiUrl) !== null &&
    validIsoDate(token.createdAt) &&
    validIsoDate(token.expiresAt) &&
    Date.parse(token.expiresAt) > Date.parse(token.createdAt) &&
    typeof token.sessionId === 'string' &&
    token.sessionId.length > 0 &&
    token.sessionId.length <= 200 &&
    !Object.hasOwn(token, 'project')
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeApiOrigin(value: string) {
  try {
    return normalizeApiOrigin(value);
  } catch {
    return null;
  }
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function randomBase64Url(byteLength: number) {
  return randomBytes(byteLength).toString('base64url');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url: string, errorsToStderr = false) {
  const os = platform();
  const command = os === 'darwin' ? 'open' : os === 'win32' ? 'cmd' : 'xdg-open';
  const args = os === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', () => {
    if (errorsToStderr) {
      console.error(`Could not open a browser. Visit ${url}`);
    } else {
      logWarning(`Could not open a browser. Visit ${url}`);
    }
  });
  child.unref();
}

async function writeDeployManifest(manifestPath: string, manifest: DeployedManifest) {
  const outputPath = resolve(process.cwd(), manifestPath);

  await writeAtomicFileSet({
    boundaryPath: dirname(outputPath),
    files: [{path: outputPath, source: `${JSON.stringify(manifest, null, 2)}\n`}],
    force: true,
    label: 'Deploy manifest',
    managed: true,
  });

  return manifestPath;
}

function selectWorldPromotionMaps(
  mapNames: string[],
  options: {map?: string; worldPromotion?: string},
): string[] | null {
  if (options.map && !options.worldPromotion) {
    logError('--map is reserved for continuing a verified World promotion.');
    process.exitCode = 1;
    return null;
  }
  if (!options.worldPromotion) return mapNames;
  if (!/^wpr_[A-Za-z0-9_-]{8,80}$/u.test(options.worldPromotion)) {
    logError('World promotion reference is invalid.');
    process.exitCode = 1;
    return null;
  }
  if (options.map) {
    if (!mapNames.includes(options.map)) {
      logError(`Unknown Tileflow map for World promotion: ${options.map}.`);
      printKeyValue('Maps', mapNames.join(', '));
      process.exitCode = 1;
      return null;
    }
    return [options.map];
  }
  if (mapNames.length === 1) return [mapNames[0]!];
  logError('World promotion requires an explicit map because this config contains multiple maps.');
  printKeyValue('Maps', mapNames.join(', '));
  printNextSteps([
    `Retry with ${command(`tileflow deploy --world-promotion ${options.worldPromotion} --map ${mapNames[0]}`)}.`,
  ]);
  process.exitCode = 1;
  return null;
}

async function loadExistingDeployManifest(manifestPath: string): Promise<DeployedManifest | null> {
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
  const record = asRecord(value);
  if (
    record.version !== 2 ||
    typeof record.apiUrl !== 'string' ||
    !safeApiOrigin(record.apiUrl) ||
    !record.maps ||
    typeof record.maps !== 'object' ||
    Array.isArray(record.maps) ||
    !record.styles ||
    typeof record.styles !== 'object' ||
    Array.isArray(record.styles)
  ) {
    throw new Error('Existing Tileflow manifest does not match version 2.');
  }
  const maps: Record<string, DeployedManifestMap> = {};
  const styles: Record<string, string> = {};
  for (const [name, entryValue] of Object.entries(record.maps as Record<string, unknown>)) {
    const entry = asRecord(entryValue);
    if (
      !boundedManifestValue(name) ||
      !boundedManifestValue(entry.environment) ||
      !boundedManifestValue(entry.mapId) ||
      !boundedManifestValue(entry.styleUrl) ||
      (entry.styleId !== undefined && !boundedManifestValue(entry.styleId)) ||
      (entry.usageMode !== undefined && entry.usageMode !== 'session') ||
      (entry.worldGeneration !== undefined && entry.worldGeneration !== 'v1') ||
      (entry.usageMode === undefined) !== (entry.worldGeneration === undefined)
    ) {
      throw new Error('Existing Tileflow manifest contains an invalid map entry.');
    }
    maps[name] = {
      environment: entry.environment,
      mapId: entry.mapId,
      ...(typeof entry.styleId === 'string' ? {styleId: entry.styleId} : {}),
      styleUrl: entry.styleUrl,
      ...(entry.usageMode === 'session' ? {usageMode: 'session', worldGeneration: 'v1'} : {}),
    };
  }
  for (const [name, styleUrl] of Object.entries(record.styles as Record<string, unknown>)) {
    if (!boundedManifestValue(name) || !boundedManifestValue(styleUrl)) {
      throw new Error('Existing Tileflow manifest contains an invalid style entry.');
    }
    styles[name] = styleUrl;
  }
  if (Object.keys(maps).length > 1_000 || Object.keys(styles).length > 1_000) {
    throw new Error('Existing Tileflow manifest contains too many entries.');
  }
  return {apiUrl: record.apiUrl, maps, styles, version: 2};
}

function boundedManifestValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 2_048 &&
    !/\p{Cc}/u.test(value)
  );
}

async function requireApiOptions(
  options: {
    apiUrl?: string;
    apiKey?: string;
    project?: string;
  },
  behavior: {
    allowStoredCredential?: boolean;
    capabilityScopes?: Array<'static:write' | 'status:read' | 'styles:write'>;
    retryCommand?: string;
    silent?: boolean;
  } = {},
): Promise<{apiUrl: string; apiKey: string} | null> {
  const apiUrl = normalizeApiOrigin(options.apiUrl ?? defaultApiUrl);
  const requested = options.project ? parseProjectReference(options.project) : null;

  if (options.project && !requested) {
    if (!behavior.silent) logError('Managed destination must use @organization/project syntax.');
    process.exitCode = 1;
    return null;
  }

  if (options.apiKey) {
    if (requested) {
      const profile = await validateApiKey(apiUrl, options.apiKey);
      if (!profile.ok) {
        if (!behavior.silent) logError(profile.error);
        process.exitCode = 1;
        return null;
      }
      if (projectReference(profile.value) !== options.project) {
        if (!behavior.silent) {
          logError(
            `This project key belongs to ${projectReference(profile.value)}, not ${options.project}.`,
          );
        }
        process.exitCode = 1;
        return null;
      }
    }
    return {apiKey: options.apiKey, apiUrl};
  }

  const allowStoredCredential =
    behavior.allowStoredCredential !== false &&
    allowsStoredDeployCredential(resolveDeploySource(process.env));
  if (!allowStoredCredential) {
    if (!behavior.silent) {
      logError('CI requires an explicit application-scoped Tileflow API key.');
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

async function requestProjectCapability(
  session: CliAccountSessionV2,
  project: string,
  scopes: Array<'static:write' | 'status:read' | 'styles:write'>,
): Promise<{capability: string; ok: true} | {error: string; ok: false}> {
  const response = await fetch(`${session.apiOrigin}/v1/cli/project-capabilities`, {
    body: JSON.stringify({project, scopes}),
    headers: {
      Authorization: `Bearer ${session.accountSession}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const source = await response.text();
  if (source.length > 1024 * 1024) {
    return {error: 'Capability response exceeded the safe size limit.', ok: false};
  }
  let body: Record<string, unknown> = {};
  try {
    body = asRecord(source ? (JSON.parse(source) as unknown) : null);
  } catch {
    // The stable error below does not echo an untrusted response body.
  }
  if (!response.ok) {
    return {
      error:
        typeof body.error === 'string'
          ? body.error
          : `Project capability request failed (${response.status}).`,
      ok: false,
    };
  }
  if (
    typeof body.capability !== 'string' ||
    !body.capability.startsWith('tf_cap_') ||
    body.capability.length > 8_192 ||
    body.reference !== project ||
    !validIsoDate(body.expiresAt) ||
    !Array.isArray(body.scopes) ||
    body.scopes.join('\0') !== [...scopes].sort().join('\0')
  ) {
    return {error: 'Destination capability response was invalid.', ok: false};
  }
  return {capability: body.capability, ok: true};
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

  const message = error instanceof Error ? error.message : 'Command failed.';
  if (message.includes("Cannot find module '@tileflow/core'")) {
    logError(`Cannot load ${pc.cyan('@tileflow/core')} from this project.`);
    printNextSteps([
      `Install ${pc.cyan('@tileflow/core')} in this project.`,
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
    console.log(`  ${pc.green('✓')} ${name.padEnd(16)} ${link(map.styleUrl)}`);
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
  return `import { defineTileflow, labels, poi, streets } from "@tileflow/core";

export default defineTileflow({
  themes: {
    light: {
      colors: {
        background: "#F8F7F7",
        land: "#F4F2ED",
        water: "#8ED6E8",
        park: "#C3F1D5",
        building: "#EEF0F2",
        road: "#FFFFFF",
        roadMajor: "#F5D58A",
        roadCasing: "#DDE0E3",
        boundary: "#C9CED3",
        text: "#566371",
        textMuted: "#8A98A8",
        textHalo: "#FFFFFF"
      },
      typography: {
        font: "Noto Sans"
      }
    },
    dark: {
      colors: {
        background: "#161A1D",
        land: "#20262B",
        water: "#18384D",
        park: "#24442F",
        building: "#2B3339",
        road: "#38434C",
        roadMajor: "#6E7580",
        roadCasing: "#58636C",
        boundary: "#53606B",
        text: "#D9E2EA",
        textMuted: "#A3AFBA",
        textHalo: "#161A1D"
      },
      typography: {
        font: "Noto Sans"
      }
    }
  },
  maps: {
    madrid: {
      basemap: streets(),
      theme: "light",
      modules: {
        labels: labels({ roads: "major" }),
        poi: poi({ preset: "minimal", icons: "essential" })
      },
      view: {
        center: [-3.7038, 40.4168],
        zoom: 12
      }
    }
  },
  scenes: {
    "madrid-desktop": {
      map: "madrid",
      camera: {
        type: "center",
        center: [-3.7038, 40.4168],
        zoom: 12
      },
      viewport: {
        width: 1200,
        height: 800,
        dpr: 1
      }
    }
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

async function uploadHostedIconPackage(
  api: {apiKey: string; apiUrl: string},
  iconPackage: CompiledTileflowIconPackage,
  label: string,
): Promise<{spriteUrl: string} | undefined> {
  const formData = new FormData();
  const fieldNames: Record<string, string> = {
    'sprite.json': 'spriteJson',
    'sprite.png': 'spritePng',
    'sprite@2x.json': 'sprite2xJson',
    'sprite@2x.png': 'sprite2xPng',
  };

  for (const file of iconPackage.files) {
    const fieldName = fieldNames[file.fileName];

    if (!fieldName) {
      throw new Error(`Unknown generated icon package file: ${file.fileName}`);
    }

    const bytes = new Uint8Array(file.source.byteLength);
    bytes.set(file.source);
    formData.append(fieldName, new Blob([bytes.buffer], {type: file.contentType}), file.fileName);
  }

  const response = await fetch(`${api.apiUrl}/v1/icon-packages/${iconPackage.contentHash}`, {
    body: formData,
    headers: {Authorization: `Bearer ${api.apiKey}`},
    method: 'PUT',
  });

  if (!response.ok) {
    logError(await readHostedError(response, 'Icon package upload failed'));
    return undefined;
  }

  const body = await readHostedJson(
    response,
    hostedIconPackageResponseSchema,
    'Icon package upload response',
  );
  const totalBytes = iconPackage.manifest.files.reduce((total, file) => total + file.byteLength, 0);
  const action = body.changed === false ? 'Reused' : 'Uploaded';
  logSuccess(
    `${action} icon package ${pc.bold(label)} (${plural(iconPackage.manifest.iconNames.length, 'icon')}, ${formatBytes(totalBytes)}, ${iconPackage.contentHash.slice(0, 12)}).`,
  );
  return {spriteUrl: body.spriteUrl};
}

function printProjectStatus(status: HostedProjectStatus, apiUrl: string) {
  printTitle('Tileflow status');
  printKeyValue('Application', pc.bold(status.projectId));

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
