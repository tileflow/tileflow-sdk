import {createJiti} from 'jiti';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {createRequire} from 'node:module';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {
  compareCodeUnits,
  createManifest,
  createStyleFromProject,
  type MapLibreStyle,
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
  type TileflowConfig,
  type TileflowManifest,
  type TileflowProjectConfig,
  type TileflowStyleOptions,
  validateConfig,
  type ValidationMessage,
} from '@tileflow/core';
import {
  getTileflowIconWatchPaths,
  prepareTileflowProjectIcons,
  type TileflowBuildAsset,
} from './icons';
import {isPathWithin} from './path-safety';
import {renderTileflowPreviewHtml} from './preview-html';
import {
  createTileflowArtifactSessionWithBuilder,
  type TileflowArtifactSession,
  type TileflowArtifactSessionOptions,
  tileflowArtifactSessionSchemaVersion,
  type TileflowArtifactSessionState,
} from './session';
import {
  assertValidTileflowStyle,
  normalizeTileflowStyleValidationIssues,
  TileflowStyleValidationError,
  type TileflowStyleValidationIssue,
  validateTileflowStyle,
} from './style-validation';

export {inspectTileflowFeatures} from './feature-inspection';
export type {
  TileflowFeatureInspection,
  TileflowFeatureInspectionOptions,
  TileflowInspectedFeature,
  TileflowInspectedProperty,
} from './feature-inspection';

export {createTileflowArtifactDiagnostics, tileflowArtifactSessionSchemaVersion} from './session';
export type {
  TileflowArtifactDiagnostic,
  TileflowArtifactSession,
  TileflowArtifactSessionOptions,
  TileflowArtifactSessionState,
} from './session';
export {
  assertValidTileflowStyle,
  TileflowStyleValidationError,
  validateTileflowStyle,
} from './style-validation';
export type {TileflowStyleValidationIssue} from './style-validation';

export {
  compileTileflowIconPackages,
  iconFileExtensions,
  inspectTileflowIconCatalogs,
  prepareTileflowProjectIcons,
  TileflowIconCompilationError,
} from './icons';
export type {
  CompiledTileflowIconPackage,
  CompiledTileflowIconPackageFile,
  CompileTileflowIconPackagesResult,
  InspectTileflowIconCatalogsOptions,
  PreparedTileflowProject,
  TileflowBuildAsset,
  TileflowIconCatalog,
  TileflowIconCatalogAtlasRectangle,
  TileflowIconCatalogIcon,
  TileflowIconCatalogInspection,
  TileflowIconCatalogMap,
  TileflowIconCatalogMappedFrom,
  TileflowIconCatalogMapping,
  TileflowIconCatalogRenderedDensity,
  TileflowIconCatalogSourceFormat,
  TileflowIconCompilationIssue,
  TileflowIconCompilationTarget,
  TileflowMapIconPackageBinding,
} from './icons';

export const defaultTileflowApiUrl = 'https://api.tileflow.dev';
export const defaultTileflowConfigPath = 'tileflow.config.ts';
export const defaultTileflowManifestPath = 'public/tileflow/manifest.json';

export type LoadTileflowConfigOptions = {
  cwd?: string;
  fresh?: boolean;
};

export type TileflowManifestOptions = {
  styleBaseUrl?: string;
};

export type TileflowDevRequestHandlerOptions = {
  apiBaseUrl?: string;
  basePath?: string;
  config?: string;
  cwd?: string;
  map?: string;
  onError?: (error: unknown) => void;
  scene?: string;
  session?: TileflowArtifactSession;
  styleBaseUrl?: string;
};

export type TileflowPreviewSelection = {
  map?: string;
  scene?: string;
};

export type ResolvedTileflowPreview = {
  camera: NormalizedTileflowCaptureScene['camera'];
  label: string;
  mapName: string;
  viewport?: NormalizedTileflowCaptureScene['viewport'];
};

export class TileflowPreviewSelectionError extends Error {
  readonly code = 'PREVIEW_SELECTION_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'TileflowPreviewSelectionError';
  }
}

export type TileflowBuildArtifactsOptions = {
  apiBaseUrl?: string;
  assetBaseUrl?: string;
  config?: string;
  cwd?: string;
  styleBaseUrl?: string;
};

export type TileflowBuildArtifacts = {
  assets: TileflowBuildAsset[];
  manifest: TileflowManifest;
  project: TileflowProjectConfig;
  styles: Record<string, MapLibreStyle>;
  watchPaths: string[];
};

export type WriteTileflowBuildArtifactsOptions = TileflowBuildArtifactsOptions & {
  outDir: string;
};

export class TileflowValidationError extends Error {
  readonly code = 'CONFIG_INVALID' as const;
  readonly messages: ValidationMessage[];
  readonly phase = 'config-validation' as const;

  constructor(messages: ValidationMessage[]) {
    super('Invalid Tileflow config');
    this.name = 'TileflowValidationError';
    this.messages = messages;
  }
}

export async function loadTileflowConfig(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<TileflowProjectConfig> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = resolve(cwd, configPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  if (options.fresh) {
    clearTileflowLocalModuleCache(resolvedPath, cwd);
  }

  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: !options.fresh,
  });
  const imported = await jiti.import(resolvedPath, {default: true});

  return asTileflowProjectConfig(imported);
}

export async function loadValidTileflowConfig(
  configPath = defaultTileflowConfigPath,
  options: LoadTileflowConfigOptions = {},
): Promise<TileflowProjectConfig> {
  const project = await loadTileflowConfig(configPath, options);

  assertValidTileflowConfig(project);

  return project;
}

export function assertValidTileflowConfig(project: TileflowProjectConfig) {
  const result = validateConfig(project);

  if (!result.valid) {
    throw new TileflowValidationError(result.messages);
  }
}

export function asTileflowProjectConfig(input: unknown): TileflowProjectConfig {
  if (
    input &&
    typeof input === 'object' &&
    'maps' in input &&
    typeof (input as {maps?: unknown}).maps === 'object'
  ) {
    return input as TileflowProjectConfig;
  }

  return {maps: {main: input as TileflowConfig}};
}

export function getTileflowMapNames(project: TileflowProjectConfig): string[] {
  return Object.keys(project.maps);
}

export function getFirstTileflowMapName(project: TileflowProjectConfig): string {
  const [mapName] = getTileflowMapNames(project);

  if (!mapName) {
    throw new Error('Tileflow config must define at least one map.');
  }

  return mapName;
}

export function resolveTileflowPreview(
  project: TileflowProjectConfig,
  selection: TileflowPreviewSelection = {},
): ResolvedTileflowPreview {
  if (selection.map !== undefined && selection.scene !== undefined) {
    throw new TileflowPreviewSelectionError(
      'Choose either a Tileflow preview map or scene, not both.',
    );
  }

  if (selection.scene !== undefined) {
    const scene = Object.hasOwn(project.scenes ?? {}, selection.scene)
      ? project.scenes?.[selection.scene]
      : undefined;

    if (!scene) {
      throw new TileflowPreviewSelectionError(`Unknown Tileflow scene: ${selection.scene}`);
    }

    const normalized = normalizeTileflowCaptureScene(scene);

    if (normalized.target.kind === 'application') {
      throw new TileflowPreviewSelectionError(
        `Tileflow scene "${selection.scene}" targets an application. Preview it through the application's development server.`,
      );
    }

    if (!Object.hasOwn(project.maps, normalized.map)) {
      throw new TileflowPreviewSelectionError(
        `Tileflow scene "${selection.scene}" references an unknown map: ${normalized.map}`,
      );
    }

    return {
      camera: normalized.camera,
      label: `${normalized.map} / ${selection.scene} · ${normalized.viewport.width}×${normalized.viewport.height}`,
      mapName: normalized.map,
      viewport: normalized.viewport,
    };
  }

  const mapName = selection.map ?? getFirstTileflowMapName(project);
  const map = Object.hasOwn(project.maps, mapName) ? project.maps[mapName] : undefined;

  if (!map) {
    throw new TileflowPreviewSelectionError(`Unknown Tileflow map: ${mapName}`);
  }

  return {
    camera: {
      type: 'center',
      center: map.view?.center ? [map.view.center[0], map.view.center[1]] : [0, 0],
      zoom: map.view?.zoom ?? 0,
      bearing: map.view?.bearing ?? 0,
      pitch: map.view?.pitch ?? 0,
    },
    label: mapName,
    mapName,
  };
}

export function getTileflowStyleMapName(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  return fileName.replace(/\.json$/, '');
}

export function createTileflowManifest(
  project: TileflowProjectConfig,
  options: TileflowManifestOptions = {},
): TileflowManifest {
  return createManifest(project, options);
}

export function createTileflowStyle(
  project: TileflowProjectConfig,
  mapName: string,
  options: TileflowStyleOptions = {},
): MapLibreStyle {
  const style = createStyleFromProject(project, mapName, options);
  assertValidTileflowStyle(style, mapName);
  return style;
}

export function createTileflowStyles(
  project: TileflowProjectConfig,
  options: TileflowStyleOptions = {},
): Record<string, MapLibreStyle> {
  const styleEntries: Array<[string, MapLibreStyle]> = [];
  const issues: TileflowStyleValidationIssue[] = [];

  for (const mapName of getTileflowMapNames(project).sort(compareCodeUnits)) {
    const style = createStyleFromProject(project, mapName, options);
    styleEntries.push([mapName, style]);
    issues.push(...validateTileflowStyle(style, mapName));
  }

  if (issues.length > 0) {
    throw new TileflowStyleValidationError(normalizeTileflowStyleValidationIssues(issues));
  }

  return Object.fromEntries(styleEntries);
}

export async function createTileflowBuildArtifacts(
  options: TileflowBuildArtifactsOptions = {},
): Promise<TileflowBuildArtifacts> {
  const project = await loadValidTileflowConfig(options.config ?? defaultTileflowConfigPath, {
    cwd: options.cwd,
    fresh: true,
  });
  const prepared = await prepareTileflowProjectIcons(project, {
    assetBaseUrl: resolveAssetBaseUrl(options),
    cwd: options.cwd ?? process.cwd(),
  });
  const styleOptions = {apiBaseUrl: options.apiBaseUrl};
  const styles = createTileflowStyles(prepared.project, styleOptions);

  return {
    assets: prepared.assets,
    manifest: createManifest(prepared.project, {
      styleBaseUrl: options.styleBaseUrl,
    }),
    project: prepared.project,
    styles,
    watchPaths: prepared.watchPaths,
  };
}

export function createTileflowArtifactSession(
  options: TileflowArtifactSessionOptions = {},
): Promise<TileflowArtifactSession> {
  return createTileflowArtifactSessionWithBuilder(options, createTileflowBuildArtifacts);
}

export async function getTileflowWatchPaths(
  options: Pick<TileflowBuildArtifactsOptions, 'config' | 'cwd'> = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const project = await loadValidTileflowConfig(options.config ?? defaultTileflowConfigPath, {
    cwd,
    fresh: true,
  });

  return getTileflowIconWatchPaths(project, cwd);
}

export async function writeTileflowBuildArtifacts(options: WriteTileflowBuildArtifactsOptions) {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir);
  const stylesDir = resolve(outDir, 'styles');
  const artifacts = await createTileflowBuildArtifacts(options);

  await mkdir(stylesDir, {recursive: true});

  for (const [mapName, style] of Object.entries(artifacts.styles)) {
    await writeFile(
      resolve(stylesDir, `${mapName}.json`),
      `${JSON.stringify(style, null, 2)}\n`,
      'utf8',
    );
  }

  for (const asset of artifacts.assets) {
    const outputPath = resolve(outDir, asset.fileName);

    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, asset.source);
  }

  await writeFile(
    resolve(outDir, 'manifest.json'),
    `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
    'utf8',
  );

  return artifacts;
}

export function isTileflowRequestUrl(url: string | undefined, basePath: string) {
  const pathname = (url ?? '/').split('?')[0] ?? '/';

  if (!basePath) {
    return (
      pathname === '/manifest.json' ||
      pathname === '/style.json' ||
      pathname === '/' ||
      pathname.startsWith('/icons/') ||
      pathname.startsWith('/styles/')
    );
  }

  return pathname === basePath || pathname.startsWith(`${basePath}/`);
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

export function joinTileflowPublicUrl(publicBase: string, basePath: string) {
  const trimmedBase = publicBase.replace(/\/+$/g, '');
  const trimmedPath = basePath.replace(/^\/+|\/+$/g, '');

  if (!trimmedPath) {
    return trimmedBase || '';
  }

  if (!trimmedBase || trimmedBase === '.') {
    return `/${trimmedPath}`;
  }

  return `${trimmedBase}/${trimmedPath}`;
}

export function getTileflowAssetBasePath(basePath: string) {
  return basePath.replace(/^\/+|\/+$/g, '');
}

export function getTileflowAssetFileName(basePath: string, fileName: string) {
  return basePath ? `${basePath}/${fileName}` : fileName;
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
    const path = stripTileflowBasePath(url.pathname, basePath);

    if (path === null) {
      return jsonResponse({error: 'Not found'}, 404);
    }

    try {
      if (path === '/__events') {
        return options.session
          ? eventStreamResponse(options.session)
          : jsonResponse({error: 'Live events require a development session.'}, 404);
      }

      if (path === '/__runtime/maplibre-gl.js') {
        return textAssetResponse(getLocalMapLibreAsset('js'), 'text/javascript; charset=utf-8');
      }

      if (path === '/__runtime/maplibre-gl.css') {
        return textAssetResponse(getLocalMapLibreAsset('css'), 'text/css; charset=utf-8');
      }

      if (path === '/__runtime/three.module.js') {
        return textAssetResponse(getLocalThreeAsset('module'), 'text/javascript; charset=utf-8');
      }

      if (path === '/__runtime/three.core.min.js') {
        return textAssetResponse(getLocalThreeAsset('core'), 'text/javascript; charset=utf-8');
      }

      if (path.startsWith('/__runtime/three-addons/')) {
        return textAssetResponse(
          getLocalThreeAddonAsset(path.slice('/__runtime/three-addons/'.length)),
          'text/javascript; charset=utf-8',
        );
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
        const preview = artifacts
          ? resolveTileflowPreview(artifacts.project, {map: options.map, scene: options.scene})
          : undefined;
        const isStreetsPreview =
          preview !== undefined &&
          state.status === 'ready' &&
          state.artifacts.styles[preview.mapName]?.metadata?.['tileflow:basemap'] === 'streets';
        return htmlResponse(
          renderTileflowPreviewHtml(
            preview,
            basePath,
            createTileflowArtifactStatus(state),
            isStreetsPreview,
          ),
        );
      }

      if (!artifacts) return unavailableArtifactsResponse(state);

      if (path === '/manifest.json') {
        return jsonResponse(artifacts.manifest);
      }

      if (path === '/style.json') {
        return compactJsonResponse(artifacts.styles[getFirstTileflowMapName(artifacts.project)]);
      }

      if (path.startsWith('/styles/')) {
        const mapName = getTileflowStyleMapName(path);

        if (!Object.hasOwn(artifacts.styles, mapName)) {
          return jsonResponse({error: `Unknown map: ${mapName}`}, 404);
        }

        return compactJsonResponse(artifacts.styles[mapName]);
      }

      if (path.startsWith('/icons/')) {
        const assetName = path.replace(/^\/+/, '');
        const asset = artifacts.assets.find((candidate) => candidate.fileName === assetName);

        if (!asset) {
          return jsonResponse({error: `Unknown icon asset: ${assetName}`}, 404);
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

export function normalizeTileflowBasePath(value = '') {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');

  return trimmed ? `/${trimmed}` : '';
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

function tileflowErrorResponse(error: unknown) {
  if (error instanceof TileflowPreviewSelectionError) {
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

function resolveAssetBaseUrl(options: TileflowBuildArtifactsOptions): string {
  if (options.assetBaseUrl !== undefined) {
    return options.assetBaseUrl;
  }

  if (options.styleBaseUrl && !isRelativePublicUrl(options.styleBaseUrl)) {
    return options.styleBaseUrl;
  }

  return '..';
}

function isRelativePublicUrl(value: string): boolean {
  return !(
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    value.startsWith('data:')
  );
}

const localRequire = createRequire(import.meta.url);
let localMapLibreJavaScript: string | undefined;
let localMapLibreStylesheet: string | undefined;
let localThreeCoreJavaScript: string | undefined;
let localThreeModuleJavaScript: string | undefined;

function getLocalMapLibreAsset(kind: 'css' | 'js'): string {
  if (kind === 'js' && localMapLibreJavaScript !== undefined) return localMapLibreJavaScript;
  if (kind === 'css' && localMapLibreStylesheet !== undefined) return localMapLibreStylesheet;

  const packagePath = localRequire.resolve('maplibre-gl/package.json');
  const source = readFileSync(
    join(dirname(packagePath), 'dist', kind === 'js' ? 'maplibre-gl.js' : 'maplibre-gl.css'),
    'utf8',
  );
  if (kind === 'js') localMapLibreJavaScript = source;
  else localMapLibreStylesheet = source;
  return source;
}

function getLocalThreeAsset(kind: 'core' | 'module'): string {
  if (kind === 'core' && localThreeCoreJavaScript !== undefined) {
    return localThreeCoreJavaScript;
  }
  if (kind === 'module' && localThreeModuleJavaScript !== undefined) {
    return localThreeModuleJavaScript;
  }
  const commonJsPath = localRequire.resolve('three');
  const source = readFileSync(
    join(dirname(commonJsPath), kind === 'core' ? 'three.core.min.js' : 'three.module.min.js'),
    'utf8',
  );
  if (kind === 'core') localThreeCoreJavaScript = source;
  else localThreeModuleJavaScript = source;
  return source;
}

function getLocalThreeAddonAsset(relativePath: string): string {
  if (!/^[A-Za-z0-9_./-]+\.js$/.test(relativePath) || relativePath.includes('..')) {
    throw new Error('Invalid Three.js addon path.');
  }
  const commonJsPath = localRequire.resolve('three');
  const addonRoot = join(dirname(dirname(commonJsPath)), 'examples', 'jsm');
  const assetPath = join(addonRoot, relativePath);
  if (!isPathWithin(addonRoot, assetPath)) throw new Error('Invalid Three.js addon path.');
  return readFileSync(assetPath, 'utf8');
}

function textAssetResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
    },
  });
}

function clearTileflowLocalModuleCache(configPath: string, cwd: string): void {
  const roots = [canonicalPath(cwd), canonicalPath(dirname(resolve(configPath)))];

  for (const cachePath of Object.keys(localRequire.cache)) {
    if (cachePath.split(sep).includes('node_modules')) continue;
    if (roots.some((root) => isPathWithin(root, canonicalPath(cachePath)))) {
      delete localRequire.cache[cachePath];
    }
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}
