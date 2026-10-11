/** Inputs to one fixed-size, application-owned RGBA image. */
export type TileflowDynamicImageContext = Readonly<{
  theme: string;
  blend?: Readonly<{position: number; themes: readonly string[]}>;
  states: Readonly<Record<string, boolean | number | string | null | undefined>>;
  /** Physical pixel dimensions, fixed for this registration. */
  width: number;
  height: number;
  pixelRatio: number;
}>;

export type TileflowDynamicImage = Readonly<{
  /** Physical pixel dimensions, each from 1 through 2048. */
  width: number;
  height: number;
  /** Physical pixels per logical pixel. Defaults to 1; fixed until disposal. */
  pixelRatio?: number;
  /** Controller states that invalidate this image, including interpolated values. */
  states?: readonly string[];
  /** Synchronous RGBA pixels; undefined keeps the previous pixels (initially transparent). */
  render(context: TileflowDynamicImageContext): Uint8Array | Uint8ClampedArray | undefined;
  /** Later render/restore failures retain good pixels. Defaults to console.error. */
  onError?(error: Error): void;
}>;

export type TileflowDynamicImageHandle = {
  /** Refresh external inputs at the next frame. Repeated requests coalesce. */
  refresh(): void;
  /** Cancel queued work, release the name and remove only this resource's image. */
  dispose(): void;
};

export type TileflowDynamicImageMap = {
  addImage?: unknown;
  getCanvas?: unknown;
  getImage?: unknown;
  getStyle?: unknown;
  removeImage?: unknown;
  updateImage?: unknown;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};

type Pixels = {width: number; height: number; data: Uint8Array};
type ImageMap = TileflowDynamicImageMap & {
  addImage(name: string, pixels: Pixels, options: {pixelRatio: number}): unknown;
  getImage(name: string): unknown;
  getStyle(): unknown;
  removeImage(name: string): unknown;
  updateImage(name: string, pixels: Pixels): unknown;
};
type Context = Omit<TileflowDynamicImageContext, 'width' | 'height' | 'pixelRatio'>;
type Entry = {
  name: string;
  definition: TileflowDynamicImage;
  pixelRatio: number;
  pixels: Pixels;
  installed?: unknown;
  recoveryImage?: unknown;
  key: string;
  dirty: boolean;
};

// A second controller must not claim the same ID, even before the first style loads.
const owners = new WeakMap<object, Set<string>>();

// MapLibre clones image records when restoring WebGL. Accept only an exact copy of our last
// installed pixels and metadata, and only while recovering that resource.
function isRestoredCopy(image: unknown, previous: unknown): boolean {
  if (!image || !previous) return false;
  type Image = {
    data?: Pixels;
    pixelRatio?: number;
    sdf?: boolean;
    content?: unknown;
    stretchX?: unknown;
    stretchY?: unknown;
  };
  const a = image as Image,
    b = previous as Image;
  if (
    !a.data ||
    !b.data ||
    a.data.width !== b.data.width ||
    a.data.height !== b.data.height ||
    a.pixelRatio !== b.pixelRatio ||
    a.sdf !== b.sdf ||
    a.content !== b.content ||
    a.stretchX !== b.stretchX ||
    a.stretchY !== b.stretchY ||
    a.data.data.length !== b.data.data.length
  )
    return false;
  return a.data.data.every((byte, index) => byte === b.data!.data[index]);
}

/** Browser-only resource lifecycle below the theme controller; never changes map layers. */
export function createTileflowDynamicImageRegistry(
  input: TileflowDynamicImageMap,
  context: () => Context,
  beforeRestore: () => void,
) {
  for (const method of [
    'addImage',
    'getImage',
    'getStyle',
    'removeImage',
    'updateImage',
  ] as const) {
    if (typeof input[method] !== 'function') {
      throw new TypeError(`Dynamic images require a map with ${method}().`);
    }
  }

  const map = input as ImageMap;
  const names = owners.get(map) ?? new Set<string>();
  owners.set(map, names);
  const entries = new Map<string, Entry>();
  const view =
    typeof map.getCanvas === 'function'
      ? (map.getCanvas as () => HTMLCanvasElement)().ownerDocument?.defaultView
      : undefined;
  let cancelFrame: (() => void) | undefined;
  let disposed = false;
  let suspended = false;

  const imageContext = (entry: Entry, current: Context): TileflowDynamicImageContext =>
    Object.freeze({
      ...current,
      width: entry.pixels.width,
      height: entry.pixels.height,
      pixelRatio: entry.pixelRatio,
    });
  const keyOf = (entry: Entry, current: Context) =>
    JSON.stringify([
      current.theme,
      current.blend,
      (entry.definition.states ?? []).map((name) => [
        name,
        typeof current.states[name],
        current.states[name],
      ]),
    ]);
  const report = (entry: Entry, cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (entry.definition.onError) entry.definition.onError(error);
    else console.error(`Tileflow dynamic image "${entry.name}":`, error);
  };

  function render(entry: Entry, current: Context): boolean {
    const output = entry.definition.render(imageContext(entry, current));
    if (output === undefined) return false;
    if (
      !(output instanceof Uint8Array || output instanceof Uint8ClampedArray) ||
      output.byteLength !== entry.pixels.width * entry.pixels.height * 4
    ) {
      throw new TypeError(
        `Dynamic image "${entry.name}" must return width × height × 4 RGBA bytes.`,
      );
    }
    entry.pixels = {...entry.pixels, data: Uint8Array.from(output)};
    return true;
  }

  function install(entry: Entry, changed = false): void {
    if (suspended) return;
    const existing = map.getImage(entry.name);
    // getStyle() serializes the complete map. Only a missing image needs that readiness check.
    if (!existing && !map.getStyle()) return;
    if (
      existing &&
      existing !== entry.installed &&
      !isRestoredCopy(existing, entry.recoveryImage)
    ) {
      throw new Error(`Dynamic image "${entry.name}" conflicts with an existing image owner.`);
    }
    if (!existing) map.addImage(entry.name, entry.pixels, {pixelRatio: entry.pixelRatio});
    else if (changed) map.updateImage(entry.name, entry.pixels);
    entry.installed = map.getImage(entry.name);
    entry.recoveryImage = undefined;
  }

  function flush(): void {
    cancelFrame = undefined;
    if (disposed || suspended) return;
    const current = context();
    for (const entry of entries.values()) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      entry.key = keyOf(entry, current);
      try {
        const changed = render(entry, current);
        install(entry, changed);
      } catch (error) {
        report(entry, error);
      }
    }
  }

  function schedule(): void {
    if (cancelFrame || disposed || suspended) return;
    if (view?.requestAnimationFrame) {
      const id = view.requestAnimationFrame(flush);
      cancelFrame = () => view.cancelAnimationFrame(id);
    } else {
      let cancelled = false;
      cancelFrame = () => {
        cancelled = true;
      };
      queueMicrotask(() => {
        if (!cancelled) flush();
      });
    }
  }

  function restore(): void {
    if (disposed || suspended) return;
    beforeRestore();
    for (const entry of entries.values()) {
      try {
        install(entry, true);
      } catch (error) {
        report(entry, error);
      }
    }
    if ([...entries.values()].some((entry) => entry.dirty)) schedule();
  }

  function loseContext(): void {
    suspended = true;
    for (const entry of entries.values()) entry.recoveryImage = entry.installed;
    cancelFrame?.();
    cancelFrame = undefined;
  }

  function restoreContext(): void {
    suspended = false;
    restore();
  }

  function release(entry: Entry, remove: boolean): void {
    if (entries.get(entry.name) !== entry) return;
    entries.delete(entry.name);
    names.delete(entry.name);
    if (remove && entry.installed && map.getImage(entry.name) === entry.installed) {
      map.removeImage(entry.name);
    }
    if (!entries.size) {
      cancelFrame?.();
      cancelFrame = undefined;
    }
  }

  function dispose(remove = true): void {
    if (disposed) return;
    disposed = true;
    cancelFrame?.();
    cancelFrame = undefined;
    for (const entry of [...entries.values()]) release(entry, remove);
    map.off('style.load', restore);
    map.off('webglcontextlost', loseContext);
    map.off('webglcontextrestored', restoreContext);
    map.off('remove', removed);
  }

  const removed = () => dispose(false);
  map.on('style.load', restore);
  map.on('webglcontextlost', loseContext);
  map.on('webglcontextrestored', restoreContext);
  map.on('remove', removed);

  return {
    dispose,
    assertBlend(images: readonly {names: readonly string[]}[]) {
      for (const image of images) {
        if (image.names.some((name) => entries.has(name))) {
          throw new TypeError('Dynamic image names must remain identical across blended themes.');
        }
      }
    },
    invalidate(state?: string) {
      if (disposed) return;
      const current = context();
      for (const entry of entries.values()) {
        if (state !== undefined && !entry.definition.states?.includes(state)) continue;
        if (keyOf(entry, current) === entry.key) continue;
        entry.dirty = true;
      }
      if ([...entries.values()].some((entry) => entry.dirty)) schedule();
    },
    register(name: string, definition: TileflowDynamicImage): TileflowDynamicImageHandle {
      if (disposed) throw new Error('Dynamic image registry is disposed.');
      if (typeof name !== 'string' || !name.trim())
        throw new TypeError('Dynamic image names must be non-empty.');
      if (names.has(name))
        throw new Error(`Dynamic image "${name}" already has a registered owner.`);
      if (map.getImage(name)) throw new Error(`Dynamic image "${name}" already exists.`);
      const {width, height, pixelRatio = 1} = definition;
      if (
        ![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 2048) ||
        !Number.isFinite(pixelRatio) ||
        pixelRatio <= 0 ||
        typeof definition.render !== 'function' ||
        (definition.states !== undefined &&
          (!Array.isArray(definition.states) ||
            definition.states.some(
              (state) => typeof state !== 'string' || !state.trim() || state !== state.trim(),
            )))
      ) {
        throw new TypeError(
          'Dynamic images require fixed dimensions, a positive pixel ratio, valid state names and a render function.',
        );
      }
      const entry: Entry = {
        name,
        definition: {...definition, states: definition.states?.slice()},
        pixelRatio,
        pixels: {width, height, data: new Uint8Array(width * height * 4)},
        dirty: false,
        key: '',
      };
      names.add(name);
      try {
        const current = context();
        entry.key = keyOf(entry, current);
        render(entry, current);
        install(entry);
        entries.set(name, entry);
      } catch (error) {
        names.delete(name);
        throw error;
      }
      return {
        refresh() {
          if (disposed || entries.get(name) !== entry) return;
          entry.dirty = true;
          schedule();
        },
        dispose() {
          release(entry, !disposed);
        },
      };
    },
  };
}
