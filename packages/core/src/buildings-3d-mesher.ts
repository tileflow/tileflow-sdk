import {meshTileflowBuildings, type TileflowBuildingMeshOptions} from './buildings-3d-mesh';
import {prepareBuildingTile, type PreparedBuildingTile} from './buildings-3d-tile';
import type {TileflowTileLayer} from './vector-tile-decode';

// Meshes a tile and prepares it for upload, as the worker does.
const meshTile = (layer: TileflowTileLayer, options: TileflowBuildingMeshOptions) => {
  const mesh = meshTileflowBuildings(layer, options);
  return mesh && prepareBuildingTile(mesh);
};

// Replaced by the browser build. Source consumers and environments without workers use the same mesher locally.
declare const TILEFLOW_BUILDING_WORKER_SOURCE: string;

function browserWorker(): Worker | undefined {
  if (typeof Worker === 'undefined' || typeof TILEFLOW_BUILDING_WORKER_SOURCE === 'undefined')
    return;
  const url = URL.createObjectURL(
    new Blob([TILEFLOW_BUILDING_WORKER_SOURCE], {type: 'text/javascript'}),
  );
  try {
    return new Worker(url, {name: 'tileflow-buildings'});
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One serial worker per renderer. Cancelled jobs never replace current tiles. */
export function createBuildingMesher(createWorker: () => Worker | undefined = browserWorker) {
  let worker: Worker | undefined;
  let unavailable = false;
  let disposed = false;
  let finish: (() => void) | undefined;
  let tail = Promise.resolve();
  return {
    build(
      layer: TileflowTileLayer,
      options: TileflowBuildingMeshOptions,
      signal: AbortSignal,
    ): Promise<PreparedBuildingTile | undefined> {
      const result = tail.then(async () => {
        if (disposed || signal.aborted) throw new Error('Building mesh cancelled');
        if (!worker && !unavailable) {
          try {
            worker = createWorker();
          } catch {
            /* CSP can disable blob workers. */
          }
          if (!worker) unavailable = true;
        }
        if (!worker) return meshTile(layer, options);
        const active = worker;
        return new Promise<PreparedBuildingTile | undefined>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeout);
            finish = undefined;
            active.onmessage = null;
            active.onerror = null;
          };
          const fallback = () => {
            cleanup();
            active.terminate();
            worker = undefined;
            unavailable = true;
            if (disposed || signal.aborted) {
              reject(new Error('Building mesh cancelled'));
              return;
            }
            try {
              resolve(meshTile(layer, options));
            } catch (error) {
              reject(error);
            }
          };
          // Covers failed startup (including CSP) without leaving loading tiles pending forever.
          const timeout = setTimeout(fallback, 15_000);
          finish = () => {
            cleanup();
            reject(new Error('Building mesher disposed'));
          };
          active.onerror = (event) => {
            event.preventDefault();
            fallback();
          };
          active.onmessage = ({
            data,
          }: MessageEvent<{tile?: PreparedBuildingTile; error?: string}>) => {
            cleanup();
            if (disposed || signal.aborted) reject(new Error('Building mesh cancelled'));
            else if (data.error) reject(new Error(data.error));
            else resolve(data.tile);
          };
          try {
            active.postMessage({layer, options});
          } catch {
            fallback();
          }
        });
      });
      tail = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    dispose() {
      disposed = true;
      finish?.();
      worker?.terminate();
      worker = undefined;
    },
  };
}
