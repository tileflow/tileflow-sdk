/** Public camera capabilities; renderers without a field-of-view setter keep their own lens. */
export type TileflowAdaptiveCameraMap = {
  getPitch(): number;
  getZoom(): number;
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
