import {open} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  getTileflowStyleFontFaces,
  tileflowMapIdSchema,
  tileflowThemeNameSchema,
} from '@tileflow/core';
import {createTileflowArtifactSession, type TileflowBuildArtifacts} from './artifacts';
import {defaultTileflowApiUrl, defaultTileflowConfigPath, TileflowValidationError} from './config';
import type {TileflowBuildAsset} from './icons';
import type {TileflowLocalTilesetFile} from './local-tilesets';
import {normalizeTileflowBasePath} from './public-paths';
import {
  type TileflowArtifactAcquisition,
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
  TileflowArtifactAcquisition,
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

export type TileflowDevRequestHandler = ((request: Request) => Promise<Response>) & {
  close(): Promise<void>;
  refresh(): Promise<void>;
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
    headers: Object.fromEntries(
      Object.entries(request.headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]],
      ),
    ),
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

export function createTileflowDevRequestHandler(
  options: TileflowDevRequestHandlerOptions = {},
): TileflowDevRequestHandler {
  const basePath = normalizeTileflowBasePath(options.basePath);
  const configPath = options.config ?? defaultTileflowConfigPath;
  const cwd = options.cwd ?? process.cwd();
  const apiBaseUrl = options.apiBaseUrl ?? defaultTileflowApiUrl;
  let ownedSessionPromise: Promise<TileflowArtifactSession> | undefined;
  let closed = false;
  let lastOrigin: string | undefined;
  const loadOwnedSession = (origin: string) => {
    lastOrigin = origin;
    ownedSessionPromise ??= createTileflowArtifactSession({
      assetBaseUrl: `${origin}${basePath}`,
      config: configPath,
      cwd,
      inspection: options.inspection,
      styleBaseUrl: options.styleBaseUrl ?? `${origin}${basePath}`,
      apiBaseUrl,
    }).catch((error: unknown) => {
      ownedSessionPromise = undefined;
      throw error;
    });
    return ownedSessionPromise;
  };

  const handleTileflowDevRequest = async (request: Request) => {
    if (closed) return jsonResponse({error: 'Tileflow request handler is closed.'}, 503);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({error: 'Method not allowed'}, 405);
    }

    const url = new URL(request.url);
    const path = getTileflowRequestPath(url.pathname, basePath);

    if (path === null) {
      return jsonResponse({error: 'Not found'}, 404);
    }

    let acquisition: TileflowArtifactAcquisition | undefined;
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

      const session = options.session ?? (await loadOwnedSession(url.origin));
      acquisition = session.acquireArtifacts();
      const artifacts: TileflowBuildArtifacts | undefined = acquisition?.artifacts;
      const state: TileflowArtifactSessionState = session.getState();

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
        const isSemanticPreview =
          preview !== undefined &&
          previewStyle?.metadata?.['tileflow:compiler'] === 'tileflow-semantic';
        const fontFaces = previewStyle ? getTileflowStyleFontFaces(previewStyle) : [];
        return htmlResponse(
          renderTileflowPreviewHtml(
            preview,
            basePath,
            createTileflowArtifactStatus(state),
            isSemanticPreview,
            fontFaces,
          ),
        );
      }

      if (!artifacts) return unavailableArtifactsResponse(state);

      if (path.startsWith('/tilesets/')) {
        const fileName = path.replace(/^\/+/, '');
        const localTileset = artifacts.localTilesets?.find(
          (candidate) => candidate.fileName === fileName,
        );
        if (!localTileset) return jsonResponse({error: 'Unknown local tileset.'}, 404);
        return localTilesetResponse(request, localTileset);
      }

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
    } finally {
      await acquisition?.release();
    }
  };

  return Object.assign(handleTileflowDevRequest, {
    async close() {
      if (closed) return;
      closed = true;
      const ownedSession = await ownedSessionPromise?.catch(() => undefined);
      await ownedSession?.close();
    },
    async refresh() {
      if (closed) return;
      if (options.session) {
        await options.session.refresh('request-handler');
        return;
      }
      if (!lastOrigin) return;
      await (await loadOwnedSession(lastOrigin)).refresh('request-handler');
    },
  });
}

async function localTilesetResponse(
  request: Request,
  file: TileflowLocalTilesetFile,
): Promise<Response> {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/vnd.pmtiles',
    ETag: file.etag,
  });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(file.byteLength));
    return new Response(null, {headers, status: 200});
  }

  const range = parseLocalTilesetRange(request.headers.get('range'), file.byteLength);
  if (!range) {
    headers.set('Content-Range', `bytes */${file.byteLength}`);
    return new Response(null, {headers, status: 416});
  }
  const length = range.end - range.start + 1;
  if (length > 16 * 1024 * 1024) {
    headers.set('Content-Range', `bytes */${file.byteLength}`);
    return new Response(null, {headers, status: 416});
  }

  const handle = await open(file.sourcePath, 'r');
  try {
    const bytes = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(bytes, read, length - read, range.start + read);
      if (result.bytesRead === 0) throw new Error('Local PMTiles snapshot ended during read.');
      read += result.bytesRead;
    }
    headers.set('Content-Length', String(length));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.byteLength}`);
    return new Response(bytes, {headers, status: 206});
  } finally {
    await handle.close();
  }
}

function parseLocalTilesetRange(value: string | null, size: number) {
  const match = value?.match(/^bytes=(\d+)-(\d*)$/u);
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return {end, start};
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
    path.startsWith('/tilesets/') ||
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
