import type {MapProps} from './contract';
import type {createMountedMapOwner} from './mounted-map-owner';

type Owner = ReturnType<typeof createMountedMapOwner>;
type Snapshot = ReturnType<Owner['getSnapshot']>;
const empty: Snapshot = Object.freeze({revision: 0, mapOptions: Object.freeze({})});

/** React can replay an effect without reusing disposed native/controller ownership. */
export function createMapLifecycle(create: () => Owner, retire: (owner: Owner) => void) {
  let active: {owner: Owner; release(): void} | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* Subscribers do not own native cleanup. */ }
    }
  };
  return Object.freeze({
    getSnapshot(): Snapshot { return active?.owner.getSnapshot() ?? empty; },
    getSourceState() { return active?.owner.getSourceState(); },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mount(): () => void {
      if (active) throw new Error('Native Map is already mounted.');
      const owner = create();
      const epoch = {owner, release: () => undefined as void};
      active = epoch;
      epoch.release = owner.subscribe(() => { if (active === epoch) notify(); });
      notify();
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        if (active === epoch) active = undefined;
        epoch.release();
        retire(owner);
        notify();
      };
    },
    update(props: MapProps): void { active?.owner.update(props); },
    rootMounted(key: string, root: number): void { active?.owner.rootMounted(key, root); },
    nativeStyleLoaded(key: string, root: number): void { active?.owner.nativeStyleLoaded(key, root); },
    layoutChanged(key: string): void { active?.owner.layoutChanged(key); },
    background(): void { active?.owner.background(); },
    resume(): void { active?.owner.resume(); },
  });
}
