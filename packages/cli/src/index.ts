#!/usr/bin/env node

import {serve} from '@hono/node-server';
import {Command} from 'commander';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {chmod, mkdir, readFile, stat, unlink, writeFile} from 'node:fs/promises';
import {homedir, hostname, platform} from 'node:os';
import {dirname, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import pc from 'picocolors';
import {
  type TileflowConfig,
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
  defaultTileflowTileset,
  getTileflowMapNames,
  loadTileflowConfig,
  loadValidTileflowConfig,
  type TileflowArtifactSessionState,
  TileflowIconCompilationError,
  type TileflowMapIconPackageBinding,
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
const defaultTileset = defaultTileflowTileset;
const maxTilesetUploadBytes = 32 * 1024 * 1024;

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
  tilesetId: string;
};

type DeployedManifest = {
  version: 1;
  apiUrl: string;
  maps: Record<string, DeployedManifestMap>;
  styles: Record<string, string>;
};

type StatusArchive = {
  r2Key: string;
  size: number;
  uploaded: string;
};

type StatusTileset = {
  tilesetId: string;
  name: string;
  r2Key: string;
  schema: string;
  attribution?: string;
  archive: StatusArchive | null;
};

type StatusStyle = {
  environment: string;
  key: string;
  size: number;
  uploaded: string;
};

type ProjectStatus = {
  projectId: string;
  tilesets: StatusTileset[];
  orphanArchives: StatusArchive[];
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
    '--tile-base-url <url>',
    'Tileflow tile API URL',
    process.env.TILEFLOW_TILE_BASE_URL ?? defaultApiUrl,
  )
  .action(async (options: {config: string; target: string; tileBaseUrl: string}) => {
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

    createTileflowStyles(project, {tileBaseUrl: options.tileBaseUrl});

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
    '--tile-base-url <url>',
    'Tileflow tile API URL',
    process.env.TILEFLOW_TILE_BASE_URL ?? defaultApiUrl,
  )
  .action(async (options: {config: string; out: string; tileBaseUrl: string}) => {
    logInfo(`Building ${pathLabel(options.config)}.`);
    await writeTileflowBuildArtifacts({
      config: options.config,
      outDir: options.out,
      styleBaseUrl: '.',
      tileBaseUrl: options.tileBaseUrl,
    });

    logSuccess('Built Tileflow artifacts.');
    printKeyValue('Output', pathLabel(resolve(process.cwd(), options.out)));
  });

program
  .command('dev')
  .description('Run a local map preview')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('-p, --port <port>', 'preview port', '3333')
  .option(
    '--tile-base-url <url>',
    'Tileflow tile API URL',
    process.env.TILEFLOW_TILE_BASE_URL ?? defaultApiUrl,
  )
  .option('--json', 'emit schema-version-1 NDJSON lifecycle events')
  .action(async (options: {config: string; json?: boolean; port: string; tileBaseUrl: string}) => {
    const port = parsePort(options.port);
    if (port === null) {
      logError(`Invalid port: ${options.port}`);
      process.exitCode = 1;
      return;
    }

    delete process.env.TILEFLOW_API_KEY;
    const origin = `http://localhost:${port}`;
    const session = await createTileflowArtifactSession({
      assetBaseUrl: origin,
      config: options.config,
      styleBaseUrl: origin,
      tileBaseUrl: options.tileBaseUrl,
      watch: true,
    });
    const fetch = createTileflowDevRequestHandler({
      config: options.config,
      onError: printTileflowPreviewError,
      session,
      tileBaseUrl: options.tileBaseUrl,
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

program
  .command('deploy')
  .description('Deploy maps to Tileflow and write the frontend manifest')
  .option('-c, --config <path>', 'config path', defaultConfigPath)
  .option('--manifest <path>', 'manifest path written for frontend bundlers', defaultManifestPath)
  .option('--tileset <id>', 'Tileflow tileset ID override')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL ?? defaultApiUrl)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .action(
    async (options: {
      config: string;
      manifest: string;
      tileset?: string;
      apiUrl?: string;
      apiKey?: string;
    }) => {
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

      if (!validateHostedMapCount(mapNames)) {
        return;
      }

      const bindingsByMap = new Map(
        compiledIcons.bindings.map((binding) => [binding.mapName, binding]),
      );
      const packagesByHash = new Map(
        compiledIcons.packages.map((iconPackage) => [iconPackage.contentHash, iconPackage]),
      );
      const deployments = mapNames.map((mapName) => {
        const tilesetId = options.tileset ?? resolveMapTileset(project, mapName) ?? defaultTileset;
        const iconBinding = bindingsByMap.get(mapName);
        const iconPackage = iconBinding ? packagesByHash.get(iconBinding.packageHash) : undefined;
        const mapConfig = createHostedDeployMapConfig(
          project,
          mapName,
          tilesetId,
          api.apiUrl,
          iconBinding,
        );
        return {iconBinding, iconPackage, mapConfig, mapName, tilesetId};
      });
      createTileflowStyles(
        {
          ...project,
          maps: Object.fromEntries(
            deployments.map((deployment) => [deployment.mapName, deployment.mapConfig]),
          ),
        },
        {tileBaseUrl: api.apiUrl},
      );

      for (const iconPackage of compiledIcons.packages) {
        const binding = compiledIcons.bindings.find(
          (candidate) => candidate.packageHash === iconPackage.contentHash,
        );
        const uploaded = await uploadHostedIconPackage(api, iconPackage, binding?.label ?? 'Icons');

        if (!uploaded) {
          process.exitCode = 1;
          return;
        }
      }

      const deployedMaps: Record<string, DeployedManifestMap> = {};
      const deployedStyles: Record<string, string> = {};

      for (const deployment of deployments) {
        const {iconBinding, iconPackage, mapConfig, mapName, tilesetId} = deployment;
        logInfo(`Deploying map ${pc.bold(mapName)} with tileset ${pc.bold(tilesetId)}.`);
        const response = await fetch(`${api.apiUrl}/v1/styles`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${api.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config: mapConfig,
            environment: mapName,
            ...(iconBinding && iconPackage
              ? {
                  iconPackage: {
                    contentHash: iconPackage.contentHash,
                    label: iconBinding.label,
                  },
                }
              : {icons: project.icons}),
            source,
            themes: project.themes,
            tilesetId,
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
          tilesetId,
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
        version: 1,
      });

      logSuccess('Deployed Tileflow maps.');
      printKeyValue('Manifest', pathLabel(manifestPath));
      printDeployedMaps(deployedMaps);
      printNextSteps([`Check hosted state with ${command('tileflow status')}.`]);
    },
  );

const tileset = program.command('tileset').description('Manage Tileflow tilesets');

tileset
  .command('register')
  .description('Register a project-owned tileset before uploading its PMTiles archive')
  .requiredOption('--id <id>', 'tileset ID')
  .option('--name <name>', 'display name')
  .option('--schema <schema>', 'tile schema', 'openmaptiles')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL ?? defaultApiUrl)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .action(
    async (options: {
      id: string;
      name?: string;
      schema: string;
      apiUrl?: string;
      apiKey?: string;
    }) => {
      const api = await requireApiOptions(options);
      if (!api) return;

      const response = await fetch(`${api.apiUrl}/v1/tilesets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${api.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tilesetId: options.id,
          name: options.name ?? options.id,
          schema: options.schema,
        }),
      });

      await printApiResponse(response, 'Registered tileset:');
    },
  );

tileset
  .command('upload <file>')
  .description('Upload a small PMTiles archive through the API')
  .requiredOption('--id <id>', 'tileset ID')
  .option('--api-url <url>', 'Tileflow API URL', process.env.TILEFLOW_API_URL ?? defaultApiUrl)
  .option('--api-key <key>', 'Tileflow API key', process.env.TILEFLOW_API_KEY)
  .action(
    async (
      file: string,
      options: {
        id: string;
        apiUrl?: string;
        apiKey?: string;
      },
    ) => {
      const api = await requireApiOptions(options);
      if (!api) return;

      const filePath = resolve(process.cwd(), file);
      const fileInfo = await stat(filePath);

      if (!fileInfo.isFile() || fileInfo.size > maxTilesetUploadBytes) {
        logError('Tileset upload must be a PMTiles file no larger than 32 MiB.');
        process.exitCode = 1;
        return;
      }

      const bytes = await readFile(filePath);
      const response = await fetch(`${api.apiUrl}/v1/tilesets/${options.id}/archive.pmtiles`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${api.apiKey}`,
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([bytes]),
      });

      await printApiResponse(response, 'Uploaded tileset archive:');
    },
  );

program
  .command('status')
  .description('Show registered tilesets, uploaded archives, and deployed styles')
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
    requestedScopes: ['static:write', 'status:read', 'styles:write', 'tilesets:write'],
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
    console.log(
      `  ${pc.green('✓')} ${name.padEnd(16)} ${link(map.styleUrl)} ${pc.gray(`(${map.tilesetId})`)}`,
    );
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
  return `import { defineTileflow, labels, osm, poi } from "@tileflow/core";

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
        font: "Inter"
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
        font: "Inter"
      }
    }
  },
  maps: {
    madrid: {
      basemap: osm(),
      theme: "light",
      modules: [
        labels({ roads: "major" }),
        poi({ preset: "minimal", icons: "essential" })
      ],
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

function resolveMapTileset(project: TileflowProjectConfig, mapName: string): string | undefined {
  const mapConfig = project.maps[mapName];
  const tilesetName =
    mapConfig?.tileset ?? mapConfig?.tiles?.tileset ?? mapConfig?.basemap?.tileset;

  if (!tilesetName) {
    return undefined;
  }

  return project.tilesets?.[tilesetName]?.id ?? tilesetName;
}

function createHostedDeployMapConfig(
  project: TileflowProjectConfig,
  mapName: string,
  tilesetId: string,
  apiUrl: string,
  iconBinding?: TileflowMapIconPackageBinding,
): TileflowConfig {
  const mapConfig = project.maps[mapName];
  const tilesetName =
    mapConfig?.tileset ?? mapConfig?.tiles?.tileset ?? mapConfig?.basemap?.tileset;
  const tilesetConfig = project.tilesets?.[tilesetName ?? ''] ?? project.tilesets?.[tilesetId];
  const {sourceLayers: tileSourceLayers, ...tileOptions} = mapConfig.tiles ?? {};
  const hostedTileSourceLayers = mapConfig.basemap?.sourceLayers ? undefined : tileSourceLayers;

  return {
    ...mapConfig,
    basemap: {
      ...mapConfig.basemap,
      type: mapConfig.basemap?.type ?? 'osm',
      tileset: tilesetId,
      attribution: mapConfig.basemap?.attribution ?? tilesetConfig?.attribution,
      sourceLayers: mapConfig.basemap?.sourceLayers ?? tilesetConfig?.sourceLayers,
    },
    tileset: tilesetId,
    glyphs: mapConfig.glyphs ?? `${normalizeUrl(apiUrl)}/fonts/{fontstack}/{range}.pbf`,
    ...(iconBinding
      ? {
          icons: iconBinding.mapping ? {mapping: iconBinding.mapping} : {},
        }
      : {}),
    tiles: {
      ...tileOptions,
      sourceId: mapConfig.tiles?.sourceId ?? 'tileflow',
      tileset: tilesetId,
      url: `${normalizeUrl(apiUrl)}/tiles/${tilesetId}/tiles.json`,
      ...(hostedTileSourceLayers ? {sourceLayers: hostedTileSourceLayers} : {}),
    },
  };
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
): Promise<boolean> {
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
    return false;
  }

  const body = (await response.json()) as {changed?: boolean};
  const totalBytes = iconPackage.manifest.files.reduce((total, file) => total + file.byteLength, 0);
  const action = body.changed === false ? 'Reused' : 'Uploaded';
  logSuccess(
    `${action} icon package ${pc.bold(label)} (${plural(iconPackage.manifest.iconNames.length, 'icon')}, ${formatBytes(totalBytes)}, ${iconPackage.contentHash.slice(0, 12)}).`,
  );
  return true;
}

function printProjectStatus(status: ProjectStatus, apiUrl: string) {
  printTitle('Tileflow status');
  printKeyValue('Project', pc.bold(status.projectId));

  console.log(`\n${pc.bold('Tilesets')}`);
  if (status.tilesets.length === 0) {
    logMuted('  No tilesets registered.');
  }
  for (const tileset of status.tilesets) {
    if (tileset.archive) {
      console.log(
        `  ${pc.green('✓')} ${tileset.tilesetId.padEnd(16)} ${tileset.r2Key.padEnd(36)} ${formatBytes(tileset.archive.size).padStart(10)}  ${pc.gray(formatDate(tileset.archive.uploaded))}`,
      );
    } else {
      console.log(
        `  ${pc.red('✕')} ${tileset.tilesetId.padEnd(16)} ${tileset.r2Key.padEnd(36)} ${pc.red('missing archive')}`,
      );
    }
  }

  if (status.orphanArchives.length > 0) {
    console.log(`\n${pc.bold('Orphan archives')} ${pc.gray('(no manifest)')}`);
    for (const archive of status.orphanArchives) {
      console.log(
        `  ${pc.yellow('?')} ${archive.r2Key.padEnd(53)} ${formatBytes(archive.size).padStart(10)}  ${pc.gray(formatDate(archive.uploaded))}`,
      );
    }
  }

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
