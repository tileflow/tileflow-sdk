import {resolve} from 'node:path';
import {
  createTileflowArtifactSession,
  defaultTileflowConfigPath,
  normalizeTileflowBasePath,
  type TileflowArtifactSession,
} from '@tileflow/dev/artifacts';
import {
  createTileflowDevRequestHandler,
  type TileflowDevRequestHandler,
} from '@tileflow/dev/server';

export type TileflowNextRouteHandlerOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  cwd?: string;
  onError?: (error: unknown) => void;
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
  const sharedKey = options.onError ? undefined : createSharedHandlerKey(options, basePath);
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
  const handle = async (request: Request) => {
    const rewritten = rewriteRouteBasePath(request, routeBasePath, basePath);
    return (await handlerPromise)(rewritten);
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

function createSharedRouteHandler(
  options: TileflowNextRouteHandlerOptions,
  basePath: string,
): SharedRouteHandler {
  const sessionPromise = createTileflowArtifactSession({
    assetBaseUrl: basePath,
    config: options.config ?? defaultTileflowConfigPath,
    cwd: options.cwd,
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
