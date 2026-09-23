import {
  createTileflowNativeSourceController,
  resolveTileflowNativeManifestUrl,
  type TileflowNativeManifestAcquire,
  type TileflowNativeManifestOperation,
  type TileflowNativeSourceState,
} from '@tileflow/core/native';
import type {AppearanceSelection, AppearanceState} from './appearance';
import {snapshotCameraProps} from './camera-input';
import type {MapBaseProps, MapCameraProps, MapOptions, MapSourceState} from './contract';
import {assertHostedNativeStyleDocument} from './hosted-manifest-identity';
import {createHostedNativePreparationGuard} from './hosted-preparation';
import type {NativeMapAdmission, NativeMapAdmissionInput} from './native-admission-owner';
import {discriminateNativeResourceForTest} from './native-admission-url';
import type {NativeDocumentScope} from './native-document-contract';
import {createNativeManifestCache} from './native-manifest-cache';
import {snapshotNativeMapOptions} from './native-map-options';
import {
  createNativeRendererOwner,
  type NativeRendererEvent,
  type NativeRendererSurfaces,
} from './native-renderer-owner';
import {projectNativeResources} from './native-resource-projection';
import {NativePreparationError, readNativeStyleDocument} from './native-style-document';
import type {HostedNativeSessionBinding} from './session-controller';
import {projectMapSourceState} from './source-state';

type MountedMapProps = MapBaseProps & MapCameraProps;
type ReadySource = Extract<TileflowNativeSourceState, {status: 'ready'}>;
type BindingResolver = Readonly<{
  replace(source: TileflowNativeSourceState): Promise<HostedNativeSessionBinding>;
  dispose(): void;
}>;
type Lease = Readonly<{ready: Promise<NativeMapAdmission>; retire(): Promise<void>}>;
type Renderer = ReturnType<typeof createNativeRendererOwner>;
type Job = {live: boolean; operations: Set<TileflowNativeManifestOperation>};
type Epoch = {
  live: boolean;
  cache: ReturnType<typeof createNativeManifestCache>;
  binding: BindingResolver;
  hosted: ReturnType<typeof createHostedNativePreparationGuard>;
  operations: Set<TileflowNativeManifestOperation>;
  context?: Promise<NativeMapAdmission>;
  lease?: Lease;
  map?: NativeMapAdmission;
  renderer?: Renderer;
  job?: Job;
  retirement?: Promise<void>;
  catalog: Promise<void>;
};
export type MountedMapPorts = Readonly<{
  documents: {
    acquire(
      url: string,
      options: {maximumBytes: number},
      scope?: NativeDocumentScope,
    ): TileflowNativeManifestOperation;
  };
  createBinding(): BindingResolver;
  installation: {
    open(input: NativeMapAdmissionInput): Lease;
    retryRetirements(): Promise<void>;
  };
  surfaces: NativeRendererSurfaces & {available?(): void};
  appearance(
    selection: AppearanceSelection,
    listener: (state: AppearanceState) => void,
  ): () => void;
  now(): Date;
}>;

function cameraInput(props: MountedMapProps): MapCameraProps {
  const result: Record<string, unknown> = {};
  for (const key of ['view', 'initialView', 'onViewChange']) {
    const property = Object.getOwnPropertyDescriptor(props, key);
    if (!property) continue;
    if (!('value' in property)) throw new NativePreparationError();
    result[key] = property.value;
  }
  const input = result as MapCameraProps;
  snapshotCameraProps(input);
  return input;
}
function sourceIdentity(value: unknown): string | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('map') || !keys.includes('manifestUrl'))
      return undefined;
    const map = Object.getOwnPropertyDescriptor(value, 'map');
    const url = Object.getOwnPropertyDescriptor(value, 'manifestUrl');
    if (
      !map ||
      !url ||
      !map.enumerable ||
      !url.enumerable ||
      !('value' in map) ||
      !('value' in url) ||
      typeof map.value !== 'string' ||
      typeof url.value !== 'string' ||
      map.value.length > 64
    )
      return undefined;
    return `${map.value.length}:${map.value}${resolveTileflowNativeManifestUrl(url.value)}`;
  } catch {
    return undefined;
  }
}

/** Constructed per React effect lifetime. No native view exists until preparation succeeds. */
export function createMountedMapOwner(ports: MountedMapPorts) {
  let disposed = false;
  let foreground = true;
  let props: MountedMapProps | undefined;
  let camera: MapCameraProps = {};
  let mapOptions: MapOptions = Object.freeze({});
  let sourceKey: string | undefined;
  let sourceObject: unknown;
  let selectedTheme: string | undefined;
  let colorScheme: 'light' | 'dark' | undefined;
  let appearanceRelease: (() => void) | undefined;
  let appearanceEpoch = 0;
  let initialized = false;
  let revision = 0;
  let sourceState: MapSourceState | undefined;
  let current: Epoch | undefined;
  let lastReadiness = '';
  let disposal: Promise<void> | undefined;
  const retired = new Set<Epoch>();
  const tasks = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  let snapshot: Readonly<{
    revision: number;
    source?: MapSourceState;
    renderer?: Renderer['snapshot'];
    mapOptions: MapOptions;
  }> = Object.freeze({revision, mapOptions});
  const track = <T>(promise: Promise<T>): Promise<T> => {
    tasks.add(promise);
    void promise.then(
      () => tasks.delete(promise),
      () => tasks.delete(promise),
    );
    return promise;
  };
  const notify = () => {
    if (disposed) return;
    snapshot = Object.freeze({
      revision: ++revision,
      source: sourceState,
      renderer: current?.renderer?.snapshot,
      mapOptions,
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* React subscribers do not own the Map. */
      }
    }
  };
  const emit = (event: NativeRendererEvent) => {
    if (disposed || !props) return;
    if (event.type === 'readiness-change') {
      const identity = `${event.generation}:${event.status}`;
      if (lastReadiness === identity) return;
      lastReadiness = identity;
    }
    try {
      let result: unknown;
      if (event.type === 'load') result = props.onLoad?.(event);
      else if (event.type === 'renderer-error' || event.type === 'source-error')
        result = props.onError?.(event);
      else if (event.type === 'readiness-change') result = props.onReadinessChange?.(event);
      else result = props.onThemeChange?.(event);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      /* Public events never expose callback exceptions. */
    }
  };
  const generation = () => sourceState?.generation ?? 1;
  const rendererError = () => {
    emit({type: 'renderer-error', generation: generation()});
    if (!current?.renderer)
      emit({type: 'readiness-change', generation: generation(), status: 'error'});
  };

  function acquire(
    epoch: Epoch,
    url: string,
    options: {maximumBytes: number},
    scope?: NativeDocumentScope,
    job?: Job,
  ): TileflowNativeManifestOperation {
    if (!epoch.live || epoch.operations.size >= 16 || (job && !job.live))
      throw new NativePreparationError();
    const request = ports.documents.acquire(url, options, scope);
    let live = true;
    let cancellation: Promise<void> | undefined;
    const cancel = (): Promise<void> => {
      live = false;
      if (cancellation) return cancellation;
      const attempt = Promise.resolve()
        .then(() => request.cancel())
        .then(() => {
          epoch.operations.delete(operation);
          job?.operations.delete(operation);
        });
      cancellation = attempt;
      void attempt.catch(() => {
        if (cancellation === attempt) cancellation = undefined;
      });
      return attempt;
    };
    const operation: TileflowNativeManifestOperation = {
      cancel,
      response: request.response.then((response) => {
        if (!live || !epoch.live || (job && !job.live)) throw new NativePreparationError();
        return {
          url: response.url,
          status: response.status,
          reader: {
            async read(maximumBytes) {
              if (!live || !epoch.live || (job && !job.live)) throw new NativePreparationError();
              const result = await response.reader.read(maximumBytes);
              if (!live || !epoch.live || (job && !job.live)) throw new NativePreparationError();
              if (result.done) await cancel();
              return result;
            },
            cancel,
          },
        };
      }),
    };
    epoch.operations.add(operation);
    job?.operations.add(operation);
    void operation.response.catch(() => cancel()).catch(() => undefined);
    return operation;
  }
  function cancelJob(epoch: Epoch) {
    const job = epoch.job;
    epoch.job = undefined;
    if (!job) return;
    job.live = false;
    for (const operation of job.operations) {
      try {
        void Promise.resolve(operation.cancel()).catch(() => undefined);
      } catch {
        /* Retained in the epoch for retry. */
      }
    }
  }
  function retire(epoch: Epoch): Promise<void> {
    if (epoch.retirement) return epoch.retirement;
    epoch.live = false;
    retired.add(epoch);
    cancelJob(epoch);
    epoch.cache.clear();
    epoch.binding.dispose();
    // Logical context retirement starts immediately; provider removal waits for view detachment.
    const context = epoch.map?.retire();
    const view = epoch.renderer?.dispose();
    const attempt = Promise.resolve().then(async () => {
      await Promise.all([
        context,
        view,
        ...[...epoch.operations].map((operation) => operation.cancel()),
      ]);
      try {
        await epoch.context;
      } catch {
        /* A rejected bootstrap/registration still owns its lease cleanup. */
      }
      if (epoch.lease) await epoch.lease.retire();
      retired.delete(epoch);
    });
    epoch.retirement = attempt;
    void attempt.catch(() => {
      if (epoch.retirement === attempt) epoch.retirement = undefined;
    });
    return track(attempt);
  }
  function createEpoch(): Epoch {
    const epoch: Epoch = {
      live: true,
      binding: ports.createBinding(),
      hosted: createHostedNativePreparationGuard(),
      operations: new Set(),
      catalog: Promise.resolve(),
      cache: undefined as unknown as Epoch['cache'],
    };
    epoch.cache = createNativeManifestCache((url, options) => acquire(epoch, url, options));
    return epoch;
  }
  const core = createTileflowNativeSourceController({
    acquire: ((url, options) => {
      if (!current || !current.live) throw new NativePreparationError();
      return current.cache.acquire(url, options);
    }) satisfies TileflowNativeManifestAcquire,
  });

  async function context(epoch: Epoch, source: ReadySource): Promise<NativeMapAdmission> {
    if (!epoch.context) {
      epoch.context = Promise.resolve().then(async () => {
        await Promise.all([...retired].map(retire));
        await ports.installation.retryRetirements();
        if (!epoch.live || current !== epoch) throw new NativePreparationError();
        const binding = await epoch.binding.replace(source);
        if (!epoch.live || current !== epoch) throw new NativePreparationError();
        epoch.lease = ports.installation.open({binding, resources: [], now: ports.now});
        const map = await epoch.lease.ready;
        epoch.map = map;
        if (!epoch.live || current !== epoch || map.state.status !== 'active') {
          await map.retire();
          throw new NativePreparationError();
        }
        return map;
      });
      void epoch.context.catch(() => undefined);
    }
    return epoch.context;
  }
  function prepare(epoch: Epoch, source: ReadySource) {
    cancelJob(epoch);
    const job: Job = {live: true, operations: new Set()};
    epoch.job = job;
    let styleReadFailed = false;
    const owns = () =>
      !disposed &&
      foreground &&
      current === epoch &&
      epoch.live &&
      job.live &&
      epoch.job === job &&
      core.state === source;
    const work = Promise.resolve()
      .then(async () => {
        if (!owns()) return;
        // Recheck every resolution, including cache refreshes which reuse the original session.
        epoch.hosted.validate(source);
        const map = await context(epoch, source);
        if (!owns()) return;
        const previous = epoch.renderer?.currentTarget;
        if (
          previous &&
          previous.source.theme.name === source.theme.name &&
          previous.source.theme.styleUrl === source.theme.styleUrl &&
          previous.source.theme.revision === source.theme.revision
        ) {
          epoch.renderer!.reuseTarget(source);
          return;
        }
        const policy = await map.prepare();
        if (!owns()) return;
        const prepared = await projectNativeResources({
          styleUrl: source.theme.styleUrl,
          policy,
          fontFaces: source.theme.fontFaces?.map((face) => ({
            family: face.family,
            source: face.source,
            ...(face.style === undefined ? {} : {style: face.style}),
            ...(face.weight === undefined ? {} : {weight: face.weight}),
          })),
          current: owns,
          accept(resources) {
            const preceding = epoch.catalog;
            const update = preceding
              .catch(() => undefined)
              .then(async () => {
                if (!owns()) throw new NativePreparationError();
                await map.extendResources(resources);
              });
            epoch.catalog = update;
            return update;
          },
          // Sprite bases are rewritten only after their four exact leaf URLs are acknowledged.
          discriminate: (url) => discriminateNativeResourceForTest(url, map.context),
          async read(url, maximumBytes, resource) {
            try {
              const document = await readNativeStyleDocument(
                acquire(epoch, url, {maximumBytes}, resource ? map.scope : undefined, job),
                maximumBytes,
                owns,
              );
              if (url === source.theme.styleUrl) assertHostedNativeStyleDocument(source, document);
              return document;
            } catch {
              // Only the root protected style can indicate obsolete discovery metadata.
              // Child resource failures and source/configuration failures never refresh authority.
              if (url === source.theme.styleUrl && resource?.scope === 'style')
                styleReadFailed = true;
              throw new NativePreparationError();
            }
          },
        });
        if (!owns()) return;
        ports.surfaces.available?.();
        if (!epoch.renderer)
          epoch.renderer = createNativeRendererOwner(
            map.context,
            {source, style: prepared.style},
            camera,
            {
              surfaces: ports.surfaces,
              emit(event) {
                if (current === epoch && epoch.live && !disposed) emit(event);
              },
              changed() {
                if (current === epoch && epoch.live) notify();
              },
              interactionsChanged() {
                if (current === epoch && epoch.live && !disposed) notify();
              },
            },
          );
        else epoch.renderer.setTarget({source, style: prepared.style});
        notify();
      })
      .catch(() => {
        if (!owns()) return;
        if (styleReadFailed && epoch.hosted.retryManifest()) {
          cancelJob(epoch);
          epoch.cache.clear();
          // Do not call select(): only an explicit selection replenishes the one-reload budget.
          if (!disposed && foreground && current === epoch && epoch.live && props) {
            track(core.replace(props.source, {theme: props.theme, colorScheme}));
          }
          return;
        }
        rendererError();
        epoch.renderer?.preparationFailed(source.generation);
      })
      .finally(() => {
        if (epoch.job === job) epoch.job = undefined;
      });
    track(work);
  }
  const unsubscribe = core.subscribe((state) => {
    const epoch = current;
    if (disposed || !epoch?.live) return;
    sourceState = projectMapSourceState(state);
    notify();
    if (current !== epoch || !epoch.live || disposed || core.state !== state) return;
    if (state.status === 'loading') {
      cancelJob(epoch);
      epoch.renderer?.preload(state.generation);
      emit({type: 'readiness-change', generation: state.generation, status: 'loading'});
    } else if (state.status === 'ready') {
      if (foreground) prepare(epoch, state);
    } else {
      cancelJob(epoch);
      const safe = projectMapSourceState(state);
      if (safe?.status === 'error' && foreground)
        emit({type: 'source-error', generation: state.generation, error: safe.error});
      if (current !== epoch || !epoch.live || disposed) return;
      epoch.renderer?.preparationFailed(state.generation);
      if (!epoch.renderer && foreground)
        emit({type: 'readiness-change', generation: state.generation, status: 'error'});
    }
  });
  function select() {
    if (disposed || !props || !current?.live) return;
    current.hosted.select();
    track(core.replace(props.source, {theme: props.theme, colorScheme}));
  }
  function appearance(theme: string | undefined) {
    if ((theme === 'system') === Boolean(appearanceRelease)) return;
    const version = ++appearanceEpoch;
    appearanceRelease?.();
    appearanceRelease = undefined;
    colorScheme = undefined;
    if (theme !== 'system') return;
    let activating = true;
    appearanceRelease = ports.appearance({theme: 'system'}, (state) => {
      if (disposed || version !== appearanceEpoch) return;
      const next = state.status === 'available' ? state.colorScheme : undefined;
      if (next === colorScheme) return;
      colorScheme = next;
      if (!activating) select();
    });
    activating = false;
  }
  function nativeLifecycle(active: boolean) {
    if (disposed || typeof active !== 'boolean') return;
    if (!active) {
      if (!foreground) return;
      foreground = false;
      if (current) {
        cancelJob(current);
        current.renderer?.background();
      }
      return;
    }
    if (!foreground) {
      foreground = true;
      current?.renderer?.resume();
    }
    const epoch = current;
    const state = core.state;
    if (epoch?.live && state?.status === 'ready' && !epoch.job) {
      const target = epoch.renderer?.currentTarget;
      if (
        !target ||
        target.source.generation !== state.generation ||
        target.source.theme.name !== state.theme.name ||
        target.source.theme.styleUrl !== state.theme.styleUrl ||
        target.source.theme.revision !== state.theme.revision
      )
        prepare(epoch, state);
    }
  }

  return Object.freeze({
    getInteractionStyle() {
      if (disposed || !foreground || !current?.live || sourceState?.status !== 'ready') return;
      return current.renderer?.getInteractionStyle();
    },
    getSnapshot: () => snapshot,
    getSourceState: () => sourceState,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next: MountedMapProps): void {
      if (disposed) return;
      props = next;
      let options: MapOptions;
      let input: MapCameraProps;
      try {
        options = snapshotNativeMapOptions(next.mapOptions);
        input = cameraInput(next);
      } catch {
        rendererError();
        return;
      }
      const key = sourceIdentity(next.source);
      const changedSource =
        !initialized || key !== sourceKey || (key === undefined && sourceObject !== next.source);
      const changedTheme = !initialized || next.theme !== selectedTheme;
      const changedOptions = JSON.stringify(options) !== JSON.stringify(mapOptions);
      camera = input;
      mapOptions = options;
      if (changedSource) {
        const previous = current;
        current = undefined;
        if (previous) void retire(previous).catch(() => undefined);
        current = createEpoch();
        sourceKey = key;
        sourceObject = next.source;
      }
      selectedTheme = next.theme;
      initialized = true;
      try {
        appearance(next.theme);
      } catch {
        colorScheme = undefined;
      }
      if (changedSource || changedTheme) select();
      if (changedOptions || changedSource) notify();
      current?.renderer?.afterCommit(camera);
    },
    rootMounted(key: string, root: number): void {
      if (!disposed && current?.renderer?.snapshot.key === key) current.renderer.bindRoot(root);
    },
    nativeStyleLoaded(key: string, root: number): void {
      if (disposed || current?.renderer?.snapshot.key !== key) return;
      void current.renderer.attach(root).catch(() => undefined);
    },
    layoutChanged(key: string): void {
      if (!disposed && current?.renderer?.snapshot.key === key) current.renderer.layoutChanged();
    },
    background(): void {
      nativeLifecycle(false);
    },
    resume(): void {
      if (disposed || foreground) return;
      nativeLifecycle(true);
      const state = core.state;
      if (state?.status !== 'ready') select();
    },
    nativeLifecycle,
    async whenIdle(): Promise<void> {
      while (tasks.size) await Promise.allSettled([...tasks]);
      await current?.renderer?.whenIdle();
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      disposed = true;
      ++appearanceEpoch;
      appearanceRelease?.();
      appearanceRelease = undefined;
      unsubscribe();
      core.dispose();
      listeners.clear();
      const previous = current;
      current = undefined;
      snapshot = Object.freeze({revision: ++revision, source: sourceState, mapOptions});
      if (previous) void retire(previous).catch(() => undefined);
      const attempt = Promise.all([...retired].map(retire)).then(() =>
        ports.installation.retryRetirements(),
      );
      disposal = attempt;
      void attempt.catch(() => {
        if (disposal === attempt) disposal = undefined;
      });
      return attempt;
    },
  });
}
