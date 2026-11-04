export const tileflowWorldGeneration = 'v1' as const;
export const tileflowWorldTileJsonPath = '/tiles/world/tiles.json' as const;
export const tileflowWorldDetailTileJsonPath = '/tiles/world-detail/tiles.json' as const;
/** Mutable discovery selector. The server resolves it once to an immutable release in TileJSON. */
export const tileflowWorldTileJsonUrl = 'https://api.tileflow.dev/tiles/world/tiles.json' as const;
/** Discovery selector of the release's `world-detail` tileset. */
export const tileflowWorldDetailTileJsonUrl =
  'https://api.tileflow.dev/tiles/world-detail/tiles.json' as const;
