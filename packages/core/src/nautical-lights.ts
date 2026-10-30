/** Style metadata key that names the layers whose Nautical lights flash in their rhythm. */
export const tileflowNauticalLightsMetadataKey = 'tileflow:nautical-lights' as const;

/**
 * MapLibre feature-state keys the light layers read. A runtime writes them per light feature; a
 * light without them shows steadily, exactly as a map that is not animated.
 */
export const tileflowNauticalLightStates = Object.freeze({
  /** Index of the colour shown, into the light's comma-separated `color` list. */
  colour: 'tileflowLightColour',
  /** `1` while the light shines, `0` while it is eclipsed, in between for a fixed part. */
  intensity: 'tileflowLightIntensity',
});

/** The opacity, as a share of the light's own opacity, of a light in eclipse. */
export const tileflowNauticalLightEclipseOpacity = 0.15;

/** The light layers of a compiled style and the source features they draw. */
export type TileflowNauticalLights = Readonly<{
  layers: readonly string[];
  source: string;
  sourceLayer: string;
  version: 1;
}>;

export const tileflowNauticalLightsLimits = Object.freeze({maxLayers: 16});

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const layerIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

/** Read the bounded light declaration of style metadata; a malformed one is ignored. */
export function readTileflowNauticalLights(metadata: unknown): TileflowNauticalLights | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[tileflowNauticalLightsMetadataKey];
  if (!isRecord(value) || value.version !== 1) return undefined;
  const {layers, source, sourceLayer} = value;
  if (typeof source !== 'string' || !identifierPattern.test(source)) return undefined;
  if (typeof sourceLayer !== 'string' || !identifierPattern.test(sourceLayer)) return undefined;
  if (
    !Array.isArray(layers) ||
    layers.length === 0 ||
    layers.length > tileflowNauticalLightsLimits.maxLayers ||
    !layers.every((layer) => typeof layer === 'string' && layerIdPattern.test(layer)) ||
    new Set(layers).size !== layers.length
  ) {
    return undefined;
  }
  return Object.freeze({
    layers: Object.freeze([...layers] as string[]),
    source,
    sourceLayer,
    version: 1,
  });
}

type StyleLayer = Readonly<Record<string, unknown>>;

/**
 * The light declaration for the compiled layers that read Nautical light states from `sourceId`,
 * or `undefined` when no layer does.
 */
export function declareTileflowNauticalLights(
  layers: readonly StyleLayer[],
  sourceId: string | undefined,
  sourceLayer: string,
): TileflowNauticalLights | undefined {
  if (!sourceId) return undefined;
  const ids = layers
    .filter(
      (layer) =>
        layer.source === sourceId &&
        layer['source-layer'] === sourceLayer &&
        readsLightState(layer.paint),
    )
    .map(({id}) => id)
    .filter((id): id is string => typeof id === 'string')
    .slice(0, tileflowNauticalLightsLimits.maxLayers);
  if (ids.length === 0) return undefined;
  return {layers: ids, source: sourceId, sourceLayer, version: 1};
}

/**
 * A copy of `style` in which every light shows steadily: light-state reads become their steady
 * value and the light declaration is removed. Renderers without feature state, such as native
 * ones, draw this copy; it looks exactly like the animated style with no state written.
 */
export function steadyTileflowNauticalLights<T extends {layers?: unknown; metadata?: unknown}>(
  style: T,
): T {
  const declaration = isRecord(style.metadata)
    ? readTileflowNauticalLights(style.metadata)
    : undefined;
  const hasKey = isRecord(style.metadata) && tileflowNauticalLightsMetadataKey in style.metadata;
  if (!declaration && !hasKey) return style;
  const metadata = {...(style.metadata as Record<string, unknown>)};
  delete metadata[tileflowNauticalLightsMetadataKey];
  const layers = Array.isArray(style.layers)
    ? style.layers.map((layer: unknown) =>
        isRecord(layer) && isRecord(layer.paint) && readsLightState(layer.paint)
          ? {...layer, paint: steady(layer.paint)}
          : layer,
      )
    : style.layers;
  return {...style, layers, metadata};
}

/**
 * `['number', ['feature-state', key], steady]` for a light state, the only form the compiler emits.
 * Each read falls back to its steady value when no state is written.
 */
export function tileflowNauticalLightStateRead(
  state: keyof typeof tileflowNauticalLightStates,
  steadyValue: number,
): unknown[] {
  return ['number', ['feature-state', tileflowNauticalLightStates[state]], steadyValue];
}

const stateKeys = new Set<string>(Object.values(tileflowNauticalLightStates));

function readsLightState(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return isRecord(value) ? Object.values(value).some(readsLightState) : false;
  }
  if (value[0] === 'literal') return false;
  if (value[0] === 'feature-state' && typeof value[1] === 'string' && stateKeys.has(value[1])) {
    return true;
  }
  return value.some(readsLightState);
}

function steady(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value[0] === 'literal') return value;
    if (
      value[0] === 'number' &&
      value.length === 3 &&
      Array.isArray(value[1]) &&
      value[1][0] === 'feature-state' &&
      typeof value[1][1] === 'string' &&
      stateKeys.has(value[1][1])
    ) {
      return value[2];
    }
    return value.map(steady);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, steady(entry)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
