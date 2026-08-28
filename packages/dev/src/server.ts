import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  getTileflowStyleFontFaces,
  tileflowMapIdSchema,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import {
  createTileflowBuildArtifacts,
  type TileflowBuildArtifacts,
  type TileflowBuildArtifactsOptions,
} from './artifacts';
import {defaultTileflowApiUrl, defaultTileflowConfigPath, TileflowValidationError} from './config';
import type {TileflowBuildAsset} from './icons';
import {normalizeTileflowBasePath} from './public-paths';
import {
  type TileflowArtifactSession,
  tileflowArtifactSessionSchemaVersion,
  type TileflowArtifactSessionState,
} from './session';
import {TileflowStyleValidationError} from './style-validation';

export {createTileflowArtifactDiagnostics, tileflowArtifactSessionSchemaVersion} from './session';
export {
  createTileflowComparisonRequestHandler,
  tileflowComparisonSchemaVersion,
} from './comparison';
export type {
  TileflowComparisonMode,
  TileflowComparisonOptions,
  TileflowComparisonRequestHandler,
  TileflowComparisonSide,
} from './comparison';
export type {
  TileflowArtifactDiagnostic,
  TileflowArtifactSession,
  TileflowArtifactSessionOptions,
  TileflowArtifactSessionState,
} from './session';
export {
  getTileflowAssetBasePath,
  getTileflowAssetFileName,
  joinTileflowPublicUrl,
  normalizeTileflowBasePath,
  resolveTileflowArtifactPublicUrls,
} from './public-paths';

export type TileflowDevRequestHandlerOptions = {
  apiBaseUrl?: string;
  basePath?: string;
  config?: string;
  cwd?: string;
  inspection?: boolean;
  map?: string;
  onError?: (error: unknown) => void;
  scene?: string;
  session?: TileflowArtifactSession;
  styleBaseUrl?: string;
  theme?: string;
};

export function getTileflowStyleSelection(
  path: string,
): {mapName: string; themeName: string} | undefined {
  const match = /^\/styles\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})\.json$/u.exec(path);
  return match?.[1] &&
    match[2] &&
    tileflowMapIdSchema.safeParse(match[1]).success &&
    tileflowThemeNameSchema.safeParse(match[2]).success
    ? {mapName: match[1], themeName: match[2]}
    : undefined;
}

export function getTileflowStyleInspectionSelection(
  path: string,
): {mapName: string; themeName: string} | undefined {
  const match = /^\/__inspection\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})\.json$/u.exec(
    path,
  );
  return match?.[1] &&
    match[2] &&
    tileflowMapIdSchema.safeParse(match[1]).success &&
    tileflowThemeNameSchema.safeParse(match[2]).success
    ? {mapName: match[1], themeName: match[2]}
    : undefined;
}

export function isTileflowRequestUrl(url: string | undefined, basePath: string) {
  return getTileflowRequestPath(url, basePath) !== null;
}

/** Match and strip the configured route base using the same route table as the request handler. */
export function getTileflowRequestPath(url: string | undefined, basePath: string): string | null {
  const pathname = getRequestPathname(url);
  if (pathname === null) return null;
  const path = stripTileflowBasePath(pathname, normalizeTileflowBasePath(basePath));
  return path !== null && isOwnedTileflowRequestPath(path) ? path : null;
}

export function createTileflowNodeRequest(request: IncomingMessage) {
  const protocol = getNodeHeader(request, 'x-forwarded-proto') ?? 'http';
  const host = getNodeHeader(request, 'host') ?? 'localhost';

  return new Request(`${protocol}://${host}${request.url ?? '/'}`, {
    method: request.method,
  });
}

export async function writeTileflowNodeResponse(
  response: ServerResponse,
  tileflowResponse: Response,
) {
  response.statusCode = tileflowResponse.status;
  tileflowResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  if (!tileflowResponse.body) {
    response.end();
    return;
  }

  const reader = tileflowResponse.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (response.destroyed) {
        await reader.cancel();
        return;
      }
      response.write(Buffer.from(value));
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}

export function createTileflowDevRequestHandler(options: TileflowDevRequestHandlerOptions = {}) {
  const basePath = normalizeTileflowBasePath(options.basePath);
  const configPath = options.config ?? defaultTileflowConfigPath;
  const cwd = options.cwd ?? process.cwd();
  const apiBaseUrl = options.apiBaseUrl ?? defaultTileflowApiUrl;

  return async function handleTileflowDevRequest(request: Request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({error: 'Method not allowed'}, 405);
    }

    const url = new URL(request.url);
    const path = getTileflowRequestPath(url.pathname, basePath);

    if (path === null) {
      return jsonResponse({error: 'Not found'}, 404);
    }

    try {
      if (path === '/__events') {
        return options.session
          ? eventStreamResponse(options.session)
          : jsonResponse({error: 'Live events require a development session.'}, 404);
      }

      if (path.startsWith('/__runtime/')) {
        const runtimeResponse = (
          await import('./preview-assets')
        ).getTileflowPreviewRuntimeResponse(path);
        if (runtimeResponse) return runtimeResponse;
      }

      let artifacts: TileflowBuildArtifacts | undefined;
      let state: TileflowArtifactSessionState;
      if (options.session) {
        artifacts = getSessionArtifacts(options.session);
        state = options.session.getState();
      } else {
        artifacts = await createTileflowBuildArtifacts({
          assetBaseUrl: `${url.origin}${basePath}`,
          config: configPath,
          cwd,
          inspection: options.inspection,
          styleBaseUrl: options.styleBaseUrl ?? `${url.origin}${basePath}`,
          apiBaseUrl,
        });
        state = {
          artifacts,
          generation: 1,
          lastGoodGeneration: 1,
          status: 'ready',
        };
      }

      if (path === '/__status') {
        return jsonResponse(createTileflowArtifactStatus(state));
      }

      if (path === '/' || path === '') {
        const {renderTileflowPreviewHtml, resolveTileflowPreview} = await import('./preview');
        const requestedMaps = url.searchParams.getAll('map');
        const requestedThemes = url.searchParams.getAll('theme');
        if (requestedMaps.length > 1) {
          return jsonResponse({error: 'Tileflow map query must appear at most once.'}, 400);
        }
        if (requestedThemes.length > 1) {
          return jsonResponse({error: 'Tileflow theme query must appear at most once.'}, 400);
        }
        const requestedMap = requestedMaps.length === 1 ? requestedMaps[0] : options.map;
        const requestedTheme = requestedThemes.length === 1 ? requestedThemes[0] : options.theme;
        const preview = artifacts
          ? resolveTileflowPreview(artifacts.project, {
              map: requestedMap,
              scene: options.scene,
              theme: requestedTheme,
            })
          : undefined;
        const previewStyle = preview
          ? artifacts?.styles[preview.mapName]?.[preview.themeName]
          : undefined;
        const isStreetsPreview =
          preview !== undefined && previewStyle?.metadata?.['tileflow:root'] === 'streets';
        const fontFaces = previewStyle ? getTileflowStyleFontFaces(previewStyle) : [];
        return htmlResponse(
          renderTileflowPreviewHtml(
            preview,
            basePath,
            createTileflowArtifactStatus(state),
            isStreetsPreview,
            fontFaces,
          ),
        );
      }

      if (!artifacts) return unavailableArtifactsResponse(state);

      if (path.startsWith('/generations/') && 'files' in artifacts) {
        const fileName = path.replace(/^\/+/, '');
        const asset = (
          artifacts as TileflowBuildArtifacts & {files?: TileflowBuildAsset[]}
        ).files?.find((candidate) => candidate.fileName === fileName);
        if (!asset) return jsonResponse({error: `Unknown generation asset: ${fileName}`}, 404);
        return assetResponse(asset);
      }

      if (path === '/manifest.json') {
        return jsonResponse(artifacts.manifest);
      }

      if (path === '/build-manifest.json') {
        return jsonResponse(artifacts.buildManifest);
      }

      if (path.startsWith('/__inspection/')) {
        const selection = getTileflowStyleInspectionSelection(path);
        const inspection = selection
          ? artifacts.styleInspections?.[selection.mapName]?.[selection.themeName]
          : undefined;
        if (!selection || !inspection) {
          return jsonResponse({error: 'Compiler inspection is unavailable.'}, 404);
        }
        return compactJsonResponse(inspection);
      }

      if (path.startsWith('/styles/')) {
        const selection = getTileflowStyleSelection(path);
        const style = selection
          ? artifacts.styles[selection.mapName]?.[selection.themeName]
          : undefined;
        if (!selection || !style) {
          return jsonResponse({error: 'Unknown map theme style.'}, 404);
        }
        return compactJsonResponse(style);
      }

      if (path.startsWith('/icons/')) {
        const assetName = path.replace(/^\/+/, '');
        const asset = artifacts.assets.find((candidate) => candidate.fileName === assetName);

        if (!asset) {
          return jsonResponse({error: `Unknown icon asset: ${assetName}`}, 404);
        }

        return assetResponse(asset);
      }

      if (path.startsWith('/fonts/')) {
        const assetName = path.replace(/^\/+/, '');
        const asset = artifacts.assets.find((candidate) => candidate.fileName === assetName);

        if (!asset) {
          return jsonResponse({error: `Unknown font asset: ${assetName}`}, 404);
        }

        return assetResponse(asset);
      }

      return jsonResponse({error: 'Not found'}, 404);
    } catch (error) {
      options.onError?.(error);
      return tileflowErrorResponse(error);
    }
  };
}

export function createTileflowArtifactStatus(state: TileflowArtifactSessionState) {
  return {
    schemaVersion: tileflowArtifactSessionSchemaVersion,
    generation: state.generation,
    status: state.status,
    ...('lastGoodGeneration' in state && state.lastGoodGeneration !== undefined
      ? {lastGoodGeneration: state.lastGoodGeneration}
      : {}),
    ...(state.status === 'invalid' ? {diagnostics: state.diagnostics} : {}),
  };
}

function getSessionArtifacts(session: TileflowArtifactSession): TileflowBuildArtifacts | undefined {
  const state = session.getState();
  return state.status === 'ready' ? state.artifacts : session.getLastGoodArtifacts();
}

function unavailableArtifactsResponse(state: TileflowArtifactSessionState): Response {
  return jsonResponse(
    {
      error: 'No valid Tileflow artifact generation is available.',
      ...createTileflowArtifactStatus(state),
    },
    409,
  );
}

function eventStreamResponse(session: TileflowArtifactSession): Response {
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (state: TileflowArtifactSessionState) => {
        const status = createTileflowArtifactStatus(state);
        controller.enqueue(
          encoder.encode(`event: ${status.status}\ndata: ${JSON.stringify(status)}\n\n`),
        );
      };
      enqueue(session.getState());
      unsubscribe = session.subscribe(enqueue);
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

function getNodeHeader(request: IncomingMessage, name: string) {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
}

function stripTileflowBasePath(pathname: string, basePath: string) {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath) {
    return '/';
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }

  return null;
}

function getRequestPathname(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://tileflow.local').pathname;
  } catch {
    return null;
  }
}

function isOwnedTileflowRequestPath(path: string): boolean {
  return (
    path === '/' ||
    path === '/build-manifest.json' ||
    path === '/manifest.json' ||
    path === '/__events' ||
    path === '/__status' ||
    getTileflowStyleInspectionSelection(path) !== undefined ||
    path.startsWith('/generations/') ||
    path.startsWith('/icons/') ||
    getTileflowStyleSelection(path) !== undefined ||
    path.startsWith('/fonts/') ||
    path.startsWith('/__runtime/')
  );
}

function tileflowErrorResponse(error: unknown) {
  if (error instanceof Error && 'code' in error && error.code === 'PREVIEW_SELECTION_INVALID') {
    return jsonResponse({error: error.message}, 400);
  }

  if (error instanceof TileflowStyleValidationError) {
    return jsonResponse(
      {
        error: error.message,
        issues: error.issues,
      },
      400,
    );
  }

  if (error instanceof TileflowValidationError) {
    return jsonResponse(
      {
        error: error.message,
        messages: error.messages,
      },
      400,
    );
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return jsonResponse({error: message}, 500);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  });
}

function compactJsonResponse(body: unknown, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
    status,
  });
}

function assetResponse(asset: TileflowBuildAsset) {
  const body = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source);

  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': asset.contentType,
    },
  });
}
