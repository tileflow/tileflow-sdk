import {
  type TileflowLightRhythm,
  tileflowLightRhythm,
  tileflowLightStateAt,
} from './nautical-light-rhythm';
import {
  readTileflowNauticalLights,
  type TileflowNauticalLights,
  tileflowNauticalLightStates,
} from './nautical-lights';

type FeatureId = number | string;
type FeatureTarget = {id: FeatureId; source: string; sourceLayer: string};

type TileflowNauticalLightsEvent =
  'idle' | 'moveend' | 'remove' | 'sourcedata' | 'style.load' | 'styledata';

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowNauticalLightsMap = {
  getContainer(): HTMLElement;
  getLayer(id: string): {maxzoom?: number; minzoom?: number} | undefined;
  getLayoutProperty(id: string, name: 'visibility'): unknown;
  getSource(id: string): unknown;
  getStyle(): {metadata?: unknown} | undefined;
  getZoom(): number;
  off(
    event: TileflowNauticalLightsEvent,
    listener: (event?: {sourceId?: unknown}) => void,
  ): unknown;
  on(event: TileflowNauticalLightsEvent, listener: (event?: {sourceId?: unknown}) => void): unknown;
  queryRenderedFeatures(options: {layers: string[]}): readonly {
    id?: unknown;
    properties?: Record<string, unknown> | null;
  }[];
  removeFeatureState(target: FeatureTarget, key?: string): unknown;
  setFeatureState(target: FeatureTarget, state: Record<string, number>): unknown;
};

type Written = {colour: number; intensity: number};

/** The earliest a phase change is shown, so changes due within it are written together. */
const coalesceSeconds = 0.025;
/** Updates never run more often than this. */
const minimumIntervalMs = 40;
const rhythmCacheSize = 512;

/**
 * Flash the Nautical lights of a compiled style in their rhythms. The style's
 * `tileflow:nautical-lights` metadata names the light layers; for each light drawn in them, the
 * helper derives its rhythm (`tileflowLightRhythm`) and writes the light's intensity and colour as
 * MapLibre feature state whenever its phase changes. Lights that are in the same phase change
 * together, and the helper wakes only for the next change.
 *
 * Nothing is written, and no timer runs, while the page is hidden, while no light layer is
 * visible at the current zoom, or when no drawn light has a rhythm. When the person viewing the
 * map prefers reduced motion, or on disposal or map `remove`, every light returns to steady.
 * Lights are identified by the feature ID their source promotes; the compiled Nautical source
 * promotes each light's unique `provenance`. A light without an ID stays steady.
 */
export function attachTileflowNauticalLights(map: TileflowNauticalLightsMap): () => void {
  const document = map.getContainer().ownerDocument;
  const browser = document.defaultView;
  if (!browser) return () => {};
  let reducedMotion: MediaQueryList | undefined;
  try {
    reducedMotion = browser.matchMedia?.('(prefers-reduced-motion: reduce)');
  } catch {
    reducedMotion = undefined;
  }
  const rhythms = new Map<string, TileflowLightRhythm | undefined>();
  /** Drawn light features by rhythm key. */
  let groups = new Map<string, {ids: FeatureId[]; rhythm: TileflowLightRhythm}>();
  /** The state written to each feature; a feature without an entry shows steadily. */
  const written = new Map<FeatureId, Written>();
  let config: TileflowNauticalLights | undefined;
  let configStale = true;
  let dirty = true;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const prefersReducedMotion = () => reducedMotion?.matches === true;
  const hidden = () => document.visibilityState === 'hidden';

  function readConfig() {
    configStale = false;
    let metadata: unknown;
    try {
      metadata = map.getStyle()?.metadata;
    } catch {
      metadata = undefined;
    }
    const next = readTileflowNauticalLights(metadata);
    if (JSON.stringify(next) === JSON.stringify(config)) return;
    restoreAll();
    groups = new Map();
    config = next;
  }

  function sourceReady(): boolean {
    if (!config) return false;
    try {
      return map.getSource(config.source) !== undefined;
    } catch {
      return false;
    }
  }

  function target(id: FeatureId): FeatureTarget {
    return {id, source: config!.source, sourceLayer: config!.sourceLayer};
  }

  function restore(id: FeatureId) {
    written.delete(id);
    try {
      map.removeFeatureState(target(id), tileflowNauticalLightStates.intensity);
      map.removeFeatureState(target(id), tileflowNauticalLightStates.colour);
    } catch {
      // A style that is replacing its sources drops their state anyway.
    }
  }

  function restoreAll() {
    if (written.size === 0) return;
    if (!sourceReady()) {
      written.clear();
      return;
    }
    for (const id of [...written.keys()]) restore(id);
  }

  function cancelTimer() {
    if (timer !== undefined) browser!.clearTimeout(timer);
    timer = undefined;
  }

  function visibleLayers(): string[] {
    if (!config) return [];
    let zoom: number;
    try {
      zoom = map.getZoom();
    } catch {
      return [];
    }
    return config.layers.filter((id) => {
      try {
        const layer = map.getLayer(id);
        if (!layer || map.getLayoutProperty(id, 'visibility') === 'none') return false;
        if (typeof layer.minzoom === 'number' && zoom < layer.minzoom) return false;
        return !(typeof layer.maxzoom === 'number' && zoom >= layer.maxzoom);
      } catch {
        return false;
      }
    });
  }

  function rhythmOf(properties: Record<string, unknown>): TileflowLightRhythm | undefined {
    const signature = JSON.stringify([
      properties.sequence,
      properties.character,
      properties.group,
      properties.period_s,
      properties.color,
    ]);
    if (rhythms.has(signature)) return rhythms.get(signature);
    if (rhythms.size >= rhythmCacheSize) rhythms.clear();
    const rhythm = tileflowLightRhythm(properties);
    rhythms.set(signature, rhythm);
    return rhythm;
  }

  /** Collect the lights drawn now and group them by rhythm. */
  function scan() {
    if (disposed) return;
    if (configStale) readConfig();
    if (!config || prefersReducedMotion()) {
      stop();
      return;
    }
    if (hidden()) {
      cancelTimer();
      return;
    }
    dirty = false;
    const layers = visibleLayers();
    let features: ReturnType<TileflowNauticalLightsMap['queryRenderedFeatures']> = [];
    if (layers.length > 0 && sourceReady()) {
      try {
        features = map.queryRenderedFeatures({layers});
      } catch {
        features = [];
      }
    }
    const keys = new Map<FeatureId, string | null>();
    const next = new Map<string, {ids: FeatureId[]; rhythm: TileflowLightRhythm}>();
    for (const feature of features) {
      const id = feature.id;
      if (typeof id !== 'number' && typeof id !== 'string') continue;
      const rhythm = rhythmOf(feature.properties ?? {});
      const key = rhythm?.key ?? null;
      const known = keys.get(id);
      if (known === undefined) {
        keys.set(id, key);
        if (rhythm) {
          const group = next.get(rhythm.key) ?? {ids: [], rhythm};
          group.ids.push(id);
          next.set(rhythm.key, group);
        }
      } else if (known !== key) {
        // One ID with two rhythms cannot carry either; it stays steady.
        keys.set(id, null);
      }
    }
    for (const [key, group] of next) {
      group.ids = group.ids.filter((id) => keys.get(id) === key);
      if (group.ids.length === 0) next.delete(key);
    }
    // Lights that are no longer drawn return to steady, so none waits eclipsed out of view.
    for (const id of [...written.keys()]) if (!keys.get(id)) restore(id);
    groups = next;
    tick();
  }

  /** Write the phase of every drawn light whose phase changed, then wait for the next change. */
  function tick() {
    cancelTimer();
    if (disposed || !config || groups.size === 0 || prefersReducedMotion() || hidden()) return;
    if (!sourceReady()) return;
    const now = browser!.performance.now() / 1000 + coalesceSeconds;
    let next = Number.POSITIVE_INFINITY;
    for (const {ids, rhythm} of groups.values()) {
      const state = tileflowLightStateAt(rhythm, now);
      next = Math.min(next, state.remaining);
      for (const id of ids) {
        const last = written.get(id);
        if (last && last.intensity === state.intensity && last.colour === state.colour) continue;
        try {
          map.setFeatureState(target(id), {
            [tileflowNauticalLightStates.colour]: state.colour,
            [tileflowNauticalLightStates.intensity]: state.intensity,
          });
          written.set(id, {colour: state.colour, intensity: state.intensity});
        } catch {
          // The style is not loaded; the next scan writes the phase again.
          dirty = true;
          return;
        }
      }
    }
    timer = browser!.setTimeout(tick, Math.max(minimumIntervalMs, Math.round(next * 1000)));
  }

  /** Stop the loop and return every light to steady. */
  function stop() {
    cancelTimer();
    restoreAll();
    groups = new Map();
  }

  const onStyleLoad = () => {
    // A new style brings new sources without the state written to the old ones.
    cancelTimer();
    written.clear();
    groups = new Map();
    configStale = true;
    dirty = true;
  };
  const onStyleData = () => {
    configStale = true;
    dirty = true;
  };
  const onMoveEnd = () => {
    dirty = true;
  };
  const onSourceData = (event?: {sourceId?: unknown}) => {
    if (!config || event?.sourceId === config.source) dirty = true;
  };
  const onIdle = () => {
    if (dirty || configStale) scan();
  };
  const onMotionChange = () => {
    if (prefersReducedMotion()) stop();
    else scan();
  };
  const onVisibilityChange = () => {
    if (hidden()) cancelTimer();
    else if (dirty || configStale) scan();
    else tick();
  };

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    map.off('idle', onIdle);
    map.off('moveend', onMoveEnd);
    map.off('remove', dispose);
    map.off('sourcedata', onSourceData);
    map.off('style.load', onStyleLoad);
    map.off('styledata', onStyleData);
    reducedMotion?.removeEventListener?.('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  map.on('idle', onIdle);
  map.on('moveend', onMoveEnd);
  map.on('remove', dispose);
  map.on('sourcedata', onSourceData);
  map.on('style.load', onStyleLoad);
  map.on('styledata', onStyleData);
  reducedMotion?.addEventListener?.('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  scan();
  return dispose;
}
