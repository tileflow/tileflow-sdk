import {resolve} from 'node:path';
import type {Plugin, ResolvedConfig} from 'vite';
import {
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  createTileflowDevRequestHandler,
  createTileflowNodeRequest,
  defaultTileflowConfigPath,
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  isTileflowRequestUrl,
  joinTileflowPublicUrl,
  normalizeTileflowBasePath,
  writeTileflowNodeResponse,
} from '@tileflow/dev';

export type TileflowVitePluginOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  emitBuildArtifacts?: boolean;
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
      const watchedIconPaths = new Set<string>();
      const sessionPromise = createTileflowArtifactSession({
        assetBaseUrl: basePath,
        config: configPath,
        cwd: root,
        styleBaseUrl: basePath,
        apiBaseUrl: options.apiBaseUrl,
        watch: false,
      });
      const handlerPromise = sessionPromise.then((session) => {
        session.subscribe((state) => {
          if (state.status === 'ready' && state.generation > 1) {
            server.ws.send({type: 'full-reload'});
          }
        });
        return createTileflowDevRequestHandler({
          basePath,
          config: configPath,
          cwd: root,
          onError(error) {
            const message = error instanceof Error ? error.message : 'Unknown Tileflow error';
            server.config.logger.error(`[tileflow] ${message}`);
          },
          session,
          apiBaseUrl: options.apiBaseUrl,
        });
      });
      const refreshWatchedIconPaths = async () => {
        try {
          const session = await sessionPromise;
          const watchPaths = session.getLastGoodArtifacts()?.watchPaths ?? [];

          for (const watchPath of watchPaths) {
            if (!watchedIconPaths.has(watchPath)) {
              server.watcher.add(watchPath);
              watchedIconPaths.add(watchPath);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown Tileflow error';
          server.config.logger.warn(`[tileflow] Unable to watch icon paths: ${message}`);
        }
      };
      const reloadIfTileflowInput = (file: string) => {
        if (!isTileflowInputPath(file, root, configFile, watchedIconPaths)) return;
        void sessionPromise.then(async (session) => {
          await session.refresh('vite watcher');
          await refreshWatchedIconPaths();
        });
      };

      server.watcher.add(configFile);
      void refreshWatchedIconPaths();
      server.watcher.on('add', reloadIfTileflowInput);
      server.watcher.on('change', reloadIfTileflowInput);
      server.watcher.on('unlink', reloadIfTileflowInput);
      server.httpServer?.once('close', () => {
        void sessionPromise.then((session) => session.close());
      });

      server.middlewares.use(async (request, response, next) => {
        if (!isTileflowRequestUrl(request.url, basePath)) {
          next();
          return;
        }

        try {
          const tileflowRequest = createTileflowNodeRequest(request);
          const tileflowResponse = await (await handlerPromise)(tileflowRequest);
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

      const artifacts = await createTileflowBuildArtifacts({
        assetBaseUrl: joinTileflowPublicUrl(config.base, basePath),
        config: configPath,
        cwd: config.root,
        styleBaseUrl: joinTileflowPublicUrl(config.base, basePath),
        apiBaseUrl: options.apiBaseUrl,
      });
      const assetBase = getTileflowAssetBasePath(basePath);

      this.emitFile({
        fileName: getTileflowAssetFileName(assetBase, 'manifest.json'),
        source: `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
        type: 'asset',
      });

      for (const [mapName, style] of Object.entries(artifacts.styles)) {
        this.emitFile({
          fileName: getTileflowAssetFileName(assetBase, `styles/${mapName}.json`),
          source: `${JSON.stringify(style, null, 2)}\n`,
          type: 'asset',
        });
      }

      for (const asset of artifacts.assets) {
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

function isWatchedIconPath(file: string, watchedIconPaths: Set<string>): boolean {
  const normalizedFile = normalizePath(file);

  for (const watchPath of watchedIconPaths) {
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

function isTileflowInputPath(
  file: string,
  root: string,
  configFile: string,
  watchedIconPaths: Set<string>,
): boolean {
  if (file === configFile || isWatchedIconPath(file, watchedIconPaths)) return true;
  const normalizedFile = normalizePath(file);
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return false;
  if (
    /\/(?:node_modules|\.git|\.tileflow|dist|build|coverage|\.next|\.cache|\.turbo)\//.test(
      normalizedFile,
    )
  ) {
    return false;
  }
  return /\.(?:cjs|cts|js|json|mjs|mts|ts|tsx)$/.test(normalizedFile);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
