export type TileflowVisualValueCategory = 'color' | 'font' | 'image' | 'number';

/**
 * Numeric appearance properties accepted by Tileflow authoring or compiler-owned MapLibre effects.
 * Structural numbers such as zoom bounds, ranks, filters, sort keys, and contour thresholds are
 * deliberately absent.
 */
const visualNumberProperties = new Set([
  'angle',
  'base',
  'blur',
  'crownScale',
  'dash',
  'exaggeration',
  'fadeDuration',
  'gapWidth',
  'haloBlur',
  'haloWidth',
  'height',
  'heightScale',
  'illuminationDirection',
  'intensity',
  'letterSpacing',
  'lineHeight',
  'maxAngle',
  'maxWidth',
  'miterLimit',
  'offset',
  'opacity',
  'padding',
  'patternWidths',
  'radius',
  'radialOffset',
  'rotate',
  'roundLimit',
  'size',
  'spacing',
  'strokeOpacity',
  'strokeWidth',
  'textFitPadding',
  'translate',
  'width',
  'widthScale',
  'background-emissive-strength',
  'background-opacity',
  'circle-blur',
  'circle-emissive-strength',
  'circle-opacity',
  'circle-radius',
  'circle-stroke-opacity',
  'circle-stroke-width',
  'circle-translate',
  'color-relief-opacity',
  'fill-emissive-strength',
  'fill-extrusion-ambient-occlusion-ground-attenuation',
  'fill-extrusion-ambient-occlusion-ground-radius',
  'fill-extrusion-ambient-occlusion-intensity',
  'fill-extrusion-ambient-occlusion-radius',
  'fill-extrusion-base',
  'fill-extrusion-emissive-strength',
  'fill-extrusion-flood-light-ground-attenuation',
  'fill-extrusion-flood-light-ground-radius',
  'fill-extrusion-flood-light-intensity',
  'fill-extrusion-flood-light-wall-radius',
  'fill-extrusion-height',
  'fill-extrusion-opacity',
  'fill-extrusion-translate',
  'fill-extrusion-vertical-scale',
  'fill-opacity',
  'fill-translate',
  'heatmap-intensity',
  'heatmap-opacity',
  'heatmap-radius',
  'heatmap-weight',
  'hillshade-exaggeration',
  'hillshade-emissive-strength',
  'hillshade-illumination-direction',
  'icon-emissive-strength',
  'icon-halo-blur',
  'icon-halo-width',
  'icon-opacity',
  'icon-occlusion-opacity',
  'icon-offset',
  'icon-padding',
  'icon-size',
  'icon-text-fit-padding',
  'icon-translate',
  'line-blur',
  'line-dasharray',
  'line-emissive-strength',
  'line-gap-width',
  'line-miter-limit',
  'line-opacity',
  'line-offset',
  'line-round-limit',
  'line-translate',
  'line-width',
  'raster-brightness-max',
  'raster-brightness-min',
  'raster-contrast',
  'raster-emissive-strength',
  'raster-fade-duration',
  'raster-hue-rotate',
  'raster-opacity',
  'raster-saturation',
  'text-emissive-strength',
  'text-halo-blur',
  'text-halo-width',
  'text-letter-spacing',
  'text-line-height',
  'text-max-angle',
  'text-max-width',
  'text-offset',
  'text-occlusion-opacity',
  'text-opacity',
  'text-padding',
  'text-radial-offset',
  'text-rotate',
  'text-size',
  'text-translate',
  'symbol-spacing',
]);

/** Return the semantic theme category for one visual property, or undefined for structure/data. */
export function classifyTileflowVisualProperty(
  property: string,
  value?: unknown,
): TileflowVisualValueCategory | undefined {
  if (
    property === 'color' ||
    property === 'colors' ||
    property.endsWith('Color') ||
    property.endsWith('Colors') ||
    property.endsWith('-color') ||
    property.endsWith('-colors')
  ) {
    return 'color';
  }
  if (property === 'font' || property === 'fallbacks' || property.endsWith('-font')) return 'font';
  if (
    property === 'image' ||
    property === 'pattern' ||
    property.endsWith('-image') ||
    property.endsWith('-pattern')
  ) {
    return 'image';
  }
  return visualNumberProperties.has(property) ? 'number' : undefined;
}
