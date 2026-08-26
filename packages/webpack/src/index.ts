import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  assertTileflowSelfHostedManifestTarget,
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  defaultTileflowConfigPath,
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  getTileflowWatchPaths,
  joinTileflowPublicUrl,
  normalizeTileflowBasePath,
  refreshTileflowArtifactSession,
  resolveTileflowArtifactPublicUrls,
  type TileflowArtifactSession,
} from '@tileflow/dev/artifacts';
import {
  createTileflowDevRequestHandler,
  createTileflowNodeRequest,
  isTileflowRequestUrl,
  writeTileflowNodeResponse,
} from '@tileflow/dev/server';

export type TileflowWebpackPluginOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  emitBuildArtifacts?: boolean;
  overwriteHostedManifest?: boolean;
  publicPath?: string;
};

type WebpackCompiler = {
  context: string;
  hooks: {
    afterCompile: {
      tapPromise(name: string, callback: (compilation: WebpackCompilation) => Promise<void>): void;
    };
    thisCompilation: {
      tap(name: string, callback: (compilation: WebpackCompilation) => void): void;
    };
    watchClose?: {
      tap(name: string, callback: () => void): void;
    };
  };
  getInfrastructureLogger?: (name: string) => {
    error?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
  };
  options: {
    devServer?: WebpackDevServerOptions;
    output: {
      path: string;
      publicPath?: string | ((...args: unknown[]) => string);
    };
  };
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number;
    };
    sources: {
      RawSource: new (source: string | Buffer) => WebpackSource;
    };
  };
};

type WebpackCompilation = {
  contextDependencies?: Set<string>;
  emitAsset(fileName: string, source: WebpackSource): void;
  fileDependencies?: Set<string>;
  hooks: {
    processAssets: {
      tapPromise(options: {name: string; stage: number}, callback: () => Promise<void>): void;
    };
  };
};

type WebpackSource = unknown;

type WebpackDevServerOptions = {
  setupMiddlewares?: (
    middlewares: WebpackDevServerMiddleware[],
    server: unknown,
  ) => WebpackDevServerMiddleware[];
};

type WebpackDevServerMiddleware = {
  middleware: (
    request: Parameters<typeof createTileflowNodeRequest>[0],
    response: Parameters<typeof writeTileflowNodeResponse>[0],
    next: (error?: unknown) => void,
  ) => void;
  name: string;
  path?: string;
};

export class TileflowWebpackPlugin {
  readonly name = 'TileflowWebpackPlugin';
  private devSession: Promise<TileflowArtifactSession> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: TileflowWebpackPluginOptions = {}) {}

  apply(compiler: WebpackCompiler) {
    const basePath = normalizeTileflowBasePath(this.options.base ?? '/tileflow');
    const configPath = this.options.config ?? defaultTileflowConfigPath;
    const cwd = compiler.context;

    const publicBase = this.resolvePublicBase(compiler);

    this.attachDevServerMiddleware(compiler, {
      basePath,
      configPath,
      cwd,
      publicBase,
    });

    compiler.hooks.afterCompile.tapPromise(this.name, async (compilation) => {
      if (this.devSession) {
        await refreshTileflowArtifactSession(await this.devSession, {
          reason: 'webpack compilation',
        });
      }
      await this.addWatchDependencies(compilation, {
        configPath,
        cwd,
      });
    });

    compiler.hooks.watchClose?.tap(this.name, () => {
      if (this.devSession) void this.devSession.then((session) => session.close());
    });

    compiler.hooks.thisCompilation.tap(this.name, (compilation) => {
      if (this.options.emitBuildArtifacts === false) {
        return;
      }

      compilation.hooks.processAssets.tapPromise(
        {
          name: this.name,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        async () => {
          await this.emitBuildArtifacts(compiler, compilation, {
            basePath,
            configPath,
            cwd,
          });
        },
      );
    });
  }

  private attachDevServerMiddleware(
    compiler: WebpackCompiler,
    input: {
      basePath: string;
      configPath: string;
      cwd: string;
      publicBase: string;
    },
  ) {
    const devServer = compiler.options.devServer;

    if (!devServer) {
      return;
    }

    const existingSetupMiddlewares = devServer.setupMiddlewares;

    devServer.setupMiddlewares = (middlewares, server) => {
      const nextMiddlewares = existingSetupMiddlewares
        ? existingSetupMiddlewares(middlewares, server)
        : middlewares;
      this.devSession ??= createTileflowArtifactSession({
        assetBaseUrl: input.basePath,
        config: input.configPath,
        cwd: input.cwd,
        styleBaseUrl: input.basePath,
        apiBaseUrl: this.options.apiBaseUrl,
        watch: false,
      });
      const handlerPromise = this.devSession.then((session) =>
        createTileflowDevRequestHandler({
          basePath: input.basePath,
          config: input.configPath,
          cwd: input.cwd,
          onError: (error) => {
            const message = error instanceof Error ? error.message : 'Unknown Tileflow error';
            compiler.getInfrastructureLogger?.('tileflow:webpack').error?.(message);
          },
          session,
          apiBaseUrl: this.options.apiBaseUrl,
        }),
      );
      const devBasePaths = getDevBasePaths(input.basePath, input.publicBase);

      nextMiddlewares.unshift({
        middleware: async (request, response, next) => {
          const matchingBasePath = getMatchingBasePath(request.url, devBasePaths);

          if (matchingBasePath === null) {
            next();
            return;
          }

          const originalUrl = request.url;

          try {
            request.url = rewriteRequestUrl(originalUrl, matchingBasePath, input.basePath);
            const tileflowRequest = createTileflowNodeRequest(request);
            const tileflowResponse = await (await handlerPromise)(tileflowRequest);
            await writeTileflowNodeResponse(response, tileflowResponse);
          } catch (error) {
            next(error);
          } finally {
            request.url = originalUrl;
          }
        },
        name: 'tileflow:webpack',
      });

      return nextMiddlewares;
    };
  }

  private async addWatchDependencies(
    compilation: WebpackCompilation,
    input: {
      configPath: string;
      cwd: string;
    },
  ) {
    compilation.fileDependencies?.add(resolve(input.cwd, input.configPath));

    try {
      const session = this.devSession ? await this.devSession : undefined;
      const watchPaths =
        session?.getLastGoodArtifacts()?.watchPaths ??
        (await getTileflowWatchPaths({config: input.configPath, cwd: input.cwd}));

      for (const watchPath of watchPaths) {
        try {
          if ((await stat(watchPath)).isDirectory()) {
            compilation.contextDependencies?.add(watchPath);
          } else {
            compilation.fileDependencies?.add(watchPath);
          }
        } catch {
          compilation.fileDependencies?.add(watchPath);
        }
      }
    } catch {
      // Config errors are surfaced by the dev handler/build emit path.
    }
  }

  private async emitBuildArtifacts(
    compiler: WebpackCompiler,
    compilation: WebpackCompilation,
    input: {
      basePath: string;
      configPath: string;
      cwd: string;
    },
  ) {
    if (this.running) {
      return this.running;
    }

    this.running = this.writeBuildArtifacts(compiler, compilation, input).finally(() => {
      this.running = null;
    });

    return this.running;
  }

  private async writeBuildArtifacts(
    compiler: WebpackCompiler,
    compilation: WebpackCompilation,
    input: {
      basePath: string;
      configPath: string;
      cwd: string;
    },
  ) {
    const publicBase = this.resolvePublicBase(compiler);
    const publicUrls = resolveTileflowArtifactPublicUrls(publicBase, input.basePath);
    const assetBase = getTileflowAssetBasePath(input.basePath);
    const artifacts = await createTileflowBuildArtifacts({
      assetBaseUrl: publicUrls.assetBaseUrl,
      config: input.configPath,
      cwd: input.cwd,
      styleBaseUrl: publicUrls.styleBaseUrl,
      apiBaseUrl: this.options.apiBaseUrl,
    });
    await assertTileflowSelfHostedManifestTarget(
      resolve(compiler.options.output.path, assetBase, 'manifest.json'),
      {overwriteHostedManifest: this.options.overwriteHostedManifest},
    );
    const RawSource = compiler.webpack.sources.RawSource;

    for (const asset of artifacts.files) {
      compilation.emitAsset(
        getTileflowAssetFileName(assetBase, asset.fileName),
        new RawSource(toRawSourceValue(asset.source)),
      );
    }

    compiler
      .getInfrastructureLogger?.('tileflow:webpack')
      .info?.(`emitted Tileflow artifacts under ${assetBase || '.'}`);
  }

  private resolvePublicBase(compiler: WebpackCompiler): string {
    if (this.options.publicPath !== undefined) {
      return this.options.publicPath;
    }

    const publicPath = compiler.options.output.publicPath;

    if (typeof publicPath === 'string' && publicPath !== 'auto') {
      return publicPath;
    }

    if (publicPath && publicPath !== 'auto') {
      compiler
        .getInfrastructureLogger?.('tileflow:webpack')
        .warn?.(
          'output.publicPath is dynamic; pass TileflowWebpackPlugin({ publicPath }) for stable Tileflow asset URLs.',
        );
    }

    return '';
  }
}

export function tileflow(options: TileflowWebpackPluginOptions = {}) {
  return new TileflowWebpackPlugin(options);
}

export default TileflowWebpackPlugin;

function toRawSourceValue(source: string | Uint8Array): string | Buffer {
  return typeof source === 'string' || Buffer.isBuffer(source) ? source : Buffer.from(source);
}

function getDevBasePaths(basePath: string, publicBase: string): string[] {
  const prefixedBasePath = isRootedPublicPath(publicBase)
    ? normalizeTileflowBasePath(joinTileflowPublicUrl(publicBase, basePath))
    : basePath;

  return Array.from(new Set([basePath, prefixedBasePath]));
}

function getMatchingBasePath(url: string | undefined, basePaths: string[]): string | null {
  return basePaths.find((basePath) => isTileflowRequestUrl(url, basePath)) ?? null;
}

function rewriteRequestUrl(
  url: string | undefined,
  matchingBasePath: string,
  basePath: string,
): string | undefined {
  if (!url || matchingBasePath === basePath) {
    return url;
  }

  if (url === matchingBasePath) {
    return basePath || '/';
  }

  if (url.startsWith(`${matchingBasePath}/`)) {
    return `${basePath}${url.slice(matchingBasePath.length)}`;
  }

  return url;
}

function isRootedPublicPath(value: string): boolean {
  return value.startsWith('/');
}
