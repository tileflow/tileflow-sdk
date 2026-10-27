import type {VectorSourceRef} from '@maplibre/maplibre-react-native';
import type {TileflowFeatureStateMap} from '@tileflow/core/native';

type FeatureState = Parameters<VectorSourceRef['setFeatureState']>[1];
export type NativeBoundaryStyle = Readonly<{sources?: Readonly<Record<string, unknown>>}>;
export type NativeBoundarySource = Pick<VectorSourceRef, 'setFeatureState' | 'removeFeatureState'>;
type Schedule = (run: () => void, delayMs: number) => () => void;

// MapLibre adopts the style's source shortly after the VectorSource mounts, on the native side.
const retryDelaysMs = [16, 50, 150, 400, 1000] as const;
const timer: Schedule = (run, delayMs) => {
  const handle = setTimeout(run, delayMs);
  return () => clearTimeout(handle);
};

/**
 * Adapts one style's Boundaries source to the renderer-neutral feature-state controller. The
 * source counts as present only while its style has loaded and the adopting VectorSource is
 * mounted; each change of readiness is a `styledata` event, so the controller sets every value
 * again after a style reload. A write rejected while the source counts as present reached it
 * before MapLibre adopted it, so every value is set again after a bounded backoff.
 */
export function createNativeBoundaryFeatureStateOwner(
  sourceId: string,
  schedule: Schedule = timer,
) {
  const listeners = new Set<() => void>();
  let source: NativeBoundarySource | null = null;
  let style: NativeBoundaryStyle = {};
  let loaded = false;
  let replacing = false;
  const present = () =>
    !replacing && loaded && source !== null && declaredVectorSource(style, sourceId);
  let notified = false;
  const notify = () => {
    const next = present();
    if (next === notified) return;
    notified = next;
    for (const listener of [...listeners]) listener();
  };
  const absentThenNotify = () => {
    replacing = true;
    notify();
    replacing = false;
    notify();
  };
  let attempt = 0;
  let cancelRetry: (() => void) | undefined;
  const reset = () => {
    cancelRetry?.();
    cancelRetry = undefined;
    attempt = 0;
  };
  const rejected = (target: NativeBoundarySource) => {
    if (cancelRetry || target !== source || !present() || attempt >= retryDelaysMs.length) return;
    cancelRetry = schedule(() => {
      cancelRetry = undefined;
      if (target === source && present()) absentThenNotify();
    }, retryDelaysMs[attempt++]!);
  };
  const write = (operation: (target: NativeBoundarySource) => Promise<void>) => {
    const target = source;
    if (!target) return;
    void operation(target).then(
      () => {
        if (target === source && !cancelRetry) attempt = 0;
      },
      () => rejected(target),
    );
  };

  const map: TileflowFeatureStateMap = {
    getSource: (id) => (id === sourceId && present() ? {} : undefined),
    getStyle: () => style,
    on: (_type, listener) => listeners.add(listener),
    off: (_type, listener) => listeners.delete(listener),
    setFeatureState({id, sourceLayer}, state) {
      if (!sourceLayer) return;
      write((target) => target.setFeatureState({id, sourceLayer}, state as FeatureState));
    },
    removeFeatureState({id, sourceLayer}, key) {
      if (!sourceLayer || id === undefined) return;
      write((target) => target.removeFeatureState({id, sourceLayer}, key));
    },
  };

  return Object.freeze({
    map,
    /** A newly committed style is loading until MapLibre reports it loaded. */
    setStyle(next: NativeBoundaryStyle, nextLoaded: boolean) {
      // Another style drops feature-state even when it loads at once: report it absent first.
      if (next !== style) {
        reset();
        replacing = true;
        notify();
        replacing = false;
      }
      style = next;
      loaded = nextLoaded;
      notify();
    },
    setSource(next: NativeBoundarySource | null) {
      if (next !== source) reset();
      source = next;
      notify();
    },
  });
}

export function declaredVectorSource(style: NativeBoundaryStyle, id: string): boolean {
  const value = style.sources?.[id] as {type?: unknown} | undefined;
  return value?.type === 'vector';
}
