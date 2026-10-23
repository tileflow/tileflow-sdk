import {
  atmosphereSpaceOpacity,
  readTileflowAtmosphere,
  tileflowAtmosphereMetadataKey,
  type TileflowResolvedAtmosphere,
} from './atmosphere';
import type {TileflowAtmosphereMap} from './atmosphere-browser';
import type {TileflowSkyMap} from './sky-browser';

export const tileflowAtmosphereRimLayerId = 'tileflow-atmosphere-rim';

type RenderInput = {
  defaultProjectionData: {mainMatrix: ArrayLike<number>; projectionTransition: number};
};

/** The projected silhouette of a unit sphere, from MapLibre's public globe matrix. */
export function atmosphereRimEllipse(matrix: ArrayLike<number>, width: number, height: number) {
  // Project the sphere's dual quadric diag(1,1,1,-1) into a screen-space dual conic.
  const x = [0, 4, 8, 12].map((i) => ((matrix[i]! + matrix[i + 3]!) * width) / 2);
  const y = [1, 5, 9, 13].map((i) => ((matrix[i + 2]! - matrix[i]!) * height) / 2);
  const w = [3, 7, 11, 15].map((i) => matrix[i]!);
  const dot = (a: number[], b: number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! - a[3]! * b[3]!;
  const xx = dot(x, x),
    xy = dot(x, y),
    xw = dot(x, w);
  const yy = dot(y, y),
    yw = dot(y, w),
    ww = dot(w, w);
  // The adjugate is the primal conic, up to an irrelevant common scale.
  const a = yy * ww - yw * yw,
    b = xw * yw - xy * ww,
    c = xx * ww - xw * xw;
  const d = xy * yw - xw * yy,
    e = xy * xw - xx * yw,
    f = xx * yy - xy * xy;
  const determinant = a * c - b * b;
  if (!Number.isFinite(determinant) || determinant <= 0) return undefined;
  const centerX = (b * e - c * d) / determinant;
  const centerY = (b * d - a * e) / determinant;
  const level = -(f + d * centerX + e * centerY);
  const middle = (a + c) / 2;
  const spread = Math.hypot((a - c) / 2, b);
  const radiusX = Math.sqrt(level / (middle + spread));
  const radiusY = Math.sqrt(level / (middle - spread));
  if (
    ![centerX, centerY, radiusX, radiusY].every(Number.isFinite) ||
    Math.min(radiusX, radiusY) <= 0
  )
    return undefined;
  return {centerX, centerY, radiusX, radiusY, rotation: Math.atan2(2 * b, a - c) / 2};
}

/**
 * A persistent contour behind the map. A custom layer supplies only the public projection matrix;
 * the halo's pixels never enter the map canvas or its theme crossfade snapshots.
 */
export function attachTileflowAtmosphereRim(map: TileflowAtmosphereMap & TileflowSkyMap) {
  const container = map.getContainer();
  const document = container.ownerDocument;
  const browser = document.defaultView;
  if (!browser) return () => {};
  let disposed = false;
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let lastDraw = '';
  let atmosphere: TileflowResolvedAtmosphere | undefined;
  function removeCanvas() {
    canvas?.remove();
    canvas = undefined;
    context = null;
    lastDraw = '';
  }
  const layer = {
    id: tileflowAtmosphereRimLayerId,
    type: 'custom',
    // Keep projection reads out of terrain's offscreen ground textures.
    renderingMode: '3d',
    render(_gl: WebGL2RenderingContext, input: RenderInput) {
      if (!atmosphere || !canvas || !context) return;
      const {mainMatrix, projectionTransition} = input.defaultProjectionData;
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      const pixelRatio = Math.min(browser!.devicePixelRatio || 1, 2);
      const transition = Math.max(0, Math.min(1, (projectionTransition - 0.98) / 0.02));
      const opacity =
        atmosphereSpaceOpacity(map.getZoom()) * transition * transition * (3 - 2 * transition);
      const key = JSON.stringify([
        Array.from(mainMatrix),
        width,
        height,
        pixelRatio,
        opacity,
        atmosphere.horizonColor,
      ]);
      if (key === lastDraw) return;
      lastDraw = key;
      canvas.style.opacity = String(opacity);
      if (!opacity) return;
      const ellipse = atmosphereRimEllipse(mainMatrix, width, height);
      if (!ellipse) return;
      const physicalWidth = Math.round(width * pixelRatio),
        physicalHeight = Math.round(height * pixelRatio);
      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(ellipse.centerX, ellipse.centerY);
      context.rotate(ellipse.rotation);
      context.scale(ellipse.radiusX, ellipse.radiusY);
      const radius = Math.min(ellipse.radiusX, ellipse.radiusY);
      const extent = 1 + 120 / radius;
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, extent);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(Math.max(0, 1 - 0.5 / radius) / extent, 'transparent');
      const colour = Number.parseInt(atmosphere.horizonColor.slice(1), 16);
      const outer = [(colour >> 16) * 0.35, ((colour >> 8) & 255) * 0.6, colour & 255];
      const white = [245, 250, 255];
      for (const distance of [0, 1, 2, 3, 5, 8, 12, 18, 26, 36, 50, 70, 96, 120]) {
        const tint = Math.exp(-distance / 7);
        const channels = outer.map((channel, index) =>
          Math.round(channel + (white[index]! - channel) * tint),
        );
        const alpha =
          distance === 120
            ? 0
            : Math.min(1, 0.85 * Math.exp(-distance / 3) + 0.55 * Math.exp(-distance / 24));
        gradient.addColorStop(
          (1 + distance / radius) / extent,
          `rgba(${channels.join(', ')}, ${alpha})`,
        );
      }
      context.fillStyle = gradient;
      context.fillRect(-extent, -extent, extent * 2, extent * 2);
      context.restore();
    },
  };
  function sync(styleLoaded = false) {
    if (disposed) return;
    // A style replacement can temporarily have no document. Keep the last halo during that gap.
    const style = map.getStyle();
    if (!style) return;
    atmosphere =
      style.projection?.type === 'globe'
        ? readTileflowAtmosphere(
            (style.metadata as Record<string, unknown> | undefined)?.[
              tileflowAtmosphereMetadataKey
            ],
          )
        : undefined;
    try {
      const present = Boolean(map.getLayer(layer.id));
      if (!atmosphere) {
        if (present) map.removeLayer(layer.id);
        removeCanvas();
        return;
      }
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.setAttribute('data-tileflow-atmosphere-rim', '');
        Object.assign(canvas.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        });
        context = canvas.getContext('2d');
        container.insertBefore(canvas, container.firstChild);
      }
      // style.load permits adding layers even while new tiles are still pending.
      if (present || (!styleLoaded && !map.isStyleLoaded())) return;
      map.addLayer(layer);
    } catch {
      // A style replacement may be in progress. The next style event retries attachment.
    }
  }
  const styleLoaded = () => sync(true);
  const styleData = () => sync();
  map.on('style.load', styleLoaded);
  map.on('styledata', styleData);
  map.on('idle', styleData);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    map.off('style.load', styleLoaded);
    map.off('styledata', styleData);
    map.off('idle', styleData);
    removeCanvas();
    try {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    } catch {
      // Removing the map already released its layers.
    }
  };
}
