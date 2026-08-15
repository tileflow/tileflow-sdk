import type {
  TileflowFillStyle,
  TileflowIconStyle,
  TileflowLayerRange,
  TileflowLineStyle,
  TileflowTextStyle,
} from './styles';
import {toMapLibreFilter, toMapLibreStyleValue} from './values';

export function applyFillStyle(
  layer: Record<string, unknown> & {id: string; type: string},
  style: TileflowFillStyle,
): Record<string, unknown> & {id: string; type: string} {
  const paint = {...asRecord(layer.paint)};
  setPaint(paint, 'fill-color', style.color);
  setPaint(paint, 'fill-opacity', style.opacity);
  setPaint(paint, 'fill-outline-color', style.outlineColor);
  setPaint(paint, 'fill-pattern', style.pattern);
  return applyLayerRange({...layer, ...(Object.keys(paint).length ? {paint} : {})}, style);
}

export function applyLineStyle(
  layer: Record<string, unknown> & {id: string; type: string},
  style: TileflowLineStyle,
): Record<string, unknown> & {id: string; type: string} {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setPaint(paint, 'line-blur', style.blur);
  setPaint(paint, 'line-color', style.color);
  setPaint(paint, 'line-dasharray', style.dash);
  setPaint(paint, 'line-gap-width', style.gapWidth);
  setPaint(paint, 'line-offset', style.offset);
  setPaint(paint, 'line-opacity', style.opacity);
  setPaint(paint, 'line-pattern', style.pattern);
  setPaint(paint, 'line-width', style.width);
  if (style.cap !== undefined) layout['line-cap'] = style.cap;
  if (style.join !== undefined) layout['line-join'] = style.join;
  return applyLayerRange(
    {
      ...layer,
      ...(Object.keys(layout).length ? {layout} : {}),
      ...(Object.keys(paint).length ? {paint} : {}),
    },
    style,
  );
}

export function applyTextStyle(
  layer: Record<string, unknown> & {id: string; type: string},
  style: TileflowTextStyle,
): Record<string, unknown> & {id: string; type: string} {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setLayout(layout, 'text-field', style.field);
  if (style.font !== undefined) layout['text-font'] = [...style.font];
  setLayout(layout, 'text-size', style.size);
  setLayout(layout, 'text-letter-spacing', style.letterSpacing);
  setLayout(layout, 'text-line-height', style.lineHeight);
  setLayout(layout, 'text-max-width', style.maxWidth);
  if (style.offset !== undefined) layout['text-offset'] = [...style.offset];
  setLayout(layout, 'text-padding', style.padding);
  setLayout(layout, 'text-rotate', style.rotate);
  if (style.transform !== undefined) layout['text-transform'] = style.transform;
  if (style.anchor !== undefined) layout['text-anchor'] = style.anchor;
  if (style.placement !== undefined) layout['symbol-placement'] = style.placement;
  setLayout(layout, 'symbol-spacing', style.spacing);
  if (style.allowOverlap !== undefined) layout['text-allow-overlap'] = style.allowOverlap;
  if (style.ignorePlacement !== undefined) layout['text-ignore-placement'] = style.ignorePlacement;
  if (style.optional !== undefined) layout['text-optional'] = style.optional;
  setLayout(layout, 'symbol-sort-key', style.priority);
  setPaint(paint, 'text-color', style.color);
  setPaint(paint, 'text-halo-blur', style.haloBlur);
  setPaint(paint, 'text-halo-color', style.haloColor);
  setPaint(paint, 'text-halo-width', style.haloWidth);
  return applyLayerRange(
    {
      ...layer,
      ...(Object.keys(layout).length ? {layout} : {}),
      ...(Object.keys(paint).length ? {paint} : {}),
    },
    style,
  );
}

export function applyIconStyle(
  layer: Record<string, unknown> & {id: string; type: string},
  style: TileflowIconStyle,
): Record<string, unknown> & {id: string; type: string} {
  const paint = {...asRecord(layer.paint)};
  const layout = {...asRecord(layer.layout)};
  setLayout(layout, 'icon-image', style.image);
  setLayout(layout, 'icon-size', style.size);
  setLayout(layout, 'icon-rotate', style.rotate);
  if (style.offset !== undefined) layout['icon-offset'] = [...style.offset];
  setLayout(layout, 'icon-padding', style.padding);
  if (style.allowOverlap !== undefined) layout['icon-allow-overlap'] = style.allowOverlap;
  if (style.ignorePlacement !== undefined) layout['icon-ignore-placement'] = style.ignorePlacement;
  if (style.optional !== undefined) layout['icon-optional'] = style.optional;
  setPaint(paint, 'icon-opacity', style.opacity);
  return applyLayerRange(
    {
      ...layer,
      ...(Object.keys(layout).length ? {layout} : {}),
      ...(Object.keys(paint).length ? {paint} : {}),
    },
    style,
  );
}

export function applyLayerRange<
  TLayer extends Record<string, unknown> & {id: string; type: string},
>(layer: TLayer, range: TileflowLayerRange): TLayer {
  const layout = {...asRecord(layer.layout)};
  if (range.visible !== undefined) layout.visibility = range.visible ? 'visible' : 'none';
  return {
    ...layer,
    ...(range.filter ? {filter: toMapLibreFilter(range.filter)} : {}),
    ...(range.minZoom === undefined ? {} : {minzoom: range.minZoom}),
    ...(range.maxZoom === undefined ? {} : {maxzoom: range.maxZoom}),
    ...(Object.keys(layout).length ? {layout} : {}),
  };
}

function setPaint(paint: Record<string, unknown>, property: string, value: unknown): void {
  if (value !== undefined) paint[property] = toMapLibreStyleValue(value);
}

function setLayout(layout: Record<string, unknown>, property: string, value: unknown): void {
  if (value !== undefined) layout[property] = toMapLibreStyleValue(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
