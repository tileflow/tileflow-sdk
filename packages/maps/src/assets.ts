import type {TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/** @deprecated Compatibility assets; use `neonGridIcons` from @tileflow/community-maps. */
export const cyberpunkIcons = packageDirectory('assets/cyberpunk/icons');

/** @deprecated Compatibility assets; use `terminalIcons` from @tileflow/community-maps. */
export const matrixIcons = packageDirectory('assets/matrix/icons');

/** Package-owned Verdant icons and patterns. This root does not compose Streets assets. */
export const verdantIcons = packageDirectory('assets/verdant/icons');

/** Package-owned Ferraris patterns. This root does not compose Streets assets. */
export const ferrarisIcons = packageDirectory('assets/ferraris/icons');

/** Package-owned Baedeker patterns. This root does not compose another map's assets. */
export const baedekerIcons = packageDirectory('assets/baedeker/icons');

/** Package-owned Cívica print textures and landmark symbols. */
export const civicaIcons = packageDirectory('assets/civica/icons');

/** Package-owned Blueprint patterns and technical symbol. The asset path is stable. */
export const blueprintIcons = packageDirectory('assets/san-francisto/icons');
/** @deprecated Use `blueprintIcons`. This alias preserves the same asset descriptor. */
export const sanFrancistoIcons = blueprintIcons;

/** Package-owned Soundings symbols and patterns. This root does not compose Streets assets. */
export const soundingsIcons = packageDirectory('assets/soundings/icons');

/** Package-owned Härad patterns. This root does not compose Streets assets. */
export const haradIcons = packageDirectory('assets/harad/icons');

/** Package-owned Siegfried patterns. This root does not compose Streets assets. */
export const siegfriedIcons = packageDirectory('assets/siegfried/icons');

/** Package-owned Cívica print lettering and its license. */
export const civicaFonts = packageDirectory('assets/civica/fonts');

/** Package-owned Super Tile World pixel sprites, terrain tiles, and lettering. */
export const superTileWorldIcons = packageDirectory('assets/super-tile-world/icons');
export const superTileWorldFonts = packageDirectory('assets/super-tile-world/fonts');

/** @deprecated Compatibility assets; use `neonGridFonts` from @tileflow/community-maps. */
export const cyberpunkFonts = packageDirectory('assets/cyberpunk/fonts');

/** @deprecated Compatibility assets; use `terminalFonts` from @tileflow/community-maps. */
export const matrixFonts = packageDirectory('assets/matrix/fonts');

/** Package-owned Baedeker web fonts and their license. */
export const baedekerFonts = packageDirectory('assets/baedeker/fonts');

/** Package-owned Siegfried web fonts and their license. */
export const siegfriedFonts = packageDirectory('assets/siegfried/fonts');
