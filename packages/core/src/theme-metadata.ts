/** A theme controller's metadata of every theme on screen, and where its blend stands between them. */
export type TileflowThemeMetadataReader = (
  key: string,
) => Readonly<{values: readonly unknown[]; position: number}>;

/**
 * Where a theme controller publishes its metadata reader on the map object, for map parts that are
 * attached without a controller. A shared symbol keeps it visible to every copy of the runtime.
 */
export const tileflowThemeMetadataKey = Symbol.for('tileflow.themeMetadata');

/** The reader a theme controller published on this map, if any. */
export function tileflowThemeMetadataReaderOf(
  map: object,
): TileflowThemeMetadataReader | undefined {
  const reader = (map as Record<symbol, unknown>)[tileflowThemeMetadataKey];
  return typeof reader === 'function' ? (reader as TileflowThemeMetadataReader) : undefined;
}
