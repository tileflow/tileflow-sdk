import type {NextConfig} from 'next';
import {createRequire} from 'node:module';
import {join, posix, relative, resolve, sep} from 'node:path';
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

/** The package Next.js must load from `node_modules` instead of bundling into the route. */
const externalServerPackage = '@tileflow/dev';

/** Where a build leaves the map the route handlers compile, below the Next.js `distDir`. */
const routeSnapshotDirectory = 'tileflow';

export function withTileflow(
  nextConfig: NextConfig = {},
  options: TileflowNextPluginOptions = {},
): NextConfig {
  return {
    ...withServerBuildOptions(nextConfig, options),
    rewrites: createTileflowRewrites(nextConfig.rewrites, nextConfig, options),
  };
}

/**
 * Keeps `@tileflow/dev` out of the route bundle, and keeps the files the route answers from in its
 * file trace, so a `standalone` output carries them: the static artifacts in the public directory
 * and the map `next build` compiles when there are none. Next.js 15 moved both options out of
 * `experimental`; Next.js 14 reads them only there.
 *
 * Turbopack lists the files to trace before it collects page data and never lists files in the
 * `distDir`, so only the static artifacts, which exist when the configuration loads, reach a
 * `standalone` output built with it. Webpack traces both.
 */
function withServerBuildOptions(
  nextConfig: NextConfig,
  options: TileflowNextPluginOptions,
): NextConfig {
  const cwd = options.cwd ?? process.cwd();
  const legacy = (nextMajor(cwd) ?? Infinity) < 15;
  // An invalid base path fails where the artifacts are written, not while the configuration loads.
  const routeBase =
    options.routeBase === false ? undefined : tryBasePath(options.routeBase ?? '/api/tileflow');
  const assetBasePath = getTileflowAssetBasePath(tryBasePath(options.base ?? '/tileflow') ?? '');
  const trace =
    routeBase === undefined
      ? undefined
      : {
          [`${routeBase}/**`]: [
            `./${posix.join(nextConfig.distDir ?? '.next', routeSnapshotDirectory, '**', '*')}`,
            ...(assetBasePath
              ? [
                  `./${posix.join(projectRelative(cwd, options.publicDir ?? 'public'), assetBasePath, '**', '*')}`,
                ]
              : []),
          ],
        };

  if (legacy) {
    const experimental = nextConfig.experimental as LegacyExperimental | undefined;
    return {
      ...nextConfig,
      experimental: {
        ...nextConfig.experimental,
        serverComponentsExternalPackages: mergeList(
          experimental?.serverComponentsExternalPackages,
          externalServerPackage,
        ),
        ...(trace === undefined
          ? {}
          : {
              outputFileTracingIncludes: mergeTrace(experimental?.outputFileTracingIncludes, trace),
            }),
      } as NextConfig['experimental'],
    };
  }

  return {
    ...nextConfig,
    serverExternalPackages: mergeList(nextConfig.serverExternalPackages, externalServerPackage),
    ...(trace === undefined
      ? {}
      : {outputFileTracingIncludes: mergeTrace(nextConfig.outputFileTracingIncludes, trace)}),
  };
}

type LegacyExperimental = {
  outputFileTracingIncludes?: Record<string, string[]>;
  serverComponentsExternalPackages?: string[];
};

function tryBasePath(basePath: string): string | undefined {
  try {
    return normalizeTileflowBasePath(basePath);
  } catch {
    return undefined;
  }
}

/** A directory as a forward-slash path relative to the project, for a trace glob. */
function projectRelative(cwd: string, directory: string): string {
  return relative(resolve(cwd), resolve(cwd, directory)).split(sep).join('/');
}

function mergeList(existing: readonly string[] | undefined, added: string): string[] {
  return existing?.includes(added) ? [...existing] : [...(existing ?? []), added];
}

function mergeTrace(
  existing: Record<string, string[]> | undefined,
  added: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {...existing};
  for (const [key, globs] of Object.entries(added)) {
    merged[key] = [...new Set([...(merged[key] ?? []), ...globs])];
  }
  return merged;
}

/** The major version of the Next.js the application installed, or undefined if not found. */
function nextMajor(cwd: string): number | undefined {
  try {
    const {version} = createRequire(join(resolve(cwd), 'package.json'))('next/package.json') as {
      version?: string;
    };
    const major = Number.parseInt(version ?? '', 10);
    return Number.isNaN(major) ? undefined : major;
  } catch {
    return undefined;
  }
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
