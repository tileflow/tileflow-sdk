import type {NextConfig} from 'next';
import {resolve} from 'node:path';
import {
  defaultTileflowConfigPath,
  getTileflowAssetBasePath,
  normalizeTileflowBasePath,
  resolveTileflowArtifactPublicUrls,
  type TileflowIconResolutionOptions,
  writeTileflowBuildArtifacts,
} from '@tileflow/dev/artifacts';

export type TileflowNextPluginOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  cwd?: string;
  emitBuildArtifacts?: boolean;
  /**
   * Explicit shared Icon Set resolution settings.
   *
   * These choose the verified cache root, offline behavior, trusted delivery origins and the
   * transport used to hydrate exact locked pins. No build resolves a catalog head.
   */
  icons?: TileflowIconResolutionOptions;
  overwriteHostedManifest?: boolean;
  publicDir?: string;
  routeBase?: string | false;
};

type NextRewritesConfig = Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>>;
type NextRewrite = {destination: string; source: string};

export function withTileflow(
  nextConfig: NextConfig = {},
  options: TileflowNextPluginOptions = {},
): NextConfig {
  return {
    ...nextConfig,
    rewrites: createTileflowRewrites(nextConfig.rewrites, nextConfig, options),
  };
}

export default withTileflow;

function createTileflowRewrites(
  userRewrites: NextConfig['rewrites'],
  nextConfig: NextConfig,
  options: TileflowNextPluginOptions,
): NonNullable<NextConfig['rewrites']> {
  let buildArtifacts: Promise<void> | null = null;

  return async () => {
    if (process.env.NODE_ENV === 'production' && options.emitBuildArtifacts !== false) {
      buildArtifacts ??= emitTileflowBuildArtifacts(nextConfig, options);
      await buildArtifacts;
    }

    const existingRewrites = userRewrites ? await userRewrites() : [];

    if (options.routeBase === false || process.env.NODE_ENV !== 'development') {
      return existingRewrites;
    }

    const tileflowRewrites = createTileflowDevRewrites(options);
    return tileflowRewrites.length === 0
      ? existingRewrites
      : mergeRewrites(existingRewrites, tileflowRewrites);
  };
}

async function emitTileflowBuildArtifacts(
  nextConfig: NextConfig,
  options: TileflowNextPluginOptions,
): Promise<void> {
  const basePath = normalizeTileflowBasePath(options.base ?? '/tileflow');
  const nextBasePath = normalizeTileflowBasePath(nextConfig.basePath ?? '');
  const cwd = options.cwd ?? process.cwd();
  const assetBasePath = getTileflowAssetBasePath(basePath);
  const publicUrls = resolveTileflowArtifactPublicUrls(nextBasePath, basePath);
  const outDir = resolve(cwd, options.publicDir ?? 'public', assetBasePath);

  await writeTileflowBuildArtifacts({
    assetBaseUrl: publicUrls.assetBaseUrl,
    config: options.config ?? defaultTileflowConfigPath,
    cwd,
    ...(options.icons ? {icons: options.icons} : {}),
    outDir,
    overwriteHostedManifest: options.overwriteHostedManifest,
    styleBaseUrl: publicUrls.styleBaseUrl,
    apiBaseUrl: options.apiBaseUrl,
  });
}

function createTileflowDevRewrites(options: TileflowNextPluginOptions): NextRewrite[] {
  const basePath = normalizeTileflowBasePath(options.base ?? '/tileflow');
  const routeBasePath = normalizeTileflowBasePath(
    options.routeBase === false ? '' : (options.routeBase ?? '/api/tileflow'),
  );

  if (!basePath || !routeBasePath || basePath === routeBasePath) {
    return [];
  }

  return [
    {
      source: basePath,
      destination: routeBasePath,
    },
    {
      source: `${basePath}/:path*`,
      destination: `${routeBasePath}/:path*`,
    },
  ];
}

function mergeRewrites(
  existingRewrites: NextRewritesConfig,
  tileflowRewrites: NextRewrite[],
): NextRewritesConfig {
  if (Array.isArray(existingRewrites)) {
    return [...tileflowRewrites, ...existingRewrites];
  }

  return {
    ...existingRewrites,
    beforeFiles: [...tileflowRewrites, ...(existingRewrites.beforeFiles ?? [])],
  };
}
