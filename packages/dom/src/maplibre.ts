export type TileflowMapLibre = typeof import('maplibre-gl');
export type TileflowMapLibreConfiguration = Readonly<{workerUrl: string}>;

/**
 * Where a bundler integration such as `@tileflow/vite` leaves the worker it resolved for the
 * application. It is only a default: an explicit `configureTileflowMapLibre` call wins.
 */
const bundlerWorkerUrlKey = Symbol.for('tileflow.maplibre.workerUrl');

let mapLibrePromise: Promise<TileflowMapLibre> | undefined;
let mapLibre: TileflowMapLibre | undefined;
let workerUrl: string | undefined;
let appliedWorkerUrl: string | undefined;

/** Configure the application-owned worker before mounting an interactive Tileflow map. */
export function configureTileflowMapLibre(configuration: TileflowMapLibreConfiguration): void {
  const nextWorkerUrl = configuration.workerUrl;

  if (!isWorkerUrl(nextWorkerUrl)) {
    throw new TypeError('Tileflow MapLibre workerUrl must be a non-empty string.');
  }

  if (workerUrl !== undefined && workerUrl !== nextWorkerUrl) {
    throw new Error('Tileflow MapLibre workerUrl is already configured.');
  }

  if (appliedWorkerUrl !== undefined && appliedWorkerUrl !== nextWorkerUrl) {
    throw new Error(
      'Tileflow MapLibre workerUrl is already configured: a map started with the bundler-provided worker. Configure the worker before the first map.',
    );
  }

  workerUrl = nextWorkerUrl;
  if (mapLibre) applyWorkerUrl(mapLibre);
}

/** Load the interactive renderer only after a browser map requests it. */
export function loadTileflowMapLibre(): Promise<TileflowMapLibre> {
  mapLibrePromise ??= import('maplibre-gl')
    .then(resolveMapLibreModule)
    .then(configureTileflowMapLibreModule)
    .catch((error: unknown) => {
      mapLibrePromise = undefined;
      throw error;
    });

  return mapLibrePromise;
}

function resolveMapLibreModule(module: TileflowMapLibre): TileflowMapLibre {
  const defaultExport = (module as TileflowMapLibre & {default?: TileflowMapLibre}).default;
  return defaultExport ?? module;
}

function configureTileflowMapLibreModule(maplibregl: TileflowMapLibre): TileflowMapLibre {
  applyWorkerUrl(maplibregl);
  mapLibre = maplibregl;
  return maplibregl;
}

/** Set MapLibre's worker once: the explicit configuration, else the bundler's default. */
function applyWorkerUrl(maplibregl: TileflowMapLibre): void {
  const nextWorkerUrl = workerUrl ?? readBundlerWorkerUrl();
  if (nextWorkerUrl === undefined || nextWorkerUrl === appliedWorkerUrl) return;
  maplibregl.setWorkerUrl(nextWorkerUrl);
  appliedWorkerUrl = nextWorkerUrl;
}

function readBundlerWorkerUrl(): string | undefined {
  const value = (globalThis as Record<symbol, unknown>)[bundlerWorkerUrlKey];
  return isWorkerUrl(value) ? value : undefined;
}

function isWorkerUrl(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
