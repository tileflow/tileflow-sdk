import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createMapCameraController, type CameraToken} from './camera-controller';
import {snapshotCameraProps} from './camera-input';
import type {
  MapCameraProps,
  MapErrorEvent,
  MapLoadEvent,
  MapReadinessChangeEvent,
  MapSelection,
  MapTheme,
  MapThemeChangeEvent,
} from './contract';
import {createNativeCameraPort} from './native-camera-port';
import {createNativeReadiness} from './native-readiness';
import {freezeNativePreparedJson, NativePreparationError} from './native-style-document';
import type {NativeSurface, NativeSurfaceEvent} from './native-surface-contract';

export type NativeRendererTarget = Readonly<{
  source: Extract<TileflowNativeSourceState, {status: 'ready'}>;
  style: Readonly<Record<string, unknown>>;
}>;
export type NativeRendererEvent =
  | MapErrorEvent
  | MapLoadEvent
  | MapReadinessChangeEvent
  | MapThemeChangeEvent;
export type NativeRendererSurfaces = Readonly<{
  attach(
    root: number,
    notify: (event: NativeSurfaceEvent) => void,
    failure: () => void,
  ): Promise<NativeSurface>;
  retireRoot(root: number): Promise<void>;
}>;
const blank = Object.freeze({version: 8, sources: Object.freeze({}), layers: Object.freeze([])});
const selection = (target: NativeRendererTarget): MapSelection =>
  Object.freeze({
    map: target.source.map.name,
    theme: Object.freeze({name: target.source.theme.name, colorScheme: target.source.theme.colorScheme}),
  });

/** Owns one real native view; theme transactions never construct another owner or camera. */
export function createNativeRendererOwner(
  key: string,
  initialTarget: NativeRendererTarget,
  initialCamera: MapCameraProps,
  ports: Readonly<{
    surfaces: NativeRendererSurfaces;
    emit(event: NativeRendererEvent): void;
    changed(): void;
  }>,
) {
  let disposed = false;
  let terminal = false;
  let foreground = true;
  let revision = 0;
  let eventGeneration = initialTarget.source.generation;
  let transaction = 0;
  let styleSequence = 0;
  let token = '';
  let surface: NativeSurface | undefined;
  let attached: Promise<void> | undefined;
  let root: number | undefined;
  let disposal: Promise<void> | undefined;
  let active = initialTarget;
  let committed: NativeRendererTarget | undefined;
  let pendingSuccess = true;
  let rollback = false;
  let preloading = false;
  let styleAccepted = false;
  let loaded = false;
  let cameraMounted = false;
  let needsCommit = false;
  let barrierEpoch = 0;
  let barrier: Promise<void> | undefined;
  let gesture: {native: number; token: CameraToken} | undefined;
  let settlement: CameraToken | undefined;
  let cameraProps = initialCamera;
  const initial = snapshotCameraProps(initialCamera, {manifestView: initialTarget.source.map.view});
  const initialView = initial.view;
  let snapshot = Object.freeze({
    key,
    style: blank as Readonly<Record<string, unknown>>,
    initialView,
    revision,
  });
  const tasks = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    tasks.add(promise);
    void promise.then(() => tasks.delete(promise), () => tasks.delete(promise));
    return promise;
  };
  const changed = () => {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, revision: ++revision});
    try {
      ports.changed();
    } catch {
      /* A subscriber cannot own renderer lifetime. */
    }
  };
  const emit = (event: NativeRendererEvent) => {
    if (disposed) return;
    try {
      void Promise.resolve(ports.emit(Object.freeze(event))).catch(() => undefined);
    } catch {
      /* Observer failure is not a renderer failure. */
    }
  };
  const readiness = createNativeReadiness((status) => {
    if (disposed) return;
    const version = transaction;
    if (status === 'ready' && pendingSuccess && !rollback) {
      committed = active;
      pendingSuccess = false;
      emit({type: 'readiness-change', generation: eventGeneration, status});
      if (!disposed && transaction === version) {
        emit({
          type: 'theme-change',
          phase: 'ready',
          generation: eventGeneration,
          map: active.source.map.name,
          currentTheme: selection(active).theme,
        });
      }
    } else emit({type: 'readiness-change', generation: eventGeneration, status});
  });
  const cameraPort = createNativeCameraPort({
    applyCamera(command, view) {
      if (!surface || disposed || terminal || !loaded || !foreground)
        return Promise.reject(new NativePreparationError());
      return surface.applyCamera(command, view);
    },
    cancelCamera(command) {
      return surface ? surface.cancelCamera(command) : Promise.resolve({cancelled: true});
    },
  });
  const camera = createMapCameraController(cameraPort, () => {
    if (foreground) fail();
  });

  function invalidate() {
    if (disposed || terminal) return;
    barrierEpoch++;
    needsCommit = true;
    readiness.invalidate();
    changed();
  }
  function interruptCamera() {
    if (!cameraMounted) return;
    gesture = undefined;
    settlement = undefined;
    camera.interrupt();
  }
  function activateStyle(version: number) {
    if (
      disposed ||
      terminal ||
      !foreground ||
      !styleAccepted ||
      loaded ||
      version !== transaction
    )
      return;
    loaded = true;
    emit({type: 'load', generation: eventGeneration, selection: selection(active)});
    if (disposed || version !== transaction || !foreground) return;
    try {
      if (!cameraMounted) {
        cameraMounted = true;
        camera.mount(
          initial.mode === 'controlled'
            ? {view: initial.view, onViewChange: cameraProps.onViewChange!}
            : {initialView: initial.view, onViewChange: cameraProps.onViewChange},
        );
        camera.update(cameraProps);
      } else camera.restoreAfterStyleChange();
      track(
        cameraPort.whenIdle().then(() => {
          if (!disposed && foreground && version === transaction) invalidate();
        }),
      );
    } catch {
      fail();
    }
  }
  function apply(target: NativeRendererTarget, restoring: boolean) {
    if (disposed) return;
    const version = ++transaction;
    if (styleSequence >= Number.MAX_SAFE_INTEGER) {
      terminal = true;
      readiness.fail();
      return;
    }
    active = target;
    terminal = false;
    rollback = restoring;
    pendingSuccess = !restoring;
    preloading = false;
    styleAccepted = false;
    loaded = false;
    interruptCamera();
    token = `style_${++styleSequence}`;
    const expected = token;
    barrierEpoch++;
    needsCommit = true;
    readiness.begin(expected);
    if (!surface) return;
    const nativeSurface = surface;
    const work = Promise.resolve()
      .then(async () => {
        if (disposed || version !== transaction) return;
        await nativeSurface.expectStyle(expected);
        if (disposed || version !== transaction || surface !== nativeSurface) return;
        const layers = target.style.layers;
        if (
          !Array.isArray(layers) ||
          layers.length >= 4096 ||
          layers.some(
            (layer) =>
              !layer ||
              typeof layer !== 'object' ||
              typeof layer.id !== 'string' ||
              layer.id.startsWith('__tileflow_native_style_'),
          )
        )
          throw new NativePreparationError();
        const style = freezeNativePreparedJson({
          ...target.style,
          layers: [
            ...layers,
            {
              id: `__tileflow_native_style_${expected}`,
              type: 'background',
              layout: {visibility: 'none'},
              paint: {'background-opacity': 0},
            },
          ],
        });
        snapshot = Object.freeze({key, style, initialView, revision: ++revision});
        if (!restoring)
          emit({
            type: 'theme-change',
            phase: 'applying',
            generation: eventGeneration,
            map: target.source.map.name,
            targetTheme: selection(target).theme,
            ...(committed ? {currentTheme: selection(committed).theme} : {}),
          });
        if (!disposed && version === transaction) changed();
      })
      .catch(() => {
        if (!disposed && version === transaction) fail();
      });
    track(work);
  }
  function fail() {
    if (disposed || terminal) return;
    const generation = eventGeneration;
    const previous = committed;
    const version = transaction;
    emit({type: 'renderer-error', generation});
    if (disposed || version !== transaction) return;
    emit({
      type: 'theme-change',
      phase: 'error',
      generation,
      map: active.source.map.name,
      targetTheme: selection(active).theme,
      ...(previous ? {currentTheme: selection(previous).theme} : {}),
    });
    if (disposed || version !== transaction) return;
    if (!rollback && previous) apply(previous, true);
    else {
      ++transaction;
      terminal = true;
      styleAccepted = false;
      loaded = false;
      needsCommit = false;
      interruptCamera();
      readiness.fail();
    }
  }
  function native(event: NativeSurfaceEvent) {
    if (disposed || terminal || !surface || event.surface !== surface.id || event.style !== token) return;
    const version = transaction;
    if (event.kind === 'error') {
      fail();
      return;
    }
    if (event.kind === 'invalidate') {
      readiness.native(event);
      barrierEpoch++;
      needsCommit = true;
      changed();
      return;
    }
    if (event.kind === 'style') {
      readiness.native(event);
      if (styleAccepted) return;
      styleAccepted = true;
      activateStyle(version);
      return;
    }
    if (event.kind === 'render') {
      if (foreground && !preloading && loaded && !gesture && !settlement) readiness.native(event);
      return;
    }
    if (!foreground || !cameraMounted || !loaded) return;
    if (event.kind === 'gesture-start') {
      const started = camera.startGesture();
      if (!started) return;
      gesture = {native: event.gesture, token: started};
      settlement = undefined;
      readiness.invalidate();
      needsCommit = true;
      barrierEpoch++;
    } else if (event.kind === 'gesture-change') {
      if (gesture?.native === event.gesture) camera.changeGesture(gesture.token, event.view);
    } else if (event.kind === 'gesture-end' && gesture?.native === event.gesture) {
      const completed = gesture.token;
      gesture = undefined;
      settlement = completed;
      camera.endGesture(completed, event.view);
      // A new React commit must deliver the parent's response before settlement.
      if (!disposed && version === transaction && settlement === completed) changed();
    }
  }

  return Object.freeze({
    get snapshot() {
      return snapshot;
    },
    get initialView() {
      return initialView;
    },
    get token() {
      return token;
    },
    get currentTheme() {
      return committed ? selection(committed).theme : undefined;
    },
    get currentTarget() {
      return committed;
    },
    bindRoot(rootTag: number): void {
      if (
        disposed ||
        !Number.isSafeInteger(rootTag) ||
        rootTag < 1 ||
        (root !== undefined && root !== rootTag)
      )
        return;
      root = rootTag;
    },
    layoutChanged(): void {
      if (disposed || terminal) return;
      interruptCamera();
      invalidate();
    },
    attach(rootTag: number): Promise<void> {
      if (attached) return attached;
      if (
        disposed ||
        !Number.isSafeInteger(rootTag) ||
        rootTag < 1 ||
        (root !== undefined && root !== rootTag)
      )
        return Promise.reject(new NativePreparationError());
      root = rootTag;
      const pending = ports.surfaces
        .attach(rootTag, native, fail)
        .then(async (value) => {
          surface = value;
          if (disposed) {
            await value.retire();
            return;
          }
          apply(active, rollback);
        })
        .catch(() => {
          if (!disposed) fail();
        });
      attached = pending;
      track(pending);
      return pending;
    },
    preload(generation: number, targetTheme?: MapTheme): void {
      if (disposed) return;
      eventGeneration = generation;
      preloading = true;
      interruptCamera();
      invalidate();
      // A pending manifest does not yet establish the requested concrete theme.
      if (targetTheme)
        emit({
          type: 'theme-change',
          phase: 'preloading',
          generation,
          map: active.source.map.name,
          targetTheme,
          ...(committed ? {currentTheme: selection(committed).theme} : {}),
        });
    },
    setTarget(target: NativeRendererTarget): void {
      if (disposed) return;
      eventGeneration = target.source.generation;
      apply(target, false);
    },
    reuseTarget(source: NativeRendererTarget['source']): void {
      if (disposed || !committed || terminal) return;
      active = {...committed, source};
      committed = active;
      eventGeneration = source.generation;
      preloading = false;
      pendingSuccess = true;
      rollback = false;
      interruptCamera();
      invalidate();
    },
    preparationFailed(generation: number): void {
      if (disposed) return;
      eventGeneration = generation;
      preloading = false;
      emit({
        type: 'theme-change',
        phase: 'error',
        generation,
        map: active.source.map.name,
        ...(committed ? {currentTheme: selection(committed).theme} : {}),
      });
      if (!committed) {
        terminal = true;
        readiness.fail();
        return;
      }
      if (active !== committed || terminal) apply(committed, true);
      else {
        rollback = true;
        pendingSuccess = false;
        interruptCamera();
        invalidate();
      }
    },
    afterCommit(props: MapCameraProps): void {
      if (disposed || terminal) return;
      try {
        const next = snapshotCameraProps(props);
        if (next.mode !== initial.mode) throw new NativePreparationError();
        cameraProps = props;
        if (cameraMounted) {
          camera.update(props);
          if (!foreground) camera.interrupt();
        }
        const completed = settlement;
        settlement = undefined;
        if (completed && foreground) camera.settleGesture(completed);
      } catch {
        fail();
        return;
      }
      if (
        !surface ||
        !loaded ||
        !foreground ||
        preloading ||
        gesture ||
        !needsCommit ||
        barrier
      )
        return;
      const nativeSurface = surface;
      const expected = token;
      const epoch = barrierEpoch;
      const version = transaction;
      const work = cameraPort
        .whenIdle()
        .then(async () => {
          if (
            disposed ||
            !foreground ||
            preloading ||
            gesture ||
            version !== transaction ||
            epoch !== barrierEpoch
          )
            return;
          const layout = await nativeSurface.commitLayout(expected);
          if (
            disposed ||
            !foreground ||
            preloading ||
            gesture ||
            version !== transaction ||
            epoch !== barrierEpoch
          )
            return;
          needsCommit = false;
          readiness.commit(expected, layout);
          await nativeSurface.requestFrame(expected);
        })
        .catch(() => {
          if (!disposed && version === transaction && epoch === barrierEpoch && foreground) fail();
        });
      barrier = work;
      track(
        work.then(() => {
          if (barrier === work) barrier = undefined;
          if (
            !disposed &&
            !terminal &&
            needsCommit &&
            foreground &&
            loaded &&
            !gesture &&
            !preloading
          )
            changed();
        }),
      );
    },
    background(): void {
      if (disposed || !foreground) return;
      foreground = false;
      interruptCamera();
      invalidate();
    },
    resume(): void {
      if (disposed || terminal || foreground) return;
      foreground = true;
      if (styleAccepted && !loaded) {
        activateStyle(transaction);
        return;
      }
      try {
        if (cameraMounted && loaded) camera.restoreAfterStyleChange();
      } catch {
        fail();
        return;
      }
      track(
        cameraPort.whenIdle().then(() => {
          if (!disposed && foreground) invalidate();
        }),
      );
    },
    async whenIdle(): Promise<void> {
      for (;;) {
        await cameraPort.whenIdle();
        if (!tasks.size) return;
        await Promise.allSettled([...tasks]);
      }
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      disposed = true;
      ++transaction;
      ++barrierEpoch;
      readiness.dispose();
      camera.dispose();
      cameraPort.dispose();
      gesture = undefined;
      settlement = undefined;
      const attempt = Promise.resolve(attached).then(async () => {
        if (surface) await surface.retire();
        else if (root !== undefined) await ports.surfaces.retireRoot(root);
      });
      disposal = attempt;
      void attempt.catch(() => {
        if (disposal === attempt) disposal = undefined;
      });
      return attempt;
    },
  });
}
