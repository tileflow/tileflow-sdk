import type {TileflowCameraOptions} from './camera';

/** Public camera capabilities; renderers without a field-of-view setter keep their own lens. */
export type TileflowAdaptiveCameraMap = {
  getPitch(): number;
  getZoom(): number;
  getMaxPitch?(): number;
  setMaxPitch?(degrees: number): unknown;
  getCanvas?(): {clientHeight: number};
  getVerticalFieldOfView?(): number;
  setVerticalFieldOfView?(degrees: number): unknown;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};

/** Finite-lens approximation: ordinary perspective from pitch 15° and at zoom 13 or lower. */
export function tileflowAdaptiveFieldOfView(
  pitch: number,
  zoom: number,
  height: number,
  normalFieldOfView: number,
): number {
  if (pitch >= 15 || zoom <= 13 || height <= 0) return normalFieldOfView;
  const tangent = Math.tan((normalFieldOfView * Math.PI) / 360);
  const distance = height / (2 * tangent);
  const mix = (Math.max(0, pitch) / 15) ** 5;
  // Equivalent focal length of a low-pitch orthographic/perspective blend. A finite 6° floor
  // preserves depth precision for nearby roofs while retaining the renderer's projection.
  const nearTangent = Math.max(
    Math.tan((Math.min(6, normalFieldOfView) * Math.PI) / 360),
    (height * mix) / (2 * (1 - mix + mix * distance)),
  );
  const t = Math.min(1, Math.max(0, (zoom - 13) / 2));
  const amount = t * t * (3 - 2 * t);
  return (Math.atan(tangent + (nearTangent - tangent) * amount) * 360) / Math.PI;
}

/** Owns only the lens while enabled, restoring the captured lens when disabled or disposed. */
export function createTileflowAdaptiveCamera(map: TileflowAdaptiveCameraMap) {
  let normal: number | undefined;
  let applying = false;
  let disposed = false;
  const write = (next: number) => {
    if (applying || Math.abs((map.getVerticalFieldOfView?.() ?? next) - next) < 1e-6) return;
    applying = true;
    try {
      map.setVerticalFieldOfView?.(next);
    } finally {
      applying = false;
    }
  };
  const update = () => {
    if (disposed || applying || normal === undefined) return;
    write(
      tileflowAdaptiveFieldOfView(
        map.getPitch(),
        map.getZoom(),
        map.getCanvas!().clientHeight,
        normal,
      ),
    );
  };
  const setEnabled = (enabled: boolean) => {
    if (disposed) return;
    if (enabled) {
      if (!map.getVerticalFieldOfView || !map.setVerticalFieldOfView || !map.getCanvas) return;
      normal ??= map.getVerticalFieldOfView();
      update();
    } else if (normal !== undefined) {
      const restore = normal;
      normal = undefined;
      write(restore);
    }
  };
  const onRemove = () => dispose(false);
  function dispose(restore = true) {
    if (disposed) return;
    if (restore) setEnabled(false);
    disposed = true;
    map.off('pitch', update);
    map.off('zoom', update);
    map.off('resize', update);
    map.off('remove', onRemove);
  }
  map.on('pitch', update);
  map.on('zoom', update);
  map.on('resize', update);
  map.on('remove', onRemove);
  return {setEnabled, dispose};
}

type TileflowCameraChange = {zoom?: number; pitch?: number};
type TileflowCameraCall = (options: TileflowCameraChange, ...rest: unknown[]) => unknown;
const tileflowCameraCalls = ['jumpTo', 'easeTo', 'flyTo', 'fitBounds'] as const;

/** The map capabilities the overview pitch cap uses; camera calls it does not find stay unwrapped. */
export type TileflowPitchLimitMap = TileflowAdaptiveCameraMap & {
  jumpTo?(options: TileflowCameraChange, eventData?: unknown): unknown;
  easeTo?(options: TileflowCameraChange, eventData?: unknown): unknown;
  flyTo?(options: TileflowCameraChange, eventData?: unknown): unknown;
  fitBounds?(bounds: unknown, options?: TileflowCameraChange, eventData?: unknown): unknown;
  cameraForBounds?(bounds: unknown, options?: TileflowCameraChange): {zoom?: number} | undefined;
  isMoving?(): boolean;
};

/**
 * Enforces the map's overview pitch cap, restoring the caller's maximum on release.
 *
 * The renderer clamps a requested pitch against the maximum in force before any event reports the
 * new zoom, so a camera change from an overview into a closer view would keep the overview cap. A
 * camera call whose target lies above `maxZoom` therefore lifts the cap until its movement ends; a
 * movement that ends at an overview zoom (an interrupted flight, for instance) is capped again.
 */
export function createTileflowPitchLimit(map: TileflowPitchLimitMap) {
  let limit: TileflowCameraOptions['pitchLimit'];
  let original: number | undefined;
  let applying = false;
  let disposed = false;
  // A camera call that ends above the cap is in flight; `calling` covers the call itself, whose
  // synchronous movement end (or the end of the movement it replaces) is not yet the final one.
  let lifted = false;
  let calling = 0;
  const update = () => {
    if (disposed || applying || original === undefined) return;
    const maximum =
      limit && !lifted && map.getZoom() <= limit.maxZoom
        ? Math.min(original, limit.maxPitch)
        : original;
    if (map.getMaxPitch?.() === maximum) return;
    applying = true;
    try {
      map.setMaxPitch?.(maximum);
    } finally {
      applying = false;
    }
  };
  const setLimit = (next: TileflowCameraOptions['pitchLimit']) => {
    if (disposed || !map.getMaxPitch || !map.setMaxPitch) return;
    limit = next;
    if (next) original ??= map.getMaxPitch();
    update();
    if (!next) original = undefined;
  };
  const onMoveEnd = () => {
    if (calling || !lifted) return;
    lifted = false;
    update();
  };
  const targetZoom = (method: (typeof tileflowCameraCalls)[number], args: unknown[]) => {
    if (method !== 'fitBounds') return (args[0] as TileflowCameraChange | undefined)?.zoom;
    return map.cameraForBounds?.(args[0], args[1] as TileflowCameraChange | undefined)?.zoom;
  };
  const target = map as unknown as Record<string, TileflowCameraCall | undefined>;
  // Each wrapper with the call it replaces, and whether that call was the map's own property.
  const wrapped = new Map<
    string,
    {steer: TileflowCameraCall; call: TileflowCameraCall; own: boolean}
  >();
  if (map.getMaxPitch && map.setMaxPitch)
    for (const method of tileflowCameraCalls) {
      const call = target[method];
      if (typeof call !== 'function') continue;
      const own = Object.prototype.hasOwnProperty.call(map, method);
      const steer: TileflowCameraCall = (...args) => {
        if (disposed || !limit || original === undefined) return call.apply(map, args as never);
        lifted = (targetZoom(method, args) ?? map.getZoom()) > limit.maxZoom;
        update();
        calling++;
        try {
          return call.apply(map, args as never);
        } finally {
          calling--;
          if (!calling && lifted && !map.isMoving?.()) {
            lifted = false;
            update();
          }
        }
      };
      wrapped.set(method, {steer, call, own});
      target[method] = steer;
    }
  const onRemove = () => dispose(false);
  function dispose(restore = true) {
    if (disposed) return;
    if (restore) {
      lifted = false;
      setLimit(undefined);
    }
    disposed = true;
    // A later wrapper owns the method now; removing ours from under it would drop its behavior.
    for (const [method, {steer, call, own}] of wrapped) {
      if (target[method] !== steer) continue;
      if (own) target[method] = call;
      else delete target[method];
    }
    map.off('zoom', update);
    map.off('moveend', onMoveEnd);
    map.off('remove', onRemove);
  }
  map.on('zoom', update);
  map.on('moveend', onMoveEnd);
  map.on('remove', onRemove);
  return {setLimit, dispose};
}
