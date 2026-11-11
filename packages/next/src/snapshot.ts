import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join, resolve, sep} from 'node:path';
import type {TileflowIconResolutionOptions} from '@tileflow/dev/artifacts';

/** What a build-time snapshot of a route's artifacts depends on. */
export type TileflowRouteSnapshotInput = {
  apiBaseUrl?: string;
  basePath: string;
  config: string;
  cwd: string;
  /** The Next.js `distDir`; the snapshot lives beside the build output. Defaults to `.next`. */
  distDir?: string;
  icons?: TileflowIconResolutionOptions;
  styleBaseUrl: string;
};

/** The command that compiles one snapshot. Only tests replace it. */
export type TileflowRouteSnapshotRunner = {args: readonly string[]; command: string};

export type TileflowRouteSnapshotResult = 'exists' | 'failed' | 'skipped' | 'written';

const lockStaleMs = 5 * 60_000;
const lockWaitMs = 5 * 60_000;
const buildTimeoutMs = 5 * 60_000;
export const nextProductionBuildPhase = 'phase-production-build';

/** Whether Next.js is building the application, which loads route modules without serving them. */
export function isTileflowNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === nextProductionBuildPhase;
}

/** The directory holding the snapshot of one route configuration. */
export function getTileflowRouteSnapshotDirectory(input: TileflowRouteSnapshotInput): string {
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        apiBaseUrl: input.apiBaseUrl ?? null,
        basePath: input.basePath,
        config: resolve(input.cwd, input.config),
        icons: input.icons
          ? {
              cacheRoot: input.icons.cacheRoot ?? null,
              deliveryOrigins: input.icons.deliveryOrigins ?? null,
              offline: input.icons.offline ?? null,
            }
          : null,
        styleBaseUrl: input.styleBaseUrl,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return join(resolve(input.cwd), input.distDir ?? '.next', 'tileflow', key);
}

/** The directory of an existing snapshot, or undefined when the build did not leave one. */
export function findTileflowRouteSnapshot(input: TileflowRouteSnapshotInput): string | undefined {
  const directory = getTileflowRouteSnapshotDirectory(input);
  return existsSync(join(directory, 'manifest.json')) ? directory : undefined;
}

/**
 * Compiles the route's map into the build output while Next.js loads the route module, and
 * returns only once the snapshot exists. A running server then answers from it at once instead of
 * compiling the map on its first request. The compile runs in a child process because a build
 * worker ends as soon as its page data is collected, and workers that load the module together
 * share one compile through a lock. A failure leaves no snapshot; the route then compiles at run
 * time as it always did.
 */
export function emitTileflowRouteSnapshot(
  input: TileflowRouteSnapshotInput,
  runner: TileflowRouteSnapshotRunner | undefined = resolveSnapshotRunner(input.cwd),
): TileflowRouteSnapshotResult {
  if (!runner) return 'skipped';
  const final = getTileflowRouteSnapshotDirectory(input);
  const lock = `${final}.lock`;
  const failed = `${final}.failed`;
  mkdirSync(resolve(final, '..'), {recursive: true});

  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    if (existsSync(final)) return 'exists';
    if (existsSync(failed)) return 'failed';
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isStale(lock)) rmSync(lock, {force: true, recursive: true});
      else if (Date.now() > deadline) return 'failed';
      else sleep(250);
    }
  }

  const temporary = `${final}.tmp-${process.pid}`;
  try {
    if (existsSync(final)) return 'exists';
    rmSync(temporary, {force: true, recursive: true});
    const result = spawnSync(
      runner.command,
      [
        ...runner.args,
        JSON.stringify({
          apiBaseUrl: input.apiBaseUrl,
          assetBaseUrl: input.basePath,
          config: input.config,
          cwd: input.cwd,
          icons: input.icons,
          outDir: temporary,
          styleBaseUrl: input.styleBaseUrl,
        }),
      ],
      {
        cwd: input.cwd,
        encoding: 'utf8',
        env: {...process.env, NEXT_PHASE: undefined, NODE_ENV: 'production'},
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: buildTimeoutMs,
      },
    );
    if (result.status !== 0) {
      const reason = (result.stderr || result.error?.message || 'unknown error').trim();
      writeFileSync(failed, `${reason}\n`);
      console.warn(
        `[tileflow] Could not compile the map at build time; it will compile on the first request instead.\n${reason}`,
      );
      return 'failed';
    }
    renameSync(temporary, final);
    return 'written';
  } finally {
    rmSync(temporary, {force: true, recursive: true});
    rmSync(lock, {force: true, recursive: true});
  }
}

function resolveSnapshotRunner(cwd: string): TileflowRouteSnapshotRunner | undefined {
  try {
    const script = createRequire(join(resolve(cwd), 'package.json')).resolve(
      '@tileflow/next/snapshot-build',
    );
    return {args: [script], command: process.execPath};
  } catch {
    return undefined;
  }
}

function isStale(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > lockStaleMs;
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

const contentTypes: Readonly<Record<string, string>> = {
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.pbf': 'application/x-protobuf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Answers GET and HEAD requests from a snapshot directory: the files an artifact build writes,
 * under the same paths the live route serves them.
 */
export function createTileflowSnapshotResponder(
  directory: string,
  basePath: string,
): (request: Request) => Promise<Response> {
  const root = resolve(directory);
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plainResponse('Method not allowed', 405);
    }
    const pathname = new URL(request.url).pathname;
    const path = pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
    const file = path ? resolveSnapshotFile(root, path) : undefined;
    if (!file) return plainResponse('Not found', 404);
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return plainResponse('Not found', 404);
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Content-Length': String(body.byteLength),
        'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
      },
    });
  };
}

function resolveSnapshotFile(root: string, path: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0'))
    return undefined;
  const file = resolve(root, `.${decoded}`);
  if (!file.startsWith(`${root}${sep}`)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

function plainResponse(message: string, status: number): Response {
  return new Response(`${JSON.stringify({error: message})}\n`, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  });
}
