import {
  createTileflowArtifactSession,
  createTileflowDevRequestHandler,
  defaultTileflowConfigPath,
  normalizeTileflowBasePath,
  type TileflowBuildArtifactsOptions,
} from '@tileflow/dev';

export type TileflowNextRouteHandlerOptions = {
  apiBaseUrl?: string;
  base?: string;
  config?: string;
  cwd?: string;
  onError?: (error: unknown) => void;
  routeBase?: string;
  styleBaseUrl?: string;
  worldGeneration?: TileflowBuildArtifactsOptions['worldGeneration'];
};

export type TileflowNextRouteHandlers = {
  GET: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
};

export function createTileflowRouteHandlers(
  options: TileflowNextRouteHandlerOptions = {},
): TileflowNextRouteHandlers {
  const basePath = normalizeTileflowBasePath(options.base ?? '/tileflow');
  const routeBasePath = normalizeTileflowBasePath(options.routeBase ?? basePath);
  const sessionPromise = createTileflowArtifactSession({
    assetBaseUrl: basePath,
    config: options.config ?? defaultTileflowConfigPath,
    cwd: options.cwd,
    styleBaseUrl: options.styleBaseUrl ?? basePath,
    apiBaseUrl: options.apiBaseUrl,
    worldGeneration: options.worldGeneration,
    watch: false,
  });
  const handlerPromise = sessionPromise.then((session) =>
    createTileflowDevRequestHandler({
      basePath,
      config: options.config ?? defaultTileflowConfigPath,
      cwd: options.cwd,
      onError: options.onError ?? logTileflowError,
      session,
      styleBaseUrl: options.styleBaseUrl,
      apiBaseUrl: options.apiBaseUrl,
      worldGeneration: options.worldGeneration,
    }),
  );
  let refreshChain = Promise.resolve();
  let firstRequest = true;
  const handle = async (request: Request) => {
    const rewritten = rewriteRouteBasePath(request, routeBasePath, basePath);
    if (firstRequest) firstRequest = false;
    else {
      refreshChain = refreshChain.then(async () => {
        await (await sessionPromise).refresh('next request');
      });
      await refreshChain;
    }
    return (await handlerPromise)(rewritten);
  };

  return {
    GET: handle,
    HEAD: handle,
  };
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
