import type {TileflowLineProgressLayer, TileflowRouteInks} from '@tileflow/core/browser';
import type {Overlay} from './content-contract';

type Styled = Pick<Overlay, 'kind' | 'color' | 'size' | 'opacity' | 'ink'>;

/** An application layer's colour: its route ink in the theme on screen, else its own colour. */
export function overlayColor(overlay: Styled, inks: TileflowRouteInks): string {
  return overlay.ink ? inks[overlay.ink] : overlay.color;
}

/**
 * An application layer's opacity. The glow and core inks carry the theme's own opacity, which a
 * theme sets to 0 to leave them out, so the layer's opacity scales it.
 */
export function overlayOpacity(overlay: Styled, inks: TileflowRouteInks): number {
  const ink =
    overlay.ink === 'glow' ? inks.glowOpacity : overlay.ink === 'core' ? inks.coreOpacity : 1;
  return overlay.opacity * ink;
}

/** The MapLibre paint of an application layer. */
export function overlayPaint(overlay: Styled, inks: TileflowRouteInks): Record<string, unknown> {
  const color = overlayColor(overlay, inks);
  const opacity = overlayOpacity(overlay, inks);
  switch (overlay.kind) {
    case 'circle':
      return {'circle-color': color, 'circle-radius': overlay.size, 'circle-opacity': opacity};
    case 'line':
      return {'line-color': color, 'line-width': overlay.size, 'line-opacity': opacity};
    case 'fill':
      return {'fill-color': color, 'fill-opacity': opacity};
  }
}

/** A line layer as Core's line progress draws it. */
export function progressLayer(
  id: string,
  overlay: Styled,
  inks: TileflowRouteInks,
  highlight: string | undefined,
): TileflowLineProgressLayer {
  return {
    id,
    color: overlayColor(overlay, inks),
    ...(highlight ? {highlight} : {}),
    opacity: overlayOpacity(overlay, inks),
  };
}
