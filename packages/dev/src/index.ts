/** Compatibility facade. Prefer the focused subpath matching the integration responsibility. */
export * from './artifacts';
export * from './config';
export * from './fonts';
export * from './icons';
export * from './inspect';
export * from './preview';
export * from './server';
export * from './tileset-inspection';
export * from './validation';

export {
  composeTileflowIconSources,
  type ComposeTileflowIconSourcesOptions,
  type TileflowComposedIconSources,
} from './icon-composition';
export {verifyTileflowIconArtifact, type VerifiedTileflowIconArtifact} from './icon-artifact';
export {
  getTileflowIconCacheDirectory,
  loadTileflowIconSetArtifact,
  storeTileflowIconSetArtifact,
  type TileflowIconCacheOptions,
} from './icon-cache';
export {readTileflowIconsLockfile, writeTileflowIconsLockfile} from './icon-lockfile';
export {
  packTileflowRenderedIcons,
  type TileflowRenderedIcon,
  type TileflowRenderedIconCell,
} from './icon-sprite';
