import type {TileflowPackageDirectory} from '@tileflow/core';

function packageDirectory(path: string): TileflowPackageDirectory {
  return Object.freeze({kind: 'package-directory', package: '@tileflow/maps', path});
}

/** Package-owned Streets icons. Filename stems are the canonical runtime IDs. */
export const streetsIcons = packageDirectory('assets/streets/icons');

/** Package-owned navigation lettering and fallback faces, with their licenses. */
export const streetsFonts = packageDirectory('assets/streets/fonts');

/** Package-owned Streets tree geometry, including the lighter far models. */
export const streetsModels = packageDirectory('assets/streets/models');

/** Package-owned Soundings symbols and patterns. This root does not compose Streets assets. */
export const soundingsIcons = packageDirectory('assets/soundings/icons');

/** Summit symbols for the Outdoors map. */
export const outdoorsIcons = packageDirectory('assets/outdoors/icons');
