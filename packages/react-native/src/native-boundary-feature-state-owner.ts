import type {VectorSourceRef} from '@maplibre/maplibre-react-native';
import type {TileflowFeatureStateMap} from '@tileflow/core/native';

type FeatureState = Parameters<VectorSourceRef['setFeatureState']>[1];
export type NativeBoundaryStyle = Readonly<{sources?: Readonly<Record<string, unknown>>}>;
export type NativeBoundarySource = Pick<VectorSourceRef, 'setFeatureState' | 'removeFeatureState'>;

/**
 * Adapts one style's Boundaries source to the renderer-neutral feature-state controller. The
 * source counts as present only while its style has loaded and the adopting VectorSource is
 * mounted; each change of readiness is a `styledata` event, so the controller sets every value
 * again after a style reload.
 */
export function createNativeBoundaryFeatureStateOwner(sourceId: string) {
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

  const map: TileflowFeatureStateMap = {
    getSource: (id) => (id === sourceId && present() ? {} : undefined),
    getStyle: () => style,
    on: (_type, listener) => listeners.add(listener),
    off: (_type, listener) => listeners.delete(listener),
    setFeatureState({id, sourceLayer}, state) {
      if (!sourceLayer) return;
      // A write that races a style reload is repeated once the style has loaded.
      void source?.setFeatureState({id, sourceLayer}, state as FeatureState).catch(() => undefined);
    },
    removeFeatureState({id, sourceLayer}, key) {
      if (!sourceLayer || id === undefined) return;
      void source?.removeFeatureState({id, sourceLayer}, key).catch(() => undefined);
    },
  };

  return Object.freeze({
    map,
    /** A newly committed style is loading until MapLibre reports it loaded. */
    setStyle(next: NativeBoundaryStyle, nextLoaded: boolean) {
      // Another style drops feature-state even when it loads at once: report it absent first.
      if (next !== style) {
        replacing = true;
        notify();
        replacing = false;
      }
      style = next;
      loaded = nextLoaded;
      notify();
    },
    setSource(next: NativeBoundarySource | null) {
      source = next;
      notify();
    },
  });
}

export function declaredVectorSource(style: NativeBoundaryStyle, id: string): boolean {
  const value = style.sources?.[id] as {type?: unknown} | undefined;
  return value?.type === 'vector';
}
