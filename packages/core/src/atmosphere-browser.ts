import {
  atmosphereAngleDelta,
  atmosphereSpaceOpacity,
  createAtmosphereStars,
  readTileflowAtmosphere,
  tileflowAtmosphereMetadataKey,
  type TileflowResolvedAtmosphere,
  wrapAtmosphereStar,
} from './atmosphere';
import {attachTileflowAtmosphereRim} from './atmosphere-rim-browser';
import {attachTileflowSky, type TileflowSkyMap} from './sky-browser';
import {attachTileflowSkyHaze, type TileflowSkyHazeMap} from './sky-haze-browser';

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowAtmosphereMap = {
  getBearing(): number;
  getCanvas(): HTMLCanvasElement;
  getCenter(): {lat: number; lng: number};
  getContainer(): HTMLElement;
  getPitch(): number;
  getZoom(): number;
  getStyle(): {metadata?: unknown; projection?: {type?: unknown}} | undefined;
  on(event: 'move' | 'resize' | 'style.load' | 'remove', listener: () => void): unknown;
  off(event: 'move' | 'resize' | 'style.load' | 'remove', listener: () => void): unknown;
} & Partial<TileflowSkyMap> &
  Partial<TileflowSkyHazeMap>;

export type TileflowAtmosphereRuntimeOptions = {
  /** Camera-relative star speed multiplier. Negative values reverse direction. Default: 1. */
  starParallaxScale?: number;
};

/**
 * Render compiled globe atmosphere metadata, and the stars and distance haze of a sky. Call after
 * constructing a browser map. Follows style replacements and releases its canvas, layer,
 * listeners, and pending frame on disposal.
 */
export function attachTileflowAtmosphere(
  map: TileflowAtmosphereMap,
  runtimeOptions: TileflowAtmosphereRuntimeOptions = {},
): () => void {
  const starParallaxScale = runtimeOptions.starParallaxScale ?? 1;
  if (!Number.isFinite(starParallaxScale))
    throw new RangeError('starParallaxScale must be a finite number.');
  const container = map.getContainer();
  const document = container.ownerDocument;
  const browser = document.defaultView;
  if (!browser) return () => {};
  const layered = typeof map.addLayer === 'function';
  const detachSky = layered ? attachTileflowSky(map as TileflowSkyMap) : () => {};
  const detachHaze = layered ? attachTileflowSkyHaze(map as TileflowSkyHazeMap) : () => {};
  const detachRim = layered
    ? attachTileflowAtmosphereRim(map as TileflowSkyMap & TileflowAtmosphereMap)
    : () => {};
  const reducedMotion = browser.matchMedia('(prefers-reduced-motion: reduce)');
  let stars: ReturnType<typeof createAtmosphereStars> = [];
  let options: TileflowResolvedAtmosphere | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let frame: number | undefined;
  let disposed = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let previousLongitude = map.getCenter().lng;
  let previousBearing = map.getBearing();
  let longitude = previousLongitude;
  let bearing = previousBearing;

  function removeCanvas() {
    canvas?.remove();
    canvas = undefined;
    context = null;
    width = height = pixelRatio = 0;
  }

  function syncStyle() {
    if (disposed) return;
    const style = map.getStyle();
    const metadata = style?.metadata;
    options =
      style?.projection?.type === 'globe' && metadata && typeof metadata === 'object'
        ? readTileflowAtmosphere(
            (metadata as Record<string, unknown>)[tileflowAtmosphereMetadataKey],
          )
        : undefined;
    if (!options) {
      if (frame !== undefined) browser!.cancelAnimationFrame(frame);
      frame = undefined;
      removeCanvas();
      return;
    }
    if (stars.length !== options.starCount) stars = createAtmosphereStars(options.starCount);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.setAttribute('data-tileflow-atmosphere', '');
      Object.assign(canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        opacity: '0',
        pointerEvents: 'none',
      });
      context = canvas.getContext('2d');
      container.insertBefore(canvas, container.firstChild);
    }
    canvas.style.background = `radial-gradient(ellipse at 50% 48%, ${options.skyColor} 0%, ${options.spaceColor} 100%)`;
    schedule();
  }

  function draw() {
    frame = undefined;
    if (disposed || !options || !canvas) return;
    const center = map.getCenter();
    longitude += atmosphereAngleDelta(center.lng, previousLongitude);
    bearing += atmosphereAngleDelta(map.getBearing(), previousBearing);
    previousLongitude = center.lng;
    previousBearing = map.getBearing();
    const opacity = atmosphereSpaceOpacity(map.getZoom());
    canvas.style.opacity = String(opacity);
    if (opacity === 0) return;
    if (!context) return;
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (!nextWidth || !nextHeight) return;
    const nextPixelRatio = Math.min(browser!.devicePixelRatio || 1, 2);
    if (width !== nextWidth || height !== nextHeight || pixelRatio !== nextPixelRatio) {
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextPixelRatio;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
    context.clearRect(0, 0, width, height);
    if (options.starIntensity === 0 || options.starSize === 0) return;
    const motion = reducedMotion.matches ? 0 : (options.starParallax / 0.4) * starParallaxScale;
    const xOffset = motion * (-longitude * 0.8 - bearing * 0.35);
    const yOffset = motion * (center.lat * 0.6 + map.getPitch() * 0.4);
    const intensity = options.starIntensity / 0.6;
    const fieldWidth = 1600;
    const fieldHeight = 1000;
    for (const star of stars) {
      const radius = (star.radius + 0.25) * options.starSize;
      const margin = star.radius > 0.95 ? radius * 2.5 : radius;
      const alpha = Math.min(1, star.alpha * 1.35 * intensity);
      const x = wrapAtmosphereStar(star.x * fieldWidth + xOffset, fieldWidth);
      const y = wrapAtmosphereStar(star.y * fieldHeight + yOffset, fieldHeight);
      for (let tileX = -1; tileX * fieldWidth < width; tileX++) {
        for (let tileY = -1; tileY * fieldHeight < height; tileY++) {
          const screenX = x + tileX * fieldWidth;
          const screenY = y + tileY * fieldHeight;
          if (
            screenX < -margin ||
            screenX > width + margin ||
            screenY < -margin ||
            screenY > height + margin
          )
            continue;
          if (star.radius > 0.95) {
            context.fillStyle = withAlpha(options.horizonColor, alpha * 0.1);
            context.beginPath();
            context.arc(screenX, screenY, radius * 2.5, 0, Math.PI * 2);
            context.fill();
          }
          context.fillStyle = withAlpha(options.starColor, alpha);
          context.beginPath();
          context.arc(screenX, screenY, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  }

  function schedule() {
    if (!disposed && options && frame === undefined) frame = browser!.requestAnimationFrame(draw);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachSky();
    detachHaze();
    detachRim();
    if (frame !== undefined) browser!.cancelAnimationFrame(frame);
    map.off('move', schedule);
    map.off('resize', schedule);
    map.off('style.load', syncStyle);
    map.off('remove', dispose);
    reducedMotion.removeEventListener('change', schedule);
    removeCanvas();
  }

  map.on('move', schedule);
  map.on('resize', schedule);
  map.on('style.load', syncStyle);
  map.on('remove', dispose);
  reducedMotion.addEventListener('change', schedule);
  syncStyle();
  return dispose;
}

function withAlpha(color: string, alpha: number): string {
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
