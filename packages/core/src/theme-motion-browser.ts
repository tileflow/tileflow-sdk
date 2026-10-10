import {
  fillTileflowThemeBlendTemplate,
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

type Point = {x: number; y: number};
type CrossfadeMap = {
  areTilesLoaded(): boolean;
  getCanvas(): HTMLCanvasElement;
  isStyleLoaded(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  project(lngLat: unknown): Point;
  redraw(): unknown;
  unproject(point: [number, number]): unknown;
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
 * snapshot follows the camera with the projective transform of the ground plane, so it stays in
 * place while someone pans, zooms, rotates, or tilts. Returns undefined when the map or browser
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

  // Four points on the ground, below the horizon at any supported pitch.
  const corners: [number, number][] = [
    [width * 0.1, height * 0.45],
    [width * 0.9, height * 0.45],
    [width * 0.9, height * 0.9],
    [width * 0.1, height * 0.9],
  ];
  const anchors = corners.map((corner) => map.unproject(corner));
  const follow = () => {
    const to = anchors.map((anchor) => map.project(anchor));
    if (to.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
    const matrix = homography(
      corners,
      to.map((point) => [point.x, point.y]),
    );
    if (matrix) snapshot.style.transform = matrix3d(matrix);
  };
  map.on('move', follow);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    map.off('move', follow);
    snapshot.remove();
  };
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
  dispose(): void;
  readonly dominant: number;
  readonly position: number;
  set(position: number): void;
};

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
    position: number;
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
  const shownValues = new Map<TileflowThemeBlendPaint, string>();
  let position = clamp(options.position);
  let dominant = Math.round(position);
  let label = dominant;
  let fade: {from: number; start: number; to: number} | undefined;
  let frameRequest: number | undefined;
  let disposed = false;

  // The style already shows the starting position; only images must be painted.
  pixels.paint('position', position);
  pixels.paint('dominant', label);

  const drive = (paints: readonly TileflowThemeBlendPaint[], at: number) => {
    for (const paint of paints) {
      const value = fillTileflowThemeBlendTemplate(paint.template, at);
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
      if (entry.group === 'paint')
        map.setPaintProperty(entry.layer, entry.property, value, {validate: false});
      else map.setLayoutProperty(entry.layer, entry.property, value, {validate: false});
    }
  };

  return {
    get dominant() {
      return dominant;
    },
    get position() {
      return position;
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
    set(next) {
      if (disposed) return;
      const target = clamp(next);
      // A four-hundredth of a theme is below what the eye sees; skipping it lets a slowly moving
      // blend leave the map at rest between changes. Whole themes are always reached exactly.
      const reachesTheme = target % 1 === 0 && target !== position;
      if (Math.abs(target - position) >= 0.0025 || reachesTheme) {
        position = target;
        drive(positionPaints, position);
        pixels.paint('position', position);
        if (plan.sky !== undefined && typeof map.setSky === 'function')
          map.setSky(fillTileflowThemeBlendTemplate(plan.sky, position), {validate: false});
        if (plan.light !== undefined && typeof map.setLight === 'function')
          map.setLight(fillTileflowThemeBlendTemplate(plan.light, position), {validate: false});
      }
      const nextDominant = Math.round(target);
      if (nextDominant === dominant) return;
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
 * first change; a mix is uploaded only when it moves by a thirty-second of a theme. Images not yet
 * available are painted when a later call finds them.
 */
function createImageMixer(map: BlendMap, images: readonly TileflowThemeBlendImage[]) {
  const art = new Map<string, {data: Uint8Array; height: number; width: number}>();
  const shown = new Map<TileflowThemeBlendImage, number>();
  const unusable = new Set<TileflowThemeBlendImage>();
  const artOf = (name: string) => {
    if (!art.has(name)) {
      const image = map.getImage(name)?.data;
      if (!image) return undefined;
      art.set(name, {data: Uint8Array.from(image.data), height: image.height, width: image.width});
    }
    return art.get(name);
  };
  return {
    paint(follows: 'dominant' | 'position', position: number) {
      const quantized = Math.round(position * 32) / 32;
      for (const image of images) {
        if (image.follows !== follows || unusable.has(image) || shown.get(image) === quantized)
          continue;
        const sources = image.names.map(artOf);
        if (sources.some((source) => !source)) continue;
        const [first] = sources as [NonNullable<(typeof sources)[number]>];
        if (
          sources.some((source) => source!.width !== first.width || source!.height !== first.height)
        ) {
          unusable.add(image);
          continue;
        }
        shown.set(image, quantized);
        const index = Math.min(sources.length - 2, Math.floor(quantized));
        const t = quantized - index;
        const from = sources[index]!;
        const to = sources[index + 1]!;
        let data = from.data;
        if (t >= 1) data = to.data;
        else if (t > 0 && from !== to) {
          data = new Uint8Array(from.data.length);
          for (let byte = 0; byte < data.length; byte += 1)
            data[byte] = from.data[byte]! + (to.data[byte]! - from.data[byte]!) * t;
        }
        map.updateImage(image.names[0]!, {data, height: from.height, width: from.width});
      }
    },
  };
}

function isCrossfadeMap(map: TileflowThemeMotionMap): map is TileflowThemeMotionMap & CrossfadeMap {
  return (
    typeof map.getCanvas === 'function' &&
    typeof map.redraw === 'function' &&
    typeof map.project === 'function' &&
    typeof map.unproject === 'function' &&
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

/** The projective transform taking four points to four points, or undefined if degenerate. */
export function homography(
  from: readonly (readonly [number, number])[],
  to: readonly (readonly [number, number])[],
): number[] | undefined {
  const rows: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = from[index]!;
    const [u, v] = to[index]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (Math.abs(rows[pivot]![column]!) < 1e-12) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = rows[row]![column]! / rows[column]![column]!;
      for (let k = column; k <= 8; k += 1) rows[row]![k]! -= factor * rows[column]![k]!;
    }
  }
  return [...rows.map((row, index) => row[8]! / row[index]!), 1];
}

/** A homography as a CSS matrix3d, for transform-origin 0 0. */
function matrix3d(matrix: number[]): string {
  // Ten significant digits keep perspective terms exact enough and drop floating-point noise.
  const [a, b, c, d, e, f, g, h, i] = matrix.map((value) =>
    Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(10)),
  );
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,${i})`;
}
