import {resolve} from 'node:path';
import {
  createTileflowArtifactSession,
  defaultTileflowConfigPath,
  normalizeTileflowBasePath,
  type TileflowArtifactSession,
  type TileflowIconResolutionOptions,
} from '@tileflow/dev/artifacts';
import {
  createTileflowDevRequestHandler,
  type TileflowDevRequestHandler,
} from '@tileflow/dev/server';
import {
  createTileflowSnapshotResponder,
  emitTileflowRouteSnapshot,
  findTileflowRouteSnapshot,
  findTileflowStaticArtifacts,
  isTileflowNextBuildPhase,
  type TileflowRouteSnapshotInput,
} from './snapshot';

export type TileflowNextRouteHandlerOptions = {
  apiBaseUrl?: string;
  base?: string;
  /**
   * How long a request waits for the map to finish compiling before the route answers
   * `503 Service Unavailable` with `Retry-After`, in milliseconds. The Tileflow runtime asks again
   * on its own. Defaults to 3000.
   */
  compileWaitMs?: number;
  config?: string;
  cwd?: string;
  /**
   * The Next.js `distDir`, where the build leaves the compiled map for the server to answer from.
   * Defaults to `.next`.
   */
  distDir?: string;
  /**
   * Explicit shared Icon Set resolution settings.
   *
   * These choose the verified cache root, offline behavior, trusted delivery origins and the
   * transport used to hydrate exact locked pins. No build resolves a catalog head.
   */
  icons?: TileflowIconResolutionOptions;
  onError?: (error: unknown) => void;
  /**
   * The directory `withTileflow` writes static artifacts to. When the build has left a manifest
   * there, the route does not compile a copy of its own and answers from those files. Match
   * `withTileflow`'s `publicDir`. Defaults to `public`.
   */
  publicDir?: string;
  routeBase?: string;
  styleBaseUrl?: string;
};

export type TileflowNextRouteHandlers = {
  close: () => Promise<void>;
  GET: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
};

type SharedRouteHandler = {
  handlerPromise: Promise<TileflowDevRequestHandler>;
  sessionPromise: Promise<TileflowArtifactSession>;
};

const defaultCompileWaitMs = 3_000;

const sharedHandlers = ((
  globalThis as typeof globalThis & {
    __tileflowNextRouteHandlersV1?: Map<string, SharedRouteHandler>;
  }
).__tileflowNextRouteHandlersV1 ??= new Map<string, SharedRouteHandler>());

export function createTileflowRouteHandlers(
  options: TileflowNextRouteHandlerOptions = {},
): TileflowNextRouteHandlers {
  const basePath = normalizeTileflowBasePath(options.base ?? '/tileflow');
  const routeBasePath = normalizeTileflowBasePath(options.routeBase ?? basePath);
  const snapshotInput = getSnapshotInput(options, basePath);

  const staticInput = {
    basePath,
    cwd: resolve(options.cwd ?? process.cwd()),
    publicDir: options.publicDir,
  };

  if (isTileflowNextBuildPhase()) {
    // `next build` loads this module only to read its exports. Compile the map now, so the server
    // that starts afterwards has it, and serve nothing from this process. An application whose
    // static artifacts the build already wrote does not need a second compile of the same map.
    if (snapshotInput && !findTileflowStaticArtifacts(staticInput)) {
      emitTileflowRouteSnapshot(snapshotInput);
    }
    return createLazyRouteHandlers(() => createLiveRouteHandlers(options, basePath, routeBasePath));
  }

  const snapshot =
    snapshotInput && process.env.NODE_ENV === 'production'
      ? (findTileflowRouteSnapshot(snapshotInput) ?? findTileflowStaticArtifacts(staticInput))
      : undefined;
  if (snapshot) {
    const respond = createTileflowSnapshotResponder(snapshot, basePath);
    const handle = async (request: Request) =>
      respond(rewriteRouteBasePath(request, routeBasePath, basePath));
    return {close: async () => undefined, GET: handle, HEAD: handle};
  }

  return createLiveRouteHandlers(options, basePath, routeBasePath);
}

/**
 * Handlers that answer from the map compiled at build time exist only when the route's
 * configuration can be described to a child process; a custom icon transport cannot.
 */
function getSnapshotInput(
  options: TileflowNextRouteHandlerOptions,
  basePath: string,
): TileflowRouteSnapshotInput | undefined {
  if (options.onError || options.icons?.fetch || options.icons?.signal) return undefined;
  return {
    apiBaseUrl: options.apiBaseUrl,
    basePath,
    config: options.config ?? defaultTileflowConfigPath,
    cwd: options.cwd ?? process.cwd(),
    distDir: options.distDir,
    ...(options.icons ? {icons: options.icons} : {}),
    styleBaseUrl: options.styleBaseUrl ?? basePath,
  };
}

function createLazyRouteHandlers(
  create: () => TileflowNextRouteHandlers,
): TileflowNextRouteHandlers {
  let handlers: TileflowNextRouteHandlers | undefined;
  const live = () => (handlers ??= create());
  return {
    close: async () => handlers?.close(),
    GET: (request) => live().GET(request),
    HEAD: (request) => live().HEAD(request),
  };
}

function createLiveRouteHandlers(
  options: TileflowNextRouteHandlerOptions,
  basePath: string,
  routeBasePath: string,
): TileflowNextRouteHandlers {
  const sharedKey =
    options.onError || options.icons?.fetch || options.icons?.signal
      ? undefined
      : createSharedHandlerKey(options, basePath);
  let shared = sharedKey ? sharedHandlers.get(sharedKey) : undefined;
  if (!shared) {
    shared = createSharedRouteHandler(options, basePath);
    if (sharedKey) {
      sharedHandlers.set(sharedKey, shared);
      void shared.sessionPromise.catch(() => {
        if (sharedHandlers.get(sharedKey) === shared) sharedHandlers.delete(sharedKey);
      });
    }
  }
  const {handlerPromise, sessionPromise} = shared;
  const compileWaitMs = options.compileWaitMs ?? defaultCompileWaitMs;
  const handle = async (request: Request) => {
    const rewritten = rewriteRouteBasePath(request, routeBasePath, basePath);
    const handler = await waitForHandler(handlerPromise, compileWaitMs);
    return handler ? handler(rewritten) : preparingResponse();
  };

  return {
    async close() {
      if (sharedKey && sharedHandlers.get(sharedKey) === shared) sharedHandlers.delete(sharedKey);
      const [handler, session] = await Promise.all([handlerPromise, sessionPromise]);
      await handler.close();
      await session.close();
    },
    GET: handle,
    HEAD: handle,
  };
}

/** The handler once the map has compiled, or undefined if it is still compiling after `waitMs`. */
async function waitForHandler(
  handlerPromise: Promise<TileflowDevRequestHandler>,
  waitMs: number,
): Promise<TileflowDevRequestHandler | undefined> {
  let timer: Parameters<typeof clearTimeout>[0];
  try {
    return await Promise.race([
      handlerPromise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, waitMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The first compile of a map takes seconds. Answering at once tells the runtime to ask again,
 * instead of holding its request past the time it is willing to wait.
 */
function preparingResponse(): Response {
  return new Response(
    `${JSON.stringify({error: 'Tileflow is still compiling this map. Ask again shortly.'})}\n`,
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '2',
      },
      status: 503,
    },
  );
}

function createSharedRouteHandler(
  options: TileflowNextRouteHandlerOptions,
  basePath: string,
): SharedRouteHandler {
  const sessionPromise = createTileflowArtifactSession({
    assetBaseUrl: basePath,
    config: options.config ?? defaultTileflowConfigPath,
    cwd: options.cwd,
    ...(options.icons ? {icons: options.icons} : {}),
    styleBaseUrl: options.styleBaseUrl ?? basePath,
    apiBaseUrl: options.apiBaseUrl,
    watch: true,
  });
  return {
    sessionPromise,
    handlerPromise: sessionPromise.then((session) =>
      createTileflowDevRequestHandler({
        basePath,
        config: options.config ?? defaultTileflowConfigPath,
        cwd: options.cwd,
        onError: options.onError ?? logTileflowError,
        session,
        styleBaseUrl: options.styleBaseUrl,
        apiBaseUrl: options.apiBaseUrl,
      }),
    ),
  };
}

function createSharedHandlerKey(
  options: TileflowNextRouteHandlerOptions,
  basePath: string,
): string {
  const cwd = resolve(options.cwd ?? process.cwd());
  return JSON.stringify({
    apiBaseUrl: options.apiBaseUrl ?? null,
    basePath,
    config: resolve(cwd, options.config ?? defaultTileflowConfigPath),
    cwd,
    // Different explicit Icon Set resolution settings must never share one session.
    icons: options.icons
      ? {
          cacheRoot: options.icons.cacheRoot ?? null,
          deliveryOrigins: options.icons.deliveryOrigins ?? null,
          offline: options.icons.offline ?? null,
        }
      : null,
    styleBaseUrl: options.styleBaseUrl ?? basePath,
  });
}

function logTileflowError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown Tileflow error';

  console.error(`[tileflow] ${message}`);
}

function rewriteRouteBasePath(request: Request, routeBasePath: string, basePath: string): Request {
  if (routeBasePath === basePath) {
    return request;
  }

  const url = new URL(request.url);

  if (url.pathname === routeBasePath) {
    url.pathname = basePath || '/';
  } else if (url.pathname.startsWith(`${routeBasePath}/`)) {
    url.pathname = `${basePath}${url.pathname.slice(routeBasePath.length)}`;
  } else {
    return request;
  }

  return new Request(url, {
    headers: request.headers,
    method: request.method,
  });
}
