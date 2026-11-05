import {TileflowMapError} from './map-error';
import type {JsonObject, JsonValue} from './native-map-contract';
import {layerProperties} from './style-spec';

export type LayerType = keyof typeof layerProperties;

export function layerStyle(
  type: LayerType,
  style: Readonly<Record<string, unknown>> = {},
): JsonObject {
  const properties: Readonly<Record<string, {group: string; name: string}>> = layerProperties[type];
  const paint: Record<string, JsonValue> = {};
  const layout: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    const property = properties[key];
    if (!property)
      throw new TileflowMapError({
        code: 'invalidRequest',
        message: `Unknown ${type} style property: ${key}.`,
        recoverable: false,
      });
    const {group, name} = property;
    (group === 'paint' ? paint : layout)[name] = value as JsonValue;
  }

  return {
    ...(Object.keys(paint).length ? {paint} : {}),
    ...(Object.keys(layout).length ? {layout} : {}),
  };
}
