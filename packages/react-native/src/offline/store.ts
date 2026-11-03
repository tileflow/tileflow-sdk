import type {EventSubscription} from 'react-native';
import type {Spec} from '../specs/NativeTileflowOffline';
import {offlineError} from './error';
import type {
  OfflineRegion,
  OfflineRegionEstimate,
  OfflineRegionEvent,
  OfflineRegionLoadOptions,
} from './types';

async function run<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw offlineError(error);
  }
}

type Listener = (event: OfflineRegionEvent) => void;

/** The offline store and switch over a native module; the package root binds them to the app's module. */
export function createOfflineStore(module: () => Spec, report: (error: unknown) => void) {
  const listeners = new Set<Listener>();
  let native: EventSubscription | undefined;

  function dispatch(event: unknown) {
    // Each listener sees every event, even when another throws.
    for (const listener of [...listeners]) {
      try {
        listener(event as OfflineRegionEvent);
      } catch (error) {
        report(error);
      }
    }
  }

  /**
   * The app's offline regions, after Mapbox's tile store: estimate, load, observe, pause, resume,
   * cancel and remove regions. Loading a stored region again downloads only what changed. Hosted
   * content uses the map credential of the app's native configuration.
   */
  const TileflowOfflineStore = Object.freeze({
    estimateRegion: (options: OfflineRegionLoadOptions) =>
      run(async () => (await module().estimateRegion(options)) as OfflineRegionEstimate),
    /** Starts or updates a region's download and resolves with the region once it is recorded. */
    loadRegion: (id: string, options: OfflineRegionLoadOptions) =>
      run(async () => (await module().loadRegion(id, options)) as OfflineRegion),
    /** Changes a region's metadata in place, without a new download. */
    updateRegionMetadata: (id: string, metadata: Readonly<Record<string, string>>) =>
      run(() => module().updateRegionMetadata(id, metadata)),
    allRegions: () => run(async () => (await module().allRegions()) as OfflineRegion[]),
    region: (id: string) =>
      run(async () => ((await module().region(id)) as {region?: OfflineRegion}).region ?? null),
    pauseRegion: (id: string) => run(() => module().pauseRegion(id)),
    resumeRegion: (id: string) => run(() => module().resumeRegion(id)),
    /** Stops a download and discards what it downloaded; a stored version stays available. */
    cancelRegion: (id: string) => run(() => module().cancelRegion(id)),
    removeRegion: (id: string) => run(() => module().removeRegion(id)),
    automaticUpdatesEnabled: () => run(() => module().automaticUpdatesEnabled()),
    /**
     * Lets the store update regions by itself on unmetered networks. On iOS the app also lists the
     * background task; the Expo plugin's `offline.backgroundUpdates` option does it.
     */
    setAutomaticUpdates: (enabled: boolean) => run(() => module().setAutomaticUpdates(enabled)),
    /** Region events: created, progressed, changed state or removed. */
    subscribe(listener: Listener): {remove(): void} {
      const store = module();
      listeners.add(listener);
      if (!native) {
        native = store.onRegionEvent(dispatch);
        store.startObserving();
      }
      let removed = false;
      return {
        remove() {
          if (removed) return;
          removed = true;
          listeners.delete(listener);
          if (listeners.size === 0 && native) {
            native.remove();
            native = undefined;
            store.stopObserving();
          }
        },
      };
    },
  });

  /**
   * Turns Tileflow's network use off and on for the whole app, after Mapbox's offline switch: off,
   * downloads wait and Tileflow native maps use only stored regions and the cache.
   */
  const TileflowOfflineSwitch = Object.freeze({
    isNetworkEnabled: () => module().isNetworkEnabled(),
    setNetworkEnabled: (enabled: boolean) => module().setNetworkEnabled(enabled),
  });

  return {TileflowOfflineStore, TileflowOfflineSwitch};
}
