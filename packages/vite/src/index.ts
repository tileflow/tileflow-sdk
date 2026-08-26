import {resolve} from 'node:path';
import type {Plugin, ResolvedConfig} from 'vite';
import {
  assertTileflowSelfHostedManifestTarget,
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  defaultTileflowConfigPath,
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  normalizeTileflowBasePath,
  refreshTileflowArtifactSession,
  resolveTileflowArtifactPublicUrls,
} from '@tileflow/dev/artifacts';
import {
  createTileflowDevRequestHandler,
  createTileflowNodeRequest,
  isTileflowRequestUrl,
  writeTileflowNodeResponse,
} from '@tileflow/dev/server';

export type TileflowVitePluginOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  emitBuildArtifacts?: boolean;
  overwriteHostedManifest?: boolean;
};

export function tileflow(options: TileflowVitePluginOptions = {}): Plugin {
  const basePath = normalizeTileflowBasePath(options.base ?? '/tileflow');
  const configPath = options.config ?? defaultTileflowConfigPath;
  let viteConfig: ResolvedConfig | null = null;

  return {
    name: 'tileflow:vite',

    configResolved(config) {
      viteConfig = config;
    },

    configureServer(server) {
      const root = server.config.root;
      const configFile = resolve(root, configPath);
      const devBasePaths = getViteDevBasePaths(server.config.base ?? '/', basePath);
      const artifactBasePath = devBasePaths[devBasePaths.length - 1] ?? basePath;
      const watchedInputPaths = new Set<string>();
      const sessionPromise = createTileflowArtifactSession({
        assetBaseUrl: artifactBasePath,
        config: configPath,
        cwd: root,
        styleBaseUrl: artifactBasePath,
        apiBaseUrl: options.apiBaseUrl,
        watch: false,
      });
      const handlersPromise = sessionPromise.then((session) => {
        session.subscribe((state) => {
          if (state.status === 'ready' && state.generation > 1) {
            server.ws.send({type: 'full-reload'});
          }
        });
        return new Map(
          devBasePaths.map((devBasePath) => [
            devBasePath,
            createTileflowDevRequestHandler({
              basePath: devBasePath,
              config: configPath,
              cwd: root,
              onError(error) {
                const message = error instanceof Error ? error.message : 'Unknown Tileflow error';
                server.config.logger.error(`[tileflow] ${message}`);
              },
              session,
              apiBaseUrl: options.apiBaseUrl,
            }),
          ]),
        );
      });
      const refreshWatchedInputPaths = async () => {
        try {
          const session = await sessionPromise;
          const watchPaths = session.getLastGoodArtifacts()?.watchPaths ?? [];
          const nextWatchPaths = new Set(watchPaths);

          const staleWatchPaths = [...watchedInputPaths].filter(
            (watchPath) => !nextWatchPaths.has(watchPath),
          );
          if (staleWatchPaths.length > 0) {
            await server.watcher.unwatch(staleWatchPaths);
            for (const watchPath of staleWatchPaths) watchedInputPaths.delete(watchPath);
          }

          for (const watchPath of watchPaths) {
            if (!watchedInputPaths.has(watchPath)) {
              server.watcher.add(watchPath);
              watchedInputPaths.add(watchPath);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown Tileflow error';
          server.config.logger.warn(`[tileflow] Unable to watch input paths: ${message}`);
        }
      };
      const reloadIfTileflowInput = (file: string) => {
        if (file !== configFile && !isWatchedInputPath(file, watchedInputPaths)) return;
        void sessionPromise.then(async (session) => {
          await refreshTileflowArtifactSession(session, {
            inputPath: file,
            reason: 'vite watcher',
          });
          await refreshWatchedInputPaths();
        });
      };

      server.watcher.add(configFile);
      void refreshWatchedInputPaths();
      server.watcher.on('add', reloadIfTileflowInput);
      server.watcher.on('change', reloadIfTileflowInput);
      server.watcher.on('unlink', reloadIfTileflowInput);
      server.httpServer?.once('close', () => {
        void sessionPromise.then((session) => session.close());
      });

      server.middlewares.use(async (request, response, next) => {
        const requestBasePath = devBasePaths.find((candidate) =>
          isTileflowRequestUrl(request.url, candidate),
        );
        if (requestBasePath === undefined) {
          next();
          return;
        }

        try {
          const tileflowRequest = createTileflowNodeRequest(request);
          const handler = (await handlersPromise).get(requestBasePath);
          if (!handler)
            throw new Error(`Missing Tileflow Vite handler for ${requestBasePath || '/'}`);
          const tileflowResponse = await handler(tileflowRequest);
          await writeTileflowNodeResponse(response, tileflowResponse);
        } catch (error) {
          next(error);
        }
      });
    },

    async generateBundle() {
      if (options.emitBuildArtifacts === false) {
        return;
      }

      const config = viteConfig;

      if (!config) {
        return;
      }

      const publicUrls = resolveTileflowArtifactPublicUrls(config.base, basePath);
      const artifacts = await createTileflowBuildArtifacts({
        assetBaseUrl: publicUrls.assetBaseUrl,
        config: configPath,
        cwd: config.root,
        styleBaseUrl: publicUrls.styleBaseUrl,
        apiBaseUrl: options.apiBaseUrl,
      });
      const assetBase = getTileflowAssetBasePath(basePath);
      await assertTileflowSelfHostedManifestTarget(
        resolve(config.publicDir, assetBase, 'manifest.json'),
        {overwriteHostedManifest: options.overwriteHostedManifest},
      );

      for (const asset of artifacts.files) {
        this.emitFile({
          fileName: getTileflowAssetFileName(assetBase, asset.fileName),
          source: asset.source,
          type: 'asset',
        });
      }
    },
  };
}

export default tileflow;

function isWatchedInputPath(file: string, watchedInputPaths: Set<string>): boolean {
  const normalizedFile = normalizePath(file);

  for (const watchPath of watchedInputPaths) {
    const normalizedWatchPath = normalizePath(watchPath);

    if (
      normalizedFile === normalizedWatchPath ||
      normalizedFile.startsWith(`${normalizedWatchPath}/`)
    ) {
      return true;
    }
  }

  return false;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function getViteDevBasePaths(publicBase: string, basePath: string): string[] {
  const publicBaseUrl = resolveTileflowArtifactPublicUrls(publicBase, basePath).publicBaseUrl;
  const publicPath = publicBaseUrl.startsWith('/')
    ? normalizeTileflowBasePath(publicBaseUrl)
    : basePath;
  return [...new Set([basePath, publicPath])];
}
