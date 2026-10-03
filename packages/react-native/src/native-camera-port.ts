import type {CameraCommand, CameraOperation, CameraPort} from './camera-controller';
import {sameCameraView, snapshotCameraView} from './camera-input';
import type {MapView} from './contract';

type NativeCamera = Readonly<{
  applyCamera(command: number, view: MapView): Promise<Readonly<{command: number; view: MapView}>>;
  cancelCamera(command: number): Promise<Readonly<{cancelled: true}>>;
}>;
type Run = {command: CameraCommand; stopped: boolean; resolve(): void; reject(error: Error): void};
const failure = () => new Error('Native camera operation failed.');

/** One in-flight command and one latest target; native checks application, not queue insertion. */
export function createNativeCameraPort(native: NativeCamera) {
  let disposed = false;
  let running: Run | undefined;
  let pending: Run | undefined;
  let scheduled = false;
  const waiters = new Set<() => void>();
  const idle = () => {
    if (running || pending || scheduled) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const cancel = (run: Run) => {
    if (run.stopped) return;
    run.stopped = true;
    run.reject(failure());
    if (pending === run) pending = undefined;
    if (running === run) {
      try {
        void Promise.resolve(native.cancelCamera(run.command.token.sequence)).catch(
          () => undefined,
        );
      } catch {
        /* Native lifetime remains owned by the surface teardown. */
      }
    }
    idle();
  };
  const drain = () => {
    if (scheduled || running || disposed) return;
    scheduled = true;
    void Promise.resolve().then(async () => {
      scheduled = false;
      if (running || disposed) {
        idle();
        return;
      }
      const run = pending;
      pending = undefined;
      if (!run || run.stopped) {
        idle();
        return;
      }
      running = run;
      try {
        const receipt = await native.applyCamera(run.command.token.sequence, run.command.view);
        if (disposed || run.stopped) return;
        if (
          !receipt ||
          receipt.command !== run.command.token.sequence ||
          !sameCameraView(snapshotCameraView(receipt.view), run.command.view)
        )
          throw failure();
        run.resolve();
      } catch {
        if (!run.stopped) run.reject(failure());
      } finally {
        running = undefined;
        if (pending) drain();
        else idle();
      }
    });
  };
  const port: CameraPort = {
    apply(command): CameraOperation {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const finished = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void finished.catch(() => undefined);
      const run: Run = {command, stopped: false, resolve, reject};
      if (pending) cancel(pending);
      if (disposed) cancel(run);
      else {
        pending = run;
        drain();
      }
      return {finished, cancel: () => cancel(run)};
    },
  };
  return Object.freeze({
    apply: port.apply,
    whenIdle(): Promise<void> {
      return running || pending || scheduled
        ? new Promise((resolve) => waiters.add(resolve))
        : Promise.resolve();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pending) cancel(pending);
      if (running) cancel(running);
      idle();
    },
  });
}
