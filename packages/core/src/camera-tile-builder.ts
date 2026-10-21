// Builds what Tileflow's 3D layers draw from the tiles they read, off the page: one worker decodes
// each tile once and meshes its buildings or places its trees and lamps, nearest tiles first.
import {
  type CameraTileResult,
  type CameraTileTask,
  cameraTileTaskLayers,
  createDecodedCameraTiles,
  runCameraTileTask,
} from './camera-tile-tasks';

// Replaced by the browser build. Source consumers and environments without workers build in the page.
declare const TILEFLOW_CAMERA_TILE_WORKER_SOURCE: string;

function browserWorker(): Worker | undefined {
  if (typeof Worker === 'undefined' || typeof TILEFLOW_CAMERA_TILE_WORKER_SOURCE === 'undefined')
    return;
  const url = URL.createObjectURL(
    new Blob([TILEFLOW_CAMERA_TILE_WORKER_SOURCE], {type: 'text/javascript'}),
  );
  try {
    return new Worker(url, {name: 'tileflow-tiles'});
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A tile to build from: the address it was read from, its bytes and the layer's task. */
export type CameraTileJob<Task extends CameraTileTask> = Readonly<{
  url: string;
  bytes: Uint8Array;
  task: Task;
  /** Lower builds first: the tile's distance from the camera. */
  priority: number;
}>;

export type CameraTileBuilder = {
  build<Task extends CameraTileTask>(
    job: CameraTileJob<Task>,
    signal: AbortSignal,
  ): Promise<CameraTileResult<Task['kind']>>;
  dispose(): void;
};

type Queued = {
  job: CameraTileJob<CameraTileTask>;
  signal: AbortSignal;
  resolve(value: CameraTileResult<CameraTileTask['kind']>): void;
  reject(error: unknown): void;
};

/**
 * One worker building one tile at a time. Jobs whose layer stopped waiting are dropped before they
 * start; a job the worker has started finishes, and its result is discarded.
 */
export function createCameraTileBuilder(
  createWorker: () => Worker | undefined = browserWorker,
): CameraTileBuilder {
  const local = createDecodedCameraTiles();
  const queue: Queued[] = [];
  let worker: Worker | undefined;
  let unavailable = false;
  let disposed = false;
  let active: Queued | undefined;
  let finish: (() => void) | undefined;

  const cancelled = () => new Error('Tile build cancelled');
  const buildHere = ({job}: Queued) =>
    runCameraTileTask(job.task, local.read(job.url, job.bytes, cameraTileTaskLayers(job.task)));

  function next(): void {
    if (active || disposed) return;
    // The nearest tile still wanted goes first.
    let best = -1;
    for (let at = queue.length - 1; at >= 0; at -= 1) {
      const entry = queue[at]!;
      if (entry.signal.aborted) {
        queue.splice(at, 1);
        entry.reject(cancelled());
        if (best > at) best -= 1;
      } else if (best < 0 || entry.job.priority <= queue[best]!.job.priority) best = at;
    }
    if (best < 0) return;
    const entry = queue.splice(best, 1)[0]!;
    active = entry;
    const done = () => {
      active = undefined;
      next();
    };
    if (!worker && !unavailable) {
      try {
        worker = createWorker();
      } catch {
        /* CSP can disable blob workers. */
      }
      if (!worker) unavailable = true;
    }
    if (!worker) {
      try {
        entry.resolve(buildHere(entry));
      } catch (error) {
        entry.reject(error);
      }
      done();
      return;
    }
    const running = worker;
    const cleanup = () => {
      clearTimeout(timeout);
      finish = undefined;
      running.onmessage = null;
      running.onerror = null;
    };
    const fallback = () => {
      cleanup();
      running.terminate();
      worker = undefined;
      unavailable = true;
      if (entry.signal.aborted) entry.reject(cancelled());
      else
        try {
          entry.resolve(buildHere(entry));
        } catch (error) {
          entry.reject(error);
        }
      done();
    };
    // Covers failed startup (including CSP) without leaving loading tiles pending forever.
    const timeout = setTimeout(fallback, 15_000);
    finish = () => {
      cleanup();
      entry.reject(new Error('Tile builder disposed'));
    };
    running.onerror = (event) => {
      event.preventDefault();
      fallback();
    };
    running.onmessage = ({
      data,
    }: MessageEvent<{result?: CameraTileResult<CameraTileTask['kind']>; error?: string}>) => {
      cleanup();
      if (entry.signal.aborted) entry.reject(cancelled());
      else if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
      done();
    };
    try {
      // The bytes are copied, not moved: the page keeps them to build here should the worker fail.
      running.postMessage({url: entry.job.url, bytes: entry.job.bytes, task: entry.job.task});
    } catch {
      fallback();
    }
  }

  return {
    build(job, signal) {
      if (disposed || signal.aborted) return Promise.reject(cancelled());
      return new Promise((resolve, reject) => {
        const entry: Queued = {job, signal, resolve: resolve as Queued['resolve'], reject};
        // A job its layer stopped waiting for leaves the queue at once.
        signal.addEventListener(
          'abort',
          () => {
            const at = queue.indexOf(entry);
            if (at < 0) return;
            queue.splice(at, 1);
            reject(cancelled());
          },
          {once: true},
        );
        queue.push(entry);
        next();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      finish?.();
      active = undefined;
      for (const entry of queue.splice(0)) entry.reject(cancelled());
      worker?.terminate();
      worker = undefined;
    },
  };
}

let shared: {builder: CameraTileBuilder; users: number} | undefined;

/**
 * The page's builder, shared by every 3D layer so a tile they all read is decoded once; the last
 * layer to let go of it terminates its worker.
 */
export function acquireCameraTileBuilder(): CameraTileBuilder {
  const entry = (shared ??= {builder: createCameraTileBuilder(), users: 0});
  entry.users += 1;
  let released = false;
  return {
    build: (job, signal) =>
      released
        ? Promise.reject(new Error('Tile build cancelled'))
        : entry.builder.build(job, signal),
    dispose() {
      if (released) return;
      released = true;
      entry.users -= 1;
      if (entry.users === 0 && shared === entry) {
        shared = undefined;
        entry.builder.dispose();
      }
    },
  };
}
