import type {TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/** Package-owned Streets Dark overrides. Compose after streetsIcons to override by ID. */
export const streetsDarkIcons = packageDirectory('assets/streets-dark/icons');

/** Package-owned Cyberpunk additions. Compose after streetsIcons to override by ID. */
export const cyberpunkIcons = packageDirectory('assets/cyberpunk/icons');

/** Package-owned Verdant additions. Compose after streetsIcons to override by ID. */
export const verdantIcons = packageDirectory('assets/verdant/icons');

/** Package-owned Ferraris patterns. This root does not compose Streets assets. */
export const ferrarisIcons = packageDirectory('assets/ferraris/icons');

/** Package-owned Cyberpunk web fonts and their license. */
export const cyberpunkFonts = packageDirectory('assets/cyberpunk/fonts');
