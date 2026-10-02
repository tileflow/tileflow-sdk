import {Color} from '@maplibre/maplibre-gl-style-spec';
import type {TileflowIconAppearance} from './icon-appearance';
import type {TileflowIconSpriteIndex} from './icon-sprite-index';

type PremultipliedColor = {r: number; g: number; b: number; a: number};

export type TileflowIconPreviewPaint = {
  color: PremultipliedColor;
  haloColor: PremultipliedColor;
  haloWidth: number;
  haloBlur: number;
};

export function resolveTileflowIconPreviewPaint(
  appearance: TileflowIconAppearance,
): TileflowIconPreviewPaint {
  return {
    ...appearance.defaults,
    color: Color.parse(appearance.defaults.color)!,
    haloColor: Color.parse(appearance.defaults.haloColor)!,
  };
}

/** Self-contained runtime for default-appearance previews and static canvas composition. */
export function createTileflowIconPreviewRuntime() {
  function render(
    rgba: Uint8Array,
    pixelRatio: number,
    paint: TileflowIconPreviewPaint,
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(rgba.length);
    const coverage = (distance: number, blur: number) => {
      const t = Math.max(0, Math.min(1, 0.5 + distance / (1 / pixelRatio + blur)));
      return t * t * (3 - 2 * t);
    };

    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (rgba[offset + 3] === 0) continue;
      const distance = (rgba[offset + 3]! / 255 - 0.75) * 8;
      const fill = coverage(distance, 0);
      const halo = paint.haloWidth > 0 ? coverage(distance + paint.haloWidth, paint.haloBlur) : 0;
      const alpha = paint.color.a * fill + paint.haloColor.a * halo * (1 - paint.color.a * fill);
      if (alpha === 0) continue;
      for (const [channel, key] of ['r', 'g', 'b'].entries()) {
        const name = key as 'r' | 'g' | 'b';
        result[offset + channel] =
          (255 *
            (paint.color[name] * fill +
              paint.haloColor[name] * halo * (1 - paint.color.a * fill))) /
          alpha;
      }
      result[offset + 3] = alpha * 255;
    }

    return result;
  }

  return {render};
}

/** Preserve RGBA cells and replace only SDF rectangles with their default appearance. */
export function renderTileflowIconAtlasPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  index: TileflowIconSpriteIndex,
): Uint8ClampedArray {
  if (rgba.length !== width * height * 4)
    throw new Error('Icon preview atlas dimensions do not match its pixels.');
  const result = new Uint8ClampedArray(rgba);
  const runtime = createTileflowIconPreviewRuntime();

  for (const entry of Object.values(index)) {
    if (entry.x + entry.width > width || entry.y + entry.height > height)
      throw new Error('Icon preview rectangle exceeds its atlas.');
    if (!entry.sdf || !entry.tileflow) continue;
    const cell = new Uint8Array(entry.width * entry.height * 4);
    for (let y = 0; y < entry.height; y++) {
      const start = ((entry.y + y) * width + entry.x) * 4;
      cell.set(rgba.subarray(start, start + entry.width * 4), y * entry.width * 4);
    }
    const preview = runtime.render(
      cell,
      entry.pixelRatio,
      resolveTileflowIconPreviewPaint(entry.tileflow),
    );
    for (let y = 0; y < entry.height; y++) {
      result.set(
        preview.subarray(y * entry.width * 4, (y + 1) * entry.width * 4),
        ((entry.y + y) * width + entry.x) * 4,
      );
    }
  }

  return result;
}
