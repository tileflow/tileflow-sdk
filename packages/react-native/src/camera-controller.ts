import {
  CameraControllerError,
  type CameraFallbacks,
  type CameraPropsSnapshot,
  sameCameraView,
  snapshotCameraProps,
  snapshotCameraView,
} from './camera-input';
import type {MapCameraProps, MapView, MapViewChangeEvent} from './contract';

export {CameraControllerError} from './camera-input';

/** Identity, not just sequence equality, binds callbacks to one controller instance. */
export type CameraToken = Readonly<{sequence: number}>;
export type CameraCommand = Readonly<{token: CameraToken; view: MapView}>;
export type CameraOperation = {
  /** Resolve only after this target has been applied. Retired completions are ignored. */
  finished: Promise<void>;
  cancel(): void | Promise<void>;
};
export type CameraPort = {
  /** The adapter must retire/cancel old commands and classify their observations by token. */
  apply(command: CameraCommand): CameraOperation;
};

type CommandRun = {
  command: CameraCommand;
  retired: boolean;
  cancelled: boolean;
  operation?: CameraOperation;
};
type Gesture = {token: CameraToken; lastEmitted: MapView};
type GestureSettlement = {token: CameraToken; notifying: boolean};

/** One pure owner per real native instance. No renderer, source, appearance or scheduling API. */
export function createMapCameraController(
  port: CameraPort,
  onError: (error: CameraControllerError) => void = () => undefined,
) {
  let apply: CameraPort['apply'];
  try {
    if (!port || typeof port.apply !== 'function' || typeof onError !== 'function') {
      throw new CameraControllerError('CAMERA_INPUT_INVALID');
    }
    apply = port.apply.bind(port);
  } catch {
    throw new CameraControllerError('CAMERA_INPUT_INVALID');
  }
  let report: ((error: CameraControllerError) => void) | undefined = onError;
  let mounted = false;
  let disposed = false;
  let mode: CameraPropsSnapshot['mode'] | undefined;
  let props: CameraPropsSnapshot | undefined;
  let live: MapView | undefined;
  let gesture: Gesture | undefined;
  let settlement: GestureSettlement | undefined;
  let pending: CommandRun | undefined;
  let sequence = 0;
  let revision = 0;

  function advance(): number {
    if (revision >= Number.MAX_SAFE_INTEGER)
      throw new CameraControllerError('CAMERA_INPUT_INVALID');
    return ++revision;
  }
  function token(): CameraToken {
    if (sequence >= Number.MAX_SAFE_INTEGER)
      throw new CameraControllerError('CAMERA_INPUT_INVALID');
    return Object.freeze({sequence: ++sequence});
  }
  function assertUsable(): void {
    if (disposed) throw new CameraControllerError('CAMERA_DISPOSED');
  }
  function notify(event: MapViewChangeEvent): void {
    const listener = props?.onViewChange;
    try {
      void Promise.resolve(listener?.(event)).catch(() => undefined);
    } catch {
      /* Observer failures cannot prevent reconciliation or cleanup. */
    }
  }
  function retire(run: CommandRun | undefined): void {
    if (!run) return;
    run.retired = true;
    if (!run.operation || run.cancelled) return;
    run.cancelled = true;
    try {
      void Promise.resolve(run.operation.cancel()).catch(() => undefined);
    } catch {
      /* Logical retirement does not wait for native cancellation. */
    }
  }
  function current(run: CommandRun): boolean {
    return mounted && !disposed && pending === run && !run.retired;
  }
  function failed(run: CommandRun): void {
    if (!current(run)) return;
    const own = revision;
    pending = undefined;
    retire(run);
    if (disposed || revision !== own) return;
    try {
      void Promise.resolve(report?.(new CameraControllerError('CAMERA_COMMAND_FAILED'))).catch(
        () => undefined,
      );
    } catch {
      /* The owner receives only a bounded diagnostic, never the remote cause. */
    }
  }
  function issue(view: MapView, force = false): void {
    if (!mounted || disposed) return;
    if (!force && pending && sameCameraView(pending.command.view, view)) return;
    if (!force && !pending && live && sameCameraView(live, view)) return;
    const run: CommandRun = {
      command: Object.freeze({token: token(), view}),
      retired: false,
      cancelled: false,
    };
    const previous = pending;
    pending = run;
    retire(previous);
    if (!current(run)) return;
    try {
      const operation = apply(run.command);
      if (!operation || typeof operation.cancel !== 'function') {
        throw new CameraControllerError('CAMERA_COMMAND_FAILED');
      }
      run.operation = operation;
      const finished = operation.finished;
      if (!finished || typeof finished.then !== 'function') {
        throw new CameraControllerError('CAMERA_COMMAND_FAILED');
      }
      void Promise.resolve(finished).then(
        () => {
          if (!current(run)) return;
          live = run.command.view;
          pending = undefined;
        },
        () => failed(run),
      );
      // apply() may synchronously reenter before returning its cancellation handle.
      if (!current(run)) retire(run);
    } catch {
      if (current(run)) failed(run);
      else retire(run);
    }
  }
  function reconcile(): void {
    if (!disposed && !gesture && !settlement && props?.mode === 'controlled') issue(props.view);
  }

  function update(input: MapCameraProps): void {
    assertUsable();
    if (!mounted) throw new CameraControllerError('CAMERA_NOT_MOUNTED');
    const own = advance();
    const next = snapshotCameraProps(input);
    if (disposed || revision !== own) return;
    if (next.mode !== mode) throw new CameraControllerError('CAMERA_MODE_CHANGE');
    props = next;
    // During a gesture or pending commit settlement, update authority/callbacks without commands.
    // In initial mode the validated replacement seed is deliberately not reapplied.
    reconcile();
  }

  function mount(input: MapCameraProps, fallbacks: CameraFallbacks = {}): void {
    assertUsable();
    if (mounted) {
      update(input);
      return;
    }
    const own = advance();
    const next = snapshotCameraProps(input, fallbacks);
    if (disposed || revision !== own) return;
    mode = next.mode;
    props = next;
    live = next.view;
    mounted = true;
    issue(next.view, true);
  }

  return {
    /** Last canonical observed/acknowledged view; not renderer readiness. */
    get view(): MapView | undefined {
      return live;
    },
    get mode(): CameraPropsSnapshot['mode'] | undefined {
      return mode;
    },
    mount,
    update,
    startGesture(): CameraToken | undefined {
      if (!mounted || disposed || !live) return undefined;
      if (gesture) return gesture.token;
      advance();
      const next = {token: token(), lastEmitted: live};
      gesture = next;
      settlement = undefined;
      const previous = pending;
      pending = undefined;
      retire(previous);
      return gesture === next && !disposed ? next.token : undefined;
    },
    changeGesture(identity: CameraToken, input: MapView): void {
      const active = gesture;
      if (disposed || !active || active.token !== identity) return;
      const own = advance();
      const view = snapshotCameraView(input);
      if (disposed || gesture !== active || revision !== own) return;
      live = view;
      if (sameCameraView(active.lastEmitted, view)) return;
      active.lastEmitted = view;
      notify(Object.freeze({type: 'view-change', view}));
    },
    endGesture(identity: CameraToken, input: MapView): void {
      const active = gesture;
      if (disposed || !active || active.token !== identity) return;
      const own = advance();
      const view = snapshotCameraView(input);
      if (disposed || gesture !== active || revision !== own) return;
      live = view;
      gesture = undefined;
      const waiting: GestureSettlement = {token: identity, notifying: true};
      settlement = waiting;
      try {
        if (!sameCameraView(active.lastEmitted, view)) {
          notify(Object.freeze({type: 'view-change', view}));
        }
      } finally {
        // Never clear a newer settlement installed by a reentrant callback.
        waiting.notifying = false;
      }
      // Only the owner can confirm the subsequent prop commit; do not infer rejection here.
    },
    /** Confirm the post-gesture prop commit, after update() has delivered its current props. */
    settleGesture(identity: CameraToken): void {
      const waiting = settlement;
      if (disposed || !waiting || waiting.token !== identity || waiting.notifying) return;
      advance();
      // Consume before issuing a command so reentrant/repeated confirmations are harmless.
      settlement = undefined;
      reconcile();
    },
    /** Programmatic observations are never public changes, even when their values differ. */
    observeCommand(identity: CameraToken, input: MapView): void {
      const run = pending;
      if (!run || !current(run) || run.command.token !== identity) return;
      const own = advance();
      const view = snapshotCameraView(input);
      if (!current(run) || revision !== own) return;
      live = view;
    },
    /** Called explicitly by the renderer owner after replacing style/source on this instance. */
    restoreAfterStyleChange(): void {
      if (!mounted || disposed || !live || !props) return;
      advance();
      const view = props.mode === 'controlled' ? props.view : live;
      gesture = undefined;
      settlement = undefined;
      issue(view, true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      gesture = undefined;
      settlement = undefined;
      props = undefined;
      report = undefined;
      const previous = pending;
      pending = undefined;
      retire(previous);
    },
  };
}
