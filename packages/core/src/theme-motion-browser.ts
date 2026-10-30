import {
  fillTileflowThemeBlendTemplate,
  readsTileflowFeatureData,
  type TileflowThemeBlendImage,
  type TileflowThemeBlendPaint,
  type TileflowThemeBlendPlan,
} from './theme-blend';

/**
 * Browser helpers for theme transitions and blends. They use only methods that MapLibre GL JS maps
 * provide and check each one at runtime, so a map without them falls back to an immediate change.
 */
export type TileflowThemeMotionMap = {
  areTilesLoaded?: unknown;
  getCanvas?: unknown;
  getImage?: unknown;
  getLayer?: unknown;
  getStyle?: unknown;
  isStyleLoaded?: unknown;
  off(event: string, listener: (event?: unknown) => void): unknown;
  on(event: string, listener: (event?: unknown) => void): unknown;
  project?: unknown;
  redraw?: unknown;
  setLayoutProperty?: unknown;
  setLight?: unknown;
  setPaintProperty?: unknown;
  setSky?: unknown;
  unproject?: unknown;
  updateImage?: unknown;
};

type CrossfadeMap = {
  areTilesLoaded(): boolean;
  getCanvas(): HTMLCanvasElement;
  isStyleLoaded(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  redraw(): unknown;
};

/** A cover over the map while its style changes; see `beginTileflowStyleCrossfade`. */
export type TileflowStyleCrossfade = {
  /** Removes the cover at once. */
  cancel(): void;
  /**
   * Waits until the map has drawn its new style, then fades the cover out. `stop` ends the wait
   * early and removes the cover, for a change that a newer one replaced.
   */
  finish(options?: {stop?: () => boolean}): Promise<void>;
};

const settleFrames = 3;
const settleTimeoutMs = 10_000;

/**
 * Covers the map with a snapshot of its current frame, before the caller changes the style. The
 * cover stays in the viewport and is removed when the camera moves. A frame contains curved
 * surfaces, 3D geometry and screen-aligned labels; it cannot be warped as a ground plane.
 * Returns undefined when the map or browser
 * cannot take the snapshot, or when `duration` is 0; the caller then changes the style directly.
 */
export function beginTileflowStyleCrossfade(
  input: TileflowThemeMotionMap,
  duration: number,
): TileflowStyleCrossfade | undefined {
  if (duration <= 0 || !isCrossfadeMap(input)) return undefined;
  const map = input;
  const canvas = map.getCanvas();
  const document = canvas.ownerDocument;
  const view = document?.defaultView;
  if (!view || prefersReducedMotion(view)) return undefined;

  let snapshot: HTMLCanvasElement;
  try {
    // A WebGL canvas keeps its drawing buffer until the browser composites the frame, so a copy
    // taken right after a synchronous redraw holds the current picture.
    map.redraw();
    snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const context = snapshot.getContext('2d');
    if (!context) return undefined;
    context.drawImage(canvas, 0, 0);
  } catch {
    return undefined;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  Object.assign(snapshot.style, {
    height: `${height}px`,
    left: '0',
    pointerEvents: 'none',
    position: 'absolute',
    top: '0',
    transformOrigin: '0 0',
    width: `${width}px`,
  });
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.dataset.tileflowThemeCrossfade = '';
  canvas.after(snapshot);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    map.off('move', remove);
    snapshot.remove();
  };
  map.on('move', remove);
  const frame = (callback: () => void) => {
    if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(callback);
    else view.setTimeout(callback, 16);
  };

  return {
    cancel: remove,
    finish(options = {}) {
      return new Promise((resolve) => {
        const started = view.performance?.now?.() ?? Date.now();
        let settled = 0;
        const check = () => {
          if (removed) return resolve();
          if (options.stop?.()) {
            remove();
            return resolve();
          }
          const now = view.performance?.now?.() ?? Date.now();
          settled = map.isStyleLoaded() && map.areTilesLoaded() ? settled + 1 : 0;
          if (settled < settleFrames && now - started < settleTimeoutMs) {
            frame(check);
            return;
          }
          snapshot.style.transition = `opacity ${duration}ms ease`;
          snapshot.style.opacity = '0';
          view.setTimeout(() => {
            remove();
            resolve();
          }, duration + 20);
        };
        frame(() => frame(check));
      });
    },
  };
}

/** Drives a map whose style came from `plan.styleAt`, moving it to other blend positions. */
export type TileflowThemeBlender = {
  /** The value the blend last set for a paint property, before any transform; undefined if none. */
  baseValue(layer: string, property: string): unknown;
  dispose(): void;
  readonly dominant: number;
  /** Whether changes that make MapLibre lay tiles out again are waiting (see `set`). */
  readonly held: boolean;
  readonly position: number;
  /**
   * Positions where the nearest theme changes over values that make MapLibre lay tiles out
   * again: layout values, values that read feature data or state, patterns, and icon names or
   * artwork that differ between the two themes.
   */
  readonly relayoutAt: readonly number[];
  /** Writes the blended values again through the transform, only those `include` selects. */
  refresh(include: (layer: string, property: string) => boolean): void;
  /**
   * Moves the blend. With `hold`, what would make MapLibre lay tiles out again waits: the change of
   * nearest theme and mixed pattern artwork. Colours, numbers, the sky, and light still follow the
   * position. A later call without `hold` brings what waited in at once.
   */
  set(position: number, options?: {hold?: boolean}): void;
};

/** A change applied to each paint value a blend writes, such as an emphasis. */
export type TileflowThemeBlendTransform = (
  layer: string,
  property: string,
  value: unknown,
) => unknown;

type BlendMap = {
  getImage(name: string): {data?: {data: ArrayLike<number>; height: number; width: number}} | null;
  setLayoutProperty(layer: string, name: string, value: unknown, options?: object): unknown;
  setLight?(light: unknown, options?: object): unknown;
  setPaintProperty(layer: string, name: string, value: unknown, options?: object): unknown;
  setSky?(sky: unknown, options?: object): unknown;
  updateImage(name: string, image: {data: Uint8Array; height: number; width: number}): unknown;
};

/** Whether a map has everything a blend needs. */
export function canBlendTileflowThemes(map: TileflowThemeMotionMap): boolean {
  return (
    typeof map.setPaintProperty === 'function' &&
    typeof map.setLayoutProperty === 'function' &&
    typeof map.getImage === 'function' &&
    typeof map.updateImage === 'function'
  );
}

/**
 * Starts a blender for a map showing `plan.styleAt(position)`. Ground values follow every
 * `set()`; labels, icons, and switches change when the nearest theme changes, labels and icons
 * through a cross-fade of `labelFadeMs`. `cover` may wrap a switch that re-lays the source out.
 */
export function createTileflowThemeBlender(
  input: TileflowThemeMotionMap,
  plan: TileflowThemeBlendPlan,
  options: {
    cover?: (change: () => void) => void;
    labelFadeMs: number;
    /** Called after ground values have followed a new position. */
    onPosition?: () => void;
    position: number;
    transform?: TileflowThemeBlendTransform;
  },
): TileflowThemeBlender {
  if (!canBlendTileflowThemes(input)) {
    throw new TypeError('Tileflow theme blends require a MapLibre GL JS map.');
  }
  const map = input as unknown as BlendMap;
  const clamp = (value: number) =>
    Math.min(plan.themes - 1, Math.max(0, Number.isFinite(value) ? value : 0));
  const view = viewOf(input);
  const positionPaints = plan.paints.filter((paint) => paint.follows === 'position');
  const dominantPaints = plan.paints.filter((paint) => paint.follows === 'dominant');
  const pixels = createImageMixer(map, plan.images);
  const mixesArtwork = plan.images.some((image) => image.follows === 'position');
  const relayoutAt = relayoutPositions(plan);
  const shownValues = new Map<TileflowThemeBlendPaint, string>();
  const baseValues = new Map<string, unknown>();
  const valueKey = (layer: string, property: string) => `${layer}\u0000${property}`;
  const transformed = (layer: string, property: string, value: unknown) =>
    options.transform ? options.transform(layer, property, value) : value;
  let position = clamp(options.position);
  let dominant = Math.round(position);
  let label = dominant;
  let fade: {from: number; start: number; to: number} | undefined;
  let frameRequest: number | undefined;
  let disposed = false;
  let holding = false;
  let artworkWaits = false;

  // The style already shows the starting position; only images must be painted.
  pixels.paint('position', position);
  pixels.paint('dominant', label);

  const drive = (paints: readonly TileflowThemeBlendPaint[], at: number) => {
    for (const paint of paints) {
      const base = fillTileflowThemeBlendTemplate(paint.template, at);
      baseValues.set(valueKey(paint.layer, paint.property), base);
      const value = transformed(paint.layer, paint.property, base);
      const key = JSON.stringify(value);
      if (shownValues.get(paint) === key) continue;
      shownValues.set(paint, key);
      map.setPaintProperty(paint.layer, paint.property, value, {validate: false});
    }
  };
  const now = () => view?.performance?.now?.() ?? Date.now();
  const step = () => {
    frameRequest = undefined;
    if (disposed || !fade) return;
    // Without a browser window there is no frame to animate on, so the fade completes at once.
    const t =
      options.labelFadeMs <= 0 || !view
        ? 1
        : Math.min(1, (now() - fade.start) / options.labelFadeMs);
    label = fade.from + (fade.to - fade.from) * t * t * (3 - 2 * t);
    drive(dominantPaints, label);
    pixels.paint('dominant', label);
    if (t >= 1) fade = undefined;
    else schedule();
  };
  const schedule = () => {
    if (frameRequest !== undefined || !view) return;
    frameRequest =
      typeof view.requestAnimationFrame === 'function'
        ? view.requestAnimationFrame(step)
        : view.setTimeout(step, 16);
  };
  const applySwitches = (theme: number) => {
    for (const entry of plan.switches) {
      const value = entry.values[theme];
      if (entry.group === 'paint') {
        baseValues.set(valueKey(entry.layer, entry.property), value);
        map.setPaintProperty(
          entry.layer,
          entry.property,
          transformed(entry.layer, entry.property, value),
          {validate: false},
        );
      } else map.setLayoutProperty(entry.layer, entry.property, value, {validate: false});
    }
  };
  const switchedPaints = plan.switches.filter((entry) => entry.group === 'paint');

  return {
    baseValue(layer, property) {
      return baseValues.get(valueKey(layer, property));
    },
    get dominant() {
      return dominant;
    },
    get held() {
      return holding && (artworkWaits || Math.round(position) !== dominant);
    },
    get position() {
      return position;
    },
    relayoutAt,
    refresh(include) {
      if (disposed) return;
      drive(
        positionPaints.filter((paint) => include(paint.layer, paint.property)),
        position,
      );
      drive(
        dominantPaints.filter((paint) => include(paint.layer, paint.property)),
        label,
      );
      for (const entry of switchedPaints) {
        if (!include(entry.layer, entry.property)) continue;
        const value = entry.values[dominant];
        map.setPaintProperty(
          entry.layer,
          entry.property,
          transformed(entry.layer, entry.property, value),
          {validate: false},
        );
      }
    },
    dispose() {
      disposed = true;
      if (frameRequest !== undefined && view) {
        if (typeof view.cancelAnimationFrame === 'function')
          view.cancelAnimationFrame(frameRequest);
        view.clearTimeout(frameRequest);
      }
      frameRequest = undefined;
    },
    set(next, setOptions) {
      if (disposed) return;
      const hold = setOptions?.hold === true;
      if (hold) holding = true;
      const target = clamp(next);
      // A four-hundredth of a theme is below what the eye sees; skipping it lets a slowly moving
      // blend leave the map at rest between changes. Whole themes are always reached exactly.
      const reachesTheme = target % 1 === 0 && target !== position;
      if (Math.abs(target - position) >= 0.0025 || reachesTheme) {
        position = target;
        drive(positionPaints, position);
        // Mixed artwork makes MapLibre lay out the tiles that use it, so it waits while held.
        if (holding) artworkWaits ||= mixesArtwork;
        else pixels.paint('position', position);
        if (plan.sky !== undefined && typeof map.setSky === 'function')
          map.setSky(fillTileflowThemeBlendTemplate(plan.sky, position), {validate: false});
        if (plan.light !== undefined && typeof map.setLight === 'function')
          map.setLight(fillTileflowThemeBlendTemplate(plan.light, position), {validate: false});
        options.onPosition?.();
      }
      if (!hold && holding) {
        holding = false;
        if (artworkWaits) pixels.paint('position', position);
        artworkWaits = false;
      }
      // While held, the map keeps the nearest theme it shows; the change comes on release.
      const nextDominant = Math.round(target);
      if (nextDominant === dominant || holding) return;
      dominant = nextDominant;
      if (plan.switches.length > 0) {
        const change = () => applySwitches(nextDominant);
        if (options.cover) options.cover(change);
        else change();
      }
      fade = {from: label, start: now(), to: nextDominant};
      if (options.labelFadeMs <= 0 || !view) step();
      else schedule();
    },
  };
}

/**
 * Mixes theme artworks in the pixels of the first theme's images. Originals are copied before the
 * first change; a mix is uploaded only when it moves by a thirty-second of a theme, and only when
 * what the image shows changes: two themes that share an artwork, by name or pixel for pixel,
 * upload nothing between them, since each upload makes MapLibre lay out every tile that uses the
 * image. Images not yet available are painted when a later call finds them.
 */
function createImageMixer(map: BlendMap, images: readonly TileflowThemeBlendImage[]) {
  type Art = {data: Uint8Array; height: number; width: number};
  const art = new Map<string, Art>();
  // What each image shows: an original artwork, or the key of a mix.
  const shown = new Map<TileflowThemeBlendImage, Art | string>();
  const unusable = new Set<TileflowThemeBlendImage>();
  const names = new Map<Art, string>();
  const alike = new Map<string, boolean>();
  const artOf = (name: string) => {
    if (!art.has(name)) {
      const image = map.getImage(name)?.data;
      if (!image) return undefined;
      const copy = {data: Uint8Array.from(image.data), height: image.height, width: image.width};
      art.set(name, copy);
      names.set(copy, name);
    }
    return art.get(name);
  };
  /** Whether two artworks hold the same pixels; compared once per pair of names. */
  const same = (from: Art, to: Art) => {
    if (from === to) return true;
    const key = `${names.get(from)}\u0000${names.get(to)}`;
    if (!alike.has(key)) {
      let equal = from.data.length === to.data.length;
      for (let byte = 0; equal && byte < from.data.length; byte += 1)
        equal = from.data[byte] === to.data[byte];
      alike.set(key, equal);
    }
    return alike.get(key)!;
  };
  return {
    paint(follows: 'dominant' | 'position', position: number) {
      const quantized = Math.round(position * 32) / 32;
      for (const image of images) {
        if (image.follows !== follows || unusable.has(image)) continue;
        const sources = image.names.map(artOf);
        if (sources.some((source) => !source)) continue;
        const [first] = sources as [Art];
        if (
          sources.some((source) => source!.width !== first.width || source!.height !== first.height)
        ) {
          unusable.add(image);
          continue;
        }
        // The map starts with the first theme's artwork under the first name.
        if (!shown.has(image)) shown.set(image, first);
        const index = Math.min(sources.length - 2, Math.floor(quantized));
        const t = quantized - index;
        const from = sources[index]!;
        const to = sources[index + 1]!;
        let content: Art | string = from;
        if (t >= 1) content = to;
        else if (t > 0 && !same(from, to)) content = `${index}:${t}`;
        const before = shown.get(image)!;
        if (
          before === content ||
          (typeof before !== 'string' && typeof content !== 'string' && same(before, content))
        )
          continue;
        shown.set(image, content);
        let data: Uint8Array;
        if (typeof content !== 'string') data = content.data;
        else {
          data = new Uint8Array(from.data.length);
          for (let byte = 0; byte < data.length; byte += 1)
            data[byte] = from.data[byte]! + (to.data[byte]! - from.data[byte]!) * t;
        }
        map.updateImage(image.names[0]!, {data, height: from.height, width: from.width});
      }
    },
  };
}

/**
 * Positions where the nearest theme changes over values that make MapLibre lay tiles out again.
 * Artwork is compared by name: two names that hold the same pixels are reported, though the
 * mixer uploads nothing for them.
 */
function relayoutPositions(plan: TileflowThemeBlendPlan): number[] {
  const positions: number[] = [];
  const relays = (entry: TileflowThemeBlendPlan['switches'][number]) =>
    entry.group === 'layout' ||
    entry.property.endsWith('-pattern') ||
    entry.values.some(readsTileflowFeatureData);
  for (let index = 0; index + 1 < plan.themes; index += 1) {
    const switched = plan.switches.some(
      (entry) =>
        relays(entry) &&
        JSON.stringify(entry.values[index]) !== JSON.stringify(entry.values[index + 1]),
    );
    const icons = plan.images.some(
      (image) => image.follows === 'dominant' && image.names[index] !== image.names[index + 1],
    );
    if (switched || icons) positions.push(index + 0.5);
  }
  return positions;
}

function isCrossfadeMap(map: TileflowThemeMotionMap): map is TileflowThemeMotionMap & CrossfadeMap {
  return (
    typeof map.getCanvas === 'function' &&
    typeof map.redraw === 'function' &&
    typeof map.isStyleLoaded === 'function' &&
    typeof map.areTilesLoaded === 'function'
  );
}

function viewOf(map: TileflowThemeMotionMap): (Window & typeof globalThis) | undefined {
  if (typeof map.getCanvas !== 'function') return undefined;
  try {
    return (map.getCanvas as () => HTMLCanvasElement)().ownerDocument?.defaultView ?? undefined;
  } catch {
    return undefined;
  }
}

/** Whether the person viewing the map asked for reduced motion. */
export function prefersReducedMotion(view: {
  matchMedia?: (query: string) => {matches: boolean};
}): boolean {
  try {
    return view.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** The browser window of a map, when it has one. */
export function tileflowThemeMotionView(map: TileflowThemeMotionMap) {
  return viewOf(map);
}
