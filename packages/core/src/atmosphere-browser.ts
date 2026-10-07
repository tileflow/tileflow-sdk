import {
  atmosphereAngleDelta,
  atmosphereSpaceOpacity,
  createAtmosphereStars,
  readTileflowAtmosphere,
  tileflowAtmosphereMetadataKey,
  type TileflowResolvedAtmosphere,
  wrapAtmosphereStar,
} from './atmosphere';

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
};

/**
 * Render compiled globe atmosphere metadata. Call after constructing a browser map.
 * Follows style replacements and releases its canvas, listeners, and pending frame on disposal.
 */
export function attachTileflowAtmosphere(map: TileflowAtmosphereMap): () => void {
  const container = map.getContainer();
  const document = container.ownerDocument;
  const browser = document.defaultView;
  if (!browser) return () => {};
  const mapCanvas = map.getCanvas();
  const previousFilter = mapCanvas.style.filter;
  const reducedMotion = browser.matchMedia('(prefers-reduced-motion: reduce)');
  const stars = createAtmosphereStars();
  let options: TileflowResolvedAtmosphere | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let frame: number | undefined;
  let disposed = false;
  let appliedFilter: string | undefined;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let previousLongitude = map.getCenter().lng;
  let previousBearing = map.getBearing();
  let longitude = previousLongitude;
  let bearing = previousBearing;

  function restoreFilter() {
    if (appliedFilter !== undefined && mapCanvas.style.filter === appliedFilter)
      mapCanvas.style.filter = previousFilter;
    appliedFilter = undefined;
  }

  function removeCanvas() {
    canvas?.remove();
    canvas = undefined;
    context = null;
    width = height = pixelRatio = 0;
    restoreFilter();
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
    if (opacity === 0) {
      restoreFilter();
      return;
    }
    const baseFilter = previousFilter && previousFilter !== 'none' ? `${previousFilter} ` : '';
    mapCanvas.style.filter = `${baseFilter}drop-shadow(0 0 2px ${withAlpha(options.horizonColor, opacity * 0.65)}) drop-shadow(0 0 12px ${withAlpha(options.horizonColor, opacity * 0.4)})`;
    appliedFilter = mapCanvas.style.filter;
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
    if (options.starIntensity === 0) return;
    const motion = reducedMotion.matches ? 0 : options.starParallax / 0.4;
    const xOffset = motion * (-longitude * 0.8 - bearing * 0.35);
    const yOffset = motion * (center.lat * 0.6 + map.getPitch() * 0.4);
    const intensity = options.starIntensity / 0.6;
    const fieldWidth = 1600;
    const fieldHeight = 1000;
    for (const star of stars) {
      const x = wrapAtmosphereStar(star.x * fieldWidth + xOffset, fieldWidth);
      const y = wrapAtmosphereStar(star.y * fieldHeight + yOffset, fieldHeight);
      for (let tileX = -1; tileX * fieldWidth < width; tileX++) {
        for (let tileY = -1; tileY * fieldHeight < height; tileY++) {
          const screenX = x + tileX * fieldWidth;
          const screenY = y + tileY * fieldHeight;
          if (screenX < -3 || screenX > width + 3 || screenY < -3 || screenY > height + 3) continue;
          if (star.radius > 0.95) {
            context.fillStyle = withAlpha(options.horizonColor, star.alpha * intensity * 0.12);
            context.beginPath();
            context.arc(screenX, screenY, star.radius * 2.5, 0, Math.PI * 2);
            context.fill();
          }
          context.fillStyle = `rgba(208, 227, 255, ${Math.min(1, star.alpha * intensity)})`;
          context.beginPath();
          context.arc(screenX, screenY, star.radius, 0, Math.PI * 2);
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
