#!/usr/bin/env node

import {serve} from '@hono/node-server';
import {Command} from 'commander';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {chmod, mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import {homedir, hostname, platform} from 'node:os';
import {dirname, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import pc from 'picocolors';
import {
  serializeCanonicalJson,
  tileflowHostedAlphaCompatibility,
  type TileflowProjectConfig,
  validateConfig,
} from '@tileflow/core';
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
  loadValidTileflowConfig,
  resolveTileflowPreview,
  type TileflowArtifactSessionState,
  TileflowIconCompilationError,
  TileflowStyleValidationError,
  TileflowValidationError,
  writeTileflowBuildArtifacts,
} from '@tileflow/dev';
import {registerCaptureCommands} from './capture-command';
import {allowsStoredDeployCredential, resolveDeploySource} from './deploy-source';
import {registerFeatureInspectCommand} from './feature-inspect-command';
import {registerIconDiffCommand} from './icon-diff-command';
import {registerIconListCommand} from './icon-list-command';
import {registerVisualCommands} from './visual-command';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {version: string};

const program = new Command();
const defaultApiUrl = defaultTileflowApiUrl;
const defaultAppUrl = 'https://tileflow.dev';
const defaultConfigPath = defaultTileflowConfigPath;
const defaultManifestPath = defaultTileflowManifestPath;

type AuthConfig = {
  apiKey?: string;
  apiUrl?: string;
  appUrl?: string;
  createdAt?: string;
  deviceName?: string;
  keyPrefix?: string;
  projectId?: string;
  scopes?: string[];
};

type ApiProfile = {
  apiKeyId: string;
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
  apiKey: string;
  apiUrl: string;
  keyPrefix: string;
  projectId: string;
  scopes: string[];
};

type DeployedManifestMap = {
  environment: string;
  mapId: string;
  styleId?: string;
  styleUrl: string;
};

type DeployedManifest = {
  version: 2;
  apiUrl: string;
  maps: Record<string, DeployedManifestMap>;
  styles: Record<string, string>;
};

type StatusStyle = {
  environment: string;
  key: string;
  size: number;
  uploaded: string;
};

type ProjectStatus = {
  projectId: string;
  styles: StatusStyle[];
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
  .description('Authorize this machine for Tileflow deploys')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL)
  .option(
    '--app-url <url>',
    'Tileflow Dashboard URL',
    process.env.TILEFLOW_APP_URL ?? defaultAppUrl,
  )
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .option('--manual', 'paste an API key instead of opening the dashboard')
  .option('--no-browser', 'print the authorization URL without opening it')
  .action(
    async (options: {
      apiKey?: string;
      apiUrl?: string;
      appUrl?: string;
      manual?: boolean;
      noBrowser?: boolean;
    }) => {
      const apiUrl = normalizeUrl(options.apiUrl ?? defaultApiUrl);
      const appUrl = normalizeUrl(options.appUrl ?? defaultAppUrl);

      if (options.apiKey || options.manual) {
        const apiKey = options.apiKey ?? (await promptForApiKey(appUrl));

        if (!apiKey) {
          logError('Missing Tileflow API key.');
          process.exitCode = 1;
          return;
        }

        const profile = await validateApiKey(apiUrl, apiKey);

        if (!profile.ok) {
          logError(profile.error);
          process.exitCode = 1;
          return;
        }

        await writeAuthConfig({
          apiKey,
          apiUrl,
          appUrl,
          createdAt: new Date().toISOString(),
          keyPrefix: getKeyPrefix(apiKey),
          projectId: profile.value.projectId,
          scopes: profile.value.scopes,
        });
        logSuccess('Signed in to Tileflow.');
        printAuthDetails({
          apiUrl,
          appUrl,
          keyPrefix: getKeyPrefix(apiKey),
          projectId: profile.value.projectId,
          scopes: profile.value.scopes,
        });
        return;
      }

      try {
        await loginWithDeviceFlow({
          apiUrlOverride: options.apiUrl ? normalizeUrl(options.apiUrl) : undefined,
          appUrl,
          noBrowser: Boolean(options.noBrowser),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Login failed.';
        logError(message);
        process.exitCode = 1;
      }
    },
  );

program
  .command('logout')
  .description('Remove the saved Tileflow CLI credential')
  .action(async () => {
    const configPath = authConfigPath();

    if (!existsSync(configPath)) {
      logWarning('No Tileflow login is saved.');
      return;
    }

    await unlink(configPath);
    logSuccess('Removed Tileflow login.');
  });

program
  .command('whoami')
  .description('Show the active Tileflow CLI credential')
  .action(async () => {
    const auth = await readAuthConfig();

    if (!auth?.apiKey || !auth.apiUrl) {
      logError('Not logged in.');
      printNextSteps([`Run ${command('tileflow login')} to authorize this machine.`]);
      process.exitCode = 1;
      return;
    }

    const profile = await validateApiKey(normalizeUrl(auth.apiUrl), auth.apiKey);

    if (!profile.ok) {
      logError(profile.error);
      process.exitCode = 1;
      return;
    }

    logSuccess('Tileflow CLI is authenticated.');
    printAuthDetails({
      apiUrl: normalizeUrl(auth.apiUrl),
      appUrl: auth.appUrl ? normalizeUrl(auth.appUrl) : undefined,
      keyPrefix: auth.keyPrefix ?? getKeyPrefix(auth.apiKey),
      projectId: profile.value.projectId,
      scopes: profile.value.scopes,
    });
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
    const project = await loadTileflowConfig(options.config);
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

    if (options.target === 'hosted' && !validateHostedMapCount(mapNames)) {
      return;
    }

    createTileflowStyles(project, {apiBaseUrl: options.apiBaseUrl});

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
    await writeTileflowBuildArtifacts({
      config: options.config,
      outDir: options.out,
      styleBaseUrl: '.',
      apiBaseUrl: options.apiBaseUrl,
    });

    logSuccess('Built Tileflow artifacts.');
    printKeyValue('Output', pathLabel(resolve(process.cwd(), options.out)));
  });

program
  .command('dev')
  .description('Run a local map preview')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
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
      config: string;
      json?: boolean;
      map?: string;
      port: string;
      scene?: string;
      apiBaseUrl: string;
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

      delete process.env.TILEFLOW_API_KEY;
      const origin = `http://localhost:${port}`;
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
          const createdServer = serve({fetch, port}, () => resolveListening());
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
    },
  );

program
  .command('deploy')
  .description('Deploy maps to Tileflow and write the frontend manifest')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--manifest <path>', 'manifest path written for frontend bundlers', defaultManifestPath)
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL ?? defaultApiUrl)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .action(async (options: {config: string; manifest: string; apiUrl?: string; apiKey?: string}) => {
    const source = resolveDeploySource(process.env);
    const api = await requireApiOptions(options, {
      allowStoredCredential: allowsStoredDeployCredential(source),
    });
    if (!api) return;

    // The config is executable repository code. Keep the captured bearer
    // credential for the HTTP request, but do not expose it while Jiti
    // imports tileflow.config.ts or anything that file imports.
    delete process.env.TILEFLOW_API_KEY;

    logInfo(`Deploying ${pathLabel(options.config)}.`);
    const project = await loadTileflowConfig(options.config);
    const validation = validateConfig(project);

    if (!validation.valid) {
      printValidationErrors(validation.messages);
      process.exitCode = 1;
      return;
    }

    const mapNames = getTileflowMapNames(project);
    const compiledIcons = await compileTileflowIconPackages(project, {
      cwd: process.cwd(),
      target: 'hosted',
    });

    // Validate the complete local style before the first remote write. Hosted
    // sprite URLs are substituted after upload, but they do not change layer
    // semantics.
    createTileflowStyles(project, {apiBaseUrl: api.apiUrl});

    if (!validateHostedMapCount(mapNames)) {
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
      ...project,
      maps: Object.fromEntries(
        Object.entries(project.maps).map(([mapName, map]) => {
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
      return {iconBinding, iconPackage, mapName, style: styles[mapName]!};
    });

    const deployedMaps: Record<string, DeployedManifestMap> = {};
    const deployedStyles: Record<string, string> = {};

    for (const deployment of deployments) {
      const {iconBinding, iconPackage, mapName, style} = deployment;
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
          ...(iconBinding && iconPackage
            ? {
                iconPackage: {
                  contentHash: iconPackage.contentHash,
                  label: iconBinding.label,
                },
              }
            : {}),
          source,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        logError(`Deploy failed for ${mapName}: ${response.status} ${body}`);
        process.exitCode = 1;
        return;
      }

      const body = (await response.json()) as {
        changed?: boolean;
        deploymentId?: string;
        mapId?: string;
        url: string;
        mapUrl?: string;
        styleId?: string;
        version?: number;
      };
      const styleUrl = body.mapUrl ?? body.url;
      deployedMaps[mapName] = {
        environment: mapName,
        mapId: body.mapId ?? mapName,
        styleId: body.styleId,
        styleUrl,
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
      maps: deployedMaps,
      styles: deployedStyles,
      version: 2,
    });

    logSuccess('Deployed Tileflow maps.');
    printKeyValue('Manifest', pathLabel(manifestPath));
    printDeployedMaps(deployedMaps);
    printNextSteps([`Check hosted state with ${command('tileflow status')}.`]);
  });

program
  .command('status')
  .description('Show deployed compiled styles')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL ?? defaultApiUrl)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .option('--json', 'print raw JSON')
  .action(async (options: {apiUrl?: string; apiKey?: string; json?: boolean}) => {
    const api = await requireApiOptions(options);
    if (!api) return;

    const response = await fetch(`${api.apiUrl}/v1/status`, {
      headers: {
        Authorization: `Bearer ${api.apiKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      logError(`Status failed: ${response.status} ${body}`);
      process.exitCode = 1;
      return;
    }

    const status = (await response.json()) as ProjectStatus;

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
      silent: true,
    });
  },
});
const inspectCommand = program.command('inspect').description('Inspect map data for authoring');
registerFeatureInspectCommand(inspectCommand, {defaultConfigPath});
registerCaptureCommands(program, {defaultConfigPath});
registerVisualCommands(program, {defaultConfigPath});

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
  apiUrlOverride?: string;
  appUrl: string;
  noBrowser: boolean;
}) {
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = createPkceChallenge(codeVerifier);
  printTitle('Tileflow login', 'Authorize this machine from the Tileflow dashboard.');
  const authorization = await startDeviceAuthorization(options.appUrl, {
    codeChallenge,
    deviceName: hostname(),
    requestedScopes: ['static:write', 'status:read', 'styles:write'],
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
  const apiUrl = normalizeUrl(options.apiUrlOverride ?? token.apiUrl);
  const profile = await validateApiKey(apiUrl, token.apiKey);

  if (!profile.ok) {
    throw new Error(profile.error);
  }

  await writeAuthConfig({
    apiKey: token.apiKey,
    apiUrl,
    appUrl: options.appUrl,
    createdAt: new Date().toISOString(),
    deviceName: hostname(),
    keyPrefix: getKeyPrefix(token.apiKey),
    projectId: profile.value.projectId,
    scopes: profile.value.scopes,
  });

  logSuccess('Signed in to Tileflow.');
  printAuthDetails({
    apiUrl,
    appUrl: options.appUrl,
    keyPrefix: getKeyPrefix(token.apiKey),
    projectId: profile.value.projectId,
    scopes: profile.value.scopes,
  });
}

async function startDeviceAuthorization(
  appUrl: string,
  body: {
    codeChallenge: string;
    deviceName: string;
    requestedScopes: string[];
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

    if (response.ok && payload?.apiKey && payload.apiUrl) {
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

async function promptForApiKey(appUrl: string) {
  printTitle('Manual login', 'Paste a Tileflow API key to authorize this machine.');
  printKeyValue('Create key', link(`${appUrl}/dashboard`));
  logMuted('The key is stored locally in ~/.tileflow/config.json.');

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await readline.question(`${pc.cyan('?')} Tileflow API key: `)).trim();
  } finally {
    readline.close();
  }
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
    !('projectId' in body) ||
    typeof body.projectId !== 'string' ||
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
      projectId: body.projectId,
      scopes: body.scopes.filter((scope): scope is string => typeof scope === 'string'),
    },
  };
}

function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function randomBase64Url(byteLength: number) {
  return randomBytes(byteLength).toString('base64url');
}

function getKeyPrefix(apiKey: string) {
  return apiKey.slice(0, 18);
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

async function readAuthConfig(): Promise<AuthConfig | null> {
  try {
    return JSON.parse(await readFile(authConfigPath(), 'utf8')) as AuthConfig;
  } catch {
    return null;
  }
}

async function writeAuthConfig(config: AuthConfig & {apiKey: string; apiUrl: string}) {
  const configPath = authConfigPath();
  const configDir = dirname(configPath);

  await mkdir(configDir, {mode: 0o700, recursive: true});
  await chmod(configDir, 0o700).catch(() => undefined);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(configPath, 0o600).catch(() => undefined);
}

function authConfigPath() {
  return resolve(homedir(), '.tileflow', 'config.json');
}

async function writeDeployManifest(manifestPath: string, manifest: DeployedManifest) {
  const outputPath = resolve(process.cwd(), manifestPath);

  await mkdir(dirname(outputPath), {recursive: true});
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return manifestPath;
}

async function requireApiOptions(
  options: {
    apiUrl?: string;
    apiKey?: string;
  },
  behavior: {allowStoredCredential?: boolean; silent?: boolean} = {},
): Promise<{apiUrl: string; apiKey: string} | null> {
  const allowStoredCredential = behavior.allowStoredCredential !== false;
  const auth = allowStoredCredential ? await readAuthConfig() : null;
  const apiKey = options.apiKey ?? auth?.apiKey;
  const apiUrl = normalizeUrl(options.apiUrl ?? auth?.apiUrl ?? defaultApiUrl);

  if (!apiKey) {
    if (!behavior.silent) {
      logError('Missing Tileflow API key.');
      printNextSteps(
        allowStoredCredential
          ? [
              `Run ${command('tileflow login')} to authorize this machine.`,
              `Or set ${pc.cyan('TILEFLOW_API_KEY')} for this command.`,
            ]
          : [
              `Set ${pc.cyan('TILEFLOW_API_KEY')} from the CI secret store.`,
              'Use a dashboard-created CI deploy key with this workflow.',
            ],
      );
    }
    process.exitCode = 1;
    return null;
  }

  if (!apiUrl) {
    if (!behavior.silent) {
      logError(`Missing ${pc.cyan('TILEFLOW_API_URL')}.`);
    }
    process.exitCode = 1;
    return null;
  }

  return {
    apiKey,
    apiUrl,
  };
}

async function printApiResponse(response: Response, successMessage: string) {
  const bodyText = await response.text();

  if (!response.ok) {
    logError(`Request failed: ${response.status} ${bodyText}`);
    process.exitCode = 1;
    return;
  }

  logSuccess(successMessage.replace(/:$/, ''));
  if (bodyText.trim()) {
    console.log(formatResponseBody(bodyText));
  }
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

function printAuthDetails(details: {
  apiUrl?: string;
  appUrl?: string;
  keyPrefix?: string;
  projectId: string;
  scopes: readonly string[];
}) {
  printKeyValue('Project', pc.bold(details.projectId));
  if (details.apiUrl) {
    printKeyValue('API', link(details.apiUrl));
  }
  if (details.appUrl) {
    printKeyValue('Dashboard', link(details.appUrl));
  }
  if (details.keyPrefix) {
    printKeyValue('Key', `${details.keyPrefix}...`);
  }
  printKeyValue('Scopes', details.scopes.length ? details.scopes.join(', ') : 'none');
}

function printDeployedMaps(maps: Record<string, DeployedManifestMap>) {
  const entries = Object.entries(maps);
  if (entries.length === 0) return;

  console.log(`\n${pc.bold('Maps')}`);
  for (const [name, map] of entries) {
    console.log(`  ${pc.green('✓')} ${name.padEnd(16)} ${link(map.styleUrl)}`);
  }
}

function formatResponseBody(bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed) return '';

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
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

function validateHostedMapCount(mapNames: string[]): boolean {
  if (mapNames.length <= tileflowHostedAlphaCompatibility.maxMapsPerDeploy) {
    return true;
  }

  logError(
    `Hosted alpha validation accepts ${plural(tileflowHostedAlphaCompatibility.maxMapsPerDeploy, 'map')} per deploy.`,
  );
  printKeyValue('Maps', mapNames.join(', '));
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
    logError(`Icon package upload failed: ${response.status} ${await response.text()}`);
    return undefined;
  }

  const body = (await response.json()) as {changed?: boolean; spriteUrl?: unknown};
  if (typeof body.spriteUrl !== 'string' || body.spriteUrl.trim().length === 0) {
    logError('Icon package upload failed: the API response did not include a spriteUrl.');
    return undefined;
  }
  const totalBytes = iconPackage.manifest.files.reduce((total, file) => total + file.byteLength, 0);
  const action = body.changed === false ? 'Reused' : 'Uploaded';
  logSuccess(
    `${action} icon package ${pc.bold(label)} (${plural(iconPackage.manifest.iconNames.length, 'icon')}, ${formatBytes(totalBytes)}, ${iconPackage.contentHash.slice(0, 12)}).`,
  );
  return {spriteUrl: body.spriteUrl};
}

function printProjectStatus(status: ProjectStatus, apiUrl: string) {
  printTitle('Tileflow status');
  printKeyValue('Project', pc.bold(status.projectId));

  console.log(`\n${pc.bold('Styles')}`);
  if (status.styles.length === 0) {
    logMuted('  No styles deployed.');
  }
  for (const style of status.styles) {
    console.log(
      `  ${pc.green('✓')} ${style.environment.padEnd(16)} ${link(`${apiUrl}/v1/styles/${status.projectId}/${style.environment}.json`).padEnd(36)} ${formatBytes(style.size).padStart(10)}  ${pc.gray(formatDate(style.uploaded))}`,
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
