import type {TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/** Package-owned Cyberpunk icons and patterns. */
export const cyberpunkIcons = packageDirectory('assets/cyberpunk/icons');

/** Package-owned Matrix phosphor patterns and symbols. */
export const matrixIcons = packageDirectory('assets/matrix/icons');

/** Package-owned Verdant icons and patterns. This root does not compose Streets assets. */
export const verdantIcons = packageDirectory('assets/verdant/icons');

/** Package-owned Ferraris patterns. This root does not compose Streets assets. */
export const ferrarisIcons = packageDirectory('assets/ferraris/icons');

/** Package-owned Baedeker patterns. This root does not compose another map's assets. */
export const baedekerIcons = packageDirectory('assets/baedeker/icons');

/** Package-owned San Francisto blueprint patterns and technical symbol. */
export const sanFrancistoIcons = packageDirectory('assets/san-francisto/icons');

/** Package-owned Soundings symbols and patterns. This root does not compose Streets assets. */
export const soundingsIcons = packageDirectory('assets/soundings/icons');

/** Package-owned Härad patterns. This root does not compose Streets assets. */
export const haradIcons = packageDirectory('assets/harad/icons');

/** Package-owned Siegfried patterns. This root does not compose Streets assets. */
export const siegfriedIcons = packageDirectory('assets/siegfried/icons');

/** Package-owned Cyberpunk web fonts and their license. */
export const cyberpunkFonts = packageDirectory('assets/cyberpunk/fonts');

/** Package-owned Matrix web fonts and their license. */
export const matrixFonts = packageDirectory('assets/matrix/fonts');

/** Package-owned Baedeker web fonts and their license. */
export const baedekerFonts = packageDirectory('assets/baedeker/fonts');

/** Package-owned Siegfried web fonts and their license. */
export const siegfriedFonts = packageDirectory('assets/siegfried/fonts');
