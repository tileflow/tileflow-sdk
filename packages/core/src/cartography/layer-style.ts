import {Color} from '@maplibre/maplibre-gl-style-spec';
import {
  createTileflowLineBackgroundFontStack,
  parseTileflowLineBackgroundFontStack,
  scaleTileflowTextSizeForLineBackground,
  tileflowLineBackgroundDefaults,
  type TileflowLineBackgroundFontStack,
} from '../text-background';
import type {
  TileflowAreaStyle,
  TileflowBackgroundStyle,
  TileflowCircleStyle,
  TileflowExtrusionStyle,
  TileflowFillStyle,
  TileflowIconStyle,
  TileflowLayerRange,
  TileflowLineStyle,
  TileflowSymbolPlacementStyle,
  TileflowSymbolStyle,
  TileflowTextStyle,
} from './styles';
import {toMapLibreStyleValue} from './values';

type Layer = Record<string, unknown> & {id: string; type: string};

export type TileflowAreaLayer = {
  layer: Layer;
  phase: 'fill' | 'outline';
};

export function applyBackgroundStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowBackgroundStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  setPaint(paint, 'background-color', style.color);
  setPaint(paint, 'background-opacity', style.opacity);
  setPaint(paint, 'background-pattern', style.pattern);
  return applyLayerRange(withLayerParts(layer, undefined, paint), style);
}

export function applyFillStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowFillStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  if (style.antialias !== undefined) paint['fill-antialias'] = style.antialias;
  setPaint(paint, 'fill-color', style.color);
  setPaint(paint, 'fill-opacity', style.opacity);
  setPaint(paint, 'fill-pattern', style.pattern);
  setPaint(paint, 'fill-translate', style.translate);
  if (style.translateAnchor !== undefined) {
    paint['fill-translate-anchor'] = style.translateAnchor;
  }
  return applyLayerRange(withLayerParts(layer, undefined, paint), style);
}

export function applyLineStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowLineStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setPaint(paint, 'line-blur', style.blur);
  setPaint(paint, 'line-color', style.color);
  setPaint(paint, 'line-dasharray', style.dash);
  setPaint(paint, 'line-gap-width', style.gapWidth);
  setPaint(paint, 'line-offset', style.offset);
  setPaint(paint, 'line-opacity', style.opacity);
  setPaint(paint, 'line-pattern', style.pattern);
  setPaint(paint, 'line-translate', style.translate);
  if (style.translateAnchor !== undefined) {
    paint['line-translate-anchor'] = style.translateAnchor;
  }
  setPaint(paint, 'line-width', style.width);
  setLayout(layout, 'line-cap', style.cap);
  setLayout(layout, 'line-join', style.join);
  setLayout(layout, 'line-miter-limit', style.miterLimit);
  setLayout(layout, 'line-round-limit', style.roundLimit);
  return applyLayerRange(withLayerParts(layer, layout, paint), style);
}

export function applyTextStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowTextStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setLayout(layout, 'text-field', style.field);
  if (style.font !== undefined) {
    layout['text-font'] = [style.font, ...(style.fallbacks ?? [])];
  }
  setLayout(layout, 'text-size', style.size);
  setLayout(layout, 'text-letter-spacing', style.letterSpacing);
  setLayout(layout, 'text-line-height', style.lineHeight);
  setLayout(layout, 'text-max-angle', style.maxAngle);
  setLayout(layout, 'text-max-width', style.maxWidth);
  setLayout(layout, 'text-offset', style.offset);
  setLayout(layout, 'text-padding', style.padding);
  if (style.pitchAlignment !== undefined) {
    layout['text-pitch-alignment'] = style.pitchAlignment;
  }
  setLayout(layout, 'text-radial-offset', style.radialOffset);
  setLayout(layout, 'text-rotate', style.rotate);
  if (style.rotationAlignment !== undefined) {
    layout['text-rotation-alignment'] = style.rotationAlignment;
  }
  if (style.transform !== undefined) layout['text-transform'] = style.transform;
  if (style.anchor !== undefined) layout['text-anchor'] = style.anchor;
  if (style.variableAnchors !== undefined) {
    layout['text-variable-anchor'] = [...style.variableAnchors];
  }
  if (style.justify !== undefined) layout['text-justify'] = style.justify;
  if (style.allowOverlap !== undefined) layout['text-allow-overlap'] = style.allowOverlap;
  if (style.ignorePlacement !== undefined) layout['text-ignore-placement'] = style.ignorePlacement;
  if (style.keepUpright !== undefined) layout['text-keep-upright'] = style.keepUpright;
  if (style.optional !== undefined) layout['text-optional'] = style.optional;
  setPaint(paint, 'text-color', style.color);
  setPaint(paint, 'text-halo-blur', style.haloBlur);
  setPaint(paint, 'text-halo-color', style.haloColor);
  setPaint(paint, 'text-halo-width', style.haloWidth);
  setPaint(paint, 'text-opacity', style.opacity);
  applyLineBackground(layer.id, layout, paint, style, backedFontStack(asRecord(layer.layout)));
  return applyLayerRange(withLayerParts(layer, layout, paint), style);
}

/**
 * Lowers `text.background` to a derived glyph stack plus a halo sized to the text, and keeps both
 * consistent when later refinements change size, tracking or leading. While a layer is backed,
 * `text-halo-width` and `text-halo-blur` are derived and `text-halo-color` is the strip colour.
 */
function applyLineBackground(
  id: string,
  layout: Record<string, unknown>,
  paint: Record<string, unknown>,
  style: TileflowTextStyle,
  previous: TileflowLineBackgroundFontStack | undefined,
): void {
  const fonts = layout['text-font'];
  const single = Array.isArray(fonts) && fonts.length === 1 && typeof fonts[0] === 'string';
  const current = backedFontStack(layout);
  const background = style.background;
  // A refinement that replaces the font of a backed layer keeps the background.
  if (!background && !current && !previous) return;
  if (!single) {
    throw new Error(
      `Layer "${id}" needs exactly one text font without fallbacks for a line-fitted background.`,
    );
  }
  const padding =
    background?.padding === undefined
      ? ((current ?? previous)?.metrics.padding ?? tileflowLineBackgroundDefaults.padding)
      : constantNumber(id, toMapLibreStyleValue(background.padding), 'background padding');
  const stack = createTileflowLineBackgroundFontStack(current?.source ?? (fonts[0] as string), {
    letterSpacing: constantNumber(id, layout['text-letter-spacing'] ?? 0, 'letterSpacing'),
    lineHeight: constantNumber(id, layout['text-line-height'] ?? 1.2, 'lineHeight'),
    padding,
  });
  const {metrics} = parseTileflowLineBackgroundFontStack(stack)!;
  // Spacing and leading use the exact rounded values the derived cells were built for.
  layout['text-font'] = [stack];
  layout['text-letter-spacing'] = metrics.letterSpacing;
  layout['text-line-height'] = metrics.lineHeight;
  if (background) {
    const color = toMapLibreStyleValue(background.color);
    if (typeof color === 'string' && (Color.parse(color)?.a ?? 1) < 1) {
      throw new Error(
        `Layer "${id}" needs an opaque line-fitted background colour; "${color}" is translucent.`,
      );
    }
    paint['text-halo-color'] = color;
  }
  paint['text-halo-width'] = scaleTileflowTextSizeForLineBackground(layout['text-size']);
  paint['text-halo-blur'] = 0;
}

function backedFontStack(
  layout: Record<string, unknown>,
): TileflowLineBackgroundFontStack | undefined {
  const fonts = layout['text-font'];
  return Array.isArray(fonts) && fonts.length === 1 && typeof fonts[0] === 'string'
    ? parseTileflowLineBackgroundFontStack(fonts[0])
    : undefined;
}

function constantNumber(id: string, value: unknown, property: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(
    `Layer "${id}" uses a line-fitted text background, so its ${property} must be a constant number.`,
  );
}

export function applyIconStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowIconStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setLayout(layout, 'icon-image', style.image);
  setLayout(layout, 'icon-size', style.size);
  setLayout(layout, 'icon-rotate', style.rotate);
  if (style.textFit !== undefined) layout['icon-text-fit'] = style.textFit;
  setLayout(layout, 'icon-text-fit-padding', style.textFitPadding);
  if (style.anchor !== undefined) layout['icon-anchor'] = style.anchor;
  setLayout(layout, 'icon-offset', style.offset);
  setLayout(layout, 'icon-padding', style.padding);
  if (style.pitchAlignment !== undefined) layout['icon-pitch-alignment'] = style.pitchAlignment;
  if (style.rotationAlignment !== undefined) {
    layout['icon-rotation-alignment'] = style.rotationAlignment;
  }
  if (style.allowOverlap !== undefined) layout['icon-allow-overlap'] = style.allowOverlap;
  if (style.ignorePlacement !== undefined) layout['icon-ignore-placement'] = style.ignorePlacement;
  if (style.keepUpright !== undefined) layout['icon-keep-upright'] = style.keepUpright;
  if (style.optional !== undefined) layout['icon-optional'] = style.optional;
  setPaint(paint, 'icon-color', style.color);
  setPaint(paint, 'icon-halo-blur', style.haloBlur);
  setPaint(paint, 'icon-halo-color', style.haloColor);
  setPaint(paint, 'icon-halo-width', style.haloWidth);
  setPaint(paint, 'icon-opacity', style.opacity);
  return applyLayerRange(withLayerParts(layer, layout, paint), style);
}

export function applySymbolPlacement<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowSymbolPlacementStyle,
): TLayer {
  const layout = {...asRecord(layer.layout)};
  if (style.placement !== undefined) layout['symbol-placement'] = style.placement;
  if (style.priority !== undefined) {
    layout['symbol-sort-key'] = resolvePriority(style.priority, style.priorityOrder);
  }
  setLayout(layout, 'symbol-spacing', style.spacing);
  if (style.zOrder !== undefined) layout['symbol-z-order'] = style.zOrder;
  return applyLayerRange(withLayerParts(layer, layout), style);
}

export function applySymbolStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowSymbolStyle,
): TLayer {
  const range = resolveSymbolRange(style);
  let result = applySymbolPlacement(layer, withoutRange(style));
  if (style.text) result = applyTextStyle(result, withoutRange(style.text));
  if (style.icon) result = applyIconStyle(result, withoutRange(style.icon));
  return applyLayerRange(result, range);
}

export function createAreaLayers(base: Layer, style: TileflowAreaStyle): TileflowAreaLayer[] {
  const layers: TileflowAreaLayer[] = [];
  if (style.fill && style.fill.visible !== false) {
    layers.push({
      layer: applyFillStyle({...base, type: 'fill'}, style.fill),
      phase: 'fill',
    });
  }
  if (style.outline && style.outline.visible !== false) {
    layers.push({
      layer: applyLineStyle({...base, id: `${base.id}-outline`, type: 'line'}, style.outline),
      phase: 'outline',
    });
  }
  return layers;
}

export function applyCircleStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowCircleStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setPaint(paint, 'circle-blur', style.blur);
  setPaint(paint, 'circle-color', style.color);
  setPaint(paint, 'circle-opacity', style.opacity);
  if (style.pitchAlignment !== undefined) {
    paint['circle-pitch-alignment'] = style.pitchAlignment;
  }
  if (style.pitchScale !== undefined) paint['circle-pitch-scale'] = style.pitchScale;
  if (style.priority !== undefined) {
    layout['circle-sort-key'] = resolvePriority(style.priority, style.priorityOrder);
  }
  setPaint(paint, 'circle-radius', style.radius);
  setPaint(paint, 'circle-stroke-color', style.strokeColor);
  setPaint(paint, 'circle-stroke-opacity', style.strokeOpacity);
  setPaint(paint, 'circle-stroke-width', style.strokeWidth);
  setPaint(paint, 'circle-translate', style.translate);
  if (style.translateAnchor !== undefined) {
    paint['circle-translate-anchor'] = style.translateAnchor;
  }
  return applyLayerRange(withLayerParts(layer, layout, paint), style);
}

export function applyExtrusionStyle<TLayer extends Layer>(
  layer: TLayer,
  style: TileflowExtrusionStyle,
): TLayer {
  const paint = {...asRecord(layer.paint)};
  setPaint(paint, 'fill-extrusion-base', style.base);
  setPaint(paint, 'fill-extrusion-color', style.color);
  setPaint(paint, 'fill-extrusion-height', style.height);
  setPaint(paint, 'fill-extrusion-opacity', style.opacity);
  setPaint(paint, 'fill-extrusion-pattern', style.pattern);
  if (style.verticalGradient !== undefined) {
    paint['fill-extrusion-vertical-gradient'] = style.verticalGradient;
  }
  return applyLayerRange(withLayerParts(layer, undefined, paint), style);
}

export function applyLayerRange<TLayer extends Layer>(
  layer: TLayer,
  range: TileflowLayerRange,
): TLayer {
  const layout = {...asRecord(layer.layout)};
  if (range.visible !== undefined) layout.visibility = range.visible ? 'visible' : 'none';
  return {
    ...layer,
    ...(range.minZoom === undefined ? {} : {minzoom: range.minZoom}),
    ...(range.maxZoom === undefined ? {} : {maxzoom: range.maxZoom}),
    ...(Object.keys(layout).length ? {layout} : {}),
  };
}

function withLayerParts<TLayer extends Layer>(
  layer: TLayer,
  layout?: Record<string, unknown>,
  paint?: Record<string, unknown>,
): TLayer {
  return {
    ...layer,
    ...(layout && Object.keys(layout).length ? {layout} : {}),
    ...(paint && Object.keys(paint).length ? {paint} : {}),
  };
}

function resolveSymbolRange(style: TileflowSymbolStyle): TileflowLayerRange {
  const ranges = [style, style.text, style.icon].filter(
    (value): value is TileflowLayerRange => value !== undefined,
  );
  const result: TileflowLayerRange = {};
  for (const property of ['maxZoom', 'minZoom', 'visible'] as const) {
    const values = ranges.flatMap((range) =>
      range[property] === undefined ? [] : [range[property]],
    );
    if (new Set(values).size > 1) {
      throw new Error(
        `Tileflow symbol range conflict for ${property}; placement, text, and icon share one MapLibre layer.`,
      );
    }
    if (values.length > 0) result[property] = values[0] as never;
  }
  return result;
}

function withoutRange<T extends TileflowLayerRange>(value: T): Omit<T, keyof TileflowLayerRange> {
  const {maxZoom: _maxZoom, minZoom: _minZoom, visible: _visible, ...rest} = value;
  return rest;
}

function setPaint(paint: Record<string, unknown>, property: string, value: unknown): void {
  if (value !== undefined) paint[property] = toMapLibreStyleValue(value);
}

function setLayout(layout: Record<string, unknown>, property: string, value: unknown): void {
  if (value !== undefined) layout[property] = toMapLibreStyleValue(value);
}

function invertPriority(value: TileflowSymbolPlacementStyle['priority']): unknown {
  const resolved = toMapLibreStyleValue(value);
  if (typeof resolved === 'number') return -resolved;
  if (Array.isArray(resolved) && resolved[0] === 'interpolate' && isZoomInput(resolved[2])) {
    return resolved.map((entry, index) =>
      index >= 4 && index % 2 === 0 ? negateExpressionOutput(entry) : entry,
    );
  }
  if (Array.isArray(resolved) && resolved[0] === 'step' && isZoomInput(resolved[1])) {
    return resolved.map((entry, index) =>
      index === 2 || (index >= 4 && index % 2 === 0) ? negateExpressionOutput(entry) : entry,
    );
  }
  return ['*', -1, resolved];
}

function resolvePriority(
  value: TileflowSymbolPlacementStyle['priority'],
  order: TileflowSymbolPlacementStyle['priorityOrder'],
): unknown {
  return order === 'lower-first' ? toMapLibreStyleValue(value) : invertPriority(value);
}

function negateExpressionOutput(value: unknown): unknown {
  return typeof value === 'number' ? -value : ['*', -1, value];
}

function isZoomInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
