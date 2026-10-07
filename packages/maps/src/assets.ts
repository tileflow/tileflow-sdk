import type {TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/** Package-owned Ferraris patterns. This root does not compose Streets assets. */
export const ferrarisIcons = packageDirectory('assets/ferraris/icons');

/** Package-owned Baedeker patterns. This root does not compose another map's assets. */
export const baedekerIcons = packageDirectory('assets/baedeker/icons');

/** Package-owned Cívica print textures and landmark symbols. */
export const civicaIcons = packageDirectory('assets/civica/icons');

/** Package-owned Blueprint patterns and technical symbol. The asset path is stable. */
export const blueprintIcons = packageDirectory('assets/blueprint/icons');

/** Package-owned Soundings symbols and patterns. This root does not compose Streets assets. */
export const soundingsIcons = packageDirectory('assets/soundings/icons');

/** Package-owned Härad patterns. This root does not compose Streets assets. */
export const haradIcons = packageDirectory('assets/harad/icons');

/** Package-owned Siegfried patterns. This root does not compose Streets assets. */
export const siegfriedIcons = packageDirectory('assets/siegfried/icons');

/** Package-owned Cívica print lettering and its license. */
export const civicaFonts = packageDirectory('assets/civica/fonts');

/** Package-owned Baedeker web fonts and their license. */
export const baedekerFonts = packageDirectory('assets/baedeker/fonts');

/** Package-owned Siegfried web fonts and their license. */
export const siegfriedFonts = packageDirectory('assets/siegfried/fonts');
