import type {TileflowWorldFieldName, TileflowWorldLayerName} from './tileflow-world-schema';

/**
 * How a field of a World layer is read from other tiles: the property that holds it, or an
 * expression over the tiles' own properties that computes its World value.
 */
export type TileflowDataFieldAccessor = string | Readonly<{expression: unknown}>;

/**
 * One source layer that holds part of a World layer. `filter` selects its features in that layer;
 * `classes` lists every World `class` it can produce, so a style layer whose filter excludes them
 * all skips it.
 */
export type TileflowDataLayerPartition = Readonly<{
  classes?: readonly string[];
  fields?: Readonly<Partial<Record<TileflowWorldFieldName, TileflowDataFieldAccessor>>>;
  filter?: unknown;
  layer: string;
}>;

/** Reads tiles of another schema through World's layers and fields. */
export type TileflowDataAdapter = Readonly<{
  layers: Readonly<Partial<Record<TileflowWorldLayerName, readonly TileflowDataLayerPartition[]>>>;
}>;
