import type {TileflowLayerDomain} from './cartography/domains';
import {tileflowLayerDomainMetadataKey} from './layer-domain';
import {mixTileflowColours, readsTileflowFeatureData} from './theme-blend';

/**
 * Map emphasis lets an application's own content read first: chosen modules of the map recede
 * towards the map's ground colour, and the map's labels and icons fade, except inside an area the
 * application keeps at full strength. It only touches layers that a Tileflow map compiled, which
 * name their module in their metadata; an application's own layers are never changed.
 *
 * This module plans which paint values an emphasis changes and computes each value for a strength
 * from 0 (the map as designed) to 1 (the full emphasis). The browser controller writes them.
 */

/** A module of a compiled Tileflow map, such as `roads`, `transit`, `boundaries`, or `water`. */
export type TileflowEmphasisModule = TileflowLayerDomain;

/** A GeoJSON polygon or multipolygon, in longitude and latitude. */
export type TileflowEmphasisArea =
  | Readonly<{coordinates: readonly (readonly (readonly number[])[])[]; type: 'Polygon'}>
  | Readonly<{
      coordinates: readonly (readonly (readonly (readonly number[])[])[])[];
      type: 'MultiPolygon';
    }>;

/** How the map steps back so an application's content reads first. */
export type TileflowEmphasis = Readonly<{
  /**
   * Modules whose ground recedes towards the map's ground colour, and how far, from 0 (as
   * designed) to 1 (the ground colour itself). Artwork that cannot be recoloured, such as
   * patterns, fades by the same amount instead.
   */
  recede?: Readonly<Partial<Record<TileflowEmphasisModule, number>>>;
  /** The share of their opacity the map's labels and icons keep, from 0 to 1. */
  labels?: number;
  /** An area in which the map's labels and icons keep their full strength. */
  keep?: TileflowEmphasisArea;
}>;

/** A paint value an emphasis changes. */
export type TileflowEmphasisTarget = Readonly<{
  layer: string;
  property: string;
  /**
   * `colour` mixes the value's colours towards the ground colour; `fade` scales an opacity;
   * `label` scales a label or icon opacity, except inside the keep area.
   */
  kind: 'colour' | 'fade' | 'label';
  /** How far the value moves at full strength: towards the ground, or out of its opacity. */
  amount: number;
  /**
   * Whether MapLibre evaluates the value per feature. Such a value re-lays its source out when it
   * changes, so it is set once rather than eased.
   */
  featureData: boolean;
}>;

const colourProperties: Readonly<Record<string, readonly string[]>> = {
  circle: ['circle-color', 'circle-stroke-color'],
  fill: ['fill-color', 'fill-outline-color'],
  'fill-extrusion': ['fill-extrusion-color'],
  line: ['line-color'],
};
const patternProperties: Readonly<Record<string, string>> = {
  fill: 'fill-pattern',
  'fill-extrusion': 'fill-extrusion-pattern',
  line: 'line-pattern',
};
const opacityProperties: Readonly<Record<string, string>> = {
  circle: 'circle-opacity',
  fill: 'fill-opacity',
  'fill-extrusion': 'fill-extrusion-opacity',
  heatmap: 'heatmap-opacity',
  line: 'line-opacity',
  raster: 'raster-opacity',
};
const labelProperties = ['text-opacity', 'icon-opacity'] as const;
/** Positions an emphasis area may hold; its outline becomes part of each label's opacity. */
const maximumAreaPositions = 4096;

/** Why an emphasis cannot be shown, or undefined when it can. */
export function validateTileflowEmphasis(value: unknown): TypeError | undefined {
  if (!isRecord(value)) return new TypeError('A Tileflow emphasis must be an object.');
  for (const key of Object.keys(value)) {
    if (key !== 'recede' && key !== 'labels' && key !== 'keep') {
      return new TypeError(`A Tileflow emphasis has no ${JSON.stringify(key)} option.`);
    }
  }
  if (value.recede !== undefined) {
    if (!isRecord(value.recede)) {
      return new TypeError('A Tileflow emphasis recede must map module names to amounts.');
    }
    for (const [module, amount] of Object.entries(value.recede)) {
      if (!/^[a-z][a-z0-9-]*$/u.test(module) || !isUnit(amount)) {
        return new TypeError(
          `A Tileflow emphasis recede amount for ${JSON.stringify(module)} must be a number from 0 to 1.`,
        );
      }
    }
  }
  if (value.labels !== undefined && !isUnit(value.labels)) {
    return new TypeError('A Tileflow emphasis labels share must be a number from 0 to 1.');
  }
  if (value.keep !== undefined) {
    const positions = areaPositions(value.keep);
    if (positions === undefined) {
      return new TypeError(
        'A Tileflow emphasis keep area must be a GeoJSON Polygon or MultiPolygon.',
      );
    }
    if (positions > maximumAreaPositions) {
      return new TypeError(
        `A Tileflow emphasis keep area may hold at most ${maximumAreaPositions} positions.`,
      );
    }
  }
  return undefined;
}

/** The paint values an emphasis changes among a style's layers, in layer order. */
export function planTileflowEmphasis(
  layers: readonly unknown[],
  emphasis: TileflowEmphasis,
): TileflowEmphasisTarget[] {
  const targets: TileflowEmphasisTarget[] = [];
  const fadeLabels = emphasis.labels === undefined ? 0 : 1 - emphasis.labels;
  for (const layer of layers) {
    if (!isRecord(layer) || typeof layer.id !== 'string' || typeof layer.type !== 'string')
      continue;
    const domain = isRecord(layer.metadata)
      ? layer.metadata[tileflowLayerDomainMetadataKey]
      : undefined;
    // Only layers a Tileflow map compiled; an application's own layers stay as they are.
    if (typeof domain !== 'string') continue;
    const paint = isRecord(layer.paint) ? layer.paint : {};
    const add = (property: string, kind: TileflowEmphasisTarget['kind'], amount: number) =>
      targets.push({
        amount,
        featureData:
          readsTileflowFeatureData(paint[property]) ||
          (kind === 'label' && emphasis.keep !== undefined),
        kind,
        layer: layer.id as string,
        property,
      });

    if (layer.type === 'symbol') {
      if (fadeLabels > 0)
        for (const property of labelProperties) add(property, 'label', fadeLabels);
      continue;
    }
    // The ground colour is what the rest recedes towards; it stays.
    if (layer.type === 'background') continue;
    const amount = emphasis.recede?.[domain as TileflowEmphasisModule] ?? 0;
    if (amount <= 0) continue;
    const pattern = patternProperties[layer.type];
    const opacity = opacityProperties[layer.type];
    if (pattern && paint[pattern] !== undefined) {
      // Artwork cannot be recoloured; it fades instead.
      if (opacity) add(opacity, 'fade', amount);
      continue;
    }
    const colours = (colourProperties[layer.type] ?? []).filter(
      (property) => paint[property] !== undefined,
    );
    if (colours.length > 0) for (const property of colours) add(property, 'colour', amount);
    else if (opacity) add(opacity, 'fade', amount);
  }
  return targets;
}

/**
 * A target's value at an emphasis strength from 0 to 1. At 0 the value is returned unchanged.
 * `ground` is the map's ground colour; without it, colours fade instead of receding.
 */
export function emphasizeTileflowValue(
  target: TileflowEmphasisTarget,
  value: unknown,
  options: Readonly<{ground?: string; keep?: TileflowEmphasisArea; strength: number}>,
): unknown {
  const amount = target.amount * Math.min(1, Math.max(0, options.strength));
  if (target.kind === 'label') {
    const keep = options.keep;
    if (amount <= 0 && !keep) return value;
    const near = keep
      ? (original: unknown, scaled: unknown) => ['case', ['within', keep], original, scaled]
      : undefined;
    return scaleOpacity(value, 1 - amount, near);
  }
  if (amount <= 0) return value;
  if (target.kind === 'fade') return scaleOpacity(value, 1 - amount);
  if (options.ground === undefined) return value;
  return mixColours(value, options.ground, amount);
}

/**
 * The ground colour of a style's layers: the background layer's colour, or the first colour in it
 * when it is an expression.
 */
export function tileflowEmphasisGround(layers: readonly unknown[]): string | undefined {
  for (const layer of layers) {
    if (!isRecord(layer) || layer.type !== 'background') continue;
    const colour = isRecord(layer.paint) ? layer.paint['background-color'] : undefined;
    return firstColour(colour);
  }
  return undefined;
}

/** The first colour inside a value, or the value itself when it is one. */
export function firstColour(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return mixTileflowColours(value, value, 0) === undefined ? undefined : value;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(1)) {
      const found = firstColour(item);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Every colour literal inside a value mixed `amount` of the way towards `toward`. */
function mixColours(value: unknown, toward: string, amount: number): unknown {
  if (typeof value === 'string') return mixTileflowColours(value, toward, amount) ?? value;
  // The operator name stays; colours sit in its arguments.
  if (Array.isArray(value)) {
    if (value[0] === 'literal') return value;
    return value.map((item, index) => (index === 0 ? item : mixColours(item, toward, amount)));
  }
  return value;
}

const isZoomInput = (input: unknown) => Array.isArray(input) && input[0] === 'zoom';

/**
 * An opacity times a factor. Zoom curves stay at the top of the expression, as MapLibre requires;
 * `near` decides what each scaled leaf shows, for an area that keeps its strength.
 */
function scaleOpacity(
  value: unknown,
  factor: number,
  near: (original: unknown, scaled: unknown) => unknown = (_original, scaled) => scaled,
): unknown {
  const scale = (item: unknown) => scaleOpacity(item, factor, near);
  if (value === undefined || value === null) return near(1, factor);
  if (typeof value === 'number') return near(value, round(value * factor));
  if (Array.isArray(value)) {
    const operator = value[0];
    if (
      typeof operator === 'string' &&
      operator.startsWith('interpolate') &&
      isZoomInput(value[2])
    ) {
      return [
        ...value.slice(0, 3),
        ...value.slice(3).map((item, index) => (index % 2 === 1 ? scale(item) : item)),
      ];
    }
    if (operator === 'step' && isZoomInput(value[1])) {
      return [
        'step',
        value[1],
        scale(value[2]),
        ...value.slice(3).map((item, index) => (index % 2 === 1 ? scale(item) : item)),
      ];
    }
    // A `let` keeps its bindings; its body may hold the zoom curve.
    if (operator === 'let') return [...value.slice(0, -1), scale(value.at(-1))];
  }
  return near(value, ['*', value, factor]);
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

function areaPositions(value: unknown): number | undefined {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return undefined;
  const polygons =
    value.type === 'Polygon'
      ? [value.coordinates]
      : value.type === 'MultiPolygon'
        ? value.coordinates
        : undefined;
  if (!polygons) return undefined;
  let positions = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return undefined;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return undefined;
      for (const position of ring) {
        if (
          !Array.isArray(position) ||
          position.length < 2 ||
          !position.every(
            (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
          )
        )
          return undefined;
        positions += 1;
      }
    }
  }
  return positions;
}

const isUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
